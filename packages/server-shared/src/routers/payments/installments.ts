/**
 * Payments (EziQuotes) — installment schedules router, ported 1:1 from the
 * Manus export's server/routers/installments.ts. Public procedures serve the
 * payer-facing proposal page (slug-addressed); listByProposalId is the vendor
 * dashboard surface (entity-scoped brand access). Off-session auto-charge
 * setup (customer + saved payment method) preserved exactly.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';
import { db } from '../../db/index.js';
import { paymentInstallmentSchedules, proposals } from '../../db/schema.js';
import {
  getClientById,
  getPaymentAccount,
  getProposalBySlug,
  logActivity,
  updateProposal,
} from '../../modules/payments/db.js';
import { autoSendSurvey } from '../../modules/payments/lifecycle.js';
import { requirePaymentRead } from '../../modules/payments/access.js';
import { stripe, stripeEnabled } from '../../modules/stripe/client.js';
import { sendEmail } from '../../modules/payments/email.js';
import { calcInstallments, type BillingCycle } from '../../modules/payments/payment-model-calc.js';
import { resolveFeeForCharge } from '../../modules/payments/fee-calc.js';
import { emailBaseUrl } from '../../modules/email/branding.js';
import type Stripe from 'stripe';

// --- Helpers ----------------------------------------------------------------

function requireStripe(): Stripe {
  if (!stripeEnabled || !stripe) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
  }
  return stripe;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addWeeks(date: Date, weeks: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + weeks * 7);
  return d;
}

function getDueDates(
  startDate: Date,
  count: number,
  frequency: 'weekly' | 'fortnightly' | 'monthly' | 'quarterly',
): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    if (frequency === 'weekly') dates.push(addWeeks(startDate, i));
    else if (frequency === 'fortnightly') dates.push(addWeeks(startDate, i * 2));
    else if (frequency === 'monthly') dates.push(addMonths(startDate, i));
    else if (frequency === 'quarterly') dates.push(addMonths(startDate, i * 3));
  }
  return dates;
}

// --- Router -----------------------------------------------------------------

export const installmentsRouter = router({
  /**
   * Create installment schedule for a payment_plan proposal.
   * Called when a client accepts a payment plan proposal.
   * Splits totalCents into N installments with due dates.
   */
  createSchedule: publicProcedure
    .input(z.object({
      slug: z.string(),
      frequency: z.enum(['weekly', 'fortnightly', 'monthly', 'quarterly']).optional(),
    }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.paymentModel !== 'payment_plan') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a payment plan proposal' });
      }

      // Check if schedule already exists
      const existing = await db.select()
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.proposalId, proposal.id))
        .limit(1);
      if (existing.length > 0) {
        return { success: true, message: 'Schedule already exists' };
      }

      const config = (proposal.paymentConfig ?? {}) as Record<string, unknown>;
      const count = typeof config.installments === 'number' ? config.installments : 3;
      const frequency = (input.frequency ?? (config.billingCycle as string) ?? 'monthly') as 'weekly' | 'fortnightly' | 'monthly' | 'quarterly';

      // Split total evenly; add remainder to last installment (via payment-model-calc)
      const _installSummary = calcInstallments(
        [{ name: 'total', unitPriceCents: proposal.totalCents, qty: 1 }],
        { installments: count, billingCycle: frequency as BillingCycle },
        0,
      );
      const perInstallment = _installSummary.perInstallmentCents;
      const remainder = _installSummary.remainderCents;

      const startDate = new Date();
      // First installment due immediately (or in 1 day), rest spaced by frequency
      const dueDates = getDueDates(startDate, count, frequency);

      const rows = dueDates.map((dueAt, i) => ({
        proposalId: proposal.id,
        brandId: proposal.brandId,
        clientId: proposal.clientId,
        installmentNumber: i + 1,
        totalInstallments: count,
        amountCents: i === count - 1 ? perInstallment + remainder : perInstallment,
        currency: proposal.currency ?? 'AUD',
        dueAt,
        status: i === 0 ? ('due' as const) : ('pending' as const),
      }));

      await db.insert(paymentInstallmentSchedules).values(rows);

      // Mark proposal as accepted
      await updateProposal(proposal.id, proposal.brandId, {
        status: 'accepted',
        acceptedAt: new Date(),
      });

      await logActivity({
        action: 'proposal.accepted',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.accepted',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: { paymentModel: 'payment_plan', installments: count, frequency },
      });

      return { success: true, installments: count };
    }),

  /**
   * List installment schedule for a proposal (public — for client portal and proposal page).
   */
  listBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      const rows = await db.select()
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.proposalId, proposal.id));
      return rows.sort((a, b) => a.installmentNumber - b.installmentNumber);
    }),

  /**
   * List installment schedule for a proposal (protected — for dashboard).
   */
  listByProposalId: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ input, ctx }) => {
      const [proposal] = await db.select()
        .from(proposals)
        .where(eq(proposals.id, input.proposalId))
        .limit(1);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, proposal.brandId!);
      const rows = await db.select()
        .from(paymentInstallmentSchedules)
        .where(
          and(
            eq(paymentInstallmentSchedules.proposalId, input.proposalId),
            eq(paymentInstallmentSchedules.brandId, proposal.brandId!),
          ),
        );
      return rows.sort((a, b) => a.installmentNumber - b.installmentNumber);
    }),

  /**
   * Create a Stripe PaymentIntent for a specific installment.
   * Returns clientSecret for Stripe Elements.
   */
  createPaymentIntent: publicProcedure
    .input(z.object({
      installmentId: z.string().uuid(),
      slug: z.string(),
    }))
    .mutation(async ({ input }) => {
      const [installment] = await db.select()
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.id, input.installmentId))
        .limit(1);

      if (!installment) throw new TRPCError({ code: 'NOT_FOUND' });
      if (installment.status === 'paid') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Installment already paid' });
      }

      const proposal = await getProposalBySlug(input.slug);
      if (!proposal || proposal.id !== installment.proposalId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const stripeClient = requireStripe();

      // Reuse existing PI if still pending
      if (installment.stripePaymentIntentId) {
        try {
          const existing = await stripeClient.paymentIntents.retrieve(installment.stripePaymentIntentId);
          if (existing.status === 'requires_payment_method' || existing.status === 'requires_confirmation') {
            return { clientSecret: existing.client_secret! };
          }
        } catch {
          // Fall through
        }
      }

      const installAcct = await getPaymentAccount(installment.brandId!);
      const installConnectId = installAcct?.stripeConnectAccountId ?? null;

      // Ensure a Stripe Customer exists on the proposal so we can save the card for future auto-charges
      let stripeCustomerId = proposal.stripeCustomerId ?? null;
      if (!stripeCustomerId) {
        const client = await getClientById(installment.clientId!, installment.brandId!);
        const customer = await stripeClient.customers.create({
          email: client?.email ?? undefined,
          name: client?.name ?? undefined,
          metadata: {
            proposalId: proposal.id,
            clientId: installment.clientId!,
            brandId: installment.brandId!,
          },
        });
        stripeCustomerId = customer.id;
        // Persist customer id on proposal so we reuse it for subsequent installments
        await updateProposal(proposal.id, proposal.brandId, { stripeCustomerId });
      }

      const installPiParams: Stripe.PaymentIntentCreateParams = {
        amount: installment.amountCents,
        currency: (installment.currency ?? 'AUD').toLowerCase(),
        customer: stripeCustomerId,
        // Save the card so subsequent installments can be charged off-session
        setup_future_usage: 'off_session',
        metadata: {
          proposalId: installment.proposalId,
          proposalSlug: proposal.slug ?? '',
          brandId: installment.brandId ?? '',
          clientId: installment.clientId ?? '',
          installmentId: installment.id,
          installmentNumber: String(installment.installmentNumber),
          totalInstallments: String(installment.totalInstallments),
        },
        description: `Installment ${installment.installmentNumber}/${installment.totalInstallments} — ${proposal.title ?? proposal.slug}`,
        automatic_payment_methods: { enabled: true },
      };
      // application_fee_amount is only valid on destination/direct payments (requires connectId)
      if (installConnectId) {
        const installFee = await resolveFeeForCharge(installment.proposalId, installment.amountCents);
        installPiParams.application_fee_amount = installFee.applicationFeeCents;
        installPiParams.on_behalf_of = installConnectId;
        installPiParams.transfer_data = { destination: installConnectId };
      }
      const idempotencyKey = `install-pi-${installment.proposalId}-${installment.id}-${installment.installmentNumber}`;
      const pi = await stripeClient.paymentIntents.create(installPiParams, { idempotencyKey });

      // Store PI id on the installment
      await db.update(paymentInstallmentSchedules)
        .set({ stripePaymentIntentId: pi.id })
        .where(eq(paymentInstallmentSchedules.id, installment.id));

      return { clientSecret: pi.client_secret! };
    }),

  /**
   * Confirm installment payment after Stripe Elements succeeds.
   */
  confirmPayment: publicProcedure
    .input(z.object({
      installmentId: z.string().uuid(),
      paymentIntentId: z.string(),
      slug: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [installment] = await db.select()
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.id, input.installmentId))
        .limit(1);

      if (!installment) throw new TRPCError({ code: 'NOT_FOUND' });

      const stripeClient = requireStripe();
      const pi = await stripeClient.paymentIntents.retrieve(input.paymentIntentId);
      if (pi.status !== 'succeeded') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Payment not succeeded: ${pi.status}` });
      }

      // Mark installment as paid
      await db.update(paymentInstallmentSchedules)
        .set({ status: 'paid', paidAt: new Date(), stripePaymentIntentId: pi.id })
        .where(eq(paymentInstallmentSchedules.id, installment.id));

      // Save the payment method on the proposal for future off-session auto-charges
      // The PaymentIntent's payment_method is populated after it succeeds
      const paymentMethodId = typeof pi.payment_method === 'string'
        ? pi.payment_method
        : pi.payment_method?.id ?? null;
      if (paymentMethodId && installment.proposalId) {
        try {
          // Attach the payment method to the customer so it persists
          const proposal = await getProposalBySlug(input.slug);
          if (proposal?.stripeCustomerId) {
            await stripeClient.paymentMethods.attach(paymentMethodId, { customer: proposal.stripeCustomerId });
            // Set as default payment method on the customer
            await stripeClient.customers.update(proposal.stripeCustomerId, {
              invoice_settings: { default_payment_method: paymentMethodId },
            });
          }
          await updateProposal(installment.proposalId, installment.brandId!, {
            stripePaymentMethodId: paymentMethodId,
          });
          console.log(`[Installments] Saved payment method ${paymentMethodId} for proposal ${installment.proposalId}`);
        } catch (err) {
          console.error('[Installments] Failed to save payment method:', err);
        }
      }

      // Check if all installments are paid → mark proposal as paid
      const allInstallments = await db.select()
        .from(paymentInstallmentSchedules)
        .where(eq(paymentInstallmentSchedules.proposalId, installment.proposalId));

      const allPaid = allInstallments.every(
        (ins) => ins.id === installment.id || ins.status === 'paid',
      );

      if (allPaid) {
        await updateProposal(installment.proposalId, installment.brandId!, {
          status: 'paid',
          paidAt: new Date(),
        });
        // Auto-send satisfaction survey when final installment is paid
        const finalProposal = await getProposalBySlug(input.slug);
        if (finalProposal) {
          autoSendSurvey({
            proposalId: finalProposal.id,
            brandId: finalProposal.brandId,
            clientId: finalProposal.clientId ?? null,
          }).catch(console.error);
        }
      } else {
        // Mark next installment as due and set autoChargeAt to the due date
        const nextInstallment = allInstallments
          .filter((ins) => ins.status === 'pending')
          .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
        if (nextInstallment) {
          await db.update(paymentInstallmentSchedules)
            .set({ status: 'due', autoChargeAt: nextInstallment.dueAt })
            .where(eq(paymentInstallmentSchedules.id, nextInstallment.id));
        }
      }

      await logActivity({
        action: 'proposal.installment_paid',
        brandId: installment.brandId!,
        actorType: 'payer',
        actorId: installment.clientId ?? null,
        eventType: 'proposal.installment_paid',
        entityType: 'proposal',
        entityId: installment.proposalId,
        metadata: {
          installmentId: installment.id,
          installmentNumber: installment.installmentNumber,
          totalInstallments: installment.totalInstallments,
          amountCents: pi.amount,
          paymentIntentId: pi.id,
          allPaid,
        },
      });

      // Send reminder for next installment if not all paid
      if (!allPaid) {
        try {
          const proposal = await getProposalBySlug(input.slug);
          const [client, account] = await Promise.all([
            proposal?.clientId ? getClientById(proposal.clientId, proposal.brandId) : null,
            proposal ? getPaymentAccount(proposal.brandId) : null,
          ]);
          const nextDue = allInstallments
            .filter((ins) => ins.status === 'pending' || ins.status === 'due')
            .sort((a, b) => a.installmentNumber - b.installmentNumber)[0];
          if (client?.email && nextDue && proposal) {
            const nextAmount = `$${(nextDue.amountCents / 100).toFixed(0)}`;
            const nextDate = new Date(nextDue.dueAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
            sendEmail({
              to: client.email,
              subject: `Payment ${installment.installmentNumber}/${installment.totalInstallments} confirmed — next due ${nextDate}`,
              htmlBody: `<p>Hi ${client.name},</p>
<p>Your payment of <strong>$${(pi.amount / 100).toFixed(0)}</strong> has been received. Thank you!</p>
<p>Your next installment of <strong>${nextAmount}</strong> is due on <strong>${nextDate}</strong>.</p>
<p>You can pay at any time at: <a href="${emailBaseUrl(ctx.clientOrigin)}/p/${proposal.slug}">${proposal.title ?? proposal.slug}</a></p>
<p>— ${account?.businessName ?? 'EziQuotes'}</p>`,
              textBody: `Payment ${installment.installmentNumber}/${installment.totalInstallments} confirmed. Next: ${nextAmount} due ${nextDate}.`,
            }).catch(console.error);
          }
        } catch (err) {
          console.error('[Installments] Reminder email failed:', err);
        }
      }

      return { success: true, allPaid };
    }),
});
