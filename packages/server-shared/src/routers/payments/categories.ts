/**
 * Payments (EziQuotes) — vendor-configurable line-item categories, ported from
 * server/routers/categories.ts. The Manus owner/member account resolution is
 * replaced by brand tenancy: list/create/reorder/seedDefaults take a brandId;
 * id-based procedures resolve the category row and gate on its brandId.
 * `list` lazily seeds the 6 defaults (idempotent), as the export did.
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { paymentCategories } from '../../db/schema.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  archiveCategory,
  createCategory,
  listCategories,
  reorderCategories,
  seedDefaultCategories,
  updateCategory,
} from '../../modules/payments/db.js';

/** Load a category row by id (tenancy is asserted by the caller from row.brandId). */
async function loadCategory(id: string) {
  const [row] = await db
    .select()
    .from(paymentCategories)
    .where(eq(paymentCategories.id, id))
    .limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
  return row;
}

export const categoriesRouter = router({
  /** List all active categories for the brand (lazily seeds the defaults). */
  list: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      // Seed defaults if none exist yet (idempotent)
      const existing = await listCategories(input.brandId);
      if (existing.length === 0) {
        await seedDefaultCategories(input.brandId);
        return listCategories(input.brandId);
      }
      return existing;
    }),

  /** Create a new custom category. */
  create: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      code: z.string().min(1).max(64),
      label: z.string().min(1).max(64),
      colourHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Must be a valid hex colour (e.g. #3B82F6)'),
      displayOrder: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const { brandId, ...data } = input;
      return createCategory(brandId, data);
    }),

  /** Update label, colourHex, or displayOrder for a category. */
  update: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      label: z.string().min(1).max(64).optional(),
      colourHex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
      displayOrder: z.number().int().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const category = await loadCategory(input.id);
      await requirePaymentWrite(ctx, category.brandId);
      const { id, ...data } = input;
      const updated = await updateCategory(id, category.brandId, data);
      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Category not found' });
      }
      return updated;
    }),

  /**
   * Archive a category (soft-delete).
   * Default categories can be archived (not deleted).
   * Custom categories can also be archived.
   */
  archive: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const category = await loadCategory(input.id);
      await requirePaymentWrite(ctx, category.brandId);
      await archiveCategory(input.id, category.brandId);
      return { success: true };
    }),

  /**
   * Reorder categories by providing an ordered array of ids.
   * All ids must belong to the brand (reorderCategories scopes each update).
   */
  reorder: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), orderedIds: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      await reorderCategories(input.brandId, input.orderedIds);
      return { success: true };
    }),

  /** Seed default categories for the brand (idempotent). */
  seedDefaults: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      await seedDefaultCategories(input.brandId);
      return listCategories(input.brandId);
    }),
});
