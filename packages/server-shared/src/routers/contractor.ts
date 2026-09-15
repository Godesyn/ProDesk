import { z } from 'zod';
import { and, eq, ne, ilike, count, desc, asc, isNull, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { agencyContractorConnections, agencies, brands, contractors, users, projects, projectCycles, projectDeliverables, projectRevisions } from '../db/schema.js';
import { paginationInput, page } from '../lib/pagination.js';
import { omitActionTokens } from '../lib/redact.js';
import { onContractorConnectionRequest, onProjectStatusChanged, clearTasksByEntity } from './tasks.js';
import { handleContractorRemovedFromAgency } from '../modules/chat/threads.js';
import { verifyInviteToken } from '../lib/invite-token.js';
import { connectContractorViaInvite } from '../modules/contractor/connect.js';
import { currentCycleNumber } from '../modules/projects/cycle-math.js';
import { hasDeliverableCycle, type ServiceType } from '../lib/service-type.js';

export const contractorRouter = router({
  /** The current user's contractor profile (null if none) — prefill for the create/edit screen. */
  myProfile: protectedProcedure.query(async ({ ctx }) => {
    return (await ctx.db.select().from(contractors).where(eq(contractors.id, ctx.user.id)).limit(1))[0] ?? null;
  }),

  /**
   * Create / save the contractor profile (the "Become a Contractor" screen).
   * On first creation the user is promoted to individualContractor — an existing
   * role is never clobbered (matches brand/agency create + the Flutter edit-mode
   * which only sets the role when creating). Upsert by user id (PK == user id).
   * Ports contractor_controller.dart:createContractor + the role assignment that
   * follows a fresh create in create_contractor_screen.dart.
   */
  create: protectedProcedure
    .input(
      z.object({
        tagline: z.string().trim().min(1),
        bio: z.string().trim().min(1),
        skills: z.array(z.string().trim().min(1)).min(1),
        hourlyRate: z.number().positive().optional(),
        websiteUrl: z.string().trim().optional(),
        linkedinUrl: z.string().trim().optional(),
        resumeUrl: z.string().optional(),
        resumeFileName: z.string().optional(),
        portfolioItems: z.array(z.any()).default([]),
        experienceItems: z.array(z.any()).default([]),
        // Set when arriving from a contractor-invite email link: connects the new
        // contractor to the inviting agency once their profile exists.
        inviteToken: z.string().optional(),
        // Set when arriving from an in-app contractor-invite task (an existing user
        // who had to build a profile before they could connect). Finalizes the
        // pendingInvite connection to this agency. Validated below against a real
        // pending invite so it can't be used to self-connect to an arbitrary agency.
        connectAgencyId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const name =
        [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' ').trim() ||
        ctx.user.email.split('@')[0];
      const values = {
        name,
        email: ctx.user.email,
        tagline: input.tagline,
        bio: input.bio,
        skills: input.skills,
        hourlyRate: input.hourlyRate != null ? input.hourlyRate.toString() : null,
        websiteUrl: input.websiteUrl || null,
        linkedinUrl: input.linkedinUrl || null,
        resumeUrl: input.resumeUrl || null,
        resumeFileName: input.resumeFileName || null,
        portfolioItems: input.portfolioItems,
        experienceItems: input.experienceItems,
      };
      const [contractor] = await ctx.db
        .insert(contractors)
        .values({ id: ctx.user.id, ...values })
        .onConflictDoUpdate({ target: contractors.id, set: { ...values, updatedAt: new Date() } })
        .returning();
      // First-time creation promotes to individualContractor; never downgrade.
      if (!ctx.user.role) {
        await ctx.db.update(users).set({ role: 'individualContractor' }).where(eq(users.id, ctx.user.id));
      }

      // Came in via a contractor-invite email link → establish the active
      // connection to the inviting agency now that a profile exists. The token is
      // signed (so it can't be used to self-connect to an arbitrary agency) but is
      // NOT email-bound — whoever redeems the link is connected. Idempotent
      // (re-activates an existing connection row).
      if (input.inviteToken) {
        const invite = await verifyInviteToken(input.inviteToken);
        // Signed token is enough — connect whoever redeems it, regardless of the
        // email it was originally addressed to.
        if (invite?.kind === 'contractor') {
          await connectContractorViaInvite(ctx.db, ctx.user.id, ctx.user.email, invite.agencyId, invite.note ?? null);
        }
      }

      // Came in via an in-app contractor-invite task: the agency had already
      // created a pendingInvite connection keyed to this user, and accepting it
      // routed them here to build a profile first. Finalize that exact connection
      // now (re-activates the row + completes the task). Guarded on the existing
      // pendingInvite row so a forged agencyId can't force an unsolicited link.
      if (input.connectAgencyId) {
        const pending = (
          await ctx.db
            .select({ id: agencyContractorConnections.id })
            .from(agencyContractorConnections)
            .where(
              and(
                eq(agencyContractorConnections.agencyId, input.connectAgencyId),
                eq(agencyContractorConnections.contractorId, ctx.user.id),
                eq(agencyContractorConnections.status, 'pendingInvite'),
              ),
            )
            .limit(1)
        )[0];
        if (pending) {
          await connectContractorViaInvite(ctx.db, ctx.user.id, ctx.user.email, input.connectAgencyId, null);
        }
      }
      return contractor;
    }),

  /** The current contractor's agency relationships (contracts), by status. */
  myConnections: protectedProcedure
    .input(paginationInput.extend({ status: z.enum(['pendingInvite', 'pendingApplication', 'active', 'rejected', 'revoked']).optional() }))
    .query(async ({ ctx, input }) => {
      const filters = [eq(agencyContractorConnections.contractorId, ctx.user.id)];
      if (input.status) filters.push(eq(agencyContractorConnections.status, input.status));
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ connection: agencyContractorConnections, agency: agencies })
          .from(agencyContractorConnections)
          .innerJoin(agencies, eq(agencyContractorConnections.agencyId, agencies.id))
          .where(where)
          .orderBy(desc(agencyContractorConnections.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(agencyContractorConnections).where(where),
      ]);
      return page(rows.map((r) => ({ ...r.connection, agency: r.agency })), total, input);
    }),

  /**
   * Agencies a contractor can discover & apply to. DEFAULT-AGENCY-gated: only
   * platform **default** + verified agencies are searchable (mirrors the Flutter
   * agency_repository.searchAgencies, which queries emailVerified && platformVerified).
   * Contractors cannot explore non-default agencies — to work with one they must
   * be invited by email by that agency (connections.inviteContractor).
   */
  browseAgencies: protectedProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const filters = [eq(agencies.emailVerified, true), eq(agencies.platformVerified, true)];
    if (input.search) filters.push(ilike(agencies.businessName, `%${input.search}%`));
    const where = and(...filters);
    const [rows, [{ value: total }]] = await Promise.all([
      ctx.db.select().from(agencies).where(where).orderBy(desc(agencies.createdAt)).limit(input.limit).offset(input.offset),
      ctx.db.select({ value: count() }).from(agencies).where(where),
    ]);
    return page(rows, total, input);
  }),

  /**
   * Apply to an agency (creates a pendingApplication connection). Files a
   * connection-request task to the agency owner so the application surfaces in
   * their action centre. Ports the applyToAgency side-effect.
   */
  applyToAgency: protectedProcedure.input(z.object({ agencyId: z.string().uuid(), note: z.string().optional() })).mutation(async ({ ctx, input }) => {
    const [created] = await ctx.db
      .insert(agencyContractorConnections)
      .values({ agencyId: input.agencyId, contractorId: ctx.user.id, status: 'pendingApplication', initiatedByUserId: ctx.user.id, note: input.note })
      .onConflictDoNothing({ target: [agencyContractorConnections.agencyId, agencyContractorConnections.contractorId], where: sql`${agencyContractorConnections.contractorId} is not null` })
      .returning();
    if (created) {
      const a = (await ctx.db.select({ ownerId: agencies.ownerId, name: agencies.businessName }).from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
      await onContractorConnectionRequest(
        {
          connectionId: created.id,
          status: 'pendingApplication',
          agencyId: input.agencyId,
          contractorId: ctx.user.id,
          agencyOwnerId: a?.ownerId ?? null,
          agencyName: a?.name ?? null,
        },
        ctx.db,
      );
    }
    return created ?? null;
  }),

  /**
   * Leave an agency the contractor is connected to (the "Leave Agency" action on
   * an active connection card — contractor_agencies_screen.dart `_confirmLeave`
   * → removeConnection). Contractor-initiated mirror of connections.removeContractor:
   * marks the connection `revoked`, archives the agency↔contractor chat threads,
   * and clears any open connection task. The contractor keeps their profile/role
   * (they may still be connected to, or apply to, other agencies) — so unlike the
   * agency-side removal this never resets the user's role.
   */
  leaveAgency: protectedProcedure.input(z.object({ connectionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const conn = (await ctx.db.select().from(agencyContractorConnections).where(eq(agencyContractorConnections.id, input.connectionId)).limit(1))[0];
    if (!conn) throw new TRPCError({ code: 'NOT_FOUND', message: 'Connection not found' });
    if (conn.contractorId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not your connection' });
    const [updated] = await ctx.db
      .update(agencyContractorConnections)
      .set({ status: 'revoked', respondedAt: new Date() })
      .where(eq(agencyContractorConnections.id, input.connectionId))
      .returning();
    await handleContractorRemovedFromAgency(conn.agencyId, conn.contractorId, ctx.db);
    await clearTasksByEntity(conn.id, ctx.db);
    return updated;
  }),

  /**
   * The current contractor's assigned-project workspace (mirror of
   * watchContractorProjects). Returns every non-deleted project assigned to
   * this contractor, with deliverables + the latest revision feedback so the
   * client can group by status and surface rejection notes.
   */
  myProjects: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(projects)
      // Exclude projects still in `allocate`: a contractor is assigned at
      // allocation time, but for an internal project the work isn't funded until
      // the Stripe payment lands (the webhook then flips allocate→production). A
      // non-internal allocation goes straight to production, so a contractor-
      // assigned row sitting in `allocate` is always an unpaid internal project —
      // it must stay invisible to the contractor until paid.
      .where(and(eq(projects.productionAssigneeId, ctx.user.id), eq(projects.assigneeType, 'contractor'), ne(projects.status, 'allocate'), isNull(projects.deletedAt)))
      .orderBy(desc(projects.updatedAt));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const agencyIds = [...new Set(rows.map((r) => r.agencyId).filter(Boolean))] as string[];
    const brandIds = [...new Set(rows.map((r) => r.brandId).filter(Boolean))] as string[];
    const [delivs, revs, ags, brs] = await Promise.all([
      ctx.db.select().from(projectDeliverables).where(inArray(projectDeliverables.projectId, ids)).orderBy(asc(projectDeliverables.sortOrder), projectDeliverables.uploadedAt),
      ctx.db.select().from(projectRevisions).where(inArray(projectRevisions.projectId, ids)).orderBy(projectRevisions.createdAt),
      agencyIds.length ? ctx.db.select({ id: agencies.id, name: agencies.businessName }).from(agencies).where(inArray(agencies.id, agencyIds)) : Promise.resolve([] as { id: string; name: string }[]),
      brandIds.length ? ctx.db.select({ id: brands.id, name: brands.businessName }).from(brands).where(inArray(brands.id, brandIds)) : Promise.resolve([] as { id: string; name: string }[]),
    ]);
    const agencyName = new Map(ags.map((a) => [a.id, a.name]));
    const brandName = new Map(brs.map((b) => [b.id, b.name]));

    return rows.map((p) => ({
      ...omitActionTokens(p),
      deliverables: delivs.filter((d) => d.projectId === p.id),
      revisions: revs.filter((r) => r.projectId === p.id),
      // Display names for the workspace list's "agency · brand · service" subline.
      agencyName: p.agencyId ? (agencyName.get(p.agencyId) ?? null) : null,
      resolvedBrandName: p.brandName ?? (p.brandId ? (brandName.get(p.brandId) ?? null) : null),
    }));
  }),

  /**
   * A single assigned project's deliverables + revisions (manage-deliverables
   * dialog). Also resolves the owning agency + brand (name/logo) so the dialog
   * header can render the brand/agency chips + budget/duration the contractor is
   * working against (DeliverableProjectHeaderInfo in manage_deliverables_dialog).
   */
  projectById: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)).limit(1))[0];
    if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
    if (project.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
    // Unpaid internal project (still in `allocate`): not yet visible to the
    // contractor until the Stripe payment advances it to production. See myProjects.
    if (project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN', message: 'Project is not active yet' });
    const [deliverables, revisions, cycles, agencyRow, brandRow] = await Promise.all([
      ctx.db.select().from(projectDeliverables).where(eq(projectDeliverables.projectId, input.id)).orderBy(asc(projectDeliverables.sortOrder), projectDeliverables.uploadedAt),
      ctx.db.select().from(projectRevisions).where(eq(projectRevisions.projectId, input.id)).orderBy(projectRevisions.createdAt),
      // Per-cycle history: completed-cycle brief snapshots + agency pre-briefs
      // for future cycles (cycling projects only; empty for one-shots).
      ctx.db.select().from(projectCycles).where(eq(projectCycles.projectId, input.id)).orderBy(asc(projectCycles.cycleNumber)),
      project.agencyId
        ? ctx.db.select({ id: agencies.id, name: agencies.businessName, logoUrl: agencies.logoUrl }).from(agencies).where(eq(agencies.id, project.agencyId)).limit(1)
        : Promise.resolve([] as { id: string; name: string; logoUrl: string | null }[]),
      project.brandId
        ? ctx.db.select({ id: brands.id, name: brands.businessName, logoUrl: brands.logoUrl }).from(brands).where(eq(brands.id, project.brandId)).limit(1)
        : Promise.resolve([] as { id: string; name: string; logoUrl: string | null }[]),
    ]);
    return { ...omitActionTokens(project), deliverables, revisions, cycles, agency: agencyRow[0] ?? null, brand: brandRow[0] ?? null };
  }),

  /**
   * Rename a deliverable the contractor owns — a text headline/note's `content`
   * or a file deliverable's display `fileName` (manage_deliverables_dialog's
   * edit/rename action). Ownership is enforced via the parent project's
   * productionAssigneeId, exactly like add/remove.
   */
  updateDeliverable: protectedProcedure
    .input(z.object({ id: z.string().uuid(), content: z.string().optional(), fileName: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const d = (await ctx.db.select().from(projectDeliverables).where(eq(projectDeliverables.id, input.id)).limit(1))[0];
      if (!d) throw new TRPCError({ code: 'NOT_FOUND' });
      const project = (await ctx.db.select().from(projects).where(eq(projects.id, d.projectId)).limit(1))[0];
      if (project?.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
      if (project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN', message: 'Project is not active yet' });
      if ((d.cycle ?? currentCycleNumber(project)) < currentCycleNumber(project)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Completed cycles are locked.' });
      }
      const patch: { content?: string; fileName?: string } = {};
      if (input.content !== undefined) patch.content = input.content;
      if (input.fileName !== undefined) patch.fileName = input.fileName;
      const [updated] = await ctx.db.update(projectDeliverables).set(patch).where(eq(projectDeliverables.id, input.id)).returning();
      return updated;
    }),

  /**
   * Contractor adds a deliverable to their assigned project. `cycle` targets a
   * deliverable cycle on a CYCLING project: omitted/current = live work, a
   * future cycle number STAGES the row (it becomes live when that cycle opens).
   * Completed cycles are locked.
   */
  addDeliverable: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        type: z.enum(['text', 'document', 'image']).default('document'),
        content: z.string().optional(),
        fileName: z.string().optional(),
        description: z.string().optional(),
        cycle: z.number().int().min(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = (await ctx.db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0];
      if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
      if (project.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
      if (project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN', message: 'Project is not active yet' });
      const current = currentCycleNumber(project);
      const cycle = input.cycle ?? current;
      if (cycle < current) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Completed cycles are locked.' });
      if (cycle > current && !hasDeliverableCycle(project.serviceType as ServiceType | null)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This project has no deliverable cycle.' });
      }
      const { projectId, cycle: _cycle, ...rest } = input;
      // Append after existing deliverables so manual order is preserved.
      const [{ value: existing }] = await ctx.db.select({ value: count() }).from(projectDeliverables).where(eq(projectDeliverables.projectId, projectId));
      const [d] = await ctx.db.insert(projectDeliverables).values({ projectId, uploadedBy: ctx.user.id, source: 'agency', sortOrder: existing, cycle, ...rest }).returning();
      await ctx.db.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId));
      return d;
    }),

  /**
   * Persist a drag-to-reorder of a project's deliverables (manage_deliverables
   * dialog's ReorderableListView). `orderedIds` is the full id list in the new
   * order; each row's sortOrder is set to its index. Ownership is enforced via
   * the parent project's productionAssigneeId.
   */
  reorderDeliverables: protectedProcedure
    .input(z.object({ projectId: z.string().uuid(), orderedIds: z.array(z.string().uuid()) }))
    .mutation(async ({ ctx, input }) => {
      const project = (await ctx.db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0];
      if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
      if (project.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
      if (project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN', message: 'Project is not active yet' });
      await Promise.all(
        input.orderedIds.map((id, i) =>
          ctx.db
            .update(projectDeliverables)
            .set({ sortOrder: i })
            .where(and(eq(projectDeliverables.id, id), eq(projectDeliverables.projectId, input.projectId))),
        ),
      );
      return { ok: true };
    }),

  removeDeliverable: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const d = (await ctx.db.select().from(projectDeliverables).where(eq(projectDeliverables.id, input.id)).limit(1))[0];
    if (!d) throw new TRPCError({ code: 'NOT_FOUND' });
    const project = (await ctx.db.select().from(projects).where(eq(projects.id, d.projectId)).limit(1))[0];
    if (project?.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
    if (project.status === 'allocate') throw new TRPCError({ code: 'FORBIDDEN', message: 'Project is not active yet' });
    if ((d.cycle ?? currentCycleNumber(project)) < currentCycleNumber(project)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Completed cycles are locked.' });
    }
    await ctx.db.delete(projectDeliverables).where(eq(projectDeliverables.id, input.id));
    return { ok: true };
  }),

  /**
   * Submit & complete: the assigned contractor moves the project from
   * production/revision to internalApproval (warns client-side if zero
   * deliverables). Mirrors contract_card "Complete".
   */
  submitForApproval: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const project = (await ctx.db.select().from(projects).where(eq(projects.id, input.id)).limit(1))[0];
    if (!project) throw new TRPCError({ code: 'NOT_FOUND' });
    if (project.productionAssigneeId !== ctx.user.id) throw new TRPCError({ code: 'FORBIDDEN' });
    if (project.status !== 'production' && project.status !== 'revision') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Project is not in production or revision.' });
    }
    const [updated] = await ctx.db.update(projects).set({ status: 'internalApproval', updatedAt: new Date() }).where(eq(projects.id, project.id)).returning();
    // Notify the agency approval designee — mirrors the agency-side setStatus path
    // so a contractor submitting for review still files the workflow task/email.
    try {
      const agency = updated.agencyId ? (await ctx.db.select().from(agencies).where(eq(agencies.id, updated.agencyId)).limit(1))[0] : null;
      const brand = updated.brandId ? (await ctx.db.select().from(brands).where(eq(brands.id, updated.brandId)).limit(1))[0] : null;
      await onProjectStatusChanged(
        {
          projectId: updated.id,
          status: updated.status,
          assigneeType: updated.assigneeType,
          productionAssigneeId: updated.productionAssigneeId,
          agencyId: updated.agencyId,
          agencyName: agency?.businessName ?? null,
          brandOwnerId: brand?.ownerId ?? null,
          approvalDesigneeId: agency?.approvalDesigneeId ?? null,
          organizationName: agency?.businessName ?? null,
        },
        ctx.db,
      );
    } catch {
      /* task generation is best-effort */
    }
    return updated;
  }),
});
