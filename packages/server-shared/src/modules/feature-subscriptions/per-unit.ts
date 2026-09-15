/**
 * Per-unit (quantity-scaled) feature subscription billing.
 *
 * Today exactly one product is per-unit: the URL Shortener, which meters TWO
 * kinds of unit at different rates — $1 per ACTIVE plain short link / month and
 * $3 per ACTIVE campaign (a scheduled link) / month. Each rate is a separate TIER
 * of the same product, tagged with `unitKind`; one subscription carries one Stripe
 * ITEM per rate. Billing is OWNER-scoped — a brand owner holds at most one active
 * URL-shortener subscription covering the active links across ALL of their brands.
 * We keep this drift-free by always RECOMPUTING the true counts and SETTING each
 * item's quantity (never increment/decrement).
 *
 * Beta users never reach here for billing — `userHasFeature` short-circuits them
 * to entitled-for-free, and the short-links router skips the sync for beta owners.
 */
import {
  and,
  arrayContains,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  or,
} from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  brands,
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptions,
  shortLinks,
  type ShortLinkKind,
} from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { cancelEmptyPerUnitSubscription, ensureStripePrice } from './stripe.js';
import { FEATURE_KEYS } from './feature-keys.js';

type Db = typeof defaultDb;

/** Subscription statuses that grant access (mirrors entitlements.ts). */
const ACTIVE_STATUSES = ['active', 'trialing'] as const;

/**
 * Number of ACTIVE short links across every brand owned by `ownerId`. This is the
 * billable unit count for the URL-shortener subscription. Pass `kind` to count one
 * kind only (plain links vs campaigns); omit it for the combined total.
 */
export async function countOwnerActiveLinks(
  db: Db,
  ownerId: string,
  kind?: ShortLinkKind,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(shortLinks)
    .innerJoin(brands, eq(shortLinks.brandId, brands.id))
    .where(
      and(
        eq(brands.ownerId, ownerId),
        eq(shortLinks.isActive, true),
        ...(kind ? [eq(shortLinks.kind, kind)] : []),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The owner's current active (active/trialing, not lapsed) URL-shortener
 * subscription, or null. Returned with the Stripe item id + our quantity so the
 * caller can push a quantity update to Stripe.
 */
export async function getOwnerUrlSubscription(db: Db, ownerId: string) {
  const now = new Date();
  const [row] = await db
    .select({
      id: featureSubscriptions.id,
      stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
      stripeSubscriptionItemId: featureSubscriptions.stripeSubscriptionItemId,
      // The subscription's own base price — the fallback bill for any active link
      // that has no per-link lock (e.g. activated before grandfathering shipped
      // but somehow not backfilled).
      priceId: featureSubscriptions.priceId,
      quantity: featureSubscriptions.quantity,
      // Snapshot of the rate this owner subscribed at — survives later price
      // edits, so existing subscribers are billed (and shown) their original fee.
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
        // Match the URL-shortener product specifically (primary or additional
        // key) — NOT any per-unit product. Other per-unit products (e.g. email
        // signatures) have their own owner-scoped subscription + sync.
        or(
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.URL_SHORTENER),
          arrayContains(featureSubscriptionProducts.featureKeys, [
            FEATURE_KEYS.URL_SHORTENER,
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
 * The active URL-shortener offer (product + the monthly per-unit price for ONE
 * unit kind) for the subscribe / paywall UI, or null if no such product is
 * configured. Resolves the active product carrying the `url_shortener` key, then
 * its active monthly price for the requested unit.
 *
 * `unitKind` selects the rate: 'link' (a plain short link) or 'campaign' (a
 * scheduled link, priced higher). A tier with `unitKind = null` is treated as the
 * 'link' rate, so a product seeded before campaigns existed keeps working and no
 * flat product is affected.
 */
export async function getUrlShortenerOffer(
  db: Db,
  unitKind: ShortLinkKind = 'link',
) {
  const product = (
    await db
      .select()
      .from(featureSubscriptionProducts)
      .where(
        and(
          eq(featureSubscriptionProducts.active, true),
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.URL_SHORTENER),
        ),
      )
      .limit(1)
  )[0];
  if (!product) return null;

  const [offer] = await db
    .select({
      tierId: featureSubscriptionTiers.id,
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
        eq(featureSubscriptionTiers.productId, product.id),
        eq(featureSubscriptionTiers.active, true),
        eq(featureSubscriptionPrices.active, true),
        eq(featureSubscriptionPrices.interval, 'month'),
        // 'link' also matches an untagged tier (pre-campaigns seed data); the
        // campaign rate must be explicitly tagged or there is no campaign offer.
        unitKind === 'link'
          ? or(
              eq(featureSubscriptionTiers.unitKind, 'link'),
              isNull(featureSubscriptionTiers.unitKind),
            )
          : eq(featureSubscriptionTiers.unitKind, unitKind),
      ),
    )
    // Prefer an explicitly tagged tier over an untagged legacy one.
    .orderBy(asc(featureSubscriptionTiers.unitKind), asc(featureSubscriptionTiers.sortOrder))
    .limit(1);

  return {
    product,
    unitKind,
    tierId: offer?.tierId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer ? Number(offer.amount) : null,
    currency: offer?.currency ?? 'AUD',
  };
}

/**
 * The owner's active short links grouped by their locked price. Links with no
 * lock (null `billedPriceId`) are folded into `fallbackPriceId` — the owner's
 * subscription base price — so every active link is billed against SOME price.
 * Returns a map of our price id → active-link count.
 */
async function activeLinksByPrice(
  db: Db,
  ownerId: string,
  fallbackPriceId: string | null,
): Promise<Map<string, number>> {
  const rows = await db
    .select({ priceId: shortLinks.billedPriceId, n: count() })
    .from(shortLinks)
    .innerJoin(brands, eq(shortLinks.brandId, brands.id))
    .where(and(eq(brands.ownerId, ownerId), eq(shortLinks.isActive, true)))
    .groupBy(shortLinks.billedPriceId);

  const byPrice = new Map<string, number>();
  for (const r of rows) {
    const pid = r.priceId ?? fallbackPriceId;
    if (!pid) continue; // no price to bill this link against — skip (shouldn't happen)
    byPrice.set(pid, (byPrice.get(pid) ?? 0) + Number(r.n));
  }
  return byPrice;
}

/**
 * Reconcile the owner's URL-shortener billing after any short-link create /
 * remove / toggleActive. Because links are GRANDFATHERED per-link (each keeps the
 * price it was activated at — see short_links.billedPriceId), one owner can have
 * active links at several different prices. We represent that as ONE Stripe
 * subscription with ONE ITEM PER DISTINCT PRICE (all monthly, so Stripe allows
 * them together), each item's quantity = the number of active links at that price.
 *
 * No-op when the owner has no active URL-shortener subscription (not subscribed,
 * or a beta user, who is never charged).
 */
export async function syncUrlShortenerQuantity(
  db: Db,
  ownerId: string,
): Promise<void> {
  const sub = await getOwnerUrlSubscription(db, ownerId);
  if (!sub) return; // not subscribed (or beta) — nothing to meter

  const byPrice = await activeLinksByPrice(db, ownerId, sub.priceId);
  const totalActive = [...byPrice.values()].reduce((a, b) => a + b, 0);

  // No active links left → cancel the subscription outright. Stripe licensed
  // prices can't be quantity 0 and there's nothing to meter, so we must NOT leave
  // a $1 subscription billing against zero links (the bug this replaces silently
  // did — it early-returned here and kept charging). Same rule as signatures; see
  // cancelEmptyPerUnitSubscription.
  if (totalActive === 0) {
    await cancelEmptyPerUnitSubscription(db, sub);
    return;
  }

  // Mirror the total active count for display fallbacks (the per-link locked
  // prices are the source of truth for the actual bill; see the entitlement query).
  if (totalActive !== sub.quantity) {
    await db
      .update(featureSubscriptions)
      .set({ quantity: totalActive })
      .where(eq(featureSubscriptions.id, sub.id));
  }

  if (!stripe || !sub.stripeSubscriptionId) return;

  // Resolve our price ids → Stripe price ids (minted lazily), summing counts in
  // case two of our price rows map to the same Stripe price.
  const desired = new Map<string, number>();
  for (const [pid, qty] of byPrice) {
    const stripePriceId = await ensureStripePrice(db, pid);
    desired.set(stripePriceId, (desired.get(stripePriceId) ?? 0) + qty);
  }

  // Reconcile the subscription's items to `desired` in a single update: update the
  // quantity of items whose price we still want, delete the rest, and add any
  // missing prices. Stripe permits deleting items as long as the same call leaves
  // (or adds) at least one.
  const subscription = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
  const items: Array<{
    id?: string;
    price?: string;
    quantity?: number;
    deleted?: boolean;
  }> = [];
  const seen = new Set<string>();
  for (const item of subscription.items.data) {
    const priceId = typeof item.price === 'string' ? item.price : item.price.id;
    const want = desired.get(priceId);
    if (want != null) {
      items.push({ id: item.id, quantity: want });
      seen.add(priceId);
    } else {
      items.push({ id: item.id, deleted: true });
    }
  }
  for (const [priceId, qty] of desired) {
    if (!seen.has(priceId)) items.push({ price: priceId, quantity: qty });
  }

  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    items,
    proration_behavior: 'create_prorations',
  });
}
