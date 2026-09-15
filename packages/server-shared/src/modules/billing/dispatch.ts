import { and, eq, gt, inArray, isNull, lte } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { payouts, payoutBreakdowns, projects } from '../../db/schema.js';
import {
  payViaPaypal,
  payViaStripe,
  type PayoutRequest,
} from './payout-providers.js';
import { fundWiseViaStripe, retryFundedWiseLeg2 } from './wise.js';
import { resolvePayoutRecipient } from './payout-recipient.js';
import {
  hasDeliverableCycle,
  isBillingCycleWeekly,
  type ServiceType,
} from '../../lib/service-type.js';
import { IS_RECURRING_PROJECTS_REFUNDABLE } from '../../lib/feature-flags.js';
import { roundPayoutDown } from '../../lib/num.js';
import {
  cycleOfPayment,
  isDeliverableCycleComplete,
} from '../projects/cycle-math.js';
import type { DeliverableFrequency } from '../../lib/deliverable-frequency.js';

/**
 * §6 — the external, hard-to-claw-back cuts (platform / sales-agency / affiliate).
 * On a recurring deliverable cycle these are HELD until the cycle completes, since
 * the cycle's payments are refundable until then.
 */
const NON_PRIORITY_COMMISSION_TYPES = new Set([
  'prodeskCommission',
  'affiliateCommission',
  'agencySalesCommission',
]);

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Which still-unpaid breakdown items of a payout are eligible to pay RIGHT NOW.
 * Nobody is paid until the work that funds the payout is complete — this holds
 * for EVERY role (priority and non-priority) and EVERY service type. For a
 * recurring deliverable cycle "complete" is judged per-cycle: the cut for the
 * cycle a weekly payment funds releases once the project has advanced past that
 * cycle (which proves it finished) or completed as the terminal cycle. For
 * non-cycling types it's simply `project.status === 'completed'`. Items with no
 * resolvable project are not eligible. Returns the eligible items + their sum.
 */
async function eligibleBreakdowns(payoutId: string, db: typeof defaultDb) {
  const items = await db
    .select()
    .from(payoutBreakdowns)
    .where(
      and(
        eq(payoutBreakdowns.payoutId, payoutId),
        isNull(payoutBreakdowns.paidAt),
      ),
    );
  const projectIds = [
    ...new Set(items.map((i) => i.projectId).filter(Boolean)),
  ] as string[];
  const projRows = projectIds.length
    ? await db
        .select({
          id: projects.id,
          serviceType: projects.serviceType,
          status: projects.status,
          deliverableFrequency: projects.deliverableFrequency,
          repeatsEvery: projects.repeatsEvery,
          createdAt: projects.createdAt,
          cycleCount: projects.cycleCount,
        })
        .from(projects)
        .where(inArray(projects.id, projectIds))
    : [];
  const projMap = new Map(projRows.map((p) => [p.id, p]));
  const eligible = items.filter((it) => {
    if (!it.projectId) return false;
    const p = projMap.get(it.projectId);
    if (!p) return false;
    const type = p.serviceType as ServiceType | null;
    // Feature flag OFF → weekly-billed projects are non-refundable, so the
    // external non-priority cuts (platform / affiliate / sales-agency) carry no
    // claw-back risk and dispatch EARLY, without waiting for completion. Priority
    // cuts stay completion-gated. (No-op while the flag is true.)
    if (
      !IS_RECURRING_PROJECTS_REFUNDABLE &&
      isBillingCycleWeekly(type) &&
      NON_PRIORITY_COMMISSION_TYPES.has(it.commissionType ?? '')
    ) {
      return true;
    }
    // A recurring deliverable cycle gates EVERY cut (priority and non-priority)
    // on the completion of the specific cycle the payment funds: the cut is held
    // until the project has advanced past that cycle (cycleCount only ever
    // advances out of a `completed` status — see recurring-schedule.ts) or it
    // completed as the terminal cycle. The cycle is derived from the breakdown's
    // weekly payment number (`week`).
    if (hasDeliverableCycle(type)) {
      const cycle = cycleOfPayment(it.week ?? 1, {
        type,
        deliverableFrequency:
          p.deliverableFrequency as DeliverableFrequency | null,
        repeatsEvery: p.repeatsEvery,
        anchor: p.createdAt ?? new Date(),
      });
      return isDeliverableCycleComplete(cycle, p);
    }
    // Non-cycling types (one-off, flat subscription, digital) pay only once the
    // project is completed. (digitalProduct auto-completes at fulfilment.)
    return p.status === 'completed';
  });
  const unpaidTotal = round2(items.reduce((s, i) => s + Number(i.amount), 0));
  // PAYOUT → floor what we actually disburse to whole cents.
  const payable = roundPayoutDown(
    eligible.reduce((s, i) => s + Number(i.amount), 0),
  );
  return { items, eligible, payable, unpaidTotal };
}

const PROCESSING: Record<
  string,
  'processingByStripe' | 'processingByPaypal' | 'processingByWire'
> = {
  stripe: 'processingByStripe',
  paypal: 'processingByPaypal',
  wire: 'processingByWire',
};

/**
 * Dispatch a single payout via the beneficiary's chosen method — gated on
 * project completion. A payout is only paid for its breakdown items that are
 * eligible NOW (weekly-billed, or project completed). Nothing eligible yet →
 * the payout is left `pending` for the next cron run (payout_cron.ts parity).
 *
 * Synchronous Stripe / dev settle PARTIALLY (pay the eligible portion, mark just
 * those breakdown items paid, accumulate `paidAmount`; the payout stays `pending`
 * until fully paid, then `received`). Webhook-driven providers (PayPal / Wise)
 * can't reconcile a partial transfer by transactionId, so they only
 * dispatch once EVERY remaining item is eligible (otherwise defer the whole
 * payout) — keeping their existing webhook→received flow correct.
 */
export async function dispatchPayout(payoutId: string, db = defaultDb) {
  const payout = (
    await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1)
  )[0];
  if (!payout) throw new Error('Payout not found');
  if (payout.status !== 'pending') return payout;

  const { eligible, payable, unpaidTotal } = await eligibleBreakdowns(
    payoutId,
    db,
  );
  if (payable <= 0) return payout; // nothing eligible yet — stays pending, retried next run

  // The platform's own cut (`as: 'admin'`) is retained internally — there is no
  // external account to transfer to. It is still completion-gated by
  // eligibleBreakdowns above, so settle it directly once its work is complete
  // (partial on a recurring cycle, mirroring the synchronous path below).
  if (payout.as === 'admin') {
    await markBreakdownsPaid(eligible, db);
    const newPaid = roundPayoutDown(Number(payout.paidAmount) + payable);
    const fullyPaid = newPaid + 0.01 >= Number(payout.amount);
    const [settled] = await db
      .update(payouts)
      .set({
        status: fullyPaid ? 'paid' : 'pending',
        paidAmount: newPaid.toFixed(2),
        completelyPaidAt: fullyPaid ? new Date() : payout.completelyPaidAt,
      })
      .where(eq(payouts.id, payoutId))
      .returning();
    return settled;
  }

  const recipient = await resolvePayoutRecipient(payout, db);
  const method = payout.method ?? recipient?.activePayoutMethod ?? 'stripe';
  const pm = (recipient?.payoutMethods ?? {}) as Record<
    string,
    { email?: string; recipientId?: string }
  >;

  const synchronous = method === 'stripe';
  // Webhook-driven providers can't reconcile a partial transfer → require all
  // remaining items eligible before dispatching anything.
  if (!synchronous && payable + 0.01 < unpaidTotal) return payout;

  const req: PayoutRequest = {
    amount: payable,
    currency: payout.currency,
    recipientEmail: pm[method]?.email,
    recipientStripeAccountId: recipient?.stripeAccountId ?? undefined,
    recipientId: pm[method]?.recipientId,
    note: payout.sourceBrandName
      ? `Prodesk payout — ${payout.sourceBrandName}`
      : 'Prodesk payout',
  };

  // A missing payout account is NEVER a failure and NEVER reroutes — the payout
  // simply WAITS. If the beneficiary (user or agency) has not linked a destination
  // for the chosen method, leave it `pending` so the next cron run retries once the
  // account is connected.
  const hasDestination =
    method === 'stripe'
      ? !!req.recipientStripeAccountId
      : method === 'paypal'
        ? !!req.recipientEmail
        : !!req.recipientId; // wire
  if (!hasDestination) return payout;

  // Invoice status is DERIVED from this payout at read time (docs/invoices.md §7),
  // so updating the payout status is sufficient — no invoice mirror write needed.
  await db
    .update(payouts)
    .set({ status: 'processing', method })
    .where(eq(payouts.id, payoutId));
  try {
    // Wise runs a multi-leg, webhook-driven flow (funded via Stripe) — it sets
    // its own statuses, so return as soon as funding is kicked off. (Reached only
    // when the whole payout is eligible, per the guard above.)
    if (method === 'wire') {
      await markBreakdownsPaid(eligible, db);
      await fundWiseViaStripe(payoutId, db);
      return (
        await db.select().from(payouts).where(eq(payouts.id, payoutId)).limit(1)
      )[0];
    }
    const transactionId =
      method === 'paypal' ? await payViaPaypal(req) : await payViaStripe(req);

    await markBreakdownsPaid(eligible, db);
    // PAYOUT → floor the running paid total to whole cents.
    const newPaid = roundPayoutDown(Number(payout.paidAmount) + payable);
    const fullyPaid = newPaid + 0.01 >= Number(payout.amount);
    const [updated] = await db
      .update(payouts)
      .set({
        // Synchronous Stripe settles immediately; once fully paid it's the
        // terminal `paid`, otherwise back to `pending` so the next run pays
        // newly-eligible items.
        status: synchronous
          ? fullyPaid
            ? 'paid'
            : 'pending'
          : PROCESSING[method],
        paidAmount: newPaid.toFixed(2),
        completelyPaidAt:
          synchronous && fullyPaid ? new Date() : payout.completelyPaidAt,
        transactionId,
      })
      .where(eq(payouts.id, payoutId))
      .returning();
    return updated;
  } catch (err) {
    await db
      .update(payouts)
      .set({ status: 'failed' })
      .where(eq(payouts.id, payoutId));
    throw err;
  }
}

/** Stamp paidAt on the breakdown items settled by a dispatch. */
async function markBreakdownsPaid(
  items: { id: string }[],
  db: typeof defaultDb,
) {
  if (!items.length) return;
  await db
    .update(payoutBreakdowns)
    .set({ paidAt: new Date() })
    .where(
      inArray(
        payoutBreakdowns.id,
        items.map((i) => i.id),
      ),
    );
}

/**
 * Revive due `failed` payouts back to `pending` so the cron retries them.
 * A payout only reaches `failed` when the provider did NOT settle (dispatch
 * threw, or a provider webhook reported failure), so re-dispatching is safe —
 * with one exception: a wire payout whose Stripe→Wise funding already started
 * (`wiseFunding` set) must not re-run `fundWiseViaStripe`, which would move the
 * funding money a second time. Those stay `failed` for manual reconciliation.
 */
async function retryFailedPayouts(now: Date, db: typeof defaultDb) {
  const failed = await db
    .select()
    .from(payouts)
    .where(and(eq(payouts.status, 'failed'), lte(payouts.toPayAt, now)));
  let retried = 0;
  for (const p of failed) {
    if (p.wiseFunding?.status) {
      console.error(
        '[payout] failed payout NOT auto-retried — Wise funding already started, reconcile manually',
        p.id,
        p.wiseFunding.status,
      );
      continue;
    }
    // A payout with no breakdown rows can never dispatch (nothing to gate on,
    // payable is always 0) — reviving it would just park it as a permanently
    // `pending` zombie. Keep it visibly `failed` instead.
    const [bd] = await db
      .select({ id: payoutBreakdowns.id })
      .from(payoutBreakdowns)
      .where(eq(payoutBreakdowns.payoutId, p.id))
      .limit(1);
    if (!bd) {
      console.error(
        '[payout] failed payout NOT auto-retried — it has no breakdown items',
        p.id,
      );
      continue;
    }
    // Wire stamps breakdowns paid BEFORE funding, and a PayPal webhook failure
    // arrives after dispatch stamped them — so a failed payout can carry
    // paid_at stamps that no money backs. Clear them or the retry finds
    // nothing payable and stalls forever. Only safe when nothing was actually
    // settled (paidAmount 0): a partially-paid Stripe payout's stamps are real.
    if (Number(p.paidAmount) === 0) {
      await db
        .update(payoutBreakdowns)
        .set({ paidAt: null })
        .where(eq(payoutBreakdowns.payoutId, p.id));
    }
    await db
      .update(payouts)
      .set({ status: 'pending' })
      .where(eq(payouts.id, p.id));
    retried++;
  }
  return retried;
}

/** Cron body: dispatch every payout whose toPayAt has passed. */
export async function dispatchDuePayouts(now: Date, db = defaultDb) {
  // Promote scheduled (`upcoming`) payouts that have come due into the
  // dispatchable `pending` state. Ports the Flutter payout cron, which queries
  // `status == Pending && toPayAt <= now` (Pending is its initial state); the web
  // adds an `upcoming` pre-state, so the cron must advance it here first.
  await db
    .update(payouts)
    .set({ status: 'pending' })
    .where(and(eq(payouts.status, 'upcoming'), lte(payouts.toPayAt, now)));

  // Revive retriable `failed` payouts — they rejoin the `pending` pool below.
  const retriedFailed = await retryFailedPayouts(now, db);

  const due = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(and(eq(payouts.status, 'pending'), lte(payouts.toPayAt, now)));
  let dispatched = 0;
  for (const { id } of due) {
    try {
      await dispatchPayout(id, db);
      dispatched++;
    } catch (e) {
      console.error('[payout] dispatch failed', id, (e as Error).message);
    }
  }
  // Re-send any wise payouts stranded at leg 2 (funding settled but the Wise
  // balance wasn't credited when the send was first attempted). Also reached by
  // the dedicated hourly cron and the admin "Retry payouts" button.
  const wiseLeg2 = await retryFundedWiseLeg2(db);
  return { dispatched, considered: due.length, retriedFailed, wiseLeg2 };
}

/**
 * Admin "Initiate payout now (force all)": pull every future-scheduled payout
 * forward by stamping `toPayAt = now` on all `upcoming`/`pending` payouts still
 * dated in the future, then run the normal due-dispatch. This deliberately
 * overrides the weekly payout schedule — the only remaining guard is the
 * completion gate inside `dispatchPayout` (payouts whose work isn't done stay
 * `pending` and simply won't disburse). Returns the same tally as the cron.
 */
export async function dispatchAllPayoutsNow(now: Date, db = defaultDb) {
  // Bring future-dated schedulable payouts up to `now` so the due-dispatch below
  // picks them up. Only rows dated ahead of `now` are touched, so already-due
  // rows keep their real (historic) schedule.
  const pulledForward = await db
    .update(payouts)
    .set({ toPayAt: now })
    .where(and(inArray(payouts.status, ['upcoming', 'pending'] as const), gt(payouts.toPayAt, now)))
    .returning({ id: payouts.id });

  const result = await dispatchDuePayouts(now, db);
  return { ...result, pulledForward: pulledForward.length };
}

/**
 * Settle a single project's still-unsettled payouts RIGHT NOW, bypassing the
 * weekly cron. Used by internal projects on completion: an internal purchase
 * carries no client revenue (the agency funds the contractor fee up front at
 * allocate), so once the work is marked complete there is nothing left to wait
 * for — the fee should reach the contractor immediately, not sit until Friday.
 *
 * Each affected payout has its `toPayAt` pulled forward to its own `createdAt`
 * (so it reads as "due now" everywhere `toPayAt` is shown — payout-readiness,
 * the cron's `toPayAt <= now` filter) and is then dispatched through the SAME
 * completion-gated `dispatchPayout` path. Eligibility is unchanged: an item
 * whose project/cycle isn't actually complete still just stays `pending`, so
 * this can never pay anyone early — it only removes the calendar wait.
 */
export async function dispatchProjectPayoutsNow(
  projectId: string,
  db = defaultDb,
) {
  const bdRows = await db
    .select({ payoutId: payoutBreakdowns.payoutId })
    .from(payoutBreakdowns)
    .where(eq(payoutBreakdowns.projectId, projectId));
  const payoutIds = [...new Set(bdRows.map((r) => r.payoutId).filter(Boolean))];
  if (!payoutIds.length) return { dispatched: 0 };

  // Only the not-yet-settled payouts — leave `paid`/`received`/`processing`
  // rows untouched. `upcoming` is promoted to `pending` (as the cron would).
  const settleable = await db
    .select()
    .from(payouts)
    .where(
      and(
        inArray(payouts.id, payoutIds as string[]),
        inArray(payouts.status, ['upcoming', 'pending']),
      ),
    );
  let dispatched = 0;
  for (const p of settleable) {
    await db
      .update(payouts)
      .set({ status: 'pending', toPayAt: p.createdAt })
      .where(eq(payouts.id, p.id));
    try {
      await dispatchPayout(p.id, db);
      dispatched++;
    } catch (e) {
      console.error(
        '[payout] immediate internal dispatch failed',
        p.id,
        (e as Error).message,
      );
    }
  }
  return { dispatched };
}

/** Mark a payout received (called from provider webhooks). Its invoices' status
 * is derived from this payout at read time (docs/invoices.md §7). */
export async function markPayoutReceived(
  transactionId: string,
  db = defaultDb,
) {
  const matches = await db
    .select()
    .from(payouts)
    .where(eq(payouts.transactionId, transactionId));
  if (!matches.length) return null;
  let last = null;
  for (const payout of matches) {
    if (payout.status === 'paid' || payout.status === 'received') {
      last = payout;
      continue;
    }
    const [updated] = await db
      .update(payouts)
      .set({
        status: 'paid',
        paidAmount: payout.amount,
        completelyPaidAt: new Date(),
      })
      .where(eq(payouts.id, payout.id))
      .returning();
    last = updated;
  }
  return last;
}

/** Mark a payout failed — provider webhook failure. Its invoices' status is
 * derived from this payout at read time (docs/invoices.md §7). */
export async function markPayoutFailed(transactionId: string, db = defaultDb) {
  const matches = await db
    .select()
    .from(payouts)
    .where(eq(payouts.transactionId, transactionId));
  for (const payout of matches) {
    await db
      .update(payouts)
      .set({ status: 'failed' })
      .where(eq(payouts.id, payout.id));
  }
  return matches.length;
}
