/**
 * BETA PROGRAM router — the member-facing surface plus the super-admin console.
 *
 * Member procedures are self-scoped: a user can only ever read their own status,
 * their own report, and subscribe their own account. The `admin*` procedures run
 * on `superAdminProcedure` and back /super-admin/beta in the Prodesk app.
 *
 * Card procedures live here rather than reusing `shortLinks.*`: the shared
 * card-on-file rule says one Stripe customer per USER backs every feature sub, and
 * those procedures reach it through a brandId + `payments` permission. The
 * post-beta screen is an ACCOUNT-level moment — the person paying is the account
 * holder, who may be mid-onboarding with no brand context selected — so these
 * operate on `ctx.user.id` directly. Same customer, same default payment method,
 * no second place cards are stored.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  protectedProcedure,
  publicProcedure,
  router,
  superAdminProcedure,
} from '../trpc/trpc.js';
import { betaVersions, users } from '../db/schema.js';
import { env } from '../lib/env.js';
import { stripe } from '../modules/stripe/client.js';
import { retrieveCustomerOrNull } from '../modules/stripe/customer.js';
import { ensureStripeCustomerForUser } from '../modules/feature-subscriptions/stripe.js';
import { activateBetaSelection } from '../modules/beta/activate.js';
import { buildBetaBillingReport } from '../modules/beta/report.js';
import { betaStatus } from '../modules/beta/status.js';
import { extendUserBeta, listUserBetaExtensions } from '../modules/beta/extensions.js';
import { sentNoticesForCurrentDeadline } from '../modules/beta/reminders.js';
import {
  countBetaVersionMembers,
  findBetaVersionByCode,
  listBetaVersionMembers,
  listBetaVersionsWithCounts,
  normalizeBetaCode,
} from '../modules/beta/versions.js';

/** A signup code: short, URL-safe, case-insensitive (`v1`, `v2`, `launch-2026`). */
const codeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/, 'Use letters, numbers and hyphens only');

export const betaRouter = router({
  /* ── Member surface (self-scoped) ───────────────────────────────────────── */

  /**
   * The caller's beta state — drives the countdown banner and the post-expiry
   * screen in every frontend. Cheap (one indexed row) because it's fetched on
   * every authenticated load.
   */
  myStatus: protectedProcedure.query(({ ctx }) => betaStatus(ctx.db, ctx.user.id)),

  /**
   * What the caller will be charged per month once their beta ends, itemised by
   * product and derived from real usage. Also the payload behind the reminder
   * emails, so the figures the user reads in their inbox and in the app match.
   */
  myReport: protectedProcedure.query(({ ctx }) =>
    buildBetaBillingReport(ctx.db, ctx.user.id),
  ),

  /**
   * Dismiss the post-expiry takeover. From here the frontends show the slim
   * persistent banner instead of the full-screen report. Idempotent; an extension
   * clears this again so a second expiry is announced properly.
   */
  acknowledgeExpiry: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db
      .update(users)
      .set({ betaExpiryAcknowledgedAt: new Date() })
      .where(eq(users.id, ctx.user.id));
    return { ok: true as const };
  }),

  /* ── Card on file (account-scoped — see the module header) ───────────────── */

  /** Stripe publishable key for the in-app card form (null when Stripe is off). */
  billingConfig: protectedProcedure.query(() => ({
    publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? null,
  })),

  /** The caller's saved card (their customer's default payment method), or null. */
  card: protectedProcedure.query(async ({ ctx }) => {
    if (!stripe) return null;
    const [me] = await ctx.db
      .select({ cust: users.stripeCustomerId })
      .from(users)
      .where(eq(users.id, ctx.user.id))
      .limit(1);
    if (!me?.cust) return null;
    const customer = await retrieveCustomerOrNull(me.cust);
    if (!customer) return null;
    const dpm = customer.invoice_settings?.default_payment_method;
    const defaultPmId = typeof dpm === 'string' ? dpm : (dpm?.id ?? null);
    const pms = await stripe.paymentMethods.list({
      customer: me.cust,
      type: 'card',
      limit: 5,
    });
    const chosen = pms.data.find((p) => p.id === defaultPmId) ?? pms.data[0] ?? null;
    const card = chosen?.card;
    if (!card) return null;
    return {
      brand: card.brand,
      last4: card.last4,
      expMonth: card.exp_month,
      expYear: card.exp_year,
    };
  }),

  /** Begin adding/replacing the caller's card — returns a SetupIntent secret. */
  createSetupIntent: protectedProcedure.mutation(async ({ ctx }) => {
    if (!stripe) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Card payments are not configured.',
      });
    }
    const customer = await ensureStripeCustomerForUser(ctx.db, ctx.user.id);
    const intent = await stripe.setupIntents.create({
      customer,
      payment_method_types: ['card'],
      usage: 'off_session',
    });
    return { clientSecret: intent.client_secret };
  }),

  /**
   * After the SetupIntent succeeds, promote the new card to the customer default
   * so every subsequent feature subscription (and renewal) charges it. This is the
   * step that makes the on-file path in `subscribeToPrice` work.
   */
  setDefaultCard: protectedProcedure
    .input(z.object({ paymentMethodId: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      if (!stripe) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Card payments are not configured.',
        });
      }
      const customer = await ensureStripeCustomerForUser(ctx.db, ctx.user.id);
      // The SetupIntent already attached it; this is a best-effort guard.
      try {
        await stripe.paymentMethods.attach(input.paymentMethodId, { customer });
      } catch {
        /* already attached */
      }
      await stripe.customers.update(customer, {
        invoice_settings: { default_payment_method: input.paymentMethodId },
      });
      return { ok: true as const };
    }),

  /**
   * Subscribe to the products the caller picked on the post-beta screen. Prices and
   * quantities are re-derived server-side from the ids — never taken from the
   * client — and each line runs through the shared subscribe path. Returns a
   * per-line outcome so a partial success is reported honestly.
   */
  activate: protectedProcedure
    .input(z.object({ productIds: z.array(z.string().uuid()).min(1).max(20) }))
    .mutation(({ ctx, input }) =>
      activateBetaSelection(ctx.db, {
        ownerId: ctx.user.id,
        actorUserId: ctx.user.id,
        productIds: input.productIds,
      }),
    ),

  /* ── Public: the signup screen's "you're joining beta v1" notice ─────────── */

  /**
   * Describe a signup code to an unauthenticated visitor on /signup?beta=<code>.
   *
   * Deliberately minimal — label and length only. It never reveals enrolment
   * numbers or the internal id, and an unknown/closed/full code resolves to
   * `{ joinable: false }` rather than an error, because a bad code must not break
   * the signup form.
   */
  versionByCode: publicProcedure
    .input(z.object({ code: codeSchema }))
    .query(async ({ ctx, input }) => {
      const version = await findBetaVersionByCode(ctx.db, input.code);
      if (!version || !version.active) return { joinable: false as const };
      if (version.signupLimit != null) {
        const joined = await countBetaVersionMembers(ctx.db, version.id);
        if (joined >= version.signupLimit) return { joinable: false as const };
      }
      return {
        joinable: true as const,
        code: version.code,
        label: version.label,
        description: version.description,
        durationDays: version.durationDays,
      };
    }),

  /* ── Super-admin console ─────────────────────────────────────────────────── */

  /** Every version with live enrolment counts and remaining seats. */
  adminVersions: superAdminProcedure.query(({ ctx }) =>
    listBetaVersionsWithCounts(ctx.db),
  ),

  /** Create a cohort. The code is what goes in the signup link. */
  adminCreateVersion: superAdminProcedure
    .input(
      z.object({
        code: codeSchema,
        label: z.string().trim().max(120).optional(),
        description: z.string().trim().max(2000).optional(),
        // Capped at ~5 years: a longer "beta" is really unlimited access, which is
        // the separate hand-granted flag on /super-admin/users.
        durationDays: z.number().int().min(1).max(1825),
        active: z.boolean().default(true),
        signupLimit: z.number().int().min(1).max(10_000_000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await findBetaVersionByCode(ctx.db, input.code);
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `The code "${existing.code}" is already in use.`,
        });
      }
      const [created] = await ctx.db
        .insert(betaVersions)
        .values({
          code: normalizeBetaCode(input.code),
          label: input.label ?? null,
          description: input.description ?? null,
          durationDays: input.durationDays,
          active: input.active,
          signupLimit: input.signupLimit ?? null,
          createdByUserId: ctx.user.id,
        })
        .returning();
      return created;
    }),

  /**
   * Edit a cohort. Changing `durationDays` affects FUTURE signups only — existing
   * members keep the deadline they were promised (extend them individually
   * instead). The code is immutable so a shared signup link can't silently start
   * pointing at different terms.
   */
  adminUpdateVersion: superAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().max(120).nullish(),
        description: z.string().trim().max(2000).nullish(),
        durationDays: z.number().int().min(1).max(1825).optional(),
        active: z.boolean().optional(),
        signupLimit: z.number().int().min(1).max(10_000_000).nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      const [updated] = await ctx.db
        .update(betaVersions)
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.durationDays !== undefined ? { durationDays: patch.durationDays } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.signupLimit !== undefined ? { signupLimit: patch.signupLimit } : {}),
          updatedAt: new Date(),
        })
        .where(eq(betaVersions.id, id))
        .returning();
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Version not found' });
      return updated;
    }),

  /** Members of one cohort with their remaining days, soonest deadline first. */
  adminVersionUsers: superAdminProcedure
    .input(
      z.object({
        versionId: z.string().uuid(),
        search: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { rows, total } = await listBetaVersionMembers(ctx.db, input.versionId, {
        limit: input.limit,
        offset: input.offset,
        search: input.search,
      });
      const now = Date.now();
      return {
        items: rows.map((u) => ({
          ...u,
          // Same arithmetic as modules/beta/status so the admin sees exactly the
          // number the member sees.
          daysRemaining:
            u.betaEndsAt == null
              ? null
              : Math.max(0, Math.ceil((u.betaEndsAt.getTime() - now) / 86_400_000)),
          expired: u.betaEndsAt != null && u.betaEndsAt.getTime() <= now,
        })),
        total,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Give one member N more days. Counted from their current deadline, or from now
   * if it already passed, so an extension always yields usable days. Revives a
   * lapsed member (access is the same deadline every gate reads) and re-arms their
   * ending reminders.
   */
  adminExtendUser: superAdminProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        days: z.number().int().min(1).max(730),
        reason: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await extendUserBeta(ctx.db, {
        userId: input.userId,
        days: input.days,
        reason: input.reason,
        extendedByUserId: ctx.user.id,
      });
      if ('skipped' in result) {
        throw new TRPCError({
          code: result.skipped === 'not_found' ? 'NOT_FOUND' : 'BAD_REQUEST',
          message:
            result.skipped === 'not_found'
              ? 'User not found'
              : 'This user has unlimited beta access — there is no end date to extend.',
        });
      }
      return result;
    }),

  /** One member's beta detail for the admin drawer: extensions + reminders sent. */
  adminUserDetail: superAdminProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [status, extensions, notices, report] = await Promise.all([
        betaStatus(ctx.db, input.userId),
        listUserBetaExtensions(ctx.db, input.userId),
        sentNoticesForCurrentDeadline(ctx.db, input.userId),
        // The same report the member sees — so support can answer "what will I be
        // charged?" without asking them to read it out.
        buildBetaBillingReport(ctx.db, input.userId),
      ]);
      return { status, extensions, notices, report };
    }),

  /**
   * Programme-wide totals for the panel header. Counts across all cohorts, plus
   * hand-granted unlimited members (who belong to no cohort).
   */
  adminOverview: superAdminProcedure.query(async ({ ctx }) => {
    const [row] = await ctx.db
      .select({
        enrolled: count(),
        live: sql<number>`count(*) filter (where ${users.betaEndsAt} is null or ${users.betaEndsAt} > now())`,
        endingThisWeek: sql<number>`count(*) filter (where ${users.betaEndsAt} > now() and ${users.betaEndsAt} <= now() + interval '7 days')`,
        unlimited: sql<number>`count(*) filter (where ${users.betaEndsAt} is null)`,
      })
      .from(users)
      .where(eq(users.isBetaUser, true));
    const [cohortRow] = await ctx.db
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.isBetaUser, true), isNotNull(users.betaVersionId)));
    return {
      enrolled: Number(row?.enrolled ?? 0),
      live: Number(row?.live ?? 0),
      expired: Number(row?.enrolled ?? 0) - Number(row?.live ?? 0),
      endingThisWeek: Number(row?.endingThisWeek ?? 0),
      unlimited: Number(row?.unlimited ?? 0),
      inCohorts: Number(cohortRow?.n ?? 0),
    };
  }),

  /** Recent cohort signups across all versions — the panel's activity feed. */
  adminRecentSignups: superAdminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }))
    .query(({ ctx, input }) =>
      ctx.db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          betaStartedAt: users.betaStartedAt,
          betaEndsAt: users.betaEndsAt,
          versionCode: betaVersions.code,
        })
        .from(users)
        .innerJoin(betaVersions, eq(users.betaVersionId, betaVersions.id))
        .orderBy(desc(users.betaStartedAt))
        .limit(input.limit),
    ),
});
