/**
 * Per-user beta extensions — the admin action "give this member N more days".
 *
 * The deadline lives on the USER, so an extension is a plain date bump plus an
 * audit row; the cohort is untouched and no other member is affected.
 *
 * Two consequences are deliberate and load-bearing:
 *
 *  • Extending a LAPSED member revives them. `isBetaUser()` reads the same
 *    deadline every paid gate funnels through, so pushing it into the future
 *    restores access instantly — no subscription surgery, no cache to bust.
 *  • Extending RE-ARMS the reminders. `beta_notices` is unique on
 *    (user, kind, deadline), so a new deadline is a new key and the 7/3/0-day
 *    emails fire again for it. Without the deadline in that key an extension
 *    would silently suppress every future warning.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { betaExtensions, users } from '../../db/schema.js';
import { addDays } from './dates.js';

type Db = typeof defaultDb;

export type BetaExtensionResult = {
  userId: string;
  previousEndsAt: Date | null;
  newEndsAt: Date;
  days: number;
  /** True when the member was already lapsed and this extension revived them. */
  revived: boolean;
};

/**
 * Add `days` to a user's beta deadline.
 *
 * The new deadline is counted from whichever is LATER: their current deadline, or
 * now. Extending someone who lapsed a month ago by 7 days must give them 7 usable
 * days — counting from the stale deadline would hand them an already-expired one.
 *
 * A user with no deadline (unlimited access) is left alone: there is nothing to
 * extend, and stamping one would REMOVE access they currently have.
 */
export async function extendUserBeta(
  db: Db,
  opts: {
    userId: string;
    days: number;
    reason?: string | null;
    extendedByUserId: string;
  },
  now = new Date(),
): Promise<BetaExtensionResult | { skipped: 'unlimited' | 'not_found' }> {
  const [user] = await db
    .select({
      id: users.id,
      isBetaUser: users.isBetaUser,
      betaEndsAt: users.betaEndsAt,
      betaStartedAt: users.betaStartedAt,
    })
    .from(users)
    .where(eq(users.id, opts.userId))
    .limit(1);
  if (!user) return { skipped: 'not_found' };
  if (user.isBetaUser && user.betaEndsAt == null) return { skipped: 'unlimited' };

  const previousEndsAt = user.betaEndsAt ?? null;
  const wasLapsed = previousEndsAt == null || previousEndsAt.getTime() <= now.getTime();
  const from = wasLapsed ? now : previousEndsAt;
  const newEndsAt = addDays(from, opts.days);

  await db
    .update(users)
    .set({
      // Re-granting the flag is what revives a lapsed member (and is a no-op for
      // a live one). Without it, an extension of someone whose flag was revoked
      // by hand would move a date that grants nothing.
      isBetaUser: true,
      betaEndsAt: newEndsAt,
      betaStartedAt: user.betaStartedAt ?? now,
      // Clear the acknowledgement so that if this beta ends again, the report
      // screen shows once more rather than being permanently dismissed.
      betaExpiryAcknowledgedAt: null,
    })
    .where(eq(users.id, opts.userId));

  await db.insert(betaExtensions).values({
    userId: opts.userId,
    days: opts.days,
    reason: opts.reason ?? null,
    previousEndsAt,
    newEndsAt,
    extendedByUserId: opts.extendedByUserId,
  });

  return {
    userId: opts.userId,
    previousEndsAt,
    newEndsAt,
    days: opts.days,
    revived: wasLapsed,
  };
}

/** A user's extension history, newest first (shown in the admin drawer). */
export async function listUserBetaExtensions(db: Db, userId: string) {
  return db
    .select()
    .from(betaExtensions)
    .where(eq(betaExtensions.userId, userId))
    .orderBy(betaExtensions.createdAt);
}
