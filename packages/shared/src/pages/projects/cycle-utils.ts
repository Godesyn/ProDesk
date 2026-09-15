/**
 * Client-side deliverable-cycle helpers — build the "cycles rail" for cycling
 * projects (recurringService / recurringProductShips) from the project row +
 * its `project_cycles` history. Date math mirrors the server's
 * projectNextCycleAt (calendar-aware months/years, anchored — never drifts).
 */
import { hasDeliverableCycle, type ServiceType } from '@server/lib/service-type';
import type { DeliverableFrequency } from '@server/lib/deliverable-frequency';

export type CycleSnapshot = {
  cycleNumber: number;
  briefContext: string | null;
  briefDocuments: unknown[] | null;
  startedAt: string | Date | null;
  completedAt: string | Date | null;
};

export type CycleProject = {
  serviceType: string | null;
  deliverableFrequency: string | null;
  repeatsEvery: number | null;
  cycleCount: number | null;
  nextCycleAt: string | Date | null;
  createdAt: string | Date | null;
  status: string;
};

export type CycleCell = {
  n: number;
  state: 'completed' | 'current' | 'upcoming';
  /** Short calendar label for the rail cell (e.g. "Jul 2026", "13 Jul"). */
  label: string;
  completedAt: Date | null;
  /** When an upcoming cycle opens (from nextCycleAt, drift-free). */
  opensAt: Date | null;
  /** Per-cycle brief: snapshot for completed cycles, pre-brief for future ones. */
  briefContext: string | null;
  briefDocuments: unknown[];
};

export const isCycleBased = (p: Pick<CycleProject, 'serviceType'>): boolean =>
  hasDeliverableCycle(p.serviceType as ServiceType | null);

/** The project's current cycle number, 1-based (legacy rows may hold 0/null). */
export const currentCycleOf = (p: Pick<CycleProject, 'cycleCount'>): number =>
  Math.max(p.cycleCount ?? 1, 1);

/** A deliverable row's cycle, defaulting legacy (null) rows to the current cycle. */
export const cycleOfRow = (row: { cycle?: number | null }, current: number): number =>
  row.cycle ?? current;

/** Advance `k` deliverable cycles from `from` (calendar-aware, mirrors the server). */
export function advanceCycles(from: Date, freq: DeliverableFrequency | string, every: number, k = 1): Date {
  const n = new Date(from);
  const step = Math.max(1, every) * Math.max(0, k);
  switch (freq) {
    case 'weekly': n.setDate(n.getDate() + 7 * step); break;
    case 'monthly': n.setMonth(n.getMonth() + step); break;
    case 'yearly': n.setFullYear(n.getFullYear() + step); break;
    default: n.setDate(n.getDate() + step); break; // daily / unknown → days
  }
  return n;
}

/** Human cadence label: "Monthly", "Fortnightly", "Quarterly", "Every 5 days"… */
export function cadenceLabel(freq: string | null, every: number | null): string {
  const n = every && every > 0 ? every : 1;
  if (freq === 'weekly') return n === 1 ? 'Weekly' : n === 2 ? 'Fortnightly' : `Every ${n} weeks`;
  if (freq === 'monthly') return n === 1 ? 'Monthly' : n === 3 ? 'Quarterly' : `Every ${n} months`;
  if (freq === 'yearly') return n === 1 ? 'Yearly' : `Every ${n} years`;
  if (freq === 'daily') return n === 1 ? 'Daily' : `Every ${n} days`;
  return 'Recurring';
}

const toDate = (v: string | Date | null | undefined): Date | null => (v ? new Date(v) : null);

/** Rail-cell calendar label sized to the cadence (months read as "Jul 2026", short cycles as "13 Jul"). */
function cycleDateLabel(d: Date | null, freq: string | null): string {
  if (!d) return '';
  if (freq === 'yearly') return String(d.getFullYear());
  if (freq === 'monthly') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * Build the full cycles rail: every past cycle, the current one, and at least
 * `minFuture` upcoming cycles (extended to cover any future cycle that already
 * has staged work or a pre-written brief).
 */
export function buildCycles(
  p: CycleProject,
  snapshots: CycleSnapshot[],
  opts: { minFuture?: number; extraCycles?: number[] } = {},
): CycleCell[] {
  if (!isCycleBased(p)) return [];
  const current = currentCycleOf(p);
  const freq = (p.deliverableFrequency ?? 'monthly') as string;
  const every = p.repeatsEvery ?? 1;
  const anchor = toDate(p.createdAt);
  const nextAt = toDate(p.nextCycleAt);
  const byN = new Map(snapshots.map((s) => [s.cycleNumber, s]));

  const minFuture = opts.minFuture ?? 2;
  const last = Math.max(current + minFuture, ...(opts.extraCycles ?? []), ...snapshots.map((s) => s.cycleNumber));

  const cells: CycleCell[] = [];
  for (let n = 1; n <= last; n++) {
    const snap = byN.get(n);
    const state: CycleCell['state'] = n < current ? 'completed' : n === current ? 'current' : 'upcoming';
    // Past/current cycles start `n-1` cycles after the anchor; future cycles
    // open `n-current-1` cycles after nextCycleAt (the current cycle's end).
    const startAt =
      state === 'upcoming'
        ? nextAt
          ? advanceCycles(nextAt, freq, every, n - current - 1)
          : anchor && advanceCycles(anchor, freq, every, n - 1)
        : anchor && advanceCycles(anchor, freq, every, n - 1);
    const completedAt = toDate(snap?.completedAt ?? null);
    cells.push({
      n,
      state,
      label: cycleDateLabel(state === 'completed' ? (completedAt ?? startAt) : startAt, freq) || `Cycle ${n}`,
      completedAt,
      opensAt: state === 'upcoming' ? startAt : null,
      briefContext: snap?.briefContext ?? null,
      briefDocuments: (snap?.briefDocuments as unknown[]) ?? [],
    });
  }
  return cells;
}

export const pad2 = (n: number): string => String(n).padStart(2, '0');
