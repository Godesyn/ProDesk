/**
 * Payments (EziQuotes) — tenant-account router, ported from the export's
 * server/routers/accounts.ts. Tenancy: the Manus per-user `accounts` row is a
 * 1:1 brand settings row (`payment_accounts`); every account-level procedure
 * takes a `brandId` and gates through requirePaymentRead/Write. The Manus
 * heartbeat auto-chase scheduler is dropped — updateAutoChase only persists
 * the flags (a BullMQ repeatable scans autoChaseEnabled accounts). Asset
 * uploads are remapped from the export's /api/assets/upload route to a
 * Supabase Storage signed upload URL.
 */
import { TRPCError } from '@trpc/server';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  paymentAccounts,
  paymentEmailTemplates,
  type InsertPaymentAccount,
} from '../../db/schema.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  ensurePaymentAccount,
  getActivityForAccount,
  getBrandKit,
  getDashboardActionQueue,
  getDashboardActivity,
  getDashboardFullKpis,
  getDashboardKpis,
  getDashboardRevenueChart,
  getPaymentAccount,
  listPayments,
  listProposals,
  updatePaymentAccount,
  upsertBrandKit,
} from '../../modules/payments/db.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import { getFxRates } from '../../modules/payments/fx.js';
import { recordBrandAsset, recordLockerFile, fileNameFromUrl } from '../../modules/locker/record.js';

/** Bucket for brand-level payment assets (logos, hero images, fonts). */
const ASSETS_BUCKET = 'brand-files';

/** The asset slots a brand can upload into — shared by mint + locker confirm. */
const assetTypeSchema = z.enum(['logo_light', 'logo_dark', 'favicon', 'hero', 'font', 'attachment']);

/** Human phrasing of an asset slot, for the locker's provenance note. */
const ASSET_TYPE_LABELS: Record<string, string> = {
  logo_light: 'light-background logo',
  logo_dark: 'dark-background logo',
  favicon: 'favicon',
  hero: 'hero image',
  font: 'brand font',
  attachment: 'proposal attachment',
};

export const accountsRouter = router({
  // Get the brand's payment account (null until ensured/created)
  me: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return (await getPaymentAccount(input.brandId)) ?? null;
    }),

  // Auto-create the settings row if none exists (called on app shell mount).
  // Read-gated so read-only viewers can still mount the app.
  ensureAccount: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      return ensurePaymentAccount(input.brandId);
    }),

  // Create account during onboarding
  create: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      businessName: z.string().min(1),
      email: z.string().email(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const existing = await getPaymentAccount(input.brandId);
      if (existing) return existing;
      await db
        .insert(paymentAccounts)
        .values({
          brandId: input.brandId,
          businessName: input.businessName,
          email: input.email,
          onboardingState: 'profile',
        })
        .onConflictDoNothing({ target: paymentAccounts.brandId });
      return getPaymentAccount(input.brandId);
    }),

  // Update account profile / onboarding steps
  update: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      businessName: z.string().min(1).optional(),
      tradingName: z.string().optional(),
      abn: z.string().optional(),
      country: z.string().length(2).optional(),
      defaultCurrency: z.string().length(3).optional(),
      industry: z.string().optional(),
      teamSize: z.string().optional(),
      monthlyVolumeEstimate: z.string().optional(),
      onboardingState: z.enum(['signup', 'profile', 'brand', 'stripe', 'template', 'sent', 'complete']).optional(),
      proposalTheme: z.enum(['agency', 'digital', 'luxury']).optional(),
      smsSenderId: z.string().max(11).optional(),
      // Tax settings
      defaultTaxRate: z.number().min(0).max(100).optional(),
      taxLabel: z.string().max(20).optional(),
      taxBehaviourDefault: z.enum(['inclusive', 'exclusive', 'exempt']).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      const { brandId, defaultTaxRate, ...restInput } = input;
      await updatePaymentAccount(brandId, {
        ...restInput,
        ...(defaultTaxRate !== undefined ? { defaultTaxRate: String(defaultTaxRate) } : {}),
      } as Partial<InsertPaymentAccount>);
      return getPaymentAccount(brandId);
    }),

  // Brand kit
  getBrandKit: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return null;
      return (await getBrandKit(input.brandId)) ?? null;
    }),

  updateBrandKit: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      logoLightUrl: z.string().optional(),
      logoDarkUrl: z.string().optional(),
      faviconUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      accentColor: z.string().optional(),
      accentColor2: z.string().optional(),
      backgroundColor: z.string().optional(),
      textColor: z.string().optional(),
      darkColor: z.string().optional(),
      lightColor: z.string().optional(),
      headingFont: z.string().optional(),
      bodyFont: z.string().optional(),
      heroImageUrl: z.string().optional(),
      defaultIntroCopy: z.string().optional(),
      defaultNextStepsCopy: z.string().optional(),
      defaultTermsUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      const { brandId, ...data } = input;
      await upsertBrandKit(brandId, data);
      return (await getBrandKit(brandId)) ?? null;
    }),

  // Asset upload — Supabase Storage signed upload URL (replaces the export's
  // /api/assets/upload express route + storagePut).
  getAssetUploadUrl: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      filename: z.string(),
      contentType: z.string(),
      assetType: assetTypeSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      const safeName = input.filename.replace(/[^\w.\-]+/g, '_');
      const key = `payments/${input.brandId}/assets/${input.assetType}/${Date.now()}-${safeName}`;
      const { data, error } = await supabaseAdmin.storage
        .from(ASSETS_BUCKET)
        .createSignedUploadUrl(key);
      if (error || !data) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create upload URL: ${error?.message ?? 'unknown error'}`,
        });
      }
      const { data: pub } = supabaseAdmin.storage.from(ASSETS_BUCKET).getPublicUrl(key);
      return {
        key,
        relKey: key,
        bucket: ASSETS_BUCKET,
        uploadUrl: data.signedUrl,
        token: data.token,
        publicUrl: pub.publicUrl,
      };
    }),

  /**
   * Document Locker: confirm a signed-URL asset upload actually landed, and
   * mirror it into the brand's Public Brand Assets.
   *
   * This is a separate step from `getAssetUploadUrl` because the bytes go
   * straight from the browser to Supabase Storage — the server never sees the
   * upload succeed. Recording at mint time would leave locker tiles pointing at
   * objects that were never written, so the client calls this after its PUT
   * resolves. Insert-only and idempotent on the storage key (§3 of
   * docs/document-locker.md), so a retry is a no-op.
   */
  recordAssetUpload: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      key: z.string().min(1),
      publicUrl: z.string().url(),
      filename: z.string().optional(),
      assetType: assetTypeSchema,
      size: z.number().int().nonnegative().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const label = ASSET_TYPE_LABELS[input.assetType] ?? 'brand asset';
      const row = {
        brandId: input.brandId,
        url: input.publicUrl,
        name: fileNameFromUrl(input.filename ?? input.key, label),
        uploadedBy: ctx.user.id,
        size: input.size ?? null,
        category: 'payments',
        note: `Uploaded as a proposal ${label}`,
        sourceType: 'paymentsAsset' as const,
        sourceId: input.key,
      };
      // Logos / favicon / hero / font are brand identity → Public Brand Assets,
      // which also makes them visible to connected agencies (§6). A generic
      // proposal attachment is not identity and may be client-specific, so it
      // goes to Private Documents instead of being shared that widely.
      await (input.assetType === 'attachment'
        ? recordLockerFile(ctx.db, { ...row, source: 'brand', isPrivate: true })
        : recordBrandAsset(ctx.db, row)
      ).catch((e) => console.error('[payments] locker copy failed', (e as Error).message));
      return { ok: true };
    }),

  // Dashboard KPIs
  dashboardKpis: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { totalRevenue: 0, activeProposals: 0, acceptanceRate: 0, avgDealSize: 0 };
      return getDashboardKpis(input.brandId);
    }),

  // Recent activity
  recentActivity: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), limit: z.number().min(1).max(50).default(20) }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];
      return getActivityForAccount(input.brandId, input.limit);
    }),

  // Recent proposals for dashboard
  recentProposals: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { rows: [], total: 0 };
      return listProposals(input.brandId, { limit: 5 });
    }),

  // Recent payments for dashboard
  recentPayments: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { rows: [], total: 0 };
      return listPayments(input.brandId, { limit: 5 });
    }),

  // Full dashboard KPIs (30d paid, avg, conversion, time-to-accept, chase counts)
  dashboardFullKpis: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const zero = { paidLast30d: 0, paidPrior30d: 0, avgProposalCents: 0, avgProposalPrior: 0, conversionRate: 0, conversionPrior: 0, sentLast30d: 0, acceptedLast30d: 0, medianAcceptHours: 0, medianAcceptHoursPrior: 0, chaseCount: 0, cardDeclinedCount: 0 };
      const account = await getPaymentAccount(input.brandId);
      if (!account) return zero;
      try {
        return await getDashboardFullKpis(input.brandId);
      } catch (err) {
        console.error('[dashboardFullKpis] Query failed, returning zeros:', err);
        return zero;
      }
    }),

  // Action queue: proposals needing attention
  dashboardActionQueue: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];
      return getDashboardActionQueue(input.brandId);
    }),

  // Revenue chart: monthly payment totals
  dashboardRevenueChart: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), months: z.number().min(1).max(24).default(7) }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];
      return getDashboardRevenueChart(input.brandId, input.months);
    }),

  // Activity feed: real events from proposals + payments
  dashboardActivity: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), limit: z.number().min(1).max(20).default(10) }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];
      return getDashboardActivity(input.brandId, input.limit);
    }),

  // -- Automated chase configuration -------------------------------------------------
  // The export scheduled a per-account Manus heartbeat cron here; that system is
  // dropped. A BullMQ repeatable job scans accounts with autoChaseEnabled instead,
  // so this procedure only persists the flags.
  updateAutoChase: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      autoChaseEnabled: z.boolean(),
      chaseDelayDays: z.number().min(1).max(30).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      await updatePaymentAccount(input.brandId, {
        autoChaseEnabled: input.autoChaseEnabled,
        chaseDelayDays: input.chaseDelayDays ?? account.chaseDelayDays,
      });
      return getPaymentAccount(input.brandId);
    }),

  // Billing summary — real fee/volume data for Settings > Billing tab
  billingSummary: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { feeThisMonthCents: 0, volumeThisMonthCents: 0, totalPayments: 0 };
      const rows = (await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'succeeded' THEN application_fee_cents ELSE 0 END), 0) AS fee_cents,
          COALESCE(SUM(CASE WHEN status = 'succeeded' THEN amount_cents ELSE 0 END), 0) AS volume_cents,
          COUNT(CASE WHEN status = 'succeeded' THEN 1 END) AS total_payments
        FROM payment_transactions
        WHERE brand_id = ${input.brandId}
          AND created_at >= DATE_TRUNC('month', NOW())
      `)) as unknown as Array<Record<string, unknown>>;
      const r = rows[0] ?? {};
      return {
        feeThisMonthCents: Number(r.fee_cents) || 0,
        volumeThisMonthCents: Number(r.volume_cents) || 0,
        totalPayments: Number(r.total_payments) || 0,
      };
    }),

  // Email template customisation
  getEmailTemplates: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return [];
      return db
        .select()
        .from(paymentEmailTemplates)
        .where(eq(paymentEmailTemplates.brandId, input.brandId));
    }),

  updateEmailTemplate: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      type: z.enum(['nudge', 'payment_receipt', 'payment_notification', 'proposal_sent', 'portal_link']),
      subject: z.string().min(1).max(255),
      bodyHtml: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      const existing = await db
        .select()
        .from(paymentEmailTemplates)
        .where(and(
          eq(paymentEmailTemplates.brandId, input.brandId),
          eq(paymentEmailTemplates.type, input.type),
        ))
        .limit(1);
      if (existing.length > 0) {
        await db
          .update(paymentEmailTemplates)
          .set({ subject: input.subject, bodyHtml: input.bodyHtml, isCustom: true })
          .where(and(
            eq(paymentEmailTemplates.brandId, input.brandId),
            eq(paymentEmailTemplates.type, input.type),
          ));
      } else {
        await db.insert(paymentEmailTemplates).values({
          brandId: input.brandId,
          type: input.type,
          subject: input.subject,
          bodyHtml: input.bodyHtml,
          isCustom: true,
        });
      }
      return { success: true };
    }),

  // Xero/MYOB integration status
  getAccountingStatus: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { accountId: null, brandId: null, xero: null, myob: null };
      const [row] = await db
        .select({
          xeroConnectedAt: paymentAccounts.xeroConnectedAt,
          xeroTenantId: paymentAccounts.xeroTenantId,
          myobConnectedAt: paymentAccounts.myobConnectedAt,
          myobCompanyFileId: paymentAccounts.myobCompanyFileId,
        })
        .from(paymentAccounts)
        .where(eq(paymentAccounts.brandId, input.brandId))
        .limit(1);
      return {
        accountId: account.id,
        brandId: input.brandId,
        xero: row?.xeroConnectedAt ? { connectedAt: row.xeroConnectedAt, tenantId: row.xeroTenantId } : null,
        myob: row?.myobConnectedAt ? { connectedAt: row.myobConnectedAt, companyFileId: row.myobCompanyFileId } : null,
      };
    }),

  disconnectXero: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { success: false };
      await db
        .update(paymentAccounts)
        .set({
          xeroAccessToken: null,
          xeroRefreshToken: null,
          xeroTokenExpiresAt: null,
          xeroTenantId: null,
          xeroConnectedAt: null,
        })
        .where(eq(paymentAccounts.brandId, input.brandId));
      return { success: true };
    }),

  disconnectMyob: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return { success: false };
      await db
        .update(paymentAccounts)
        .set({
          myobAccessToken: null,
          myobRefreshToken: null,
          myobTokenExpiresAt: null,
          myobCompanyFileId: null,
          myobConnectedAt: null,
        })
        .where(eq(paymentAccounts.brandId, input.brandId));
      return { success: true };
    }),

  // Thank-you page config
  getThankYouConfig: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) return null;
      return account.thankYouConfig ?? null;
    }),

  updateThankYouConfig: protectedProcedure
    .input(z.object({
      brandId: z.string().uuid(),
      headline: z.string().min(1).max(200),
      strap: z.string().max(500),
      steps: z.array(z.object({
        stamp: z.string().max(50),
        title: z.string().max(100),
        body: z.string().max(300),
      })).min(0).max(6),
    }))
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' });
      const { brandId, ...config } = input;
      await db
        .update(paymentAccounts)
        .set({ thankYouConfig: config })
        .where(eq(paymentAccounts.brandId, brandId));
      return config;
    }),

  // Get live FX rates for currency selector
  getFxRates: protectedProcedure.query(async () => {
    const rates = await getFxRates();
    // Return only the currencies we support
    const supported = ['AUD', 'USD', 'GBP', 'EUR', 'NZD', 'CAD', 'SGD'];
    const result: Record<string, number> = {};
    for (const code of supported) {
      result[code] = rates[code] ?? 1.0;
    }
    return result;
  }),
});
