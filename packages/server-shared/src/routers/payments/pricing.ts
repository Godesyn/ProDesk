/**
 * Payments (EziQuotes) — pricing catalog router, ported from
 * server/routers/pricing.ts: products / add-ons / pricing tables / quick sets
 * CRUD plus the plan-tier CMS. The tiers cache (loadTiersFromDb /
 * invalidateTiersCache) moved into modules/payments/fee-calc.ts during the
 * foundation port — this router imports it from there. Plan-tier mutations are
 * platform-admin only (Manus role==='admin' → superAdminProcedure).
 */
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  paymentAddons,
  paymentPlanTierRateAudit,
  paymentPlanTiers,
  paymentPricingTables,
  paymentProducts,
  paymentQuickSets,
} from '../../db/schema.js';
import { protectedProcedure, publicProcedure, router, superAdminProcedure } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  createAddon,
  createPricingTable,
  createProduct,
  createQuickSet,
  deleteAddon,
  deleteProduct,
  deleteQuickSet,
  listAddons,
  listPricingTables,
  listProducts,
  listQuickSets,
  updateAddon,
  updatePricingTable,
  updateProduct,
  updateQuickSet,
} from '../../modules/payments/db.js';
import { invalidateTiersCache, loadTiersFromDb } from '../../modules/payments/fee-calc.js';

/** Resolve an entity row's brandId for id-based procedures (tenancy gate). */
async function brandIdOf(
  table: typeof paymentProducts | typeof paymentAddons | typeof paymentPricingTables | typeof paymentQuickSets,
  id: string,
): Promise<string> {
  const [row] = await db.select({ brandId: table.brandId }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  return row.brandId;
}

export const pricingRouter = router({
  // Products
  listProducts: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const rows = await listProducts(input.brandId);
      // Map `category` DB field (stores code like "BRND") → `categoryCode` so CatalogPane renders correct tag pills
      return rows.map((p) => ({ ...p, categoryCode: p.category ?? undefined }));
    }),

  createProduct: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      basePriceCents: z.number().min(0).default(0),
      unit: z.enum(['month', 'quarter', 'year', 'project', 'hour', 'item', 'custom']).default('project'),
      customUnitLabel: z.string().optional(),
      taxBehaviour: z.enum(['inclusive', 'exclusive', 'exempt']).default('inclusive'),
      defaultPaymentModel: z.enum(['one_off', 'subscription', 'payment_plan']).default('one_off'),
      costCents: z.number().min(0).optional(),
      category: z.string().optional(),
      // Optional link to the richer agency `services` catalog.
      serviceId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createProduct(input);
      const products = await listProducts(input.brandId);
      return products.find((p) => p.id === id);
    }),

  updateProduct: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      basePriceCents: z.number().min(0).optional(),
      unit: z.enum(['month', 'quarter', 'year', 'project', 'hour', 'item', 'custom']).optional(),
      customUnitLabel: z.string().optional(),
      taxBehaviour: z.enum(['inclusive', 'exclusive', 'exempt']).optional(),
      defaultPaymentModel: z.enum(['one_off', 'subscription', 'payment_plan']).optional(),
      costCents: z.number().min(0).optional(),
      category: z.string().optional(),
      status: z.enum(['active', 'archived']).optional(),
      // Optional link to the richer agency `services` catalog.
      serviceId: z.string().uuid().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentProducts, input.id);
      await requirePaymentWrite(ctx, brandId);
      const { id, ...data } = input;
      await updateProduct(id, brandId, data);
      const products = await listProducts(brandId);
      return products.find((p) => p.id === id);
    }),

  deleteProduct: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentProducts, input.id);
      await requirePaymentWrite(ctx, brandId);
      await deleteProduct(input.id, brandId);
      return { success: true };
    }),

  // Add-ons
  listAddons: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return listAddons(input.brandId);
    }),

  createAddon: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      description: z.string().optional(),
      priceCents: z.number().min(0).default(0),
      unit: z.string().optional(),
      type: z.enum(['one_off', 'recurring']).default('recurring'),
      quantityBehaviour: z.enum(['fixed', 'per_unit', 'customer_set']).default('fixed'),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createAddon(input);
      const addons = await listAddons(input.brandId);
      return addons.find((a) => a.id === id);
    }),

  updateAddon: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      description: z.string().optional(),
      priceCents: z.number().min(0).optional(),
      unit: z.string().optional(),
      type: z.enum(['one_off', 'recurring']).optional(),
      status: z.enum(['active', 'archived']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentAddons, input.id);
      await requirePaymentWrite(ctx, brandId);
      const { id, ...data } = input;
      await updateAddon(id, brandId, data);
      const addons = await listAddons(brandId);
      return addons.find((a) => a.id === id);
    }),

  deleteAddon: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentAddons, input.id);
      await requirePaymentWrite(ctx, brandId);
      await deleteAddon(input.id, brandId);
      return { success: true };
    }),

  // Pricing tables
  listPricingTables: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return listPricingTables(input.brandId);
    }),

  createPricingTable: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      tiers: z.any().optional(),
      displayRule: z.enum(['show_all', 'show_selected_only']).default('show_all'),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createPricingTable(input);
      const tables = await listPricingTables(input.brandId);
      return tables.find((t) => t.id === id);
    }),

  updatePricingTable: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      tiers: z.any().optional(),
      displayRule: z.enum(['show_all', 'show_selected_only']).optional(),
      status: z.enum(['active', 'archived']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentPricingTables, input.id);
      await requirePaymentWrite(ctx, brandId);
      const { id, ...data } = input;
      await updatePricingTable(id, brandId, data);
      const tables = await listPricingTables(brandId);
      return tables.find((t) => t.id === id);
    }),

  // Quick Sets
  listQuickSets: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const sets = await listQuickSets(input.brandId);
      const products = await listProducts(input.brandId);
      // Enrich options: if an option has a productId reference, resolve name + price from products table
      return sets.map((s) => ({
        ...s,
        options: ((s.options as any[]) ?? []).map((o: any) => {
          if (o.productId) {
            const product = products.find((p) => p.id === o.productId);
            if (product) {
              return {
                id: String(o.productId),
                productId: o.productId,
                name: product.name,
                description: product.description ?? '',
                unitPriceCents: product.basePriceCents ?? 0,
                quantity: o.quantity ?? 1,
                on: o.on ?? true,
                required: o.required ?? false,
              };
            }
          }
          // Already enriched or legacy shape — pass through
          return o;
        }),
      }));
    }),

  createQuickSet: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      name: z.string().min(1),
      options: z.any().optional(),
      paymentModelsAvailable: z.any().optional(),
      defaultPaymentModel: z.enum(['one_off', 'subscription', 'payment_plan']).default('one_off'),
      defaultConfiguration: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const id = await createQuickSet(input);
      const sets = await listQuickSets(input.brandId);
      return sets.find((s) => s.id === id);
    }),

  updateQuickSet: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().optional(),
      options: z.any().optional(),
      paymentModelsAvailable: z.any().optional(),
      defaultPaymentModel: z.enum(['one_off', 'subscription', 'payment_plan']).optional(),
      defaultConfiguration: z.any().optional(),
      status: z.enum(['active', 'archived']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentQuickSets, input.id);
      await requirePaymentWrite(ctx, brandId);
      const { id, ...data } = input;
      await updateQuickSet(id, brandId, data);
      const sets = await listQuickSets(brandId);
      return sets.find((s) => s.id === id);
    }),

  deleteQuickSet: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const brandId = await brandIdOf(paymentQuickSets, input.id);
      await requirePaymentWrite(ctx, brandId);
      await deleteQuickSet(input.id, brandId);
      return { success: true };
    }),

  // ---------------------------------------------------------------------------
  // Plan Tiers CMS — public read, platform-admin write
  // ---------------------------------------------------------------------------
  getPlanTiers: publicProcedure.query(async () => {
    const tiers = await loadTiersFromDb();
    if (!tiers || tiers.length === 0) {
      // Fallback if the table is unseeded/unavailable
      return [
        { key: 'send', name: 'Send', pct: '1.00', status: 'active', tagline: 'Send, collect, done.', blurb: null, label: 'PER PAYMENT · NO SUBSCRIPTION' },
        { key: 'close', name: 'Close', pct: '1.70', status: 'active', tagline: 'For businesses that follow up.', blurb: null, label: 'PER PAYMENT · NO SUBSCRIPTION' },
        { key: 'recover', name: 'Recover', pct: '5.00', status: 'coming_soon', tagline: 'Full recovery, on autopilot.', blurb: null, label: 'PER PAYMENT · WAITLIST' },
      ];
    }
    return tiers;
  }),

  updatePlanTier: superAdminProcedure
    .input(z.object({
      key: z.enum(['send', 'close', 'recover']),
      pct: z.number().min(0).max(100),
      status: z.enum(['active', 'coming_soon']).optional(),
      tagline: z.string().optional(),
      blurb: z.string().optional(),
      label: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { key, pct, ...rest } = input;
      // Read current rate before updating (for audit log)
      const [current] = await db
        .select({ pct: paymentPlanTiers.pct })
        .from(paymentPlanTiers)
        .where(eq(paymentPlanTiers.key, key))
        .limit(1);
      const oldPct = current?.pct ?? '0';
      await db
        .update(paymentPlanTiers)
        .set({ pct: pct.toFixed(2), ...rest, updatedAt: new Date() })
        .where(eq(paymentPlanTiers.key, key));
      // Write audit log entry
      const displayName = [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' ');
      await db.insert(paymentPlanTierRateAudit).values({
        tierKey: key,
        changedByUserId: ctx.user.id,
        changedByName: displayName || ctx.user.email || 'admin',
        oldPct: String(parseFloat(String(oldPct)).toFixed(2)),
        newPct: pct.toFixed(2),
      });
      invalidateTiersCache();
      const tiers = await loadTiersFromDb();
      return tiers?.find((t) => t.key === key) ?? null;
    }),

  getPlanTierRateAudit: superAdminProcedure
    .input(z.object({ tierKey: z.enum(['send', 'close', 'recover']).optional() }))
    .query(async ({ input }) => {
      const rows = await db
        .select()
        .from(paymentPlanTierRateAudit)
        .where(input.tierKey ? eq(paymentPlanTierRateAudit.tierKey, input.tierKey) : undefined)
        .orderBy(desc(paymentPlanTierRateAudit.createdAt))
        .limit(100);
      return rows;
    }),
});
