/**
 * Payments (EziQuotes) affiliates router — ported from the export's
 * server/routers/affiliates.ts. Affiliates are keyed by brand (the export
 * keyed them by accountId; paymentAffiliates.brandId keeps that 1:1 mapping).
 * trackClick is publicProcedure: it fires when an anonymous visitor lands on
 * /r/:code (the export declared it protectedProcedure despite its own
 * "public" comment and never used ctx — that was a bug, corrected here).
 * Admin surface is superAdminProcedure.
 */
import { TRPCError } from '@trpc/server';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  paymentAccounts,
  paymentAffiliatePayouts,
  paymentAffiliateReferrals,
  paymentAffiliates,
} from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount } from '../../modules/payments/db.js';
import {
  protectedProcedure,
  publicProcedure,
  router,
  superAdminProcedure,
} from '../../trpc/trpc.js';

// --- helpers ----------------------------------------------------------------

function generateCode(businessName: string): string {
  const base = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 5);
  return `${base}${suffix}`;
}

// --- router -----------------------------------------------------------------

export const affiliatesRouter = router({
  /** Get the brand's affiliate record (or null if not enrolled) */
  getMyAffiliate: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return null;

      const [aff] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.brandId, input.brandId))
        .limit(1);

      return aff ?? null;
    }),

  /** Get referrals for the brand's affiliate account */
  getReferrals: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];

      const [aff] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.brandId, input.brandId))
        .limit(1);

      if (!aff) return [];

      return ctx.db
        .select()
        .from(paymentAffiliateReferrals)
        .where(eq(paymentAffiliateReferrals.affiliateId, aff.id))
        .orderBy(desc(paymentAffiliateReferrals.createdAt));
    }),

  /** Get payout history */
  getPayouts: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];

      const [aff] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.brandId, input.brandId))
        .limit(1);

      if (!aff) return [];

      return ctx.db
        .select()
        .from(paymentAffiliatePayouts)
        .where(eq(paymentAffiliatePayouts.affiliateId, aff.id))
        .orderBy(desc(paymentAffiliatePayouts.createdAt));
    }),

  /** Enrol the brand in the affiliate program */
  register: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });

      const [existing] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.brandId, input.brandId))
        .limit(1);

      if (existing) return existing;

      const displayName = [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' ');
      const code = generateCode(account.businessName ?? displayName ?? 'user');

      await ctx.db
        .insert(paymentAffiliates)
        .values({
          brandId: input.brandId,
          // 'code' is NOT NULL + unique; 'referralCode' is the legacy alias — keep both in sync
          code,
          referralCode: code,
          // name and email are NOT NULL in the schema — populate from user context
          name: displayName || account.businessName || 'Affiliate',
          email: ctx.user.email ?? '',
        })
        .onConflictDoNothing();

      const [created] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.brandId, input.brandId))
        .limit(1);

      return created;
    }),

  /** Track a referral click (public — called when someone visits /r/:code) */
  trackClick: publicProcedure
    .input(z.object({ code: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [aff] = await ctx.db
        .select()
        .from(paymentAffiliates)
        .where(eq(paymentAffiliates.referralCode, input.code))
        .limit(1);

      if (!aff) return { ok: false };

      await ctx.db.insert(paymentAffiliateReferrals).values({
        affiliateId: aff.id,
        brandId: aff.brandId,
        status: 'clicked',
      });

      return { ok: true, affiliateId: aff.id };
    }),

  /** Admin: list all affiliates */
  adminList: superAdminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: paymentAffiliates.id,
        brandId: paymentAffiliates.brandId,
        referralCode: paymentAffiliates.referralCode,
        status: paymentAffiliates.status,
        totalEarnedCents: paymentAffiliates.totalEarnedCents,
        totalReferrals: paymentAffiliates.totalReferrals,
        activeReferrals: paymentAffiliates.activeReferrals,
        businessName: paymentAccounts.businessName,
        email: paymentAccounts.email,
      })
      .from(paymentAffiliates)
      .leftJoin(paymentAccounts, eq(paymentAffiliates.brandId, paymentAccounts.brandId))
      .orderBy(desc(paymentAffiliates.totalEarnedCents));

    return rows;
  }),

  /** Admin: suspend or activate an affiliate */
  adminSetStatus: superAdminProcedure
    .input(
      z.object({
        affiliateId: z.string().uuid(),
        status: z.enum(['active', 'suspended']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(paymentAffiliates)
        .set({ status: input.status })
        .where(eq(paymentAffiliates.id, input.affiliateId));
      return { ok: true };
    }),
});
