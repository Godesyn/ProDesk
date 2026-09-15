/**
 * A user's beta state, as every frontend needs to see it.
 *
 * `packages/shared/src/beta` polls this on load and renders one of three things:
 *   • nothing            — not a beta user,
 *   • the countdown pill — beta live (with a heads-up as the deadline nears),
 *   • the expiry screen  — beta lapsed (full-screen once, then a banner).
 *
 * Authority lives entirely on the user row (`isBetaUser` + `betaEndsAt`), the same
 * two columns `isBetaUser()` in modules/feature-subscriptions/entitlements reads
 * to decide access. Keeping both derived from one source is what guarantees the UI
 * and the gates flip at the same instant.
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { betaVersions, users } from '../../db/schema.js';
import { BETA_NOTICE_DAYS, daysUntil } from './dates.js';

type Db = typeof defaultDb;

// Countdown arithmetic lives in ./dates.ts (dependency-free, unit-tested).
export { BETA_NOTICE_DAYS, daysUntil };

export type BetaStatus = {
  /** Is this user in the beta programme at all (live or lapsed)? */
  enrolled: boolean;
  /** Beta access is live right now — mirrors entitlements.isBetaUser exactly. */
  active: boolean;
  /** Beta was granted with a deadline that has now passed. */
  expired: boolean;
  /** The deadline, or null for the unlimited hand-granted access. */
  endsAt: Date | null;
  /** Whole days until `endsAt` (0 on the final day). Null when unlimited/lapsed. */
  daysRemaining: number | null;
  /** True inside the final week — the UI escalates the banner from here. */
  endingSoon: boolean;
  /** Set once the user has seen the post-expiry report screen. */
  acknowledgedAt: Date | null;
  startedAt: Date | null;
  version: { id: string; code: string; label: string | null } | null;
};

/** Not in the programme — the shape the UI treats as "render nothing". */
const NOT_ENROLLED: BetaStatus = {
  enrolled: false,
  active: false,
  expired: false,
  endsAt: null,
  daysRemaining: null,
  endingSoon: false,
  acknowledgedAt: null,
  startedAt: null,
  version: null,
};

export async function betaStatus(
  db: Db,
  userId: string,
  now = new Date(),
): Promise<BetaStatus> {
  const [row] = await db
    .select({
      isBetaUser: users.isBetaUser,
      betaEndsAt: users.betaEndsAt,
      betaStartedAt: users.betaStartedAt,
      betaExpiryAcknowledgedAt: users.betaExpiryAcknowledgedAt,
      versionId: betaVersions.id,
      versionCode: betaVersions.code,
      versionLabel: betaVersions.label,
    })
    .from(users)
    .leftJoin(betaVersions, eq(users.betaVersionId, betaVersions.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!row?.isBetaUser) return NOT_ENROLLED;

  const endsAt = row.betaEndsAt ?? null;
  // No deadline = the legacy unlimited grant: permanently active, never warned.
  const active = endsAt == null || endsAt.getTime() > now.getTime();
  const daysRemaining = active && endsAt ? daysUntil(endsAt, now) : null;

  return {
    enrolled: true,
    active,
    expired: !active,
    endsAt,
    daysRemaining,
    endingSoon: daysRemaining != null && daysRemaining <= BETA_NOTICE_DAYS[0],
    acknowledgedAt: row.betaExpiryAcknowledgedAt ?? null,
    startedAt: row.betaStartedAt ?? null,
    version: row.versionId
      ? { id: row.versionId, code: row.versionCode!, label: row.versionLabel ?? null }
      : null,
  };
}
