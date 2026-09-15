/**
 * Pure deliverable-cycle math for cancellation scheduling & refunds (no DB / Stripe).
 *
 * Spec: `docs/delete-projects-subscriptions.md` — §3 (cancel scheduling, min term +
 * deliverable-cycle lock + tie-break) and §5 (refund pool).
 *
 * Model:
 *   • Billing is ALWAYS weekly. Payment k lands at `anchor + (k-1)·7d`; payment 1
 *     is the upfront (taken at checkout, or at phase activation for a delayed phase).
 *   • A deliverable cycle spans `repeatsEvery` units of `deliverableFrequency`,
 *     calendar-aware (a "month" is a calendar month — see {@link projectNextCycleAt}).
 *     Cycle N (1-based) starts at {@link cycleStart}; cycle 1 starts at the anchor.
 *   • `anchor` = the purchase `createdAt`, OR the phase start for a delayed phase (§3.3).
 *
 * Everything here is deterministic and unit-tested in `cycle-math.test.ts`.
 */
import { projectNextCycleAt } from './fulfillment-core.js';
import type { ServiceType } from '../../lib/service-type.js';
import type { DeliverableFrequency } from '../../lib/deliverable-frequency.js';

const DAY_MS = 86_400_000;

export interface CycleSpec {
  type: ServiceType | null | undefined;
  deliverableFrequency: DeliverableFrequency | null | undefined;
  repeatsEvery?: number | null;
  /** Billing anchor: purchase `createdAt`, or the phase start for a delayed phase. */
  anchor: Date;
}

/** Advance one deliverable cycle from `from`; null for non-cycling types. */
function nextCycle(spec: CycleSpec, from: Date): Date | null {
  return projectNextCycleAt({
    type: spec.type,
    deliverableFrequency: spec.deliverableFrequency,
    repeatsEvery: spec.repeatsEvery,
    from,
  });
}

/** Start date of cycle N (1-based). Cycle 1 starts at the anchor. */
export function cycleStart(n: number, spec: CycleSpec): Date {
  let d = new Date(spec.anchor);
  for (let i = 1; i < Math.max(1, n); i++) {
    const next = nextCycle(spec, d);
    if (!next) break; // non-cycling type: every "cycle" collapses to the anchor
    d = next;
  }
  return d;
}

/**
 * Count of weekly payments that land STRICTLY BEFORE `date`. Payment k lands at
 * `anchor + (k-1)·7d`, so a payment falling exactly ON a cycle boundary belongs to
 * the new cycle and is NOT counted as "before".
 */
export function weeklyPaymentsBefore(anchor: Date, date: Date): number {
  const days = Math.round((date.getTime() - anchor.getTime()) / DAY_MS);
  if (days <= 0) return 0;
  return Math.ceil(days / 7);
}

/** 1-based deliverable-cycle index that the p-th weekly payment falls in. */
export function cycleOfPayment(p: number, spec: CycleSpec): number {
  const payTime = spec.anchor.getTime() + Math.max(0, p - 1) * 7 * DAY_MS;
  let c = 1;
  let start = new Date(spec.anchor);
  for (;;) {
    const next = nextCycle(spec, start);
    if (!next || next.getTime() > payTime) break;
    start = next;
    c++;
  }
  return c;
}

/**
 * §5 refund pool — how many weekly payments are refundable on a delete: those
 * collected within the CURRENT (in-progress) deliverable cycle. Earlier cycles are
 * earned/locked. The current cycle starts at `cycleStart(cycleCount)`; the pool is
 * every payment collected on/after that start (cycle 1 includes the upfront).
 */
export function refundableCyclePoolCount(
  spec: CycleSpec & { cycleCount: number; paymentCount: number },
): number {
  const start = cycleStart(Math.max(1, spec.cycleCount), spec);
  const before = weeklyPaymentsBefore(spec.anchor, start);
  return Math.max(0, spec.paymentCount - before);
}

/**
 * The project's CURRENT deliverable cycle number, 1-based. Legacy rows may hold
 * 0/null in `cycleCount`; both mean "first cycle".
 */
export function currentCycleNumber(project: { cycleCount: number | null }): number {
  return Math.max(project.cycleCount ?? 1, 1);
}

/**
 * §6 completion gate — has the deliverable cycle `cycle` (1-based) completed, given
 * the project's CURRENT cycle (`cycleCount`, 1-based) and status? Complete once the
 * project has advanced past it (`cycleCount > cycle`), or it is the cycle currently in
 * flight and that has just completed (`cycleCount === cycle && status 'completed'`) —
 * the terminal-cycle trigger so a final cycle's held payout still releases.
 */
export function isDeliverableCycleComplete(
  cycle: number,
  project: { cycleCount: number | null; status: string },
): boolean {
  const cc = project.cycleCount ?? 1;
  return cc > cycle || (cc === cycle && project.status === 'completed');
}

/**
 * §3 — the cycle index whose START is the effective cancellation boundary (billing
 * stops there; the weekly charge on/after it is suppressed). It is the later of:
 *   • the minimum-term floor — `minTerm` full cycles must be paid → boundary = cycle
 *     `minTerm + 1` (no floor when `minTerm` is 0), and
 *   • the locked cycle — the cancellation completes whichever cycle is committed. A
 *     cycle locks once the prior cycle's last payment lands, so the locked cycle is
 *     the one the NEXT payment (`paymentCount + 1`) falls into; its boundary is one
 *     cycle later.
 */
export function cancellationCycleIndex(
  spec: CycleSpec & { minTerm: number; paymentCount: number },
): number {
  const floorIndex = spec.minTerm > 0 ? spec.minTerm + 1 : 1;
  const lockedIndex = cycleOfPayment(spec.paymentCount + 1, spec) + 1;
  return Math.max(floorIndex, lockedIndex);
}

/**
 * §3 — the effective cancellation date: the cycle boundary at which billing stops.
 * The Stripe wiring sets `cancel_at` to just before this date's weekly charge so the
 * brand is charged through the locked cycle + minimum term and never one cycle more.
 * For a delayed phase, pass the phase start as `spec.anchor` (§3.3).
 */
export function scheduledCancellationDate(
  spec: CycleSpec & { minTerm: number; paymentCount: number },
): Date {
  return cycleStart(cancellationCycleIndex(spec), spec);
}
