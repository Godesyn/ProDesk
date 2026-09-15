import { z } from 'zod';
import { and, eq, or, ilike, count, desc, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { staff, agencies, brands, users } from '../db/schema.js';
import { assertAgencyAccess, assertBrandAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { enqueueEmail } from '../lib/notify.js';
import { onStaffInvited, onStaffInvitationAccepted, clearTasksByEntity } from './tasks.js';
import { handleStaffPermissionGranted, handleStaffPermissionRevoked } from '../modules/chat/threads.js';
import { maybeResetUserRole } from '../lib/user-role.js';

const PERMISSIONS = [
  'agencyDashboard', 'brandDashboard', 'clients', 'catalog', 'agencyProjects', 'brandProjects',
  'manageResources', 'documents', 'resources', 'brandGuidelines', 'invoice', 'subscriptions',
  'bankAccount', 'staffManagement', 'rolesAndCommissions', 'manageContractors', 'proposals',
  // `businessInfo` is split by context: `agencyBusinessInfo` (agency's own Info Hub
  // template library) vs `brandBusinessInfo` (a brand's own Info Hub). The legacy
  // `businessInfo` value is no longer offered (migrated away in the DB).
  'infin8', 'agencyBusinessInfo', 'brandBusinessInfo', 'agencyInfo', 'chatWithContractors', 'chatWithStaffs', 'chatWithBrands',
  // Per-tool brand permissions. Each satellite frontend gates on its own key(s):
  // `payments`/`paymentsViewer` (EziQuotes), `links`/`linksViewer` (short links),
  // `reviews`/`reviewsViewer` (Verdiict), `signatures` (SIGKITT — manage only, no
  // viewer role). These are grantable both in Prodesk's staff editor AND from each
  // tool's own Team panel — see docs/permissions.md "Cross-frontend team".
  'payments', 'paymentsViewer', 'links', 'linksViewer', 'reviews', 'reviewsViewer', 'signatures', 'logo',
  // Project Management (Kanban workflow). Each gates a set of board transitions
  // for the project's OWNING agency only — see docs/kanban-permissions.md.
  'addBrief', 'allocatePeople', 'approveDeliverable',
] as const;
type Permission = (typeof PERMISSIONS)[number];

// Permission lists are FILTERED to the known vocabulary, not hard-rejected: a
// stale client (or a row predating a permission's removal, e.g. the dropped
// `signaturesViewer`) may echo back values that no longer exist, and that must
// not fail the whole mutation — unknown values are silently dropped.
const permissionListInput = z
  .array(z.string())
  .transform((list) => list.filter((p): p is Permission => (PERMISSIONS as readonly string[]).includes(p)));

const CHAT_PERMS = new Set(['chatWithContractors', 'chatWithStaffs', 'chatWithBrands']);

/** Whether a permission change touched a chat permission (worth re-running thread side-effects). */
function chatPermsChanged(before: readonly string[], after: readonly string[]): boolean {
  const b = before.filter((p) => CHAT_PERMS.has(p)).sort().join(',');
  const a = after.filter((p) => CHAT_PERMS.has(p)).sort().join(',');
  return b !== a;
}

export const staffRouter = router({
  /** Paginated staff for an organization (agency or brand). */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        orgType: z.enum(['agency', 'brand']),
        orgId: z.string().uuid(),
        status: z.enum(['pending', 'active', 'removed']).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.orgType === 'agency') await assertAgencyAccess(ctx, input.orgId, 'staffManagement');
      else await assertBrandAccess(ctx, input.orgId, 'staffManagement');

      const orgCol = input.orgType === 'agency' ? staff.agencyId : staff.brandId;
      const filters = [eq(orgCol, input.orgId)];
      if (input.status) filters.push(eq(staff.status, input.status));
      if (input.search) filters.push(ilike(staff.email, `%${input.search}%`));
      const where = and(...filters);

      const [rawRows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ staff, users })
          .from(staff)
          .leftJoin(users, eq(staff.userId, users.id))
          .where(where)
          .orderBy(desc(staff.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(staff).where(where),
      ]);
      const rows = rawRows.map((row) => ({
        ...row.staff,
        firstName: row.users?.firstName ?? null,
        lastName: row.users?.lastName ?? null,
        profileUrl: row.users?.profileUrl ?? null,
      }));
      return page(rows, total, input);
    }),

  invite: protectedProcedure
    .input(
      z.object({
        orgType: z.enum(['agency', 'brand']),
        orgId: z.string().uuid(),
        email: z.string().email(),
        permissions: permissionListInput.default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.orgType === 'agency') await assertAgencyAccess(ctx, input.orgId, 'staffManagement');
      else await assertBrandAccess(ctx, input.orgId, 'staffManagement');

      // If the invitee already has an account, link the userId now so accept/thread
      // side-effects can resolve them.
      const existingUser = (await ctx.db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1))[0];

      const [created] = await ctx.db
        .insert(staff)
        .values({
          email: input.email,
          type: input.orgType,
          agencyId: input.orgType === 'agency' ? input.orgId : null,
          brandId: input.orgType === 'brand' ? input.orgId : null,
          userId: existingUser?.id ?? null,
          permissions: input.permissions,
          status: 'pending',
          invitedBy: ctx.user.id,
          invitedAt: new Date(),
        })
        .returning();

      await enqueueEmail('staff-invite', { staffId: created.id, origin: ctx.clientOrigin });

      // Surface the invitation as a task to the invitee (if they have an account).
      if (existingUser) {
        const orgName = await orgNameOf(ctx.db, input.orgType, input.orgId);
        await onStaffInvited(
          { staffId: created.id, assigneeId: existingUser.id, orgName, orgId: input.orgId, orgType: input.orgType, invitedBy: ctx.user.id },
          ctx.db,
        );
      }
      return created;
    }),

  /**
   * Accept a staff invitation: link the userId, flip to active, complete the
   * invitation task, and run the chat-thread fan-out for any chat permissions.
   */
  accept: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const member = (await ctx.db.select().from(staff).where(eq(staff.id, input.id)).limit(1))[0];
      if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
      // Only block claiming a seat already linked to a different user; otherwise
      // accept whoever redeems and adopt the email they actually use (no rejection
      // on a different address).
      if (member.userId && member.userId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
      const [updated] = await ctx.db
        .update(staff)
        .set({ userId: ctx.user.id, email: ctx.user.email, status: 'active', acceptedAt: new Date() })
        .where(eq(staff.id, input.id))
        .returning();
      await onStaffInvitationAccepted(member.id, ctx.user.id, ctx.db);
      await handleStaffPermissionGranted(
        ctx.user.id,
        { agencyId: updated.agencyId, brandId: updated.brandId },
        updated.permissions,
        ctx.db,
      );
      return updated;
    }),

  updatePermissions: protectedProcedure
    .input(z.object({ id: z.string().uuid(), permissions: permissionListInput }))
    .mutation(async ({ ctx, input }) => {
      const member = (await ctx.db.select().from(staff).where(eq(staff.id, input.id)).limit(1))[0];
      if (!member) throw new Error('Staff member not found');
      if (member.agencyId) await assertAgencyAccess(ctx, member.agencyId, 'staffManagement');
      else if (member.brandId) await assertBrandAccess(ctx, member.brandId, 'staffManagement');

      const before = member.permissions;
      const [updated] = await ctx.db
        .update(staff)
        .set({ permissions: input.permissions })
        .where(eq(staff.id, input.id))
        .returning();

      // Chat-thread side effects: create threads for newly granted chat perms,
      // archive memberships for revoked ones (ports handleStaffPermission*).
      if (member.userId && member.status === 'active' && chatPermsChanged(before, input.permissions)) {
        const org = { agencyId: updated.agencyId, brandId: updated.brandId };
        await handleStaffPermissionGranted(member.userId, org, input.permissions, ctx.db);
        await handleStaffPermissionRevoked(member.userId, org, input.permissions, ctx.db);
      }
      return updated;
    }),

  remove: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const member = (await ctx.db.select().from(staff).where(eq(staff.id, input.id)).limit(1))[0];
    if (!member) throw new Error('Staff member not found');
    if (member.agencyId) await assertAgencyAccess(ctx, member.agencyId, 'staffManagement');
    else if (member.brandId) await assertBrandAccess(ctx, member.brandId, 'staffManagement');
    await ctx.db.update(staff).set({ status: 'removed' }).where(eq(staff.id, input.id));
    // Delete the (pending) invitation task — removing the invite removes the task.
    await clearTasksByEntity(input.id, ctx.db);
    if (member.userId) {
      // Revoke all chat threads (no remaining chat perms).
      await handleStaffPermissionRevoked(member.userId, { agencyId: member.agencyId, brandId: member.brandId }, [], ctx.db);
      // If this seat was the user's only identity, drop them back to role-selection.
      await maybeResetUserRole(ctx.db, member.userId);
    }
    return { id: input.id };
  }),

  /** Re-send the invitation email for a still-pending member. */
  resend: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const member = (await ctx.db.select().from(staff).where(eq(staff.id, input.id)).limit(1))[0];
    if (!member) throw new Error('Staff member not found');
    if (member.agencyId) await assertAgencyAccess(ctx, member.agencyId, 'staffManagement');
    else if (member.brandId) await assertBrandAccess(ctx, member.brandId, 'staffManagement');
    await enqueueEmail('staff-invite', { staffId: member.id, origin: ctx.clientOrigin });
    return { id: member.id };
  }),

  /**
   * Pending staff invitations addressed to the signed-in user — for the in-app
   * "you've been invited" prompt that surfaces on every frontend the moment an
   * existing user lands (no email-link round-trip needed). Matches a seat either
   * by the linked userId (set at invite time when the invitee already had an
   * account) OR by a case-insensitive email match (accounts created after the
   * invite was sent). Returns just what the prompt renders — the org name, type,
   * granted permissions, and inviter name — so the client can decide relevance
   * per frontend and let the user accept/decline.
   */
  myPendingInvitations: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: staff.id,
        type: staff.type,
        permissions: staff.permissions,
        agencyName: agencies.businessName,
        brandName: brands.businessName,
        inviterFirst: users.firstName,
        inviterLast: users.lastName,
      })
      .from(staff)
      .leftJoin(agencies, eq(staff.agencyId, agencies.id))
      .leftJoin(brands, eq(staff.brandId, brands.id))
      .leftJoin(users, eq(staff.invitedBy, users.id))
      .where(
        and(
          eq(staff.status, 'pending'),
          or(
            eq(staff.userId, ctx.user.id),
            sql`lower(${staff.email}) = lower(${ctx.user.email})`,
          ),
        ),
      )
      .orderBy(desc(staff.invitedAt));

    return rows.map((r) => ({
      id: r.id,
      orgType: r.type,
      orgName: r.agencyName ?? r.brandName ?? 'an organization',
      permissions: r.permissions,
      invitedByName:
        [r.inviterFirst, r.inviterLast].filter(Boolean).join(' ').trim() || 'Someone',
    }));
  }),

  /**
   * Decline a pending invitation addressed to the signed-in user. Unlike
   * `remove` (an admin action gated by staffManagement), this is the INVITEE
   * declining their own seat, so it's authorized by ownership of the invite
   * (linked userId or matching email) rather than org access. Idempotent.
   */
  reject: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const member = (await ctx.db.select().from(staff).where(eq(staff.id, input.id)).limit(1))[0];
    if (!member) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invitation not found' });
    const isInvitee =
      member.userId === ctx.user.id ||
      member.email.toLowerCase() === ctx.user.email.toLowerCase();
    if (!isInvitee) throw new TRPCError({ code: 'FORBIDDEN' });
    if (member.status !== 'pending') return { id: input.id };
    await ctx.db.update(staff).set({ status: 'removed' }).where(eq(staff.id, input.id));
    // Remove the invitation task that was surfaced to the invitee (if any).
    await clearTasksByEntity(input.id, ctx.db);
    return { id: input.id };
  }),

  permissionOptions: protectedProcedure.query(() => PERMISSIONS),
});

async function orgNameOf(db: typeof import('../db/index.js').db, orgType: 'agency' | 'brand', orgId: string): Promise<string | null> {
  if (orgType === 'agency') {
    const a = (await db.select({ n: agencies.businessName }).from(agencies).where(eq(agencies.id, orgId)).limit(1))[0];
    return a?.n ?? null;
  }
  const b = (await db.select({ n: brands.businessName }).from(brands).where(eq(brands.id, orgId)).limit(1))[0];
  return b?.n ?? null;
}
