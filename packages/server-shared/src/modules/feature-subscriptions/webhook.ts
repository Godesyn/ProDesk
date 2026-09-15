/**
 * Feature Subscription webhook handling. Invoked from the shared Stripe webhook
 * (modules/stripe/webhook.ts) for events tagged `kind: 'feature_subscription'`,
 * so it never collides with the marketplace purchase flow on the same endpoint.
 */
import type Stripe from 'stripe';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptions,
  shortLinks,
  signatureMembers,
  users,
} from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { FEATURE_SUB_KIND, syncCustomerDefaultPaymentMethod } from './stripe.js';
import { getUrlShortenerOffer, syncUrlShortenerQuantity } from './per-unit.js';
import { FEATURE_KEYS } from './feature-keys.js';
import { syncSignaturesQuantity } from '../signatures/per-unit.js';
import { settleReviewsReferralOnActivation } from '../reviews/referrals.js';
import { enqueueEmail } from '../../lib/notify.js';

type Status = (typeof featureSubscriptions.$inferInsert)['status'];

/** Map a Stripe subscription status to our enum. */
function mapStatus(s: Stripe.Subscription.Status | string): Status {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'paused':
      return 'past_due';
    case 'unpaid':
      return 'unpaid';
    case 'canceled':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

function periodEnd(sub: Stripe.Subscription): Date | null {
  // `current_period_end` is a unix timestamp (seconds); read defensively across
  // Stripe API/type versions where it may live on the subscription or its items.
  const s = sub as unknown as {
    current_period_end?: number;
    items?: { data?: Array<{ current_period_end?: number }> };
  };
  const secs = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
  return typeof secs === 'number' ? new Date(secs * 1000) : null;
}

/** True if a Stripe object carries our feature-subscription marker. */
export function isFeatureSubObject(obj: { metadata?: Record<string, string> | null }): boolean {
  return obj?.metadata?.kind === FEATURE_SUB_KIND;
}

/**
 * checkout.session.completed for a feature subscription → record the membership.
 * Thin wrapper: retrieve the subscription (with the paying card expanded) and hand
 * off to the shared recorder so hosted-Checkout and on-file subscribes never drift.
 */
export async function handleFeatureCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  if (!stripe) return;
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  if (!subId) return;
  const sub = await stripe.subscriptions.retrieve(subId, {
    expand: ['latest_invoice.payment_intent'],
  });
  await recordFeatureSubscription(sub);
}

/**
 * Persist (insert/update) the feature_subscriptions row for a Stripe subscription
 * and run every post-activation side effect: stamp the owner's Stripe customer,
 * promote the paying card to the customer default (so "card on file" is populated
 * after subscribing), reconcile per-unit quantity, settle referrals, and email on
 * FIRST activation.
 *
 * Shared by BOTH activation paths — hosted Checkout (checkout.session.completed)
 * and the on-file direct subscribe (featureSubscriptions.checkout) — so they never
 * drift. Idempotent across webhook retries (keyed on stripeSubscriptionId). Reads
 * everything from the subscription object, whose metadata both paths stamp
 * identically (see featureSubMeta in ./stripe.ts).
 */
export async function recordFeatureSubscription(sub: Stripe.Subscription): Promise<void> {
  if (!stripe) return;
  const meta = (sub.metadata ?? {}) as Record<string, string>;
  const subId = sub.id;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id ?? null;
  if (!subId || !meta.ownerUserId || !meta.productId || !meta.priceId) return;

  const price = (
    await db.select().from(featureSubscriptionPrices).where(eq(featureSubscriptionPrices.id, meta.priceId)).limit(1)
  )[0];
  if (!price) return;

  // The Stripe subscription ITEM carries the id + quantity we need for per-unit
  // (quantity-scaled) products. There is a single line item per feature sub.
  const item = sub.items?.data?.[0];

  const values = {
    userId: meta.ownerUserId,
    productId: meta.productId,
    tierId: meta.tierId || null,
    priceId: meta.priceId,
    status: mapStatus(sub.status),
    interval: price.interval,
    amount: price.amount,
    currency: price.currency,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subId,
    stripeSubscriptionItemId: item?.id ?? null,
    quantity: item?.quantity ?? 1,
    currentPeriodEnd: periodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
    createdByUserId: meta.createdByUserId || null,
    createdForBrandId: meta.brandId || null,
  };

  const existing = (
    await db.select({ id: featureSubscriptions.id }).from(featureSubscriptions).where(eq(featureSubscriptions.stripeSubscriptionId, subId)).limit(1)
  )[0];
  if (existing) {
    await db.update(featureSubscriptions).set(values).where(eq(featureSubscriptions.id, existing.id));
  } else {
    const [created] = await db.insert(featureSubscriptions).values(values).returning({ id: featureSubscriptions.id });
    // First activation → notify the brand owner the subscription is live.
    if (created) await enqueueEmail('feature-subscription-started', { subscriptionId: created.id });
  }

  if (customerId) {
    await db
      .update(users)
      .set({ stripeCustomerId: customerId })
      .where(eq(users.id, meta.ownerUserId));
  }

  // Promote the paying card to the customer's default so the "card on file" panel
  // reflects it after subscribing and renewals charge a known card (no-op when a
  // default is already set — e.g. the on-file subscribe path).
  await syncCustomerDefaultPaymentMethod(customerId, sub);

  // Per-unit products (e.g. URL shortener): the checkout quantity was the owner's
  // count at session-create time; reconcile to the exact live count now the
  // subscription is active, so any links added/removed mid-checkout are billed.
  const product = (
    await db
      .select({
        perUnit: featureSubscriptionProducts.perUnit,
        featureKey: featureSubscriptionProducts.featureKey,
        featureKeys: featureSubscriptionProducts.featureKeys,
      })
      .from(featureSubscriptionProducts)
      .where(eq(featureSubscriptionProducts.id, meta.productId))
      .limit(1)
  )[0];
  // URL shortener: the checkout may have been started from enabling a specific
  // link (featureSubscriptions.checkout stamps pendingEnableLinkId). Now the
  // subscription is active, flip that link ON here — the browser return no longer
  // has to (it could lag past the client poll, be torn down mid-enable, or never
  // happen if the tab closed). The short_links UPDATE also drives the realtime
  // feed, so every open Links tab goes live at once. Runs BEFORE the quantity
  // sync below so the newly-active link is counted in the re-bill.
  const grantsUrlShortener =
    !!product &&
    (product.featureKey === FEATURE_KEYS.URL_SHORTENER ||
      (product.featureKeys ?? []).includes(FEATURE_KEYS.URL_SHORTENER));
  if (grantsUrlShortener && meta.pendingEnableLinkId && meta.brandId) {
    const [link] = await db
      .select({
        id: shortLinks.id,
        isActive: shortLinks.isActive,
        billedPriceId: shortLinks.billedPriceId,
      })
      .from(shortLinks)
      .where(
        and(
          eq(shortLinks.id, meta.pendingEnableLinkId),
          eq(shortLinks.brandId, meta.brandId),
        ),
      )
      .limit(1);
    if (link && !link.isActive) {
      // Grandfather the price the first time the link is switched on (mirrors
      // shortLinks.toggleActive so both activation paths bill identically).
      let billedPriceId = link.billedPriceId;
      if (!billedPriceId) {
        const offer = await getUrlShortenerOffer(db);
        billedPriceId = offer?.priceId ?? null;
      }
      await db
        .update(shortLinks)
        .set({ isActive: true, billedPriceId })
        .where(eq(shortLinks.id, link.id));
    }
  }

  // Signatures: the checkout was started from adding a specific SEAT (member),
  // created inactive and stamped as pendingEnableMemberId. Flip it active here — on
  // both paths (hosted webhook + on-file charge call this same function) and without
  // relying on the browser returning. The signature_members UPDATE also drives the
  // realtime feed, so the seat list goes live at once. Runs BEFORE the quantity sync
  // so the newly-active seat is counted in the re-bill.
  const grantsSignatures =
    !!product &&
    (product.featureKey === FEATURE_KEYS.EMAIL_SIGNATURES ||
      (product.featureKeys ?? []).includes(FEATURE_KEYS.EMAIL_SIGNATURES));
  if (grantsSignatures && meta.pendingEnableMemberId) {
    await db
      .update(signatureMembers)
      .set({ isActive: true })
      .where(eq(signatureMembers.id, meta.pendingEnableMemberId));
  }

  // Per-unit reconciliation is dispatched by FEATURE KEY — never the generic
  // `perUnit` flag — so each per-unit product meters against its own count.
  if (grantsUrlShortener) {
    await syncUrlShortenerQuantity(db, meta.ownerUserId);
  }
  if (grantsSignatures) {
    await syncSignaturesQuantity(db, meta.ownerUserId);
  }

  // Reviews subscription went live → settle the owner's pending referral
  // redemption (credits BOTH sides one month). Idempotent across event retries.
  const grantsReviews =
    product &&
    (product.featureKey === FEATURE_KEYS.REVIEWS ||
      (product.featureKeys ?? []).includes(FEATURE_KEYS.REVIEWS));
  if (grantsReviews) {
    await settleReviewsReferralOnActivation(db, meta.ownerUserId);
  }
}

/**
 * customer.subscription.updated / .deleted — reflect Stripe's lifecycle onto our
 * row (status, current period, cancel-at-period-end). No-op if we don't track it.
 */
export async function handleFeatureSubscriptionLifecycle(
  sub: Stripe.Subscription,
  deleted: boolean,
): Promise<void> {
  const existing = (
    await db.select().from(featureSubscriptions).where(eq(featureSubscriptions.stripeSubscriptionId, sub.id)).limit(1)
  )[0];
  if (!existing) return;
  await db
    .update(featureSubscriptions)
    .set({
      status: deleted ? 'canceled' : mapStatus(sub.status),
      currentPeriodEnd: periodEnd(sub) ?? existing.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end ?? existing.cancelAtPeriodEnd,
      canceledAt: deleted || sub.status === 'canceled' ? new Date() : existing.canceledAt,
    })
    .where(eq(featureSubscriptions.id, existing.id));
}
