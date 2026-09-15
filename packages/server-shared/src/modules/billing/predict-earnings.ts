/**
 * Future-earnings prediction — the forecast behind the Earnings page "Future"
 * tab. Two tracks, by cadence (see docs/future-earnings.md, the source of truth):
 *
 *   • TRACK A — CONTRACTOR (deliverable cycle): the contractor is paid the
 *     recurring contractor budget once per deliverable cycle (monthly/etc.). We
 *     forecast the next {@link CONTRACTOR_CYCLE_HORIZON} cycles for the project's
 *     CURRENT `productionAssigneeId` ("last assigned" — follows reassignment;
 *     cleared on completion). Speculative: depends on staying assigned.
 *
 *   • TRACK B — EVERYONE ELSE (billing cycle = always weekly): agency owner,
 *     briefing/allocation/approval designees, sales person, sales agency,
 *     affiliate and platform are paid per weekly billing cycle. We SIMULATE
 *     future cycles by looping the real, non-mutating commission calculator
 *     (`computePayoutSplit`) — so the forecast cannot drift from live payouts and
 *     it inherits payment-plan deferral + the spread reimbursement for free.
 *     Payment-plan installments are GUARANTEED (independent of assignment) and
 *     run to plan end; recurring subscriptions are speculative and bounded to
 *     {@link WEEKLY_RECURRING_HORIZON} weeks. Cancelled recurring projects are
 *     excluded (`excludeCancelledProjects`); payment plans cannot be cancelled.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { projects, purchases, brands, users } from '../../db/schema.js';
import {
  computePayoutSplit,
  payoutFriday,
  reimbursementGrossForItem,
  REIMBURSEMENT_CYCLE,
  type ComputedPayout,
  type PurchaseItemRow,
} from './fulfillment.js';
import { projectNextCycleAt } from '../projects/fulfillment-core.js';
import { recurringContractorBudget } from '../projects/recurring-schedule.js';
import { hasDeliverableCycle, isBillingCycleWeekly, type ServiceType } from '../../lib/service-type.js';
import type { DeliverableFrequency } from '../../lib/deliverable-frequency.js';

type Db = typeof defaultDb;
type ProjectRow = typeof projects.$inferSelect;
type PurchaseRow = typeof purchases.$inferSelect;

/** Deliverable cycles to forecast for the contractor (e.g. 6 monthly cycles). */
const CONTRACTOR_CYCLE_HORIZON = 6;
/** Weeks to forecast for an open-ended recurring subscription's weekly split. */
const WEEKLY_RECURRING_HORIZON = 8;
const DAY_MS = 86_400_000;

interface PredictedBreakdown {
  id: string;
  payoutId: string;
  projectId: string | null;
  purchaseId: string | null;
  brandId: string | null;
  description: string | null;
  commissionType: string | null;
  role: string | null;
  sourceServiceName: string | null;
  amount: string;
  gst: string;
  week: number;
  metadata: Record<string, unknown> | null;
  project?: { taskTitle?: string | null; title?: string | null; serviceName?: string | null } | null;
  paidAt: null;
}

/** A forecast row shaped like a real payout row so the Earnings UI renders it as-is. */
export interface PredictedPayout {
  id: string;
  amount: string;
  paidAmount: string;
  currency: string;
  beneficiaryId: string | null;
  beneficiaryAgencyId: string | null;
  agencyId: string | null;
  purchaseId: string | null;
  status: 'upcoming';
  as: string;
  method: null;
  sourceBrandName: string | null;
  transactionId: null;
  wiseFunding: null;
  createdAt: Date;
  updatedAt: Date;
  toPayAt: Date | null;
  completelyPaidAt: null;
  predicted: true;
  breakdown: PredictedBreakdown[];
}

/** Recurring weekly gross — mirrors fulfillment.generateCyclePayouts' grossOf. */
function recurringWeeklyGross(it: PurchaseItemRow): number {
  const amt = it.amount as {
    recurring?: { weeklyAfter?: number };
    oneOff?: { weeklyAfter?: number };
  } | null;
  return Number(amt?.recurring?.weeklyAfter ?? amt?.oneOff?.weeklyAfter ?? it.lineTotal) || 0;
}

/** Build a forecast row from one beneficiary's computed split (Track B). */
function rowFromComputed(
  cp: ComputedPayout,
  ctx: { purchaseId: string; brandName: string | null; week: number; toPayAt: Date; now: Date },
): PredictedPayout {
  // Per-project payouts mean a beneficiary can have several rows in one week
  // (one per project) — include the project in the id so they stay distinct.
  const id = `predicted-${ctx.purchaseId}-${ctx.week}-${cp.beneficiaryId ?? cp.beneficiaryAgencyId}-${cp.projectId ?? 'none'}`;
  return {
    id,
    amount: cp.total.toFixed(2),
    paidAmount: '0',
    currency: 'AUD',
    beneficiaryId: cp.beneficiaryId,
    beneficiaryAgencyId: cp.beneficiaryAgencyId,
    agencyId: cp.agencyId,
    purchaseId: ctx.purchaseId,
    status: 'upcoming',
    as: cp.as,
    method: null,
    sourceBrandName: ctx.brandName,
    transactionId: null,
    wiseFunding: null,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    toPayAt: ctx.toPayAt,
    completelyPaidAt: null,
    predicted: true,
    breakdown: cp.rows.map((r, i) => ({
      id: `${id}-bd-${i}`,
      payoutId: id,
      projectId: r.projectId,
      purchaseId: ctx.purchaseId,
      brandId: null,
      description: r.commissionType,
      commissionType: r.commissionType,
      role: r.role,
      sourceServiceName: r.serviceName,
      amount: r.amount.toFixed(2),
      gst: '0',
      week: ctx.week,
      metadata: { brandName: ctx.brandName, serviceName: r.serviceName, week: ctx.week },
      paidAt: null,
    })),
  };
}

/**
 * TRACK A — forecast the contractor's recurring budget for the next N deliverable
 * cycles. Returns [] unless the project is a recurring (deliverable-cycling)
 * project with a current assignee and a positive recurring budget.
 */
export function predictContractorCycles(p: ProjectRow, now: Date): PredictedPayout[] {
  if (!hasDeliverableCycle(p.serviceType as ServiceType | null)) return [];
  if (!p.productionAssigneeId) return [];
  const budget = recurringContractorBudget(p.recurringProjectConfig, p.amount);
  if (!budget || budget <= 0) return [];

  // A COMPLETED recurring project with no armed boundary has ended its cycle:
  // `onRecurringProjectCompleted` returns early on a null `nextCycleAt` and the
  // reset path always re-arms, so the only way to reach this pair is a cycle
  // that was deliberately stopped (freeze-recurring-projects.ts). Without this
  // the fallback below invents a fresh boundary from `now` and keeps forecasting
  // earnings for work that will never happen. A project still mid-flight keeps
  // the fallback — it simply has not been scheduled yet.
  if (p.status === 'completed' && !p.nextCycleAt) return [];

  const rows: PredictedPayout[] = [];
  // Anchor on the project's next cycle boundary; else compute the first from now.
  let date: Date | null =
    p.nextCycleAt ??
    projectNextCycleAt({
      type: p.serviceType as ServiceType | null,
      deliverableFrequency: p.deliverableFrequency as DeliverableFrequency | null,
      repeatsEvery: p.repeatsEvery,
      from: now,
    });
  const beneficiaryId = p.productionAssigneeId;
  for (let i = 1; i <= CONTRACTOR_CYCLE_HORIZON && date; i++) {
    // Scheduled cancel (spec §9.11): only forecast cycles up to the committed tail.
    if (p.cancelledAt && date.getTime() >= p.cancelledAt.getTime()) break;
    const week = (p.cycleCount ?? 0) + i;
    const id = `predicted-contractor-${p.id}-${week}`;
    rows.push({
      id,
      amount: budget.toFixed(2),
      paidAmount: '0',
      currency: 'AUD',
      beneficiaryId,
      beneficiaryAgencyId: null,
      agencyId: p.agencyId,
      purchaseId: p.purchaseId,
      status: 'upcoming',
      as: 'contractor',
      method: null,
      sourceBrandName: p.serviceName ?? p.title ?? null,
      transactionId: null,
      wiseFunding: null,
      createdAt: now,
      updatedAt: now,
      toPayAt: date,
      completelyPaidAt: null,
      predicted: true,
      breakdown: [
        {
          id: `${id}-bd`,
          payoutId: id,
          projectId: p.id,
          purchaseId: p.purchaseId,
          brandId: p.brandId,
          description: 'Predicted contractor budget',
          commissionType: 'contractorCommission',
          role: 'contractor',
          sourceServiceName: p.serviceName ?? p.packageName ?? null,
          amount: budget.toFixed(2),
          gst: '0',
          week,
          metadata: null,
          project: { taskTitle: p.taskTitle, title: p.title, serviceName: p.serviceName },
          paidAt: null,
        },
      ],
    });
    date = projectNextCycleAt({
      type: p.serviceType as ServiceType | null,
      deliverableFrequency: p.deliverableFrequency as DeliverableFrequency | null,
      repeatsEvery: p.repeatsEvery,
      from: date,
    });
  }
  return rows;
}

/**
 * TRACK B — forecast the weekly-billed roles for ONE purchase by simulating the
 * real split calculator. Recurring subscriptions: the per-week split is identical
 * every week, so we compute it once and replicate it across the horizon with
 * future dates. Payment plans: the deferred non-priority cut is reimbursed per
 * installment cycle (5..plan-end) — each cycle has its own gross.
 */
export async function predictWeeklyForPurchase(
  purchase: PurchaseRow,
  db: Db,
  now: Date,
  opts: { hasRecurring: boolean; recurringCancelAt?: Date | null },
): Promise<PredictedPayout[]> {
  const rows: PredictedPayout[] = [];
  const currentCycle = purchase.paymentCount ?? 0;

  // Recurring subscription: weekly split, same every week → compute once, replicate.
  if (opts.hasRecurring) {
    const res = await computePayoutSplit(
      purchase.id,
      {
        recurringOnly: true,
        week: currentCycle + 1,
        tier: 'all',
        grossOf: recurringWeeklyGross,
        excludeCancelledProjects: true,
      },
      db,
    );
    if (res && res.computedPayouts.length) {
      const brandName = res.brand?.businessName ?? null;
      for (let i = 1; i <= WEEKLY_RECURRING_HORIZON; i++) {
        // Scheduled cancel (spec §9.11): stop at the committed tail — once the
        // weekly charge would land on/after the effective cancel date, no more.
        const chargeAt = new Date(now.getTime() + i * 7 * DAY_MS);
        if (opts.recurringCancelAt && chargeAt.getTime() >= opts.recurringCancelAt.getTime()) break;
        const week = currentCycle + i;
        const toPayAt = payoutFriday('subscription', chargeAt);
        for (const cp of res.computedPayouts) {
          rows.push(rowFromComputed(cp, { purchaseId: purchase.id, brandName, week, toPayAt, now }));
        }
      }
    }
  }

  // Payment-plan one-off: reimburse the deferred non-priority cut across the
  // remaining installment cycles. Guaranteed (plans can't be cancelled).
  if (purchase.selectedPaymentPlan) {
    const durationWeeks =
      Number((purchase.selectedPaymentPlan as { durationWeeks?: number })?.durationWeeks) || 52;
    const start = Math.max(currentCycle + 1, REIMBURSEMENT_CYCLE);
    for (let w = start; w <= durationWeeks + 1; w++) {
      const res = await computePayoutSplit(
        purchase.id,
        {
          recurringOnly: false,
          week: w,
          tier: 'nonPriority',
          grossOf: (it) => reimbursementGrossForItem(it, w),
          reimbursement: true,
        },
        db,
      );
      if (!res || !res.computedPayouts.length) continue;
      const brandName = res.brand?.businessName ?? null;
      const toPayAt = payoutFriday('nonPriority', new Date(now.getTime() + (w - currentCycle) * 7 * DAY_MS));
      for (const cp of res.computedPayouts) {
        rows.push(rowFromComputed(cp, { purchaseId: purchase.id, brandName, week: w, toPayAt, now }));
      }
    }
  }

  return rows;
}

export interface PredictScope {
  /** 'contractor' = my assigned projects only; 'agency' = one agency; 'everyone' = all (super-admin). */
  mode: 'contractor' | 'agency' | 'everyone';
  agencyId: string | null;
  viewerId: string;
  /** How to filter the per-role rows for the viewer (mirrors the Past tab's payout scoping). */
  viewerFilter: 'owner' | 'staff' | 'all';
}

/**
 * Orchestrate both tracks for a viewer and return forecast rows already scoped to
 * them (so the Earnings page can drop them straight into the Future tab).
 */
export async function predictForViewer(db: Db, scope: PredictScope): Promise<PredictedPayout[]> {
  const now = new Date();

  // Contractor: only their own assigned, active, recurring projects (Track A).
  if (scope.mode === 'contractor') {
    const rows = await db
      .select()
      .from(projects)
      .where(
        and(
          eq(projects.productionAssigneeId, scope.viewerId),
          isNull(projects.deletedAt),
        ),
      );
    // Future-cancelled projects keep forecasting their committed tail;
    // predictContractorCycles clamps at cancelledAt (a past one yields no rows).
    return rows.flatMap((p) => predictContractorCycles(p, now));
  }

  // Agency / everyone: gather candidate (active) projects, run both tracks, scope.
  //
  // An agency earns from a purchase in THREE ways, so scoping candidates by the
  // producing `projects.agencyId` alone is wrong — it hides every cross-agency
  // sales cut. A sales/referred-by agency produces none of the work yet is owed
  // the 30% agency-sales commission (`beneficiaryAgencyId`), so we gather every
  // purchase where this agency is the producer, the proposal SENDER, OR the
  // buyer's REFERRED-BY agency, then forecast all their projects. The per-role
  // `viewerFilter` below still narrows the rows to this agency's own beneficiary
  // lines.
  //
  // Scaling: the REFERRED-BY leg is narrowed to MARKETPLACE purchases (no proposal).
  // A referred-by agency earns the sales cut ONLY on a marketplace buy — on a
  // proposal the sales cut goes to the SENDER agency instead (computePayoutSplit's
  // `isMarketplace` gate) — so a referred brand's proposal purchases would forecast
  // a fan-out of projects that yield this agency zero rows. For a busy default
  // agency (which refers many brands) that was the dominant source of wasted
  // simulation; excluding proposals there is correct, not just cheaper.
  let projRows: ProjectRow[];
  if (scope.mode === 'agency' && scope.agencyId) {
    const aId = scope.agencyId;
    const [produced, sent, referred] = await Promise.all([
      db.select({ id: projects.purchaseId }).from(projects).where(eq(projects.agencyId, aId)),
      db.select({ id: purchases.id }).from(purchases).where(eq(purchases.proposalSentByAgencyId, aId)),
      db
        .select({ id: purchases.id })
        .from(purchases)
        .innerJoin(brands, eq(purchases.brandId, brands.id))
        .innerJoin(users, eq(brands.ownerId, users.id))
        .where(
          and(
            eq(users.referredByAgencyId, aId),
            isNull(purchases.proposalSentByAgencyId),
            isNull(purchases.proposalSentById),
          ),
        ),
    ]);
    const relevant = [...new Set([...produced, ...sent, ...referred].map((r) => r.id).filter(Boolean))] as string[];
    projRows = relevant.length
      ? await db.select().from(projects).where(inArray(projects.purchaseId, relevant))
      : [];
  } else {
    projRows = await db.select().from(projects);
  }
  // Keep future-cancelled projects (still billing their committed tail, spec §9.11);
  // drop only soft-deleted and already-effective (past) cancellations.
  const active = projRows.filter(
    (p) => !p.deletedAt && !(p.cancelledAt && p.cancelledAt.getTime() <= now.getTime()),
  );

  // Track A only when the viewer can hold contractor rows (everyone/admin); agency
  // owner/staff filters drop them anyway.
  const contractorRows =
    scope.viewerFilter === 'all' ? active.flatMap((p) => predictContractorCycles(p, now)) : [];

  // Track B per purchase. Flag which purchases have an active recurring project.
  const recurringPurchaseIds = new Set(
    active
      .filter(
        (p) =>
          hasDeliverableCycle(p.serviceType as ServiceType | null) ||
          isBillingCycleWeekly(p.serviceType as ServiceType | null),
      )
      .map((p) => p.purchaseId)
      .filter(Boolean) as string[],
  );
  const purchaseIds = [...new Set(active.map((p) => p.purchaseId).filter(Boolean))] as string[];
  const purchaseRows = purchaseIds.length
    ? await db.select().from(purchases).where(inArray(purchases.id, purchaseIds))
    : [];

  // Per-purchase committed-tail clamp (spec §9.11): when EVERY active recurring
  // project on a purchase is cancelled-in-future, its weekly billing stops at the
  // latest such date. If any recurring sibling is still un-cancelled, no clamp —
  // it keeps forecasting (a cancelled sibling then slightly over-forecasts, an
  // acceptable approximation for a speculative forecast).
  const recurringCancelByPurchase = new Map<string, Date | null>();
  for (const p of active) {
    if (!p.purchaseId) continue;
    const isRecurring =
      hasDeliverableCycle(p.serviceType as ServiceType | null) ||
      isBillingCycleWeekly(p.serviceType as ServiceType | null);
    if (!isRecurring) continue;
    const prev = recurringCancelByPurchase.get(p.purchaseId);
    if (!p.cancelledAt) {
      recurringCancelByPurchase.set(p.purchaseId, null); // an active sibling ⇒ no clamp
    } else if (prev !== null) {
      const latest = prev && prev.getTime() > p.cancelledAt.getTime() ? prev : p.cancelledAt;
      recurringCancelByPurchase.set(p.purchaseId, latest);
    }
  }

  const weeklyRows: PredictedPayout[] = [];
  for (const pur of purchaseRows) {
    const hasRecurring = recurringPurchaseIds.has(pur.id);
    if (!hasRecurring && !pur.selectedPaymentPlan) continue; // one-off pay-in-full → no future
    weeklyRows.push(
      ...(await predictWeeklyForPurchase(pur, db, now, {
        hasRecurring,
        recurringCancelAt: recurringCancelByPurchase.get(pur.id) ?? null,
      })),
    );
  }

  let all = [...contractorRows, ...weeklyRows];
  if (scope.viewerFilter === 'owner')
    // The agency owner sees what the agency's own bank account receives.
    all = all.filter((r) => r.as === 'agency' && r.beneficiaryAgencyId === scope.agencyId);
  else if (scope.viewerFilter === 'staff') all = all.filter((r) => r.as === 'staff');
  return all;
}
