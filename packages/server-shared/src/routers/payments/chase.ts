/**
 * Payments (EziQuotes) — chase/recovery router, ported 1:1 from the Manus
 * export's server/routers/chase.ts. Vendor procedures (queue, sendNudge) are
 * brand-scoped; the recovery surface (getByToken, createRecoveryIntent,
 * confirmRecovery) is public and token-gated (30-day chase token). The
 * export's demo mode (no Stripe key → mock client secret) is preserved via
 * stripeEnabled.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';
import { db } from '../../db/index.js';
import { proposals } from '../../db/schema.js';
import {
  getClientById,
  getPaymentAccount,
  getPaymentByProposalId,
  getProposalByChaseToken,
  listOverdueProposals,
  logActivity,
  updateProposal,
  withClientId,
} from '../../modules/payments/db.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { stripe, stripeEnabled } from '../../modules/stripe/client.js';
import { resolveFeeForCharge } from '../../modules/payments/fee-calc.js';
import { emailBaseUrl } from '../../modules/email/branding.js';
import type Stripe from 'stripe';

export const chaseRouter = router({
  // -- List overdue proposals for the chase queue (CH5) ---------------------
  queue: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const rows = await listOverdueProposals(input.brandId);
      return rows;
    }),

  // -- Send a nudge SMS/email to a client ------------------------------------
  sendNudge: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [proposalRow] = await db.select()
        .from(proposals)
        .where(eq(proposals.id, input.proposalId))
        .limit(1);
      if (!proposalRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      const proposal = withClientId(proposalRow);
      await requirePaymentWrite(ctx, proposal.brandId);

      // Generate or reuse chase token (valid 30 days)
      const token = proposal.chaseToken ?? randomBytes(16).toString('hex');
      const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await updateProposal(proposal.id, proposal.brandId, {
        chaseToken: token,
        chaseTokenExpiry: expiry,
      });

      const client = proposal.clientId
        ? await getClientById(proposal.clientId, proposal.brandId)
        : null;

      const recoveryUrl = `${emailBaseUrl(ctx.clientOrigin)}/recover/${token}`;
      const clientName = client?.name ?? 'there';
      const amountFormatted = `$${(proposal.totalCents / 100).toFixed(0)}`;

      // Log the nudge activity
      await logActivity({
        action: 'proposal.nudge_sent',
        brandId: proposal.brandId,
        actorType: 'user',
        actorId: ctx.user.id,
        eventType: 'proposal.nudge_sent',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: {
          recoveryUrl,
          clientName,
          amount: amountFormatted,
          channel: 'sms',
        },
      });

      // In production this would call Twilio — for now return the recovery URL
      console.log(`[Chase] Nudge sent to ${clientName}: ${recoveryUrl}`);

      return {
        success: true,
        recoveryUrl,
        message: `Nudge queued for ${clientName} (${amountFormatted})`,
      };
    }),

  // -- Get chase details by token (public — for CH2/CH3 recovery page) -------
  getByToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const proposal = await getProposalByChaseToken(input.token);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recovery link not found or expired' });

      // Check token expiry
      if (proposal.chaseTokenExpiry && proposal.chaseTokenExpiry < new Date()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recovery link has expired' });
      }

      const account = await getPaymentAccount(proposal.brandId);
      const client = proposal.clientId
        ? await getClientById(proposal.clientId, proposal.brandId)
        : null;

      const payment = await getPaymentByProposalId(proposal.id);
      const daysOverdue = proposal.paidAt
        ? 0
        : Math.floor((Date.now() - (proposal.sentAt ?? proposal.createdAt).getTime()) / (1000 * 60 * 60 * 24));

      return {
        proposalId: proposal.id,
        slug: proposal.slug,
        title: proposal.title ?? 'Your invoice',
        totalCents: proposal.totalCents,
        currency: proposal.currency,
        status: proposal.status,
        daysOverdue,
        clientName: client?.name ?? 'there',
        businessName: account?.businessName ?? '',
        paymentModel: proposal.paymentModel,
        chaseStatus: payment?.chaseStatus ?? 'not_required',
        stripePaymentIntentId: proposal.stripePaymentIntentId,
      };
    }),

  // -- Create a new Payment Intent for the recovery page ---------------------
  createRecoveryIntent: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalByChaseToken(input.token);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Recovery link not found' });
      if (proposal.chaseTokenExpiry && proposal.chaseTokenExpiry < new Date()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Recovery link has expired' });
      }
      if (proposal.status === 'paid') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This invoice has already been paid' });
      }

      if (!stripeEnabled || !stripe) {
        // Return a mock client secret for demo/dev
        return { clientSecret: 'pi_demo_secret_demo', isDemo: true };
      }

      // Reuse existing PI or create new one
      if (proposal.stripePaymentIntentId) {
        const existing = await stripe.paymentIntents.retrieve(proposal.stripePaymentIntentId);
        if (existing.status === 'requires_payment_method' || existing.status === 'requires_confirmation') {
          return { clientSecret: existing.client_secret!, isDemo: false };
        }
      }

      const account = await getPaymentAccount(proposal.brandId);
      const chaseConnectId = account?.stripeConnectAccountId ?? null;
      const chasePiParams: Stripe.PaymentIntentCreateParams = {
        amount: proposal.totalCents,
        currency: proposal.currency.toLowerCase(),
        metadata: {
          proposalSlug: proposal.slug ?? '',
          brandId: proposal.brandId,
          clientId: proposal.clientId ?? '',
          source: 'chase_recovery',
        },
        description: `Recovery: ${proposal.title ?? proposal.slug} — ${account?.businessName ?? ''}`,
      };
      // application_fee_amount is only valid on destination/direct payments (requires connectId)
      if (chaseConnectId) {
        const chaseFee = await resolveFeeForCharge(proposal.id, proposal.totalCents);
        chasePiParams.application_fee_amount = chaseFee.applicationFeeCents;
        chasePiParams.on_behalf_of = chaseConnectId;
        chasePiParams.transfer_data = { destination: chaseConnectId };
      }
      const idempotencyKey = `chase-pi-${proposal.slug}-${proposal.id}`;
      const pi = await stripe.paymentIntents.create(chasePiParams, { idempotencyKey });

      await updateProposal(proposal.id, proposal.brandId, {
        stripePaymentIntentId: pi.id,
      });

      return { clientSecret: pi.client_secret!, isDemo: false };
    }),

  // -- Confirm recovery payment -----------------------------------------------
  confirmRecovery: publicProcedure
    .input(z.object({ token: z.string(), paymentIntentId: z.string() }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalByChaseToken(input.token);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });

      if (!stripeEnabled || !stripe) {
        // Demo mode — just mark as paid
        await updateProposal(proposal.id, proposal.brandId, {
          status: 'paid',
          paidAt: new Date(),
          stripePaymentIntentId: input.paymentIntentId,
        });
        return { success: true };
      }

      const pi = await stripe.paymentIntents.retrieve(input.paymentIntentId);

      if (pi.status !== 'succeeded') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Payment has not succeeded yet' });
      }

      await updateProposal(proposal.id, proposal.brandId, {
        status: 'paid',
        paidAt: new Date(),
        stripePaymentIntentId: pi.id,
      });

      await logActivity({
        action: 'proposal.recovered',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.recovered',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: {
          paymentIntentId: pi.id,
          amountCents: pi.amount,
          source: 'chase_recovery',
        },
      });

      return { success: true };
    }),
});
