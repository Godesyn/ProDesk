import { z } from 'zod';
import { and, eq, ilike, isNull, count, asc } from 'drizzle-orm';
import { router, publicProcedure, protectedProcedure } from '../trpc/trpc.js';
import { packages } from '../db/schema.js';
import { assertAgencyAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';

// A package bundles catalog services. Each item references a service and may
// carry a quantity / selected variant — mirrors add_package_dialog.
const packageItem = z.object({ serviceId: z.string(), quantity: z.number().int().positive().optional() }).passthrough();
const assignedStaff = z.object({ userId: z.string(), name: z.string().optional() }).passthrough();

const upsertInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  imagePath: z.string().optional(),
  imageAspectRatio: z.number().optional(),
  videoUrl: z.string().url().optional(),
  videoPath: z.string().optional(),
  disciplines: z.array(z.string()).optional(),
  isActive: z.boolean().default(true),
  allowBuyNow: z.boolean().default(true),
  allowBookMeeting: z.boolean().default(false),
  allowSalesProposal: z.boolean().default(true),
  items: z.array(packageItem).optional(),
  assignedStaff: z.array(assignedStaff).optional(),
  salesPersonCommissions: z.record(z.string(), z.number()).optional(),
  sortOrder: z.number().int().optional(),
});

export const packagesRouter = router({
  list: publicProcedure
    // Catalog views load the agency's whole list, so allow a larger ceiling than the shared default.
    .input(paginationInput.extend({ limit: z.number().int().min(1).max(500).default(20), agencyId: z.string().uuid(), includeInactive: z.boolean().default(false) }))
    .query(async ({ ctx, input }) => {
      const filters = [eq(packages.agencyId, input.agencyId), isNull(packages.deletedAt)];
      if (!input.includeInactive) filters.push(eq(packages.isActive, true));
      if (input.search) filters.push(ilike(packages.name, `%${input.search}%`));
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(packages).where(where).orderBy(asc(packages.sortOrder), asc(packages.name)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(packages).where(where),
      ]);
      return page(rows, total, input);
    }),

  byId: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return (await ctx.db.select().from(packages).where(eq(packages.id, input.id)).limit(1))[0] ?? null;
  }),

  create: protectedProcedure
    .input(upsertInput.extend({ agencyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'catalog');
      const { agencyId, ...rest } = input;
      const [created] = await ctx.db.insert(packages).values({ agencyId, ...rest }).returning();
      return created;
    }),

  update: protectedProcedure
    .input(upsertInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(packages).where(eq(packages.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Package not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      const { id, ...rest } = input;
      const [updated] = await ctx.db.update(packages).set(rest).where(eq(packages.id, id)).returning();
      return updated;
    }),

  archive: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const existing = (await ctx.db.select().from(packages).where(eq(packages.id, input.id)).limit(1))[0];
    if (!existing) throw new Error('Package not found');
    await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
    await ctx.db.update(packages).set({ deletedAt: new Date() }).where(eq(packages.id, input.id));
    return { id: input.id };
  }),

  /** Toggle active/inactive. */
  setActive: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (await ctx.db.select().from(packages).where(eq(packages.id, input.id)).limit(1))[0];
      if (!existing) throw new Error('Package not found');
      await assertAgencyAccess(ctx, existing.agencyId, 'catalog');
      const [updated] = await ctx.db.update(packages).set({ isActive: input.isActive }).where(eq(packages.id, input.id)).returning();
      return updated;
    }),
});
