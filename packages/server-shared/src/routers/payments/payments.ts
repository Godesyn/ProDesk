/**
 * Payments (EziQuotes) — money-movement router, ported 1:1 from the Manus
 * export's server/routers/payments.ts. All procedures are public (payer-facing
 * proposal surfaces addressed by slug). Tenancy: accountId → brandId (uuid);
 * Stripe via the shared platform client (destination charges with an
 * application fee resolved by modules/payments/fee-calc). Idempotency keys are
 * preserved verbatim from the export.
 */
import { TRPCError } from '@trpc/server';
import type Stripe from 'stripe';
import { z } from 'zod';
import { publicProcedure, router } from '../../trpc/trpc.js';
import {
  getClientById,
  getPaymentAccount,
  getBrandLegalName,
  getProposalBySlug,
  logActivity,
  updateProposal,
} from '../../modules/payments/db.js';
import { autoSendSurvey } from '../../modules/payments/lifecycle.js';
import { stripe, stripeEnabled } from '../../modules/stripe/client.js';
import {
  buildOwnerPaymentNotificationEmail,
  buildPaymentReceiptEmail,
  sendEmail,
} from '../../modules/payments/email.js';
import {
  calcDerivedApplicationFeePercent,
  resolveFeeForCharge,
} from '../../modules/payments/fee-calc.js';
import { emailBaseUrl } from '../../modules/email/branding.js';

function requireStripe(): Stripe {
  if (!stripeEnabled || !stripe) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
  }
  return stripe;
}

export const paymentsRouter = router({
  /**
   * Create a Stripe Checkout Session in subscription mode.
   * Used when proposal.paymentModel === "subscription".
   * Returns a checkout URL to redirect the client to.
   */
  createSubscriptionCheckout: publicProcedure
    .input(z.object({
      slug: z.string(),
      origin: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.status === 'paid' || proposal.status === 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal already active' });
      }
      if (proposal.expiresAt && new Date(proposal.expiresAt) < new Date()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'This proposal has expired' });
      }

      const stripeClient = requireStripe();
      const config = (proposal.paymentConfig ?? {}) as Record<string, unknown>;
      const intervalRaw = (config.billingCycle as string) ?? 'monthly';
      // Map billing cycle to Stripe interval
      const intervalMap: Record<string, { interval: 'day' | 'week' | 'month' | 'year'; interval_count: number }> = {
        weekly: { interval: 'week', interval_count: 1 },
        fortnightly: { interval: 'week', interval_count: 2 },
        monthly: { interval: 'month', interval_count: 1 },
        quarterly: { interval: 'month', interval_count: 3 },
        annually: { interval: 'year', interval_count: 1 },
      };
      const stripeInterval = intervalMap[intervalRaw] ?? { interval: 'month' as const, interval_count: 1 };

      // Recurring amount (totalCents is the recurring charge)
      const recurringAmount = proposal.totalCents;
      const currency = (proposal.currency ?? 'AUD').toLowerCase();

      const origin = input.origin ?? emailBaseUrl(ctx.clientOrigin);
      const successUrl = `${origin}/p/${proposal.slug}?subscription_success=1`;
      const cancelUrl = `${origin}/p/${proposal.slug}`;

      // Build line items for Stripe Checkout
      const lineItems = [{
        price_data: {
          currency,
          unit_amount: recurringAmount,
          product_data: {
            name: proposal.title ?? 'Subscription',
            description: `Recurring ${intervalRaw} subscription`,
          },
          recurring: stripeInterval,
        },
        quantity: 1,
      }];

      // Add upfront fee as a one-time line item if configured
      const upfrontCents = typeof config.upfrontFeeCents === 'number' ? config.upfrontFeeCents : 0;
      if (upfrontCents > 0) {
        (lineItems as unknown[]).push({
          price_data: {
            currency,
            unit_amount: upfrontCents,
            product_data: {
              name: (config.upfrontFeeLabel as string) ?? 'Setup fee',
            },
          },
          quantity: 1,
        });
      }

      // Look up the account's Stripe Connect ID for platform fee routing.
      const account = await getPaymentAccount(proposal.brandId);
      const connectAccountId = account?.stripeConnectAccountId ?? null;

      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        mode: 'subscription',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        line_items: lineItems as any,
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        client_reference_id: String(proposal.id),
        metadata: {
          proposalId: proposal.id,
          proposalSlug: proposal.slug ?? '',
          brandId: proposal.brandId,
          clientId: proposal.clientId ?? '',
        },
        subscription_data: {
          // Derived fee percent: platform fee is on subtotal (ex-GST), not on the GST-inclusive total.
          // Stripe charges the GST-inclusive total, so we derive a percentage of that total
          // that equals (platformFeeRate × subtotal). See calcDerivedApplicationFeePercent in fee-calc.ts.
          application_fee_percent: calcDerivedApplicationFeePercent(
            parseFloat(String(proposal.appliedFeePercentage ?? 3)),
            proposal.subtotalCents ?? proposal.totalCents,
            proposal.totalCents,
          ),
          metadata: {
            proposalId: proposal.id,
            brandId: proposal.brandId,
          },
        },
      };
      // Route through Connect if the account has completed onboarding.
      if (connectAccountId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (sessionParams as any).on_behalf_of = connectAccountId;
      }
      const checkoutIdempotencyKey = `checkout-${proposal.slug}-${proposal.id}`;
      const session = await stripeClient.checkout.sessions.create(sessionParams, {
        idempotencyKey: checkoutIdempotencyKey,
      });

      // Store the checkout session ID on the proposal for reference
      await updateProposal(proposal.id, proposal.brandId, {
        stripePaymentIntentId: session.id, // reuse field to store session id
      });

      return { checkoutUrl: session.url! };
    }),

  /**
   * Create a Stripe PaymentIntent for a proposal.
   * Returns the client_secret so the frontend can confirm with Stripe Elements.
   */
  createPaymentIntent: publicProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.status === 'paid') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal already paid' });
      }
      if (proposal.totalCents <= 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal has no amount' });
      }

      const stripeClient = requireStripe();

      // Reuse existing PaymentIntent if already created and still pending
      if (proposal.stripePaymentIntentId) {
        try {
          const existing = await stripeClient.paymentIntents.retrieve(proposal.stripePaymentIntentId);
          if (existing.status === 'requires_payment_method' || existing.status === 'requires_confirmation') {
            return { clientSecret: existing.client_secret! };
          }
        } catch {
          // Fall through to create a new one
        }
      }

      // Look up the account's Stripe Connect ID for platform fee routing.
      const acct = await getPaymentAccount(proposal.brandId);
      const connectId = acct?.stripeConnectAccountId ?? null;
      const piParams: Stripe.PaymentIntentCreateParams = {
        amount: proposal.totalCents,
        currency: (proposal.currency ?? 'AUD').toLowerCase(),
        metadata: {
          proposalId: proposal.id,
          proposalSlug: proposal.slug ?? '',
          brandId: proposal.brandId,
          clientId: proposal.clientId ?? '',
        },
        description: `Proposal ${proposal.slug} — ${proposal.title ?? 'Engagement'}`,
        automatic_payment_methods: { enabled: true },
      };
      // application_fee_amount is only valid on destination/direct payments (requires connectId)
      if (connectId) {
        const fee = await resolveFeeForCharge(proposal.id, proposal.totalCents);
        piParams.application_fee_amount = fee.applicationFeeCents;
        piParams.on_behalf_of = connectId;
        piParams.transfer_data = { destination: connectId };
      }
      const piIdempotencyKey = `pi-${proposal.slug}-${proposal.id}`;
      const pi = await stripeClient.paymentIntents.create(piParams, { idempotencyKey: piIdempotencyKey });
      // Store PI id on the proposal
      await updateProposal(proposal.id, proposal.brandId, {
        stripePaymentIntentId: pi.id,
      });

      return { clientSecret: pi.client_secret! };
    }),

  /**
   * Confirm payment after Stripe Elements succeeds on the frontend.
   * Called by the frontend after stripe.confirmPayment() resolves successfully.
   */
  confirmPayment: publicProcedure
    .input(z.object({
      slug: z.string(),
      paymentIntentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });

      const stripeClient = requireStripe();
      const pi = await stripeClient.paymentIntents.retrieve(input.paymentIntentId);

      if (pi.status !== 'succeeded') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Payment not succeeded: ${pi.status}` });
      }

      // Mark proposal as paid
      await updateProposal(proposal.id, proposal.brandId, {
        status: 'paid',
        paidAt: new Date(),
        acceptedAt: proposal.acceptedAt ?? new Date(),
        stripePaymentIntentId: pi.id,
      });

      await logActivity({
        action: 'proposal.paid',
        brandId: proposal.brandId,
        actorType: 'payer',
        actorId: proposal.clientId ?? null,
        eventType: 'proposal.paid',
        entityType: 'proposal',
        entityId: proposal.id,
        metadata: {
          paymentIntentId: pi.id,
          amountCents: pi.amount,
          currency: pi.currency,
        },
      });

      // Send confirmation emails with PDF receipt attachment (fire-and-forget)
      const [client, account, legalName] = await Promise.all([
        proposal.clientId ? getClientById(proposal.clientId, proposal.brandId) : null,
        getPaymentAccount(proposal.brandId),
        getBrandLegalName(proposal.brandId),
      ]);
      const amountFormatted = `$${(pi.amount / 100).toFixed(0)}`;
      const proposalUrl = `${emailBaseUrl(ctx.clientOrigin)}/p/${proposal.slug}`;
      if (client?.email) {
        const receipt = buildPaymentReceiptEmail({
          clientName: client.name,
          businessName: account?.businessName ?? 'EziQuotes',
          proposalTitle: proposal.title ?? proposal.slug ?? '',
          amountFormatted,
          proposalUrl,
        });
        // Attach a PDF receipt
        (async () => {
          try {
            const { generateProposalPdf } = await import('../../modules/payments/pdf.js');
            // Extract line items and sections from proposal.structure (JSONB array of blocks)
            const structure: Array<{ type: string; title?: string; content?: string; items?: Array<{ name: string; description?: string; qty?: number; unitPriceCents: number; totalCents: number }> }> =
              Array.isArray(proposal.structure) ? (proposal.structure as any[]) : [];
            const lineItemsFromStructure = structure
              .filter((b) => b.type === 'pricing' && Array.isArray(b.items))
              .flatMap((b) => b.items ?? []);
            const pdfBuffer = await generateProposalPdf({
              title: proposal.title ?? proposal.slug ?? '',
              clientName: client.name,
              businessName: legalName ?? account?.businessName ?? 'EziQuotes',
              abn: account?.abn ?? undefined,
              totalCents: proposal.totalCents,
              subtotalCents: proposal.subtotalCents ?? proposal.totalCents,
              taxCents: proposal.taxCents ?? 0,
              taxLabel: account?.taxLabel ?? 'GST',
              taxRate: account?.defaultTaxRate ? parseFloat(account.defaultTaxRate) : 10,
              currency: proposal.currency ?? 'AUD',
              paymentModel: proposal.paymentModel ?? 'one_off',
              lineItems: lineItemsFromStructure.map((li) => ({
                name: li.name ?? 'Item',
                description: li.description ?? undefined,
                qty: li.qty ?? undefined,
                unitPriceCents: li.unitPriceCents ?? 0,
                totalCents: li.totalCents ?? 0,
              })),
              // receiptMode strips all non-pricing sections, signature block,
              // and labels the document as a Receipt — keeps it to one page.
              receiptMode: true,
              paidAt: new Date(),
              createdAt: proposal.createdAt,
              expiresAt: proposal.expiresAt,
              slug: proposal.slug ?? '',
            });
            const pdfBase64 = pdfBuffer.toString('base64');
            await sendEmail({
              to: client.email!,
              ...receipt,
              attachments: [{
                name: `receipt-${proposal.slug}.pdf`,
                content: pdfBase64,
                contentType: 'application/pdf',
              }],
            });
          } catch (err) {
            // Fall back to email without attachment
            console.error('[Payment] PDF receipt generation failed, sending without attachment:', err);
            await sendEmail({ to: client.email!, ...receipt });
          }
        })().catch(console.error);
      }
      if (account?.email) {
        const notif = buildOwnerPaymentNotificationEmail({
          ownerName: account.businessName ?? 'there',
          clientName: client?.name ?? 'Your client',
          proposalTitle: proposal.title ?? proposal.slug ?? '',
          amountFormatted,
          proposalUrl,
        });
        sendEmail({ to: account.email, ...notif }).catch(console.error);
      }

      // Auto-send satisfaction survey (fire-and-forget)
      autoSendSurvey({
        proposalId: proposal.id,
        brandId: proposal.brandId,
        clientId: proposal.clientId ?? null,
      }).catch(console.error);

      return { success: true };
    }),

  /**
   * Create a Stripe PaymentIntent for a dual_option proposal.
   * The payer chooses upfront (discounted) or payment plan (deposit first).
   * choice: "upfront" | "plan"
   */
  createDualOptionIntent: publicProcedure
    .input(z.object({
      slug: z.string(),
      choice: z.enum(['upfront', 'plan']),
    }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.status === 'paid') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal already paid' });
      if (proposal.totalCents <= 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Proposal has no amount' });

      const pc = (proposal.paymentConfig as Record<string, unknown>) ?? {};
      const stripeClient = requireStripe();
      const acct = await getPaymentAccount(proposal.brandId);
      const connectId = acct?.stripeConnectAccountId ?? null;

      let amountCents: number;
      let description: string;
      if (input.choice === 'upfront') {
        const discountPct = typeof pc.dualDiscountPct === 'number' ? pc.dualDiscountPct : 0;
        amountCents = Math.round(proposal.totalCents * (1 - discountPct / 100));
        description = `Proposal ${proposal.slug} — Upfront (${discountPct}% discount)`;
      } else {
        // First installment / deposit of the payment plan
        const depositPct = typeof pc.ppDepositPct === 'number' ? pc.ppDepositPct : 0;
        const installments = Math.max(2, parseInt(String(pc.ppInstallments ?? '3'), 10));
        amountCents = depositPct > 0
          ? Math.round(proposal.totalCents * depositPct / 100)
          : Math.round(proposal.totalCents / installments);
        description = `Proposal ${proposal.slug} — Payment plan deposit`;
      }

      const feeResult = await resolveFeeForCharge(proposal.id, amountCents);
      const piParams: Stripe.PaymentIntentCreateParams = {
        amount: amountCents,
        currency: (proposal.currency ?? 'AUD').toLowerCase(),
        metadata: {
          proposalId: proposal.id,
          proposalSlug: proposal.slug ?? '',
          brandId: proposal.brandId,
          clientId: proposal.clientId ?? '',
          dualChoice: input.choice,
        },
        description,
        automatic_payment_methods: { enabled: true },
      };
      // application_fee_amount is only valid on destination/direct payments (requires connectId)
      if (connectId) {
        piParams.application_fee_amount = feeResult.applicationFeeCents;
        piParams.on_behalf_of = connectId;
        piParams.transfer_data = { destination: connectId };
      }
      const pi = await stripeClient.paymentIntents.create(piParams, {
        idempotencyKey: `dual-${proposal.slug}-${input.choice}-${proposal.id}`,
      });
      return { clientSecret: pi.client_secret!, amountCents, choice: input.choice };
    }),
});
