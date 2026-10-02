import { z } from 'zod';
import { httpUrl } from '../lib/http-url.js';
import { and, arrayContains, eq, or, desc, sql, count, countDistinct, gte, type AnyColumn, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import {
  shortLinks,
  SHORT_LINK_KINDS,
  linkEvents,
  brands,
  users,
  featureSubscriptions,
  featureSubscriptionProducts,
  featureSubscriptionPrices,
} from '../db/schema.js';
import { env } from '../lib/env.js';
import { assertBrandAccess, assertBrandAccessAny } from '../trpc/permissions.js';
import {
  brandOwnerId,
  isBetaUser,
  userHasFeature,
} from '../modules/feature-subscriptions/entitlements.js';
import {
  countOwnerActiveLinks,
  getOwnerUrlSubscription,
  getUrlShortenerOffer,
  syncUrlShortenerQuantity,
} from '../modules/feature-subscriptions/per-unit.js';
import { FEATURE_KEYS } from '../modules/feature-subscriptions/feature-keys.js';
import { stripe } from '../modules/stripe/client.js';
import { retrieveCustomerOrNull } from '../modules/stripe/customer.js';
import { ensureStripeCustomerForUser } from '../modules/feature-subscriptions/stripe.js';
import {
  getBrandDefaultQrConfig,
  getLinkAnalytics,
  listShortLinks,
} from '../modules/short-links/queries.js';

// Keyset cursor helpers live in the shared query module now; re-exported here so
// the pagination unit test (and any existing importer) keeps its import path.
export { encodeCursor, decodeCursor } from '../modules/short-links/queries.js';
import {
  generateUniqueSlug,
  RESERVED_SLUGS,
  SLUG_REGEX,
} from '../modules/short-links/slug.js';

/** Read access: either the editor (`links`) or read-only (`linksViewer`) staff. */
const LINKS_READ = ['links', 'linksViewer'] as const;

// Slug rules live in modules/short-links/slug.ts — one global namespace shared
// with campaigns, so both routers validate identically.
const slugRegex = SLUG_REGEX;
const reservedSlugs = RESERVED_SLUGS;

const qrConfigSchema = z.object({
  logoUrl: z.string().url().optional(),
  foregroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  cornerStyle: z.enum(['square', 'rounded', 'dots', 'dot', 'extra-rounded']).optional(),
  dotStyle: z.enum(['square', 'rounded', 'dots', 'classy']).optional(),
});

/**
 * The brand owner's URL-shortener feature subscription's Stripe ids (most recent
 * match, regardless of status — past invoices of a cancelled sub still count).
 * Filtering invoices by this subscription id is what keeps the Billing invoices
 * list to ONLY short-link charges. Null when none / no Stripe ids.
 */
async function ownerUrlStripeSub(
  db: Parameters<typeof assertBrandAccess>[0]['db'],
  ownerId: string,
): Promise<{ stripeSubscriptionId: string | null; stripeCustomerId: string | null } | null> {
  const [row] = await db
    .select({
      stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
      stripeCustomerId: featureSubscriptions.stripeCustomerId,
    })
    .from(featureSubscriptions)
    .innerJoin(
      featureSubscriptionProducts,
      eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
    )
    .where(
      and(
        eq(featureSubscriptions.userId, ownerId),
        // The URL-shortener product specifically (primary or additional key) —
        // NOT any per-unit product, so a signatures sub never leaks into the
        // links invoice list (and vice-versa).
        or(
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.URL_SHORTENER),
          arrayContains(featureSubscriptionProducts.featureKeys, [
            FEATURE_KEYS.URL_SHORTENER,
          ]),
        ),
      ),
    )
    .orderBy(desc(featureSubscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

export const shortLinksRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        search: z.string().trim().optional(),
        // The Links screen lists plain links only; campaigns have their own screen
        // (campaigns.list). Omit to list both kinds.
        kind: z.enum(SHORT_LINK_KINDS).optional(),
        // Filter by active state: true=active, false=inactive, omit=all.
        isActive: z.boolean().optional(),
        limit: z.number().min(1).max(100).default(50),
        // Keyset cursor: base64 of `<createdAt ISO>|<id>` of the last seen row.
        cursor: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      // Shared query core (keyset pagination on (createdAt, id)) — also used by
      // the AI chatbot's list_short_links tool so the two never drift.
      return listShortLinks(ctx.db, input.brandId, {
        search: input.search,
        kind: input.kind,
        isActive: input.isActive,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db.select().from(shortLinks).where(eq(shortLinks.id, input.id));
      if (!row) throw new Error('Short link not found');
      await assertBrandAccessAny(ctx, row.brandId, LINKS_READ);
      return row;
    }),

  checkSlug: protectedProcedure
    .input(z.object({ slug: z.string().trim().toLowerCase() }))
    .query(async ({ ctx, input }) => {
      const { slug } = input;
      if (!slugRegex.test(slug)) return { available: false, reason: 'Invalid format' };
      if (slug.length < 3 || slug.length > 60) return { available: false, reason: 'Must be 3-60 characters' };
      if (reservedSlugs.has(slug)) return { available: false, reason: 'Reserved' };

      const [existing] = await ctx.db
        .select({ id: shortLinks.id })
        .from(shortLinks)
        .where(sql`lower(${shortLinks.slug}) = ${slug}`)
        .limit(1);

      return { available: !existing };
    }),

  /**
   * Billing/entitlement status for the Links page. Short links are billed $1 per
   * active link / month (owner-scoped); beta users get them free. The UI uses
   * this to render the cost banner and to start checkout BEFORE the first create.
   */
  entitlement: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      const empty = {
        entitled: false,
        betaExempt: false,
        activeCount: 0,
        unitAmount: null as number | null,
        // Actual monthly bill = Σ each active link's locked price (grandfathered).
        monthlyTotal: 0,
        // What a NEW link would cost going forward (the current offer price).
        newLinkAmount: null as number | null,
        // Same, for a new CAMPAIGN (a scheduled link — its own, higher rate).
        newCampaignAmount: null as number | null,
        // Active counts split by kind, so each screen can show its own subtotal.
        activeLinkCount: 0,
        activeCampaignCount: 0,
        // Per-price grouping of active links, for a "3 × $10 · 1 × $1" breakdown.
        breakdown: [] as { amount: number; count: number }[],
        currency: 'AUD',
        priceId: null as string | null,
        // The campaign tier's price — what checkout must use when the first thing
        // a brand switches on is a campaign rather than a plain link.
        campaignPriceId: null as string | null,
        product: null as null | {
          id: string;
          slug: string;
          name: string;
          cardTitle: string | null;
          cardSubtitle: string | null;
          cardDescription: string | null;
          cardButtonLabel: string | null;
        },
      };
      if (!ownerId) return empty;

      const [
        betaExempt,
        entitled,
        activeCount,
        activeLinkCount,
        activeCampaignCount,
        offer,
        campaignOffer,
        sub,
      ] = await Promise.all([
        isBetaUser(ctx.db, ownerId),
        userHasFeature(ctx.db, ownerId, FEATURE_KEYS.URL_SHORTENER),
        countOwnerActiveLinks(ctx.db, ownerId),
        countOwnerActiveLinks(ctx.db, ownerId, 'link'),
        countOwnerActiveLinks(ctx.db, ownerId, 'campaign'),
        getUrlShortenerOffer(ctx.db, 'link'),
        getUrlShortenerOffer(ctx.db, 'campaign'),
        getOwnerUrlSubscription(ctx.db, ownerId),
      ]);

      // Existing subscribers are GRANDFATHERED: show (and bill) the rate they
      // subscribed at — the snapshot on their subscription — not the current
      // offer. Prospects (no active sub) see the live offer price.
      const unitAmount = sub ? Number(sub.amount) : (offer?.unitAmount ?? null);
      const currency = sub?.currency ?? offer?.currency ?? 'AUD';

      // Per-link grandfathering: active links can sit at DIFFERENT prices (each
      // locked at activation — see short_links.billedPriceId). Group them by their
      // locked price to compute the true monthly bill and a per-price breakdown.
      // A null lock falls back to the owner's subscription/offer rate.
      const fallbackUnit = sub ? Number(sub.amount) : (offer?.unitAmount ?? 0);
      const lockedRows = await ctx.db
        .select({ amount: featureSubscriptionPrices.amount, n: count() })
        .from(shortLinks)
        .innerJoin(brands, eq(shortLinks.brandId, brands.id))
        .leftJoin(
          featureSubscriptionPrices,
          eq(shortLinks.billedPriceId, featureSubscriptionPrices.id),
        )
        .where(and(eq(brands.ownerId, ownerId), eq(shortLinks.isActive, true)))
        .groupBy(featureSubscriptionPrices.amount);
      const breakdown = lockedRows.map((r) => ({
        amount: r.amount != null ? Number(r.amount) : fallbackUnit,
        count: Number(r.n),
      }));
      // Beta users are entitled for free — never surface a charge for them.
      const monthlyTotal = betaExempt
        ? 0
        : breakdown.reduce((sum, b) => sum + b.amount * b.count, 0);

      return {
        entitled, // true when beta OR an active subscription is held
        betaExempt,
        activeCount,
        unitAmount,
        monthlyTotal,
        // What a NEW link / campaign costs going forward — the current offers.
        newLinkAmount: offer?.unitAmount ?? null,
        newCampaignAmount: campaignOffer?.unitAmount ?? null,
        activeLinkCount,
        activeCampaignCount,
        breakdown,
        currency,
        priceId: offer?.priceId ?? null,
        campaignPriceId: campaignOffer?.priceId ?? null,
        product: offer?.product
          ? {
              id: offer.product.id,
              slug: offer.product.slug,
              name: offer.product.name,
              cardTitle: offer.product.cardTitle,
              cardSubtitle: offer.product.cardSubtitle,
              cardDescription: offer.product.cardDescription,
              cardButtonLabel: offer.product.cardButtonLabel,
            }
          : null,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        slug: z.string().trim().toLowerCase(),
        destinationUrl: httpUrl(),
        nickname: z.string().trim().min(1),
        qrConfig: qrConfigSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'links');

      const { slug } = input;
      if (!slugRegex.test(slug) || slug.length < 3 || slug.length > 60 || reservedSlugs.has(slug)) {
        throw new Error('Invalid or reserved slug');
      }

      // Check uniqueness
      const [existing] = await ctx.db
        .select({ id: shortLinks.id })
        .from(shortLinks)
        .where(sql`lower(${shortLinks.slug}) = ${slug}`)
        .limit(1);
      if (existing) throw new Error('Slug already in use');

      // Links are created INACTIVE and free — anyone can create as many as they
      // like. Billing happens only when a link is ACTIVATED (toggleActive), which
      // is where the subscription gate now lives. Creating an inactive link never
      // changes the billable active-link count, so there's no quantity sync here.
      const [row] = await ctx.db
        .insert(shortLinks)
        .values({
          brandId: input.brandId,
          slug,
          destinationUrl: input.destinationUrl,
          nickname: input.nickname,
          qrConfig: input.qrConfig || {},
          isActive: false,
          disabledAt: new Date(),
          createdByUserId: ctx.user.id,
        })
        .returning();

      return row;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        slug: z.string().trim().toLowerCase().optional(),
        destinationUrl: httpUrl().optional(),
        nickname: z.string().trim().min(1).optional(),
        qrConfig: qrConfigSchema.optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(shortLinks).where(eq(shortLinks.id, input.id));
      if (!existing) throw new Error('Short link not found');
      await assertBrandAccess(ctx, existing.brandId, 'links');

      if (input.slug && input.slug !== existing.slug) {
        const { slug } = input;
        if (!slugRegex.test(slug) || slug.length < 3 || slug.length > 60 || reservedSlugs.has(slug)) {
          throw new Error('Invalid or reserved slug');
        }
        const [conflict] = await ctx.db
          .select({ id: shortLinks.id })
          .from(shortLinks)
          .where(sql`lower(${shortLinks.slug}) = ${slug}`)
          .limit(1);
        if (conflict) throw new Error('Slug already in use');
      }

      const [row] = await ctx.db
        .update(shortLinks)
        .set({
          slug: input.slug,
          destinationUrl: input.destinationUrl,
          nickname: input.nickname,
          qrConfig: input.qrConfig,
        })
        .where(eq(shortLinks.id, input.id))
        .returning();

      return row;
    }),

  toggleActive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(shortLinks).where(eq(shortLinks.id, input.id));
      if (!existing) throw new Error('Short link not found');
      await assertBrandAccess(ctx, existing.brandId, 'links');

      const ownerId = await brandOwnerId(ctx.db, existing.brandId);

      // The billing gate lives here, not on create: creating links is free, but
      // ACTIVATING one requires URL-shortener entitlement (an active $1/link
      // subscription, or beta access). Disabling is always allowed. The UI starts
      // checkout before reaching here, so this is the server-side backstop.
      if (
        input.isActive &&
        ownerId &&
        !(await userHasFeature(ctx.db, ownerId, FEATURE_KEYS.URL_SHORTENER))
      ) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'A short-link subscription is required to activate links. Please subscribe to continue.',
        });
      }

      // Grandfathering: lock the price the FIRST time a link is switched on and
      // keep it thereafter, so a later price change only affects links activated
      // after it. A link re-activated later keeps its original locked price. The
      // rate depends on the KIND — a campaign locks the campaign tier's price.
      let billedPriceId = existing.billedPriceId;
      if (input.isActive && !billedPriceId) {
        const offer = await getUrlShortenerOffer(ctx.db, existing.kind);
        billedPriceId = offer?.priceId ?? null;
      }

      const [row] = await ctx.db
        .update(shortLinks)
        .set({
          isActive: input.isActive,
          billedPriceId,
          disabledAt: input.isActive ? null : new Date(),
        })
        .where(eq(shortLinks.id, input.id))
        .returning();

      // Active-link set changed → re-bill the owner (per-price Stripe items).
      if (ownerId) await syncUrlShortenerQuantity(ctx.db, ownerId);

      return row;
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await ctx.db.select().from(shortLinks).where(eq(shortLinks.id, input.id));
      if (!existing) throw new Error('Short link not found');
      await assertBrandAccess(ctx, existing.brandId, 'links');

      await ctx.db.delete(shortLinks).where(eq(shortLinks.id, input.id));

      // One fewer active link → prorate the owner's subscription quantity down.
      const ownerId = await brandOwnerId(ctx.db, existing.brandId);
      if (ownerId) await syncUrlShortenerQuantity(ctx.db, ownerId);

      return { id: input.id };
    }),

  /**
   * Create many links at once (the Bulk-create screen). Validates each row
   * independently: invalid/duplicate rows are reported, valid ones are inserted.
   * Creation is free and ungated. Links are created INACTIVE — the user activates
   * the ones they want, which is what drives billing (see toggleActive).
   */
  bulkCreate: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        items: z
          .array(
            z.object({
              destinationUrl: z.string().trim(),
              nickname: z.string().trim().optional(),
              slug: z.string().trim().toLowerCase().optional(),
            }),
          )
          .min(1)
          .max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'links');

      // No billing gate on create — bulk rows are created INACTIVE and free.
      // Billing happens only when links are activated (toggleActive). ownerId is
      // kept for the quantity sync below.
      const ownerId = await brandOwnerId(ctx.db, input.brandId);

      const created: (typeof shortLinks.$inferSelect)[] = [];
      const errors: { row: number; destinationUrl: string; error: string }[] =
        [];
      // Track slugs claimed within THIS batch to avoid intra-batch collisions.
      const claimed = new Set<string>();

      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        try {
          const url = item.destinationUrl;
          // Minimal URL sanity check (mirrors the create() zod url()).
          if (!/^https?:\/\/.+\..+/i.test(url)) {
            throw new Error('Invalid destination URL');
          }

          let slug = item.slug;
          if (slug) {
            if (
              !slugRegex.test(slug) ||
              slug.length < 3 ||
              slug.length > 60 ||
              reservedSlugs.has(slug) ||
              claimed.has(slug)
            ) {
              throw new Error('Invalid, reserved or duplicate slug');
            }
            const [conflict] = await ctx.db
              .select({ id: shortLinks.id })
              .from(shortLinks)
              .where(sql`lower(${shortLinks.slug}) = ${slug}`)
              .limit(1);
            if (conflict) throw new Error('Slug already in use');
          } else {
            slug = await generateUniqueSlug(ctx.db, claimed);
          }
          claimed.add(slug);

          const [row] = await ctx.db
            .insert(shortLinks)
            .values({
              brandId: input.brandId,
              slug,
              destinationUrl: url,
              nickname: item.nickname?.trim() || url.replace(/^https?:\/\//, ''),
              isActive: false,
              disabledAt: new Date(),
              createdByUserId: ctx.user.id,
            })
            .returning();
          created.push(row);
        } catch (e) {
          errors.push({
            row: i,
            destinationUrl: item.destinationUrl,
            error: e instanceof Error ? e.message : 'Failed',
          });
        }
      }

      // Sync once — bulk rows are inactive, so quantity is unchanged, but keep
      // the call for correctness if defaults ever change.
      if (ownerId && created.length) {
        await syncUrlShortenerQuantity(ctx.db, ownerId);
      }

      return { created, errors, createdCount: created.length };
    }),

  /**
   * Click analytics for the Links dashboard, aggregated from each link's
   * `clickCount` (incremented by the redirector). Owner/brand-scoped totals plus
   * the top links, then the windowed event-based series and breakdowns.
   */
  analytics: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        // Window for the event-based series/breakdowns (clickCount totals are
        // all-time and ignore this).
        days: z.number().min(1).max(365).default(30),
        // Prefetch / crawler hits are excluded by default; toggle to reveal them.
        includeBots: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      // Shared analytics core — the AI chatbot's get_link_analytics tool returns
      // a subset of this same computation, so the numbers can't diverge.
      return getLinkAnalytics(ctx.db, input.brandId, {
        days: input.days,
        includeBots: input.includeBots,
      });
    }),

  /**
   * Per-link windowed analytics for the link detail drill-down: a gap-filled
   * daily series plus device / OS / browser / country / referrer / source
   * breakdowns from `link_events`, scoped to one link. Mirrors the aggregate
   * `analytics` procedure but filtered by `linkId`.
   */
  linkAnalytics: protectedProcedure
    .input(
      z.object({
        linkId: z.string().uuid(),
        days: z.number().min(1).max(365).default(30),
        includeBots: z.boolean().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Resolve the owning brand and gate access on it.
      const [link] = await ctx.db
        .select({ brandId: shortLinks.brandId, clickCount: shortLinks.clickCount })
        .from(shortLinks)
        .where(eq(shortLinks.id, input.linkId))
        .limit(1);
      if (!link) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Link not found' });
      }
      await assertBrandAccessAny(ctx, link.brandId, LINKS_READ);

      const since = new Date(Date.now() - input.days * 86_400_000);
      const evScope = [
        eq(linkEvents.linkId, input.linkId),
        gte(linkEvents.occurredAt, since),
      ];
      if (!input.includeBots) evScope.push(eq(linkEvents.isBot, false));

      const dayExpr = sql<string>`to_char(date_trunc('day', ${linkEvents.occurredAt}), 'YYYY-MM-DD')`;
      const seriesRows = await ctx.db
        .select({
          day: dayExpr,
          clicks: count(),
          unique: countDistinct(linkEvents.ipHash),
        })
        .from(linkEvents)
        .where(and(...evScope))
        .groupBy(dayExpr)
        .orderBy(dayExpr);

      const byDay = new Map(
        seriesRows.map((r) => [
          r.day,
          { clicks: Number(r.clicks), unique: Number(r.unique) },
        ]),
      );
      const series: { day: string; clicks: number; unique: number }[] = [];
      for (let i = input.days - 1; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86_400_000)
          .toISOString()
          .slice(0, 10);
        series.push({ day: d, clicks: 0, unique: 0, ...byDay.get(d) });
      }

      const breakdown = async (col: AnyColumn | SQL, fallback: string) => {
        const keyExpr = sql<string>`coalesce(nullif(${col}, ''), ${fallback})`;
        const rows = await ctx.db
          .select({ key: keyExpr, n: count() })
          .from(linkEvents)
          .where(and(...evScope))
          .groupBy(sql`1`)
          .orderBy(desc(count()))
          .limit(8);
        return rows.map((r) => ({ key: r.key, n: Number(r.n) }));
      };

      const [byDevice, byOs, byBrowser, byCountry, byReferrer, bySource, [totals]] =
        await Promise.all([
          breakdown(linkEvents.device, 'other'),
          breakdown(linkEvents.os, 'Unknown'),
          breakdown(linkEvents.browser, 'Unknown'),
          breakdown(linkEvents.country, 'Unknown'),
          breakdown(linkEvents.referrerHost, 'Direct / none'),
          breakdown(linkEvents.source, 'link'),
          ctx.db
            .select({
              clicks: count(),
              unique: countDistinct(linkEvents.ipHash),
            })
            .from(linkEvents)
            .where(and(...evScope)),
        ]);

      return {
        days: input.days,
        totalClicks: Number(link.clickCount),
        windowClicks: Number(totals?.clicks ?? 0),
        uniqueVisitors: Number(totals?.unique ?? 0),
        includeBots: input.includeBots,
        series,
        byDevice,
        byOs,
        byBrowser,
        byCountry,
        byReferrer,
        bySource,
      };
    }),

  /* ── Settings: per-brand default QR design ─────────────────────────────── */

  /** The brand's default QR design (seeds new links). Null when unset. */
  defaultQrConfig: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccessAny(ctx, input.brandId, LINKS_READ);
      return getBrandDefaultQrConfig(ctx.db, input.brandId);
    }),

  /** Save the brand's default QR design (editor only). */
  setDefaultQrConfig: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), qrConfig: qrConfigSchema }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'links');
      await ctx.db
        .update(brands)
        .set({ defaultLinkQrConfig: input.qrConfig })
        .where(eq(brands.id, input.brandId));
      return { ok: true as const };
    }),

  /* ── Billing: Stripe card on file + links-only invoices ────────────────── */

  /** Stripe publishable key for the in-app card form (null when Stripe is off). */
  billingConfig: protectedProcedure.query(() => ({
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
  })),

  /** The brand owner's saved card (default payment method on the customer), or null. */
  paymentMethod: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe) return null;
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId) return null;
      const [owner] = await ctx.db
        .select({ cust: users.stripeCustomerId })
        .from(users)
        .where(eq(users.id, ownerId))
        .limit(1);
      if (!owner?.cust) return null;

      // Tolerant read: a stale/foreign stored id (cloned prod DB, deleted
      // customer) means "no card on file", not a 500 on the billing screen.
      const customer = await retrieveCustomerOrNull(owner.cust);
      if (!customer) return null;
      const defaultPm = customer.invoice_settings?.default_payment_method;
      const defaultPmId =
        typeof defaultPm === 'string' ? defaultPm : (defaultPm?.id ?? null);

      const pms = await stripe.paymentMethods.list({
        customer: owner.cust,
        type: 'card',
        limit: 5,
      });
      const chosen =
        pms.data.find((p) => p.id === defaultPmId) ?? pms.data[0] ?? null;
      const card = chosen?.card;
      if (!card) return null;
      return {
        brand: card.brand,
        last4: card.last4,
        expMonth: card.exp_month,
        expYear: card.exp_year,
      };
    }),

  /** Past Stripe invoices for the brand owner's URL-shortener subscription ONLY. */
  invoices: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe) return [];
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId) return [];
      const sub = await ownerUrlStripeSub(ctx.db, ownerId);
      if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) return [];

      const res = await stripe.invoices.list({
        customer: sub.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        limit: 24,
      });
      return res.data.map((inv) => ({
        id: inv.id,
        number: inv.number ?? inv.id,
        created: inv.created ? new Date(inv.created * 1000) : null,
        periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
        amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
        currency: (inv.currency ?? 'aud').toUpperCase(),
        status: inv.status ?? 'open',
        pdfUrl: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      }));
    }),

  /** Begin adding/updating the owner's card — returns a SetupIntent client secret. */
  createSetupIntent: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe not configured' });
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand owner not found' });
      const customer = await ensureStripeCustomerForUser(ctx.db, ownerId);
      const intent = await stripe.setupIntents.create({
        customer,
        payment_method_types: ['card'],
        usage: 'off_session',
      });
      return { clientSecret: intent.client_secret };
    }),

  /** After the SetupIntent succeeds, make the new card the customer's default. */
  setDefaultPaymentMethod: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), paymentMethodId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe)
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe not configured' });
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand owner not found' });
      const customer = await ensureStripeCustomerForUser(ctx.db, ownerId);
      // The SetupIntent already attached the PM to this customer; attach is a
      // best-effort no-op guard in case it wasn't. Then set it as the default so
      // future invoices (and the next quantity proration) charge the new card.
      try {
        await stripe.paymentMethods.attach(input.paymentMethodId, { customer });
      } catch {
        /* already attached */
      }
      await stripe.customers.update(customer, {
        invoice_settings: { default_payment_method: input.paymentMethodId },
      });
      return { ok: true as const };
    }),
});
