import { z } from 'zod';
import { eq, gte, ilike, or, and, count, desc, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, superAdminProcedure } from '../trpc/trpc.js';
import { users, brands, agencies, globalSettings, disciplineRequests, files, projects, purchases, proposals, payouts, payoutBreakdowns, invoices, tasks, services, staff, aiUsage } from '../db/schema.js';
import { isNull } from 'drizzle-orm';
import {
  AI_FEATURES,
  catalogueEntry,
  familyHasKey,
  featureFor,
  listFamilies,
  MODEL_CATALOGUE,
} from '../modules/ai/providers/registry.js';
import { paginationInput, page } from '../lib/pagination.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { formatPercent } from '../lib/num.js';
import { onAgencyVerified, onDisciplineResolved } from './tasks.js';
import { readinessForPayoutIds } from '../modules/billing/payout-readiness.js';
import { buildPartyResolver, formatInvoiceNumber, fromPartyRef, toPartyRef } from '../modules/billing/invoice-parties.js';
import { deriveStatus } from './invoices.js';
import { withPayoutParties, withInvoiceParties } from '../modules/billing/list-parties.js';
import { payoutQueue } from '../jobs/queues.js';

/**
 * Default payment plan shape (mirrors Flutter PaymentPlanConfigModel). Numbers
 * are stored as JSON in globalSettings.defaultPaymentPlans.
 */
const paymentPlanSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  upfrontPercentage: z.number(),
  interestRate: z.number().default(10),
  durationWeeks: z.number().int(),
  isActive: z.boolean().default(true),
});
type PaymentPlan = z.infer<typeof paymentPlanSchema>;

/**
 * Maximum agency commission drawable within the 4th subscription payment for a
 * plan. Ported verbatim from Flutter `PaymentPlanConfigModel.maxAgencyCommission`
 * — do not change the math.
 */
function maxAgencyCommission(plan: PaymentPlan): number {
  const upfrontPercentageWithInterest =
    plan.upfrontPercentage + (plan.interestRate * plan.upfrontPercentage) / 100;
  const earningEveryWeekInPercentage =
    (100 + plan.interestRate - upfrontPercentageWithInterest) / plan.durationWeeks;
  return upfrontPercentageWithInterest + 4 * earningEveryWeekInPercentage;
}

export const superAdminRouter = router({
  /**
   * Users list. Search matches email OR firstName OR lastName (Flutter searches
   * email OR displayName == first+last).
   */
  users: superAdminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const where = input.search
      ? or(
          ilike(users.email, `%${input.search}%`),
          ilike(users.firstName, `%${input.search}%`),
          ilike(users.lastName, `%${input.search}%`),
        )
      : undefined;
    const [rows, [{ value: total }]] = await Promise.all([
      ctx.db.select().from(users).where(where).orderBy(desc(users.createdAt)).limit(input.limit).offset(input.offset),
      ctx.db.select({ value: count() }).from(users).where(where),
    ]);
    return page(rows, total, input);
  }),

  /**
   * Per-user owned agencies, for the AGENCIES drill-in column. Returns a map of
   * userId -> agencies the user owns (mirrors Flutter chips filtered by ownerId).
   */
  userAgencies: superAdminProcedure
    .input(z.object({ userIds: z.array(z.string().uuid()) }))
    .query(async ({ ctx, input }) => {
      if (input.userIds.length === 0) return {} as Record<string, { id: string; businessName: string; logoUrl: string | null; emailVerified: boolean }[]>;
      const rows = await ctx.db
        .select({ id: agencies.id, businessName: agencies.businessName, logoUrl: agencies.logoUrl, emailVerified: agencies.emailVerified, ownerId: agencies.ownerId })
        .from(agencies)
        .where(and(inArray(agencies.ownerId, input.userIds), isNull(agencies.derivedFromBrandId)));
      const map: Record<string, { id: string; businessName: string; logoUrl: string | null; emailVerified: boolean }[]> = {};
      for (const r of rows) {
        (map[r.ownerId] ??= []).push({ id: r.id, businessName: r.businessName, logoUrl: r.logoUrl, emailVerified: r.emailVerified });
      }
      return map;
    }),

  /**
   * Impersonation ("Login as"). Generates a one-time magic-link token for the
   * target user; the client redeems it via supabase.auth.verifyOtp to establish
   * a session as that user (replaces Flutter signInWithCustomToken).
   */
  loginAsUser: superAdminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const target = (await ctx.db.select().from(users).where(eq(users.id, input.userId)).limit(1))[0];
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      if (target.isSuperAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot impersonate another super admin' });
      // Supabase admin generateLink yields a hashed_token redeemable client-side
      // with verifyOtp({ type: 'magiclink', token_hash }).
      const { data, error } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: target.email,
      });
      if (error || !data?.properties?.hashed_token) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: error?.message ?? 'Failed to generate impersonation token' });
      }
      return { email: target.email, tokenHash: data.properties.hashed_token };
    }),

  /**
   * Grant or revoke BETA access for a user. A beta user is entitled to every
   * feature subscription for free (see modules/feature-subscriptions/entitlements
   * — the flag is an entitlement bypass, so it also covers features added later
   * and never bills). Toggled from the super-admin Users table.
   */
  setBetaUser: superAdminProcedure
    .input(z.object({ userId: z.string().uuid(), isBetaUser: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(users)
        .set({ isBetaUser: input.isBetaUser })
        .where(eq(users.id, input.userId))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      return updated;
    }),

  /**
   * Brands list. Search matches businessName OR industry (Flutter searches name
   * OR industry).
   */
  brands: superAdminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const where = input.search
      ? or(ilike(brands.businessName, `%${input.search}%`), ilike(brands.industry, `%${input.search}%`))
      : undefined;
    const [rows, [{ value: total }]] = await Promise.all([
      ctx.db.select().from(brands).where(where).orderBy(desc(brands.createdAt)).limit(input.limit).offset(input.offset),
      ctx.db.select({ value: count() }).from(brands).where(where),
    ]);
    return page(rows, total, input);
  }),

  /**
   * Payouts list for super admin, sorted by toPayAt. Each row carries the same
   * disbursement-readiness checkpoints (bank linked / payout date / project
   * completed) the earnings views show, so the admin status badge gets the same
   * hover tooltip — plus the per-row commission `breakdown` so the admin table
   * rows expand into the same Brand/Service/Reason/Week/Take/GST table as the
   * earnings payout tiles.
   */
  payouts: superAdminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const [rows, [{ value: total }]] = await Promise.all([
      ctx.db.query.payouts.findMany({
        orderBy: [desc(payouts.toPayAt)],
        limit: input.limit,
        offset: input.offset,
        with: {
          beneficiary: { columns: { id: true, firstName: true, lastName: true, email: true, profileUrl: true } },
          agency: { columns: { id: true, businessName: true, logoUrl: true } }
        }
      }),
      ctx.db.select({ value: count() }).from(payouts),
    ]);
    const payoutIds = rows.map((r) => r.id);
    const [readiness, bdRows] = await Promise.all([
      readinessForPayoutIds(ctx.db, payoutIds),
      payoutIds.length
        ? ctx.db.query.payoutBreakdowns.findMany({
            where: inArray(payoutBreakdowns.payoutId, payoutIds),
            with: { project: { columns: { taskTitle: true, title: true, serviceName: true } } },
          })
        : Promise.resolve([]),
    ]);
    const breakdownByPayout = new Map<string, (typeof payoutBreakdowns.$inferSelect)[]>();
    for (const b of bdRows) {
      const arr = breakdownByPayout.get(b.payoutId) ?? [];
      arr.push(b);
      breakdownByPayout.set(b.payoutId, arr);
    }
    const items = await withPayoutParties(
      ctx.db,
      rows.map((r) => ({
        ...r,
        payoutReadiness: readiness.get(r.id) ?? null,
        breakdown: breakdownByPayout.get(r.id) ?? [],
      })),
    );
    return page(items, total, input);
  }),

  /**
   * Manually run the payout cron on demand. Enqueues the very same `cron` job the
   * weekly Fri 23:59 schedule fires (worker.ts), so the payout worker dispatches
   * every due payout (`pending`/`upcoming` with `toPayAt` ≤ now) right away
   * instead of waiting for the weekly run. The cron also revives due `failed`
   * payouts and re-sends wire payouts stranded at leg 2 (funds already in our
   * Wise balance — see retryFundedWiseLeg2), so this backs the "Review failed
   * ones" button on the super-admin Payouts screen. Idempotent-ish: the cron only
   * re-touches still-due/stranded payouts, so re-running is safe (already-settled
   * rows are skipped; wise re-funds target the existing transfer, never a new one).
   */
  retryPayouts: superAdminProcedure.mutation(async () => {
    await payoutQueue.add('cron', {}, { removeOnComplete: true, removeOnFail: true });
    return { queued: true };
  }),

  /**
   * All invoices across the platform, newest first — the super-admin Invoices tab.
   * Each row resolves BOTH parties (from AND to) so either side is visible, plus
   * the connected payout's readiness checkpoints for the status hover tooltip
   * (null when the invoice has no connected payout).
   */
  invoices: superAdminProcedure.input(paginationInput).query(async ({ ctx, input }) => {
    const [rows, [{ value: total }]] = await Promise.all([
      ctx.db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(input.limit).offset(input.offset),
      ctx.db.select({ value: count() }).from(invoices),
    ]);
    const resolve = await buildPartyResolver(
      ctx.db,
      rows.flatMap((r) => [fromPartyRef(r), toPartyRef(r)]),
    );
    const readiness = await readinessForPayoutIds(ctx.db, rows.map((r) => r.payoutId));
    // Invoice status is derived from the linked payout (no stored column). Pull
    // the payout statuses for this page and map them the same way the brand list
    // does, so the super-admin status badge stays consistent.
    const payoutIds = rows.map((r) => r.payoutId).filter((id): id is string => !!id);
    const payoutStatusById = new Map<string, string>();
    if (payoutIds.length) {
      const ps = await ctx.db.select({ id: payouts.id, status: payouts.status }).from(payouts).where(inArray(payouts.id, payoutIds));
      for (const p of ps) payoutStatusById.set(p.id, p.status);
    }
    const items = await withInvoiceParties(
      ctx.db,
      rows.map((r) => ({
        ...r,
        status: deriveStatus(r.payoutId ? payoutStatusById.get(r.payoutId) : null),
        displayNumber: formatInvoiceNumber(r.number),
        fromName: resolve(fromPartyRef(r))?.name ?? null,
        toName: resolve(toPartyRef(r))?.name ?? null,
        payoutReadiness: r.payoutId ? (readiness.get(r.payoutId) ?? null) : null,
      })),
    );
    return page(items, total, input);
  }),

  agencies: superAdminProcedure
    .input(paginationInput.extend({ verified: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      // Exclude brand-derived shadow agencies — they're an implementation detail, not real agencies.
      const conditions = [isNull(agencies.derivedFromBrandId)];
      if (input.search) conditions.push(ilike(agencies.businessName, `%${input.search}%`));
      if (input.verified !== undefined) conditions.push(eq(agencies.emailVerified, input.verified));
      const where = conditions.length === 1 ? conditions[0] : and(...conditions);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db.select().from(agencies).where(where).orderBy(desc(agencies.createdAt)).limit(input.limit).offset(input.offset),
        ctx.db.select({ value: count() }).from(agencies).where(where),
      ]);
      return page(rows, total, input);
    }),

  /** Platform agency stats for the summary cards (Total / Verified / Pending). */
  agencyStats: superAdminProcedure.query(async ({ ctx }) => {
    const notDerived = isNull(agencies.derivedFromBrandId);
    const [[{ value: total }], [{ value: verified }]] = await Promise.all([
      ctx.db.select({ value: count() }).from(agencies).where(notDerived),
      ctx.db.select({ value: count() }).from(agencies).where(and(notDerived, eq(agencies.emailVerified, true))),
    ]);
    return { total, verified, pending: total - verified };
  }),

  setAgencyVerified: superAdminProcedure
    .input(z.object({ agencyId: z.string().uuid(), emailVerified: z.boolean(), rejectionReason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(agencies)
        .set({ emailVerified: input.emailVerified, rejectionReason: input.emailVerified ? null : input.rejectionReason })
        .where(eq(agencies.id, input.agencyId))
        .returning();
      // Verifying an agency resolves the pending agency-approval tasks for admins.
      if (input.emailVerified) await onAgencyVerified(input.agencyId, ctx.db);
      return updated;
    }),

  setAgencySalesAgency: superAdminProcedure
    .input(z.object({ agencyId: z.string().uuid(), isSalesAgency: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db.update(agencies).set({ isSalesAgency: input.isSalesAgency }).where(eq(agencies.id, input.agencyId)).returning();
      return updated;
    }),

  setAgencyDefault: superAdminProcedure
    .input(z.object({ agencyId: z.string().uuid(), platformVerified: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db.update(agencies).set({ platformVerified: input.platformVerified }).where(eq(agencies.id, input.agencyId)).returning();
      return updated;
    }),



  /**
   * Soft-delete an agency (Flutter sets username='deleted' + emailVerified=false).
   * The deleted username acts as a tombstone the agency lists filter out.
   */
  deleteAgency: superAdminProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(agencies)
        .set({ username: 'deleted', emailVerified: false })
        .where(eq(agencies.id, input.agencyId))
        .returning();
      return updated;
    }),

  getSettings: superAdminProcedure.query(async ({ ctx }) => {
    return (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0] ?? null;
  }),

  updateSettings: superAdminProcedure
    .input(
      z.object({
        prodeskCommission: z.number().optional(),
        affiliateCommission: z.number().optional(),
        agencyCommission: z.number().optional(),
        salesAgencyCommission: z.number().optional(),
        defaultPaymentPlans: z.array(paymentPlanSchema).optional(),
        disciplines: z.array(z.string()).optional(),
        services: z.array(z.string()).optional(),
        // Super-admin email forwarding recipients (Push Notifications tab).
        adminForwardingEmails: z.array(z.string().email()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const commissionKeys = ['prodeskCommission', 'affiliateCommission', 'agencyCommission', 'salesAgencyCommission'] as const;
      const anyCommission = commissionKeys.some((k) => input[k] !== undefined);
      // Enforce the 4-commission "must sum to exactly 100%" rule whenever any
      // commission is being written (matches Flutter validation at save time).
      if (anyCommission) {
        const total = commissionKeys.reduce((sum, k) => sum + (input[k] ?? 0), 0);
        if (Math.abs(total - 100) > 0.0001) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Global commissions must add up to 100%' });
        }
        // Per-plan validity check against the agency commission (Flutter
        // plan.isValid(agencyCommission)).
        const agencyCommission = input.agencyCommission ?? 0;
        const plans = input.defaultPaymentPlans ?? [];
        const invalid = plans.find((p) => agencyCommission > maxAgencyCommission(p));
        if (invalid) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `"${invalid.name}" plan does not reach agency commission within 4th subscription payment. Maximum agency commission payable is ${formatPercent(maxAgencyCommission(invalid))}`,
          });
        }
      }

      const toStr = (v?: number) => (v === undefined ? undefined : String(v));
      const values = {
        id: 1,
        prodeskCommission: toStr(input.prodeskCommission),
        affiliateCommission: toStr(input.affiliateCommission),
        agencyCommission: toStr(input.agencyCommission),
        salesAgencyCommission: toStr(input.salesAgencyCommission),
        defaultPaymentPlans: input.defaultPaymentPlans,
        disciplines: input.disciplines,
        services: input.services,
        adminForwardingEmails: input.adminForwardingEmails,
        updatedBy: ctx.user.id,
      };
      const [row] = await ctx.db
        .insert(globalSettings)
        .values(values)
        .onConflictDoUpdate({ target: globalSettings.id, set: { ...values, updatedAt: new Date() } })
        .returning();
      return row;
    }),

  /**
   * The AI provider families with their per-tier models, key-configured state,
   * and whether the super-admin has DISABLED each (exclusion-based — everything
   * available is on until turned off here). Drives the AI-spend screen's
   * providers panel.
   */
  aiProviders: superAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({ disabled: globalSettings.disabledAiProviders })
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1);
    const disabled = new Set(row?.disabled ?? []);
    return listFamilies().map((f) => ({ ...f, disabled: disabled.has(f.family) }));
  }),

  /**
   * Every configurable AI feature, its current model, and the models available.
   *
   * The Strategy assistant is absent by design — its model follows the brand's
   * own provider choice, so it belongs on the Providers control, not here.
   */
  aiFeatureModels: superAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        models: globalSettings.aiFeatureModels,
        disabled: globalSettings.disabledAiProviders,
      })
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1);

    const assigned = row?.models ?? {};
    const disabled = new Set(row?.disabled ?? []);

    return {
      catalogue: MODEL_CATALOGUE.map((e) => ({
        id: e.model.id,
        label: e.model.label,
        family: e.family,
        input: e.model.input,
        output: e.model.output,
        note: e.note,
        // A model whose family has no key, or that the super-admin turned off,
        // can't run — shown but not selectable, so the reason is visible.
        available: familyHasKey(e.family) && !disabled.has(e.family),
      })),
      features: AI_FEATURES.map((f) => ({
        source: f.source,
        label: f.label,
        group: f.group,
        hint: f.hint,
        defaultModelId: f.defaultModelId,
        modelId: assigned[f.source] ?? f.defaultModelId,
        /** True when this is the built-in default rather than an explicit choice. */
        isDefault: !assigned[f.source],
      })),
    };
  }),

  /** Assign a model to one feature. Passing null restores its default. */
  setAiFeatureModel: superAdminProcedure
    .input(z.object({ source: z.string().min(1), modelId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      if (!featureFor(input.source)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown AI feature.' });
      }
      if (input.modelId && !catalogueEntry(input.modelId)) {
        // An unregistered model would price at zero and silently under-report
        // this feature's spend, so it is refused rather than stored.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown model.' });
      }

      const [row] = await ctx.db
        .select({ models: globalSettings.aiFeatureModels })
        .from(globalSettings)
        .where(eq(globalSettings.id, 1))
        .limit(1);

      const next = { ...(row?.models ?? {}) };
      if (input.modelId) next[input.source] = input.modelId;
      else delete next[input.source];

      await ctx.db
        .insert(globalSettings)
        .values({ id: 1, aiFeatureModels: next, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: globalSettings.id,
          set: { aiFeatureModels: next, updatedBy: ctx.user.id, updatedAt: new Date() },
        });
      return { ok: true };
    }),

  /** Turn one AI provider family off (disabled=true) or back on for all brands. */
  setAiProviderDisabled: superAdminProcedure
    .input(z.object({ family: z.string(), disabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select({ disabled: globalSettings.disabledAiProviders })
        .from(globalSettings)
        .where(eq(globalSettings.id, 1))
        .limit(1);
      const set = new Set(row?.disabled ?? []);
      if (input.disabled) set.add(input.family);
      else set.delete(input.family);
      const next = [...set];
      await ctx.db
        .insert(globalSettings)
        .values({ id: 1, disabledAiProviders: next, updatedBy: ctx.user.id })
        .onConflictDoUpdate({
          target: globalSettings.id,
          set: { disabledAiProviders: next, updatedBy: ctx.user.id, updatedAt: new Date() },
        });
      return { disabled: next };
    }),

  /**
   * Per-brand AI assistant spend (token + USD cost), aggregated from ai_usage.
   * Drives the super-admin "AI Spend" report. Optional `sinceDays` window.
   */
  aiSpendByBrand: superAdminProcedure
    .input(paginationInput.extend({ sinceDays: z.number().int().min(1).max(365).optional() }))
    .query(async ({ ctx, input }) => {
      const since = input.sinceDays ? new Date(Date.now() - input.sinceDays * 86_400_000) : null;
      const whereSince = since ? gte(aiUsage.createdAt, since) : undefined;

      const rows = await ctx.db
        .select({
          brandId: aiUsage.brandId,
          brandName: brands.businessName,
          messages: sql<number>`count(${aiUsage.id})::int`,
          inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::bigint`,
          outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::bigint`,
          costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
          lastUsedAt: sql<string>`max(${aiUsage.createdAt})`,
        })
        .from(aiUsage)
        .leftJoin(brands, eq(aiUsage.brandId, brands.id))
        .where(whereSince)
        .groupBy(aiUsage.brandId, brands.businessName)
        .orderBy(sql`coalesce(sum(${aiUsage.costUsd}), 0) desc`)
        .limit(input.limit)
        .offset(input.offset);

      const [{ value: total } = { value: 0 }] = await ctx.db
        .select({ value: sql<number>`count(distinct ${aiUsage.brandId})::int` })
        .from(aiUsage)
        .where(whereSince);

      const [totals = { costUsd: '0', messages: 0 }] = await ctx.db
        .select({
          costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
          messages: sql<number>`count(${aiUsage.id})::int`,
        })
        .from(aiUsage)
        .where(whereSince);

      // Spend broken down by the feature that produced it (ai_usage.source),
      // so the admin can see WHERE usage is coming from, not just which brand.
      const bySource = await ctx.db
        .select({
          source: aiUsage.source,
          messages: sql<number>`count(${aiUsage.id})::int`,
          costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
        })
        .from(aiUsage)
        .where(whereSince)
        .groupBy(aiUsage.source)
        .orderBy(sql`coalesce(sum(${aiUsage.costUsd}), 0) desc`);

      // Spend broken down by the model that produced it (ai_usage.model), so the
      // admin can compare Sonnet vs Haiku cost across all features.
      const byModel = await ctx.db
        .select({
          model: aiUsage.model,
          messages: sql<number>`count(${aiUsage.id})::int`,
          costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
        })
        .from(aiUsage)
        .where(whereSince)
        .groupBy(aiUsage.model)
        .orderBy(sql`coalesce(sum(${aiUsage.costUsd}), 0) desc`);

      return { ...page(rows, total ?? 0, input), totals, bySource, byModel };
    }),

  /**
   * Replace the global disciplines list. Backs the disciplines management screen
   * (add / remove / rename / merge all reduce to writing the resulting array,
   * mirroring Flutter `updateDisciplines`).
   */
  updateDisciplines: superAdminProcedure
    .input(z.object({ disciplines: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(globalSettings)
        .values({ id: 1, disciplines: input.disciplines, updatedBy: ctx.user.id })
        .onConflictDoUpdate({ target: globalSettings.id, set: { disciplines: input.disciplines, updatedBy: ctx.user.id, updatedAt: new Date() } })
        .returning();
      return row;
    }),

  /** Pending discipline suggestions from agencies (approval queue). */
  disciplineRequests: superAdminProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(disciplineRequests).orderBy(desc(disciplineRequests.createdAt));
  }),

  /** Reject/remove a discipline request without adding it to the global list. */
  deleteDisciplineRequest: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(disciplineRequests).where(eq(disciplineRequests.id, input.id));
      await onDisciplineResolved(input.id, ctx.db);
      return { id: input.id };
    }),

  /**
   * Approve a discipline request: delete the request and add its discipline to
   * the global list (idempotent — skips if already present). Mirrors Flutter
   * acceptDiscipline + deleteDisciplineRequest.
   */
  approveDisciplineRequest: superAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const req = (await ctx.db.select().from(disciplineRequests).where(eq(disciplineRequests.id, input.id)).limit(1))[0];
      if (!req) throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found' });
      const settings = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
      const current = settings?.disciplines ?? [];
      const next = current.includes(req.discipline)
        ? current
        : [...current, req.discipline].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
      await ctx.db.delete(disciplineRequests).where(eq(disciplineRequests.id, input.id));
      const [row] = await ctx.db
        .insert(globalSettings)
        .values({ id: 1, disciplines: next, updatedBy: ctx.user.id })
        .onConflictDoUpdate({ target: globalSettings.id, set: { disciplines: next, updatedBy: ctx.user.id, updatedAt: new Date() } })
        .returning();
      await onDisciplineResolved(input.id, ctx.db);
      return { discipline: req.discipline, settings: row };
    }),

  /**
   * Rename a discipline everywhere it appears: the global list AND every agency's
   * `disciplines` array (deduped). Ports the `renameDiscipline` cloud function.
   */
  renameDiscipline: superAdminProcedure
    .input(z.object({ oldName: z.string().min(1), newName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await renameDisciplineEverywhere(ctx.db, input.oldName, input.newName, ctx.user.id);
      return { ok: true };
    }),

  /**
   * Merge several disciplines into one target — renames each source to the
   * target everywhere (global + agencies), deduping as it goes.
   */
  mergeDisciplines: superAdminProcedure
    .input(z.object({ sources: z.array(z.string().min(1)).min(1), target: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      for (const src of input.sources) {
        if (src === input.target) continue;
        await renameDisciplineEverywhere(ctx.db, src, input.target, ctx.user.id);
      }
      return { ok: true };
    }),

  /* ── Infin8 taxonomy (stages → substages) management ──────────────────────
   * The Infin8 equivalent of the disciplines screen. Structural edits (add /
   * remove / rename / reorder a STAGE, add / remove a SUBSTAGE) reduce to writing
   * the resulting ordered array via `updateInfin8Stages`. Renaming or merging a
   * SUBSTAGE additionally cascades to every agency's `infin8Substages` array (the
   * Infin8 analogue of renameDiscipline). */
  updateInfin8Stages: superAdminProcedure
    .input(z.object({ stages: z.array(z.object({ stage: z.string().min(1), substages: z.array(z.string().min(1)) })) }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(globalSettings)
        .values({ id: 1, infin8Stages: input.stages, updatedBy: ctx.user.id })
        .onConflictDoUpdate({ target: globalSettings.id, set: { infin8Stages: input.stages, updatedBy: ctx.user.id, updatedAt: new Date() } })
        .returning();
      return row;
    }),

  /** Rename a substage in the taxonomy AND across every agency's selection. */
  renameInfin8Substage: superAdminProcedure
    .input(z.object({ oldName: z.string().min(1), newName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await renameInfin8SubstageEverywhere(ctx.db, input.oldName, input.newName, ctx.user.id);
      return { ok: true };
    }),

  /** Merge several substages into one target — cascades each source → target. */
  mergeInfin8Substages: superAdminProcedure
    .input(z.object({ sources: z.array(z.string().min(1)).min(1), target: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      for (const src of input.sources) {
        if (src === input.target) continue;
        await renameInfin8SubstageEverywhere(ctx.db, src, input.target, ctx.user.id);
      }
      return { ok: true };
    }),

  /**
   * Rename a STAGE in the taxonomy AND across every service pinned to it. A
   * stage rename can't go through `updateInfin8Stages` (that just rewrites the
   * array and can't cascade), so — like substages — it gets a dedicated endpoint
   * that also rewrites the scalar `services.stage` column.
   */
  renameInfin8Stage: superAdminProcedure
    .input(z.object({ oldName: z.string().min(1), newName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await renameInfin8StageEverywhere(ctx.db, input.oldName, input.newName, ctx.user.id);
      return { ok: true };
    }),

  /* ── Super-admin read paths / diagnostics ────────────────────────────────── */

  /** A brand's document-locker files (super-admin read path — bypasses brand membership). */
  brandFiles: superAdminProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(files)
        .where(and(eq(files.brandId, input.brandId), isNull(files.deletedAt)))
        .orderBy(desc(files.uploadedAt));
    }),

  /** Platform-wide row counts (ports the Dev Dashboard collection-counts grid). */
  collectionCounts: superAdminProcedure.query(async ({ ctx }) => {
    const tablesToCount = { users, agencies, brands, projects, purchases, proposals, payouts, invoices, tasks, services, staff };
    const out: Record<string, number> = {};
    for (const [name, table] of Object.entries(tablesToCount)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      out[name] = (await ctx.db.select({ c: count() }).from(table as any))[0]?.c ?? 0;
    }
    return out;
  }),

  /** JSON data export for an allowlisted table (ports `shareData`). Capped for safety. */
  exportData: superAdminProcedure
    .input(z.object({ table: z.enum(['users', 'agencies', 'brands', 'projects', 'purchases', 'proposals', 'payouts', 'invoices']), limit: z.number().int().min(1).max(5000).default(1000) }))
    .mutation(async ({ ctx, input }) => {
      const map = { users, agencies, brands, projects, purchases, proposals, payouts, invoices } as const;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await ctx.db.select().from(map[input.table] as any).limit(input.limit);
      return { table: input.table, count: (rows as unknown[]).length, rows };
    }),
});

/**
 * Replace `oldName` with `newName` everywhere a discipline is stored: the global
 * settings list, every agency's `disciplines`, and every service's & package's
 * `disciplines` (all deduped). Disciplines live in identical `text[]` columns on
 * agencies, services and packages — cascading to all three keeps the taxonomy
 * consistent so a rename doesn't leave orphaned old names on the catalog.
 */
async function renameDisciplineEverywhere(db: typeof import('../db/index.js').db, oldName: string, newName: string, updatedBy: string) {
  // Global settings list.
  const settings = (await db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
  if (settings?.disciplines?.includes(oldName)) {
    const next = Array.from(new Set(settings.disciplines.filter((d) => d !== oldName).concat(newName))).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    await db.update(globalSettings).set({ disciplines: next, updatedBy, updatedAt: new Date() }).where(eq(globalSettings.id, 1));
  }
  // Every agency / service / package carrying the old discipline — replace + dedupe.
  for (const table of ['agencies', 'services', 'packages']) {
    await db.execute(sql`
      update ${sql.raw(table)}
      set disciplines = (select array_agg(distinct d) from unnest(array_replace(disciplines, ${oldName}, ${newName})) as d)
      where ${oldName} = any(disciplines)
    `);
  }
}

/**
 * Rename an Infin8 substage everywhere: inside the taxonomy stored in
 * globalSettings.infin8Stages (deduping per stage) AND across every agency's
 * `infin8Substages` selection. The Infin8 analogue of renameDisciplineEverywhere.
 */
async function renameInfin8SubstageEverywhere(db: typeof import('../db/index.js').db, oldName: string, newName: string, updatedBy: string) {
  const row = (await db.select({ s: globalSettings.infin8Stages }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
  const current = row?.s ?? [];
  const next = current.map((g) => ({
    stage: g.stage,
    substages: Array.from(new Set(g.substages.map((s) => (s === oldName ? newName : s)))),
  }));
  await db
    .insert(globalSettings)
    .values({ id: 1, infin8Stages: next, updatedBy })
    .onConflictDoUpdate({ target: globalSettings.id, set: { infin8Stages: next, updatedBy, updatedAt: new Date() } });
  // Every agency that selected the old substage — replace + dedupe.
  await db.execute(sql`
    update agencies
    set infin8_substages = (select array_agg(distinct s) from unnest(array_replace(infin8_substages, ${oldName}, ${newName})) as s)
    where ${oldName} = any(infin8_substages)
  `);
  // Every service pinned to the old substage. Services hold a single substage in
  // the scalar `sub_stage` column, so this is a straight value swap.
  await db.execute(sql`
    update services
    set sub_stage = ${newName}
    where sub_stage = ${oldName}
  `);
}

/**
 * Rename an Infin8 stage everywhere: the stage label inside
 * globalSettings.infin8Stages AND every service's scalar `stage` column.
 * Substages are untouched. Agencies don't store stages (only substages), so
 * there's no agency cascade here.
 */
async function renameInfin8StageEverywhere(db: typeof import('../db/index.js').db, oldName: string, newName: string, updatedBy: string) {
  const row = (await db.select({ s: globalSettings.infin8Stages }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
  const current = row?.s ?? [];
  const next = current.map((g) => (g.stage === oldName ? { ...g, stage: newName } : g));
  await db
    .insert(globalSettings)
    .values({ id: 1, infin8Stages: next, updatedBy })
    .onConflictDoUpdate({ target: globalSettings.id, set: { infin8Stages: next, updatedBy, updatedAt: new Date() } });
  // Every service pinned to the old stage.
  await db.execute(sql`
    update services
    set stage = ${newName}
    where stage = ${oldName}
  `);
}
