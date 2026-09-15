/**
 * Beta programme arithmetic — deadlines, countdowns, and reminder windows.
 *
 * Deliberately dependency-free (no db, no env): this is the maths the whole
 * feature hangs on, and a fencepost error here either charges someone early or
 * never warns them at all. Keeping it importable on its own makes it unit-testable
 * without a database, and gives the deadline rules ONE home rather than three.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Lead times (in days) at which we warn a member their beta is ending. */
export const BETA_NOTICE_DAYS = [7, 3, 0] as const;

/** The three reminders, as (kind, lead-time) pairs. Order is 7 → 3 → 0. */
export const BETA_MILESTONES = [
  { kind: 'day_7' as const, leadDays: 7 },
  { kind: 'day_3' as const, leadDays: 3 },
  { kind: 'day_0' as const, leadDays: 0 },
];

/** Codes are matched case-insensitively and trimmed — URLs are user-typed. */
export function normalizeBetaCode(code: string): string {
  return code.trim().toLowerCase();
}

/**
 * The deadline a member joining for `durationDays` gets, counted from their own
 * signup instant. Two people on the same cohort who sign up a month apart finish a
 * month apart — that's the point of per-signup durations.
 */
export function betaDeadline(durationDays: number, from = new Date()): Date {
  return new Date(from.getTime() + durationDays * DAY_MS);
}

/**
 * Whole days from `now` until `endsAt`, rounded UP.
 *
 * Rounding up matters: a deadline six hours away must read "1 day left", not "0".
 * A member told "0 days" while they still have access reasonably concludes they've
 * already been cut off.
 */
export function daysUntil(endsAt: Date, now = new Date()): number {
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * The deadline window a milestone covers, relative to `now`.
 *
 * A lead of L days is the bucket of deadlines that are "L days away" — half-open
 * `(now + (L-1)d, now + L d]`. That upper bound is chosen so the bucket agrees with
 * {@link daysUntil}: a deadline in the day_7 bucket has `daysUntil === 7`, so the
 * email's "7 days left" and the in-app countdown can never contradict each other.
 *
 * `day_0` is the special case. Taken literally the formula would give
 * `(now - 1d, now]` — deadlines already in the PAST, so the day-of notice would
 * never fire for anyone still inside their beta. It therefore means "the next 24
 * hours": `(now, now + 1d]`. The email says "ends today", which is what a member
 * with hours left needs to read.
 *
 * The buckets are non-overlapping (0,1] · (2,3] · (6,7], which is what makes one
 * daily sweep send at most one notice per member.
 */
export function milestoneWindow(leadDays: number, now = new Date()) {
  const upperDays = Math.max(1, leadDays);
  return {
    after: new Date(now.getTime() + (upperDays - 1) * DAY_MS),
    atOrBefore: new Date(now.getTime() + upperDays * DAY_MS),
  };
}

/** Add days to a deadline (used by extensions). */
export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}
