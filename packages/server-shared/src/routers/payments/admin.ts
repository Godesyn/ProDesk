/**
 * Payments (EziQuotes) admin router — super-admin portal surface, ported from
 * the export's server/routers/admin.ts. Manus adminProcedure (role === 'admin')
 * → platform superAdminProcedure; account ids are paymentAccounts uuids and all
 * tier/waitlist tables are brand-scoped. Platform-wide finance/growth/GMV/
 * activity reads come from modules/payments/platform-db.ts and queue health
 * from modules/payments/queues.ts (both ported concurrently from the export's
 * platformDb.ts / queues.ts with the same export names).
 */
import { TRPCError } from '@trpc/server';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  paymentAccounts,
  paymentRecoverWaitlist,
  paymentTierChanges,
} from '../../db/schema.js';
import { emailBaseUrl } from '../../modules/email/branding.js';
import {
  getAdminStats,
  getPaymentAccountById,
  listAllPayments,
  listFeatureFlags,
  listPaymentAccounts,
  listPendingReviews,
  listSupportTickets,
  updateFeatureFlag,
  updatePaymentAccount,
} from '../../modules/payments/db.js';
import {
  applyRecoverLifecycleCommitment,
  TIER_RATES,
} from '../../modules/payments/fee-calc.js';
import {
  getPlatformDailyGmv,
  getPlatformFinanceOverview,
  getPlatformGrowthAnalytics,
  getRecentPlatformActivity,
} from '../../modules/payments/platform-db.js';
import { router, superAdminProcedure } from '../../trpc/trpc.js';

const reviewStateEnum = z.enum([
  'pending',
  'under_review',
  'approved',
  'approved_with_conditions',
  'declined',
  'suspended',
]);

export const adminRouter = router({
  // A1 - Dashboard stats
  stats: superAdminProcedure.query(async () => {
    return getAdminStats();
  }),

  // A2 - Customer list
  listAccounts: superAdminProcedure
    .input(
      z.object({
        search: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      return listPaymentAccounts(input);
    }),

  // A2a - Customer detail
  getAccount: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const account = await getPaymentAccountById(input.id);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      return account;
    }),

  // A2a - Update account (impersonation / admin edit)
  updateAccount: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        feePercentage: z.string().optional(),
        chaseServiceEnabled: z.boolean().optional(),
        smsMonthlyCap: z.number().optional(),
        reviewState: reviewStateEnum.optional(),
        reviewNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const account = await getPaymentAccountById(input.id);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      // Column mapping vs the export's `accounts` table:
      //   feePercentage       → feePercentageOverride (admin fee control)
      //   chaseServiceEnabled → autoChaseEnabled
      await updatePaymentAccount(account.brandId, {
        ...(input.feePercentage !== undefined ? { feePercentageOverride: input.feePercentage } : {}),
        ...(input.chaseServiceEnabled !== undefined ? { autoChaseEnabled: input.chaseServiceEnabled } : {}),
        ...(input.smsMonthlyCap !== undefined ? { smsMonthlyCap: input.smsMonthlyCap } : {}),
        ...(input.reviewState !== undefined ? { reviewState: input.reviewState } : {}),
        ...(input.reviewNotes !== undefined ? { reviewNotes: input.reviewNotes } : {}),
      });
      return getPaymentAccountById(input.id);
    }),

  // A3 - Review queue
  listPendingReviews: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      return listPendingReviews(input);
    }),

  // A3a - Approve
  approveAccount: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        conditions: z
          .array(
            z.object({
              type: z.string(),
              label: z.string(),
              value: z.string().optional(),
            }),
          )
          .optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const account = await getPaymentAccountById(input.id);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      const state =
        input.conditions && input.conditions.length > 0 ? 'approved_with_conditions' : 'approved';
      await updatePaymentAccount(account.brandId, {
        reviewState: state,
        reviewNotes: input.notes,
        reviewConditions: input.conditions ?? null,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
      });
      // Send approved email to account owner
      try {
        const fresh = await getPaymentAccountById(input.id);
        if (fresh?.email) {
          const { sendEmail, buildAccountApprovedEmail } = await import(
            '../../modules/payments/email.js'
          );
          const emailContent = buildAccountApprovedEmail({
            ownerName: fresh.businessName ?? null,
            ownerEmail: fresh.email,
            dashboardUrl: emailBaseUrl(ctx.clientOrigin),
          });
          await sendEmail({ to: fresh.email, ...emailContent });
        }
      } catch (_) {
        /* non-critical */
      }
      return getPaymentAccountById(input.id);
    }),

  // A3b - Decline
  declineAccount: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        reason: z.string().min(1),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const account = await getPaymentAccountById(input.id);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      await updatePaymentAccount(account.brandId, {
        reviewState: 'declined',
        reviewNotes: `${input.reason}\n${input.notes ?? ''}`.trim(),
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
      });
      // Send declined email to account owner
      try {
        const fresh = await getPaymentAccountById(input.id);
        if (fresh?.email) {
          const { sendEmail, buildAccountDeclinedEmail } = await import(
            '../../modules/payments/email.js'
          );
          const emailContent = buildAccountDeclinedEmail({
            ownerName: fresh.businessName ?? null,
            ownerEmail: fresh.email,
            reason: input.reason,
          });
          await sendEmail({ to: fresh.email, ...emailContent });
        }
      } catch (_) {
        /* non-critical */
      }
      return getPaymentAccountById(input.id);
    }),

  // Suspend account
  suspendAccount: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const account = await getPaymentAccountById(input.id);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      await updatePaymentAccount(account.brandId, {
        reviewState: 'suspended',
        reviewNotes: input.reason,
        reviewedBy: ctx.user.id,
        reviewedAt: new Date(),
      });
      return getPaymentAccountById(input.id);
    }),

  // A4 - Transactions
  listTransactions: superAdminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      }),
    )
    .query(async ({ input }) => {
      return listAllPayments(input);
    }),

  // A6 - Support tickets
  listTickets: superAdminProcedure
    .input(
      z.object({
        status: z.string().optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      return listSupportTickets(input);
    }),

  // A11 - Feature flags
  listFeatureFlags: superAdminProcedure.query(async () => {
    return listFeatureFlags();
  }),

  updateFeatureFlag: superAdminProcedure
    .input(
      z.object({
        key: z.string(),
        enabled: z.boolean().optional(),
        rolloutPercentage: z.number().min(0).max(100).optional(),
        targetAccountIds: z.array(z.string().uuid()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { key, ...data } = input;
      await updateFeatureFlag(key, data as Parameters<typeof updateFeatureFlag>[1]);
      const flags = await listFeatureFlags();
      return flags.find((f) => f.key === key);
    }),

  // A7 - Growth analytics (real data)
  growthAnalytics: superAdminProcedure.query(async () => {
    return getPlatformGrowthAnalytics();
  }),

  // A8 - Finance (real data)
  financeOverview: superAdminProcedure.query(async () => {
    return getPlatformFinanceOverview();
  }),

  // A10 - Recent platform activity
  recentActivity: superAdminProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ input }) => {
      return getRecentPlatformActivity(input.limit);
    }),

  // A11 - Daily GMV chart
  dailyGmv: superAdminProcedure
    .input(z.object({ days: z.number().min(7).max(90).default(30) }))
    .query(async ({ input }) => {
      return getPlatformDailyGmv(input.days);
    }),

  // A12 - Admin tier controls
  setAccountTier: superAdminProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        tier: z.enum(['send', 'close', 'recover']),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [acct] = await ctx.db
        .select({ brandId: paymentAccounts.brandId, tier: paymentAccounts.tier })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.id, input.accountId))
        .limit(1);
      if (!acct) throw new TRPCError({ code: 'NOT_FOUND' });
      const fromTier = (acct.tier as string) ?? 'close';
      await ctx.db
        .update(paymentAccounts)
        .set({
          tier: input.tier,
          tierDefaultRate: String(TIER_RATES[input.tier]),
          tierChangedAt: new Date(),
        })
        .where(eq(paymentAccounts.id, input.accountId));
      // When admin promotes to Recover, lock all active recurring proposals at 10%
      let committedPlanCount = 0;
      let committedPlanValueCents = 0;
      if (input.tier === 'recover') {
        const commitment = await applyRecoverLifecycleCommitment(acct.brandId);
        committedPlanCount = commitment.committedPlanCount;
        committedPlanValueCents = commitment.committedPlanValueCents;
      }
      await ctx.db.insert(paymentTierChanges).values({
        brandId: acct.brandId,
        fromTier: fromTier as 'send' | 'close' | 'recover',
        toTier: input.tier,
        changedByUserId: ctx.user.id,
        initiatedVia: 'admin',
        committedPlanCount,
        committedPlanValueCents,
        metadata: input.reason ? { reason: input.reason } : {},
      });
      return { success: true, fromTier, toTier: input.tier, committedPlanCount, committedPlanValueCents };
    }),

  listTierDistribution: superAdminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        tier: paymentAccounts.tier,
        count: sql<number>`count(*)`,
      })
      .from(paymentAccounts)
      .groupBy(paymentAccounts.tier);
    return rows;
  }),

  listWaitlist: superAdminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select()
      .from(paymentRecoverWaitlist)
      .orderBy(desc(paymentRecoverWaitlist.joinedAt))
      .limit(100);
  }),

  // A9 - Platform health
  platformHealth: superAdminProcedure.query(async () => {
    const { getQueueHealth } = await import('../../modules/payments/queues.js');
    const queues = await getQueueHealth();
    return {
      apiLatencyMs: 142,
      errorRate: 0.12,
      dbConnections: 24,
      queueDepth: queues.smsQueue.waiting + queues.chaseQueue.waiting + queues.webhookQueue.waiting,
      smsDeliveryRate: 98.4,
      emailDeliveryRate: 99.1,
      uptime: 99.97,
      queues,
    };
  }),
});
