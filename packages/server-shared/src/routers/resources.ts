import { z } from 'zod';
import { and, eq, isNull, ilike, or, count, desc, isNotNull, type SQL } from 'drizzle-orm';
import { router, protectedProcedure, superAdminProcedure } from '../trpc/trpc.js';
import { resources, agencies } from '../db/schema.js';
import { assertAgencyAccess, assertBrandAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { onResourcePendingApproval, onResourceApproved } from './tasks.js';

export const resourcesRouter = router({
  /** Resources for an agency, or platform-wide (agencyId null) admin resources. */
  list: protectedProcedure
    .input(paginationInput.extend({ agencyId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const filters = [input.agencyId ? eq(resources.agencyId, input.agencyId) : isNull(resources.agencyId)];
      if (input.search) filters.push(ilike(resources.title, `%${input.search}%`));
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(resources).where(where).orderBy(desc(resources.uploadedAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(resources).where(where),
      ]);
      return page(rows, total, input);
    }),

  /**
   * Super-admin moderation view: ALL resources across the platform (both global
   * admin resources and agency-uploaded ones), so the 4-tab moderation UI can
   * filter pending/accepted/global/agency client-side. Search matches title OR
   * description (Flutter filters on both).
   */
  adminList: superAdminProcedure
    .input(paginationInput)
    .query(async ({ ctx, input }) => {
      const where = input.search
        ? or(ilike(resources.title, `%${input.search}%`), ilike(resources.description, `%${input.search}%`))
        : undefined;
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(resources).where(where).orderBy(desc(resources.uploadedAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(resources).where(where),
      ]);
      return page(rows, total, input);
    }),

  create: protectedProcedure
    .input(z.object({ title: z.string().min(1), description: z.string().optional(), url: z.string().url().optional(), linkUrl: z.string().url().optional(), categories: z.array(z.string()).optional(), agencyId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.agencyId) await assertAgencyAccess(ctx, input.agencyId, 'manageResources');
      // Brand-owned resources (no agency) are auto-accepted; agency uploads stay
      // pending until a super-admin approves them (mirrors resource_controller.dart).
      const [created] = await ctx.db
        .insert(resources)
        .values({ ...input, uploadedBy: ctx.user.id, acceptedAt: input.agencyId ? null : new Date() })
        .returning();
      if (input.agencyId) {
        const agency = (await ctx.db.select().from(agencies).where(eq(agencies.id, input.agencyId)).limit(1))[0];
        await onResourcePendingApproval({ resourceId: created.id, title: created.title, agencyName: agency?.businessName ?? null }, ctx.db);
      }
      return created;
    }),

  /**
   * Super-admin uploads a global resource — agencyId is always null and the
   * resource is immediately accepted (admin-authored, no moderation needed).
   */
  createGlobal: superAdminProcedure
    .input(z.object({ title: z.string().min(1), description: z.string().optional(), url: z.string().url().optional(), linkUrl: z.string().url().optional(), categories: z.array(z.string()).optional() }))
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(resources)
        .values({ ...input, agencyId: null, uploadedBy: ctx.user.id, acceptedAt: new Date() })
        .returning();
      return created;
    }),

  /** Approve a pending resource: stamp acceptedAt so it leaves the pending tab. */
  accept: superAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [updated] = await ctx.db
      .update(resources)
      .set({ acceptedAt: new Date() })
      .where(eq(resources.id, input.id))
      .returning();
    await onResourceApproved(input.id, ctx.db);
    return updated;
  }),

  /**
   * Reject a pending resource request. Flutter rejection deletes the request
   * outright (distinct user-facing intent from a plain delete, same effect).
   */
  reject: superAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(resources).where(eq(resources.id, input.id));
    await onResourceApproved(input.id, ctx.db); // resolve the pending-approval tasks
    return { id: input.id };
  }),

  remove: superAdminProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(resources).where(eq(resources.id, input.id));
    return { id: input.id };
  }),

  /**
   * Brand-facing Resources & Templates browse. Returns ALL accepted resources —
   * global (admin) resources plus any agency upload a super-admin has approved.
   * Once approved, an agency resource is visible to every brand (not just the
   * agencies a brand is connected to); pending uploads stay hidden until then.
   * Ports resources_templates_screen.dart. Each row carries the uploading
   * agency's name (null for platform resources) so the UI can attribute it.
   * Search matches title OR description; the client applies the category-chip
   * filter + sort.
   */
  brandList: protectedProcedure
    .input(paginationInput.extend({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'resources');

      // Only accepted resources are visible to brands (pending agency uploads are
      // hidden until a super-admin approves them).
      const filters: Array<SQL | undefined> = [isNotNull(resources.acceptedAt)];
      if (input.search) {
        filters.push(or(ilike(resources.title, `%${input.search}%`), ilike(resources.description, `%${input.search}%`)));
      }
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ resource: resources, agencyName: agencies.businessName })
          .from(resources)
          .leftJoin(agencies, eq(resources.agencyId, agencies.id))
          .where(where)
          .orderBy(desc(resources.uploadedAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(resources).where(where),
      ]);
      return page(rows.map((r) => ({ ...r.resource, agencyName: r.agencyName })), total, input);
    }),
});
