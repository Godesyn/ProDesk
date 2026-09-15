/**
 * Reviews (Verdiict) billing — entitlement + the subscribe offer, expressed on
 * the platform's generic Feature Subscription system (no bespoke Stripe). A brand
 * is entitled to capture reviews when its owner has an active subscription to a
 * product carrying FEATURE_KEYS.reviews (or is a beta user), OR while the brand
 * is still inside its free trial (first REVIEWS_FREE_TRIAL captured reviews).
 *
 * The super-admin creates the "Reviews" product (featureKey = reviews) in the
 * Feature Subscriptions panel; checkout/cancel/resume reuse the generic
 * `featureSubscriptions` router. This mirrors how the Links tool is billed.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
} from '../../db/schema.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';
import { brandHasFeature, brandOwnerId, isBetaUser } from '../feature-subscriptions/entitlements.js';
import { REVIEWS_FREE_TRIAL } from './embed.js';
import { countBrandReviews } from './queries.js';

type Db = typeof defaultDb;

/** The active Reviews product + its default monthly price, or null if unconfigured. */
export async function getReviewsOffer(db: Db) {
  const [product] = await db
    .select()
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.active, true),
        eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.REVIEWS),
      ),
    )
    .limit(1);
  if (!product) return null;

  const [offer] = await db
    .select({
      tierId: featureSubscriptionTiers.id,
      priceId: featureSubscriptionPrices.id,
      amount: featureSubscriptionPrices.amount,
      currency: featureSubscriptionPrices.currency,
    })
    .from(featureSubscriptionTiers)
    .innerJoin(
      featureSubscriptionPrices,
      eq(featureSubscriptionPrices.tierId, featureSubscriptionTiers.id),
    )
    .where(
      and(
        eq(featureSubscriptionTiers.productId, product.id),
        eq(featureSubscriptionTiers.active, true),
        eq(featureSubscriptionPrices.active, true),
        eq(featureSubscriptionPrices.interval, 'month'),
      ),
    )
    .orderBy(asc(featureSubscriptionTiers.sortOrder))
    .limit(1);

  return {
    productId: product.id,
    tierId: offer?.tierId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer ? Number(offer.amount) : null,
    currency: offer?.currency ?? 'AUD',
  };
}

export type ReviewsEntitlement = {
  /** Capture is allowed right now (subscribed/beta OR still in free trial). */
  live: boolean;
  /** Owner holds an active paid/beta entitlement (independent of the trial). */
  entitled: boolean;
  betaExempt: boolean;
  trialUsed: number;
  trialLimit: number;
  trialRemaining: number;
  trialActive: boolean;
  /** True once the trial is exhausted and there is no subscription yet. */
  trialExhausted: boolean;
  productId: string | null;
  priceId: string | null;
  unitAmount: number | null;
  currency: string;
};

/** Resolve a brand's review-capture entitlement (drives the public gate + UI). */
export async function reviewsEntitlement(
  db: Db,
  brandId: string,
): Promise<ReviewsEntitlement> {
  const ownerId = await brandOwnerId(db, brandId);
  const [betaExempt, paid, trialUsed, offer] = await Promise.all([
    ownerId ? isBetaUser(db, ownerId) : Promise.resolve(false),
    brandHasFeature(db, brandId, FEATURE_KEYS.REVIEWS),
    countBrandReviews(db, brandId),
    getReviewsOffer(db),
  ]);
  const entitled = betaExempt || paid;
  const trialLimit = REVIEWS_FREE_TRIAL;
  const trialActive = trialUsed < trialLimit;
  return {
    live: entitled || trialActive,
    entitled,
    betaExempt,
    trialUsed,
    trialLimit,
    trialRemaining: Math.max(0, trialLimit - trialUsed),
    trialActive,
    trialExhausted: !entitled && !trialActive,
    productId: offer?.productId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer?.unitAmount ?? null,
    currency: offer?.currency ?? 'AUD',
  };
}
