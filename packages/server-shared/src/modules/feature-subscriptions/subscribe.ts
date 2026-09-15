/**
 * THE shared subscribe path for every feature subscription.
 *
 * Extracted verbatim from `featureSubscriptions.checkout` so more than one caller
 * can subscribe an owner to a product without re-implementing the rules that make
 * feature subscriptions correct:
 *
 *   1. resolve price → tier → product and reject inactive ones,
 *   2. never double-subscribe a product the owner already holds,
 *   3. seed per-unit products at the owner's live unit count,
 *   4. charge the CARD ON FILE first (no redirect), falling back to hosted
 *      Checkout only when there's no card / it declines / it needs SCA,
 *   5. persist through `recordFeatureSubscription` so both paths run the same
 *      side effects (row upsert, quantity reconcile, referral settlement, email),
 *   6. and, with no Stripe configured, activate a dev row so gates still lift.
 *
 * `featureSubscriptions.checkout` is the tRPC surface over this; the beta
 * post-expiry activation (modules/beta/activate.ts) is the second caller. Adding
 * a rule here fixes it for both — see docs/feature-subscriptions.md.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptions,
} from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { enqueueEmail } from '../../lib/notify.js';
import { settleReviewsReferralOnActivation } from '../reviews/referrals.js';
import { countOwnerSignatureMembers } from '../signatures/billing.js';
import { FEATURE_KEYS } from './feature-keys.js';
import { userHasProduct } from './entitlements.js';
import { countOwnerActiveLinks } from './per-unit.js';
import { productFeatureKeys } from './queries.js';
import {
  createFeatureCheckoutSession,
  createFeatureSubscriptionOnFile,
} from './stripe.js';
import { recordFeatureSubscription } from './webhook.js';

type Db = typeof defaultDb;

const intervalDays = (interval: 'week' | 'month') => (interval === 'week' ? 7 : 30);
const money = (v: number | string) => Number(v).toFixed(2);

/** Whether a product unlocks a given feature key (primary or additional). */
const productGrants = (
  p: { featureKey: string; featureKeys?: string[] | null },
  key: string,
): boolean => productFeatureKeys(p).includes(key);

/** What a subscribe attempt resolved to. `url` is set only for the Checkout path. */
export type SubscribeResult =
  | { url: null; status: 'already_active' }
  | { url: null; status: 'active' }
  | { url: string | null; status: 'checkout' }
  | { url: null; status: 'activated_dev' };

export class SubscribeError extends Error {
  constructor(
    message: string,
    /** 'price' when the price row is missing/inactive, 'product' for the tier/product. */
    readonly kind: 'price' | 'product',
  ) {
    super(message);
  }
}

/**
 * The billable unit count to START a per-unit product at (≥1). The count source is
 * FEATURE-SPECIFIC — never the generic `perUnit` flag — and the webhook re-syncs
 * to the exact live count once the subscription is active.
 */
export async function startingQuantity(
  db: Db,
  ownerId: string,
  product: { perUnit: boolean; featureKey: string; featureKeys?: string[] | null },
): Promise<number> {
  if (!product.perUnit) return 1;
  if (productGrants(product, FEATURE_KEYS.URL_SHORTENER)) {
    return Math.max(1, await countOwnerActiveLinks(db, ownerId));
  }
  if (productGrants(product, FEATURE_KEYS.EMAIL_SIGNATURES)) {
    return Math.max(1, await countOwnerSignatureMembers(db, ownerId));
  }
  return 1;
}

/**
 * The active monthly offer for a product — its cheapest-sorted active tier and
 * that tier's active monthly price. Null when the product has no sellable price,
 * which is how an unconfigured product stays invisible instead of half-priced.
 */
export async function monthlyOfferForProduct(db: Db, productId: string) {
  const [offer] = await db
    .select({
      tierId: featureSubscriptionTiers.id,
      tierName: featureSubscriptionTiers.name,
      priceId: featureSubscriptionPrices.id,
      amount: featureSubscriptionPrices.amount,
      currency: featureSubscriptionPrices.currency,
      interval: featureSubscriptionPrices.interval,
    })
    .from(featureSubscriptionTiers)
    .innerJoin(
      featureSubscriptionPrices,
      eq(featureSubscriptionPrices.tierId, featureSubscriptionTiers.id),
    )
    .where(
      and(
        eq(featureSubscriptionTiers.productId, productId),
        eq(featureSubscriptionTiers.active, true),
        eq(featureSubscriptionPrices.active, true),
        eq(featureSubscriptionPrices.interval, 'month'),
      ),
    )
    .orderBy(asc(featureSubscriptionTiers.sortOrder))
    .limit(1);
  return offer ?? null;
}

/**
 * Subscribe `ownerId` to the product behind `priceId`, preferring the card on
 * file. See the module header for the full contract.
 *
 * Callers are responsible for authorization — this function assumes the caller
 * has already established that `actorUserId` may buy on `ownerId`'s behalf.
 */
export async function subscribeToPrice(
  db: Db,
  opts: {
    /** Subscriber of record — always the brand OWNER (entitlement is owner-scoped). */
    ownerId: string;
    /** Who actually checked out (audit). */
    actorUserId: string;
    /** The brand the purchase originated from (audit + Stripe metadata). */
    brandId: string;
    priceId: string;
    successUrl?: string;
    cancelUrl?: string;
    pendingEnableLinkId?: string;
    pendingEnableMemberId?: string;
    pendingEnableBrandId?: string;
  },
): Promise<SubscribeResult> {
  const price = (
    await db
      .select()
      .from(featureSubscriptionPrices)
      .where(eq(featureSubscriptionPrices.id, opts.priceId))
      .limit(1)
  )[0];
  if (!price || !price.active) {
    throw new SubscribeError('Price unavailable', 'price');
  }
  const tier = (
    await db
      .select()
      .from(featureSubscriptionTiers)
      .where(eq(featureSubscriptionTiers.id, price.tierId))
      .limit(1)
  )[0];
  const product = tier
    ? (
        await db
          .select()
          .from(featureSubscriptionProducts)
          .where(eq(featureSubscriptionProducts.id, tier.productId))
          .limit(1)
      )[0]
    : null;
  if (!tier || !product || !product.active) {
    throw new SubscribeError('Product unavailable', 'product');
  }

  // Already actively subscribed to THIS product? Don't double-subscribe.
  if (await userHasProduct(db, opts.ownerId, product.id)) {
    return { url: null, status: 'already_active' };
  }

  const quantity = await startingQuantity(db, opts.ownerId, product);

  if (stripe) {
    // Prefer charging a card ALREADY ON FILE — no hosted Checkout, no redirect.
    try {
      const onFile = await createFeatureSubscriptionOnFile(db, {
        ownerUserId: opts.ownerId,
        createdByUserId: opts.actorUserId,
        brandId: opts.brandId,
        productId: product.id,
        tierId: tier.id,
        priceId: price.id,
        quantity,
        pendingEnableLinkId: opts.pendingEnableLinkId,
        pendingEnableMemberId: opts.pendingEnableMemberId,
        pendingEnableBrandId: opts.pendingEnableBrandId,
      });
      if (onFile && (onFile.status === 'active' || onFile.status === 'trialing')) {
        await recordFeatureSubscription(onFile);
        return { url: null, status: 'active' };
      }
      // Created but not immediately active (shouldn't happen under
      // error_if_incomplete) — don't leave a dangling incomplete sub.
      if (onFile) await stripe.subscriptions.cancel(onFile.id).catch(() => {});
    } catch (err) {
      // The on-file card was declined or needs authentication → fall back to
      // hosted Checkout so the owner can fix the card / complete SCA.
      console.warn(
        '[feature-sub] on-file charge failed; falling back to Checkout:',
        (err as Error).message,
      );
    }

    const { url } = await createFeatureCheckoutSession(db, {
      ownerUserId: opts.ownerId,
      createdByUserId: opts.actorUserId,
      brandId: opts.brandId,
      productId: product.id,
      tierId: tier.id,
      priceId: price.id,
      quantity,
      pendingEnableLinkId: opts.pendingEnableLinkId,
      pendingEnableMemberId: opts.pendingEnableMemberId,
      pendingEnableBrandId: opts.pendingEnableBrandId,
      successUrl: opts.successUrl,
      cancelUrl: opts.cancelUrl,
    });
    return { url, status: 'checkout' };
  }

  // Dev fallback (no Stripe configured): activate immediately so the gate lifts.
  const periodEnd = new Date(
    Date.now() + intervalDays(price.interval) * 24 * 60 * 60 * 1000,
  );
  const [created] = await db
    .insert(featureSubscriptions)
    .values({
      userId: opts.ownerId,
      productId: product.id,
      tierId: tier.id,
      priceId: price.id,
      status: 'active',
      interval: price.interval,
      amount: money(price.amount),
      currency: price.currency,
      quantity,
      currentPeriodEnd: periodEnd,
      createdByUserId: opts.actorUserId,
      createdForBrandId: opts.brandId,
    })
    .returning();
  // Notify the brand owner the subscription is active (live path emails from the
  // webhook on first activation — see feature-subscriptions/webhook.ts).
  await enqueueEmail('feature-subscription-started', { subscriptionId: created.id });
  // Reviews went live → settle a pending referral redemption (live path does this
  // from the webhook). Idempotent; no-op for other products.
  if (productGrants(product, FEATURE_KEYS.REVIEWS)) {
    await settleReviewsReferralOnActivation(db, opts.ownerId);
  }
  return { url: null, status: 'activated_dev' };
}
