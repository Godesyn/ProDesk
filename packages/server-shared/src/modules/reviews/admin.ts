/**
 * Reviews tool — super-admin helpers. `logAdminAction` writes the immutable
 * audit trail every admin mutation records itself into (best-effort: an audit
 * failure never blocks the underlying action), and the owner-set helper backs
 * the overview/customer entitlement badges without per-brand Stripe calls.
 */
import { and, arrayContains, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  featureSubscriptionProducts,
  featureSubscriptions,
  reviewAdminAudit,
} from '../../db/schema.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';

type Db = typeof defaultDb;

export type AdminAuditEntry = {
  actorUserId: string;
  action: string;
  targetType?: 'brand' | 'location' | 'industry' | 'reward';
  targetId?: string;
  meta?: Record<string, unknown>;
};

/** Record a super-admin action. Best-effort — never throws into the caller. */
export async function logAdminAction(db: Db, entry: AdminAuditEntry): Promise<void> {
  try {
    await db.insert(reviewAdminAudit).values({
      actorUserId: entry.actorUserId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      meta: entry.meta ?? null,
    });
  } catch (err) {
    console.error('[reviews.admin] failed to write audit entry', entry.action, err);
  }
}

/**
 * User ids of every brand owner currently holding an active PAID subscription
 * that unlocks the reviews feature (mirrors entitlements.userHasFeature, but as
 * one set-returning query so admin overview/lists stay O(1) in brand count).
 */
export async function subscribedReviewsOwnerIds(db: Db): Promise<Set<string>> {
  const now = new Date();
  const rows = await db
    .select({ userId: featureSubscriptions.userId })
    .from(featureSubscriptions)
    .innerJoin(
      featureSubscriptionProducts,
      eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
    )
    .where(
      and(
        or(
          eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.REVIEWS),
          arrayContains(featureSubscriptionProducts.featureKeys, [FEATURE_KEYS.REVIEWS]),
        ),
        inArray(featureSubscriptions.status, ['active', 'trialing']),
        or(
          eq(featureSubscriptions.cancelAtPeriodEnd, false),
          isNull(featureSubscriptions.currentPeriodEnd),
          gt(featureSubscriptions.currentPeriodEnd, now),
        ),
      ),
    );
  return new Set(rows.map((r) => r.userId));
}
