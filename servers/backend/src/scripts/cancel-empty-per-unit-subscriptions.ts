/**
 * One-off repair: cancel PER-UNIT feature subscriptions that are still active but
 * meter ZERO billable units. Until the fix in cancelEmptyPerUnitSubscription, the
 * URL-shortener quantity sync early-returned when an owner's last active link went
 * off — leaving the $1/mo subscription running and billing against zero links.
 * This finds those (and any stray zero-unit signatures subs) and cancels them.
 *
 * A cancel here credits the unused days to the owner's Stripe customer balance
 * (matches runtime — see cancelEmptyPerUnitSubscription). It's a store credit, not
 * a cash refund; re-subscribing later is a one-click card-on-file charge that draws
 * the credit down (the saved card survives cancellation).
 *
 * DRY-RUN by default (reports only). Pass `--apply` to actually cancel.
 * Idempotent — re-running after an apply finds nothing (canceled rows drop out of
 * the active-status filter).
 *
 * Run: `tsx --env-file=../.env src/scripts/cancel-empty-per-unit-subscriptions.ts [--apply]`
 *   (from the server/ workspace; or
 *    `bun run --filter server -- tsx src/scripts/cancel-empty-per-unit-subscriptions.ts --apply`)
 */
import { and, arrayContains, eq, inArray, or } from 'drizzle-orm';
import { db } from '@prodesk/server-shared/db/index';
import {
  featureSubscriptionProducts,
  featureSubscriptions,
} from '@prodesk/server-shared/db/schema';
import { FEATURE_KEYS } from '@prodesk/server-shared/modules/feature-subscriptions/feature-keys';
import { cancelEmptyPerUnitSubscription } from '@prodesk/server-shared/modules/feature-subscriptions/stripe';
import { countOwnerActiveLinks } from '@prodesk/server-shared/modules/feature-subscriptions/per-unit';
import {
  countOwnerSignatureMembers,
  signaturesBillableUnits,
} from '@prodesk/server-shared/modules/signatures/billing';

const APPLY = process.argv.includes('--apply');
const ACTIVE_STATUSES = ['active', 'trialing'] as const;
const TAG = '[cancel-empty-per-unit-subscriptions]';

/** Active/trialing subscriptions granting `featureKey`, with the owner + Stripe id. */
async function activeSubsForFeature(featureKey: string) {
  return db
    .select({
      id: featureSubscriptions.id,
      ownerId: featureSubscriptions.userId,
      stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
      quantity: featureSubscriptions.quantity,
    })
    .from(featureSubscriptions)
    .innerJoin(
      featureSubscriptionProducts,
      eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
    )
    .where(
      and(
        inArray(featureSubscriptions.status, [...ACTIVE_STATUSES]),
        or(
          eq(featureSubscriptionProducts.featureKey, featureKey),
          arrayContains(featureSubscriptionProducts.featureKeys, [featureKey]),
        ),
      ),
    );
}

async function run(): Promise<void> {
  console.log(`${TAG} ${APPLY ? 'APPLY' : 'DRY-RUN'} — scanning per-unit subscriptions.`);

  // (subscription, live billable count) for every per-unit product.
  const urlSubs = await activeSubsForFeature(FEATURE_KEYS.URL_SHORTENER);
  const sigSubs = await activeSubsForFeature(FEATURE_KEYS.EMAIL_SIGNATURES);

  const candidates: Array<{
    product: string;
    sub: { id: string; stripeSubscriptionId: string | null };
    ownerId: string;
    quantity: number | null;
  }> = [];

  for (const s of urlSubs) {
    const units = await countOwnerActiveLinks(db, s.ownerId);
    if (units === 0) {
      candidates.push({ product: 'url_shortener', sub: s, ownerId: s.ownerId, quantity: s.quantity });
    }
  }
  for (const s of sigSubs) {
    const units = signaturesBillableUnits(await countOwnerSignatureMembers(db, s.ownerId));
    if (units === 0) {
      candidates.push({ product: 'email_signatures', sub: s, ownerId: s.ownerId, quantity: s.quantity });
    }
  }

  if (candidates.length === 0) {
    console.log(`${TAG} nothing to do — no active subscription meters zero units.`);
    return;
  }

  console.log(`${TAG} ${candidates.length} zero-unit subscription(s) found:`);
  for (const c of candidates) {
    console.log(
      `${TAG}   ${c.product} sub=${c.sub.id} owner=${c.ownerId} ` +
        `stripe=${c.sub.stripeSubscriptionId ?? '—'} quantity=${c.quantity ?? '—'}`,
    );
  }

  if (!APPLY) {
    console.log(`${TAG} DRY-RUN — re-run with --apply to cancel the above.`);
    return;
  }

  let canceled = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await cancelEmptyPerUnitSubscription(db, c.sub);
      canceled += 1;
      console.log(`${TAG}   canceled ${c.product} sub=${c.sub.id}`);
    } catch (err) {
      failed += 1;
      console.error(`${TAG}   FAILED ${c.product} sub=${c.sub.id}:`, (err as Error).message);
    }
  }
  console.log(`${TAG} done — canceled ${canceled}, failed ${failed}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TAG} fatal`, err);
    process.exit(1);
  });
