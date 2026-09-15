/**
 * "Your beta is ending" reminders — 7 days out, 3 days out, and on the day.
 *
 * A daily cron calls `sweepBetaReminders`. For each milestone it selects the beta
 * users whose deadline falls inside that milestone's window and enqueues one email
 * carrying their full price report.
 *
 * Correctness at scale rests on three things:
 *
 *  • The SELECT is bounded by a deadline range and served by the partial index
 *    `users_beta_ends_at_idx` (WHERE is_beta_user), so the sweep costs the number
 *    of beta users near a deadline — not a scan of the users table.
 *  • Dedup is a UNIQUE row in `beta_notices` on (user, kind, deadline), claimed
 *    with `ON CONFLICT DO NOTHING` BEFORE the email is enqueued. Two overlapping
 *    sweeps (a retry, two workers) therefore can't double-send: only the sweep
 *    that wins the insert enqueues.
 *  • The deadline is part of the key, so an extension re-arms all three
 *    milestones for the new date instead of being suppressed as already-sent.
 *
 * Windows are half-open day buckets measured from the run instant, which makes the
 * milestones mutually exclusive: a user is warned once per milestone even though
 * the sweep runs every day.
 */
import { and, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { betaNotices, users } from '../../db/schema.js';
import { enqueueEmail } from '../../lib/notify.js';
import { BETA_MILESTONES, milestoneWindow } from './dates.js';

type Db = typeof defaultDb;

// The milestones and their (non-overlapping, half-open) windows live in
// ./dates.ts — dependency-free so the bucketing is unit-tested without a DB.
export { BETA_MILESTONES, milestoneWindow };

export type BetaSweepResult = {
  /** Emails enqueued, per milestone. */
  sent: Record<string, number>;
  /** Users seen but already notified for this (milestone, deadline). */
  skipped: number;
  total: number;
};

/**
 * Enqueue every due reminder. Idempotent — safe to run repeatedly, and safe to run
 * concurrently with itself.
 */
export async function sweepBetaReminders(
  db: Db = defaultDb,
  now = new Date(),
): Promise<BetaSweepResult> {
  const sent: Record<string, number> = {};
  let skipped = 0;
  let total = 0;

  for (const { kind, leadDays } of BETA_MILESTONES) {
    const { after, atOrBefore } = milestoneWindow(leadDays, now);
    const due = await db
      .select({ id: users.id, betaEndsAt: users.betaEndsAt })
      .from(users)
      .where(
        and(
          eq(users.isBetaUser, true),
          isNotNull(users.betaEndsAt),
          gt(users.betaEndsAt, after),
          lte(users.betaEndsAt, atOrBefore),
        ),
      );

    sent[kind] = 0;
    for (const user of due) {
      total += 1;
      const deadline = user.betaEndsAt!;
      // Claim the send FIRST. The unique (user, kind, deadline) index means only
      // one caller can insert; anyone else gets zero rows back and skips. Doing
      // this before enqueueing is what makes a double-run a no-op rather than a
      // double email.
      const claimed = await db
        .insert(betaNotices)
        .values({ userId: user.id, kind, betaEndsAt: deadline })
        .onConflictDoNothing()
        .returning({ id: betaNotices.id });
      if (claimed.length === 0) {
        skipped += 1;
        continue;
      }
      await enqueueEmail('beta-ending', {
        userId: user.id,
        kind,
        betaEndsAt: deadline.toISOString(),
      });
      sent[kind] += 1;
    }
  }

  return { sent, skipped, total };
}

/**
 * Which reminders a user has already been sent for their CURRENT deadline. Shown
 * in the admin panel so support can see whether someone was warned before
 * complaining they weren't.
 */
export async function sentNoticesForCurrentDeadline(db: Db, userId: string) {
  return db
    .select({ kind: betaNotices.kind, sentAt: betaNotices.sentAt })
    .from(betaNotices)
    .where(
      and(
        eq(betaNotices.userId, userId),
        sql`${betaNotices.betaEndsAt} = (select ${users.betaEndsAt} from ${users} where ${users.id} = ${userId})`,
      ),
    );
}
