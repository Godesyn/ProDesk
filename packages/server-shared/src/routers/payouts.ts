import { z } from 'zod';
import { and, eq, count, desc, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure, superAdminProcedure } from '../trpc/trpc.js';
import { payouts, payoutBreakdowns, users, agencies, projects, payoutStatus } from '../db/schema.js';
import { assertAgencyAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { enrichReadiness } from '../modules/billing/payout-readiness.js';
import { withPayoutParties } from '../modules/billing/list-parties.js';
import { predictForViewer } from '../modules/billing/predict-earnings.js';
import { dispatchAllPayoutsNow } from '../modules/billing/dispatch.js';

// Derived from the DB enum rather than hand-listed: the copy that used to live
// here silently went stale when `stopped` was added, so the filter could not
// select the very payouts it was added to describe.
const statusEnum = z.enum(payoutStatus.enumValues);

const payoutAsEnum = z.enum(['admin', 'owner', 'staff', 'contractor', 'agency']);

/**
 * Resolve the role-scoped query filters for the current user, mirroring the
 * Flutter `earningsController` (PayoutAs + beneficiaryId/agencyId by role):
 *   - superAdmin       → all payouts (as: admin OR everything in showEveryones)
 *   - individual       → beneficiaryId == me, as: contractor
 *   - agencyStaff      → agencyId == selected, as: staff
 *   - agencyOwner/etc. → beneficiaryAgencyId == selected (what the agency's own
 *                        bank account receives: owner cut, redirected designee
 *                        cuts, and any agency-sales cut it earned).
 */
async function scopeForUser(ctx: { user: typeof users.$inferSelect; db: any }, agencyId?: string) {
  const u = ctx.user;
  if (u.isSuperAdmin) {
    // Admin viewing own payouts (the non-"everyone" tab). Flutter passes as: admin.
    return [eq(payouts.as, 'admin' as const)];
  }
  if (u.role === 'individualContractor') {
    return [eq(payouts.beneficiaryId, u.id), eq(payouts.as, 'contractor' as const)];
  }
  const aId = agencyId ?? u.selectedAgencyId ?? undefined;
  if (u.role === 'agencyStaff') {
    return aId ? [eq(payouts.agencyId, aId), eq(payouts.as, 'staff' as const)] : [eq(payouts.beneficiaryId, u.id)];
  }
  if (u.role === 'agencyOwner') {
    // Agency receipts land on the agency itself (beneficiaryAgencyId), not the owner user.
    return aId ? [eq(payouts.beneficiaryAgencyId, aId)] : [eq(payouts.beneficiaryId, u.id)];
  }
  // Brand roles / fallback: just their own payouts.
  return [eq(payouts.beneficiaryId, u.id)];
}

export const payoutsRouter = router({
  /**
   * Past payouts for the current user, role-scoped (PayoutAs). When `agencyId`
   * is given it is validated, otherwise the user's selected agency is used.
   * Mirrors `pastPayoutsProvider`/`watchPayouts`.
   */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        // Earnings page fetches the full set (no pagination UI) to split past/future client-side.
        limit: z.number().int().min(1).max(500).default(20),
        agencyId: z.string().uuid().optional(),
        status: statusEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.agencyId) await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const filters = await scopeForUser(ctx, input.agencyId);
      if (input.status) filters.push(eq(payouts.status, input.status));
      const where = and(...filters);

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(payouts).where(where).orderBy(desc(payouts.toPayAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(payouts).where(where),
      ]);
      return page(await withPayoutParties(ctx.db, await enrichReadiness(ctx.db, rows)), total, input);
    }),

  /**
   * Every payout across the platform (super-admin "everyone" view). Mirrors
   * `everyonePastPayoutsProvider`/`watchAllPayouts`. Supports an optional
   * beneficiary filter (the per-user filter dialog).
   */
  /**
   * Super-admin: force every schedulable payout to pay out immediately instead
   * of waiting for the weekly cron (Fri 23:59 UTC). Pulls future-dated
   * `upcoming`/`pending` payouts forward (`toPayAt = now`) and dispatches the
   * whole due pool. The completion gate inside `dispatchPayout` still holds, so
   * payouts whose work isn't done stay `pending` and won't disburse. Returns the
   * `{ dispatched, considered, retriedFailed, pulledForward }` tally so the admin
   * gets real feedback the cron never surfaces.
   */
  dispatchNow: superAdminProcedure.mutation(async ({ ctx }) => {
    return dispatchAllPayoutsNow(new Date(), ctx.db);
  }),

  allList: superAdminProcedure
    .input(
      paginationInput.extend({
        // Earnings page fetches the full set (no pagination UI) to split past/future client-side.
        limit: z.number().int().min(1).max(500).default(20),
        beneficiaryId: z.string().uuid().optional(),
        status: statusEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [];
      if (input.beneficiaryId) filters.push(eq(payouts.beneficiaryId, input.beneficiaryId));
      if (input.status) filters.push(eq(payouts.status, input.status));
      const where = filters.length ? and(...filters) : undefined;

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(payouts).where(where).orderBy(desc(payouts.toPayAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(payouts).where(where),
      ]);
      return page(await withPayoutParties(ctx.db, await enrichReadiness(ctx.db, rows)), total, input);
    }),

  /**
   * Distinct beneficiaries that appear in the payout set, for the super-admin
   * per-user filter dialog (`_UserFilterDialog`). Returns id/name/email/avatar.
   */
  beneficiaries: superAdminProcedure.query(async ({ ctx }) => {
    const ids = await ctx.db
      .selectDistinct({ id: payouts.beneficiaryId })
      .from(payouts);
    const idList = ids.map((r) => r.id).filter(Boolean) as string[];
    if (idList.length === 0) return [];
    const rows = await ctx.db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl })
      .from(users)
      .where(inArray(users.id, idList));
    return rows;
  }),

  /**
   * Agencies that appear as a payout's beneficiary (agency-received payouts), for
   * the super-admin "everyone" view's payee chip. Shaped like a beneficiary so the
   * client can key both users and agencies into one display map.
   */
  beneficiaryAgencies: superAdminProcedure.query(async ({ ctx }) => {
    const ids = await ctx.db
      .selectDistinct({ id: payouts.beneficiaryAgencyId })
      .from(payouts);
    const idList = ids.map((r: { id: string | null }) => r.id).filter(Boolean) as string[];
    if (idList.length === 0) return [];
    return ctx.db
      .select({ id: agencies.id, businessName: agencies.businessName, username: agencies.username, logoUrl: agencies.logoUrl })
      .from(agencies)
      .where(inArray(agencies.id, idList));
  }),

  /** Aggregate earnings for charts/stat cards. */
  summary: protectedProcedure.input(z.object({ agencyId: z.string().uuid().optional() }).optional()).query(async ({ ctx, input }) => {
    if (input?.agencyId) await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
    const filters = await scopeForUser(ctx, input?.agencyId);
    const rows = await ctx.db
      .select({ status: payouts.status, sum: sql<string>`coalesce(sum(${payouts.amount}), 0)` })
      .from(payouts)
      .where(and(...filters))
      .groupBy(payouts.status);

    const byStatus: Record<string, number> = {};
    let totalEarned = 0;
    for (const r of rows) {
      const n = Number(r.sum);
      byStatus[r.status] = n;
      if (r.status === 'paid' || r.status === 'received') totalEarned += n;
    }
    return {
      totalEarned,
      pending: (byStatus['pending'] ?? 0) + (byStatus['processing'] ?? 0),
      upcoming: byStatus['upcoming'] ?? 0,
      byStatus,
    };
  }),

  /**
   * Payouts linked to a given project (via their breakdown rows), for the
   * "Related payouts" section on the project detail screen. Agency-only:
   * `assertAgencyAccess` throws FORBIDDEN for the assigned contractor and for
   * brand users, so payout figures never reach them. Each returned payout carries
   * its full breakdown (with project task titles) so the shared PayoutTile renders
   * identically to the earnings page.
   */
  forProject: protectedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const proj = (await ctx.db.select({ agencyId: projects.agencyId }).from(projects).where(eq(projects.id, input.projectId)).limit(1))[0];
    if (!proj) throw new TRPCError({ code: 'NOT_FOUND' });
    if (!proj.agencyId) return [];
    await assertAgencyAccess(ctx, proj.agencyId);

    const linkRows = await ctx.db
      .selectDistinct({ payoutId: payoutBreakdowns.payoutId })
      .from(payoutBreakdowns)
      .where(eq(payoutBreakdowns.projectId, input.projectId));
    const payoutIds = linkRows.map((r: { payoutId: string }) => r.payoutId);
    if (payoutIds.length === 0) return [];

    const rows = await ctx.db.select().from(payouts).where(inArray(payouts.id, payoutIds)).orderBy(desc(payouts.toPayAt));
    const enriched = await withPayoutParties(ctx.db, await enrichReadiness(ctx.db, rows));
    // Resolve user beneficiaries so the card can show the payee chip (avatar +
    // name). Agency beneficiaries already arrive via withPayoutParties.
    const beneficiaryIds = [...new Set(enriched.map((p) => p.beneficiaryId).filter(Boolean) as string[])];
    const beneficiaryRows = beneficiaryIds.length
      ? await ctx.db
          .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, profileUrl: users.profileUrl })
          .from(users)
          .where(inArray(users.id, beneficiaryIds))
      : [];
    const beneficiaryById = new Map(beneficiaryRows.map((u) => [u.id, u]));
    const breakdownRows = await ctx.db.query.payoutBreakdowns.findMany({
      where: inArray(payoutBreakdowns.payoutId, payoutIds),
      with: { project: { columns: { taskTitle: true, title: true, serviceName: true } } },
    });
    const byPayout = new Map<string, typeof breakdownRows>();
    for (const b of breakdownRows) {
      const list = byPayout.get(b.payoutId) ?? [];
      list.push(b);
      byPayout.set(b.payoutId, list);
    }
    return enriched.map((p) => ({
      ...p,
      beneficiaryUser: p.beneficiaryId ? beneficiaryById.get(p.beneficiaryId) ?? null : null,
      breakdown: byPayout.get(p.id) ?? [],
    }));
  }),

  detail: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const payout = (await ctx.db.select().from(payouts).where(eq(payouts.id, input.id)).limit(1))[0];
    if (!payout) throw new TRPCError({ code: 'NOT_FOUND' });
    const breakdown = await ctx.db.query.payoutBreakdowns.findMany({
      where: eq(payoutBreakdowns.payoutId, input.id),
      with: { project: { columns: { taskTitle: true, title: true, serviceName: true } } },
    });
    return { ...payout, breakdown };
  }),

  /**
   * Predict future (upcoming) earnings for the Earnings "Future" tab. Delegates
   * to the two-track predictor (docs/future-earnings.md): contractor budget per
   * deliverable cycle + every other role per weekly billing cycle, the latter
   * simulated through the real commission calculator so the forecast tracks live
   * payouts (incl. payment-plan deferral + spread reimbursement). Scope mirrors
   * `list`: super-admin everyone / agency owner / agency staff / contractor.
   */
  predictFutureEarnings: protectedProcedure
    .input(
      z
        .object({
          everyone: z.boolean().optional(),
          agencyId: z.string().uuid().optional(),
          as: payoutAsEnum.optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const u = ctx.user;
      if ((input?.everyone ?? false) && u.isSuperAdmin) {
        return predictForViewer(ctx.db, { mode: 'everyone', agencyId: null, viewerId: u.id, viewerFilter: 'all' });
      }
      const aId = input?.agencyId ?? u.selectedAgencyId ?? undefined;
      const isOwner = input?.as === 'owner' || u.role === 'agencyOwner';
      const isStaff = input?.as === 'staff' || u.role === 'agencyStaff';
      if ((isOwner || isStaff) && aId) {
        await assertAgencyAccess(ctx, aId, 'bankAccount');
        return predictForViewer(ctx.db, {
          mode: 'agency',
          agencyId: aId,
          viewerId: u.id,
          viewerFilter: isOwner ? 'owner' : 'staff',
        });
      }
      // Contractor / fallback: my assigned recurring projects (contractor track).
      return predictForViewer(ctx.db, { mode: 'contractor', agencyId: null, viewerId: u.id, viewerFilter: 'all' });
    }),
});
