import { z } from 'zod';
import { and, eq, isNull, ne, sql, desc, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  router,
  publicProcedure,
  protectedProcedure,
  superAdminProcedure,
} from '../trpc/trpc.js';
import {
  agencies,
  userAgencies,
  users,
  services,
  projects,
  brandAgencyConnections,
  staff,
  agencyContractorConnections,
  proposals,
  disciplineRequests,
  globalSettings,
  brands,
} from '../db/schema.js';
import { assertAgencyAccess } from '../trpc/permissions.js';
import { checkBusinessNameAvailable } from '../lib/business-name.js';
import { onAgencyPendingApproval, onDisciplineRequested } from './tasks.js';
import { stripe } from '../modules/stripe/client.js';
import { createWiseRecipient } from '../modules/billing/wise.js';

const payoutMethodEnum = z.enum(['stripe', 'paypal', 'wire']);

// Reserved subdomains — ported from agency_controller.dart:190-202.
const BLACKLIST_SUBDOMAINS = [
  'prodesk',
  'prod',
  'staging',
  'stage',
  'app',
  'dev',
  'www',
  'admin',
  'support',
  'help',
  'deleted',
  'test',
];

/** Validate a candidate subdomain username (length/regex/blacklist). Mirrors checkUsernameAvailability. */
function usernameFormatError(raw: string): string | null {
  const username = raw.toLowerCase();
  if (username.length <= 2 || username.length > 20)
    return 'Username must be 3-20 characters';
  if (!/^[a-z]+$/.test(username))
    return 'Username may only contain lowercase letters';
  if (BLACKLIST_SUBDOMAINS.includes(username))
    return 'This username is reserved';
  return null;
}

// numeric/pct columns round-trip as strings in drizzle.
const num = (v: number | undefined | null) =>
  v === undefined || v === null ? undefined : String(v);

/**
 * URL validator — mirrors Flutter AppValidator.url: requires an http(s)://
 * scheme and at least one dotted domain segment. Optional, so only enforced
 * when a non-empty value is supplied. Used for website + all social links.
 */
const URL_REGEX =
  /^(http|https):\/\/[\w-]+(\.[\w-]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?$/;
const optionalUrl = z
  .string()
  .optional()
  .refine((v) => !v || URL_REGEX.test(v.trim()), {
    message: 'Please enter a valid URL (starting with http:// or https://)',
  });

const socialInput = z
  .object({
    facebookUrl: optionalUrl,
    xUrl: optionalUrl,
    instagramUrl: optionalUrl,
  })
  .optional();

const profileInput = z.object({
  businessName: z.string().trim().min(1),
  legalName: z.string().optional(),
  businessEmail: z.string().email().optional(),
  username: z.string().trim().optional(),
  website: optionalUrl,
  phone: z.string().optional(),
  address: z.string().optional(),
  abn: z.string().optional(),
  description: z.string().optional(),
  shortDescription: z.string().optional(),
  disciplines: z.array(z.string()).optional(),
  infin8Substages: z.array(z.string()).optional(),
  social: socialInput,
  uiPreferences: z.record(z.string(), z.unknown()).optional(),
});

export const agenciesRouter = router({
  /**
   * The Infin8 taxonomy (ordered stages → substages) for the agency profile
   * form's substage picker. The admin-edited list in globalSettings is the
   * single source of truth (seeded by scripts/initialize.ts); returns [] when
   * unset rather than falling back to a hardcoded constant.
   */
  infin8Stages: protectedProcedure.query(async ({ ctx }) => {
    const row = (
      await ctx.db
        .select({ s: globalSettings.infin8Stages })
        .from(globalSettings)
        .where(eq(globalSettings.id, 1))
        .limit(1)
    )[0];
    return row?.s ?? [];
  }),

  /**
   * The global disciplines list for the agency profile form's discipline picker.
   * This is the single source of truth — the same `globalSettings.disciplines`
   * the super-admin taxonomy screen edits and `approveDisciplineRequest` appends
   * to — so a discipline becomes selectable for every agency the moment it's
   * approved. Returns an empty list when unset; the client falls back to its
   * static defaults in that case.
   */
  disciplines: protectedProcedure.query(async ({ ctx }) => {
    const row = (
      await ctx.db
        .select({ s: globalSettings.disciplines })
        .from(globalSettings)
        .where(eq(globalSettings.id, 1))
        .limit(1)
    )[0];
    return row?.s ?? [];
  }),

  /**
   * Agencies the current user belongs to — both owned (userAgencies) and those
   * they are active staff of (staff table). Staff have no userAgencies row, so
   * without the staff join `activeAgency` resolves to null for them and any
   * agency-scoped flag (e.g. platformVerified gating the Explore Contractors rail)
   * silently disappears for staff. Deduped by id.
   */
  mine: protectedProcedure.query(async ({ ctx }) => {
    const [owned, staffed] = await Promise.all([
      ctx.db
        .select({ agency: agencies })
        .from(userAgencies)
        .innerJoin(agencies, eq(userAgencies.agencyId, agencies.id))
        .where(eq(userAgencies.userId, ctx.user.id)),
      ctx.db
        .select({ agency: agencies })
        .from(staff)
        .innerJoin(agencies, eq(staff.agencyId, agencies.id))
        .where(and(eq(staff.userId, ctx.user.id), eq(staff.status, 'active'))),
    ]);
    const byId = new Map<string, (typeof owned)[number]['agency']>();
    for (const r of [...owned, ...staffed]) byId.set(r.agency.id, r.agency);
    // Alphabetical — the context selector renders this list as-is.
    return [...byId.values()].sort((a, b) =>
      a.businessName.localeCompare(b.businessName, undefined, { sensitivity: 'base' }),
    );
  }),

  /** Stat-card counts for the agency dashboard. */
  dashboardStats: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const a = input.agencyId;
      const [
        activeProjects,
        clients,
        serviceCount,
        teamMembers,
        pendingApplications,
        proposalCount,
      ] = await Promise.all([
        ctx.db.$count(
          projects,
          and(
            eq(projects.agencyId, a),
            ne(projects.status, 'completed'),
            isNull(projects.deletedAt),
          ),
        ),
        ctx.db.$count(
          brandAgencyConnections,
          eq(brandAgencyConnections.agencyId, a),
        ),
        ctx.db.$count(
          services,
          and(eq(services.agencyId, a), isNull(services.deletedAt)),
        ),
        ctx.db.$count(
          staff,
          and(eq(staff.agencyId, a), eq(staff.status, 'active')),
        ),
        ctx.db.$count(
          agencyContractorConnections,
          and(
            eq(agencyContractorConnections.agencyId, a),
            eq(agencyContractorConnections.status, 'pendingApplication'),
          ),
        ),
        ctx.db.$count(proposals, eq(proposals.agencyId, a)),
      ]);
      return {
        activeProjects,
        clients,
        services: serviceCount,
        teamMembers,
        pendingActions: pendingApplications,
        proposals: proposalCount,
      };
    }),

  /** Recent active projects for the dashboard active-projects section. */
  recentProjects: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        limit: z.number().min(1).max(20).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(projects)
        .where(
          and(
            eq(projects.agencyId, input.agencyId),
            ne(projects.status, 'completed'),
            isNull(projects.deletedAt),
          ),
        )
        .orderBy(desc(projects.updatedAt))
        .limit(input.limit);
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return (
        (
          await ctx.db
            .select()
            .from(agencies)
            .where(eq(agencies.id, input.id))
            .limit(1)
        )[0] ?? null
      );
    }),

  /**
   * Commission defaults for the service-form dialogs (New Service / New Project /
   * Custom Item). Mirrors the Flutter `ServiceFormControllers.from(agency:)` seed
   * (production/briefing/approval commissions default to the agency's values) plus
   * the global `agencyCommission` cap used by the "Total commissions cannot reach
   * or exceed agency commission" check. `agencyCommission` falls back to 100 when
   * unset (same as the server saveWorkflowSettings cap check).
   */
  commissionDefaults: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const a = (
        await ctx.db
          .select({
            production: agencies.productionManagerCommission,
            briefing: agencies.briefingManagerCommission,
            approval: agencies.internalApprovalCommission,
          })
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      const gs = (
        await ctx.db
          .select({ c: globalSettings.agencyCommission })
          .from(globalSettings)
          .where(eq(globalSettings.id, 1))
          .limit(1)
      )[0];
      return {
        productionManagerCommission:
          a?.production != null ? Number(a.production) : 0,
        briefingManagerCommission: a?.briefing != null ? Number(a.briefing) : 0,
        internalApprovalCommission:
          a?.approval != null ? Number(a.approval) : 0,
        agencyCommission: gs?.c != null ? Number(gs.c) : 100,
      };
    }),

  /** Resolve the tenant agency from a subdomain username. */
  byUsername: publicProcedure
    .input(z.object({ username: z.string() }))
    .query(async ({ ctx, input }) => {
      return (
        (
          await ctx.db
            .select()
            .from(agencies)
            .where(sql`lower(${agencies.username}) = lower(${input.username})`)
            .limit(1)
        )[0] ?? null
      );
    }),

  /**
   * Live username/subdomain availability — blacklist + regex + uniqueness.
   * Ports checkUsernameAvailability (agency_controller.dart:204-211). The client
   * debounces; this is the authoritative check. `excludeAgencyId` lets the edit
   * screen keep its own current username.
   */
  checkUsername: protectedProcedure
    .input(
      z.object({
        username: z.string().trim(),
        excludeAgencyId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const formatError = usernameFormatError(input.username);
      if (formatError) return { available: false, reason: formatError };
      const existing = await ctx.db
        .select({ id: agencies.id })
        .from(agencies)
        .where(sql`lower(${agencies.username}) = lower(${input.username})`)
        .limit(1);
      const taken = existing[0] && existing[0].id !== input.excludeAgencyId;
      return {
        available: !taken,
        reason: taken ? 'This username is already taken' : null,
      };
    }),

  /**
   * Live business-name availability. Ports checkBusinessNameAvailability
   * (agency_controller.dart:213-215). Case-insensitive exact match across the
   * shared brand+agency namespace (see checkBusinessNameAvailable).
   */
  checkBusinessName: protectedProcedure
    .input(
      z.object({
        businessName: z.string().trim(),
        excludeAgencyId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return checkBusinessNameAvailable(ctx.db, input.businessName, {
        excludeAgencyId: input.excludeAgencyId,
      });
    }),

  /**
   * Create an agency (the create-agency wizard). Validates username, creates the
   * membership, promotes the user to agencyOwner, files discipline-requests for
   * custom disciplines, and enqueues the super-admin approval task.
   * Ports createAgency (agency_controller.dart:30-115).
   */
  create: protectedProcedure
    .input(profileInput)
    .mutation(async ({ ctx, input }) => {
      if (input.username) {
        const formatError = usernameFormatError(input.username);
        if (formatError)
          throw new TRPCError({ code: 'BAD_REQUEST', message: formatError });
        const dupe = await ctx.db
          .select({ id: agencies.id })
          .from(agencies)
          .where(sql`lower(${agencies.username}) = lower(${input.username})`)
          .limit(1);
        if (dupe[0])
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This username is already taken',
          });
      }

      // Business name is unique across the shared brand+agency namespace.
      const nameCheck = await checkBusinessNameAvailable(
        ctx.db,
        input.businessName,
      );
      if (!nameCheck.available)
        throw new TRPCError({ code: 'CONFLICT', message: nameCheck.reason! });

      const [agency] = await ctx.db
        .insert(agencies)
        .values({
          ownerId: ctx.user.id,
          businessName: input.businessName,
          legalName: input.legalName,
          businessEmail: input.businessEmail,
          username: input.username?.toLowerCase() || undefined,
          website: input.website,
          phone: input.phone,
          address: input.address,
          abn: input.abn,
          description: input.description,
          shortDescription: input.shortDescription,
          disciplines: input.disciplines,
          infin8Substages: input.infin8Substages,
          social: input.social,
          uiPreferences: input.uiPreferences ?? {},
        })
        .returning();

      await ctx.db
        .insert(userAgencies)
        .values({ userId: ctx.user.id, agencyId: agency.id })
        .onConflictDoNothing();
      await ctx.db
        .update(users)
        .set({ role: 'agencyOwner', selectedAgencyId: agency.id })
        .where(eq(users.id, ctx.user.id));

      await fileCustomDisciplineRequests(
        ctx.db,
        agency.id,
        input.disciplines ?? [],
      );

      // Super-admins must approve a new agency before it is verified.
      await onAgencyPendingApproval(
        { agencyId: agency.id, agencyName: agency.businessName },
        ctx.db,
      );

      return agency;
    }),

  /**
   * Update agency profile/branding (edit-agency screen). Validates username,
   * persists profile + uiPreferences, files custom discipline-requests.
   * Ports updateAgencyDetails (agency_controller.dart:117-188).
   */
  update: protectedProcedure
    .input(profileInput.partial().extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.id, 'agencyInfo');
      if (input.username) {
        const formatError = usernameFormatError(input.username);
        if (formatError)
          throw new TRPCError({ code: 'BAD_REQUEST', message: formatError });
        const dupe = await ctx.db
          .select({ id: agencies.id })
          .from(agencies)
          .where(sql`lower(${agencies.username}) = lower(${input.username})`)
          .limit(1);
        if (dupe[0] && dupe[0].id !== input.id)
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'This username is already taken',
          });
      }
      if (input.businessName !== undefined) {
        const nameCheck = await checkBusinessNameAvailable(
          ctx.db,
          input.businessName,
          { excludeAgencyId: input.id },
        );
        if (!nameCheck.available)
          throw new TRPCError({ code: 'CONFLICT', message: nameCheck.reason! });
      }
      const { id, username, ...rest } = input;
      const [updated] = await ctx.db
        .update(agencies)
        .set({
          ...rest,
          ...(username !== undefined
            ? { username: username.toLowerCase() || null }
            : {}),
        })
        .where(eq(agencies.id, id))
        .returning();
      if (input.disciplines)
        await fileCustomDisciplineRequests(ctx.db, id, input.disciplines);
      return updated;
    }),

  /** Update only the agency logo. Ports updateLogo (agency_controller.dart:217-222). */
  updateLogo: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        logoUrl: z.string().url(),
        logoPath: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.id, 'agencyInfo');
      const [updated] = await ctx.db
        .update(agencies)
        .set({ logoUrl: input.logoUrl })
        .where(eq(agencies.id, input.id))
        .returning();
      return updated;
    }),

  /**
   * Workflow settings: role designees + commission split + redirect-to-bank
   * toggles. Ports WorkflowSettingsNotifier.saveSettings (workflow_settings_state.dart:399-460),
   * including the cap check against globalSettings.agencyCommission.
   */
  saveWorkflowSettings: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        briefingDesigneeId: z.string().uuid().nullable().optional(),
        allocationDesigneeId: z.string().uuid().nullable().optional(),
        approvalDesigneeId: z.string().uuid().nullable().optional(),
        salesStaffIds: z.array(z.string().uuid()).default([]),
        redirectBriefingCommissionToBankAccount: z.boolean().default(false),
        redirectProductionCommissionToBankAccount: z.boolean().default(false),
        redirectSalesPersonCommissionToBankAccount: z.boolean().default(false),
        redirectInternalApprovalCommissionToBankAccount: z
          .boolean()
          .default(false),
        // staffId -> percent. Only the redirected ones are persisted (mirrors Flutter).
        salesPersonCommissions: z.record(z.string(), z.number()).default({}),
        productionManagerCommission: z.number().nonnegative().default(0),
        briefingManagerCommission: z.number().nonnegative().default(0),
        internalApprovalCommission: z.number().nonnegative().default(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'rolesAndCommissions');

      // Cap check: prod + briefing + approval + max(sales) must be < agencyCommission.
      const salesValues = Object.values(input.salesPersonCommissions);
      const maxSales = salesValues.length ? Math.max(...salesValues) : 0;
      const totalComm =
        input.productionManagerCommission +
        input.briefingManagerCommission +
        input.internalApprovalCommission +
        maxSales;
      const gs = (
        await ctx.db
          .select()
          .from(globalSettings)
          .where(eq(globalSettings.id, 1))
          .limit(1)
      )[0];
      const maxAgencyCommission = gs?.agencyCommission
        ? Number(gs.agencyCommission)
        : 100;
      if (totalComm >= maxAgencyCommission) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Total commissions (${totalComm}%) cannot reach or exceed agency commission (${maxAgencyCommission}%)`,
        });
      }

      const [updated] = await ctx.db
        .update(agencies)
        .set({
          briefingDesigneeId: input.briefingDesigneeId ?? null,
          allocationDesigneeId: input.allocationDesigneeId ?? null,
          approvalDesigneeId: input.approvalDesigneeId ?? null,
          salesStaffIds: input.salesStaffIds,
          redirectBriefingCommissionToBankAccount:
            input.redirectBriefingCommissionToBankAccount,
          redirectProductionCommissionToBankAccount:
            input.redirectProductionCommissionToBankAccount,
          redirectSalesPersonCommissionToBankAccount:
            input.redirectSalesPersonCommissionToBankAccount,
          redirectInternalApprovalCommissionToBankAccount:
            input.redirectInternalApprovalCommissionToBankAccount,
          salesPersonCommissions: input.salesPersonCommissions,
          productionManagerCommission: num(input.productionManagerCommission),
          briefingManagerCommission: num(input.briefingManagerCommission),
          internalApprovalCommission: num(input.internalApprovalCommission),
        })
        .where(eq(agencies.id, input.agencyId))
        .returning();
      return updated;
    }),

  /**
   * The owner + active staff users of an agency, for designee/sales pickers in
   * Workflow Settings (each row carries bankAccountLinked for the redirect gate).
   */
  members: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'rolesAndCommissions');
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND' });
      const staffRows = await ctx.db
        .select({
          userId: staff.userId,
          displayName: staff.displayName,
          email: staff.email,
        })
        .from(staff)
        .where(
          and(
            eq(staff.agencyId, input.agencyId),
            eq(staff.type, 'agency'),
            eq(staff.status, 'active'),
          ),
        );
      const memberIds = [
        agency.ownerId,
        ...staffRows.map((s) => s.userId),
      ].filter((id): id is string => !!id);
      const userRows = memberIds.length
        ? await ctx.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
              profileUrl: users.profileUrl,
              bankAccountLinked: users.bankAccountLinked,
            })
            .from(users)
            .where(inArray(users.id, memberIds))
        : [];
      // Agency-level default sales commission per member (seeds the package
      // meeting-staff editor — ports resolveDefaultStaffCommission).
      const salesPersonCommissions = (agency.salesPersonCommissions ??
        {}) as Record<string, number>;
      return userRows.map((u) => ({
        id: u.id,
        name:
          [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email,
        email: u.email,
        profileUrl: u.profileUrl,
        bankAccountLinked: u.id === agency.ownerId ? true : u.bankAccountLinked,
        isOwner: u.id === agency.ownerId,
        salesPersonCommission: Number(salesPersonCommissions[u.id] ?? 0) || 0,
      }));
    }),

  /**
   * Brands referred via this agency's affiliate link. Powers
   * agency_affiliate_screen.dart's referred-users stream. A brand counts when its
   * OWNER was referred by this agency (`users.referredByAgencyId`) — the referral
   * lives on the user, never the brand. See docs/commissions.md.
   */
  referredBrands: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId);
      return ctx.db
        .selectDistinct({
          id: brands.id,
          businessName: brands.businessName,
          email: brands.email,
          logoUrl: brands.logoUrl,
          createdAt: brands.createdAt,
        })
        .from(brands)
        .innerJoin(users, eq(brands.ownerId, users.id))
        .where(eq(users.referredByAgencyId, input.agencyId))
        .orderBy(desc(brands.createdAt));
    }),

  /** Active (non-deleted) services for an agency catalog. */
  catalog: publicProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(services)
        .where(
          and(
            eq(services.agencyId, input.agencyId),
            isNull(services.deletedAt),
            eq(services.isActive, true),
          ),
        );
    }),

  /* ── Agency Stripe Connect (createAgencyStripeConnectAccount) ────────────── */

  /** Create (or reuse) the agency's Stripe Connect account + return an onboarding link. */
  createStripeConnectLink: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        country: z.string().length(2).default('AU'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      if (!stripe)
        return { url: null as string | null, accountId: null as string | null };
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND' });
      let accountId = agency.stripeAccountId ?? null;
      if (!accountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          email: agency.businessEmail ?? undefined,
          country: input.country,
          capabilities: { transfers: { requested: true } },
          business_type: 'company',
        });
        accountId = account.id;
        await ctx.db
          .update(agencies)
          .set({ stripeAccountId: accountId })
          .where(eq(agencies.id, input.agencyId));
      }
      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${ctx.clientOrigin}/agency-bank-account`,
        return_url: `${ctx.clientOrigin}/agency-bank-account`,
        type: 'account_onboarding',
      });
      return { url: link.url, accountId };
    }),

  /** Fetch the agency's Stripe Connect onboarding/payout status. */
  stripeAccountStatus: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      if (!agency?.stripeAccountId || !stripe) return null;
      try {
        const acct = await stripe.accounts.retrieve(agency.stripeAccountId);
        return {
          accountId: agency.stripeAccountId,
          chargesEnabled: acct.charges_enabled,
          payoutsEnabled: acct.payouts_enabled,
          detailsSubmitted: acct.details_submitted,
        };
      } catch {
        return null;
      }
    }),

  /* ── Agency payout methods (Wire) ────────────────────────────────────────────
   * Parity with the users router, but scoped to the AGENCY's own bank account —
   * the agency account receives agency/owner/sales commissions, distinct from a
   * member's personal account. Wise OAuth (getWiseAuthUrl/exchangeWiseCode) is
   * stateless and reused from the users router; only the linking/status calls
   * that write to the agency row live here. All gated by the `bankAccount` perm. */

  /**
   * Link a bank account for Wise (wire) payouts to the AGENCY: creates a Wise
   * recipient, stores its id on the agency, and marks it payout-ready. Mirrors
   * users.linkWiseRecipient. Works in dev without Wise (recipientId null).
   */
  linkWiseRecipient: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        accountHolderName: z.string().min(1),
        currency: z.string().nullable().optional(),
        bankName: z.string().optional(),
        accountNumber: z.string().optional(),
        routingNumber: z.string().nullable().optional(),
        swiftCode: z.string().nullable().optional(),
        country: z.string().optional(),
        accountType: z.string().nullable().optional(),
        address: z
          .object({
            firstLine: z.string().nullable().optional(),
            city: z.string().nullable().optional(),
            state: z.string().nullable().optional(),
            postCode: z.string().nullable().optional(),
            country: z.string().nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const { agencyId, ...details } = input;
      const recipientId = await createWiseRecipient(details);
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, agencyId))
          .limit(1)
      )[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND' });
      const existing = (agency.payoutMethods ?? {}) as Record<string, unknown>;
      const [updated] = await ctx.db
        .update(agencies)
        .set({
          activePayoutMethod: 'wire',
          bankAccountLinked: true,
          payoutMethods: { ...existing, wire: { ...details, recipientId } },
        })
        .where(eq(agencies.id, agencyId))
        .returning();
      return updated;
    }),

  /**
   * Set (or clear) the agency's active payout method. Mirrors users.setActivePayoutMethod.
   */
  setActivePayoutMethod: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        method: payoutMethodEnum.nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const [updated] = await ctx.db
        .update(agencies)
        .set({ activePayoutMethod: input.method })
        .where(eq(agencies.id, input.agencyId))
        .returning();
      return updated;
    }),

  /**
   * Remove/disconnect an agency payout method's details. If it was the active
   * method, the active flag is demoted to null. Wire/Stripe removal also clears
   * bankAccountLinked. Mirrors users.removePayoutMethod.
   */
  removePayoutMethod: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), method: payoutMethodEnum }))
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND' });
      const existing = {
        ...((agency.payoutMethods ?? {}) as Record<string, unknown>),
      };
      delete existing[input.method];
      const patch: Record<string, unknown> = { payoutMethods: existing };
      if (agency.activePayoutMethod === input.method)
        patch.activePayoutMethod = null;
      if (input.method === 'wire' || input.method === 'stripe')
        patch.bankAccountLinked = false;
      if (input.method === 'stripe') patch.stripeAccountId = null;
      const [updated] = await ctx.db
        .update(agencies)
        .set(patch)
        .where(eq(agencies.id, input.agencyId))
        .returning();
      return updated;
    }),

  /**
   * Save details for a single agency payout method (merge into payoutMethods
   * jsonb). Used for detail-only methods like PayPal (recipient email). Mirrors
   * users.savePayoutMethodDetails.
   */
  savePayoutMethodDetails: protectedProcedure
    .input(
      z.object({
        agencyId: z.string().uuid(),
        method: payoutMethodEnum,
        details: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertAgencyAccess(ctx, input.agencyId, 'bankAccount');
      const agency = (
        await ctx.db
          .select()
          .from(agencies)
          .where(eq(agencies.id, input.agencyId))
          .limit(1)
      )[0];
      if (!agency) throw new TRPCError({ code: 'NOT_FOUND' });
      const existing = (agency.payoutMethods ?? {}) as Record<string, unknown>;
      const [updated] = await ctx.db
        .update(agencies)
        .set({ payoutMethods: { ...existing, [input.method]: input.details } })
        .where(eq(agencies.id, input.agencyId))
        .returning();
      return updated;
    }),

  /* ── Super-admin agency toggles (explore / sales / default) ──────────────── */



  /** Toggle the sales-agency flag (can author proposals for other agencies). */
  setSalesAgency: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), value: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(agencies)
        .set({ isSalesAgency: input.value })
        .where(eq(agencies.id, input.id))
        .returning();
      return updated;
    }),

  /**
   * Mark/unmark this agency as a platform default. The platform supports
   * MULTIPLE default agencies (parity with Flutter's updateAgencyDefaultStatus +
   * admin_agency_table toggle, and recommendedAgenciesProvider which ranks the
   * full default set) — so this simply flips the flag and never clears others.
   * Mirrors superAdmin.setAgencyDefault; both are kept in sync.
   */
  setDefault: superAdminProcedure
    .input(z.object({ id: z.string().uuid(), value: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(agencies)
        .set({ platformVerified: input.value })
        .where(eq(agencies.id, input.id))
        .returning();
      return updated;
    }),
});

/**
 * File discipline-request rows for any disciplines that are not in the standard
 * (global-settings) list. Ports the custom-discipline loop in
 * createAgency/updateAgencyDetails.
 */
async function fileCustomDisciplineRequests(
  db: typeof import('../db/index.js').db,
  agencyId: string,
  disciplines: string[],
) {
  if (disciplines.length === 0) return;
  const gs = (
    await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1)
  )[0];
  const standard = new Set((gs?.disciplines ?? []).map((d) => d.toLowerCase()));
  const custom = disciplines.filter((d) => !standard.has(d.toLowerCase()));
  if (custom.length === 0) return;
  // Avoid duplicating an already-filed request for the same agency+discipline.
  const existing = await db
    .select({ discipline: disciplineRequests.discipline })
    .from(disciplineRequests)
    .where(eq(disciplineRequests.agencyId, agencyId));
  const filed = new Set(existing.map((e) => e.discipline.toLowerCase()));
  const toFile = custom.filter((d) => !filed.has(d.toLowerCase()));
  if (toFile.length === 0) return;
  const inserted = await db
    .insert(disciplineRequests)
    .values(toFile.map((discipline) => ({ discipline, agencyId })))
    .returning();
  // Notify super-admins of each new custom discipline request (on_discipline_request_written).
  for (const r of inserted)
    await onDisciplineRequested(
      { requestId: r.id, discipline: r.discipline },
      db,
    );
}
