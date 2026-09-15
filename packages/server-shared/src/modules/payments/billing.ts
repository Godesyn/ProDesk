/**
 * Payments (EziQuotes) billing — entitlement + the subscribe offer, expressed on
 * the platform's generic Feature Subscription system (no bespoke Stripe). A brand
 * is entitled to the Payments tool when its owner has an active subscription to a
 * product carrying FEATURE_KEYS.payments (or is a beta user). Unlike Reviews
 * there is NO count-based free trial: the tool's core monetization is the
 * per-payment platform fee (plan tiers send/close/recover on Stripe Connect
 * charges), so `live` is simply `entitled`.
 *
 * The super-admin creates the "Payments" product (featureKey = payments) in the
 * Feature Subscriptions panel; checkout/cancel/resume reuse the generic
 * `featureSubscriptions` router. This mirrors how Reviews/Links are billed.
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

type Db = typeof defaultDb;

/** The active Payments product + its default monthly price, or null if unconfigured. */
export async function getPaymentsOffer(db: Db) {
  const [product] = await db
    .select()
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.active, true),
        eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.PAYMENTS),
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

export type PaymentsEntitlement = {
  /** The tool is usable right now (no trial concept — same as `entitled`). */
  live: boolean;
  /** Owner holds an active paid/beta entitlement. */
  entitled: boolean;
  betaExempt: boolean;
  productId: string | null;
  priceId: string | null;
  unitAmount: number | null;
  currency: string;
};

/** Resolve a brand's Payments-tool entitlement (drives the gate + UI). */
export async function paymentsEntitlement(
  db: Db,
  brandId: string,
): Promise<PaymentsEntitlement> {
  const ownerId = await brandOwnerId(db, brandId);
  const [betaExempt, paid, offer] = await Promise.all([
    ownerId ? isBetaUser(db, ownerId) : Promise.resolve(false),
    brandHasFeature(db, brandId, FEATURE_KEYS.PAYMENTS),
    getPaymentsOffer(db),
  ]);
  const entitled = betaExempt || paid;
  return {
    live: entitled,
    entitled,
    betaExempt,
    productId: offer?.productId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer?.unitAmount ?? null,
    currency: offer?.currency ?? 'AUD',
  };
}
