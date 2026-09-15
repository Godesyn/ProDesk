/**
 * Short-link (Adeyy) tools: links, CAMPAIGNS (scheduled links), click analytics,
 * and QR styling.
 *
 * Each entry colocates the tool's model-facing definition (`def`) with its
 * server-side implementation (`run`). Read tools return data; action tools
 * only record a PendingAction the user must confirm client-side.
 */
import { and, eq, sql } from 'drizzle-orm';
import { linkDestinationWindows, shortLinks } from '../../../db/schema.js';
import { brandOwnerId, brandHasFeature, isBetaUser } from '../../feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../../feature-subscriptions/feature-keys.js';
import { getUrlShortenerOffer } from '../../feature-subscriptions/per-unit.js';
import {
  getBrandDefaultQrConfig,
  getLinkAnalytics,
  listCampaignsWithSchedule,
  listShortLinks,
} from '../../short-links/queries.js';
import { obj, QR_CORNER_STYLES, QR_DOT_STYLES, mergeQrConfig, getOwnerCardOnFile, cardPhrase, CREATE_ANYWAY_PROP, findSimilarByName, similarExistsResult } from './helpers.js';
import type { QrConfig } from './helpers.js';
import type { ActionBilling } from './types.js';
import type { ToolEntry, ToolModuleCtx } from './types.js';

export function linkTools(ctx: ToolModuleCtx): ToolEntry[] {
  const { db, brandId, pendingActions } = ctx;
  return [
    {
      def: {
        name: 'list_short_links',
        description: [
          "List THIS brand's plain short links (branded URLs + QR codes). Capped at 30 rows, newest first. NOTE: CAMPAIGNS (scheduled links, whose destination changes by date) are NOT included here — use list_link_campaigns for those.",
          'Returns { count, links } where links is an array of:',
          '- id: link UUID.',
          '- slug: the short URL slug (e.g. "my-promo").',
          '- nickname: user-facing label for the link.',
          '- destinationUrl: the full URL the link redirects to.',
          '- clickCount: INTEGER all-time click count.',
          '- isActive: boolean — whether the link is currently active (redirecting).',
          '- createdAt: ISO timestamp.',
        ].join('\n'),
        input_schema: obj({
          search: { type: 'string', description: 'Optional substring filter matched against the link nickname, slug, or destination URL. Omit to list all.' },
        }),
      },
      run: async (input: Record<string, unknown>) => {
        const search = typeof input.search === 'string' ? input.search.trim() : '';
        // Shared query core (also backs the tRPC shortLinks.list) — capped at 30
        // rows for the model, newest first. No cursor: the chatbot never paginates.
        const { items: rows } = await listShortLinks(db, brandId, {
          search: search || undefined,
          // Plain links only — campaigns have their own tool with the schedule.
          kind: 'link',
          limit: 30,
        });
        return {
          count: rows.length,
          links: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            nickname: r.nickname,
            destinationUrl: r.destinationUrl,
            clickCount: Number(r.clickCount),
            isActive: r.isActive,
            createdAt: r.createdAt,
          })),
        };
      },
    },
    {
      def: {
        name: 'get_link_analytics',
        description: [
          "Get click analytics for THIS brand's short links. Returns both all-time totals (from link click counts) and windowed event-based breakdowns (device, referrer, country) over a configurable window.",
          'Returns an object:',
          '- totalLinks: INTEGER total short links (all-time).',
          '- activeLinks: INTEGER currently active links.',
          '- totalClicks: INTEGER all-time clicks across all links.',
          '- topLinks: array (up to 5) of { slug, nickname, clickCount } — the highest-traffic links.',
          '- windowClicks: INTEGER clicks in the selected time window (event-based; may differ from totalClicks which is all-time).',
          '- byDevice: array of { key ("mobile"|"tablet"|"desktop"|"other"), n (INTEGER count) }.',
          '- byReferrer: array of { key (referrer hostname or "Direct / none"), n }.',
          '- byCountry: array of { key (ISO country code or "Unknown"), n }.',
        ].join('\n'),
        input_schema: obj({
          days: { type: 'integer', description: 'Number of days for the event-based window (1–365, default 30). All-time totals are unaffected.' },
        }),
      },
      run: async (input: Record<string, unknown>) => {
        const days = typeof input.days === 'number' && input.days >= 1 && input.days <= 365 ? input.days : 30;
        // Shared analytics core (also backs the tRPC shortLinks.analytics). Bots
        // are excluded so the chatbot's windowClicks match the dashboard.
        const a = await getLinkAnalytics(db, brandId, {
          days,
          includeBots: false,
          topLimit: 5,
        });
        // Project the subset the model needs (drop series / os / browser /
        // source / unique-visitor extras the dashboard also computes).
        return {
          totalLinks: a.totalLinks,
          activeLinks: a.activeLinks,
          totalClicks: a.totalClicks,
          topLinks: a.topLinks.map((l) => ({ slug: l.slug, nickname: l.nickname, clickCount: l.clickCount })),
          windowClicks: a.windowClicks,
          byDevice: a.byDevice,
          byReferrer: a.byReferrer,
          byCountry: a.byCountry,
        };
      },
    },
    {
      def: {
        name: 'create_short_link',
        description: [
          'Propose creating a new short link (branded URL) for this brand. The link is created INACTIVE (not redirecting) — the user can activate it from the Links dashboard. This surfaces a confirm card; the link is only created when the USER clicks confirm.',
          'Returns { status: "awaiting_confirmation" } on success — the card was shown, NOTHING is created yet. Never claim the link exists. On failure returns { error } (e.g. a slug already taken — slugs are globally unique, so pick another).',
          'DUPLICATE GUARD: if this brand already has a SIMILAR link (same destination URL, or a similar nickname), the tool returns { status: "similar_exists", similar } instead of proposing anything — do NOT create; tell the user which link(s) already exist and ask whether they want a new one anyway (then re-call with createAnyway: true) or to edit the existing one (update_short_link) instead.',
        ].join('\n'),
        input_schema: obj(
          {
            destinationUrl: { type: 'string', description: 'The full destination URL to redirect to (must be a valid URL, e.g. "https://example.com/sale").' },
            nickname: { type: 'string', description: 'A user-facing label for the link (e.g. "Summer Sale Link"). 1+ characters.' },
            slug: { type: 'string', description: 'Optional short slug for the branded URL (e.g. "summer-sale"). Lowercase, no spaces. If omitted a random slug is generated.' },
            ...CREATE_ANYWAY_PROP,
          },
          ['destinationUrl', 'nickname'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const destinationUrl = String(input.destinationUrl ?? '').trim();
        const nickname = String(input.nickname ?? '').trim();
        const slug = String(input.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (!destinationUrl) return { error: 'A destination URL is required.' };
        try { new URL(destinationUrl); } catch { return { error: 'The destination URL is not valid.' }; }
        if (!nickname) return { error: 'A nickname is required.' };
        // Reject a slug that's already taken — slugs are globally unique
        // (short_links_slug_lower_idx), so the create would fail on confirm. This
        // is a hard constraint, so it stands even with createAnyway.
        if (slug) {
          const [slugTaken] = await db
            .select({ id: shortLinks.id })
            .from(shortLinks)
            .where(sql`lower(${shortLinks.slug}) = ${slug}`)
            .limit(1);
          if (slugTaken) return { error: `The slug "${slug}" is already taken — choose a different one.` };
        }
        // Unless the user already confirmed, surface a SIMILAR existing link — one
        // to the same destination, or with a similar nickname — so the model can
        // ask before creating a likely-duplicate.
        if (input.createAnyway !== true) {
          const brandLinks = await db
            .select({ id: shortLinks.id, slug: shortLinks.slug, nickname: shortLinks.nickname, destinationUrl: shortLinks.destinationUrl })
            .from(shortLinks)
            .where(eq(shortLinks.brandId, brandId))
            .limit(300);
          const destKey = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
          const newDest = destKey(destinationUrl);
          const sameDest = brandLinks.filter((l) => l.destinationUrl && destKey(l.destinationUrl) === newDest);
          const similarNick = findSimilarByName(nickname, brandLinks.map((l) => ({ id: l.id, name: l.nickname, slug: l.slug })));
          // Merge both signals, de-duped by id; label each with its nickname + slug.
          const byId = new Map<string, { id: string; name: string }>();
          for (const l of sameDest) byId.set(l.id, { id: l.id, name: `${l.nickname} (/${l.slug}) → ${l.destinationUrl}` });
          for (const l of similarNick) if (!byId.has(l.id)) byId.set(l.id, { id: l.id, name: `${l.name} (/${l.slug})` });
          const similar = [...byId.values()].slice(0, 5);
          if (similar.length) {
            return similarExistsResult('short link', similar, 'To edit an existing one instead, use update_short_link with its id.');
          }
        }
        pendingActions.push({
          kind: 'create_short_link',
          toolUseId,
          payload: { destinationUrl, nickname, ...(slug ? { slug } : {}) },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is created until they confirm.' };
      },
    },
    {
      def: {
        name: 'toggle_short_link',
        description: [
          'Propose activating or deactivating one of this brand\'s short links. Active links redirect visitors; inactive links do not. This surfaces a confirm card; the toggle only happens when the USER clicks confirm.',
          'ACTIVATING IS A PAID ACTION: active links are billed monthly per link. The tool computes the billing impact (the per-link price and the card that will be charged) and shows it on the confirm card — but YOU must also state it plainly in your reply, using the pricing-disclosure pattern from your instructions. Deactivating is free and REDUCES the monthly bill.',
          'Returns { status: "awaiting_confirmation", billing } on success — the card was shown, NOTHING is changed yet; billing restates the money impact so you can quote it. Never claim the link was toggled. On failure returns { error } (e.g. the link does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            linkId: { type: 'string', description: 'The short link\'s id (from list_short_links). Must belong to this brand.' },
            isActive: { type: 'boolean', description: 'true to activate, false to deactivate.' },
          },
          ['linkId', 'isActive'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const linkId = String(input.linkId ?? '');
        const isActive = input.isActive === true;
        const [link] = await db
          .select({ id: shortLinks.id, kind: shortLinks.kind, nickname: shortLinks.nickname, slug: shortLinks.slug, isActive: shortLinks.isActive })
          .from(shortLinks)
          .where(and(eq(shortLinks.id, linkId), eq(shortLinks.brandId, brandId)))
          .limit(1);
        if (!link) return { error: 'That short link does not belong to this brand.' };
        if (link.isActive === isActive) {
          return { error: `That ${link.kind} is already ${isActive ? 'active' : 'inactive'}.` };
        }
        // Activation is the billed action ($/active unit/month) — attach the live
        // billing context so the card (and the model) disclose the charge. The rate
        // depends on the KIND: campaigns bill higher than plain links.
        let billing: ActionBilling | null = null;
        let offerPriceId: string | null = null;
        if (isActive) {
          const ownerId = await brandOwnerId(db, brandId);
          const [offer, subscribed, card, exempt] = await Promise.all([
            getUrlShortenerOffer(db, link.kind),
            brandHasFeature(db, brandId, FEATURE_KEYS.URL_SHORTENER),
            getOwnerCardOnFile(db, brandId),
            ownerId ? isBetaUser(db, ownerId) : Promise.resolve(false),
          ]);
          offerPriceId = offer?.priceId ?? null;
          const unit = offer?.unitAmount ?? null;
          const currency = offer?.currency ?? 'AUD';
          const priceText = unit != null ? `$${unit.toFixed(2)} ${currency}/month` : 'the current per-link monthly rate';
          // An exempt owner is never billed — say "included on the plan", never
          // promise a charge that won't happen (and never name the exemption).
          billing = exempt
            ? {
                summary: "Activating this link is included on this brand's current plan — no additional charge.",
                monthlyDelta: null,
                currency,
                cardBrand: null,
                cardLast4: null,
                requiresCheckout: false,
              }
            : {
                summary: subscribed
                  ? `Activating this link adds ${priceText} to the existing Links subscription, charged to ${cardPhrase(card)}.`
                  : card
                    ? `Activating this link starts the Links subscription at ${priceText} per active link, charged to ${cardPhrase(card)}.`
                    : `Activating this link requires the Links subscription (${priceText} per active link). No card is on file, so Stripe Checkout will open to collect payment.`,
                monthlyDelta: unit,
                currency,
                cardBrand: card?.brand ?? null,
                cardLast4: card?.last4 ?? null,
                requiresCheckout: !subscribed,
              };
        } else {
          billing = {
            summary: 'Deactivating this link stops it redirecting and REDUCES the monthly Links bill by one active link.',
            monthlyDelta: null,
            currency: 'AUD',
            cardBrand: null,
            cardLast4: null,
            requiresCheckout: false,
          };
        }
        pendingActions.push({
          kind: 'toggle_short_link',
          toolUseId,
          payload: {
            linkId: link.id,
            slug: link.slug,
            nickname: link.nickname,
            isActive,
            billing,
            // For the confirm step's subscribe-then-enable path when the owner
            // isn't subscribed yet.
            priceId: offerPriceId,
          },
        });
        return {
          status: 'awaiting_confirmation',
          billing,
          note: `Confirm card surfaced to the user. The link is NOT ${isActive ? 'activated' : 'deactivated'} until they confirm. State the billing impact plainly in your reply.`,
        };
      },
    },
    {
      def: {
        name: 'update_short_link',
        description: [
          "Propose editing an existing short link's destination URL and/or nickname. This surfaces a confirm card; the change is only applied when the USER clicks confirm. Provide only the field(s) you want to change.",
          'Validation, or the call returns { error }: at least one of destinationUrl/nickname required; destinationUrl must be a valid URL; nickname must be non-empty. Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms.',
        ].join('\n'),
        input_schema: obj(
          {
            linkId: { type: 'string', description: 'The short link\'s id (from list_short_links). Must belong to this brand.' },
            destinationUrl: { type: 'string', description: 'New destination URL the link redirects to (must be a valid URL).' },
            nickname: { type: 'string', description: 'New user-facing label for the link (non-empty).' },
          },
          ['linkId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const linkId = String(input.linkId ?? '');
        const [link] = await db
          .select({ id: shortLinks.id, nickname: shortLinks.nickname, slug: shortLinks.slug, destinationUrl: shortLinks.destinationUrl })
          .from(shortLinks)
          .where(and(eq(shortLinks.id, linkId), eq(shortLinks.brandId, brandId)))
          .limit(1);
        if (!link) return { error: 'That short link does not belong to this brand.' };
        const payload: Record<string, unknown> = { linkId };
        const changes: Record<string, string> = {};
        if (input.destinationUrl !== undefined) {
          const v = String(input.destinationUrl ?? '').trim();
          try { new URL(v); } catch { return { error: 'The destination URL is not valid.' }; }
          payload.destinationUrl = v;
          changes['Destination URL'] = v;
        }
        if (input.nickname !== undefined) {
          const v = String(input.nickname ?? '').trim();
          if (!v) return { error: 'The nickname cannot be empty.' };
          payload.nickname = v;
          changes['Nickname'] = v;
        }
        if (Object.keys(changes).length === 0) return { error: 'Provide destinationUrl and/or nickname to change.' };
        pendingActions.push({ kind: 'update_short_link', toolUseId, payload: { ...payload, slug: link.slug, changes } });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'list_link_campaigns',
        description: [
          "List THIS brand's link CAMPAIGNS. A campaign is a short link whose destination CHANGES BY DATE: it has a set of scheduled windows, plus a fallback used whenever no window is running. Takes no arguments. Capped at 30 rows, newest first.",
          'Returns { count, campaigns } where campaigns is an array of:',
          '- id: campaign UUID (pass as campaignId to the campaign tools).',
          '- slug: the short URL slug — this never changes, which is the point (print it once).',
          '- nickname: user-facing label.',
          '- isActive: boolean — whether the campaign is live (redirecting). Inactive campaigns are not billed.',
          '- nowServing: what a visitor hitting the link RIGHT NOW gets — { type: "redirect", url, windowLabel } or { type: "message", text }.',
          '- fallback: the default outside every window — { type: "url", url } or { type: "message", text }.',
          '- windows: array of { id, label, destinationUrl, startsAt, endsAt } (ISO timestamps), earliest start first.',
          '- nextChangeAt: ISO timestamp when the served destination next changes, or null if nothing is scheduled ahead.',
          '- clickCount: INTEGER all-time clicks.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        // Shared query core (also backs tRPC linkCampaigns.list) — the "now
        // serving" value is the same resolution the redirector computes.
        const { items } = await listCampaignsWithSchedule(db, brandId, { limit: 30 });
        return {
          count: items.length,
          campaigns: items.map((c) => ({
            id: c.id,
            slug: c.slug,
            nickname: c.nickname,
            isActive: c.isActive,
            nowServing:
              c.current?.type === 'text'
                ? { type: 'message', text: c.current.text }
                : c.current
                  ? { type: 'redirect', url: c.current.url, windowLabel: c.current.label }
                  : null,
            fallback: c.fallbackText
              ? { type: 'message', text: c.fallbackText }
              : { type: 'url', url: c.destinationUrl },
            windows: [...c.windows]
              .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
              .map((w) => ({
                id: w.id,
                label: w.label,
                destinationUrl: w.destinationUrl,
                startsAt: w.startsAt,
                endsAt: w.endsAt,
              })),
            nextChangeAt: c.nextChangeAt,
            clickCount: Number(c.clickCount),
          })),
        };
      },
    },
    {
      def: {
        name: 'create_link_campaign',
        description: [
          'Propose creating a link CAMPAIGN — a short link whose destination changes on a schedule. Use this when the user wants ONE printed link/QR that points to different places on different dates (e.g. a poster that shows a New Year offer on 1 Jan and a generic page the rest of the year). For a fixed destination use create_short_link instead.',
          'The campaign is created INACTIVE (not redirecting) and is FREE to create — the user activates it from the Campaigns dashboard, and ACTIVATING is what bills (campaigns cost MORE per month than plain short links; call list_feature_subscriptions for the live rate before quoting one). This surfaces a confirm card; nothing is created until the USER clicks confirm.',
          'A campaign needs a FALLBACK for the time outside every window — exactly one of: fallbackUrl (send visitors somewhere) or fallbackText (show them a plain message like "No promotions right now"). Ask the user which they want if it is not obvious; do not invent a URL.',
          'Validation, or the call returns { error }: nickname required; exactly one of fallbackUrl/fallbackText (fallbackUrl must be a valid URL); each window needs a valid destinationUrl and endsAt after startsAt; a supplied slug must be free (slugs are globally unique across links AND campaigns).',
          'Returns { status: "awaiting_confirmation" } on success — never claim the campaign exists yet.',
          'DUPLICATE GUARD: if this brand already has a SIMILAR campaign (similar nickname), returns { status: "similar_exists", similar } — do NOT create; show the user what exists and ask whether to add a new one anyway (re-call with createAnyway: true) or edit the existing one (update_link_campaign / add_campaign_window).',
        ].join('\n'),
        input_schema: obj(
          {
            nickname: { type: 'string', description: 'A user-facing label for the campaign (e.g. "Front window poster"). 1+ characters.' },
            slug: { type: 'string', description: 'Optional short slug for the branded URL (e.g. "promo"). Lowercase, no spaces. If omitted a random slug is generated. This is what gets printed, so prefer something short and stable.' },
            fallbackUrl: { type: 'string', description: 'Where visitors go when NO scheduled window is running. Mutually exclusive with fallbackText.' },
            fallbackText: { type: 'string', description: 'Plain message shown (instead of redirecting) when no window is running, e.g. "No promotions available right now". Max 500 characters. Mutually exclusive with fallbackUrl.' },
            windows: {
              type: 'array',
              description: 'The scheduled destination overrides. Optional — a campaign with none always serves its fallback, and windows can be added later with add_campaign_window.',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Optional name for this window, e.g. "Happy New Year".' },
                  destinationUrl: { type: 'string', description: 'Where the link sends visitors while this window is running (must be a valid URL).' },
                  startsAt: { type: 'string', description: 'ISO date/time the window starts, e.g. "2027-01-01T00:00:00Z". Inclusive.' },
                  endsAt: { type: 'string', description: 'ISO date/time the window ends, e.g. "2027-01-02T00:00:00Z". Exclusive, and must be after startsAt.' },
                },
                required: ['destinationUrl', 'startsAt', 'endsAt'],
              },
            },
            ...CREATE_ANYWAY_PROP,
          },
          ['nickname'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const nickname = String(input.nickname ?? '').trim();
        if (!nickname) return { error: 'A campaign label (nickname) is required.' };
        const slug = String(input.slug ?? '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');

        const fallbackUrl = String(input.fallbackUrl ?? '').trim();
        const fallbackText = String(input.fallbackText ?? '').trim();
        if (fallbackUrl && fallbackText) {
          return { error: 'Give either a fallback URL or fallback text, not both.' };
        }
        if (!fallbackUrl && !fallbackText) {
          return {
            error:
              'A campaign needs a fallback for the dates no window covers: either fallbackUrl (send visitors somewhere) or fallbackText (show a message). Ask the user which they want.',
          };
        }
        if (fallbackUrl) {
          try { new URL(fallbackUrl); } catch { return { error: 'The fallback URL is not valid.' }; }
        }
        if (fallbackText.length > 500) {
          return { error: 'The fallback message must be 500 characters or fewer.' };
        }

        // Validate every window up front — the confirm card creates the campaign
        // and its whole schedule in one transaction, so a bad row must not get in.
        const rawWindows = Array.isArray(input.windows) ? input.windows : [];
        const windows: { label: string | null; destinationUrl: string; startsAt: string; endsAt: string }[] = [];
        for (const [i, raw] of rawWindows.entries()) {
          const w = (raw ?? {}) as Record<string, unknown>;
          const url = String(w.destinationUrl ?? '').trim();
          try { new URL(url); } catch { return { error: `Window ${i + 1}: the destination URL is not valid.` }; }
          const start = new Date(String(w.startsAt ?? ''));
          const end = new Date(String(w.endsAt ?? ''));
          if (Number.isNaN(start.getTime())) return { error: `Window ${i + 1}: startsAt is not a valid date/time.` };
          if (Number.isNaN(end.getTime())) return { error: `Window ${i + 1}: endsAt is not a valid date/time.` };
          if (end <= start) return { error: `Window ${i + 1}: endsAt must be after startsAt.` };
          windows.push({
            label: w.label ? String(w.label).trim() : null,
            destinationUrl: url,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
          });
        }

        // A taken slug is a hard constraint (short_links_slug_lower_idx is global
        // across links AND campaigns), so it stands even with createAnyway.
        if (slug) {
          const [taken] = await db
            .select({ id: shortLinks.id })
            .from(shortLinks)
            .where(sql`lower(${shortLinks.slug}) = ${slug}`)
            .limit(1);
          if (taken) return { error: `The slug "${slug}" is already taken — choose a different one.` };
        }

        if (input.createAnyway !== true) {
          const existing = await db
            .select({ id: shortLinks.id, name: shortLinks.nickname, slug: shortLinks.slug })
            .from(shortLinks)
            .where(and(eq(shortLinks.brandId, brandId), eq(shortLinks.kind, 'campaign')))
            .limit(300);
          const similar = findSimilarByName(nickname, existing);
          if (similar.length) {
            return similarExistsResult('link campaign', similar, 'To change an existing one instead, use update_link_campaign or add_campaign_window with its id.');
          }
        }

        pendingActions.push({
          kind: 'create_link_campaign',
          toolUseId,
          payload: {
            nickname,
            ...(slug ? { slug } : {}),
            ...(fallbackUrl ? { fallbackUrl } : { fallbackText }),
            windows,
            changes: {
              Label: nickname,
              ...(slug ? { Ending: `/${slug}` } : {}),
              'Between windows': fallbackUrl ? fallbackUrl : `Message: ${fallbackText}`,
              Windows: windows.length
                ? windows
                    .map((w) => `${w.label ? w.label + ': ' : ''}${w.destinationUrl} (${w.startsAt} → ${w.endsAt})`)
                    .join('\n')
                : 'None yet',
            },
          },
        });
        return {
          status: 'awaiting_confirmation',
          note: 'Confirm card surfaced to the user. Nothing is created until they confirm. The campaign is created switched OFF and is free until they activate it.',
        };
      },
    },
    {
      def: {
        name: 'update_link_campaign',
        description: [
          "Propose editing a CAMPAIGN's label and/or its FALLBACK — what visitors get on the dates no scheduled window covers. To change the schedule itself use add_campaign_window / remove_campaign_window. This surfaces a confirm card; nothing changes until the USER clicks confirm.",
          'The fallback is exactly one of the two modes, so passing fallbackUrl switches it to redirecting (clearing any message) and passing fallbackText switches it to showing a message (clearing the URL). Read list_link_campaigns first so you keep whichever mode the user actually wants.',
          'Validation, or the call returns { error }: the campaign must belong to this brand; at least one of nickname/fallbackUrl/fallbackText; not both fallback fields; fallbackUrl must be a valid URL; fallbackText max 500 characters.',
        ].join('\n'),
        input_schema: obj(
          {
            campaignId: { type: 'string', description: 'The campaign id (from list_link_campaigns). Must belong to this brand.' },
            nickname: { type: 'string', description: 'New user-facing label for the campaign (non-empty).' },
            fallbackUrl: { type: 'string', description: 'New fallback destination for dates no window covers. Mutually exclusive with fallbackText.' },
            fallbackText: { type: 'string', description: 'New fallback MESSAGE shown instead of redirecting on dates no window covers. Mutually exclusive with fallbackUrl.' },
          },
          ['campaignId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const campaignId = String(input.campaignId ?? '');
        const [c] = await db
          .select({ id: shortLinks.id, slug: shortLinks.slug, nickname: shortLinks.nickname })
          .from(shortLinks)
          .where(and(eq(shortLinks.id, campaignId), eq(shortLinks.brandId, brandId), eq(shortLinks.kind, 'campaign')))
          .limit(1);
        if (!c) return { error: 'That campaign does not belong to this brand.' };

        const payload: Record<string, unknown> = { campaignId };
        const changes: Record<string, string> = {};

        if (input.nickname !== undefined) {
          const v = String(input.nickname ?? '').trim();
          if (!v) return { error: 'The label cannot be empty.' };
          payload.nickname = v;
          changes['Label'] = v;
        }
        const fallbackUrl = input.fallbackUrl !== undefined ? String(input.fallbackUrl ?? '').trim() : null;
        const fallbackText = input.fallbackText !== undefined ? String(input.fallbackText ?? '').trim() : null;
        if (fallbackUrl && fallbackText) {
          return { error: 'Give either a fallback URL or fallback text, not both.' };
        }
        if (fallbackUrl) {
          try { new URL(fallbackUrl); } catch { return { error: 'The fallback URL is not valid.' }; }
          payload.fallbackUrl = fallbackUrl;
          changes['Between windows'] = fallbackUrl;
        } else if (fallbackText) {
          if (fallbackText.length > 500) return { error: 'The fallback message must be 500 characters or fewer.' };
          payload.fallbackText = fallbackText;
          changes['Between windows'] = `Message: ${fallbackText}`;
        }

        if (Object.keys(changes).length === 0) {
          return { error: 'Provide nickname, fallbackUrl, and/or fallbackText to change.' };
        }
        pendingActions.push({
          kind: 'update_link_campaign',
          toolUseId,
          payload: { ...payload, slug: c.slug, changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'add_campaign_window',
        description: [
          'Propose adding ONE scheduled destination window to an existing campaign — "between these dates, send visitors here instead of the fallback". This surfaces a confirm card; nothing is added until the USER clicks confirm. Free: adding windows never changes the bill (only activating the campaign does).',
          'Windows MAY overlap. When two cover the same instant, the one that STARTED most recently wins — so a short promo inside a longer one takes precedence for its dates, which is usually what the user means. Mention this if their dates overlap.',
          'Validation, or the call returns { error }: the campaign must belong to this brand; destinationUrl must be a valid URL; endsAt must be after startsAt.',
        ].join('\n'),
        input_schema: obj(
          {
            campaignId: { type: 'string', description: 'The campaign id (from list_link_campaigns). Must belong to this brand.' },
            label: { type: 'string', description: 'Optional name for the window, e.g. "Happy New Year".' },
            destinationUrl: { type: 'string', description: 'Where the link sends visitors while this window is running (must be a valid URL).' },
            startsAt: { type: 'string', description: 'ISO date/time the window starts (inclusive), e.g. "2027-01-01T00:00:00Z".' },
            endsAt: { type: 'string', description: 'ISO date/time the window ends (exclusive), e.g. "2027-01-02T00:00:00Z". Must be after startsAt.' },
          },
          ['campaignId', 'destinationUrl', 'startsAt', 'endsAt'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const campaignId = String(input.campaignId ?? '');
        const [c] = await db
          .select({ id: shortLinks.id, slug: shortLinks.slug, nickname: shortLinks.nickname })
          .from(shortLinks)
          .where(and(eq(shortLinks.id, campaignId), eq(shortLinks.brandId, brandId), eq(shortLinks.kind, 'campaign')))
          .limit(1);
        if (!c) return { error: 'That campaign does not belong to this brand.' };

        const destinationUrl = String(input.destinationUrl ?? '').trim();
        try { new URL(destinationUrl); } catch { return { error: 'The destination URL is not valid.' }; }
        const start = new Date(String(input.startsAt ?? ''));
        const end = new Date(String(input.endsAt ?? ''));
        if (Number.isNaN(start.getTime())) return { error: 'startsAt is not a valid date/time.' };
        if (Number.isNaN(end.getTime())) return { error: 'endsAt is not a valid date/time.' };
        if (end <= start) return { error: 'endsAt must be after startsAt.' };

        const label = input.label ? String(input.label).trim() : '';
        pendingActions.push({
          kind: 'add_campaign_window',
          toolUseId,
          payload: {
            campaignId,
            slug: c.slug,
            ...(label ? { label } : {}),
            destinationUrl,
            startsAt: start.toISOString(),
            endsAt: end.toISOString(),
            changes: {
              Campaign: `${c.nickname} (/${c.slug})`,
              ...(label ? { Window: label } : {}),
              Destination: destinationUrl,
              From: start.toISOString(),
              Until: end.toISOString(),
            },
          },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is added until they confirm.' };
      },
    },
    {
      def: {
        name: 'remove_campaign_window',
        description: [
          "Propose removing ONE scheduled window from a campaign. Those dates fall back to the campaign's default instead. This surfaces a confirm card; nothing is removed until the USER clicks confirm.",
          'Get windowId from list_link_campaigns (each campaign lists its windows with their ids). Validation, or the call returns { error }: the window must belong to a campaign of THIS brand.',
        ].join('\n'),
        input_schema: obj(
          {
            windowId: { type: 'string', description: "The window's id, from the `windows` array in list_link_campaigns." },
          },
          ['windowId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const windowId = String(input.windowId ?? '');
        // Join back to the campaign so a window from ANOTHER brand can't be
        // targeted by guessing an id.
        const [row] = await db
          .select({
            id: linkDestinationWindows.id,
            label: linkDestinationWindows.label,
            destinationUrl: linkDestinationWindows.destinationUrl,
            startsAt: linkDestinationWindows.startsAt,
            endsAt: linkDestinationWindows.endsAt,
            slug: shortLinks.slug,
            nickname: shortLinks.nickname,
          })
          .from(linkDestinationWindows)
          .innerJoin(shortLinks, eq(linkDestinationWindows.linkId, shortLinks.id))
          .where(and(eq(linkDestinationWindows.id, windowId), eq(shortLinks.brandId, brandId)))
          .limit(1);
        if (!row) return { error: 'That window does not belong to a campaign of this brand.' };

        pendingActions.push({
          kind: 'remove_campaign_window',
          toolUseId,
          payload: {
            windowId,
            slug: row.slug,
            changes: {
              Campaign: `${row.nickname} (/${row.slug})`,
              Removing: `${row.label ? row.label + ': ' : ''}${row.destinationUrl}`,
              From: row.startsAt,
              Until: row.endsAt,
            },
          },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is removed until they confirm.' };
      },
    },
    {
      def: {
        name: 'update_link_qr_style',
        description: [
          "Propose restyling the QR code of ONE of this brand's short links (colours, embedded logo, corner/dot shape). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Provide only the style fields you want to change — the rest are kept as-is.",
          'Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. On failure returns { error } (e.g. an invalid colour or the link does not belong to this brand).',
        ].join('\n'),
        input_schema: obj(
          {
            linkId: { type: 'string', description: 'The short link\'s id (from list_short_links). Must belong to this brand.' },
            foregroundColor: { type: 'string', description: 'QR foreground (module) colour as a 6-digit hex, e.g. "#111827".' },
            backgroundColor: { type: 'string', description: 'QR background colour as a 6-digit hex, e.g. "#ffffff".' },
            logoUrl: { type: 'string', description: 'URL of a logo image to place at the QR centre. Empty string to remove the logo.' },
            cornerStyle: { type: 'string', description: 'Finder/eye corner style.', enum: [...QR_CORNER_STYLES] },
            dotStyle: { type: 'string', description: 'Body dot style.', enum: [...QR_DOT_STYLES] },
          },
          ['linkId'],
        ),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const linkId = String(input.linkId ?? '');
        const [link] = await db
          .select({ id: shortLinks.id, nickname: shortLinks.nickname, slug: shortLinks.slug, qrConfig: shortLinks.qrConfig })
          .from(shortLinks)
          .where(and(eq(shortLinks.id, linkId), eq(shortLinks.brandId, brandId)))
          .limit(1);
        if (!link) return { error: 'That short link does not belong to this brand.' };
        const merged = mergeQrConfig(link.qrConfig as QrConfig | null, input);
        if ('error' in merged) return { error: merged.error };
        pendingActions.push({
          kind: 'update_qr_style',
          toolUseId,
          payload: { scope: 'link', linkId, linkNickname: link.nickname ?? link.slug, qrConfig: merged.config, changes: merged.changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'set_default_qr_style',
        description: [
          "Propose setting THIS brand's DEFAULT QR-code design — the style applied to newly created short-link QR codes (does not restyle existing links). This surfaces a confirm card; the change is only applied when the USER clicks confirm. Read get_default_qr_style first; provide only the fields you want to change.",
          'Returns { status: "awaiting_confirmation" } on success — nothing changes until the user confirms. On failure returns { error }.',
        ].join('\n'),
        input_schema: obj({
          foregroundColor: { type: 'string', description: 'Default QR foreground colour as a 6-digit hex.' },
          backgroundColor: { type: 'string', description: 'Default QR background colour as a 6-digit hex.' },
          logoUrl: { type: 'string', description: 'Default centre logo image URL. Empty string to clear.' },
          cornerStyle: { type: 'string', description: 'Default corner style.', enum: [...QR_CORNER_STYLES] },
          dotStyle: { type: 'string', description: 'Default dot style.', enum: [...QR_DOT_STYLES] },
        }),
      },
      run: async (input: Record<string, unknown>, toolUseId: string) => {
        const cfg = await getBrandDefaultQrConfig(db, brandId);
        const merged = mergeQrConfig(cfg as QrConfig | null, input);
        if ('error' in merged) return { error: merged.error };
        pendingActions.push({
          kind: 'update_qr_style',
          toolUseId,
          payload: { scope: 'default', qrConfig: merged.config, changes: merged.changes },
        });
        return { status: 'awaiting_confirmation', note: 'Confirm card surfaced to the user. Nothing is changed until they confirm.' };
      },
    },
    {
      def: {
        name: 'get_default_qr_style',
        description: [
          "Get THIS brand's default QR-code design — the style applied to new short-link QR codes. Takes no arguments.",
          'Returns { qrConfig } where qrConfig is null if no default has been set, otherwise an object with any of: foregroundColor (hex), backgroundColor (hex), logoUrl, cornerStyle ("square"|"rounded"|"dots"|"dot"|"extra-rounded"), dotStyle ("square"|"rounded"|"dots"|"classy"). To read a single link\'s QR design instead, note list_short_links returns the links themselves.',
        ].join('\n'),
        input_schema: obj({}),
      },
      run: async () => {
        return { qrConfig: await getBrandDefaultQrConfig(db, brandId) };
      },
    },
  ];
}
