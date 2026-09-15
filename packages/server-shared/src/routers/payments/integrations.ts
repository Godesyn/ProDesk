/**
 * Payments (EziQuotes) integrations router — Stripe Connect, Twilio SMS,
 * Postmark email, Pipedrive CRM, ported from the export's
 * server/routers/integrations.ts. Stripe Connect state is now
 * base64url({ brandId, origin }) with origin taken from ctx.clientOrigin
 * (the export encoded { userId, origin: input.origin }); the callback handler
 * in servers/backend must decode the same shape. Pipedrive helpers come from
 * modules/payments/pipedrive.ts (ported concurrently, same export names as the
 * export's server/pipedrive.ts). No Xero/MYOB procedures existed in the
 * export's integrations router (their tokens live on paymentAccounts and are
 * managed elsewhere).
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentClients, proposals } from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount, updatePaymentAccount, withClientId } from '../../modules/payments/db.js';
import { getTierForAccount } from '../../modules/payments/fee-calc.js';
import {
  createPipedriveDeal,
  createPipedrivePerson,
  getPipedriveDeals,
  getPipedrivePipelines,
  getPipedriveStages,
  isPipedriveConfigured,
  refreshPipedriveToken,
  updatePipedriveDeal,
} from '../../modules/payments/pipedrive.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { env } from '../../lib/env.js';

// --- Stripe Connect -----------------------------------------------------------
const stripeRouter = router({
  /**
   * Returns the Stripe Connect OAuth URL for the brand to authorise.
   * Platform fee is tier-based — see fee-calc.ts for rates.
   */
  connectUrl: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      // STRIPE_CLIENT_ID — the platform's Stripe Connect OAuth client id
      // (ca_...), distinct from the API secret key.
      const clientId = env.STRIPE_CLIENT_ID;
      if (!clientId) {
        return { url: null, message: 'Stripe Connect not configured — add STRIPE_CLIENT_ID secret' };
      }
      const origin = ctx.clientOrigin;
      const state = Buffer.from(JSON.stringify({ brandId: input.brandId, origin })).toString('base64url');
      // The callback lives on the BACKEND origin (hosted clients are static and
      // can't proxy /api) — see modules/payments/http.ts. The browser is bounced
      // back to `origin` (the payments client) after the exchange.
      const redirectUri = `${env.SERVER_ORIGIN}/api/payments/stripe/callback`;
      const url = `https://connect.stripe.com/oauth/authorize?response_type=code&client_id=${clientId}&scope=read_write&state=${state}&redirect_uri=${encodeURIComponent(redirectUri)}`;
      return { url };
    }),

  /**
   * Status of the Stripe Connect account for the brand.
   */
  status: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      // Resolve the live tier rate for this account
      let platformFeePercent = 1.0; // safe fallback (Send tier default)
      try {
        const tierResult = await getTierForAccount(input.brandId);
        platformFeePercent = tierResult.ratePercent;
      } catch {
        // Non-fatal — fall back to Send tier default
      }
      // A brand with no payment-account row yet (e.g. mid-onboarding) is simply
      // "not connected" — a valid status, not an error. Throwing NOT_FOUND here
      // surfaced as a tRPC error on the Onboarding/Settings pages.
      if (!account) {
        return {
          connected: false,
          stripeAccountId: null,
          status: 'not_connected' as const,
          platformFeePercent,
        };
      }
      return {
        connected: !!account.stripeConnectAccountId,
        stripeAccountId: account.stripeConnectAccountId ?? null,
        status: account.stripeConnectStatus ?? 'not_connected',
        platformFeePercent,
      };
    }),

  /**
   * Disconnect Stripe Connect.
   */
  disconnect: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      await updatePaymentAccount(input.brandId, {
        stripeConnectAccountId: null,
        stripeConnectStatus: 'not_connected',
      });
      return { success: true };
    }),
});

// --- Twilio SMS ---------------------------------------------------------------
const twilioRouter = router({
  /**
   * Send a test SMS to verify Twilio credentials.
   * For AU: uses alphanumeric sender ID (requires TWILIO_ALPHA_SENDER env).
   */
  testSms: protectedProcedure
    .input(z.object({ to: z.string().min(8) }))
    .mutation(async ({ input }) => {
      const accountSid = env.TWILIO_ACCOUNT_SID;
      const authToken = env.TWILIO_AUTH_TOKEN;
      const from = env.TWILIO_ALPHA_SENDER ?? env.TWILIO_FROM_NUMBER;
      if (!accountSid || !authToken || !from) {
        return { success: false, message: 'Twilio not configured — add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_ALPHA_SENDER secrets' };
      }
      // Real implementation would call Twilio REST API here (see modules/payments/sms.ts)
      return { success: true, message: `SMS would be sent to ${input.to} from ${from} (stub — add twilio npm package to activate)` };
    }),

  /**
   * Returns the SMS configuration status.
   */
  status: protectedProcedure.query(async () => {
    return {
      configured: !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN),
      alphaSenderConfigured: !!env.TWILIO_ALPHA_SENDER,
      quietHoursQueue: 'BullMQ/Redis — requires REDIS_URL secret',
      auAlphanumericSender: env.TWILIO_ALPHA_SENDER ?? null,
    };
  }),
});

// --- Postmark Email -----------------------------------------------------------
const postmarkRouter = router({
  /**
   * Send a test email to verify Postmark credentials.
   */
  testEmail: protectedProcedure
    .input(z.object({ to: z.string().email() }))
    .mutation(async ({ input }) => {
      const serverToken = env.POSTMARK_SERVER_TOKEN;
      if (!serverToken) {
        return { success: false, message: 'Postmark not configured — add POSTMARK_SERVER_TOKEN secret' };
      }
      // Real implementation lives in modules/payments/email.ts
      return { success: true, message: `Email would be sent to ${input.to} (stub — add postmark npm package to activate)` };
    }),

  /**
   * Returns the email configuration status.
   */
  status: protectedProcedure.query(async () => {
    return {
      configured: !!env.POSTMARK_SERVER_TOKEN,
      fromDomain: env.POSTMARK_FROM_DOMAIN ?? 'not configured',
    };
  }),
});

// --- Pipedrive CRM ------------------------------------------------------------
const pipedriveRouter = router({
  /**
   * Returns the Pipedrive OAuth connection status for the brand.
   */
  status: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      return {
        oauthConfigured: isPipedriveConfigured(),
        connected: account.pipedriveConnected ?? false,
        connectedAt: account.pipedriveConnectedAt ?? null,
        apiDomain: account.pipedriveApiDomain ?? null,
        pipelineId: account.pipedrivePipelineId ?? null,
        stageId: account.pipedriveStageId ?? null,
        wonStageId: account.pipedriveWonStageId ?? null,
        accountId: account.id,
      };
    }),

  /**
   * Update Pipedrive field mapping (pipeline/stage selection).
   */
  configure: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        pipelineId: z.number().optional(),
        stageId: z.number().optional(),
        wonStageId: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      await updatePaymentAccount(input.brandId, {
        ...(input.pipelineId !== undefined ? { pipedrivePipelineId: input.pipelineId } : {}),
        ...(input.stageId !== undefined ? { pipedriveStageId: input.stageId } : {}),
        ...(input.wonStageId !== undefined ? { pipedriveWonStageId: input.wonStageId } : {}),
      });
      return { success: true };
    }),

  /**
   * Fetch available pipelines from Pipedrive (for field mapping UI).
   */
  getPipelines: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account?.pipedriveAccessToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Pipedrive not connected' });
      }
      let token = account.pipedriveAccessToken;
      const domain = account.pipedriveApiDomain ?? 'api.pipedrive.com';
      // Refresh if expired
      if (account.pipedriveTokenExpiresAt && account.pipedriveTokenExpiresAt < new Date()) {
        const fresh = await refreshPipedriveToken(account.pipedriveRefreshToken!);
        await updatePaymentAccount(input.brandId, {
          pipedriveAccessToken: fresh.access_token,
          pipedriveRefreshToken: fresh.refresh_token,
          pipedriveTokenExpiresAt: new Date(Date.now() + fresh.expires_in * 1000),
        });
        token = fresh.access_token;
      }
      return getPipedrivePipelines(token, domain);
    }),

  /**
   * Fetch available stages for a given pipeline.
   */
  getStages: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), pipelineId: z.number() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account?.pipedriveAccessToken) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Pipedrive not connected' });
      }
      const domain = account.pipedriveApiDomain ?? 'api.pipedrive.com';
      const stages = await getPipedriveStages(account.pipedriveAccessToken, domain);
      return stages.filter((s: any) => s.pipeline_id === input.pipelineId);
    }),

  /**
   * Sync a proposal to Pipedrive as a Deal.
   * Creates or updates the deal based on proposal.pipedriveDealId.
   */
  syncProposal: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [proposalRow] = await ctx.db
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.proposalId))
        .limit(1);
      if (!proposalRow) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
      const proposal = withClientId(proposalRow);
      await requirePaymentWrite(ctx, proposal.brandId);
      const account = await getPaymentAccount(proposal.brandId);
      if (!account?.pipedriveConnected || !account.pipedriveAccessToken) {
        return { success: false, message: 'Pipedrive not connected' };
      }
      const [client] = proposal.clientId
        ? await ctx.db
            .select()
            .from(paymentClients)
            .where(eq(paymentClients.id, proposal.clientId))
            .limit(1)
        : [];
      const domain = account.pipedriveApiDomain ?? 'api.pipedrive.com';
      const token = account.pipedriveAccessToken;
      // Find or create person
      let personId: number | undefined;
      if (client?.email) {
        try {
          const person = await createPipedrivePerson(token, domain, {
            name: client.name ?? client.email,
            email: client.email,
            phone: client.mobile ?? undefined,
          });
          personId = person.id;
        } catch {
          /* person may already exist — non-fatal */
        }
      }
      const dealValue = proposal.totalCents ? proposal.totalCents / 100 : 0;
      const dealTitle = `${client?.name ?? 'Payer'} — ${proposal.title ?? `Proposal #${proposal.id}`}`;
      // Check if deal already exists on proposal
      const existingDealId = proposal.pipedriveDealId as number | null;
      let deal;
      if (existingDealId) {
        deal = await updatePipedriveDeal(token, domain, existingDealId, {
          title: dealTitle,
          value: dealValue,
          status: proposal.status === 'accepted' ? 'won' : 'open',
          ...(account.pipedriveWonStageId && proposal.status === 'accepted'
            ? { stage_id: account.pipedriveWonStageId }
            : account.pipedriveStageId ? { stage_id: account.pipedriveStageId } : {}),
        });
      } else {
        deal = await createPipedriveDeal(token, domain, {
          title: dealTitle,
          value: dealValue,
          currency: 'AUD',
          ...(personId ? { person_id: personId } : {}),
          ...(account.pipedriveStageId ? { stage_id: account.pipedriveStageId } : {}),
          ...(account.pipedrivePipelineId ? { pipeline_id: account.pipedrivePipelineId } : {}),
        });
        // Save deal ID back to proposal for future updates
        await ctx.db
          .update(proposals)
          .set({ pipedriveDealId: deal.id })
          .where(eq(proposals.id, proposal.id));
      }
      return { success: true, dealId: deal.id, message: `Synced to Pipedrive deal #${deal.id}` };
    }),

  /**
   * Fetch recent deals from Pipedrive for the CRM panel.
   */
  getDeals: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account?.pipedriveConnected || !account.pipedriveAccessToken) {
        return [];
      }
      const domain = account.pipedriveApiDomain ?? 'api.pipedrive.com';
      try {
        return getPipedriveDeals(account.pipedriveAccessToken, domain, 50);
      } catch {
        return [];
      }
    }),
});

// --- Compose integrations router ---------------------------------------------
export const integrationsRouter = router({
  stripe: stripeRouter,
  twilio: twilioRouter,
  postmark: postmarkRouter,
  pipedrive: pipedriveRouter,
});
