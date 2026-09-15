/**
 * Feature-subscription read helpers shared by the tRPC `featureSubscriptions`
 * router and the AI billing tools (ai/tools/billing.ts). Feature subscriptions
 * are OWNER-scoped (not brand-scoped); callers resolve the owner via
 * `brandOwnerId` and gate access first — these helpers do no auth.
 */
import { and, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import {
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  featureSubscriptions,
} from '../../db/schema.js';

/** The set of feature keys a product unlocks (primary + additional), de-duped. */
export function productFeatureKeys(p: { featureKey: string; featureKeys?: string[] | null }): string[] {
  return Array.from(new Set([p.featureKey, ...(p.featureKeys ?? [])]));
}

/**
 * An owner's feature subscriptions joined to their product (+ tier), newest
 * first. Returns the full column superset both callers need; each projects its
 * own shape. `activeOnly` restricts to active/trialing subs.
 */
export async function listOwnerFeatureSubscriptions(
  db: DB,
  ownerId: string,
  opts: { activeOnly?: boolean; limit?: number } = {},
) {
  const filters: SQL[] = [eq(featureSubscriptions.userId, ownerId)];
  if (opts.activeOnly) filters.push(inArray(featureSubscriptions.status, ['active', 'trialing']));
  const q = db
    .select({
      id: featureSubscriptions.id,
      status: featureSubscriptions.status,
      interval: featureSubscriptions.interval,
      amount: featureSubscriptions.amount,
      quantity: featureSubscriptions.quantity,
      currency: featureSubscriptions.currency,
      currentPeriodEnd: featureSubscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: featureSubscriptions.cancelAtPeriodEnd,
      canceledAt: featureSubscriptions.canceledAt,
      createdAt: featureSubscriptions.createdAt,
      createdForBrandId: featureSubscriptions.createdForBrandId,
      createdByUserId: featureSubscriptions.createdByUserId,
      productId: featureSubscriptions.productId,
      productName: featureSubscriptionProducts.name,
      productFeatureKey: featureSubscriptionProducts.featureKey,
      productFeatureKeys: featureSubscriptionProducts.featureKeys,
      productPerUnit: featureSubscriptionProducts.perUnit,
      tierName: featureSubscriptionTiers.name,
    })
    .from(featureSubscriptions)
    .innerJoin(featureSubscriptionProducts, eq(featureSubscriptions.productId, featureSubscriptionProducts.id))
    .leftJoin(featureSubscriptionTiers, eq(featureSubscriptions.tierId, featureSubscriptionTiers.id))
    .where(and(...filters))
    .orderBy(desc(featureSubscriptions.createdAt))
    .$dynamic();
  return opts.limit ? q.limit(opts.limit) : q;
}
