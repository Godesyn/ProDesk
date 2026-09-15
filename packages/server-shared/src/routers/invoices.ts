import { z } from 'zod';
import { and, or, eq, count, desc, isNotNull, sql, type SQL } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, protectedProcedure } from '../trpc/trpc.js';
import {
  invoices,
  invoiceItems,
  purchases,
  purchaseItems,
  payouts,
  brands,
  agencies,
} from '../db/schema.js';
import {
  assertBrandAccess,
  assertBrandViewAccess,
} from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';
import {
  resolveParties,
  formatInvoiceNumber,
  fromPartyRef,
  toPartyRef,
  deriveInvoiceStatus,
} from '../modules/billing/invoice-parties.js';
import { withInvoiceParties } from '../modules/billing/list-parties.js';
import { readinessForPayoutIds } from '../modules/billing/payout-readiness.js';
import { PRODESK_IDENTITY } from '../lib/prodesk-identity.js';

const round2 = (n: number): number => Math.round(n * 100) / 100;

// Invoice status derivation is shared from the billing module (single source of
// truth — also used by the AI invoice tool). Re-exported as `deriveStatus` for
// the existing importers (super-admin).
export { deriveInvoiceStatus as deriveStatus };

// SQL form of `deriveStatus`, for filtering/selecting the effective status inside a
// query that LEFT JOINs `payouts` on `invoices.payoutId`.
const derivedStatusSql = sql<string>`CASE
  WHEN ${payouts.id} IS NULL THEN 'paid'
  WHEN ${payouts.status} IN ('upcoming','pending','failed') THEN 'unpaid'
  ELSE ${payouts.status}::text
END`;

/**
 * Decorate invoice rows with their display number and the connected payout's
 * readiness checkpoints (bank linked / payout date / project completed). The
 * checkpoints power the status-badge hover tooltip; null when the invoice has
 * no connected payout.
 */
async function withReadiness<
  T extends { number: number; payoutId: string | null },
>(db: any, rows: T[]) {
  const readiness = await readinessForPayoutIds(
    db,
    rows.map((r) => r.payoutId),
  );
  return rows.map((r) => ({
    ...r,
    displayNumber: formatInvoiceNumber(r.number),
    payoutReadiness: r.payoutId ? (readiness.get(r.payoutId) ?? null) : null,
  }));
}

const statusEnum = z.enum([
  'unpaid',
  'paid',
  'dispatched',
  'processing',
  'processingByPaypal',
  'processingByWire',
  'processingByStripe',
  'received',
  'stopped',
]);

export const invoicesRouter = router({
  /**
   * Invoices for a brand (joined through their purchases). When no brandId is
   * given, returns invoices tied to the current user's payouts (beneficiary
   * side), so contractors/agencies see invoices they are owed against.
   */
  list: protectedProcedure
    .input(
      paginationInput.extend({
        brandId: z.string().uuid().optional(),
        status: statusEnum.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.brandId) {
        // `invoice` is an AGENCY permission; a brand viewing its own invoices is
        // gated by brand membership only (matches the route, which has no invoice
        // permission for brands). Owner/active brand staff may view.
        await assertBrandAccess(ctx, input.brandId);
        // A brand's invoices are either purchase-scoped (marketplace) OR
        // projected from an inbound payments charge (WS4: no purchase, brand is
        // the `from` party). LEFT JOIN purchases so payments-sourced invoices —
        // which have no purchaseId — still surface.
        const filters = [
          or(
            eq(purchases.brandId, input.brandId),
            and(isNotNull(invoices.paymentTransactionId), eq(invoices.fromBrandId, input.brandId)),
          )!,
        ];
        // Filter on the DERIVED status (payout-backed), not the stored column.
        if (input.status)
          filters.push(sql`${derivedStatusSql} = ${input.status}`);
        const where = and(...filters);

        const [rows, [{ value: total }]] = await Promise.all([
          ctx.db
            .select({ invoice: invoices, derivedStatus: derivedStatusSql })
            .from(invoices)
            .leftJoin(purchases, eq(invoices.purchaseId, purchases.id))
            .leftJoin(payouts, eq(invoices.payoutId, payouts.id))
            .where(where)
            .orderBy(desc(invoices.createdAt))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db
            .select({ value: count() })
            .from(invoices)
            .leftJoin(purchases, eq(invoices.purchaseId, purchases.id))
            .leftJoin(payouts, eq(invoices.payoutId, payouts.id))
            .where(where),
        ]);
        return page(
          await withInvoiceParties(
            ctx.db,
            await withReadiness(
              ctx.db,
              rows.map((r) => ({ ...r.invoice, status: r.derivedStatus })),
            ),
          ),
          total,
          input,
        );
      }

      // Beneficiary side: invoices that involve the current user — the
      // contractor/agency "invoices" view. An invoice counts as mine when its
      // connected payout's beneficiary is me, OR EITHER party (`fromParty` /
      // `toParty`) points at me (userId) or my selected agency (agencyId), so
      // invoices I issued AND invoices addressed to me both surface. Payouts are
      // only *generally* linked, so we LEFT JOIN and also match on the party refs
      // — invoices without a payout still surface.
      const me = ctx.user.id;
      const isContractor = ctx.user.role === 'individualContractor';
      const agencyId = ctx.user.selectedAgencyId ?? undefined;
      const mine: SQL[] = [
        eq(payouts.beneficiaryId, me),
        eq(invoices.toUserId, me),
        eq(invoices.fromUserId, me),
      ];
      // A contractor is strictly personal: only user-type invoices where their
      // own user id is the payout beneficiary / a party. Agency owners & staff
      // additionally see their selected agency's invoices.
      if (agencyId && !isContractor) {
        mine.push(eq(invoices.toAgencyId, agencyId));
        mine.push(eq(invoices.fromAgencyId, agencyId));
      }
      const filters = [or(...mine)!];
      // Filter on the DERIVED status (payout-backed), not the stored column.
      if (input.status)
        filters.push(sql`${derivedStatusSql} = ${input.status}`);
      const where = and(...filters);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ invoice: invoices, derivedStatus: derivedStatusSql })
          .from(invoices)
          .leftJoin(payouts, eq(invoices.payoutId, payouts.id))
          .where(where)
          .orderBy(desc(invoices.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(invoices)
          .leftJoin(payouts, eq(invoices.payoutId, payouts.id))
          .where(where),
      ]);
      return page(
        await withInvoiceParties(
          ctx.db,
          await withReadiness(
            ctx.db,
            rows.map((r) => ({ ...r.invoice, status: r.derivedStatus })),
          ),
        ),
        total,
        input,
      );
    }),

  byId: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const invoice = (
        await ctx.db
          .select()
          .from(invoices)
          .where(eq(invoices.id, input.id))
          .limit(1)
      )[0];
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      const items = await ctx.db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, input.id));
      // Resolve the stored party refs into full identity blocks (name/email/
      // address/ABN/phone) so the detail view's From/To render — the stored
      // fromParty/toParty only hold an id, mirroring Flutter's lazy resolution.
      const { from, to } = await resolveParties(
        ctx.db,
        fromPartyRef(invoice),
        toPartyRef(invoice),
      );
      // Connected-payout readiness checkpoints for the status-badge hover tooltip,
      // plus the payout status the invoice's effective status is derived from.
      let payoutStatus: string | null = null;
      let readiness = null;
      if (invoice.payoutId) {
        const p = (
          await ctx.db
            .select({ status: payouts.status })
            .from(payouts)
            .where(eq(payouts.id, invoice.payoutId))
            .limit(1)
        )[0];
        payoutStatus = p?.status ?? null;
        readiness =
          (await readinessForPayoutIds(ctx.db, [invoice.payoutId])).get(
            invoice.payoutId,
          ) ?? null;
      }
      return {
        ...invoice,
        status: deriveInvoiceStatus(payoutStatus),
        fromParty: from,
        toParty: to,
        displayNumber: formatInvoiceNumber(invoice.number),
        payoutReadiness: readiness,
        items,
      };
    }),

  /**
   * Generate a printable/PDF representation of an invoice.
   */
  pdf: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const invoice = (
        await ctx.db
          .select()
          .from(invoices)
          .where(eq(invoices.id, input.id))
          .limit(1)
      )[0];
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      const items = await ctx.db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, input.id));
      // TODO(by ai): Fix the url null to be the url that would be sent when sending email
      // the stored `total` is GST-inclusive (amount due); subtotal is 90%, GST 10%.
      const amountDue = Number(invoice.total) || 0;
      const { from, to } = await resolveParties(
        ctx.db,
        fromPartyRef(invoice),
        toPartyRef(invoice),
      );
      // Effective status is derived from the linked payout (docs/invoices.md §7).
      let payoutStatus: string | null = null;
      if (invoice.payoutId) {
        const p = (
          await ctx.db
            .select({ status: payouts.status })
            .from(payouts)
            .where(eq(payouts.id, invoice.payoutId))
            .limit(1)
        )[0];
        payoutStatus = p?.status ?? null;
      }
      const document = {
        number: formatInvoiceNumber(invoice.number),
        status: deriveInvoiceStatus(payoutStatus),
        issuedAt: invoice.createdAt,
        billingBasis: 'Service Duration',
        from,
        to,
        total: invoice.total,
        subtotal: round2(amountDue * 0.9),
        gst: round2(amountDue * 0.1),
        amountDue: round2(amountDue),
        commissionType: invoice.commissionType,
        items: items.map((i) => ({
          name: i.name,
          qty: i.qty,
          totalPrice: i.totalPrice,
          packageName: i.packageName,
          selectedOptions: i.selectedOptions,
          selectedAddons: i.selectedAddons,
        })),
      };
      return { url: null as string | null, document };
    }),

  /**
   * Build a tax-invoice document for a brand on the fly from a purchase + cycle —
   * the web port of Flutter `InvoiceService.salesAgencyToBrand`. Unlike the
   * commission-split invoices auto-created at fulfillment, this is the
   * client-facing invoice the BRAND generates from its Payments screen: From =
   * the sales agency (the proposal sender) or Prodesk, To = the brand, with line
   * items computed per billing cycle (upfront vs instalment). Nothing is
   * persisted — it returns the same `document` shape as `pdf` so the client
   * reuses the print path.
   */
  generateForPurchaseCycle: protectedProcedure
    .input(
      z.object({
        purchaseId: z.string().uuid(),
        cycle: z.number().int().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const n = (v: unknown) => Number(v) || 0;
      const purchase = (
        await ctx.db
          .select()
          .from(purchases)
          .where(eq(purchases.id, input.purchaseId))
          .limit(1)
      )[0];
      if (!purchase || !purchase.brandId)
        throw new TRPCError({ code: 'NOT_FOUND' });
      // Internal purchases are non-billable (agency-internal work, no client charge),
      // so there is no client tax invoice to generate. Production never invoiced the
      // `internal_purchase_history` collection.
      if (purchase.isInternal)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'Internal purchases are not billable and cannot be invoiced.',
        });
      // Gated by brand view access (brand owner/staff, the connected agency, admin).
      await assertBrandViewAccess(ctx, purchase.brandId);

      const lineItems = await ctx.db
        .select()
        .from(purchaseItems)
        .where(eq(purchaseItems.purchaseId, purchase.id));

      // From: the sales agency that sent the proposal, else Prodesk itself.
      let from: {
        name: string;
        email?: string | null;
        address?: string | null;
        abn?: string | null;
        phone?: string | null;
      };
      if (purchase.proposalSentByAgencyId) {
        const a = (
          await ctx.db
            .select()
            .from(agencies)
            .where(eq(agencies.id, purchase.proposalSentByAgencyId))
            .limit(1)
        )[0];
        from = {
          name:
            (a?.legalName?.trim() || a?.businessName?.trim()) ??
            PRODESK_IDENTITY.name,
          email: a?.businessEmail ?? null,
          address: a?.address ?? null,
          abn: a?.abn ?? null,
          phone: a?.phone ?? null,
        };
      } else {
        from = {
          name: PRODESK_IDENTITY.name,
          address: PRODESK_IDENTITY.address,
          abn: PRODESK_IDENTITY.abn,
        };
      }

      // To: the brand.
      const brand = (
        await ctx.db
          .select()
          .from(brands)
          .where(eq(brands.id, purchase.brandId))
          .limit(1)
      )[0];
      const to = {
        name: brand?.businessName ?? 'N/A',
        email: brand?.email ?? null,
        address: brand?.address ?? null,
        abn: brand?.abn ?? null,
        phone: brand?.phone ?? null,
      };

      // Per-cycle line items (1:1 with Flutter `invoiceItems`). Cycle 1 is the
      // upfront charge; later cycles bill instalments (oneOff weekly until the
      // plan ends) plus the forever recurring fee.
      const purchaseAmount = (purchase.amount ?? {}) as {
        oneOff?: { numberOfWeeks?: number };
      };
      const planWeeks = n(purchaseAmount.oneOff?.numberOfWeeks);
      const items = lineItems
        .map((it) => {
          const a = (it.amount ?? {}) as {
            oneOff?: { upfront?: number; weeklyAfter?: number };
            recurring?: { upfront?: number; weeklyAfter?: number };
          };
          const name = it.serviceName ?? 'Service';
          let label: string;
          let totalPrice: number;
          if (input.cycle === 1) {
            label =
              n(a.oneOff?.weeklyAfter) > 0
                ? `${name} (Upfront)`
                : n(a.recurring?.weeklyAfter) > 0
                  ? `${name} (Instalment 1)`
                  : name;
            totalPrice = n(a.oneOff?.upfront) + n(a.recurring?.upfront);
          } else if (input.cycle <= planWeeks) {
            label = `${name} (Instalment ${input.cycle})`;
            totalPrice = n(a.oneOff?.weeklyAfter) + n(a.recurring?.weeklyAfter);
          } else {
            label = `${name} (Instalment ${input.cycle})`;
            totalPrice = n(a.recurring?.weeklyAfter);
          }
          return {
            name: label,
            qty: it.quantity ?? 1,
            totalPrice: round2(totalPrice),
            packageName: null as string | null,
            selectedOptions: it.selectedOptions,
            selectedAddons: it.selectedAddons,
          };
        })
        .filter((i) => i.totalPrice > 0);

      const total = round2(items.reduce((s, i) => s + i.totalPrice, 0));
      const issuedAt = purchase.paidAt ?? purchase.createdAt ?? null;
      const document = {
        number: `#INV_${purchase.id.slice(0, 8).toUpperCase()}-${input.cycle}`,
        status: null as string | null,
        issuedAt,
        billingBasis: 'Service Duration',
        from,
        to,
        total,
        subtotal: round2(total * 0.9),
        gst: round2(total * 0.1),
        amountDue: total,
        commissionType: null as string | null,
        items,
      };
      return { url: null as string | null, document };
    }),
});
