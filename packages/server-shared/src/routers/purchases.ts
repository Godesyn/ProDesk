import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, count } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { purchases, purchaseItems, services, globalSettings } from '../db/schema.js';
import { assertBrandAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import { listBrandPurchases, purchaseItemsByPurchase } from '../modules/projects/queries.js';
import { stripe } from '../modules/stripe/client.js';
import { fulfillPurchase } from '../modules/billing/fulfillment.js';
import { createCheckoutSession } from '../modules/billing/recurring.js';
import { createPendingPurchase, getPendingPurchase, promotePendingPurchase, type PendingItem } from '../modules/billing/pending-purchase.js';
import { isBillingCycleWeekly, type ServiceType } from '../lib/service-type.js';
import {
  computeSubtotals,
  computeLineTotal,
  computeLineAmount,
  computePayInFull,
  computePaymentPlan,
  type CartLineInput,
  type PaymentPlan,
  type SelectedAddon,
} from '../modules/billing/pricing.js';

const selectedAddonSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  oneOffUpfrontDifference: z.number().optional(),
  recurringUpfrontDifference: z.number().optional(),
  recurringWeeklyDifference: z.number().optional(),
});

const cartItemSchema = z.object({
  serviceId: z.string().uuid(),
  quantity: z.number().int().positive().default(1),
  packageId: z.string().uuid().optional(),
  packageName: z.string().optional(),
  selectedVariantId: z.string().optional(),
  selectedOptions: z.record(z.string(), z.string()).optional(),
  selectedAddons: z.array(selectedAddonSchema).optional(),
});

const paymentPlanSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  upfrontPercentage: z.number(),
  interestRate: z.number().optional(),
  durationWeeks: z.number().int(),
});

export const purchasesRouter = router({
  /** Purchase history for a brand. */
  list: protectedProcedure
    .input(paginationInput.extend({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      // Exclude internal purchases: the brand's order history shows only what they
      // actually bought. Internal/complimentary purchases (created by the agency) are
      // surfaced to the brand via their projects, not as "Purchases". Shared query
      // core (also backs the AI list_purchases tool).
      const [rows, [{ value: total }]] = await Promise.all([
        listBrandPurchases(ctx.db, input.brandId, {
          excludeInternal: true,
          limit: input.limit,
          offset: input.offset,
        }),
        ctx.db
          .select({ value: count() })
          .from(purchases)
          .where(and(eq(purchases.brandId, input.brandId), eq(purchases.viewableToBrand, true), eq(purchases.isInternal, false))),
      ]);
      // Attach item lines so the order-history list can render per-item rows.
      const byPurchase = await purchaseItemsByPurchase(ctx.db, rows.map((r) => r.id));
      return page(rows.map((r) => ({ ...r, items: byPurchase.get(r.id) ?? [] })), total, input);
    }),

  byId: protectedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const purchase = (await ctx.db.select().from(purchases).where(eq(purchases.id, input.id)).limit(1))[0];
    if (!purchase) throw new TRPCError({ code: 'NOT_FOUND' });
    if (purchase.brandId) await assertBrandAccess(ctx, purchase.brandId);
    const items = await ctx.db.select().from(purchaseItems).where(eq(purchaseItems.purchaseId, input.id));
    return { ...purchase, items };
  }),

  /**
   * Marketplace checkout: buy a cart of services (with variants / options /
   * add-ons / quantity / package grouping) under an optional payment plan.
   * Computes split one-off vs recurring billing, persists the purchase + items,
   * then starts a Stripe session (subscription for recurring, payment for
   * one-off). Ports `checkout_screen.dart` + `createMarketplacePurchase`.
   */
  checkoutServices: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        items: z.array(cartItemSchema).min(1),
        selectedPaymentPlan: paymentPlanSchema.nullish(),
        successUrl: z.string().url().optional(),
        cancelUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const ids = [...new Set(input.items.map((i) => i.serviceId))];
      const svcRows = await ctx.db.select().from(services).where(inArray(services.id, ids));
      const byId = new Map(svcRows.map((s) => [s.id, s]));

      const lines: CartLineInput[] = input.items.map((i) => {
        const s = byId.get(i.serviceId);
        if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: 'Service unavailable' });
        return {
          service: s,
          quantity: i.quantity,
          selectedVariantId: i.selectedVariantId ?? null,
          selectedAddons: (i.selectedAddons ?? []) as SelectedAddon[],
        };
      });

      const subtotals = computeSubtotals(lines);
      const plan = input.selectedPaymentPlan as PaymentPlan | null | undefined;
      const breakdown = plan ? computePaymentPlan(subtotals, plan) : computePayInFull(subtotals);

      // Per-item amount snapshots are the SOURCE OF TRUTH for what Stripe charges
      // (buildCheckoutLineItems reads them) — mirrors the cloud function, which
      // computes the plan PER ITEM. Derive the purchase-level due-today/weekly by
      // summing them so the stored totals and the Stripe lines can never drift.
      const lineAmounts = lines.map((l) => computeLineAmount(l, plan));
      const dueToday = lineAmounts.reduce((s, a) => s + a.oneOff.upfront + a.recurring.upfront, 0);
      const weekly = lineAmounts.reduce((s, a) => s + a.oneOff.weeklyAfter + a.recurring.weeklyAfter, 0);

      // Snapshot the platform commission rates at purchase time so a later rate
      // change can't retroactively alter this order's payouts (purchase_fulfillment parity).
      const settings = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];

      // Each item carries a FROZEN snapshot of its service's config + commissions
      // so the spawned project never has to re-read the (mutable) live service.
      const itemValues: PendingItem[] = input.items.map((i, idx) => {
        const s = byId.get(i.serviceId)!;
        const lineTotal = computeLineTotal(lines[idx]);
        return {
          // Minted here (not at DB insert) because it's embedded into the Stripe
          // product metadata and must match the row created on promotion.
          id: randomUUID(),
          serviceId: s.id,
          packageId: i.packageId ?? null,
          agencyId: s.agencyId,
          serviceName: s.name,
          serviceType: s.type,
          description: s.description,
          lineTotal: lineTotal.toFixed(2),
          // Rich one-off/recurring split snapshot (plan-applied) — buildCheckoutLineItems
          // reads this to emit the matching Stripe lines (deposit/setup one-time +
          // instalment/forever weekly). Without it, recurring & instalment items are
          // silently skipped and the session falls back to a one-off payment (no sub).
          amount: lineAmounts[idx] as unknown as Record<string, unknown>,
          quantity: i.quantity,
          isRecurring: isBillingCycleWeekly(s.type as ServiceType | null),
          deliverableFrequency: s.deliverableFrequency,
          repeatsEvery: s.repeatsEvery,
          digitalProductFileUrl: s.digitalProductFileUrl,
          digitalProductFileName: s.digitalProductFileName,
          selectedVariantId: i.selectedVariantId ?? null,
          selectedOptions: i.selectedOptions ?? {},
          selectedAddons: (i.selectedAddons ?? []) as unknown[],
          // Frozen snapshot (see migration 0008 / buildProjectValues).
          commissions: {
            productionManagerCommission: Number(s.productionManagerCommission ?? 0),
            briefingManagerCommission: Number(s.briefingManagerCommission ?? 0),
            internalApprovalCommission: Number(s.internalApprovalCommission ?? 0),
          },
          salesPersonCommissions: (s.salesPersonCommissions ?? {}) as Record<string, number>,
          upfrontProjectConfig: s.upfrontProjectConfig,
          recurringProjectConfig: s.recurringProjectConfig,
          upfrontDeliveryFee: s.upfrontDeliveryFee,
          recurringDeliveryFee: s.recurringDeliveryFee,
          sortOrder: idx,
        };
      });

      // Written to `pending_purchases` (NOT `purchases`) until Stripe confirms
      // payment — the purchases table only ever holds paid purchases.
      const { id, items } = await createPendingPurchase(
        ctx.db,
        {
          brandId: input.brandId,
          userId: ctx.user.id,
          type: 'marketplace',
          status: 'pendingPayment',
          totalAmount: dueToday.toFixed(2),
          selectedPaymentPlan: plan ?? null,
          agencyCommission: settings?.agencyCommission ?? null,
          affiliateCommission: settings?.affiliateCommission ?? null,
          prodeskCommission: settings?.prodeskCommission ?? null,
          salesAgencyCommission: settings?.salesAgencyCommission ?? null,
          amount: {
            oneOffSubtotal: subtotals.oneOffSubtotal,
            recurringUpfrontTotal: subtotals.recurringUpfrontTotal,
            recurringWeeklyTotal: subtotals.recurringWeeklyTotal,
            dueToday,
            weekly,
            planLabel: breakdown.planLabel,
          },
        },
        itemValues,
      );

      return startCheckout(id, items, input.successUrl, input.cancelUrl);
    }),

  /** Checkout an existing pending purchase (e.g. created from an accepted proposal). */
  checkoutPurchase: protectedProcedure.input(z.object({ id: z.string().uuid(), successUrl: z.string().url().optional(), cancelUrl: z.string().url().optional() })).mutation(async ({ ctx, input }) => {
    const pending = await getPendingPurchase(ctx.db, input.id);
    if (pending) {
      if (pending.purchase.brandId) await assertBrandAccess(ctx, pending.purchase.brandId);
      return startCheckout(input.id, pending.items, input.successUrl, input.cancelUrl);
    }
    // Not pending — it may already be paid (promoted). Surface its status idempotently.
    const purchase = (await ctx.db.select().from(purchases).where(eq(purchases.id, input.id)).limit(1))[0];
    if (!purchase) throw new TRPCError({ code: 'NOT_FOUND' });
    if (purchase.brandId) await assertBrandAccess(ctx, purchase.brandId);
    return { purchaseId: purchase.id, checkoutUrl: null as string | null, status: purchase.status };
  }),
});

/**
 * Start payment for a purchase. With Stripe configured, returns a hosted
 * checkout URL — the line items (subscription vs one-time) are derived from each
 * purchase item's frozen `amount` snapshot (see buildCheckoutLineItems). Without
 * Stripe (dev), the purchase is fulfilled immediately so the flow is testable.
 */
async function startCheckout(
  purchaseId: string,
  items: PendingItem[],
  successUrl?: string,
  cancelUrl?: string,
): Promise<{ purchaseId: string; checkoutUrl: string | null; status: string }> {
  if (!stripe) {
    // Dev (no Stripe): promote the pending purchase into `purchases` then fulfil
    // it immediately so the flow is testable end-to-end.
    await promotePendingPurchase(purchaseId);
    const fulfilled = await fulfillPurchase(purchaseId);
    return { purchaseId, checkoutUrl: null, status: fulfilled.status };
  }
  const { url } = await createCheckoutSession({ purchaseId, items, successUrl, cancelUrl });
  return { purchaseId, checkoutUrl: url, status: 'pendingPayment' };
}
