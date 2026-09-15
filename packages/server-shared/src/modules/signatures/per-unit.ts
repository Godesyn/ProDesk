/**
 * Per-unit (quantity-scaled) billing for the Signatures app (SIGKITT).
 *
 * Owner-scoped: a brand owner holds at most one active signatures subscription
 * whose Stripe `quantity` equals the number of signature SEATS (members) across all
 * their brands BEYOND the free allowance (first seat free). We keep this drift-free
 * by always RECOMPUTING the true billable count and SETTING the quantity.
 *
 * Unlike the URL shortener there is no per-unit price grandfathering — one owner,
 * one signatures price, one Stripe item. When the billable count drops to zero
 * (owner back within the free allowance) we CANCEL the subscription, because
 * Stripe licensed prices cannot be quantity 0 and there is nothing to bill.
 *
 * Beta owners never reach here — `getOwnerSignaturesSubscription` only matches a
 * real subscription, and beta owners are entitled for free without one.
 */
import { and, arrayContains, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  featureSubscriptionProducts,
  featureSubscriptions,
} from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';
import { cancelEmptyPerUnitSubscription } from '../feature-subscriptions/stripe.js';
import {
  countOwnerSignatureMembers,
  signaturesBillableUnits,
} from './billing.js';

type Db = typeof defaultDb;

/** Subscription statuses that grant access (mirrors entitlements.ts). */
const ACTIVE_STATUSES = ['active', 'trialing'] as const;

/**
 * The owner's current active (active/trialing, not lapsed) signatures
 * subscription, or null. Returned with the Stripe item id + our quantity so the
 * caller can push a quantity update to Stripe.
 */
export async function getOwnerSignaturesSubscription(db: Db, ownerId: string) {
  const now = new Date();
  const [row] = await db
    .select({
      id: featureSubscriptions.id,
      stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
      stripeSubscriptionItemId: featureSubscriptions.stripeSubscriptionItemId,
      priceId: featureSubscriptions.priceId,
      quantity: featureSubscriptions.quantity,
      amount: featureSubscriptions.amount,
      currency: featureSubscriptions.currency,
    })
    .from(featureSubscriptions)
    .innerJoin(
      featureSubscriptionProducts,
      eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
    )
    .where(
      and(
        eq(featureSubscriptions.userId, ownerId),
        // The signatures product specifically (primary or additional key).
        or(
          eq(
            featureSubscriptionProducts.featureKey,
            FEATURE_KEYS.EMAIL_SIGNATURES,
          ),
          arrayContains(featureSubscriptionProducts.featureKeys, [
            FEATURE_KEYS.EMAIL_SIGNATURES,
          ]),
        ),
        inArray(featureSubscriptions.status, [...ACTIVE_STATUSES]),
        or(
          eq(featureSubscriptions.cancelAtPeriodEnd, false),
          isNull(featureSubscriptions.currentPeriodEnd),
          gt(featureSubscriptions.currentPeriodEnd, now),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Reconcile the owner's signatures billing after any seat (member) add / remove.
 * No-op when the owner has no active signatures subscription (not subscribed, or
 * beta). Cancels the subscription when the billable count drops to zero.
 */
export async function syncSignaturesQuantity(
  db: Db,
  ownerId: string,
): Promise<void> {
  const sub = await getOwnerSignaturesSubscription(db, ownerId);
  if (!sub) return; // not subscribed (or beta) — nothing to meter

  const seats = await countOwnerSignatureMembers(db, ownerId);
  const billable = signaturesBillableUnits(seats);

  // Back within the free allowance → cancel (Stripe can't bill quantity 0). Shared
  // with the URL shortener so the zero-unit rule stays uniform across per-unit
  // products; see cancelEmptyPerUnitSubscription.
  if (billable <= 0) {
    await cancelEmptyPerUnitSubscription(db, sub);
    return;
  }

  if (billable !== sub.quantity) {
    await db
      .update(featureSubscriptions)
      .set({ quantity: billable })
      .where(eq(featureSubscriptions.id, sub.id));
  }

  if (!stripe || !sub.stripeSubscriptionId || !sub.stripeSubscriptionItemId) {
    return;
  }
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items: [{ id: sub.stripeSubscriptionItemId, quantity: billable }],
    proration_behavior: 'create_prorations',
  });
}
