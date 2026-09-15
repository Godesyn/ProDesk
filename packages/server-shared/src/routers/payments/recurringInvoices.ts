/**
 * Payments (EziQuotes) recurring invoices router — ported from the export's
 * server/routers/recurringInvoices.ts. The export registered a per-account
 * Manus heartbeat cron on create (POST /api/scheduled/recurringInvoices) —
 * dropped here: due-invoice processing becomes a single BullMQ repeatable job
 * wired by the main session (see TODO below), so create is pure DB insert.
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentClients, paymentRecurringInvoices } from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// Kept for the daily processor (used by the job handler when advancing schedules).
export function nextDueDate(from: Date, frequency: string): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'weekly': d.setDate(d.getDate() + 7); break;
    case 'fortnightly': d.setDate(d.getDate() + 14); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    case 'quarterly': d.setMonth(d.getMonth() + 3); break;
    case 'annually': d.setFullYear(d.getFullYear() + 1); break;
  }
  return d;
}

export const recurringInvoicesRouter = router({
  list: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return ctx.db
        .select()
        .from(paymentRecurringInvoices)
        .where(eq(paymentRecurringInvoices.brandId, input.brandId));
    }),

  create: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        title: z.string().min(1).max(255),
        lineItems: z.array(
          z.object({
            name: z.string(),
            description: z.string().optional(),
            qty: z.number().default(1),
            unitCents: z.number(),
          }),
        ),
        currency: z.string().default('AUD'),
        totalCents: z.number(),
        frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly', 'annually']).default('monthly'),
        startDate: z.string(), // ISO date string
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [client] = await ctx.db
        .select({ id: paymentClients.id, brandId: paymentClients.brandId })
        .from(paymentClients)
        .where(eq(paymentClients.id, input.clientId))
        .limit(1);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, client.brandId);

      const nextDueAt = new Date(input.startDate);
      const [result] = await ctx.db
        .insert(paymentRecurringInvoices)
        .values({
          brandId: client.brandId,
          clientId: input.clientId,
          title: input.title,
          lineItemsJson: JSON.stringify(input.lineItems),
          currency: input.currency as typeof paymentRecurringInvoices.$inferInsert['currency'],
          totalCents: input.totalCents,
          frequency: input.frequency,
          nextDueAt,
          isActive: true,
          notes: input.notes ?? null,
        })
        .returning({ id: paymentRecurringInvoices.id });

      // TODO(payments-jobs): the export scheduled a per-account daily heartbeat
      // (8am UTC, /api/scheduled/recurringInvoices) here. Replace with ONE
      // platform-wide BullMQ repeatable that processes all due
      // payment_recurring_invoices daily — wired by the main session in
      // jobs/queues.ts + the backend worker.

      return { success: true, id: result?.id ?? '' };
    }),

  toggle: protectedProcedure
    .input(z.object({ id: z.string().uuid(), isActive: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ brandId: paymentRecurringInvoices.brandId })
        .from(paymentRecurringInvoices)
        .where(eq(paymentRecurringInvoices.id, input.id))
        .limit(1);
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, invoice.brandId);
      await ctx.db
        .update(paymentRecurringInvoices)
        .set({ isActive: input.isActive })
        .where(
          and(
            eq(paymentRecurringInvoices.id, input.id),
            eq(paymentRecurringInvoices.brandId, invoice.brandId),
          ),
        );
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [invoice] = await ctx.db
        .select({ brandId: paymentRecurringInvoices.brandId })
        .from(paymentRecurringInvoices)
        .where(eq(paymentRecurringInvoices.id, input.id))
        .limit(1);
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, invoice.brandId);
      await ctx.db
        .delete(paymentRecurringInvoices)
        .where(
          and(
            eq(paymentRecurringInvoices.id, input.id),
            eq(paymentRecurringInvoices.brandId, invoice.brandId),
          ),
        );
      return { success: true };
    }),
});
