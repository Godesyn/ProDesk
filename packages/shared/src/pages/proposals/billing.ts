/**
 * Client mirror of the server/Flutter BillingService. Computes one-off vs
 * recurring subtotals and produces payment-plan breakdowns for the billing
 * sidebar.
 */
import { priceSummary } from '../marketplace/pricing';
import { formatNumber, roundChargeUp } from '../../lib/utils';

export type BillingItem = {
  type: 'service' | 'heading' | 'custom';
  amount: string | number;
  quantity: number;
  upfrontFee?: string | number | null;
  isRecurring: boolean;
  isExcludedByBrand?: boolean;
  /** Which phase this item belongs to (drives when its recurring billing starts). */
  phaseId?: string | null;
  /** Source agency of the line (sales proposals): own vs resold drives the commission split. */
  agencyId?: string | null;
};

export type SchedulePhase = {
  id: string;
  name?: string | null;
  /** Days after purchase that this phase's projects start (0 = immediately). */
  startDelayDays?: number | null;
};

export type PaymentPlan = {
  id?: string;
  name?: string;
  upfrontPercentage?: number;
  interestRate?: number;
  durationWeeks?: number;
  isActive?: boolean;
};

export interface Subtotals {
  oneOffSubtotal: number;
  recurringUpfrontTotal: number;
  recurringWeeklyTotal: number;
}

const n = (v: string | number | null | undefined) => Number(v ?? 0) || 0;

export function computeSubtotals(items: BillingItem[], excludeBrandExcluded = false): Subtotals {
  const filtered = items.filter((i) => {
    if (i.type === 'heading') return false;
    if (excludeBrandExcluded && i.isExcludedByBrand) return false;
    return true;
  });
  const oneOff = filtered.filter((i) => !i.isRecurring).reduce((s, i) => s + n(i.amount) * i.quantity, 0);
  const recurringUpfront = filtered.filter((i) => i.isRecurring).reduce((s, i) => s + n(i.upfrontFee) * i.quantity, 0);
  const recurringWeekly = filtered.filter((i) => i.isRecurring).reduce((s, i) => s + n(i.amount) * i.quantity, 0);
  return {
    oneOffSubtotal: roundChargeUp(oneOff),
    recurringUpfrontTotal: roundChargeUp(recurringUpfront),
    recurringWeeklyTotal: roundChargeUp(recurringWeekly),
  };
}

/**
 * One-line price summary for a proposal, built from its billing items in the
 * shared `$100 + $10 per week` shape: the one-off subtotal plus every recurring
 * setup fee form the upfront amount; recurring weekly fees form the weekly
 * amount. Pass `excludeBrandExcluded` to summarise only the lines the brand kept.
 */
export function proposalPriceSummary(items: BillingItem[], excludeBrandExcluded = false): string {
  const s = computeSubtotals(items, excludeBrandExcluded);
  return priceSummary(s.oneOffSubtotal + s.recurringUpfrontTotal, s.recurringWeeklyTotal);
}

export interface PlanBreakdown {
  planLabel: string;
  upfront: number;
  weeklyDuring: number;
  weeklyAfter: number;
  durationWeeks?: number;
}

export function computePayInFull(oneOffTotal: number, recurringUpfront: number, recurringWeekly: number): PlanBreakdown {
  return {
    planLabel: 'Pay in Full',
    upfront: roundChargeUp(recurringUpfront + oneOffTotal),
    weeklyDuring: 0,
    weeklyAfter: roundChargeUp(recurringWeekly),
  };
}

export function computePaymentPlan(
  oneOffTotal: number,
  recurringUpfront: number,
  recurringWeekly: number,
  plan: PaymentPlan,
): PlanBreakdown {
  const interest = plan.interestRate ?? 0;
  const upfrontPct = plan.upfrontPercentage ?? 0;
  const duration = plan.durationWeeks ?? 0;
  const totalWithInterest = oneOffTotal * (1 + interest / 100);
  const oneOffUpfront = totalWithInterest * (upfrontPct / 100);
  const remaining = totalWithInterest - oneOffUpfront;
  const installment = duration > 0 ? remaining / duration : 0;
  return {
    planLabel: `${plan.name ?? 'Plan'} (${formatNumber(interest)}% flat)`,
    upfront: roundChargeUp(recurringUpfront + oneOffUpfront),
    weeklyDuring: roundChargeUp(recurringWeekly + installment),
    weeklyAfter: roundChargeUp(recurringWeekly),
    durationWeeks: duration,
  };
}

/* ─────────────────────────── Phase-aware schedule ─────────────────────────── */

/** A contiguous run of weeks billed at one constant weekly amount. */
export interface ScheduleSegment {
  /** First weekly payment in this run (week 1 = ~7 days after checkout). */
  fromWeek: number;
  /** Last week in this run, inclusive; `null` means it continues indefinitely. */
  toWeek: number | null;
  weekly: number;
}

export interface PaymentSchedule {
  /** Charged immediately at checkout (one-off deposit/price + every setup fee). */
  dueToday: number;
  /** Labelled make-up of `dueToday` (only shown when there's more than one part). */
  dueTodayParts: { label: string; amount: number }[];
  /** Post-checkout weekly timeline, collapsed into constant-amount runs. */
  segments: ScheduleSegment[];
  /** Week → phase name(s) that begin billing then (for timeline annotations). */
  phaseStarts: { week: number; label: string }[];
  /** True when any weekly payment follows the upfront. */
  hasWeekly: boolean;
  /** True when at least one phase is delayed (so the 7-day note is relevant). */
  hasDelayedPhase: boolean;
}

/**
 * The week of the FIRST weekly charge for a phase. Weekly billing always begins
 * 7 days after the phase's projects start (the first week is covered by the
 * upfront/setup fee), so an immediate phase first bills in week 1 and a phase
 * delayed by `d` days first bills in week round(d/7) + 1. Mirrors the server
 * (`addSubscriptionItemForProject` + the checkout 7-day trial).
 */
function phaseStartWeek(delayDays: number | null | undefined): number {
  const d = delayDays ?? 0;
  return d > 0 ? Math.round(d / 7) + 1 : 1;
}

/**
 * Build an intuitive, phase-aware payment schedule: what's due today, then the
 * weekly amount over time as instalments run out and delayed phases switch on.
 * Recurring items ignore the payment plan (setup today, weekly forever from their
 * phase start); one-off items split into a deposit-today + weekly instalments
 * under a plan, or the full price today when paying in full. A delayed phase only
 * defers its recurring weekly — its one-off price and setup fee are still due today.
 */
export function computePaymentSchedule(
  items: BillingItem[],
  phases: SchedulePhase[],
  plan: PaymentPlan | null,
  excludeBrandExcluded = false,
): PaymentSchedule {
  const billable = items.filter((i) => {
    if (i.type === 'heading') return false;
    if (excludeBrandExcluded && i.isExcludedByBrand) return false;
    return true;
  });
  const oneOff = billable.filter((i) => !i.isRecurring);
  const recurring = billable.filter((i) => i.isRecurring);

  const oneOffTotal = oneOff.reduce((s, i) => s + n(i.amount) * i.quantity, 0);
  const setupTotal = recurring.reduce((s, i) => s + n(i.upfrontFee) * i.quantity, 0);

  // One-off split (interest + deposit apply to one-off only).
  const interest = plan?.interestRate ?? 0;
  const upfrontPct = plan?.upfrontPercentage ?? 0;
  const duration = plan?.durationWeeks ?? 0;
  const oneOffWithInterest = oneOffTotal * (1 + interest / 100);
  const oneOffDeposit = plan ? oneOffWithInterest * (upfrontPct / 100) : oneOffTotal;
  const installment = plan && duration > 0 ? (oneOffWithInterest - oneOffDeposit) / duration : 0;

  const dueToday = roundChargeUp(oneOffDeposit + setupTotal);
  const dueTodayParts: { label: string; amount: number }[] = [];
  if (oneOffDeposit > 0) dueTodayParts.push({ label: plan ? 'One-off deposit' : 'One-off items', amount: roundChargeUp(oneOffDeposit) });
  if (setupTotal > 0) dueTodayParts.push({ label: 'Setup fees (one-time)', amount: roundChargeUp(setupTotal) });

  // Resolve an item's phase (null / unknown phase → first phase, mirroring the
  // builder's bucketing + the server's removePhase reassignment).
  const resolvePhase = (phaseId: string | null | undefined): SchedulePhase | undefined =>
    (phaseId ? phases.find((p) => p.id === phaseId) : undefined) ?? phases[0];
  const startWeekOf = (phaseId: string | null | undefined): number => phaseStartWeek(resolvePhase(phaseId)?.startDelayDays);

  // Weekly "events": +amount when a stream begins, -amount when instalments end.
  const events: { week: number; delta: number }[] = [];
  if (installment > 0 && duration > 0) {
    events.push({ week: 1, delta: installment });
    events.push({ week: duration + 1, delta: -installment });
  }
  for (const it of recurring) {
    const w = n(it.amount) * it.quantity;
    if (w <= 0) continue;
    events.push({ week: startWeekOf(it.phaseId), delta: w });
  }

  // Walk the change-points, collapsing equal-amount weeks into runs.
  const changeWeeks = [...new Set(events.map((e) => e.week))].sort((a, b) => a - b);
  const segments: ScheduleSegment[] = [];
  let current = 0;
  for (let i = 0; i < changeWeeks.length; i++) {
    const week = changeWeeks[i];
    current = round2(current + events.filter((e) => e.week === week).reduce((s, e) => s + e.delta, 0));
    const next = changeWeeks[i + 1] ?? null;
    if (current > 0.005) segments.push({ fromWeek: week, toWeek: next === null ? null : next - 1, weekly: roundChargeUp(current) });
  }

  // Annotate the weeks where a DELAYED phase with recurring work switches on.
  const phaseStarts: { week: number; label: string }[] = [];
  for (const ph of phases) {
    const d = ph.startDelayDays ?? 0;
    if (d <= 0) continue;
    const hasRecurring = recurring.some((it) => resolvePhase(it.phaseId)?.id === ph.id && n(it.amount) > 0);
    if (!hasRecurring) continue;
    phaseStarts.push({ week: phaseStartWeek(d), label: ph.name?.trim() || 'Phase' });
  }

  return {
    dueToday,
    dueTodayParts,
    segments,
    phaseStarts,
    hasWeekly: segments.length > 0,
    hasDelayedPhase: phases.some((p) => (p.startDelayDays ?? 0) > 0),
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export function computeAgencyCommissionPct(agencyCommission: number, salesAgencyCommission: number, affiliateCommission: number, opts?: { includeAffiliate?: boolean; includeSales?: boolean }) {
  let pct = agencyCommission;
  if (opts?.includeAffiliate) pct += affiliateCommission;
  if (opts?.includeSales) pct += salesAgencyCommission;
  return pct;
}
