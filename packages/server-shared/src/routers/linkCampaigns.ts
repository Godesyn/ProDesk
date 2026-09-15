/**
 * Link campaigns — a short link whose destination CHANGES ON A SCHEDULE.
 *
 * A campaign is a `short_links` row with kind='campaign', so it shares the whole
 * short-link pipeline: one globally-unique slug, the same QR styling, the same
 * click analytics, the same activate-to-bill gate. What it adds is a set of
 * `link_destination_windows` — dated overrides of the campaign's DEFAULT
 * destination. Outside every window a visitor gets the default: either a fallback
 * URL, or a plain-text message shown instead of redirecting ("No promotions right
 * now"). Exactly one of those two must be set.
 *
 * Campaigns bill at their own higher per-unit rate ($3 vs $1), which is simply a
 * second tier of the same URL-shortener product — activation stamps that tier's
 * price onto `billedPriceId` and the existing per-unit sync meters it as its own
 * Stripe item. Creating a campaign is FREE; the gate is on ENABLING it, exactly
 * like plain links (see shortLinks.toggleActive).
 *
 * Slug creation, toggling, deletion, QR styling and analytics all stay on the
 * `shortLinks` router — this router owns only the campaign-shaped extras: the
 * scheduled-destination default and the windows themselves.
 */
import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { linkDestinationWindows, shortLinks } from '../db/schema.js';
import { assertBrandAccess, assertBrandAccessAny } from '../trpc/permissions.js';
import { brandOwnerId } from '../modules/feature-subscriptions/entitlements.js';
import {
  countOwnerActiveLinks,
  getUrlShortenerOffer,
  syncUrlShortenerQuantity,
} from '../modules/feature-subscriptions/per-unit.js';
import {
  listCampaignsWithSchedule,
  windowsByLink,
} from '../modules/short-links/queries.js';
import {
  generateUniqueSlug,
  slugFormatIssue,
  slugTaken,
} from '../modules/short-links/slug.js';
import {
  activeWindow,
  nextScheduleChange,
  resolveCampaignDestination,
} from '../modules/short-links/campaign-schedule.js';

/** Read access: either the editor (`links`) or read-only (`linksViewer`) staff. */
const LINKS_READ = ['links', 'linksViewer'] as const;

/**
 * The campaign DEFAULT: a fallback URL, or text to display instead of
 * redirecting. Exactly one — both would be ambiguous, neither leaves nothing to
 * serve outside the windows (and violates short_links_destination_ck).
 */
const fallbackSchema = z
  .object({
    fallbackUrl: z.string().url().nullable().optional(),
    fallbackText: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine(
    (v) => !(v.fallbackUrl && v.fallbackText),
    'Give either a fallback URL or fallback text, not both.',
  );

const windowInputSchema = z
  .object({
    label: z.string().trim().max(120).nullable().optional(),
    destinationUrl: z.string().url(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .refine((v) => v.endsAt > v.startsAt, 'The window must end after it starts.');

/**
 * Load a campaign and gate access on its brand. `write` picks the editor
 * permission; reads accept the viewer role too. Throws NOT_FOUND for a missing
 * row, another brand's row, or a plain link (so campaign procedures can never be
 * aimed at a non-campaign).
 */
async function loadCampaign(
  ctx: Parameters<typeof assertBrandAccess>[0],
  id: string,
  write: boolean,
) {
  const [row] = await ctx.db
    .select()
    .from(shortLinks)
    .where(eq(shortLinks.id, id))
    .limit(1);
  if (!row || row.kind !== 'campaign') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Campaign not found' });
  }
  if (write) await assertBrandAccess(ctx, row.brandId, 'links');
  else await assertBrandAccessAny(ctx, row.brandId, LINKS_READ);
  return row;
}

/** Resolve a window id to its campaign, gating on the campaign's brand. */
async function loadWindow(
  ctx: Parameters<typeof assertBrandAccess>[0],
  windowId: string,
) {
  const [win] = await ctx.db
    .select()
    .from(linkDestinationWindows)
    .where(eq(linkDestinationWindows.id, windowId))
    .limit(1);
  if (!win) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Window not found' });
  }
  const campaign = await loadCampaign(ctx, win.linkId, true);
  return { win, campaign };
}

export const linkCampaignsRouter = router({
  /**
   * The brand's campaigns, each with its windows and the destination it serves
   * RIGHT NOW — resolved through the shared schedule rule the redirector uses, so
   * the dashboard can't disagree with what visitors actually get.
   */
  list: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        search: z.string().trim().optional(),
        isActive: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      return listCampaignsWithSchedule(ctx.db, input.brandId, {
        search: input.search,
        isActive: input.isActive,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  /** One campaign with its full schedule, for the detail screen. */
  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const campaign = await loadCampaign(ctx, input.id, false);
      const windows = await ctx.db
        .select()
        .from(linkDestinationWindows)
        .where(eq(linkDestinationWindows.linkId, campaign.id))
        .orderBy(asc(linkDestinationWindows.startsAt));
      const now = new Date();
      return {
        ...campaign,
        windows,
        current: resolveCampaignDestination(campaign, windows, now),
        activeWindowId: activeWindow(windows, now)?.id ?? null,
        nextChangeAt: nextScheduleChange(windows, now),
      };
    }),

  /**
   * Create a campaign. Like a plain link it is created INACTIVE and FREE — the
   * $3/month charge starts only when the user switches it on
   * (shortLinks.toggleActive), which is where the entitlement gate lives.
   *
   * Windows can be supplied up front or added later; a campaign with none simply
   * always serves its default.
   */
  create: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        // Omit to have one generated — the AI tool and the UI's "automatic
        // ending" mode both rely on that.
        slug: z.string().trim().toLowerCase().optional(),
        nickname: z.string().trim().min(1),
        windows: z.array(windowInputSchema).max(50).default([]),
        qrConfig: z.record(z.string(), z.unknown()).optional(),
      }).and(fallbackSchema),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'links');
      if (!input.fallbackUrl && !input.fallbackText) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'A campaign needs a fallback: either a URL to send visitors to, or text to show them, outside its scheduled windows.',
        });
      }

      // Slug format + global uniqueness are the short-link rules — campaigns
      // share ONE slug namespace with plain links (the redirector resolves a bare
      // /:slug without knowing the kind).
      let slug = input.slug;
      if (slug) {
        const issue = slugFormatIssue(slug);
        if (issue) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Slug: ${issue}` });
        }
        if (await slugTaken(ctx.db, slug)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Slug already in use' });
        }
      } else {
        slug = await generateUniqueSlug(ctx.db);
      }

      // Insert the campaign and its windows together: a half-created campaign
      // (rows but no schedule, or vice versa) would serve the wrong destination.
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(shortLinks)
          .values({
            brandId: input.brandId,
            kind: 'campaign',
            slug,
            destinationUrl: input.fallbackUrl ?? null,
            fallbackText: input.fallbackText ?? null,
            nickname: input.nickname,
            qrConfig: (input.qrConfig ?? {}) as typeof shortLinks.$inferInsert.qrConfig,
            isActive: false,
            disabledAt: new Date(),
            createdByUserId: ctx.user.id,
          })
          .returning();

        if (input.windows.length) {
          await tx.insert(linkDestinationWindows).values(
            input.windows.map((w) => ({
              linkId: row.id,
              label: w.label ?? null,
              destinationUrl: w.destinationUrl,
              startsAt: w.startsAt,
              endsAt: w.endsAt,
              createdByUserId: ctx.user.id,
            })),
          );
        }
        return row;
      });
    }),

  /**
   * Edit a campaign's default destination (and/or its label). Passing
   * `fallbackUrl` switches it to redirect mode and clears the text; passing
   * `fallbackText` does the reverse — a campaign is always exactly one of the two.
   * Slug and QR edits stay on shortLinks.update.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        nickname: z.string().trim().min(1).optional(),
      }).and(fallbackSchema),
    )
    .mutation(async ({ ctx, input }) => {
      const campaign = await loadCampaign(ctx, input.id, true);

      const patch: Partial<typeof shortLinks.$inferInsert> = {};
      if (input.nickname !== undefined) patch.nickname = input.nickname;
      // The two fallback modes are mutually exclusive, so setting one always
      // clears the other — otherwise a stale value would resurface if the user
      // later cleared the new one.
      if (input.fallbackUrl !== undefined && input.fallbackUrl !== null) {
        patch.destinationUrl = input.fallbackUrl;
        patch.fallbackText = null;
      } else if (input.fallbackText !== undefined && input.fallbackText !== null) {
        patch.fallbackText = input.fallbackText;
        patch.destinationUrl = null;
      }
      if (Object.keys(patch).length === 0) return campaign;

      // Never leave a campaign with nothing to serve outside its windows (the
      // check constraint would reject it anyway — this is the friendly error).
      const nextUrl = patch.destinationUrl ?? (patch.fallbackText ? null : campaign.destinationUrl);
      const nextText = patch.fallbackText ?? (patch.destinationUrl ? null : campaign.fallbackText);
      if (!nextUrl && !nextText) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A campaign must keep either a fallback URL or fallback text.',
        });
      }

      const [row] = await ctx.db
        .update(shortLinks)
        .set(patch)
        .where(eq(shortLinks.id, campaign.id))
        .returning();
      return row;
    }),

  /* ── Destination windows ────────────────────────────────────────────────── */

  /** Add a dated destination override to a campaign. */
  addWindow: protectedProcedure
    .input(z.object({ campaignId: z.string().uuid() }).and(windowInputSchema))
    .mutation(async ({ ctx, input }) => {
      const campaign = await loadCampaign(ctx, input.campaignId, true);
      const [row] = await ctx.db
        .insert(linkDestinationWindows)
        .values({
          linkId: campaign.id,
          label: input.label ?? null,
          destinationUrl: input.destinationUrl,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdByUserId: ctx.user.id,
        })
        .returning();
      return row;
    }),

  /** Edit one window. Only the fields provided change. */
  updateWindow: protectedProcedure
    .input(
      z.object({
        windowId: z.string().uuid(),
        label: z.string().trim().max(120).nullable().optional(),
        destinationUrl: z.string().url().optional(),
        startsAt: z.coerce.date().optional(),
        endsAt: z.coerce.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { win } = await loadWindow(ctx, input.windowId);

      // Validate the resulting range, not just the supplied half — moving only
      // `startsAt` past a fixed `endsAt` is the easy way to invert a window.
      const startsAt = input.startsAt ?? win.startsAt;
      const endsAt = input.endsAt ?? win.endsAt;
      if (endsAt <= startsAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'The window must end after it starts.',
        });
      }

      const [row] = await ctx.db
        .update(linkDestinationWindows)
        .set({
          label: input.label,
          destinationUrl: input.destinationUrl,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
        })
        .where(eq(linkDestinationWindows.id, win.id))
        .returning();
      return row;
    }),

  /** Remove a window. The campaign falls back to its default for those dates. */
  removeWindow: protectedProcedure
    .input(z.object({ windowId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { win } = await loadWindow(ctx, input.windowId);
      await ctx.db
        .delete(linkDestinationWindows)
        .where(eq(linkDestinationWindows.id, win.id));
      return { id: win.id };
    }),

  /**
   * What this campaign resolves to at an arbitrary instant — the "preview the
   * schedule" control on the detail screen. Runs the same pure resolver the
   * redirector uses, so the preview is the real answer rather than a guess.
   */
  preview: protectedProcedure
    .input(z.object({ id: z.string().uuid(), at: z.coerce.date() }))
    .query(async ({ ctx, input }) => {
      const campaign = await loadCampaign(ctx, input.id, false);
      const windows = (await windowsByLink(ctx.db, [campaign.id])).get(campaign.id) ?? [];
      return {
        at: input.at,
        resolution: resolveCampaignDestination(campaign, windows, input.at),
        activeWindowId: activeWindow(windows, input.at)?.id ?? null,
      };
    }),

  /**
   * The live campaign RATE for the paywall/confirm UI: what switching one on costs
   * per month. Separate from shortLinks.entitlement (which covers the whole links
   * workspace) so the campaigns screen can quote its own price without assuming it.
   */
  pricing: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      const offer = await getUrlShortenerOffer(ctx.db, 'campaign');
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      return {
        unitAmount: offer?.unitAmount ?? null,
        currency: offer?.currency ?? 'AUD',
        priceId: offer?.priceId ?? null,
        // Billing is OWNER-scoped (one subscription spans every brand they own),
        // so the billable count is the owner's active campaigns — counted through
        // countOwnerActiveLinks rather than an ad-hoc query, which is how this
        // previously ended up unscoped and counting every brand's campaigns.
        activeCount: ownerId
          ? await countOwnerActiveLinks(ctx.db, ownerId, 'campaign')
          : 0,
      };
    }),

  /**
   * Delete a campaign outright (its windows cascade). Kept here rather than
   * reusing shortLinks.remove so the campaigns screen has a symmetric API — the
   * billing quantity resync is identical.
   */
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const campaign = await loadCampaign(ctx, input.id, true);
      await ctx.db.delete(shortLinks).where(eq(shortLinks.id, campaign.id));
      const ownerId = await brandOwnerId(ctx.db, campaign.brandId);
      if (ownerId) await syncUrlShortenerQuantity(ctx.db, ownerId);
      return { id: campaign.id };
    }),
});
