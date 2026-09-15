/**
 * Payments (EziQuotes) — client portal router, ported 1:1 from the Manus
 * export's server/routers/clientPortal.ts. Handles magic-link login for the
 * vendor's payers and portal data (subscriptions, payments, proposals).
 *
 * The portal session-token mechanism is preserved exactly: a single-use 24h
 * magic-link token is exchanged for a 30-day session token, both stored in
 * payment_client_portal_tokens; the frontend keeps the session token in
 * sessionStorage and passes it with every portal request.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import crypto from 'node:crypto';
import { and, desc, eq, gt } from 'drizzle-orm';
import { publicProcedure, router } from '../../trpc/trpc.js';
import { db } from '../../db/index.js';
import {
  paymentClientPortalTokens,
  paymentClients,
  proposals,
  paymentTransactions,
} from '../../db/schema.js';
import { getClientById, getPaymentAccount } from '../../modules/payments/db.js';
import { sendEmail } from '../../modules/payments/email.js';
import { stripe, stripeEnabled } from '../../modules/stripe/client.js';
import { calcInstallments, type BillingCycle } from '../../modules/payments/payment-model-calc.js';
import { emailBaseUrl } from '../../modules/email/branding.js';

// --- Helpers ------------------------------------------------------------------

function generateToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

function buildMagicLinkEmail(opts: {
  clientName: string | null;
  businessName: string;
  loginUrl: string;
}): { subject: string; htmlBody: string; textBody: string } {
  const name = opts.clientName ?? 'there';
  return {
    subject: `Your ${opts.businessName} client portal link`,
    htmlBody: `
      <div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:32px 24px;">
        <h2 style="margin:0 0 8px;font-size:22px;">Hi ${name},</h2>
        <p style="color:#555;margin:0 0 24px;">Click the button below to access your ${opts.businessName} client portal. This link expires in 24 hours and can only be used once.</p>
        <a href="${opts.loginUrl}" style="display:inline-block;background:#0E0E0C;color:#D9F542;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">Open my portal →</a>
        <p style="color:#999;font-size:12px;margin-top:32px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
    textBody: `Hi ${name},\n\nClick the link below to access your ${opts.businessName} client portal:\n\n${opts.loginUrl}\n\nThis link expires in 24 hours.\n\nIf you didn't request this, you can safely ignore this email.`,
  };
}

// --- Router -------------------------------------------------------------------

export const clientPortalRouter = router({
  /**
   * Request a magic-link login email for a client.
   * Called from the public client portal login page.
   */
  requestMagicLink: publicProcedure
    .input(z.object({
      email: z.string().email(),
      origin: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      // Find client by email (may belong to multiple brands — pick most recent)
      const [client] = await db
        .select()
        .from(paymentClients)
        .where(eq(paymentClients.email, input.email))
        .orderBy(desc(paymentClients.createdAt))
        .limit(1);

      // Always return success to prevent email enumeration
      if (!client) return { sent: true };

      const token = generateToken();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.insert(paymentClientPortalTokens).values({
        clientId: client.id,
        brandId: client.brandId,
        token,
        expiresAt,
      });

      // input.origin is client-controlled — run it through the email-origin
      // allow-list (falls back to the app origin in hosted envs).
      const loginUrl = `${emailBaseUrl(input.origin)}/client-portal/verify?token=${token}`;
      const account = await getPaymentAccount(client.brandId);
      const emailPayload = buildMagicLinkEmail({
        clientName: client.name,
        businessName: account?.businessName ?? 'EziQuotes',
        loginUrl,
      });

      await sendEmail({ to: input.email, ...emailPayload }).catch(console.error);

      return { sent: true };
    }),

  /**
   * Verify a magic-link token and return a short-lived session token.
   * The frontend stores this in sessionStorage and passes it with portal requests.
   */
  verifyToken: publicProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ input }) => {
      const [row] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(eq(paymentClientPortalTokens.token, input.token))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid or expired link' });
      if (row.usedAt) throw new TRPCError({ code: 'FORBIDDEN', message: 'This link has already been used' });
      if (row.expiresAt < new Date()) throw new TRPCError({ code: 'FORBIDDEN', message: 'This link has expired' });

      // Mark token as used
      await db
        .update(paymentClientPortalTokens)
        .set({ usedAt: new Date() })
        .where(eq(paymentClientPortalTokens.id, row.id));

      // Issue a new session token (valid 30 days)
      const sessionToken = generateToken();
      const sessionExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await db.insert(paymentClientPortalTokens).values({
        clientId: row.clientId,
        brandId: row.brandId,
        token: sessionToken,
        expiresAt: sessionExpiry,
        usedAt: null,
      });

      return {
        sessionToken,
        clientId: row.clientId,
        brandId: row.brandId,
      };
    }),

  /**
   * Get portal data for an authenticated client session.
   * Accepts a sessionToken in the input (stored in sessionStorage on the frontend).
   */
  getPortalData: publicProcedure
    .input(z.object({ sessionToken: z.string() }))
    .query(async ({ input }) => {
      // Validate session token
      const [session] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(
          and(
            eq(paymentClientPortalTokens.token, input.sessionToken),
            gt(paymentClientPortalTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired. Please log in again.' });

      const [client, account] = await Promise.all([
        getClientById(session.clientId, session.brandId),
        getPaymentAccount(session.brandId),
      ]);

      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });

      // Get all proposals for this client
      const clientProposals: (typeof proposals.$inferSelect)[] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.recipientContactId, session.clientId),
            eq(proposals.brandId, session.brandId),
            eq(proposals.kind, 'payer'),
          ),
        )
        .orderBy(desc(proposals.createdAt));

      // Get all payments for this client's proposals
      const proposalIds = clientProposals.map((p) => p.id);
      const clientPayments: (typeof paymentTransactions.$inferSelect)[] = proposalIds.length > 0
        ? await db
            .select()
            .from(paymentTransactions)
            .where(eq(paymentTransactions.brandId, session.brandId))
            .orderBy(desc(paymentTransactions.createdAt))
        : [];

      // Filter payments to only those for this client's proposals
      const myPayments = clientPayments.filter((pay) =>
        proposalIds.includes(pay.proposalId!),
      );

      // Active subscriptions = proposals with status "active" and paymentModel "subscription"
      const activeSubscriptions = clientProposals.filter(
        (p) => p.status === 'active' && p.paymentModel === 'subscription',
      );

      // Upcoming payments = payment_plan proposals that are accepted/active
      const upcomingPaymentPlans = clientProposals.filter(
        (p) =>
          p.paymentModel === 'payment_plan' &&
          (p.status === 'accepted' || p.status === 'active'),
      );

      const fmt = (cents: number, currency = 'AUD') =>
        new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);

      return {
        client: {
          id: client.id,
          name: client.name,
          email: client.email,
          businessName: client.businessName,
        },
        account: {
          businessName: account?.businessName ?? 'EziQuotes',
          tradingName: account?.tradingName,
          email: account?.email,
        },
        proposals: clientProposals.map((p) => ({
          id: p.id,
          slug: p.slug,
          title: p.title ?? p.slug,
          status: p.status,
          paymentModel: p.paymentModel,
          totalCents: p.totalCents,
          totalFormatted: fmt(p.totalCents, p.currency),
          currency: p.currency,
          createdAt: p.createdAt,
          sentAt: p.sentAt,
          acceptedAt: p.acceptedAt,
          paidAt: p.paidAt,
          expiresAt: p.expiresAt,
        })),
        activeSubscriptions: activeSubscriptions.map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = (p.paymentConfig ?? {}) as any;
          return {
            id: p.id,
            slug: p.slug,
            title: p.title ?? p.slug,
            monthlyAmountFormatted: fmt(p.totalCents, p.currency),
            monthlyAmountCents: p.totalCents,
            currency: p.currency,
            startedAt: p.acceptedAt ?? p.paidAt,
            billingInterval: config.billingInterval ?? 'monthly',
            nextBillingDate: config.nextBillingDate ?? null,
            stripeSubscriptionId: p.stripeSubscriptionId,
          };
        }),
        upcomingPayments: upcomingPaymentPlans.map((p) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const config = (p.paymentConfig ?? {}) as any;
          const installments: number = config.installments ?? 2;
          const paidCount: number = myPayments.filter(
            (pay) => pay.proposalId === p.id && pay.status === 'succeeded',
          ).length;
          const remaining = Math.max(0, installments - paidCount);
          const _installSummary = calcInstallments(
            [{ name: 'total', unitPriceCents: p.totalCents, qty: 1 }],
            { installments, billingCycle: (config.billingCycle ?? config.interval ?? 'monthly') as BillingCycle },
            0,
          );
          const installmentCents = _installSummary.perInstallmentCents;
          return {
            id: p.id,
            slug: p.slug,
            title: p.title ?? p.slug,
            totalFormatted: fmt(p.totalCents, p.currency),
            installmentFormatted: fmt(installmentCents, p.currency),
            installments,
            paidCount,
            remaining,
            nextDueDate: config.nextDueDate ?? null,
          };
        }),
        recentPayments: myPayments.slice(0, 10).map((pay) => ({
          id: pay.id,
          proposalId: pay.proposalId,
          proposalTitle: clientProposals.find((p) => p.id === pay.proposalId)?.title ?? (pay.proposalId ?? ''),
          amountFormatted: fmt(pay.amountCents, pay.currency),
          amountCents: pay.amountCents,
          status: pay.status,
          paidAt: pay.paidAt,
          createdAt: pay.createdAt,
        })),
        // True if this client has a Stripe customer ID (on client record or any proposal)
        hasStripeCustomer: !!(client.stripeCustomerId || clientProposals.some((p) => p.stripeCustomerId)),
      };
    }),

  /**
   * Create a Stripe billing portal session for a client to manage their subscriptions.
   * Returns a URL to redirect the client to the Stripe-hosted portal.
   */
  createBillingPortalSession: publicProcedure
    .input(z.object({
      sessionToken: z.string(),
      returnUrl: z.string().url(),
    }))
    .mutation(async ({ input }) => {
      // Validate session token
      const [session] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(
          and(
            eq(paymentClientPortalTokens.token, input.sessionToken),
            gt(paymentClientPortalTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);

      if (!session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired' });

      // Find the client's Stripe customer ID — check client record first, then proposals
      const clientRecord = await getClientById(session.clientId, session.brandId);
      let stripeCustomerId: string | null | undefined = clientRecord?.stripeCustomerId;

      if (!stripeCustomerId) {
        const [latestProposal] = await db
          .select()
          .from(proposals)
          .where(
            and(
              eq(proposals.recipientContactId, session.clientId),
              eq(proposals.brandId, session.brandId),
              eq(proposals.kind, 'payer'),
            ),
          )
          .orderBy(desc(proposals.createdAt))
          .limit(1);
        stripeCustomerId = latestProposal?.stripeCustomerId;
      }

      if (!stripeCustomerId) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No Stripe customer found for this client. Please contact your service provider.',
        });
      }

      if (!stripeEnabled || !stripe) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Stripe is not configured' });
      }
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: input.returnUrl,
      });

      return { url: portalSession.url };
    }),
});
