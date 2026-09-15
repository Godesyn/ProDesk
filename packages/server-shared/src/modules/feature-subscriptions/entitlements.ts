/**
 * Feature Subscription entitlements. Entitlement is OWNER-scoped: a subscription
 * row's `userId` is always the brand OWNER, so a brand "has" a feature iff its
 * owner holds an active subscription to a product carrying that feature key. This
 * is why the unlock follows the owner across every brand they own.
 */
import { and, arrayContains, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { brands, featureSubscriptionProducts, featureSubscriptions, users } from '../../db/schema.js';
import type { FeatureKey } from './feature-keys.js';

type Db = typeof defaultDb;

/** Subscription statuses that grant access. */
const ACTIVE_STATUSES = ['active', 'trialing'] as const;

/**
 * Does this user have LIVE beta access? Beta users bypass billing and are
 * entitled to every feature — including ones added later — so the check lives
 * here, at the single choke point all entitlement gates funnel through.
 *
 * Beta is TIME-BOXED. `users.betaEndsAt` is the deadline stamped at signup from
 * the cohort's `durationDays` (see modules/beta): once it passes, this returns
 * false and EVERY paid gate on the platform closes at once — reviews capture,
 * short links, signatures, AI chat, logo export, payments. That single expiry is
 * the whole "beta access stops working" mechanism; no feature gates it itself.
 *
 * A NULL `betaEndsAt` is the legacy unlimited grant a super-admin toggles by hand
 * from /super-admin/users, which never expires.
 */
export async function isBetaUser(db: Db, userId: string): Promise<boolean> {
  const row = (
    await db
      .select({ isBetaUser: users.isBetaUser, betaEndsAt: users.betaEndsAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  )[0];
  if (!row?.isBetaUser) return false;
  return row.betaEndsAt == null || row.betaEndsAt.getTime() > Date.now();
}

/**
 * Does this USER (a brand owner) currently hold an active subscription unlocking
 * `featureKey`? Active = status active/trialing AND not lapsed (either not set to
 * cancel at period end, or the current period hasn't ended yet).
 */
export async function userHasFeature(
  db: Db,
  userId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  // Beta users are entitled to every feature for free — short-circuit before the
  // subscription lookup so new feature keys unlock for them automatically.
  if (await isBetaUser(db, userId)) return true;
  const now = new Date();
  const rows = await db
    .select({ id: featureSubscriptions.id })
    .from(featureSubscriptions)
    .innerJoin(
      featureSubscriptionProducts,
      eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
    )
    .where(
      and(
        eq(featureSubscriptions.userId, userId),
        // The product grants this feature if it's the primary key OR is among the
        // product's additional featureKeys — so one subscription unlocks many.
        or(
          eq(featureSubscriptionProducts.featureKey, featureKey),
          arrayContains(featureSubscriptionProducts.featureKeys, [featureKey]),
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
  return rows.length > 0;
}

/**
 * Does this USER already hold an active subscription to this specific PRODUCT?
 * Used to avoid double-subscribing — correct even when a product grants multiple
 * features (checking a single feature key could falsely match a different product
 * that happens to share one of the keys).
 */
export async function userHasProduct(db: Db, userId: string, productId: string): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .select({ id: featureSubscriptions.id })
    .from(featureSubscriptions)
    .where(
      and(
        eq(featureSubscriptions.userId, userId),
        eq(featureSubscriptions.productId, productId),
        inArray(featureSubscriptions.status, [...ACTIVE_STATUSES]),
        or(
          eq(featureSubscriptions.cancelAtPeriodEnd, false),
          isNull(featureSubscriptions.currentPeriodEnd),
          gt(featureSubscriptions.currentPeriodEnd, now),
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Resolve a brand's owner, then check the owner's entitlement. */
export async function brandHasFeature(
  db: Db,
  brandId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  const ownerId = await brandOwnerId(db, brandId);
  if (!ownerId) return false;
  return userHasFeature(db, ownerId, featureKey);
}

/** The owner (user id) of a brand, or null if the brand doesn't exist. */
export async function brandOwnerId(db: Db, brandId: string): Promise<string | null> {
  const row = (
    await db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, brandId)).limit(1)
  )[0];
  return row?.ownerId ?? null;
}
