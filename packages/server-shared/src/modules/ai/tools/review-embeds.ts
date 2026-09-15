/**
 * Review embed-widget tools: per-location widget styling and multi-location collections.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { reviewEmbedCollections, reviewEmbedConfigs, reviewLocations } from '../../../db/schema.js';
import type { ReviewEmbedTheme } from '../../../db/schema.js';
import { DEFAULT_EMBED_THEME } from '../../reviews/embed.js';
import {
  countBrandReviews,
  embedCollectionLocationCounts,
  getLocationEmbedState,
  listBrandEmbedCollections,
} from '../../reviews/queries.js';
import { obj, EMBED_VARIANTS, EMBED_FONTS, EMBED_DENSITIES, EMBED_RADII, mergeEmbedTheme, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function reviewEmbedTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'get_review_embed',
        description: [
          "Get the embed-widget configuration for ONE of this brand's review locations (the styleable widget that displays reviews on the brand's own website).",
          'Returns { error } if the locationId does not belong to this brand. Otherwise: { locationName, slug, embedUnlocked (boolean — the widget is usable at 10+ account reviews), brandedUnlocked (boolean — colour/font/logo styling is usable at 25+ location reviews), accountReviews, locationReviews, theme }. The theme object has: variant ("carousel"|"wall"|"marquee"|"hero"), accentColor (hex or absent), fontFamily ("geist"|"inter"|"system"|"playfair"|"dm-sans"), dark, showLogo, showWinTags, showStarCount, onlyFiveStar (booleans), density ("compact"|"cozy"|"comfortable"), radius ("sharp"|"soft"|"round").',
        ].join('\n'),
        input_schema: obj(
          { locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' } },
          ['locationId'],
        ),
      },
      run: async (input: Record<string, unknown>) => {
        const locationId = String(input.locationId ?? '');
        const [loc] = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name, slug: reviewLocations.slug })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.id, locationId), eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
          .limit(1);
        if (!loc) return { error: 'That review location does not belong to this brand.' };
        // Shared state (also backs tRPC reviews.embed.getForLocation) — the unlock
        // thresholds live in one place now (no more hard-coded 25).
        const s = await getLocationEmbedState(db, brandId, loc.id);
        return {
          locationName: loc.name,
          slug: loc.slug,
          embedUnlocked: s.embedUnlocked,
          brandedUnlocked: s.brandedUnlocked,
          accountReviews: s.brandReviews,
          locationReviews: s.locationReviews,
          theme: s.theme,
        };
      },
    },
    {
      def: {
        name: 'list_review_embed_collections',
        description: [
          "List THIS brand's multi-location embed collections (widgets that combine reviews from several locations). Takes no arguments.",
          'Returns { accountReviews, count, collections } where collections is an array of { id (pass as collectionId to update_review_embed_collection), name, slug, locationCount (INTEGER), createdAt }.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query cores (also back tRPC reviews.collections.list).
        const [brandReviews, cols] = await Promise.all([
          countBrandReviews(db, brandId),
          listBrandEmbedCollections(db, brandId),
        ]);
        const byCol = await embedCollectionLocationCounts(db, cols.map((c) => c.id));
        return {
          accountReviews: brandReviews,
          count: cols.length,
          collections: cols.map((c) => ({
            id: c.id,
            name: c.name,
            slug: c.slug,
            createdAt: c.createdAt,
            locationCount: byCol.get(c.id) ?? 0,
          })),
        };
      },
    },
    {
      def: {
        name: 'update_review_embed_style',
        description: [
          "Propose restyling the embed widget for ONE of this brand's review locations (layout, colours, font, and display toggles). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Read get_review_embed first; provide only the fields you want to change. Note: the widget must be unlocked (10+ account reviews) to save, and colour/font/logo styling requires 25+ reviews at that location — the confirm step enforces this.",
          'Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. On failure returns { error }.',
        ].join('\n'),
        input_schema: obj(
          {
            locationId: { type: 'string', description: 'The location\'s id (from list_review_locations). Must belong to this brand.' },
            variant: { type: 'string', description: 'Widget layout.', enum: [...EMBED_VARIANTS] },
            accentColor: { type: 'string', description: 'Accent colour as a 6-digit hex (branded — needs 25+ location reviews).' },
            fontFamily: { type: 'string', description: 'Font family (branded — needs 25+ location reviews).', enum: [...EMBED_FONTS] },
            dark: { type: 'boolean', description: 'Dark mode on/off.' },
            showLogo: { type: 'boolean', description: 'Show the location logo (branded — needs 25+ location reviews).' },
            showWinTags: { type: 'boolean', description: 'Show the win-tag chips on each review.' },
            showStarCount: { type: 'boolean', description: 'Show the aggregate star count.' },
            onlyFiveStar: { type: 'boolean', description: 'Only display 5-star reviews.' },
            density: { type: 'string', description: 'Spacing density.', enum: [...EMBED_DENSITIES] },
            radius: { type: 'string', description: 'Corner radius of the cards.', enum: [...EMBED_RADII] },
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
        const [cfgRow] = await db
          .select({ theme: reviewEmbedConfigs.theme })
          .from(reviewEmbedConfigs)
          .where(eq(reviewEmbedConfigs.locationId, loc.id))
          .limit(1);
        const merged = mergeEmbedTheme((cfgRow?.theme as ReviewEmbedTheme) ?? DEFAULT_EMBED_THEME, input);
        if ('error' in merged) return { error: merged.error };
        pendingActions.push({
          kind: 'save_embed_style',
          toolUseId,
          payload: { locationId, locationName: loc.name, theme: merged.theme, changes: merged.changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'create_review_embed_collection',
        description: [
          "Propose creating a multi-location embed collection — a single widget that shows reviews pooled from several of this brand's locations. This surfaces a confirm card; it is only created when the USER clicks confirm.",
          'DUPLICATE GUARD: if the brand already has a SIMILAR collection, the tool returns { status: "similar_exists", similar } instead of proposing anything — do NOT create; tell the user what exists and ask whether they want a new one anyway (then re-call with createAnyway: true) or to update the existing one (update_review_embed_collection) instead.',
          'Returns { status: "awaiting_confirmation" } on success — nothing is created until the user confirms. On failure returns { error } (e.g. a location does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            name: { type: 'string', description: 'A name for the collection (1–255 characters), e.g. "All stores".' },
            locationIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'The location ids (from list_review_locations) to include. At least one; all must belong to this brand.',
            },
            ...CREATE_ANYWAY_PROP,
          },
          ['name', 'locationIds'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const colName = String(input.name ?? '').trim();
        if (!colName) return { error: 'A collection name is required.' };
        if (colName.length > 255) return { error: 'The collection name must be 255 characters or fewer.' };
        // Unless the user already confirmed, surface any SIMILAR existing collection
        // so the model can ask before creating a likely-duplicate.
        if (input.createAnyway !== true) {
          const existing = await listBrandEmbedCollections(db, brandId);
          const similar = findSimilarByName(colName, existing);
          if (similar.length) {
            return similarExistsResult('embed collection', similar, 'To update an existing one instead, use update_review_embed_collection with its id.');
          }
        }
        const locationIds = Array.isArray(input.locationIds) ? input.locationIds.map((x) => String(x)) : [];
        if (locationIds.length === 0) return { error: 'Include at least one location.' };
        const owned = await db
          .select({ id: reviewLocations.id, name: reviewLocations.name })
          .from(reviewLocations)
          .where(and(eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt), inArray(reviewLocations.id, locationIds)));
        const ownedIds = new Set(owned.map((o) => o.id));
        const missing = locationIds.filter((id) => !ownedIds.has(id));
        if (missing.length) return { error: 'One or more locations do not belong to this brand.' };
        pendingActions.push({
          kind: 'save_embed_collection',
          toolUseId,
          payload: { mode: 'create', name: colName, locationIds, locationNames: owned.map((o) => o.name) },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_review_embed_collection',
        description: [
          "Propose updating an existing multi-location embed collection — rename it, change which locations it includes, and/or restyle it. This surfaces a confirm card; the change is only applied when the USER clicks confirm. Use list_review_embed_collections to find the collectionId. Provide only what you want to change.",
          'Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. On failure returns { error } (e.g. the collection does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            collectionId: { type: 'string', description: 'The collection\'s id (from list_review_embed_collections). Must belong to this brand.' },
            name: { type: 'string', description: 'New collection name (1–255 characters).' },
            locationIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Replacement list of location ids to include (replaces the current set). All must belong to this brand.',
            },
            variant: { type: 'string', description: 'Widget layout.', enum: [...EMBED_VARIANTS] },
            accentColor: { type: 'string', description: 'Accent colour as a 6-digit hex.' },
            fontFamily: { type: 'string', description: 'Font family.', enum: [...EMBED_FONTS] },
            dark: { type: 'boolean', description: 'Dark mode on/off.' },
            showWinTags: { type: 'boolean', description: 'Show the win-tag chips.' },
            showStarCount: { type: 'boolean', description: 'Show the aggregate star count.' },
            onlyFiveStar: { type: 'boolean', description: 'Only display 5-star reviews.' },
            density: { type: 'string', description: 'Spacing density.', enum: [...EMBED_DENSITIES] },
            radius: { type: 'string', description: 'Corner radius of the cards.', enum: [...EMBED_RADII] },
          },
          ['collectionId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const collectionId = String(input.collectionId ?? '');
        const [col] = await db
          .select({ id: reviewEmbedCollections.id, name: reviewEmbedCollections.name, theme: reviewEmbedCollections.theme })
          .from(reviewEmbedCollections)
          .where(and(eq(reviewEmbedCollections.id, collectionId), eq(reviewEmbedCollections.brandId, brandId)))
          .limit(1);
        if (!col) return { error: 'That embed collection does not belong to this brand.' };
        const payload: Record<string, unknown> = { mode: 'update', collectionId, collectionName: col.name };
        const changes: Record<string, string> = {};
        if (input.name !== undefined) {
          const v = String(input.name ?? '').trim();
          if (!v) return { error: 'The collection name cannot be empty.' };
          if (v.length > 255) return { error: 'The collection name must be 255 characters or fewer.' };
          payload.name = v;
          changes['Name'] = v;
        }
        if (input.locationIds !== undefined) {
          const locationIds = Array.isArray(input.locationIds) ? input.locationIds.map((x) => String(x)) : [];
          if (locationIds.length === 0) return { error: 'A collection must include at least one location.' };
          const owned = await db
            .select({ id: reviewLocations.id, name: reviewLocations.name })
            .from(reviewLocations)
            .where(and(eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt), inArray(reviewLocations.id, locationIds)));
          const ownedIds = new Set(owned.map((o) => o.id));
          if (locationIds.some((id) => !ownedIds.has(id))) return { error: 'One or more locations do not belong to this brand.' };
          payload.locationIds = locationIds;
          changes['Locations'] = owned.map((o) => o.name).join(', ');
        }
        // Any theme fields present → merge onto the collection's current theme.
        const hasThemeField = ['variant', 'accentColor', 'fontFamily', 'dark', 'showWinTags', 'showStarCount', 'onlyFiveStar', 'density', 'radius']
          .some((k) => input[k] !== undefined);
        if (hasThemeField) {
          const merged = mergeEmbedTheme((col.theme as ReviewEmbedTheme) ?? DEFAULT_EMBED_THEME, input);
          if ('error' in merged) return { error: merged.error };
          payload.theme = merged.theme;
          Object.assign(changes, merged.changes);
        }
        if (Object.keys(changes).length === 0) return { error: 'Provide at least one field to update.' };
        pendingActions.push({ kind: 'save_embed_collection', toolUseId, payload: { ...payload, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
  ];
}
