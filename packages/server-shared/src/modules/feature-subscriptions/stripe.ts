/**
 * Stripe glue for Feature Subscriptions. Mirrors the marketplace flow
 * (modules/billing/recurring.ts) but for a STANDALONE recurring membership tied
 * to a user (the brand owner), not a marketplace purchase.
 *
 * Product → Stripe Product, Price → Stripe Price (immutable: an amount change
 * makes a new Price). One reusable Stripe Customer per user (users.stripeCustomerId).
 */
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { stripe } from '../stripe/client.js';
import { withEnvTag } from '../stripe/env-tag.js';
import { retrieveCustomerOrNull, stripeCustomerExists } from '../stripe/customer.js';
import { db as defaultDb } from '../../db/index.js';
import {
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptions,
  users,
} from '../../db/schema.js';
import { chargeCents } from '../../lib/num.js';
import { env } from '../../lib/env.js';

type Db = typeof defaultDb;

/** Metadata stamped on the checkout session + subscription so the webhook can
 *  reconstruct the feature_subscriptions row. `kind` discriminates from the
 *  marketplace purchase flow that shares the same webhook. */
export const FEATURE_SUB_KIND = 'feature_subscription';

/**
 * Reuse or create the user's Stripe customer; persists it on users.stripeCustomerId.
 *
 * The stored id is VERIFIED against the current Stripe account/mode before reuse: a
 * cloned prod DB (live `cus_…`) under a test key, or a customer deleted in the
 * dashboard, otherwise makes every downstream call fail with "No such customer".
 * When it no longer resolves we mint a fresh customer and overwrite the stale id —
 * see modules/stripe/customer.ts for why only `resource_missing` counts as gone.
 */
export async function ensureStripeCustomerForUser(db: Db, userId: string): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) throw new Error('User not found');
  if (user.stripeCustomerId) {
    if (await stripeCustomerExists(user.stripeCustomerId)) return user.stripeCustomerId;
    console.warn(
      `[stripe] stored customer ${user.stripeCustomerId} for user ${userId} does not exist in this Stripe account/mode — creating a replacement`,
    );
  }
  const customer = await stripe.customers.create({
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined,
    metadata: withEnvTag({ userId }),
  });
  await db.update(users).set({ stripeCustomerId: customer.id }).where(eq(users.id, userId));
  return customer.id;
}

/**
 * Ensure the Stripe Product (for the price's product) and Stripe Price exist,
 * persisting their ids. Stripe Prices are immutable, so the stored stripePriceId
 * is reused as-is; an admin amount change creates a NEW price row upstream rather
 * than mutating this one. Returns the Stripe price id.
 */
export async function ensureStripePrice(db: Db, priceId: string): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  const price = (
    await db.select().from(featureSubscriptionPrices).where(eq(featureSubscriptionPrices.id, priceId)).limit(1)
  )[0];
  if (!price) throw new Error('Price not found');
  if (price.stripePriceId) return price.stripePriceId;

  const tier = (
    await db.select().from(featureSubscriptionTiers).where(eq(featureSubscriptionTiers.id, price.tierId)).limit(1)
  )[0];
  if (!tier) throw new Error('Tier not found');
  const product = (
    await db
      .select()
      .from(featureSubscriptionProducts)
      .where(eq(featureSubscriptionProducts.id, tier.productId))
      .limit(1)
  )[0];
  if (!product) throw new Error('Product not found');

  const stripeProductId = await ensureStripeProduct(db, product.id);

  const stripePrice = await stripe.prices.create({
    product: stripeProductId,
    currency: (price.currency ?? 'AUD').toLowerCase(),
    unit_amount: chargeCents(Number(price.amount)),
    recurring: { interval: price.interval === 'week' ? 'week' : 'month' },
    metadata: withEnvTag({ priceId: price.id, tierId: tier.id, productId: product.id }),
  });
  await db
    .update(featureSubscriptionPrices)
    .set({ stripePriceId: stripePrice.id })
    .where(eq(featureSubscriptionPrices.id, price.id));
  return stripePrice.id;
}

/** Ensure the Stripe Product exists for a feature subscription product. */
export async function ensureStripeProduct(db: Db, productId: string): Promise<string> {
  if (!stripe) throw new Error('Stripe not configured');
  const product = (
    await db
      .select()
      .from(featureSubscriptionProducts)
      .where(eq(featureSubscriptionProducts.id, productId))
      .limit(1)
  )[0];
  if (!product) throw new Error('Product not found');
  if (product.stripeProductId) return product.stripeProductId;
  const stripeProduct = await stripe.products.create({
    name: product.name,
    metadata: withEnvTag({ productId: product.id, featureKey: product.featureKey }),
  });
  await db
    .update(featureSubscriptionProducts)
    .set({ stripeProductId: stripeProduct.id })
    .where(eq(featureSubscriptionProducts.id, product.id));
  return stripeProduct.id;
}

/**
 * Create a Stripe Checkout Session (subscription mode) for a feature subscription.
 * The subscriber of record is `ownerUserId` (the brand owner); `createdByUserId`
 * is whoever clicked subscribe. Returns the hosted checkout url.
 */
export async function createFeatureCheckoutSession(
  db: Db,
  opts: {
    ownerUserId: string;
    createdByUserId: string;
    brandId: string;
    productId: string;
    tierId: string;
    priceId: string;
    /** Initial line-item quantity. >1 for per-unit (quantity-scaled) products;
     *  defaults to 1 for ordinary flat products. */
    quantity?: number;
    /** For the URL shortener: the short link the user was enabling when they were
     *  sent to Checkout. Stamped into metadata so the webhook activates it the
     *  instant the subscription lands — no reliance on the browser returning. */
    pendingEnableLinkId?: string;
    /** For signatures: the pending (inactive) seat to flip active when the sub lands. */
    pendingEnableMemberId?: string;
    /** Retained for compatibility (URL-shortener/other flows). Signatures no longer
     *  uses this — seats are metered by member count, not a brand flag. */
    pendingEnableBrandId?: string;
    successUrl?: string;
    cancelUrl?: string;
  },
): Promise<{ url: string | null }> {
  if (!stripe) return { url: null };
  const customer = await ensureStripeCustomerForUser(db, opts.ownerUserId);
  const stripePriceId = await ensureStripePrice(db, opts.priceId);

  const meta = featureSubMeta(opts);

  const success = opts.successUrl ?? `${env.SERVER_ORIGIN}/chat?sub=success`;
  const cancel = opts.cancelUrl ?? `${env.SERVER_ORIGIN}/chat?sub=cancel`;

  const session: Stripe.Checkout.Session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer,
    line_items: [{ price: stripePriceId, quantity: Math.max(1, opts.quantity ?? 1) }],
    subscription_data: { metadata: withEnvTag(meta) },
    metadata: withEnvTag(meta),
    success_url: success,
    cancel_url: cancel,
  });
  return { url: session.url };
}

/** The subscription metadata the webhook uses to reconstruct our row. Identical
 *  for the Checkout and on-file paths so the webhook treats both the same way. */
function featureSubMeta(opts: {
  ownerUserId: string;
  createdByUserId: string;
  brandId: string;
  productId: string;
  tierId: string;
  priceId: string;
  pendingEnableLinkId?: string;
  pendingEnableMemberId?: string;
  pendingEnableBrandId?: string;
}): Record<string, string> {
  const meta: Record<string, string> = {
    kind: FEATURE_SUB_KIND,
    ownerUserId: opts.ownerUserId,
    createdByUserId: opts.createdByUserId,
    brandId: opts.brandId,
    productId: opts.productId,
    tierId: opts.tierId,
    priceId: opts.priceId,
  };
  // Only stamp when present — Stripe metadata values must be strings.
  if (opts.pendingEnableLinkId) meta.pendingEnableLinkId = opts.pendingEnableLinkId;
  if (opts.pendingEnableMemberId)
    meta.pendingEnableMemberId = opts.pendingEnableMemberId;
  if (opts.pendingEnableBrandId)
    meta.pendingEnableBrandId = opts.pendingEnableBrandId;
  return meta;
}

/** A subscription's card — its explicit default PM, else the card that paid the
 *  latest invoice (needs `latest_invoice.payment_intent` expanded). */
function subscriptionCardId(sub: Stripe.Subscription): string | null {
  const dpm = sub.default_payment_method;
  if (dpm) return typeof dpm === 'string' ? dpm : dpm.id;
  const inv = sub.latest_invoice;
  if (inv && typeof inv !== 'string') {
    const pi = (inv as Stripe.Invoice & { payment_intent?: string | Stripe.PaymentIntent })
      .payment_intent;
    if (pi && typeof pi !== 'string' && pi.payment_method) {
      const pm = pi.payment_method;
      return typeof pm === 'string' ? pm : pm.id;
    }
  }
  return null;
}

/**
 * Promote a subscription's card to the customer's DEFAULT payment method when the
 * customer has none set. Stripe Checkout (subscription mode) attaches the card to
 * the customer and sets it as the SUBSCRIPTION default, but never the CUSTOMER
 * default — so "card on file" reads (invoice_settings.default_payment_method) come
 * back empty right after subscribing. This makes the on-file card deterministic
 * and is the card future renewals charge. Never overrides an existing default.
 */
export async function syncCustomerDefaultPaymentMethod(
  customerId: string | null,
  sub: Stripe.Subscription,
): Promise<void> {
  if (!stripe || !customerId) return;
  const pmId = subscriptionCardId(sub);
  if (!pmId) return;
  const customer = await retrieveCustomerOrNull(customerId);
  if (!customer) return;
  if (customer.invoice_settings?.default_payment_method) return;
  await stripe.customers.update(customerId, {
    invoice_settings: { default_payment_method: pmId },
  });
}

/**
 * Subscribe using the card ALREADY ON FILE (the owner's Stripe customer default
 * payment method) — no hosted Checkout, no redirect. Returns the created Stripe
 * subscription, or null when there's no customer/card on file (the caller then
 * falls back to Checkout). `error_if_incomplete` makes a declined or SCA-required
 * card throw instead of leaving a dangling incomplete subscription, so the caller
 * can catch and fall back to Checkout to finish interactively.
 *
 * SHARED entry point for every feature subscription (reviews, URL shortener, and
 * any future product) — they all get on-file billing without extra wiring.
 */
export async function createFeatureSubscriptionOnFile(
  db: Db,
  opts: {
    ownerUserId: string;
    createdByUserId: string;
    brandId: string;
    productId: string;
    tierId: string;
    priceId: string;
    quantity?: number;
    /** See createFeatureCheckoutSession — the link to auto-activate on the webhook. */
    pendingEnableLinkId?: string;
    /** See createFeatureCheckoutSession — the seat to auto-activate on the webhook. */
    pendingEnableMemberId?: string;
    /** Retained for compatibility (URL-shortener/other flows); unused by signatures. */
    pendingEnableBrandId?: string;
  },
): Promise<Stripe.Subscription | null> {
  if (!stripe) return null;
  const user = (await db.select().from(users).where(eq(users.id, opts.ownerUserId)).limit(1))[0];
  const customerId = user?.stripeCustomerId ?? null;
  if (!customerId) return null; // no customer yet → nothing on file → use Checkout

  const customer = await retrieveCustomerOrNull(customerId);
  if (!customer) return null; // stale/foreign id → treat as nothing on file
  const dpm = customer.invoice_settings?.default_payment_method;
  const pmId = typeof dpm === 'string' ? dpm : (dpm?.id ?? null);
  if (!pmId) return null; // no card on file → use Checkout

  const stripePriceId = await ensureStripePrice(db, opts.priceId);
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: stripePriceId, quantity: Math.max(1, opts.quantity ?? 1) }],
    default_payment_method: pmId,
    payment_behavior: 'error_if_incomplete',
    metadata: withEnvTag(featureSubMeta(opts)),
    expand: ['latest_invoice.payment_intent'],
  });
}

/**
 * Cancel a PER-UNIT feature subscription whose billable unit count has dropped to
 * ZERO (last short link disabled, last SIGKITT brand removed, …). Stripe licensed
 * prices can't be quantity 0 and there is nothing left to bill, so we cancel the
 * subscription outright rather than leave it billing against no units.
 *
 * We cancel WITH PRORATION (`prorate` + `invoice_now`): the owner paid the current
 * month up front, so Stripe credits the unused days as a proration and the
 * resulting net-negative invoice lands on the CUSTOMER BALANCE — a store credit on
 * users.stripeCustomerId (native to Stripe, currency-scoped, NO state of ours).
 * When the owner re-subscribes, Stripe auto-applies that balance to the first
 * invoice (the card-on-file path draws it down before charging; the saved card
 * survives cancellation). It's a credit toward a future charge, not a cash refund.
 *
 * Marks our row `canceled` immediately so entitlement flips off without waiting on
 * the `customer.subscription.deleted` webhook, which also lands and is idempotent
 * with this write (handleFeatureSubscriptionLifecycle).
 *
 * EVERY per-unit product's quantity-sync MUST route its zero case here so the
 * "no units → no subscription" rule stays uniform across products. See
 * docs/feature-subscriptions.md §9.
 */
export async function cancelEmptyPerUnitSubscription(
  db: Db,
  sub: { id: string; stripeSubscriptionId: string | null },
): Promise<void> {
  if (stripe && sub.stripeSubscriptionId) {
    // prorate + invoice_now → credit the unused days to the customer balance now.
    // Best-effort: if Stripe already cancelled it (e.g. a prior run), swallow the
    // error — our row update below is the source of truth for entitlement.
    await stripe.subscriptions
      .cancel(sub.stripeSubscriptionId, { prorate: true, invoice_now: true })
      .catch(() => {});
  }
  await db
    .update(featureSubscriptions)
    .set({ status: 'canceled', canceledAt: new Date(), quantity: 0 })
    .where(eq(featureSubscriptions.id, sub.id));
}
