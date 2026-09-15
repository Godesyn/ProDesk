import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { projectTags } from '../db/schema.js';
import { protectedProcedure, router } from '../trpc/trpc.js';
import { assertAgencyAccess } from '../trpc/permissions.js';

export const projectTagsRouter = router({
  list: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
      return ctx.db
        .select()
        .from(projectTags)
        .where(eq(projectTags.agencyId, input.agencyId))
        .orderBy(projectTags.createdAt);
    }),

  create: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        name: z.string().min(1).max(50),
        color: z.enum(['red', 'blue', 'green', 'yellow', 'purple']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');

      const tags = await ctx.db
        .select()
        .from(projectTags)
        .where(eq(projectTags.agencyId, input.agencyId));

      if (tags.length >= 5) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Maximum of 5 tags allowed per agency.',
        });
      }

      if (tags.some((t) => t.color === input.color)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A tag with this color already exists.',
        });
      }

      const [tag] = await ctx.db
        .insert(projectTags)
        .values({
          agencyId: input.agencyId,
          name: input.name,
          color: input.color,
        })
        .returning();

      return tag;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid(), agencyId: z.string().uuid(), name: z.string().min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
      
      const [updated] = await ctx.db
        .update(projectTags)
        .set({ name: input.name, updatedAt: new Date() })
        .where(and(eq(projectTags.id, input.id), eq(projectTags.agencyId, input.agencyId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found' });
      }

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid(), agencyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'agencyProjects');
      
      const [deleted] = await ctx.db
        .delete(projectTags)
        .where(and(eq(projectTags.id, input.id), eq(projectTags.agencyId, input.agencyId)))
        .returning();

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Tag not found' });
      }

      return deleted;
    }),
});
