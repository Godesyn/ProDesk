/**
 * Reviews (Verdiict) tools: capture locations, stats/insights, win-tags, review requests, and the public directory.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { reviewLocations } from '../../../db/schema.js';
import {
  countBrandReviews,
  getBrandDirectoryListing,
  getDirectoryProfile,
  getIndustryLeaderboard,
  getIndustryRankForBrand,
  getIndustryRankForLocation,
  getLocationStats,
  getLocationWinTags,
  getTopWinTags,
  getWeeklyReviewCounts,
  listBrandLocations,
  listLocationSubmissions,
  reviewCountsByLocation,
  searchDirectory,
} from '../../reviews/queries.js';
import { obj, REVIEW_PLATFORMS, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function reviewTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'list_review_locations',
        description: [
          "List THIS brand's review-capture locations (the pages where customers leave reviews). Excludes soft-deleted locations. Capped at 50 rows.",
          'Returns { count, locations } where locations is an array of:',
          '- id: location UUID. Pass this as locationId to get_review_stats, list_recent_reviews, or get_review_insights.',
          '- name: the location / business-unit name.',
          '- slug: URL slug used in the public capture link.',
          '- industry: the industry category of this location (e.g. "hospitality").',
          '- logoUrl: location logo URL (may be null).',
          '- reviewCount: INTEGER total number of reviews captured at this location.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also backs tRPC reviews.locations.list), capped at 50.
        const locRows = await listBrandLocations(db, brandId, { limit: 50 });
        const countByLoc = await reviewCountsByLocation(db, locRows.map((r) => r.id));
        return {
          count: locRows.length,
          locations: locRows.map((r) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            industry: r.industry,
            logoUrl: r.logoUrl,
            reviewCount: countByLoc.get(r.id) ?? 0,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_review_stats',
        description: [
          "Get review statistics for ONE of this brand's review locations: total reviews, average star rating, and public vs. private breakdown.",
          'Returns { error } if the locationId does not belong to this brand. Otherwise returns:',
          '- total: INTEGER total reviews captured.',
          '- avgStars: NUMBER average star rating (1 decimal, e.g. 4.3). 0 if no reviews.',
          '- publicCount: INTEGER count of public (4–5★) reviews.',
          '- privateCount: INTEGER count of private (1–3★) feedback submissions.',
        ].join('\n'),
        input_schema: obj(
          { locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' } },
          ['locationId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const locationId = String(input.locationId ?? '');
        const [loc] = await db
          .select({ id: reviewLocations.id })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand.' };
        // Shared aggregate (also backs tRPC reviews.dashboard.stats).
        return getLocationStats(db, locationId);
      },
    },
    {
      def: {
        name: 'list_recent_reviews',
        description: [
          "List the most recent review submissions for ONE of this brand's review locations. Capped at 20 rows, newest first.",
          'Returns { error } if the locationId does not belong to this brand. Otherwise returns { count, reviews } where reviews is an array of:',
          '- id: submission UUID.',
          '- stars: INTEGER 1–5 star rating.',
          '- selectedTags: ARRAY of strings — the \"win tags\" the reviewer selected (may be empty).',
          '- generatedReview: the AI-composed public review text (null if none was generated, e.g. private feedback).',
          '- privateFeedback: free-text private feedback left by the reviewer (null if none).',
          '- submissionType: "public" (4–5★ review shared publicly) or "private" (1–3★ feedback sent privately to the brand).',
          '- createdAt: ISO timestamp.',
        ].join('\n'),
        input_schema: obj(
          { locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' } },
          ['locationId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const locationId = String(input.locationId ?? '');
        const [loc] = await db
          .select({ id: reviewLocations.id })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand.' };
        // Shared query core (also backs tRPC reviews.dashboard.reviews), capped at 20.
        const rows = await listLocationSubmissions(db, locationId, { limit: 20 });
        return {
          count: rows.length,
          reviews: rows.map((r) => ({
            id: r.id,
            stars: r.stars,
            selectedTags: r.selectedTags,
            generatedReview: r.generatedReview,
            privateFeedback: r.privateFeedback,
            submissionType: r.submissionType,
            createdAt: r.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_review_insights',
        description: [
          "Get brand-level review insights: total reviews across ALL locations, the weekly review trend (last 12 weeks), and — when a locationId is given — the top win-tags for that location and the brand's industry rank (90-day volume vs. other brands in the same industry).",
          'Returns an object:',
          '- brandTotalReviews: INTEGER total reviews across all of this brand\'s locations.',
          '- weeklyTrend: array (12 entries, oldest first) of { weekStart (ISO date), count (INTEGER reviews that week) }. Shows capture momentum / streaks.',
          '- topWinTags: array (up to 5) of { tag, count, pct (percentage of public reviews that selected this tag) }. Only present when locationId is provided; null otherwise.',
          '- industryRank: { rank (INTEGER position, 1 = best), total (INTEGER brands in same industry), percentile (INTEGER 1–100, lower = better) }. Only present when locationId is provided and the location has an industry set; null otherwise.',
        ].join('\n'),
        input_schema: obj(
          { locationId: { type: 'string', description: 'Optional location id. When provided, includes per-location win-tag and industry-rank data.' } },
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const locationId = typeof input.locationId === 'string' ? input.locationId : '';
        // Reuse the same brand-level helpers the tRPC insights.* procedures use,
        // so the chatbot and the Reviews dashboard report identical numbers.
        const [brandTotalReviews, weeks] = await Promise.all([
          countBrandReviews(db, brandId),
          getWeeklyReviewCounts(db, brandId, 12),
        ]);
        const weeklyTrend = weeks.map((w) => ({
          weekStart: w.weekStart.toISOString().slice(0, 10),
          count: w.count,
        }));
        // Per-location: top win tags + industry rank (only when locationId given).
        let topWinTags: Array<{ tag: string; count: number; pct: number }> | null = null;
        let industryRank: { rank: number | null; total: number; percentile: number | null } | null = null;
        if (locationId) {
          const [loc] = await db
            .select({ id: reviewLocations.id, industry: reviewLocations.industry })
            .from(reviewLocations)
            .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId)))
            .limit(1);
          if (loc) {
            [topWinTags, industryRank] = await Promise.all([
              getTopWinTags(db, loc.id, 5),
              getIndustryRankForBrand(db, brandId, loc.industry),
            ]);
          }
        }
        return { brandTotalReviews, weeklyTrend, topWinTags, industryRank };
      },
    },
    {
      def: {
        name: 'get_review_win_tags',
        description: [
          "Get the CONFIGURED win-tags for ONE of this brand's review locations — the selectable positive-highlight chips a happy customer can tap when leaving a public review (distinct from get_review_insights.topWinTags, which is how often each tag has actually been chosen). Read this before update_review_win_tags so you propose the full intended list rather than overwriting the existing tags.",
          'Returns { error } if the locationId does not belong to this brand. Otherwise returns { locationName, tags } where tags is an ARRAY of strings in display order (may be empty).',
        ].join('\n'),
        input_schema: obj(
          { locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' } },
          ['locationId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const locationId = String(input.locationId ?? '');
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand or has been deleted.' };
        const rows = await getLocationWinTags(db, loc.id);
        return { locationName: loc.name, tags: rows.map((r) => r.label) };
      },
    },
    {
      def: {
        name: 'send_review_request',
        description: [
          'Propose sending a review-request email to a customer — an email inviting them to leave a review at one of this brand\'s review locations. This surfaces a confirm card; the email is only sent when the USER clicks confirm.',
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is sent yet. Never claim the email was sent. On failure returns { error } (e.g. the locationId does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            locationId: { type: 'string', description: 'The review location\'s id (from list_review_locations). Must belong to this brand.' },
            customerName: { type: 'string', description: 'The customer\'s name (shown in the email greeting). 1–255 characters.' },
            customerEmail: { type: 'string', description: 'The customer\'s email address to send the review request to. Must be a valid email.' },
            customMessage: { type: 'string', description: 'Optional personal message included in the email (up to 500 characters). Omit for the default template.' },
          },
          ['locationId', 'customerName', 'customerEmail'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const locationId = String(input.locationId ?? '');
        const customerName = String(input.customerName ?? '').trim();
        const customerEmail = String(input.customerEmail ?? '').trim();
        const customMessage = typeof input.customMessage === 'string' ? input.customMessage.trim() : '';
        if (!customerName) return { error: 'Customer name is required.' };
        if (customerName.length > 255) return { error: 'Customer name must be 255 characters or fewer.' };
        if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
          return { error: 'A valid customer email address is required.' };
        }
        if (customMessage.length > 500) return { error: 'Custom message must be 500 characters or fewer.' };
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand or has been deleted.' };
        pendingActions.push({
          kind: 'send_review_request',
          toolUseId,
          payload: { locationId: loc.id, locationName: loc.name, customerName, customerEmail, customMessage: customMessage || null },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. The email is NOT sent until they confirm.' };
      },
    },
    {
      def: {
        name: 'create_review_location',
        description: [
          "Propose creating a new review-capture location for this brand (a page where customers leave reviews). This surfaces a confirm card; the location is only created when the USER clicks confirm. A set of default win-tags is added automatically based on the industry.",
          'DUPLICATE GUARD: if the brand already has a SIMILAR location, the tool returns { status: "similar_exists", similar } instead of proposing anything. When that happens, do NOT create — tell the user which location(s) already exist and ask whether they want a new one anyway (then re-call with createAnyway: true) or to update the existing one (update_review_location) instead.',
          'Returns { status: "awaiting_confirmation" } on success — nothing is created until the user confirms. On failure returns { error }.',
        ].join('\n'),
        input_schema: obj(
          {
            name: { type: 'string', description: 'The location / business-unit name (1–255 characters), e.g. "Downtown Cafe".' },
            industry: { type: 'string', description: 'Industry slug for the location, lowercase (e.g. "hospitality", "retail", "other"). 1–64 characters. Determines the default win-tags.' },
            ...CREATE_ANYWAY_PROP,
          },
          ['name', 'industry'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const locName = String(input.name ?? '').trim();
        const industry = String(input.industry ?? '').trim().toLowerCase();
        if (!locName) return { error: 'A location name is required.' };
        if (locName.length > 255) return { error: 'The location name must be 255 characters or fewer.' };
        if (!industry) return { error: 'An industry is required.' };
        if (industry.length > 64) return { error: 'The industry must be 64 characters or fewer.' };
        // Unless the user already confirmed, surface any SIMILAR existing location
        // so the model can ask before creating a likely-duplicate.
        if (input.createAnyway !== true) {
          const existing = await listBrandLocations(db, brandId, { limit: 200 });
          const similar = findSimilarByName(locName, existing);
          if (similar.length) {
            return similarExistsResult('review location', similar, 'To update an existing one instead, use update_review_location with its id.');
          }
        }
        pendingActions.push({ kind: 'create_review_location', toolUseId, payload: { name: locName, industry } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_review_location',
        description: [
          "Propose updating core settings on ONE of this brand's review locations (its display name, the email that receives private/bad-review feedback, the redirect URL customers go to after leaving a public review, or its logo). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Provide ONLY the fields you want to change.",
          'Validation, or the call returns { error }: at least one field required; name 1–255 chars; badReviewEmail must be a valid email (or empty string to clear); redirectUrl must be a valid URL (or empty string to clear). Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms.',
        ].join('\n'),
        input_schema: obj(
          {
            locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' },
            name: { type: 'string', description: 'New location name (1–255 characters).' },
            badReviewEmail: { type: 'string', description: 'Email to receive private (1–3★) feedback. Valid email, or empty string to clear.' },
            redirectUrl: { type: 'string', description: 'URL customers are sent to after a public review. Valid URL, or empty string to clear.' },
            logoUrl: { type: 'string', description: 'Logo image URL for the capture page. Empty string to clear.' },
          },
          ['locationId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const locationId = String(input.locationId ?? '');
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand or has been deleted.' };
        const payload: Record<string, unknown> = { locationId };
        const changes: Record<string, string> = {};
        if (input.name !== undefined) {
          const v = String(input.name ?? '').trim();
          if (!v) return { error: 'The location name cannot be empty.' };
          if (v.length > 255) return { error: 'The location name must be 255 characters or fewer.' };
          payload.name = v;
          changes['Name'] = v;
        }
        if (input.badReviewEmail !== undefined) {
          const v = String(input.badReviewEmail ?? '').trim();
          if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return { error: 'The feedback email address is not valid.' };
          payload.badReviewEmail = v || null;
          changes['Feedback email'] = v || '— cleared —';
        }
        if (input.redirectUrl !== undefined) {
          const v = String(input.redirectUrl ?? '').trim();
          if (v) { try { new URL(v); } catch { return { error: 'The redirect URL is not valid.' }; } }
          payload.redirectUrl = v || null;
          changes['Redirect URL'] = v || '— cleared —';
        }
        if (input.logoUrl !== undefined) {
          const v = String(input.logoUrl ?? '').trim();
          payload.logoUrl = v || null;
          changes['Logo'] = v || '— cleared —';
        }
        if (Object.keys(changes).length === 0) return { error: 'Provide at least one field to update.' };
        pendingActions.push({ kind: 'update_review_location', toolUseId, payload: { ...payload, locationName: loc.name, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_review_platform',
        description: [
          "Propose setting (or clearing) the review-platform link for ONE of this brand's review locations — the external profile (Google, Facebook, etc.) that happy customers are sent to. This surfaces a confirm card; the change is only applied when the USER clicks confirm.",
          'Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. On failure returns { error } (e.g. the location does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' },
            platform: { type: 'string', description: 'Which platform link to set.', enum: [...REVIEW_PLATFORMS] },
            url: { type: 'string', description: 'The full profile/review URL for that platform. Pass an empty string to REMOVE the existing link for this platform.' },
          },
          ['locationId', 'platform', 'url'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const locationId = String(input.locationId ?? '');
        const platform = String(input.platform ?? '');
        const url = String(input.url ?? '').trim();
        if (!REVIEW_PLATFORMS.includes(platform as (typeof REVIEW_PLATFORMS)[number])) {
          return { error: `Platform must be one of: ${REVIEW_PLATFORMS.join(', ')}.` };
        }
        if (url) { try { new URL(url); } catch { return { error: 'The platform URL is not valid.' }; } }
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand or has been deleted.' };
        pendingActions.push({
          kind: 'update_review_platform',
          toolUseId,
          payload: { locationId, locationName: loc.name, platform, url },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_review_win_tags',
        description: [
          "Propose replacing the win-tags for ONE of this brand's review locations — the selectable positive-highlight chips a happy customer taps when leaving a public review. This surfaces a confirm card; the change is only applied when the USER clicks confirm.",
          'This REPLACES the full set (like editing a list), so read get_review_win_tags first and pass the COMPLETE desired list — include any existing tags you want to keep. To add one tag, return the existing tags plus the new one; to remove one, return the list without it.',
          'Validation, or the call returns { error }: `tags` must be an array of 0–50 strings, each 1–120 characters after trimming; blank entries are dropped and duplicates (case-insensitive) are collapsed. An empty list clears every win-tag. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms.',
        ].join('\n'),
        input_schema: obj(
          {
            locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' },
            tags: {
              type: 'array',
              items: { type: 'string' },
              description: 'The COMPLETE ordered list of win-tag labels this location should have. Replaces the current set. Each 1–120 characters.',
            },
          },
          ['locationId', 'tags'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const locationId = String(input.locationId ?? '');
        if (!Array.isArray(input.tags)) return { error: 'tags must be an array of strings.' };
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand or has been deleted.' };
        // Trim, drop blanks, cap length, and collapse case-insensitive duplicates
        // (keeping first occurrence + order) — mirrors reviews.locations.updateTags.
        const seen = new Set<string>();
        const tags: string[] = [];
        for (const raw of input.tags) {
          const v = String(raw ?? '').trim();
          if (!v) continue;
          if (v.length > 120) return { error: 'Each win-tag must be 120 characters or fewer.' };
          const key = v.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          tags.push(v);
        }
        if (tags.length > 50) return { error: 'A location can have at most 50 win-tags.' };
        pendingActions.push({
          kind: 'update_review_win_tags',
          toolUseId,
          payload: { locationId, locationName: loc.name, tags, changes: { 'Win-tags': tags.length ? tags.join(', ') : '— cleared —' } },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'search_review_directory',
        description: [
          'Search the PUBLIC Verdiict review directory across ALL brands (not just this one) — the opt-in public listing of businesses and their review reputation. Use to look up any business by name or city. Capped at 20 results.',
          'Searches LOCATIONS, so a business with several listed locations returns one entry per location. Each: { brandId, locationId, name, brandSlug + locationSlug (pass BOTH to get_directory_profile), path (canonical public URL path), city, description, primaryIndustry, reviewCount (INTEGER public reviews), avgRating (NUMBER 1 decimal), logoUrl }. Empty array if the query is blank or nothing matches.',
        ].join('\n'),
        input_schema: obj(
          { query: { type: 'string', description: 'Business name or city to search for (case-insensitive substring). Max 120 characters.' } },
          ['query'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const query = String(input.query ?? '').trim();
        if (!query) return [];
        return await searchDirectory(db, query, 20);
      },
    },
    {
      def: {
        name: 'get_directory_profile',
        description: [
          'Get a business\'s PUBLIC directory profile by slug (from search_review_directory). Works for ANY opt-in brand in the directory.',
          'Returns { error } if no opt-in profile exists for that slug. Otherwise: { name, slug, city, description, websiteUrl, primaryIndustry, totalReviews (INTEGER), avgRating (NUMBER), industryRank ({ rank, total, percentile } or null), locations (array of { name, industry, logoUrl }), publicReviews (array, up to 24, of { stars, generatedReview, selectedTags, locationName, createdAt }) }.',
        ].join('\n'),
        input_schema: obj(
          { slug: { type: 'string', description: 'The directory slug (the `slug` field from search_review_directory).' } },
          ['slug'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const slug = String(input.slug ?? '').trim();
        const locationSlug = input.locationSlug ? String(input.locationSlug).trim() : undefined;
        const profile = await getDirectoryProfile(db, slug, locationSlug);
        if (!profile) return { error: 'No public directory profile exists for that slug.' };
        const industryRank = profile.primaryIndustry
          ? await getIndustryRankForLocation(db, profile.locationId, profile.primaryIndustry)
          : null;
        return {
          name: profile.name,
          brandSlug: profile.brandSlug,
          locationSlug: profile.locationSlug,
          path: profile.path,
          city: profile.city,
          description: profile.description,
          websiteUrl: profile.websiteUrl,
          primaryIndustry: profile.primaryIndustry,
          totalReviews: profile.totalReviews,
          avgRating: profile.avgRating,
          industryRank,
          locations: profile.locations.map((l) => ({ name: l.name, industry: l.industry, path: l.path })),
          publicReviews: profile.publicReviews,
        };
      },
    },
    {
      def: {
        name: 'get_industry_leaderboard',
        description: [
          'Get the PUBLIC leaderboard for an industry — the top 20 opt-in businesses in that industry ranked by public review volume. Use to see how a market compares or find top performers.',
          'Ranks LOCATIONS, so one business with several listed locations can appear more than once. Returns an array (rank order) of { rank (INTEGER, 1 = top), name, brandSlug, locationSlug, path, city, primaryIndustry, reviewCount, avgRating, isBestInIndustry (boolean, true for the top 3), logoUrl }.',
        ].join('\n'),
        input_schema: obj(
          { industry: { type: 'string', description: 'The industry slug (lowercase, e.g. "hospitality"). Match the `industry` values seen on review locations.' } },
          ['industry'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const industry = String(input.industry ?? '').trim();
        if (!industry) return { error: 'An industry slug is required.' };
        return await getIndustryLeaderboard(db, industry, 20);
      },
    },
    {
      def: {
        name: 'get_directory_listing',
        description: [
          "Get THIS brand's OWN public directory listing settings (how the brand appears — or whether it appears — in the public review directory). Takes no arguments.",
          "Returns { brandSlug, locationSlug, locationName, profileUrl (the canonical /directory/<brandSlug>/<locationSlug> path for the brand's primary location), directoryOptIn (boolean — whether that location is publicly listed), websiteUrl, description, city }. Any of websiteUrl/description/city may be null. Listings are per LOCATION; this reports the primary one.",
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => getBrandDirectoryListing(db, brandId),
    },
    {
      def: {
        name: 'update_directory_listing',
        description: [
          "Propose updating THIS brand's public review-directory listing (whether it is publicly listed, and its website / description / city). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Read get_directory_listing first so you only change what the user asked for. Provide ONLY the fields you want to change.",
          'Validation, or the call returns { error }: at least one field required; websiteUrl must be a valid URL (max 500) or an empty string to clear it; description max 1000 chars; city max 120 chars. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms.',
        ].join('\n'),
        input_schema: obj({
          directoryOptIn: { type: 'boolean', description: 'true to list the brand publicly in the directory, false to hide it.' },
          websiteUrl: { type: 'string', description: 'Public website URL. Must be a valid URL, or an empty string to clear it.' },
          description: { type: 'string', description: 'Short public description of the business (max 1000 characters). Empty string clears it.' },
          city: { type: 'string', description: 'City the business is based in (max 120 characters). Empty string clears it.' },
        }),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const changes: Record<string, string> = {};
        const payload: Record<string, unknown> = {};
        if (typeof input.directoryOptIn === 'boolean') {
          payload.directoryOptIn = input.directoryOptIn;
          changes['Publicly listed'] = input.directoryOptIn ? 'yes' : 'no';
        }
        if (input.websiteUrl !== undefined) {
          const v = String(input.websiteUrl ?? '').trim();
          if (v) {
            try { new URL(v); } catch { return { error: 'The website URL is not valid.' }; }
            if (v.length > 500) return { error: 'The website URL must be 500 characters or fewer.' };
          }
          payload.websiteUrl = v || null;
          changes['Website'] = v || '— cleared —';
        }
        if (input.description !== undefined) {
          const v = String(input.description ?? '').trim();
          if (v.length > 1000) return { error: 'The description must be 1000 characters or fewer.' };
          payload.description = v || null;
          changes['Description'] = v || '— cleared —';
        }
        if (input.city !== undefined) {
          const v = String(input.city ?? '').trim();
          if (v.length > 120) return { error: 'The city must be 120 characters or fewer.' };
          payload.city = v || null;
          changes['City'] = v || '— cleared —';
        }
        if (Object.keys(payload).length === 0) return { error: 'Provide at least one field to update.' };
        pendingActions.push({ kind: 'update_directory_listing', toolUseId, payload: { ...payload, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
  ];
}
