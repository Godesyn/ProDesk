/**
 * Beta versions (cohorts) — the `?beta=<code>` codes an admin defines.
 *
 * A version carries only a DURATION. Joining stamps the member's own deadline
 * (`users.betaEndsAt = now + durationDays`), so the cohort is a template, not a
 * live gate: closing a version, editing its duration, or deleting it never
 * changes the beta anyone is already on. That is deliberate — a member's promised
 * end date must not move under them.
 */
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { betaVersions, users } from '../../db/schema.js';
import { betaDeadline, normalizeBetaCode } from './dates.js';

type Db = typeof defaultDb;

// The deadline arithmetic lives in ./dates.ts (dependency-free, unit-tested).
// Re-exported so callers of this module don't need a second import.
export { betaDeadline, normalizeBetaCode };

/** Look up a version by its signup code (case-insensitive), or null. */
export async function findBetaVersionByCode(db: Db, code: string) {
  const normalized = normalizeBetaCode(code);
  if (!normalized) return null;
  const [row] = await db
    .select()
    .from(betaVersions)
    .where(sql`lower(${betaVersions.code}) = ${normalized}`)
    .limit(1);
  return row ?? null;
}

/** How many users have joined a version (its enrolment, for the admin table + cap). */
export async function countBetaVersionMembers(db: Db, versionId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.betaVersionId, versionId));
  return Number(row?.n ?? 0);
}

/**
 * Why a code can't be joined right now, or null when it can. Returned as a reason
 * string so the signup screen can say something specific rather than failing mute.
 */
export type BetaJoinRefusal = 'unknown_code' | 'closed' | 'full';

/**
 * Resolve a signup code into the grant to stamp on a new user.
 *
 * Returns `{ refusal }` instead of throwing: an unknown or closed code must never
 * block a signup. The user still gets an account — just without beta access,
 * which is exactly what would have happened had they not used the link.
 */
export async function resolveBetaJoin(
  db: Db,
  code: string,
  now = new Date(),
): Promise<
  | { refusal: BetaJoinRefusal; version?: undefined; endsAt?: undefined }
  | {
      refusal: null;
      version: typeof betaVersions.$inferSelect;
      endsAt: Date;
    }
> {
  const version = await findBetaVersionByCode(db, code);
  if (!version) return { refusal: 'unknown_code' };
  if (!version.active) return { refusal: 'closed' };
  if (version.signupLimit != null) {
    const joined = await countBetaVersionMembers(db, version.id);
    if (joined >= version.signupLimit) return { refusal: 'full' };
  }
  return {
    refusal: null,
    version,
    endsAt: betaDeadline(version.durationDays, now),
  };
}

/**
 * How long after account creation a beta code may still be redeemed.
 *
 * `auth.ensureUser` is the stamping point, but it is not guaranteed to be the
 * first write: redeeming the verification link on a second device can provision
 * the `users` row via `auth.markEmailVerified` first, and the code would then be
 * lost. So the join is also attempted on an EXISTING row — bounded by this window
 * so the path stays a provisioning fix-up and can never be used by an established
 * account to grant itself free access by appending `?beta=…` to a URL.
 */
export const BETA_JOIN_WINDOW_MS = 10 * 60 * 1000;


/**
 * Redeem a beta code for a user who has just been provisioned. No-op (returning
 * null) when they're already enrolled, when the account is older than the join
 * window, or when the code isn't joinable.
 *
 * Returns the applied grant so the caller can log/report it.
 */
export async function joinBetaOnProvisioning(
  db: Db,
  user: {
    id: string;
    isBetaUser: boolean;
    betaVersionId: string | null;
    createdAt: Date | null;
  },
  code: string,
  now = new Date(),
): Promise<{ versionId: string; versionCode: string; endsAt: Date } | null> {
  // Never overwrite an existing grant — including a LAPSED one, whose
  // betaVersionId is still set. A finished beta must not be restartable by
  // re-visiting the signup link; that's what admin extensions are for.
  if (user.isBetaUser || user.betaVersionId != null) return null;
  const createdAt = user.createdAt?.getTime() ?? 0;
  if (now.getTime() - createdAt > BETA_JOIN_WINDOW_MS) return null;

  const join = await resolveBetaJoin(db, code, now);
  if (join.refusal !== null) return null;

  await db
    .update(users)
    .set({
      isBetaUser: true,
      betaVersionId: join.version.id,
      betaStartedAt: now,
      betaEndsAt: join.endsAt,
    })
    .where(eq(users.id, user.id));
  return {
    versionId: join.version.id,
    versionCode: join.version.code,
    endsAt: join.endsAt,
  };
}

/**
 * Every version with its live enrolment counts, for the admin panel. `active`
 * counts members whose beta hasn't lapsed yet; `expired` is the rest.
 */
export async function listBetaVersionsWithCounts(db: Db) {
  const versions = await db
    .select()
    .from(betaVersions)
    .orderBy(sql`${betaVersions.createdAt} desc`);
  if (versions.length === 0) return [];

  const counts = await db
    .select({
      versionId: users.betaVersionId,
      total: count(),
      live: sql<number>`count(*) filter (where ${users.isBetaUser} and (${users.betaEndsAt} is null or ${users.betaEndsAt} > now()))`,
    })
    .from(users)
    .where(isNotNull(users.betaVersionId))
    .groupBy(users.betaVersionId);

  const byId = new Map(
    counts.map((c) => [
      c.versionId as string,
      { total: Number(c.total), live: Number(c.live) },
    ]),
  );
  return versions.map((v) => {
    const c = byId.get(v.id) ?? { total: 0, live: 0 };
    return {
      ...v,
      memberCount: c.total,
      activeMemberCount: c.live,
      expiredMemberCount: c.total - c.live,
      /** Null when uncapped; otherwise how many seats remain. */
      seatsRemaining: v.signupLimit == null ? null : Math.max(0, v.signupLimit - c.total),
    };
  });
}

/**
 * Members of a version with their remaining days, newest signup first. Paginated
 * because a cohort can be large — this list is per-version, not per-platform.
 */
export async function listBetaVersionMembers(
  db: Db,
  versionId: string,
  opts: { limit: number; offset: number; search?: string },
) {
  const filters = [eq(users.betaVersionId, versionId)];
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim()}%`;
    filters.push(
      sql`(${users.email} ilike ${q} or coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '') ilike ${q})`,
    );
  }
  const where = and(...filters);
  const [rows, [{ value: total }]] = await Promise.all([
    db
      .select({
        id: users.id,
        email: users.email,
        firstName: users.firstName,
        lastName: users.lastName,
        isBetaUser: users.isBetaUser,
        betaStartedAt: users.betaStartedAt,
        betaEndsAt: users.betaEndsAt,
        betaExpiryAcknowledgedAt: users.betaExpiryAcknowledgedAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(sql`${users.betaEndsAt} asc nulls last`)
      .limit(opts.limit)
      .offset(opts.offset),
    db.select({ value: count() }).from(users).where(where),
  ]);
  return { rows, total: Number(total) };
}
