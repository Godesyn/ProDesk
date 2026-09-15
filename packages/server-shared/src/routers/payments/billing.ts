/**
 * Payments (EziQuotes) billing router — tier management, ported 1:1 from the
 * export's server/routers/billing.ts. This is the tool's per-payment fee
 * monetization (send/close/recover tiers on Stripe Connect charges), which is
 * DOMAIN logic and stays. The export had no vendor SaaS-plan / Stripe-customer
 * billing in this router (plan/trialEndsAt/stripeCustomerId were already
 * dropped at the schema port) — the vendor's own subscription to the Payments
 * tool is the platform Feature Subscription (modules/payments/billing.ts
 * paymentsEntitlement), surfaced by the accounts-level gate, not here.
 *
 * Procedures (all take brandId; reads allow paymentsViewer):
 *   billing.getTierInfo           — current tier + rate for the brand
 *   billing.changeTier            — upgrade or downgrade tier (send ↔ close)
 *   billing.joinRecoverWaitlist   — join the Recover waitlist
 *   billing.leaveRecoverWaitlist  — remove from waitlist
 *   billing.getWaitlistStatus     — check if on waitlist
 *   billing.getTierHistory        — audit log of tier changes
 */
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  paymentAccounts,
  paymentRecoverWaitlist,
  paymentTierChanges,
} from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount } from '../../modules/payments/db.js';
import {
  getTierForAccount,
  TIER_RATES,
  type Tier,
} from '../../modules/payments/fee-calc.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// ---------------------------------------------------------------------------
// Tier metadata (display info)
// ---------------------------------------------------------------------------

export const TIER_META: Record<Tier, {
  name: string;
  tagline: string;
  rate: number;
  features: string[];
  comingSoon?: boolean;
}> = {
  send: {
    name: 'Send',
    tagline: 'For freelancers getting started',
    rate: 1.0,
    features: [
      'Unlimited proposals',
      'Stripe payments',
      'Payer portal',
      'PDF receipts',
      '1% platform fee',
    ],
  },
  close: {
    name: 'Close',
    tagline: 'For agencies closing bigger deals',
    rate: 1.7,
    features: [
      'Everything in Send',
      'Payment plans',
      'Subscriptions',
      'Team members',
      'Analytics',
      '1.7% platform fee',
    ],
  },
  recover: {
    name: 'Recover',
    tagline: 'Turn missed payments into revenue',
    rate: 5.0,
    comingSoon: true,
    features: [
      'Everything in Close',
      'Automated follow-up sequences',
      'Cold outreach sequences',
      'Missed payment recovery',
      'AI-powered message rewriting',
      '5% platform fee on recovered revenue',
    ],
  },
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const billingRouter = router({
  /**
   * Get current tier info for the brand's payment account.
   */
  getTierInfo: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      const tierInfo = await getTierForAccount(input.brandId);
      return {
        ...tierInfo,
        tierMeta: TIER_META[tierInfo.tier],
        allTiers: TIER_META,
      };
    }),

  /**
   * Change the account tier.
   * Recover is currently waitlist-only — this will throw if tier === 'recover'
   * and the account is not already on the approved list.
   */
  changeTier: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        tier: z.enum(['send', 'close', 'recover']),
        initiatedVia: z.enum(['settings', 'contextual_prompt', 'admin', 'auto']).default('settings'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const currentTier = (account.tier as Tier) ?? 'close';
      if (currentTier === input.tier) {
        return { success: true, message: 'Already on this tier' };
      }

      // Recover is waitlist-only at launch — admin must set tier directly via admin.setAccountTier
      if (input.tier === 'recover') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'Recover is currently invitation-only. Join the waitlist to be notified when it opens.',
        });
      }
      // Note: Recover commitment is applied by admin.setAccountTier, not here.
      // Self-serve changeTier only allows send ↔ close.

      const newRate = TIER_RATES[input.tier];

      // Update account tier
      await ctx.db
        .update(paymentAccounts)
        .set({
          tier: input.tier,
          tierDefaultRate: String(newRate),
          tierChangedAt: new Date(),
        })
        .where(eq(paymentAccounts.brandId, input.brandId));

      // Log the tier change
      await ctx.db.insert(paymentTierChanges).values({
        brandId: input.brandId,
        fromTier: currentTier as 'send' | 'close' | 'recover',
        toTier: input.tier,
        changedByUserId: ctx.user.id,
        initiatedVia: input.initiatedVia,
        committedPlanCount: 0,
        committedPlanValueCents: 0,
      });

      return {
        success: true,
        fromTier: currentTier,
        toTier: input.tier,
        newRatePercent: newRate,
      };
    }),

  /**
   * Join the Recover waitlist.
   */
  joinRecoverWaitlist: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        source: z.enum(['signup', 'upgrade_prompt', 'settings', 'marketing_page']).default('settings'),
        estimatedMonthlyMissedCents: z.number().optional(),
        preferredContact: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      // Upsert — idempotent
      await ctx.db
        .insert(paymentRecoverWaitlist)
        .values({
          brandId: input.brandId,
          source: input.source,
          estimatedMonthlyMissedCents: input.estimatedMonthlyMissedCents,
          preferredContact: input.preferredContact,
        })
        .onConflictDoNothing();

      return { success: true };
    }),

  /**
   * Leave the Recover waitlist.
   */
  leaveRecoverWaitlist: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      await ctx.db
        .delete(paymentRecoverWaitlist)
        .where(eq(paymentRecoverWaitlist.brandId, input.brandId));

      return { success: true };
    }),

  /**
   * Check if the brand is on the Recover waitlist.
   */
  getWaitlistStatus: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const [entry] = await ctx.db
        .select()
        .from(paymentRecoverWaitlist)
        .where(eq(paymentRecoverWaitlist.brandId, input.brandId))
        .limit(1);

      return {
        onWaitlist: !!entry,
        joinedAt: entry?.joinedAt ?? null,
        source: entry?.source ?? null,
      };
    }),

  /**
   * Get tier change history for the brand.
   */
  getTierHistory: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });

      const rows = await ctx.db
        .select()
        .from(paymentTierChanges)
        .where(eq(paymentTierChanges.brandId, input.brandId))
        .orderBy(desc(paymentTierChanges.createdAt))
        .limit(20);

      return rows;
    }),
});
