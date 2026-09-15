/**
 * The beta billing report — "here's what you'll pay when the beta ends".
 *
 * ONE builder feeds all three surfaces so the numbers can never disagree:
 *   • the 7-day / 3-day / day-of reminder emails (modules/beta/reminders.ts),
 *   • the in-app post-expiry screen (packages/shared/src/beta),
 *   • and the activation that actually subscribes them (modules/beta/activate.ts).
 *
 * Lines are derived from REAL usage (modules/beta/usage.ts) rather than the
 * catalogue: a tool the owner never touched is not on the bill. Quantities are
 * live, so a per-unit line reads `$1.00 × 3 active links = $3.00`, matching what
 * Stripe would meter the moment they subscribe.
 *
 * Amounts are per MONTH. Every product we sell here is priced monthly; a product
 * with no active monthly price is skipped rather than guessed at (see
 * monthlyOfferForProduct).
 */
import { and, asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { featureSubscriptionProducts } from '../../db/schema.js';
import { monthlyOfferForProduct } from '../feature-subscriptions/subscribe.js';
import { productFeatureKeys } from '../feature-subscriptions/queries.js';
import { userHasProduct } from '../feature-subscriptions/entitlements.js';
import { probeOwnerUsage, type FeatureUsage } from './usage.js';

type Db = typeof defaultDb;

/** One product's line on the report. */
export type BetaReportLine = {
  productId: string;
  productName: string;
  /** Short slug, handy for icons/links in the UI. */
  productSlug: string;
  /** The price row to subscribe against (activation uses exactly this). */
  priceId: string;
  tierId: string;
  /** Per-unit rate for a metered product, or the flat monthly fee. */
  unitAmount: number;
  /** Live billable quantity — 1 for a flat product. */
  quantity: number;
  /** unitAmount × quantity — what this line adds to the monthly total. */
  monthlyAmount: number;
  currency: string;
  /** True when the price is metered (`$X per <unitNoun>`), false for a flat fee. */
  perUnit: boolean;
  unitNoun: string | null;
  /** What they did with the tool, e.g. `7 links created, 3 active`. */
  usageDetail: string | null;
  /**
   * True when they ALREADY hold a paid subscription to this product (they added a
   * card mid-beta, or activated part of the report earlier). Such a line is shown
   * as already-covered and excluded from `monthlyTotal` — never double-charged.
   */
  alreadySubscribed: boolean;
};

export type BetaReport = {
  lines: BetaReportLine[];
  /** Sum of every not-yet-subscribed line. This is the "you will pay" figure. */
  monthlyTotal: number;
  /** Currency of the report. Mixed-currency catalogues fall back to the first line's. */
  currency: string;
};

/**
 * Build the owner's report. Cheap enough to call on page load: one product
 * catalogue read, one usage sweep, then one offer lookup per used product.
 */
export async function buildBetaBillingReport(
  db: Db,
  ownerId: string,
): Promise<BetaReport> {
  const [products, usageByKey] = await Promise.all([
    db
      .select()
      .from(featureSubscriptionProducts)
      .where(eq(featureSubscriptionProducts.active, true))
      .orderBy(asc(featureSubscriptionProducts.sortOrder)),
    probeOwnerUsage(db, ownerId),
  ]);

  const lines: BetaReportLine[] = [];
  for (const product of products) {
    // A product is "used" if ANY of the feature keys it grants was used. Bundle
    // products (several keys on one subscription) therefore appear once.
    let usage: FeatureUsage | null = null;
    for (const key of productFeatureKeys(product)) {
      const u = usageByKey.get(key);
      if (u?.used && (!usage || u.quantity > usage.quantity)) usage = u;
    }
    if (!usage) continue;

    const offer = await monthlyOfferForProduct(db, product.id);
    // No sellable monthly price → nothing to quote. Omitting is the honest
    // outcome; inventing a number would put a wrong figure on a bill.
    if (!offer) continue;

    const unitAmount = Number(offer.amount);
    // A metered product with zero live units still costs the unit rate for the
    // one unit Stripe requires (licensed prices can't be quantity 0), so clamp.
    const quantity = product.perUnit ? Math.max(1, usage.quantity) : 1;
    const alreadySubscribed = await userHasProduct(db, ownerId, product.id);

    lines.push({
      productId: product.id,
      productName: product.name,
      productSlug: product.slug,
      priceId: offer.priceId,
      tierId: offer.tierId,
      unitAmount,
      quantity,
      monthlyAmount: Number((unitAmount * quantity).toFixed(2)),
      currency: offer.currency,
      perUnit: product.perUnit,
      unitNoun: usage.unitNoun,
      usageDetail: usage.detail,
      alreadySubscribed,
    });
  }

  const billable = lines.filter((l) => !l.alreadySubscribed);
  const monthlyTotal = Number(
    billable.reduce((sum, l) => sum + l.monthlyAmount, 0).toFixed(2),
  );
  return {
    lines,
    monthlyTotal,
    currency: billable[0]?.currency ?? lines[0]?.currency ?? 'AUD',
  };
}

/**
 * Resolve the report line for a set of product ids the user picked on the paywall.
 * Rebuilding the report server-side (rather than trusting a client-sent price or
 * amount) is what stops a tampered request from subscribing at the wrong price.
 */
export async function reportLinesForProducts(
  db: Db,
  ownerId: string,
  productIds: string[],
): Promise<BetaReportLine[]> {
  const wanted = new Set(productIds);
  const { lines } = await buildBetaBillingReport(db, ownerId);
  return lines.filter((l) => wanted.has(l.productId) && !l.alreadySubscribed);
}

/** True when the product is active and sellable — used to validate admin input. */
export async function productIsSellable(db: Db, productId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: featureSubscriptionProducts.id })
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.id, productId),
        eq(featureSubscriptionProducts.active, true),
      ),
    )
    .limit(1);
  if (!row) return false;
  return (await monthlyOfferForProduct(db, productId)) != null;
}
