import { z } from 'zod';
import { and, eq, isNull, ne, inArray, ilike } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc/trpc.js';
import { brands, userBrands, projects, brandAgencyConnections, staff, proposals, users, agencies, brandNotes } from '../db/schema.js';
import { assertBrandAccess } from '../trpc/permissions.js';
import { checkBusinessNameAvailable } from '../lib/business-name.js';
import { ensureDerivedAgency } from '../modules/agency/derive.js';
import { applyDefaultFormsToBrand } from '../modules/spot/provision.js';
import { ensureBrandAiThread } from '../modules/chat/threads.js';
import { recordLockerFiles, fileNameFromUrl } from '../modules/locker/record.js';
import { isSkillId, skillCatalog } from '../modules/ai/skills/index.js';
import { enabledFamilies, listFamilies } from '../modules/ai/providers/registry.js';
import type { ProviderFamily } from '../modules/ai/providers/types.js';
import { getDisabledFamilies } from '../modules/ai/provider-config.js';
import type { DB } from '../db/index.js';

/**
 * Mirror a brand's logo URLs into the document locker's Public Brand Assets.
 * Append-only: every logo ever uploaded is kept (deduped per url), so the
 * locker shows the full logo history. Best-effort.
 */
async function recordBrandLogos(db: DB, brandId: string, urls: string[]): Promise<void> {
  const clean = [...new Set(urls.filter((u) => typeof u === 'string' && u.startsWith('http')))];
  if (!clean.length) return;
  await recordLockerFiles(
    db,
    clean.map((url) => ({
      brandId,
      url,
      name: fileNameFromUrl(url, 'Logo'),
      isPublic: true,
      type: 'image',
      category: 'logo',
      source: 'brand',
      note: 'Uploaded as a brand logo',
      sourceType: 'logo' as const,
      sourceId: `${brandId}:${url}`,
    })),
  );
}

export const brandsRouter = router({
  // Brands the user can act as: those they OWN (userBrands) plus those they're
  // ACTIVE STAFF of (staff table). The innerJoin on staff.brandId naturally drops
  // agency-staff rows (null brandId). Deduped by id since a user may be both.
  mine: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [owned, staffed] = await Promise.all([
      ctx.db
        .select({ brand: brands })
        .from(userBrands)
        .innerJoin(brands, eq(userBrands.brandId, brands.id))
        .where(eq(userBrands.userId, userId)),
      ctx.db
        .select({ brand: brands, permissions: staff.permissions })
        .from(staff)
        .innerJoin(brands, eq(staff.brandId, brands.id))
        .where(and(eq(staff.userId, userId), eq(staff.status, 'active'))),
    ]);
    // Each brand carries the caller's access to it — `isOwner` (owners bypass all
    // permission checks) and the granular staff `permissions`. This lets a
    // brand-only frontend hide brands where a staffer holds NONE of that tool's
    // permissions, and re-select when one is revoked (see useActiveContext /
    // useEnsureBrandContext `appPermissions`). `isOwner` must mirror what the
    // permission checks enforce (`assertBrandAccess` tests brands.ownerId) — a
    // userBrands row alone is NOT ownership (stray non-owner rows exist, e.g. from
    // the SIGKITT import), so deriving isOwner from it would light up manage UIs
    // the backend then rejects. Keep the staff row's permissions either way.
    type BrandAccess = typeof brands.$inferSelect & { isOwner: boolean; permissions: string[] };
    const byId = new Map<string, BrandAccess>();
    for (const { brand, permissions } of staffed)
      byId.set(brand.id, { ...brand, isOwner: brand.ownerId === userId, permissions: permissions ?? [] });
    for (const { brand } of owned) {
      const prev = byId.get(brand.id);
      byId.set(brand.id, { ...brand, isOwner: brand.ownerId === userId, permissions: prev?.permissions ?? [] });
    }
    // Alphabetical — every frontend's brand switcher renders this list as-is.
    return [...byId.values()].sort((a, b) =>
      a.businessName.localeCompare(b.businessName, undefined, { sensitivity: 'base' }),
    );
  }),

  /** Stat-card counts for the brand dashboard (active projects, pending actions, team, agencies). */
  dashboardStats: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const b = input.brandId;
      const [activeProjects, connectedAgencies, teamMembers, pendingProposals, clientApprovalProjects] = await Promise.all([
        ctx.db.$count(projects, and(eq(projects.brandId, b), ne(projects.status, 'completed'), isNull(projects.deletedAt))),
        ctx.db.$count(brandAgencyConnections, eq(brandAgencyConnections.brandId, b)),
        ctx.db.$count(staff, and(eq(staff.brandId, b), eq(staff.status, 'active'))),
        ctx.db.$count(proposals, and(eq(proposals.brandId, b), inArray(proposals.status, ['sent', 'viewed']))),
        ctx.db.$count(projects, and(eq(projects.brandId, b), eq(projects.status, 'clientApproval'), isNull(projects.deletedAt))),
      ]);
      return {
        activeProjects,
        connectedAgencies,
        teamMembers,
        // Pending actions = unanswered proposals + projects awaiting client approval.
        pendingActions: pendingProposals + clientApprovalProjects,
      };
    }),

  byId: publicProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    return (await ctx.db.select().from(brands).where(eq(brands.id, input.id)).limit(1))[0] ?? null;
  }),

  /**
   * Live business-name availability for the create/edit-brand forms. The name is
   * unique across the shared brand+agency namespace (see checkBusinessNameAvailable):
   * a name used by a brand OR a standalone agency is unavailable.
   */
  checkBusinessName: protectedProcedure
    .input(
      z.object({
        businessName: z.string().trim(),
        excludeBrandId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      return checkBusinessNameAvailable(ctx.db, input.businessName, {
        excludeBrandId: input.excludeBrandId,
      });
    }),

  /**
   * Ensure the brand's dedicated AI assistant thread exists and return its id
   * (brands.chatbotThreadId). Idempotent — safe for brands created before the AI
   * thread feature (legacy rows have a null chatbotThreadId). Used by the dashboard
   * Growth Strategy app to open the chat.
   */
  ensureAiThread: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const threadId = await ensureBrandAiThread(input.brandId, ctx.db);
      return { threadId: threadId ?? null };
    }),

  /**
   * Create a brand profile, link it to the current user, set their role to
   * brandOwner (only if they have no role yet — never downgrade), and select it.
   * `id` supports the referral path (the brand id == the referral token id);
   * `referralToken` carries the originating referral for attribution. Ports
   * brand_controller.dart:createBrand.
   */
  create: protectedProcedure
    .input(
      z.object({
        businessName: z.string().trim().min(1),
        legalName: z.string().trim().optional(),
        email: z.string().trim().email().optional(),
        website: z.string().trim().url().optional().or(z.literal('')),
        phone: z.string().trim().optional(),
        id: z.string().uuid().optional(),
        referralToken: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Business name is unique across the shared brand+agency namespace.
      const nameCheck = await checkBusinessNameAvailable(ctx.db, input.businessName);
      if (!nameCheck.available) throw new TRPCError({ code: 'CONFLICT', message: nameCheck.reason! });

      const [brand] = await ctx.db
        .insert(brands)
        .values({
          ...(input.id ? { id: input.id } : {}),
          ownerId: ctx.user.id,
          businessName: input.businessName,
          legalName: input.legalName || undefined,
          email: input.email || undefined,
          website: input.website || undefined,
          phone: input.phone || undefined,
          referralToken: input.referralToken,
        })
        .returning();
      await ctx.db.insert(userBrands).values({ userId: ctx.user.id, brandId: brand.id }).onConflictDoNothing();
      // Set role → brandOwner and select the new brand. Don't clobber an existing role.
      await ctx.db
        .update(users)
        .set({ selectedBrandId: brand.id, ...(ctx.user.role ? {} : { role: 'brandOwner' as const }) })
        .where(eq(users.id, ctx.user.id));
      // Seed the global admin default Info Hub sections onto the new brand.
      await applyDefaultFormsToBrand({ brandId: brand.id }, ctx.db);
      // Auto-create the brand's shadow agency (one per brand). Best-effort: never
      // block brand creation on it — the backfill script reconciles any gaps.
      await ensureDerivedAgency(ctx.db, brand).catch((e) => {
        console.error('[brands] derived agency creation failed', (e as Error).message);
      });
      // Create the brand's dedicated AI assistant thread (best-effort: never
      // block brand creation on it). Stamps brands.chatbotThreadId.
      const aiThreadId = await ensureBrandAiThread(brand.id, ctx.db).catch((e) => {
        console.error('[brands] AI thread creation failed', (e as Error).message);
        return null;
      });
      return { ...brand, chatbotThreadId: aiThreadId ?? null };
    }),

  /**
   * Update editable brand fields. Covers Brand Guidelines (colors / logoUrls /
   * typography / toneOfVoice / keyMessaging) and the Business Info / Update Brand
   * Profile forms (businessName / website / phone / contact + industry meta).
   * Ports brand_controller.dart:updateBrand.
   */
  update: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        businessName: z.string().min(1).optional(),
        legalName: z.string().optional(),
        email: z.string().email().optional().or(z.literal('')),
        contactName: z.string().optional(),
        website: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        abn: z.string().optional(),
        industry: z.string().optional(),
        yearFounded: z.string().optional(),
        targetAudience: z.string().optional(),
        competitors: z.string().optional(),
        usp: z.string().optional(),
        brandValues: z.string().optional(),
        toneOfVoice: z.string().optional(),
        keyMessaging: z.string().optional(),
        colors: z.array(z.string()).optional(),
        logoUrls: z.array(z.string()).optional(),
        typography: z.array(z.string()).optional(),
        // Company Info additions
        policies: z
          .array(z.object({ id: z.string(), title: z.string().trim().min(1), body: z.string().trim() }))
          .optional(),
        locations: z
          .array(
            z.object({
              id: z.string(),
              label: z.string().trim(),
              address: z.string().trim(),
              placeId: z.string().optional(),
              lat: z.number().optional(),
              lng: z.number().optional(),
              hours: z.string().optional(),
              phone: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'brandGuidelines');
      if (input.businessName !== undefined) {
        const nameCheck = await checkBusinessNameAvailable(ctx.db, input.businessName, {
          excludeBrandId: input.brandId,
        });
        if (!nameCheck.available) throw new TRPCError({ code: 'CONFLICT', message: nameCheck.reason! });
      }
      const { brandId, email, ...rest } = input;
      const [updated] = await ctx.db
        .update(brands)
        .set({ ...rest, ...(email !== undefined ? { email: email || null } : {}) })
        .where(eq(brands.id, brandId))
        .returning();
      // Keep the derived shadow agency's name in sync with the brand.
      if (input.businessName !== undefined && updated.derivedToAgencyId) {
        await ctx.db
          .update(agencies)
          .set({ businessName: updated.businessName })
          .where(eq(agencies.id, updated.derivedToAgencyId));
      }
      if (input.logoUrls?.length) await recordBrandLogos(ctx.db, brandId, input.logoUrls);
      return updated;
    }),

  /**
   * Append (or replace) a logo URL after the client uploads it to storage. The
   * primary `logoUrl` mirrors the first entry for list/identity rendering.
   * Ports brand_controller.dart logo upload persistence.
   */
  updateLogo: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), logoUrls: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'brandGuidelines');
      const [updated] = await ctx.db
        .update(brands)
        .set({ logoUrls: input.logoUrls, logoUrl: input.logoUrls[0] ?? null })
        .where(eq(brands.id, input.brandId))
        .returning();
      await recordBrandLogos(ctx.db, input.brandId, input.logoUrls);
      return updated;
    }),

  /**
   * Search brands by (partial) business name — backs the New-Project brand
   * picker (ports brand_repository.searchBrands). Scoped to brands either whose
   * OWNER was referred by this agency (referral lives on the user, never the brand)
   * or already connected to it. Platform-verified agencies can search all brands.
   */
  searchByName: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), query: z.string().min(2) }))
    .query(async ({ ctx, input }) => {
      const q = `%${input.query}%`;

      const agency = await ctx.db
        .select({ platformVerified: agencies.platformVerified })
        .from(agencies)
        .where(eq(agencies.id, input.agencyId))
        .limit(1)
        .then((r) => r[0]);

      if (agency?.platformVerified) {
        return ctx.db
          .select({ id: brands.id, businessName: brands.businessName, email: brands.email, logoUrl: brands.logoUrl })
          .from(brands)
          .where(ilike(brands.businessName, q))
          .limit(20);
      }

      // Brands whose owner was referred by this agency (users.referredByAgencyId).
      const referred = await ctx.db
        .select({ id: brands.id, businessName: brands.businessName, email: brands.email, logoUrl: brands.logoUrl })
        .from(brands)
        .innerJoin(users, eq(brands.ownerId, users.id))
        .where(and(ilike(brands.businessName, q), eq(users.referredByAgencyId, input.agencyId)))
        .limit(10);
      // Brands connected to this agency.
      const connected = await ctx.db
        .select({ id: brands.id, businessName: brands.businessName, email: brands.email, logoUrl: brands.logoUrl })
        .from(brands)
        .innerJoin(brandAgencyConnections, eq(brandAgencyConnections.brandId, brands.id))
        .where(and(ilike(brands.businessName, q), eq(brandAgencyConnections.agencyId, input.agencyId)))
        .limit(10);
      const seen = new Set<string>();
      return [...referred, ...connected].filter((b) => (seen.has(b.id) ? false : (seen.add(b.id), true)));
    }),

  /**
   * Create a placeholder brand for an agency so it can be referenced as a
   * project/proposal `brandId` before the real owner claims it. The current
   * (agency) user is the placeholder owner — their role/selection is NOT touched
   * (unlike `create`). No agency referral is stamped on the brand: a referral only
   * ever lives on the eventual owner's user (users.referredByAgencyId), set when
   * they sign up / claim via the agency's `?ref=` link. See docs/commissions.md.
   */
  createReferral: protectedProcedure
    .input(z.object({ agencyId: z.string().uuid(), businessName: z.string().trim().min(1), email: z.string().trim().email().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [brand] = await ctx.db
        .insert(brands)
        .values({
          ownerId: ctx.user.id,
          businessName: input.businessName,
          email: input.email || undefined,
        })
        .returning({ id: brands.id, businessName: brands.businessName, email: brands.email, logoUrl: brands.logoUrl });
      return brand;
    }),

  /** Look up brands by exact/partial email (claim-brand & referral lookup). */
  searchBrandsByEmail: protectedProcedure
    .input(z.object({ email: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select({ id: brands.id, businessName: brands.businessName, email: brands.email, logoUrl: brands.logoUrl, ownerId: brands.ownerId })
        .from(brands)
        .where(ilike(brands.email, `%${input.email}%`))
        .limit(10);
    }),

  /**
   * Claim a brand that was pre-created (e.g. an agency referral / brand_referral)
   * by linking the current user and promoting them to owner. Only allowed when
   * the brand has no real owner-membership yet. Ports the brand-claim flow.
   */
  claimBrand: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const brand = (await ctx.db.select().from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
      if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
      const existing = await ctx.db
        .select({ userId: userBrands.userId })
        .from(userBrands)
        .where(eq(userBrands.brandId, input.brandId));
      if (existing.length > 0 && !existing.some((m) => m.userId === ctx.user.id)) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Brand already claimed' });
      }
      await ctx.db.insert(userBrands).values({ userId: ctx.user.id, brandId: input.brandId }).onConflictDoNothing();
      await ctx.db.update(brands).set({ ownerId: ctx.user.id }).where(eq(brands.id, input.brandId));
      await ctx.db
        .update(users)
        .set({ selectedBrandId: input.brandId, ...(ctx.user.role ? {} : { role: 'brandOwner' as const }) })
        .where(eq(users.id, ctx.user.id));
      return brand;
    }),

  /** Toggle a service in the brand's favourites list (marketplace heart). */
  toggleFavouriteService: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), serviceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const brand = (await ctx.db.select({ fav: brands.favouriteServiceIds }).from(brands).where(eq(brands.id, input.brandId)).limit(1))[0];
      const current = brand?.fav ?? [];
      const next = current.includes(input.serviceId)
        ? current.filter((id) => id !== input.serviceId)
        : [...current, input.serviceId];
      const [updated] = await ctx.db
        .update(brands)
        .set({ favouriteServiceIds: next })
        .where(eq(brands.id, input.brandId))
        .returning({ favouriteServiceIds: brands.favouriteServiceIds });
      return updated;
    }),

  /** Get brand notepad content (1-to-1 with brand). */
  getNote: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .select({
          content: brandNotes.content,
          updatedAt: brandNotes.updatedAt,
        })
        .from(brandNotes)
        .where(eq(brandNotes.brandId, input.brandId))
        .limit(1);
      return row ?? { content: '', updatedAt: new Date() };
    }),

  /** Save / update brand notepad content. */
  updateNote: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        content: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .insert(brandNotes)
        .values({
          brandId: input.brandId,
          content: input.content,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: brandNotes.brandId,
          set: {
            content: input.content,
            updatedAt: new Date(),
          },
        })
        .returning({
          content: brandNotes.content,
          updatedAt: brandNotes.updatedAt,
        });
      return row;
    }),

  /** Get the brand's standing AI context (1-to-1 with brand). */
  getContext: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .select({
          context: brandNotes.context,
          updatedAt: brandNotes.updatedAt,
        })
        .from(brandNotes)
        .where(eq(brandNotes.brandId, input.brandId))
        .limit(1);
      return row ?? { context: '', updatedAt: new Date() };
    }),

  /** Save / update the brand's standing AI context. */
  updateContext: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        context: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .insert(brandNotes)
        .values({
          brandId: input.brandId,
          context: input.context,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: brandNotes.brandId,
          set: {
            context: input.context,
            updatedAt: new Date(),
          },
        })
        .returning({
          context: brandNotes.context,
          updatedAt: brandNotes.updatedAt,
        });
      return row;
    }),

  /** List the brand's AI skills, each with its enabled state (for the checklist). */
  getSkills: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .select({ disabledSkills: brandNotes.disabledSkills })
        .from(brandNotes)
        .where(eq(brandNotes.brandId, input.brandId))
        .limit(1);
      return { skills: skillCatalog(row?.disabledSkills) };
    }),

  /** Switch one AI skill on/off for the brand's assistant. We persist the set of
   *  DISABLED ids, so every skill is on until explicitly turned off. */
  setSkillEnabled: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        skillId: z.string(),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      if (!isSkillId(input.skillId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown skill' });
      }
      const [row] = await ctx.db
        .select({ disabledSkills: brandNotes.disabledSkills })
        .from(brandNotes)
        .where(eq(brandNotes.brandId, input.brandId))
        .limit(1);
      const disabled = new Set(row?.disabledSkills ?? []);
      if (input.enabled) disabled.delete(input.skillId);
      else disabled.add(input.skillId);
      const next = [...disabled];
      await ctx.db
        .insert(brandNotes)
        .values({ brandId: input.brandId, disabledSkills: next, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: brandNotes.brandId,
          set: { disabledSkills: next, updatedAt: new Date() },
        });
      return { skills: skillCatalog(next) };
    }),

  /**
   * The brand's AI provider choice + the enabled options. `showPicker` is only
   * true when more than one family is enabled — the UI hides the selector when
   * there's nothing to choose. `selected` is coerced to an enabled family so a
   * stale choice (super-admin disabled it) still resolves sensibly.
   */
  getAiProvider: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const [row] = await ctx.db
        .select({ selected: brandNotes.selectedAiProvider })
        .from(brandNotes)
        .where(eq(brandNotes.brandId, input.brandId))
        .limit(1);
      const enabled = enabledFamilies(await getDisabledFamilies(ctx.db));
      const options = listFamilies().filter((f) => enabled.includes(f.family));
      const chosen = row?.selected as ProviderFamily | null | undefined;
      const selected = chosen && enabled.includes(chosen) ? chosen : enabled[0] ?? null;
      return { selected, options, showPicker: options.length > 1 };
    }),

  /** Set the brand's AI provider family (must be one the super-admin left enabled). */
  setAiProvider: protectedProcedure
    .input(z.object({ brandId: z.string().uuid(), provider: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId);
      const enabled = enabledFamilies(await getDisabledFamilies(ctx.db));
      if (!enabled.includes(input.provider as ProviderFamily)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That AI provider is not available.' });
      }
      await ctx.db
        .insert(brandNotes)
        .values({ brandId: input.brandId, selectedAiProvider: input.provider, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: brandNotes.brandId,
          set: { selectedAiProvider: input.provider, updatedAt: new Date() },
        });
      return { selected: input.provider };
    }),
});
