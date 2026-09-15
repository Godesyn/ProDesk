import { z } from 'zod';
import { and, eq, ilike, or, isNull, count, asc, inArray, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc/trpc.js';
import { services, agencies, packages, brands, globalSettings, purchases, projects, users } from '../db/schema.js';
import { assertBrandAccess, assertBrandViewAccess } from '../trpc/permissions.js';
import { paginationInput, page } from '../lib/pagination.js';

/**
 * Stage label → framework order index, read from the admin-edited Infin8
 * taxonomy in globalSettings (the single source of truth). Used to order the
 * marketplace's stage groupings the same way agencies/services are taxonomised,
 * so the keys here always match each service's stored `stage` label.
 */
async function stageOrderMap(db: typeof import('../db/index.js').db): Promise<Map<string, number>> {
  const row = (await db.select({ s: globalSettings.infin8Stages }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
  return new Map((row?.s ?? []).map((g, i) => [g.stage, i]));
}

/**
 * agencies. Shared by the services browse and the
 * agencies storefront so both honour the same referred/default visibility rule
 * as the Flutter marketplace (SubdomainDetector.referredByAgency). The referral
 * lives on the brand OWNER's user (users.referredByAgencyId), never the brand.
 */
async function referredContext(db: typeof import('../db/index.js').db, brandId?: string) {
  if (!brandId) return { referredAgencyId: null as string | null };
  const brand = (await db.select({ ownerId: brands.ownerId }).from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  const owner = brand?.ownerId
    ? (await db.select({ ref: users.referredByAgencyId }).from(users).where(eq(users.id, brand.ownerId)).limit(1))[0]
    : null;
  const referredAgencyId = owner?.ref ?? null;
  return { referredAgencyId };
}

export const marketplaceRouter = router({
  /** The Infin8 stage → substage framework taxonomy (dynamic, from globalSettings). */
  framework: publicProcedure.query(async ({ ctx }) => {
    const row = (await ctx.db.select({ s: globalSettings.infin8Stages }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
    return row?.s ?? [];
  }),

  /** Platform disciplines, for the marketplace discipline filter dropdown. */
  disciplines: publicProcedure.query(async ({ ctx }) => {
    const row = (await ctx.db.select({ d: globalSettings.disciplines }).from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
    return row?.d ?? [];
  }),

  /**
   * Browse active, buyable services across verified agencies (the infin8
   * marketplace), grouped by the 8-stage framework. Honors referred-agency /
   * the default ("verified") agency's services first. Competitors are always
   * silently dropped for referred brands.
   *
   * Returns the flat paginated rows (for search/grid views) PLUS a `stages`
   * roll-up so the client can render the stage → sub-stage grouped grid without
   * a second round-trip.
   */
  browse: publicProcedure
    .input(
      paginationInput.extend({
        // The grouped stage/sub-stage grid renders the whole visible catalogue in
        // one page, so browse allows a larger limit than the shared default cap.
        limit: z.number().int().min(1).max(500).default(20),
        discipline: z.string().optional(),
        stage: z.string().optional(),
        subStage: z.string().optional(),
        agencyId: z.string().uuid().optional(),
        /** When set, scopes referred/default visibility to this brand. */
        brandId: z.string().uuid().optional(),
        sort: z.enum(['custom', 'priceAsc', 'priceDesc', 'name', 'newest']).default('custom'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const filters = [
        isNull(services.deletedAt),
        eq(services.isActive, true),
        eq(services.allowBuyNow, true),
        eq(agencies.emailVerified, true),
      ];
      if (input.search) {
        filters.push(
          or(
            ilike(services.name, `%${input.search}%`),
            ilike(services.description, `%${input.search}%`),
            ilike(agencies.businessName, `%${input.search}%`),
          )!,
        );
      }
      if (input.discipline) filters.push(sql`${input.discipline} = ANY(${services.disciplines})`);
      if (input.stage) filters.push(eq(services.stage, input.stage));
      if (input.subStage) filters.push(eq(services.subStage, input.subStage));
      if (input.agencyId) filters.push(eq(services.agencyId, input.agencyId));

      // Referred / default agency visibility (ports marketplace_infin8_view.dart).
      // The brand sees ONLY its referred agency's services plus the platform
      // default agency's services. Competitors are silently dropped.
      // With no referred agency, the view is the default agency alone.
      let referredAgencyId: string | null = null;
      if (input.brandId && !input.agencyId) {
        const ref = await referredContext(ctx.db, input.brandId);
        referredAgencyId = ref.referredAgencyId;
        filters.push(
          referredAgencyId
            ? or(eq(agencies.platformVerified, true), eq(services.agencyId, referredAgencyId))!
            : eq(agencies.platformVerified, true),
        );
      }

      const where = and(...filters);

      const orderBy = (() => {
        switch (input.sort) {
          case 'priceAsc':
            return [asc(services.price), asc(services.name)];
          case 'priceDesc':
            return [sql`${services.price} desc nulls last`, asc(services.name)];
          case 'name':
            return [asc(services.name)];
          case 'newest':
            return [sql`${services.createdAt} desc`];
          default:
            // Custom order: referred agency first, then the default agency, then
            // each agency's own sort order / name (matches the Flutter sort).
            return [
              ...(referredAgencyId ? [sql`case when ${services.agencyId} = ${referredAgencyId} then 0 else 1 end`] : []),
              sql`case when ${agencies.platformVerified} then 0 else 1 end`,
              asc(services.sortOrder),
              asc(services.name),
            ];
        }
      })();

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({
            service: services,
            agencyName: agencies.businessName,
            agencyLogo: agencies.logoUrl,
            agencyPlatformVerified: agencies.platformVerified,
          })
          .from(services)
          .innerJoin(agencies, eq(services.agencyId, agencies.id))
          .where(where)
          .orderBy(...orderBy)
          .limit(input.limit)
          .offset(input.offset),
        ctx.db.select({ value: count() }).from(services).innerJoin(agencies, eq(services.agencyId, agencies.id)).where(where),
      ]);

      const items = rows.map((r) => ({
        ...r.service,
        agencyName: r.agencyName,
        agencyLogo: r.agencyLogo,
        isReferredAgency: referredAgencyId != null && r.service.agencyId === referredAgencyId,
        isPlatformVerifiedAgency: r.agencyPlatformVerified,
      }));

      // Build a stage → sub-stage roll-up of the visible page for the grouped
      // grid. Stages follow the fixed framework order; unknown stages sort last.
      const byStage = new Map<string, typeof items>();
      for (const it of items) {
        const key = it.stage ?? 'Other';
        if (!byStage.has(key)) byStage.set(key, []);
        byStage.get(key)!.push(it);
      }
      const order = await stageOrderMap(ctx.db);
      const stages = [...byStage.entries()]
        .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
        .map(([stage, svcs]) => {
          const subStages = new Map<string, typeof items>();
          for (const s of svcs) {
            const sk = s.subStage ?? 'Other';
            if (!subStages.has(sk)) subStages.set(sk, []);
            subStages.get(sk)!.push(s);
          }
          return {
            stage,
            count: svcs.length,
            subStages: [...subStages.entries()].map(([subStage, list]) => ({ subStage, services: list })),
          };
        });

      return { ...page(items, total, input), stages, referredAgencyId };
    }),

  /** Full detail for a single service (variants / options / add-ons / gallery). */
  serviceById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const row = (
      await ctx.db
        .select({ service: services, agencyName: agencies.businessName, agencyLogo: agencies.logoUrl })
        .from(services)
        .innerJoin(agencies, eq(services.agencyId, agencies.id))
        .where(and(eq(services.id, input.id), isNull(services.deletedAt)))
        .limit(1)
    )[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
    return { ...row.service, agencyName: row.agencyName, agencyLogo: row.agencyLogo };
  }),

  /** Active "Featured Packages" across verified agencies (optionally one agency). */
  packages: publicProcedure
    .input(z.object({ agencyId: z.string().uuid().optional(), search: z.string().optional(), limit: z.number().int().min(1).max(200).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      const filters = [isNull(packages.deletedAt), eq(packages.isActive, true), eq(packages.allowBuyNow, true), eq(agencies.emailVerified, true)];
      if (input?.agencyId) filters.push(eq(packages.agencyId, input.agencyId));
      if (input?.search) filters.push(or(ilike(packages.name, `%${input.search}%`), ilike(agencies.businessName, `%${input.search}%`))!);
      const rows = await ctx.db
        .select({ pkg: packages, agencyName: agencies.businessName, agencyLogo: agencies.logoUrl })
        .from(packages)
        .innerJoin(agencies, eq(packages.agencyId, agencies.id))
        .where(and(...filters))
        .orderBy(asc(packages.sortOrder), asc(packages.name))
        .limit(input?.limit ?? 20);
      return rows.map((r) => ({ ...r.pkg, agencyName: r.agencyName, agencyLogo: r.agencyLogo }));
    }),

  /** Resolve a package's component services (for the cart / detail dialog). */
  packageById: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const pkg = (await ctx.db.select().from(packages).where(eq(packages.id, input.id)).limit(1))[0];
    if (!pkg) throw new TRPCError({ code: 'NOT_FOUND' });
    // Items carry the agency's pre-configured variant/options/add-ons per
    // service (set in the package builder) — these flow through to the cart /
    // checkout so the buyer gets exactly what the package author configured.
    type PkgItem = {
      serviceId?: string;
      quantity?: number;
      selectedVariantId?: string;
      selectedOptions?: Record<string, string>;
      selectedAddons?: unknown[];
    };
    const items = (pkg.items ?? []) as PkgItem[];
    const serviceIds = items.map((i) => i.serviceId).filter(Boolean) as string[];
    const svcRows = serviceIds.length ? await ctx.db.select().from(services).where(inArray(services.id, serviceIds)) : [];
    const byId = new Map(svcRows.map((s) => [s.id, s]));
    return {
      ...pkg,
      services: items
        .map((i) =>
          i.serviceId
            ? {
                service: byId.get(i.serviceId),
                quantity: i.quantity ?? 1,
                selectedVariantId: i.selectedVariantId ?? null,
                selectedOptions: i.selectedOptions ?? {},
                selectedAddons: i.selectedAddons ?? [],
              }
            : null,
        )
        .filter(
          (x): x is { service: NonNullable<ReturnType<typeof byId.get>>; quantity: number; selectedVariantId: string | null; selectedOptions: Record<string, string>; selectedAddons: unknown[] } =>
            !!x && !!x.service,
        ),
    };
  }),

  /**
   * Verified agencies storefront listing (the "Agencies" browse view). Honours
   * referred/default visibility exactly like `browse` (ports
   * marketplace_agencies_view.dart): the brand sees only the default agencies +
   * its referred agency, ordered referred-first then default-first then
   * alphabetical. `platformVerified`/`isReferredAgency` drive the verified badge
   * + ordering on the cards.
   */
  agencies: publicProcedure
    .input(paginationInput.extend({ brandId: z.string().uuid().optional() }))
    .query(async ({ ctx, input }) => {
      const lim = input.limit ?? 50;
      const off = input.offset ?? 0;
      const filters = [eq(agencies.emailVerified, true)];
      if (input.search) filters.push(ilike(agencies.businessName, `%${input.search}%`));

      const { referredAgencyId } = await referredContext(ctx.db, input.brandId);
      if (input.brandId) {
        filters.push(
          referredAgencyId ? or(eq(agencies.platformVerified, true), eq(agencies.id, referredAgencyId))! : eq(agencies.platformVerified, true),
        );
      }
      const where = and(...filters);

      const orderBy = [
        ...(referredAgencyId ? [sql`case when ${agencies.id} = ${referredAgencyId} then 0 else 1 end`] : []),
        sql`case when ${agencies.platformVerified} then 0 else 1 end`,
        asc(agencies.businessName),
      ];

      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ agency: agencies, serviceCount: count(services.id) })
          .from(agencies)
          .leftJoin(services, and(eq(services.agencyId, agencies.id), isNull(services.deletedAt), eq(services.isActive, true)))
          .where(where)
          .groupBy(agencies.id)
          .orderBy(...orderBy)
          .limit(lim)
          .offset(off),
        ctx.db.select({ value: count() }).from(agencies).where(where),
      ]);
      const items = rows.map((r) => ({
        id: r.agency.id,
        businessName: r.agency.businessName,
        logoUrl: r.agency.logoUrl,
        shortDescription: r.agency.shortDescription,
        disciplines: r.agency.disciplines,
        emailVerified: r.agency.emailVerified,
        platformVerified: r.agency.platformVerified,
        isReferredAgency: referredAgencyId != null && r.agency.id === referredAgencyId,
        serviceCount: r.serviceCount,
      }));
      return { ...page(items, total, { limit: lim, offset: off }), referredAgencyId };
    }),

  /** Active payment plans (from global settings) for the checkout chips. */
  paymentPlans: publicProcedure.query(async ({ ctx }) => {
    const settings = (await ctx.db.select().from(globalSettings).where(eq(globalSettings.id, 1)).limit(1))[0];
    const plans = (settings?.defaultPaymentPlans ?? []) as PaymentPlanConfig[];
    return plans.filter((p) => p.isActive !== false);
  }),

  /* ── Favourites (brands.favouriteServiceIds) ─────────────────────────────── */

  /** The brand's favourite service ids. */
  favourites: protectedProcedure.input(z.object({ brandId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertBrandAccess(ctx, input.brandId);
    const brand = (await ctx.db.select({ ids: brands.favouriteServiceIds }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
    return brand?.ids ?? [];
  }),

  /**
   * Toggle a service in the brand's favourites. Returns the resulting id list.
   * (Brand-owned `favouriteServiceIds` column lives on the brands table, edited
   * here rather than in brands.ts to keep marketplace concerns together.)
   */
  toggleFavourite: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), serviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const brand = (await ctx.db.select({ ids: brands.favouriteServiceIds }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
      if (!brand) throw new TRPCError({ code: 'NOT_FOUND' });
      const current = brand.ids ?? [];
      const next = current.includes(input.serviceId)
        ? current.filter((id) => id !== input.serviceId)
        : [...current, input.serviceId];
      await ctx.db.update(brands).set({ favouriteServiceIds: next, updatedAt: new Date() }).where(eq(brands.id, input.brandId));
      return next;
    }),

  /**
   * Post-checkout brief polling: returns the purchase status plus the projects
   * spawned for it that still need a client brief (status `clientBrief`). The
   * post-checkout stepper polls this until the purchase is `completed`, then
   * walks the buyer through each project's custom fields. Ports the
   * `purchaseStatusProvider` + project-fetch loop in post_checkout_stepper_screen.dart.
   */
  briefProjects: protectedProcedure.input(z.object({ purchaseId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const purchase = (await ctx.db.select().from(purchases).where(eq(purchases.id, input.purchaseId)).limit(1))[0];
    // This is a poll-until-ready endpoint: the buyer lands on /payment-success
    // (or the brief stepper) and polls every ~1.5s. A just-created purchase can
    // momentarily not be readable (Stripe redirect / webhook-fulfilment timing),
    // so treat a missing row as "still being set up" rather than throwing a hard
    // NOT_FOUND that spams the logs and stalls the poll.
    if (!purchase) return { status: 'pendingPayment', ready: false, projects: [] as { id: string; serviceName: string | null; fields: unknown[] }[] };
    // The buyer can always poll their own purchase's brief — including when they
    // bought on behalf of a connected brand as an agency (storefront/marketplace),
    // where they are NOT brand owner/staff. Only gate OTHER viewers, and allow the
    // brand-or-connected-agency identities (assertBrandViewAccess), not brand-only.
    if (purchase.userId !== ctx.user.id && purchase.brandId) {
      await assertBrandViewAccess(ctx, purchase.brandId);
    }
    const projectRows = await ctx.db
      .select({ id: projects.id, serviceName: projects.serviceName, status: projects.status, customFieldResponses: projects.customFieldResponses })
      .from(projects)
      .where(eq(projects.purchaseId, input.purchaseId));
    return {
      status: purchase.status,
      ready: purchase.status === 'completed' || projectRows.length > 0,
      projects: projectRows
        .filter((p) => p.status === 'clientBrief')
        .map((p) => ({ id: p.id, serviceName: p.serviceName, fields: (p.customFieldResponses ?? []) as unknown[] })),
    };
  }),

  /** Full service rows for the favourites view. */
  favouriteServices: protectedProcedure.input(z.object({ brandId: z.string().uuid() })).query(async ({ ctx, input }) => {
    await assertBrandAccess(ctx, input.brandId);
    const brand = (await ctx.db.select({ ids: brands.favouriteServiceIds }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
    const ids = (brand?.ids ?? []).filter(Boolean);
    if (!ids.length) return [];
    const rows = await ctx.db
      .select({ service: services, agencyName: agencies.businessName, agencyLogo: agencies.logoUrl })
      .from(services)
      .innerJoin(agencies, eq(services.agencyId, agencies.id))
      .where(and(inArray(services.id, ids), isNull(services.deletedAt)));
    return rows.map((r) => ({ ...r.service, agencyName: r.agencyName, agencyLogo: r.agencyLogo }));
  }),
});

/** Shape of a global-settings payment plan (PaymentPlanConfigModel). */
export interface PaymentPlanConfig {
  id?: string;
  name: string;
  upfrontPercentage: number;
  interestRate?: number;
  durationWeeks: number;
  isActive?: boolean;
}
