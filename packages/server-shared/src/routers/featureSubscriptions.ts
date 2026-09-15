import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  router,
  protectedProcedure,
  superAdminProcedure,
} from '../trpc/trpc.js';
import {
  chatThreads,
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptions,
} from '../db/schema.js';
import {
  assertBrandAccess,
  assertBrandViewAccess,
} from '../trpc/permissions.js';
import {
  brandOwnerId,
  userHasFeature,
} from '../modules/feature-subscriptions/entitlements.js';
import {
  ensureStripePrice,
  ensureStripeProduct,
} from '../modules/feature-subscriptions/stripe.js';
import {
  SubscribeError,
  subscribeToPrice,
} from '../modules/feature-subscriptions/subscribe.js';
import { KNOWN_FEATURES } from '../modules/feature-subscriptions/feature-keys.js';
import { listOwnerFeatureSubscriptions, productFeatureKeys } from '../modules/feature-subscriptions/queries.js';
import { stripe } from '../modules/stripe/client.js';
import { enqueueEmail } from '../lib/notify.js';

/**
 * FEATURE SUBSCRIPTIONS router — admin-defined subscription products that unlock
 * features (gating). Subscriber of record is always a brand OWNER, so entitlement
 * follows the owner across all of their brands. Separate from the marketplace
 * billing router (`billing.ts`).
 */

const money = (v: number | string) => Number(v).toFixed(2);

/** Whether a product unlocks a given feature key (primary or additional). */
const productGrants = (
  p: { featureKey: string; featureKeys?: string[] | null },
  key: string,
): boolean => productFeatureKeys(p).includes(key);

type PriceRow = typeof featureSubscriptionPrices.$inferSelect;
type TierRow = typeof featureSubscriptionTiers.$inferSelect;
type ProductRow = typeof featureSubscriptionProducts.$inferSelect;

/** Assemble products → tiers → prices, optionally filtering to active rows only. */
async function loadCatalog(
  db: typeof import('../db/index.js').db,
  opts: { activeOnly: boolean },
) {
  const productWhere = opts.activeOnly
    ? eq(featureSubscriptionProducts.active, true)
    : undefined;
  const products = await db
    .select()
    .from(featureSubscriptionProducts)
    .where(productWhere)
    .orderBy(
      asc(featureSubscriptionProducts.sortOrder),
      asc(featureSubscriptionProducts.name),
    );
  if (!products.length) return [];
  const productIds = products.map((p) => p.id);

  const tiers = await db
    .select()
    .from(featureSubscriptionTiers)
    .where(inArray(featureSubscriptionTiers.productId, productIds))
    .orderBy(
      asc(featureSubscriptionTiers.sortOrder),
      asc(featureSubscriptionTiers.name),
    );
  const tierIds = tiers.map((t) => t.id);

  const prices = tierIds.length
    ? await db
        .select()
        .from(featureSubscriptionPrices)
        .where(inArray(featureSubscriptionPrices.tierId, tierIds))
        .orderBy(asc(featureSubscriptionPrices.interval))
    : [];

  const pricesByTier = new Map<string, PriceRow[]>();
  for (const p of prices) {
    if (opts.activeOnly && !p.active) continue;
    (
      pricesByTier.get(p.tierId) ??
      pricesByTier.set(p.tierId, []).get(p.tierId)!
    ).push(p);
  }
  const tiersByProduct = new Map<
    string,
    (TierRow & { prices: PriceRow[] })[]
  >();
  for (const t of tiers) {
    if (opts.activeOnly && !t.active) continue;
    const withPrices = { ...t, prices: pricesByTier.get(t.id) ?? [] };
    (
      tiersByProduct.get(t.productId) ??
      tiersByProduct.set(t.productId, []).get(t.productId)!
    ).push(withPrices);
  }
  return products.map((p) => ({ ...p, tiers: tiersByProduct.get(p.id) ?? [] }));
}

/** First active price for a product (prefers the lowest tier's monthly price). */
function defaultPrice(
  product: ProductRow & { tiers: (TierRow & { prices: PriceRow[] })[] },
) {
  for (const tier of product.tiers) {
    const monthly =
      tier.prices.find((p) => p.interval === 'month') ?? tier.prices[0];
    if (monthly) return { tier, price: monthly };
  }
  return null;
}

export const featureSubscriptionsRouter = router({
  /** Active catalogue for the subscribe UI. */
  catalog: protectedProcedure.query(async ({ ctx }) => {
    return loadCatalog(ctx.db, { activeOnly: true });
  }),

  /**
   * AI-thread access + upsell card for the current brand's AI assistant. Resolves
   * the thread → brand → owner, checks owner entitlement, and returns the Growth
   * Strategy product's card copy + the price to subscribe to.
   */
  aiAccess: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const thread = (
        await ctx.db
          .select({ brandId: chatThreads.brandId, type: chatThreads.type })
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1)
      )[0];
      if (!thread?.brandId) {
        return { entitled: false, brandId: null, product: null as null };
      }
      await assertBrandAccess(ctx, thread.brandId);
      const ownerId = await brandOwnerId(ctx.db, thread.brandId);

      // The product that gates the AI chat (active Growth Strategy). Match either
      // the primary key or any of the product's additional featureKeys.
      const catalog = await loadCatalog(ctx.db, { activeOnly: true });
      const product =
        catalog.find((p) => productGrants(p, 'ai_growth_strategy')) ?? null;
      const entitled = ownerId
        ? await userHasFeature(ctx.db, ownerId, 'ai_growth_strategy')
        : false;

      if (!product) return { entitled, brandId: thread.brandId, product: null };
      const def = defaultPrice(product);
      return {
        entitled,
        brandId: thread.brandId,
        product: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          featureKey: product.featureKey,
          featureKeys: productFeatureKeys(product),
          cardTitle: product.cardTitle,
          cardSubtitle: product.cardSubtitle,
          cardDescription: product.cardDescription,
          cardButtonLabel: product.cardButtonLabel,
          priceId: def?.price.id ?? null,
          tierId: def?.tier.id ?? null,
          amount: def ? Number(def.price.amount) : null,
          interval: def?.price.interval ?? null,
          currency: def?.price.currency ?? 'AUD',
        },
      };
    }),

  /**
   * The feature subscriptions held by a brand's OWNER (so they show on the brand's
   * Subscriptions tab as "Prodesk Subscriptions"). Visible to the brand and any
   * connected agency / super-admin (mirrors billing.brandSubscriptions access).
   */
  myForBrand: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandViewAccess(ctx, input.brandId);
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId) return { subscriptions: [], activeCount: 0 };

      // Shared query core (also backs the AI list_feature_subscriptions tool).
      const rows = await listOwnerFeatureSubscriptions(ctx.db, ownerId);

      const active = (s: (typeof rows)[number]) =>
        s.status === 'active' || s.status === 'trialing';
      const subscriptions = rows.map((s) => ({
        id: s.id,
        productId: s.productId,
        productName: s.productName,
        featureKeys: productFeatureKeys({
          featureKey: s.productFeatureKey,
          featureKeys: s.productFeatureKeys,
        }),
        tierName: s.tierName,
        status: s.status,
        interval: s.interval,
        amount: Number(s.amount),
        // Per-unit products bill amount × quantity; flat products are quantity 1.
        perUnit: s.productPerUnit,
        quantity: s.quantity,
        totalAmount: Number(s.amount) * (s.quantity ?? 1),
        currency: s.currency,
        currentPeriodEnd: s.currentPeriodEnd
          ? s.currentPeriodEnd.toISOString()
          : null,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        canceledAt: s.canceledAt ? s.canceledAt.toISOString() : null,
        createdAt: s.createdAt ? s.createdAt.toISOString() : null,
        active: active(s),
      }));
      return {
        subscriptions,
        activeCount: subscriptions.filter((s) => s.active).length,
      };
    }),

  /**
   * Start a feature-subscription checkout for a brand. Any brand staff member may
   * act; the subscription attaches to the brand OWNER. Returns a Stripe Checkout
   * url, or (no Stripe key) activates a row directly so the flow is testable.
   */
  checkout: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        priceId: z.string().uuid(),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
        // URL shortener only: the link being enabled. Threaded to the webhook so
        // it activates server-side the moment the subscription lands (see
        // recordFeatureSubscription), independent of the browser return.
        pendingEnableLinkId: z.string().uuid().optional(),
        // Signatures only: the pending (inactive) seat being added. Threaded so the
        // webhook / on-file charge flips it active the moment the sub lands — no
        // reliance on the browser returning.
        pendingEnableMemberId: z.string().uuid().optional(),
        // Retained for compatibility (URL-shortener/other flows). Signatures no
        // longer uses this — seats are metered by member count, not a brand flag.
        pendingEnableBrandId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId)
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Brand owner not found',
        });

      // Everything past the authorization check IS the shared subscribe path —
      // price/tier/product resolution, the no-double-subscribe rule, per-unit
      // quantity seeding, card-on-file → hosted-Checkout fallback, and the dev
      // activation. It lives in modules/feature-subscriptions/subscribe.ts
      // because the beta post-expiry activation is a second caller; a rule added
      // there applies to both instead of drifting between them.
      try {
        return await subscribeToPrice(ctx.db, {
          ownerId,
          actorUserId: ctx.user.id,
          brandId: input.brandId,
          priceId: input.priceId,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
          pendingEnableLinkId: input.pendingEnableLinkId,
          pendingEnableMemberId: input.pendingEnableMemberId,
          pendingEnableBrandId: input.pendingEnableBrandId,
        });
      } catch (err) {
        if (err instanceof SubscribeError) {
          throw new TRPCError({ code: 'NOT_FOUND', message: err.message });
        }
        throw err;
      }
    }),

  /** Cancel a feature subscription at period end. */
  cancel: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sub = (
        await ctx.db
          .select()
          .from(featureSubscriptions)
          .where(eq(featureSubscriptions.id, input.subscriptionId))
          .limit(1)
      )[0];
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' });
      // The owner, a super-admin, or a staff member of the brand it was bought for.
      const isOwner = ctx.user.id === sub.userId;
      if (!isOwner && !ctx.user.isSuperAdmin) {
        if (!sub.createdForBrandId) throw new TRPCError({ code: 'FORBIDDEN' });
        await assertBrandAccess(ctx, sub.createdForBrandId);
      }

      if (stripe && sub.stripeSubscriptionId) {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: true,
        });
        const [updated] = await ctx.db
          .update(featureSubscriptions)
          .set({ cancelAtPeriodEnd: true })
          .where(eq(featureSubscriptions.id, sub.id))
          .returning();
        await enqueueEmail('feature-subscription-cancelled', { subscriptionId: sub.id });
        return updated;
      }
      // No Stripe link (dev) — cancel immediately.
      const [updated] = await ctx.db
        .update(featureSubscriptions)
        .set({
          status: 'canceled',
          cancelAtPeriodEnd: true,
          canceledAt: new Date(),
        })
        .where(eq(featureSubscriptions.id, sub.id))
        .returning();
      await enqueueEmail('feature-subscription-cancelled', { subscriptionId: sub.id });
      return updated;
    }),

  /**
   * Revert a scheduled cancellation ("continue") — clears `cancel_at_period_end`
   * so billing continues. Only valid while still cancel-pending. Same access rule
   * as {@link cancel}: the owner, a super-admin, or staff of the buying brand.
   */
  resume: protectedProcedure
    .input(z.object({ subscriptionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const sub = (
        await ctx.db
          .select()
          .from(featureSubscriptions)
          .where(eq(featureSubscriptions.id, input.subscriptionId))
          .limit(1)
      )[0];
      if (!sub) throw new TRPCError({ code: 'NOT_FOUND' });
      const isOwner = ctx.user.id === sub.userId;
      if (!isOwner && !ctx.user.isSuperAdmin) {
        if (!sub.createdForBrandId) throw new TRPCError({ code: 'FORBIDDEN' });
        await assertBrandAccess(ctx, sub.createdForBrandId);
      }
      if (!sub.cancelAtPeriodEnd) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This subscription is not scheduled for cancellation.',
        });
      }

      if (stripe && sub.stripeSubscriptionId) {
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          cancel_at_period_end: false,
        });
        const [updated] = await ctx.db
          .update(featureSubscriptions)
          .set({ cancelAtPeriodEnd: false })
          .where(eq(featureSubscriptions.id, sub.id))
          .returning();
        await enqueueEmail('feature-subscription-resumed', { subscriptionId: sub.id });
        return updated;
      }
      // No Stripe link (dev) — the cancel flipped the row to `canceled` immediately;
      // reactivate it.
      const [updated] = await ctx.db
        .update(featureSubscriptions)
        .set({ status: 'active', cancelAtPeriodEnd: false, canceledAt: null })
        .where(eq(featureSubscriptions.id, sub.id))
        .returning();
      await enqueueEmail('feature-subscription-resumed', { subscriptionId: sub.id });
      return updated;
    }),

  /* ───────────────────────── SUPER ADMIN ───────────────────────── */

  /** Known feature keys for the product form dropdown. */
  adminFeatureKeys: superAdminProcedure.query(() => KNOWN_FEATURES),

  /** Full catalogue including inactive rows. */
  adminListProducts: superAdminProcedure.query(async ({ ctx }) => {
    return loadCatalog(ctx.db, { activeOnly: false });
  }),

  adminCreateProduct: superAdminProcedure
    .input(
      z.object({
        name: z.string().min(1),
        slug: z
          .string()
          .min(1)
          .regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes only'),
        // One subscription can unlock several features. The primary key
        // (featureKey) is kept in sync as the first selected key.
        featureKeys: z.array(z.string().min(1)).min(1),
        description: z.string().optional(),
        // Quantity-scaled billing (e.g. URL shortener: $1 per active link/month).
        perUnit: z.boolean().optional(),
        cardTitle: z.string().optional(),
        cardSubtitle: z.string().optional(),
        cardDescription: z.string().optional(),
        cardButtonLabel: z.string().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { featureKeys, ...rest } = input;
      const keys = Array.from(new Set(featureKeys));
      const [created] = await ctx.db
        .insert(featureSubscriptionProducts)
        .values({ ...rest, featureKey: keys[0], featureKeys: keys })
        .returning();
      if (stripe) await ensureStripeProduct(ctx.db, created.id).catch(() => {});
      return created;
    }),

  adminUpdateProduct: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        featureKeys: z.array(z.string().min(1)).min(1).optional(),
        description: z.string().nullable().optional(),
        perUnit: z.boolean().optional(),
        cardTitle: z.string().nullable().optional(),
        cardSubtitle: z.string().nullable().optional(),
        cardDescription: z.string().nullable().optional(),
        cardButtonLabel: z.string().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, featureKeys, ...patch } = input;
      const keys = featureKeys ? Array.from(new Set(featureKeys)) : undefined;
      const [updated] = await ctx.db
        .update(featureSubscriptionProducts)
        .set({
          ...patch,
          ...(keys ? { featureKey: keys[0], featureKeys: keys } : {}),
        })
        .where(eq(featureSubscriptionProducts.id, id))
        .returning();
      return updated;
    }),

  adminSetProductActive: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(featureSubscriptionProducts)
        .set({ active: input.active })
        .where(eq(featureSubscriptionProducts.id, input.id))
        .returning();
      return updated;
    }),

  adminCreateTier: superAdminProcedure
    .input(
      z.object({
        productId: z.string().uuid(),
        name: z.string().min(1),
        description: z.string().optional(),
        features: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(featureSubscriptionTiers)
        .values(input)
        .returning();
      return created;
    }),

  adminUpdateTier: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        features: z.array(z.string()).optional(),
        sortOrder: z.number().int().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const [updated] = await ctx.db
        .update(featureSubscriptionTiers)
        .set(patch)
        .where(eq(featureSubscriptionTiers.id, id))
        .returning();
      return updated;
    }),

  adminSetTierActive: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(featureSubscriptionTiers)
        .set({ active: input.active })
        .where(eq(featureSubscriptionTiers.id, input.id))
        .returning();
      return updated;
    }),

  adminCreatePrice: superAdminProcedure
    .input(
      z.object({
        tierId: z.string().uuid(),
        interval: z.enum(['week', 'month']),
        amount: z.union([z.number(), z.string()]),
        currency: z.string().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // At most one active price per (tier, interval) — deactivate any existing.
      await ctx.db
        .update(featureSubscriptionPrices)
        .set({ active: false })
        .where(
          and(
            eq(featureSubscriptionPrices.tierId, input.tierId),
            eq(featureSubscriptionPrices.interval, input.interval),
            eq(featureSubscriptionPrices.active, true),
          ),
        );
      const [created] = await ctx.db
        .insert(featureSubscriptionPrices)
        .values({
          tierId: input.tierId,
          interval: input.interval,
          amount: money(input.amount),
          currency: input.currency ?? 'AUD',
        })
        .returning();
      if (stripe) await ensureStripePrice(ctx.db, created.id).catch(() => {});
      return created;
    }),

  /**
   * Update a price. Stripe Prices are immutable, so an amount/interval change
   * DEACTIVATES the old row and creates a new active one (with a fresh Stripe
   * price minted lazily). Currency/active-only edits update in place.
   */
  adminUpdatePrice: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        amount: z.union([z.number(), z.string()]).optional(),
        interval: z.enum(['week', 'month']).optional(),
        currency: z.string().length(3).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = (
        await ctx.db
          .select()
          .from(featureSubscriptionPrices)
          .where(eq(featureSubscriptionPrices.id, input.id))
          .limit(1)
      )[0];
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      const newInterval = input.interval ?? existing.interval;
      const newAmount =
        input.amount != null ? money(input.amount) : existing.amount;
      const changed =
        newInterval !== existing.interval || newAmount !== existing.amount;

      if (changed) {
        await ctx.db
          .update(featureSubscriptionPrices)
          .set({ active: false })
          .where(eq(featureSubscriptionPrices.id, existing.id));
        const [created] = await ctx.db
          .insert(featureSubscriptionPrices)
          .values({
            tierId: existing.tierId,
            interval: newInterval,
            amount: newAmount,
            currency: input.currency ?? existing.currency,
          })
          .returning();
        if (stripe) await ensureStripePrice(ctx.db, created.id).catch(() => {});
        return created;
      }
      const [updated] = await ctx.db
        .update(featureSubscriptionPrices)
        .set({ currency: input.currency ?? existing.currency })
        .where(eq(featureSubscriptionPrices.id, existing.id))
        .returning();
      return updated;
    }),

  adminSetPriceActive: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), active: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(featureSubscriptionPrices)
        .set({ active: input.active })
        .where(eq(featureSubscriptionPrices.id, input.id))
        .returning();
      return updated;
    }),
});
