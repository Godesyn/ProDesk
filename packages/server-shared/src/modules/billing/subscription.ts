/**
 * Per-item Stripe subscription handling — one Stripe subscription per purchase,
 * one subscription ITEM per recurring project. This is what makes a SINGLE
 * project cancellable without killing the whole subscription, and lets a delayed
 * phase begin billing only when it actually starts.
 *
 * Mapping strategy (Checkout can't set per-subscription-item metadata directly):
 * each recurring line gets its own Product carrying `metadata.purchaseItemId`.
 * After the subscription exists we read it back with the product expanded and
 * record each `stripeSubscriptionItemId` onto the purchase item + its project.
 *
 * Ports stripe_service.ts (per-item lines), delete_subscription_item_task.ts
 * (single-item removal) and cancel_subscription.ts (whole-sub on last item).
 */
import type Stripe from 'stripe';
import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm';
import { stripe } from '../stripe/client.js';
import { withEnvTag } from '../stripe/env-tag.js';
import { db as defaultDb } from '../../db/index.js';
import { purchases, purchaseItems, projects } from '../../db/schema.js';
import {
  hasDeliverableCycle,
  SERVICE_TYPES,
  type ServiceType,
} from '../../lib/service-type.js';
import { chargeCents } from '../../lib/num.js';

type Db = typeof defaultDb;
type PurchaseItemRow = typeof purchaseItems.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const DELIVERABLE_CYCLE_TYPES = SERVICE_TYPES.filter((t) =>
  hasDeliverableCycle(t),
);
// CHARGE → round every Stripe line-item amount UP to whole cents (we always
// collect at least the nominal price; payouts round the other way).
const cents = (n: number) => chargeCents(n);

/** The rich one-off/recurring amount snapshot frozen on a purchase item. */
type ItemAmount = {
  oneOff?: { upfront?: number; weeklyAfter?: number; numberOfWeeks?: number };
  recurring?: { upfront?: number; weeklyAfter?: number };
  oneOffTotal?: number;
};
const itemAmount = (item: PurchaseItemRow): ItemAmount =>
  (item.amount ?? {}) as ItemAmount;

/** The per-item recurring weekly fee frozen on the item's amount snapshot. */
export function itemWeekly(item: PurchaseItemRow): number {
  return Number(itemAmount(item).recurring?.weeklyAfter ?? 0);
}

/**
 * Build the Stripe Checkout line items for a purchase, PER ITEM, from each item's
 * frozen `amount` snapshot — a 1:1 port of the cloud function's
 * `createStripeSession` loop (`functions/src/shared/stripe_service.ts`). Each
 * item emits up to four lines:
 *   1. `oneOff.upfront`           → one-time (deposit / full one-off price today)
 *   2. `recurring.upfront`        → one-time (recurring service setup fee today)
 *   3. `oneOff.weeklyAfter` (×N)  → weekly recurring (payment-plan instalment)
 *   4. `recurring.weeklyAfter`    → weekly recurring (forever retainer)
 * Recurring lines carry `product.metadata.purchaseItemId` so the subscription
 * item can be mapped back to its project ({@link persistSubscriptionItemIds}).
 *
 * `mode` is `subscription` whenever ANY item has a weekly component (forever OR
 * instalment); the first invoice still collects all the one-time lines.
 *
 * A phase start delay defers ONLY the forever weekly retainer (line 4) — that
 * subscription item is added when the phase activates (see
 * {@link addSubscriptionItemForProject}). The delayed phase's one-time money
 * (one-off price, recurring setup fee) and any one-off instalment plan are still
 * charged at checkout, so a delayed one-off is billed immediately.
 */
export function buildCheckoutLineItems(
  items: PurchaseItemRow[],
  ref: string,
): {
  mode: 'subscription' | 'payment';
  lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];
} {
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const oneTime = (name: string, amount: number, purchaseItemId: string) =>
    lineItems.push({
      price_data: {
        currency: 'aud',
        unit_amount: cents(amount),
        product_data: { name, metadata: { purchaseItemId } },
      },
      quantity: 1,
    });
  const weekly = (
    name: string,
    amount: number,
    purchaseItemId: string,
    description?: string,
  ) =>
    lineItems.push({
      price_data: {
        currency: 'aud',
        recurring: { interval: 'week' },
        unit_amount: cents(amount),
        product_data: { name, metadata: { purchaseItemId }, description },
      },
      quantity: 1,
    });

  let hasRecurring = false;
  for (const item of items) {
    // A delayed phase defers ONLY its forever weekly retainer (added at activation);
    // its one-time money + instalments are still charged now.
    const phaseDelayed = (item.startDelayDays ?? 0) > 0;
    const amt = itemAmount(item);
    const name = item.serviceName ?? `Item ${ref}`;
    const oneOffUpfront = Number(amt.oneOff?.upfront ?? 0);
    const recurringUpfront = Number(amt.recurring?.upfront ?? 0);
    const instalment = Number(amt.oneOff?.weeklyAfter ?? 0);
    const numberOfWeeks = Number(amt.oneOff?.numberOfWeeks ?? 0);
    const foreverWeekly = Number(amt.recurring?.weeklyAfter ?? 0);

    if (oneOffUpfront > 0) oneTime(name, oneOffUpfront, item.id);
    if (recurringUpfront > 0) oneTime(name, recurringUpfront, item.id);
    if (instalment > 0 && numberOfWeeks > 0) {
      weekly(`${name}`, instalment, item.id, `for ${numberOfWeeks} weeks`);
      hasRecurring = true;
    }
    if (foreverWeekly > 0 && !phaseDelayed) {
      weekly(name, foreverWeekly, item.id);
      hasRecurring = true;
    }
  }

  return { mode: hasRecurring ? 'subscription' : 'payment', lineItems };
}

/**
 * After a subscription is created, record each subscription item's id onto the
 * purchase item it backs (matched via the product's `purchaseItemId` metadata)
 * and mirror it onto the spawned project(s). Idempotent. Also persists the
 * customer id for later off-session item adds.
 */
export async function persistSubscriptionItemIds(
  purchaseId: string,
  subscriptionId: string,
  customerId: string | null,
  db: Db = defaultDb,
): Promise<void> {
  if (!stripe) return;
  if (customerId)
    await db
      .update(purchases)
      .set({ stripeCustomerId: customerId })
      .where(eq(purchases.id, purchaseId));
  const sub = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['items.data.price.product'],
  });
  for (const si of sub.items.data) {
    const product = si.price.product as Stripe.Product | string;
    const purchaseItemId =
      typeof product === 'object'
        ? product.metadata?.purchaseItemId
        : undefined;
    if (!purchaseItemId) continue;
    await db
      .update(purchaseItems)
      .set({ stripeSubscriptionItemId: si.id })
      .where(eq(purchaseItems.id, purchaseItemId));
    await db
      .update(projects)
      .set({ stripeSubscriptionItemId: si.id })
      .where(eq(projects.purchaseItemId, purchaseItemId));
  }
}

/**
 * Add a subscription item for a (delayed-phase) recurring project when its phase
 * activates, so its WEEKLY billing begins one week after the phase starts — the
 * first week is always covered by the recurring upfront/setup fee collected at
 * checkout (so a phase delayed by 1 month first bills weekly at 1 month + 7 days).
 *
 * Two paths, both keeping the one-subscription-per-purchase model that
 * `purchase.paymentCount` and {@link cancelProjectSubscription} rely on:
 *   • No subscription yet (every recurring item was delayed) → open one now with a
 *     7-day trial, so the first weekly charge lands exactly 7 days after activation.
 *   • A subscription already exists (a non-delayed recurring item / instalment plan,
 *     or an earlier phase) → add this item with `proration_behavior: 'none'`, so it
 *     isn't charged for the partial period and first bills on the subscription's
 *     next weekly invoice (the upfront covers the gap). Stripe has no per-item
 *     trial, so the item co-bills on the shared weekly anchor rather than its own
 *     activation+7 date.
 * Best-effort.
 */
export async function addSubscriptionItemForProject(
  project: ProjectRow,
  db: Db = defaultDb,
): Promise<void> {
  if (!stripe || !project.purchaseId || project.stripeSubscriptionItemId)
    return;
  if (!hasDeliverableCycle(project.serviceType as ServiceType | null)) return;
  const item = project.purchaseItemId
    ? (
        await db
          .select()
          .from(purchaseItems)
          .where(eq(purchaseItems.id, project.purchaseItemId))
          .limit(1)
      )[0]
    : null;
  const weekly = item ? itemWeekly(item) : 0;
  if (weekly <= 0) return;
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, project.purchaseId))
      .limit(1)
  )[0];
  if (!purchase) return;

  try {
    // Subscription-item price_data needs an existing Product id (it can't inline
    // product_data), so create the metadata-tagged product up front.
    const product = await stripe.products.create({
      name: project.serviceName ?? 'Recurring',
      metadata: { purchaseItemId: item!.id },
    });
    const price = {
      currency: 'aud',
      recurring: { interval: 'week' as const },
      unit_amount: cents(weekly),
      product: product.id,
    };

    let subscriptionItemId: string;
    if (purchase.stripeSubscriptionId) {
      const si = await stripe.subscriptionItems.create({
        subscription: purchase.stripeSubscriptionId,
        price_data: price,
        proration_behavior: 'none',
      });
      subscriptionItemId = si.id;
    } else if (purchase.stripeCustomerId) {
      // No subscription yet (every recurring item was delayed) — open one now. The
      // 7-day trial defers the first WEEKLY charge to one week after the phase
      // starts; that first week is already covered by the recurring upfront/setup
      // fee collected at checkout (mirrors the checkout subscription's trial in
      // recurring.ts). So a phase delayed by 1 month first bills weekly at 1 month
      // + 7 days.
      const sub = await stripe.subscriptions.create({
        customer: purchase.stripeCustomerId,
        items: [{ price_data: price }],
        metadata: withEnvTag({ purchaseId: purchase.id }),
        trial_period_days: 7,
      });
      await db
        .update(purchases)
        .set({ stripeSubscriptionId: sub.id })
        .where(eq(purchases.id, purchase.id));
      subscriptionItemId = sub.items.data[0]!.id;
    } else {
      return; // can't bill — no subscription and no saved customer
    }
    await db
      .update(purchaseItems)
      .set({ stripeSubscriptionItemId: subscriptionItemId })
      .where(eq(purchaseItems.id, item!.id));
    await db
      .update(projects)
      .set({ stripeSubscriptionItemId: subscriptionItemId })
      .where(eq(projects.id, project.id));
  } catch (err) {
    console.error(
      '[subscription] add item failed for project',
      project.id,
      (err as Error).message,
    );
  }
}

/**
 * Stop the next weekly charge from landing after a scheduled cancel must take
 * effect — the Stripe action (or our deferred job) has to run BEFORE the boundary
 * charge, so we aim a fraction of the weekly gap early. The previous charge was a
 * full week earlier, so this buffer is always safely inside the open week.
 */
const CANCEL_BEFORE_CHARGE_BUFFER_MS = 12 * 60 * 60 * 1000;

/**
 * Cancel ONE project's recurring billing. Removes just this project's
 * subscription item; only when it is the LAST active recurring project on the
 * purchase (no other active recurring project / future phase remains) is the
 * whole Stripe subscription cancelled — one Stripe link per purchase, so a
 * sibling project's or a future phase's billing is never killed (spec §4.3).
 *
 * With `opts.cancelAt` in the future this **schedules** the cancel rather than
 * executing it now (spec §3, "cancel before the next charge"):
 *   • last item  → Stripe-native `cancel_at` (Stripe guarantees no charge after it);
 *   • multi-item → returns `{ deferItemRemoval: true }` so the caller arms a
 *     deferred job to remove just this item before the next invoice (Stripe has
 *     no per-item `cancel_at`).
 * With no `cancelAt` (or a past one) it removes/cancels immediately.
 *
 * ⚠️ The exact firing time of the multi-item deferred removal must beat Stripe's
 * billing-anchor charge; validate against a live subscription (spec §0.6 / §9.1).
 */
export async function cancelProjectSubscription(
  project: ProjectRow,
  db: Db = defaultDb,
  opts: { cancelAt?: Date | null } = {},
): Promise<{ deferItemRemoval: boolean }> {
  const noop = { deferItemRemoval: false };
  if (!stripe || !project.purchaseId) return noop;
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, project.purchaseId))
      .limit(1)
  )[0];
  if (!purchase?.stripeSubscriptionId) return noop;

  // Any OTHER recurring project (incl. a not-yet-started future phase) still
  // active on this purchase? If so we only drop this item, never the whole sub.
  const [{ remaining }] = await db
    .select({ remaining: count() })
    .from(projects)
    .where(
      and(
        eq(projects.purchaseId, project.purchaseId),
        inArray(projects.serviceType, DELIVERABLE_CYCLE_TYPES),
        isNull(projects.deletedAt),
        isNull(projects.cancelledAt),
        ne(projects.id, project.id),
      ),
    );
  const isLast = Number(remaining) === 0;
  const future = !!opts.cancelAt && opts.cancelAt.getTime() > Date.now();

  try {
    if (future) {
      const at = Math.floor(
        (opts.cancelAt!.getTime() - CANCEL_BEFORE_CHARGE_BUFFER_MS) / 1000,
      );
      if (isLast) {
        // Schedule the whole-sub cancel natively — no charge fires after `cancel_at`.
        await stripe.subscriptions.update(purchase.stripeSubscriptionId, {
          cancel_at: at,
        });
        return noop;
      }
      // Multi-item: caller schedules a deferred per-item removal (§9.1).
      return { deferItemRemoval: true };
    }
    if (isLast) {
      // Last recurring item → cancel the whole subscription.
      await stripe.subscriptions.cancel(purchase.stripeSubscriptionId);
    } else if (project.stripeSubscriptionItemId) {
      // Remove only this project's line (no proration), leaving the rest billing.
      await stripe.subscriptionItems.del(project.stripeSubscriptionItemId, {
        proration_behavior: 'none',
      });
    }
  } catch (err) {
    console.error(
      '[subscription] cancel item failed for project',
      project.id,
      (err as Error).message,
    );
  }
  return noop;
}

/**
 * Revert a SCHEDULED cancellation ("continue") — the inverse of the future-cancel
 * branch in {@link cancelProjectSubscription}. Clears Stripe's native whole-sub
 * `cancel_at` so no cancellation fires. Safe to call when the multi-item deferred
 * path was used instead (no `cancel_at` was ever set) — the update is a harmless
 * no-op there; the deferred job is removed by the caller
 * ({@link unscheduleProjectCancellation}). Best-effort, like its sibling.
 *
 * Only meaningful while the cancellation is still pending — once the effective
 * date passes the item/subscription is actually gone and would need a fresh
 * {@link addSubscriptionItemForProject}.
 */
export async function resumeProjectSubscription(
  project: ProjectRow,
  db: Db = defaultDb,
): Promise<void> {
  if (!stripe || !project.purchaseId) return;
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, project.purchaseId))
      .limit(1)
  )[0];
  if (!purchase?.stripeSubscriptionId) return;
  try {
    await stripe.subscriptions.update(purchase.stripeSubscriptionId, {
      cancel_at: null,
    });
  } catch (err) {
    console.error(
      '[subscription] resume failed for project',
      project.id,
      (err as Error).message,
    );
  }
}
