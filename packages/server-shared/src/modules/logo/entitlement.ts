/**
 * Export/download entitlement for Logo Studio — the billing SEAM.
 *
 * Product decision (locked): designing is ALWAYS free; only the export/download
 * boundary is gated. Pricing is DEFERRED, so the gate fails OPEN until a
 * `logo_builder` feature-subscription product actually exists in the catalogue:
 *   • no product with the LOGO key exists  → everyone may export (free);
 *   • a product exists                      → require an active subscription
 *                                             (beta users bypass, per userHasFeature).
 * When pricing is decided, an admin creates the product and the gate engages with
 * zero code change here.
 */
import { and, arrayContains, asc, eq, or } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import {
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
} from '../../db/schema.js';
import { brandHasFeature } from '../feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';

/** Whether a sellable `logo_builder` product has been configured by an admin. */
export async function logoProductExists(db: DB): Promise<boolean> {
  const rows = await db
    .select({ id: featureSubscriptionProducts.id })
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.active, true),
        or(
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.LOGO),
          arrayContains(featureSubscriptionProducts.featureKeys, [FEATURE_KEYS.LOGO]),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface ExportEntitlement {
  allowed: boolean;
  /** True when access is granted only because no product is configured yet. */
  free: boolean;
  featureKey: string;
}

/** Resolve whether the brand may export finished assets right now. */
export async function resolveExportEntitlement(db: DB, brandId: string): Promise<ExportEntitlement> {
  const gated = await logoProductExists(db);
  if (!gated) return { allowed: true, free: true, featureKey: FEATURE_KEYS.LOGO };
  const allowed = await brandHasFeature(db, brandId, FEATURE_KEYS.LOGO);
  return { allowed, free: false, featureKey: FEATURE_KEYS.LOGO };
}

export interface LogoOffer {
  id: string;
  name: string;
  cardTitle: string | null;
  cardSubtitle: string | null;
  cardDescription: string | null;
  cardButtonLabel: string | null;
  priceId: string;
  amount: number;
  currency: string;
  interval: string;
  features: string[];
}

/**
 * The sellable Logo Studio offer with NO brand context: the configured
 * `logo_builder` product and its cheapest active monthly price. Null while
 * pricing is undecided — every caller must render price-less copy in that case
 * rather than inventing a number.
 */
export async function resolveLogoOffer(db: DB): Promise<LogoOffer | null> {
  const [product] = await db
    .select()
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.active, true),
        or(
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.LOGO),
          arrayContains(featureSubscriptionProducts.featureKeys, [FEATURE_KEYS.LOGO]),
        ),
      ),
    )
    .orderBy(asc(featureSubscriptionProducts.sortOrder))
    .limit(1);
  if (!product) return null;

  // Cheapest active monthly price across the product's tiers (falling back to any
  // interval), mirroring the catalogue's `defaultPrice` behaviour.
  const rows = await db
    .select({
      priceId: featureSubscriptionPrices.id,
      amount: featureSubscriptionPrices.amount,
      currency: featureSubscriptionPrices.currency,
      interval: featureSubscriptionPrices.interval,
      tierSort: featureSubscriptionTiers.sortOrder,
      features: featureSubscriptionTiers.features,
    })
    .from(featureSubscriptionPrices)
    .innerJoin(
      featureSubscriptionTiers,
      eq(featureSubscriptionPrices.tierId, featureSubscriptionTiers.id),
    )
    .where(
      and(
        eq(featureSubscriptionTiers.productId, product.id),
        eq(featureSubscriptionTiers.active, true),
        eq(featureSubscriptionPrices.active, true),
      ),
    )
    .orderBy(asc(featureSubscriptionTiers.sortOrder));
  if (!rows.length) return null;

  const chosen = rows.find((r) => r.interval === 'month') ?? rows[0];
  return {
    id: product.id,
    name: product.name,
    cardTitle: product.cardTitle,
    cardSubtitle: product.cardSubtitle,
    cardDescription: product.cardDescription,
    cardButtonLabel: product.cardButtonLabel,
    priceId: chosen.priceId,
    amount: Number(chosen.amount),
    currency: chosen.currency ?? 'AUD',
    interval: chosen.interval,
    features: Array.isArray(chosen.features) ? (chosen.features as string[]) : [],
  };
}

/**
 * The plan behind the pay-on-download bar: the sellable offer plus THIS brand's
 * current entitlement. `product: null` while pricing is undecided, which keeps
 * the download bar honest ("designing is free") instead of dangling a checkout
 * that cannot complete.
 *
 * Purchase itself goes through the SHARED `featureSubscriptions.checkout`
 * procedure — every feature subscription funnels through one code path (card on
 * file first, Stripe Checkout otherwise), so this only has to name the price.
 */
export async function resolveLogoPlan(
  db: DB,
  brandId: string,
): Promise<{ entitlement: ExportEntitlement; product: LogoOffer | null }> {
  const [entitlement, product] = await Promise.all([
    resolveExportEntitlement(db, brandId),
    resolveLogoOffer(db),
  ]);
  return { entitlement, product };
}
