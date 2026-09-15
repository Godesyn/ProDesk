/**
 * Payments (EziQuotes) analytics router — client health score, notes/timeline,
 * referral tracking and revenue forecasting, ported from the export's
 * server/routers/analytics.ts. Client-scoped procedures resolve the brand from
 * the client row (entity-scoped auth); revenueForecast takes brandId directly.
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  paymentClientNotes,
  paymentClients,
  proposals,
  paymentTransactions,
} from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  createClientNote,
  createClientReferral,
  deleteClientNote,
  getClientReferredBy,
  listClientNotes,
  listClientReferrals,
  listProposals,
} from '../../modules/payments/db.js';
import type { Context } from '../../trpc/context.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// -- Helpers --------------------------------------------------------------------
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Load a payer client row and assert brand access via its brand. */
async function loadClient(ctx: Context, clientId: string, mode: 'read' | 'write') {
  const [client] = await ctx.db
    .select()
    .from(paymentClients)
    .where(eq(paymentClients.id, clientId))
    .limit(1);
  if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
  if (mode === 'write') await requirePaymentWrite(ctx, client.brandId);
  else await requirePaymentRead(ctx, client.brandId);
  return client;
}

export const analyticsRouter = router({
  // -- Client Health Score ----------------------------------------------------
  clientHealthScore: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await loadClient(ctx, input.clientId, 'read');

      const proposalsResult = await listProposals(client.brandId, { limit: 200 });
      const allProposals = (proposalsResult as any).rows ?? proposalsResult;
      const clientProposals = (Array.isArray(allProposals) ? allProposals : []).filter(
        (p: any) => p.clientId === input.clientId,
      );

      const total = clientProposals.length;
      const paid = clientProposals.filter((p: any) => ['paid', 'active', 'completed'].includes(p.status)).length;
      const declined = clientProposals.filter((p: any) => ['expired', 'withdrawn', 'cancelled'].includes(p.status)).length;
      const disputed = clientProposals.filter((p: any) => ['disputed', 'refunded'].includes(p.status)).length;
      const sent = clientProposals.filter((p: any) => p.status !== 'draft').length;

      const acceptanceRate = sent > 0 ? paid / sent : 0;
      const disputeRate = paid > 0 ? disputed / paid : 0;

      // Revenue
      const totalRevenueCents = clientProposals
        .filter((p: any) => ['paid', 'active', 'completed'].includes(p.status))
        .reduce((s: number, p: any) => s + (p.totalCents ?? 0), 0);

      // Recency (days since last proposal)
      const lastProposal = clientProposals.sort(
        (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )[0];
      const daysSinceLast = lastProposal
        ? Math.floor((Date.now() - new Date((lastProposal as any).createdAt).getTime()) / 86400000)
        : 999;

      // Engagement (has viewed proposals)
      const viewedCount = clientProposals.filter((p: any) => p.viewedAt).length;

      // Compute score components (0–100 each)
      const paymentScore = clamp(acceptanceRate * 100, 0, 100);
      const disputeScore = clamp((1 - disputeRate) * 100, 0, 100);
      const recencyScore = daysSinceLast < 30 ? 100 : daysSinceLast < 90 ? 70 : daysSinceLast < 180 ? 40 : 20;
      const engagementScore = sent > 0 ? clamp((viewedCount / sent) * 100, 0, 100) : 50;
      const volumeScore = clamp(Math.min(totalRevenueCents / 1000000, 1) * 100, 0, 100); // $10k = 100

      const overallScore = Math.round(
        paymentScore * 0.35 +
        disputeScore * 0.25 +
        recencyScore * 0.2 +
        engagementScore * 0.1 +
        volumeScore * 0.1,
      );

      const grade =
        overallScore >= 85 ? 'A' :
        overallScore >= 70 ? 'B' :
        overallScore >= 55 ? 'C' :
        overallScore >= 40 ? 'D' : 'F';

      const label =
        overallScore >= 85 ? 'Champion' :
        overallScore >= 70 ? 'Loyal' :
        overallScore >= 55 ? 'Promising' :
        overallScore >= 40 ? 'At Risk' : 'Dormant';

      return {
        overallScore,
        grade,
        label,
        components: {
          paymentHistory: Math.round(paymentScore),
          disputeRate: Math.round(disputeScore),
          recency: Math.round(recencyScore),
          engagement: Math.round(engagementScore),
          volume: Math.round(volumeScore),
        },
        stats: {
          totalProposals: total,
          paidProposals: paid,
          declinedProposals: declined,
          disputedProposals: disputed,
          acceptanceRate: Math.round(acceptanceRate * 100),
          totalRevenueCents,
          daysSinceLast: daysSinceLast === 999 ? null : daysSinceLast,
        },
      };
    }),

  // -- Client Notes / Timeline ------------------------------------------------
  listClientNotes: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await loadClient(ctx, input.clientId, 'read');
      return listClientNotes(client.brandId, input.clientId);
    }),

  addClientNote: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        type: z.enum(['note', 'call', 'email', 'meeting', 'proposal', 'payment', 'system']).default('note'),
        content: z.string().min(1).max(2000),
        occurredAt: z.number().optional(), // UTC timestamp ms
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await loadClient(ctx, input.clientId, 'write');
      const id = await createClientNote({
        brandId: client.brandId,
        clientId: input.clientId,
        type: input.type,
        content: input.content,
        createdByUserId: ctx.user.id,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
      });
      return { id };
    }),

  deleteClientNote: protectedProcedure
    .input(z.object({ noteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [note] = await ctx.db
        .select()
        .from(paymentClientNotes)
        .where(eq(paymentClientNotes.id, input.noteId))
        .limit(1);
      if (!note) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, note.brandId);
      await deleteClientNote(input.noteId, note.brandId);
      return { success: true };
    }),

  // -- Referral Tracking -----------------------------------------------------
  listClientReferrals: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await loadClient(ctx, input.clientId, 'read');
      const referrals = await listClientReferrals(client.brandId, input.clientId);
      const referredBy = await getClientReferredBy(client.brandId, input.clientId);
      return { referrals, referredBy };
    }),

  addReferral: protectedProcedure
    .input(
      z.object({
        referrerClientId: z.string().uuid(),
        referredClientId: z.string().uuid(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.referrerClientId === input.referredClientId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Referrer and referred client cannot be the same' });
      }
      const referrer = await loadClient(ctx, input.referrerClientId, 'write');
      // Tenancy hardening over the export: the referred client must belong to
      // the same brand (the export inserted any client id unchecked).
      const [referred] = await ctx.db
        .select({ brandId: paymentClients.brandId })
        .from(paymentClients)
        .where(eq(paymentClients.id, input.referredClientId))
        .limit(1);
      if (!referred || referred.brandId !== referrer.brandId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Referred client not found' });
      }
      const id = await createClientReferral({
        brandId: referrer.brandId,
        referrerClientId: input.referrerClientId,
        referredClientId: input.referredClientId,
        notes: input.notes,
      });
      return { id };
    }),

  // -- Revenue Forecasting ----------------------------------------------------
  revenueForecast: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        months: z.number().min(1).max(12).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      // Get last 6 months of actual payments for trend
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const recentPayments = await ctx.db
        .select({
          amountCents: paymentTransactions.amountCents,
          paidAt: paymentTransactions.paidAt,
        })
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.brandId, input.brandId),
            eq(paymentTransactions.status, 'succeeded'),
            gte(paymentTransactions.paidAt, sixMonthsAgo),
          ),
        )
        .orderBy(desc(paymentTransactions.paidAt));

      // Monthly actuals
      const monthlyActuals: Record<string, number> = {};
      for (const p of recentPayments) {
        if (!p.paidAt) continue;
        const d = new Date(p.paidAt);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyActuals[key] = (monthlyActuals[key] ?? 0) + p.amountCents;
      }

      // Active subscriptions (status = 'active')
      const activeSubscriptions = await ctx.db
        .select({
          totalCents: proposals.totalCents,
          paymentConfig: proposals.paymentConfig,
        })
        .from(proposals)
        .where(
          and(
            eq(proposals.brandId, input.brandId),
            eq(proposals.kind, 'payer'),
            eq(proposals.status, 'active'),
            eq(proposals.paymentModel, 'subscription'),
          ),
        );

      const recurringMonthlyCents = activeSubscriptions.reduce((s, p) => {
        const config = p.paymentConfig as any;
        const cadence = config?.cadence ?? 'monthly';
        const monthly = cadence === 'monthly' ? p.totalCents :
          cadence === 'quarterly' ? Math.round(p.totalCents / 3) :
          cadence === 'annually' ? Math.round(p.totalCents / 12) : p.totalCents;
        return s + monthly;
      }, 0);

      // Pipeline (sent/viewed/engaged proposals)
      const pipelineProposals = await ctx.db
        .select({
          totalCents: proposals.totalCents,
          status: proposals.status,
        })
        .from(proposals)
        .where(
          and(
            eq(proposals.brandId, input.brandId),
            eq(proposals.kind, 'payer'),
            sql`${proposals.status} IN ('sent', 'viewed', 'engaged')`,
          ),
        );

      const pipelineCents = pipelineProposals.reduce((s, p) => s + (p.totalCents ?? 0), 0);

      // Compute average monthly revenue from actuals
      const actualValues = Object.values(monthlyActuals);
      const avgMonthly = actualValues.length > 0
        ? actualValues.reduce((s, v) => s + v, 0) / actualValues.length
        : 0;

      // Pipeline conversion rate (assume 30% of pipeline converts each month)
      const pipelineMonthlyContrib = Math.round(pipelineCents * 0.3);

      // Build forecast months
      const forecastMonths = [];
      const now = new Date();
      for (let i = 0; i < input.months; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleString('en-AU', { month: 'short', year: 'numeric' });

        // Actual if available, otherwise forecast
        const actual = monthlyActuals[key];
        const forecast = Math.round(recurringMonthlyCents + (avgMonthly * 0.5) + (pipelineMonthlyContrib / input.months));

        forecastMonths.push({
          key,
          label,
          actualCents: actual ?? null,
          forecastCents: forecast,
          recurringCents: recurringMonthlyCents,
          pipelineCents: Math.round(pipelineMonthlyContrib / input.months),
        });
      }

      return {
        months: forecastMonths,
        summary: {
          totalForecastCents: forecastMonths.reduce((s, m) => s + m.forecastCents, 0),
          recurringMonthlyCents,
          pipelineCents,
          avgMonthlyActualCents: Math.round(avgMonthly),
          activeSubscriptionCount: activeSubscriptions.length,
          pipelineProposalCount: pipelineProposals.length,
        },
      };
    }),
});
