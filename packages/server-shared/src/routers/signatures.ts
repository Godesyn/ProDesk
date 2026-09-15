/**
 * Signatures (SIGKITT) tRPC router — brand-scoped email-signature builder
 * migrated from the Manus "email-signature-builder" export. Ported from
 * server/routers.ts and rewired to our auth/context/tenancy: the Manus
 * single-shared-team model (all @noize.com.au users under one team user) is
 * replaced by our brand context — every signature brand/member/campaign/event
 * belongs to a Prodesk `brands` row. Member roles → the staff `signatures`
 * permission (single MANAGE role — signatures has no viewer permission; the
 * old `signaturesViewer` enum value was removed in migration 0057); the Forge
 * presigned-S3 upload → Supabase
 * Storage (modules/signatures/storage); the Forge icon PNG cache → sharp
 * (modules/signatures/iconColorizer). Creating signature brands is gated by a
 * brand-level Feature Subscription with a free trial (modules/signatures/billing).
 *
 * Naming: `brandId` always means the Prodesk tenant brand; `signatureBrandId`
 * means a signature brand-kit entity. Nested resources resolve their tenant
 * brand from the entity so the client only passes the entity id.
 */
import { TRPCError } from '@trpc/server';
import { and, asc, count, countDistinct, desc, eq, gte, isNull, lte, or, ne, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  featureSubscriptionProducts,
  featureSubscriptions,
  signatureAnalyticsEvents,
  brands,
  brandKits,
  signatureCampaignBanners,
  signatureCampaigns,
  signatureMembers,
  savedSignatures,
  staff,
} from '../db/schema.js';
import {
  combineBrandKit,
  loadCombinedBrandKit,
  loadCombinedBrandKitById,
  loadCombinedBrandKitReadOnly,
  splitBrandKitUpdate,
} from '../modules/signatures/brand-kit-view.js';
import {
  listSignatureMembers,
  signatureEventTotals,
  signatureEventsByMember,
} from '../modules/signatures/queries.js';
import {
  protectedProcedure,
  publicProcedure,
  router,
} from '../trpc/trpc.js';
import { assertBrandAccess } from '../trpc/permissions.js';
import type { Context } from '../trpc/context.js';
import { ICON_KEYS, getColoredIconUrl } from '../modules/signatures/iconColorizer.js';
import { storagePut } from '../modules/signatures/storage.js';
import { recordBrandAsset, fileNameFromUrl, fileTypeFromName } from '../modules/locker/record.js';
import {
  cloneDepartmentDesign,
  mintDepartmentSlug,
} from '../modules/signatures/departments.js';
import {
  countOwnerSignatureMembers,
  defaultBrandKitId,
  ensureBrandKit,
  ensureBrandSignatureSlug,
  getSignaturesOffer,
  signaturesBillableUnits,
  signaturesEntitlement,
} from '../modules/signatures/billing.js';
import {
  getOwnerSignaturesSubscription,
  syncSignaturesQuantity,
} from '../modules/signatures/per-unit.js';
import {
  brandOwnerId,
  isBetaUser,
} from '../modules/feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../modules/feature-subscriptions/feature-keys.js';
import { stripe } from '../modules/stripe/client.js';

// ─── Input schemas (mirror the Manus export's field set) ─────────────────────

const SignatureBrandInput = z.object({
  name: z.string().min(1),
  collectionName: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  fontFamily: z.string().optional(),
  barColor: z.string().optional(),
  barTextColor: z.string().optional(),
  barLogoUrl: z.string().optional(),
  barLogoKey: z.string().optional(),
  brandDisplayName: z.string().optional(),
  brandTagline: z.string().optional(),
  logoUrl: z.string().optional(),
  logoKey: z.string().optional(),
  logoWidth: z.number().optional(),
  poweredByLogoUrl: z.string().optional(),
  poweredByLogoKey: z.string().optional(),
  poweredByLabel: z.string().optional(),
  logoLinkUrl: z.string().optional(),
  barLogoLinkUrl: z.string().optional(),
  poweredByLinkUrl: z.string().optional(),
  verdiictUrl: z.string().optional(),
  verdiictReviewsUrl: z.string().optional(),
  disclaimer: z.string().optional(),
  defaultTemplate: z.string().optional(),
  // Brand-kit-only structured fields (dashboard Brand Kit app).
  voice: z
    .object({
      tone: z.array(z.string()),
      preferred: z.array(z.string()),
      banned: z.array(z.string()),
      readingLevel: z.string(),
      examples: z.array(z.string()),
    })
    .optional(),
  logoSlots: z
    .array(
      z.object({
        slot: z.string(),
        url: z.string().nullable(),
        key: z.string().nullable(),
      }),
    )
    .optional(),
  kitVersion: z.number().optional(),
  kitVersionDate: z.string().optional(),
});

const MemberInput = z.object({
  signatureBrandId: z.string().uuid(),
  fullName: z.string().min(1),
  jobTitle: z.string().optional(),
  department: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  photoUrl: z.string().optional(),
  photoKey: z.string().optional(),
  photoLinkUrl: z.string().optional(),
  linkedin: z.string().optional(),
  twitter: z.string().optional(),
  instagram: z.string().optional(),
  facebook: z.string().optional(),
  youtube: z.string().optional(),
  github: z.string().optional(),
  spotify: z.string().optional(),
  pinterest: z.string().optional(),
  tiktok: z.string().optional(),
  googleMaps: z.string().optional(),
  googleReviews: z.string().optional(),
  trustpilot: z.string().optional(),
  tripadvisor: z.string().optional(),
  uberEats: z.string().optional(),
  deliveroo: z.string().optional(),
  expedia: z.string().optional(),
  rss: z.string().optional(),
  amazon: z.string().optional(),
  websiteLink: z.string().optional(),
  verdiictUrl: z.string().optional(),
  verdiictReviewsUrl: z.string().optional(),
});

const CampaignInput = z.object({
  signatureBrandId: z.string().uuid(),
  memberId: z.string().uuid().nullish(),
  name: z.string().min(1),
  linkUrl: z.string().nullish(),
  startsAt: z.date().nullish(),
  endsAt: z.date().nullish(),
  isActive: z.boolean().optional(),
  rotationMode: z.enum(['sequential', 'random']).optional(),
});

// Social-link fields that affect which icons get pre-rendered.
const SOCIAL_KEYS = [
  'linkedin', 'twitter', 'instagram', 'facebook', 'youtube', 'github',
  'spotify', 'pinterest', 'tiktok', 'googleMaps', 'googleReviews',
  'trustpilot', 'tripadvisor', 'uberEats', 'deliveroo', 'expedia',
  'rss', 'amazon', 'websiteLink',
] as const;

const ICON_KEY_ENUM = z.enum(ICON_KEYS as unknown as [string, ...string[]]);

// ─── Access helpers (resolve tenant brand from the entity, then assert) ──────

/** Load a brand kit (COMBINED view: kit row + brands identity/palette/font) by
 *  its id and assert the caller may write to its tenant brand. The kit row is
 *  already in hand from the id lookup, so we only fetch the brand row and combine
 *  (no re-provision / re-select). */
async function requireBrandKitWrite(ctx: Context, signatureBrandId: string) {
  const [kit] = await ctx.db
    .select()
    .from(brandKits)
    .where(eq(brandKits.id, signatureBrandId))
    .limit(1);
  if (!kit) throw new TRPCError({ code: 'NOT_FOUND' });
  const { isOwner } = await assertBrandAccess(ctx, kit.brandId, 'signatures');
  const [brand] = await ctx.db
    .select()
    .from(brands)
    .where(eq(brands.id, kit.brandId))
    .limit(1);
  if (!brand) throw new TRPCError({ code: 'NOT_FOUND' });
  return { sb: combineBrandKit(kit, brand), isOwner };
}

/** Load a brand kit (COMBINED view) and assert access (same gate as write; kept
 *  separate so read-only call sites stay self-documenting). */
async function requireBrandKitRead(ctx: Context, signatureBrandId: string) {
  const [kit] = await ctx.db
    .select()
    .from(brandKits)
    .where(eq(brandKits.id, signatureBrandId))
    .limit(1);
  if (!kit) throw new TRPCError({ code: 'NOT_FOUND' });
  await assertBrandAccess(ctx, kit.brandId, 'signatures');
  const [brand] = await ctx.db
    .select()
    .from(brands)
    .where(eq(brands.id, kit.brandId))
    .limit(1);
  if (!brand) throw new TRPCError({ code: 'NOT_FOUND' });
  return { sb: combineBrandKit(kit, brand) };
}


/**
 * Resolve a public share URL to one department.
 *
 * The brand segment is matched against every brand's DEFAULT kit name (that kit
 * carries the brand's own display name). `departmentSlug === null` means the bare
 * `/team/<brand>`, which follows whichever department is default right now.
 *
 * This is an UNAUTHENTICATED endpoint, so the brand-segment scan is deliberately
 * restricted to default kits — one row per brand — rather than every department.
 */
async function resolveBrandSlug(
  ctx: Context,
  brandSlug: string,
  departmentSlug: string | null,
): Promise<{ id: string; brandId: string }> {
  // Both segments are indexed column lookups. This used to load EVERY brand kit
  // and slugify names in JS to find a match — on an unauthenticated endpoint,
  // which made the scan a public surface that grew with every department added.
  const [brand] = await ctx.db
    .select({ id: brands.id })
    .from(brands)
    .where(sql`lower(${brands.signatureSlug}) = ${brandSlug.toLowerCase()}`)
    .limit(1);
  if (!brand)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });

  if (departmentSlug === null) {
    // The bare /team/<brand> follows whichever department is default RIGHT NOW,
    // so promoting a different one never invalidates the plain link.
    const [dflt] = await ctx.db
      .select({ id: brandKits.id, brandId: brandKits.brandId })
      .from(brandKits)
      .where(and(eq(brandKits.brandId, brand.id), eq(brandKits.isDefault, true)))
      .limit(1);
    if (!dflt)
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
    return dflt;
  }

  // Scoped to the brand and case-insensitive, matching the unique index
  // (brand_id, lower(slug)).
  const [dept] = await ctx.db
    .select({ id: brandKits.id, brandId: brandKits.brandId })
    .from(brandKits)
    .where(
      and(
        eq(brandKits.brandId, brand.id),
        sql`lower(${brandKits.slug}) = ${departmentSlug.toLowerCase()}`,
      ),
    )
    .limit(1);
  if (!dept)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
  return dept;
}

/**
 * Shared tail for the public share endpoints: given a resolved brand-kit id and
 * its parent tenant brand, return that DEPARTMENT's combined design + the
 * brand's active members.
 *
 * Members are brand-level and shared by every department (one person, one seat,
 * many possible signature designs), so the roster doesn't narrow with the
 * department — only the design around it changes.
 */
async function buildShareResponse(
  ctx: Context,
  signatureBrandId: string,
  brandId: string,
) {
  const brand = await loadCombinedBrandKitById(ctx.db, signatureBrandId);
  if (!brand)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
  const members = await ctx.db
    .select()
    .from(signatureMembers)
    .where(
      and(
        eq(signatureMembers.brandId, brandId),
        eq(signatureMembers.isActive, true),
      ),
    )
    .orderBy(signatureMembers.fullName);
  return { brand, members };
}

/**
 * Load a department (raw kit row) and assert write access to its tenant brand.
 * Returns the ROW, not the combined view, because the callers need `isDefault`
 * and `brandId` to decide how the write is routed.
 */
async function requireDepartmentWrite(ctx: Context, signatureBrandId: string) {
  const [kit] = await ctx.db
    .select()
    .from(brandKits)
    .where(eq(brandKits.id, signatureBrandId))
    .limit(1);
  if (!kit)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Department not found' });
  await assertBrandAccess(ctx, kit.brandId, 'signatures');
  return kit;
}

/** Every brand id the caller owns or is signatures-staff of. */
async function accessibleSignatureBrandIds(ctx: Context): Promise<string[]> {
  const userId = ctx.user?.id;
  if (!userId) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const [owned, staffed] = await Promise.all([
    ctx.db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.ownerId, userId)),
    ctx.db
      .select({ id: staff.brandId, permissions: staff.permissions })
      .from(staff)
      .where(and(eq(staff.userId, userId), eq(staff.status, 'active'))),
  ]);
  const ids = new Set(owned.map((b) => b.id));
  for (const row of staffed) {
    // Mirrors the server gate: signatures is a single MANAGE permission.
    if (row.id && (row.permissions ?? []).includes('signatures')) ids.add(row.id);
  }
  return [...ids];
}

/**
 * A brand's departments as combined views, default first then the user's order.
 * Each carries the member count it renders for (brand-wide — departments share
 * the roster) and its public share slug.
 */
async function listBrandDepartments(ctx: Context, brandId: string) {
  const [kits, brand, memberRows] = await Promise.all([
    ctx.db
      .select()
      .from(brandKits)
      .where(eq(brandKits.brandId, brandId))
      .orderBy(desc(brandKits.isDefault), asc(brandKits.sortOrder), asc(brandKits.createdAt)),
    ctx.db
      .select({
        businessName: brands.businessName,
        website: brands.website,
        address: brands.address,
        logoUrl: brands.logoUrl,
        colors: brands.colors,
        typography: brands.typography,
        signatureSlug: brands.signatureSlug,
      })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1),
    ctx.db
      .select({ n: count() })
      .from(signatureMembers)
      .where(
        and(
          eq(signatureMembers.brandId, brandId),
          eq(signatureMembers.isActive, true),
        ),
      ),
  ]);
  const identity = brand[0];
  if (!identity) throw new TRPCError({ code: 'NOT_FOUND' });
  const memberCount = Number(memberRows[0]?.n ?? 0);
  // Segment 1, owned by the brand. Every department shares it, and it never
  // moves — not on a brand rename, not on a kit rename. Minted on first read for
  // brands created after migration 0090 backfilled the rest.
  const brandSlug =
    identity.signatureSlug ??
    (await ensureBrandSignatureSlug(ctx.db, brandId)) ??
    '';
  return kits.map((kit) => ({
    ...combineBrandKit(kit, identity),
    memberCount,
    brandSlug,
    // Segment 2. The default department is also reachable at the bare
    // `/team/<brand>`, but still advertises its explicit path so promoting a
    // different default doesn't change the link anyone already copied.
    departmentSlug: kit.slug,
  }));
}

/**
 * Re-render every member's social-icon PNGs when a design edit changed the
 * colours they're baked in. Fire-and-forget: icons regenerate on next view
 * anyway, so this is a warm-up, never something a save waits on.
 */
async function reRenderMemberIconsIfColoursChanged(
  ctx: Context,
  brandId: string,
  data: Record<string, unknown>,
) {
  const colourChanged =
    data.barTextColor !== undefined ||
    data.primaryColor !== undefined ||
    data.secondaryColor !== undefined ||
    data.colors !== undefined;
  if (!colourChanged) return;
  const updated = await loadCombinedBrandKitReadOnly(ctx.db, brandId);
  const members = await ctx.db
    .select()
    .from(signatureMembers)
    .where(eq(signatureMembers.brandId, brandId));
  void Promise.all(
    members.map(async (member) => {
      try {
        const renderedIconUrls = await renderIconsForMember(
          brandId,
          member as Record<string, unknown>,
          updated as Record<string, unknown>,
        );
        await ctx.db
          .update(signatureMembers)
          .set({ renderedIconUrls })
          .where(eq(signatureMembers.id, member.id));
      } catch {
        // Non-fatal.
      }
    }),
  ).catch(() => {});
}

/** Load a member and assert write access to its tenant brand. */
async function requireMemberWrite(ctx: Context, memberId: string) {
  const [m] = await ctx.db
    .select()
    .from(signatureMembers)
    .where(eq(signatureMembers.id, memberId))
    .limit(1);
  if (!m) throw new TRPCError({ code: 'NOT_FOUND' });
  const { isOwner } = await assertBrandAccess(ctx, m.brandId, 'signatures');
  return { m, isOwner };
}

/** Load a campaign and assert write access to its tenant brand. */
async function requireCampaignWrite(ctx: Context, campaignId: string) {
  const [c] = await ctx.db
    .select()
    .from(signatureCampaigns)
    .where(eq(signatureCampaigns.id, campaignId))
    .limit(1);
  if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
  const { isOwner } = await assertBrandAccess(ctx, c.brandId, 'signatures');
  return { c, isOwner };
}

/**
 * Pre-render all social icon PNGs for a member's brand colours and return a JSON
 * string mapping `iconKey_hexcolour` → hosted PNG URL. Stored in
 * `renderedIconUrls`. Falls back silently (inline SVG) on individual failures.
 */
async function renderIconsForMember(
  brandId: string,
  memberData: Record<string, unknown>,
  brand: { barTextColor?: string | null; primaryColor?: string | null },
): Promise<string> {
  const barColor = brand.barTextColor || '#1a1a2e';
  const primaryColor = brand.primaryColor || '#4A7C59';
  const activeKeys = ICON_KEYS.filter((k) => memberData[k]);
  const colorsToRender = Array.from(new Set([barColor, primaryColor]));
  const urlMap: Record<string, string> = {};
  await Promise.all(
    activeKeys.flatMap((key) =>
      colorsToRender.map(async (color) => {
        try {
          const url = await getColoredIconUrl(brandId, key, color);
          const normColor = color.replace(/^#/, '').toLowerCase();
          urlMap[`${key}_${normColor}`] = url;
        } catch {
          // Skip on error — will fall back to inline SVG.
        }
      }),
    ),
  );
  return JSON.stringify(urlMap);
}

export const signaturesRouter = router({
  // ─── Entitlement (drives the paywall banners + billing badge) ──────────────
  entitlement: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'signatures');
      return signaturesEntitlement(ctx.db, input.brandId);
    }),

  offer: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'signatures');
      return getSignaturesOffer(ctx.db);
    }),

  /**
   * Past Stripe invoices for the brand owner's Signatures subscription ONLY
   * (mirrors reviews.invoices — hard-scoped by featureKey so no other tool's
   * charges leak in). Card-on-file management reuses the tool-agnostic
   * shortLinks.{paymentMethod,createSetupIntent,setDefaultPaymentMethod}, which
   * operate on the brand owner's Stripe customer.
   */
  invoices: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertBrandAccess(ctx, input.brandId, 'payments');
      if (!stripe) return [];
      const ownerId = await brandOwnerId(ctx.db, input.brandId);
      if (!ownerId) return [];
      const [sub] = await ctx.db
        .select({
          stripeSubscriptionId: featureSubscriptions.stripeSubscriptionId,
          stripeCustomerId: featureSubscriptions.stripeCustomerId,
        })
        .from(featureSubscriptions)
        .innerJoin(
          featureSubscriptionProducts,
          eq(featureSubscriptions.productId, featureSubscriptionProducts.id),
        )
        .where(
          and(
            eq(featureSubscriptions.userId, ownerId),
            eq(
              featureSubscriptionProducts.featureKey,
              FEATURE_KEYS.EMAIL_SIGNATURES,
            ),
          ),
        )
        .orderBy(desc(featureSubscriptions.createdAt))
        .limit(1);
      if (!sub?.stripeSubscriptionId || !sub.stripeCustomerId) return [];

      const res = await stripe.invoices.list({
        customer: sub.stripeCustomerId,
        subscription: sub.stripeSubscriptionId,
        limit: 24,
      });
      return res.data.map((inv) => ({
        id: inv.id,
        number: inv.number ?? inv.id,
        created: inv.created ? new Date(inv.created * 1000) : null,
        periodStart: inv.period_start ? new Date(inv.period_start * 1000) : null,
        periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : null,
        amount: (inv.amount_paid || inv.amount_due || inv.total || 0) / 100,
        currency: (inv.currency ?? 'aud').toUpperCase(),
        status: inv.status ?? 'open',
        pdfUrl: inv.invoice_pdf ?? null,
        hostedUrl: inv.hosted_invoice_url ?? null,
      }));
    }),

  // ─── Icons (recolour SVG → hosted PNG; public for the share/preview flow) ──
  icons: router({
    colorize: publicProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          key: ICON_KEY_ENUM,
          color: z
            .string()
            .regex(/^#?[0-9a-fA-F]{3,6}$/, 'Must be a valid hex colour'),
        }),
      )
      .query(async ({ input }) => {
        const url = await getColoredIconUrl(input.brandId, input.key, input.color);
        return { url };
      }),
    batchColorize: publicProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          requests: z
            .array(
              z.object({
                key: ICON_KEY_ENUM,
                color: z.string().regex(/^#?[0-9a-fA-F]{3,6}$/),
              }),
            )
            .max(50),
        }),
      )
      .query(async ({ input }) => {
        const results: Record<string, string> = {};
        await Promise.all(
          input.requests.map(async ({ key, color }) => {
            try {
              const normColor = color.replace('#', '').toLowerCase();
              results[`${key}_${normColor}`] = await getColoredIconUrl(
                input.brandId,
                key,
                color,
              );
            } catch {
              // skip missing icons
            }
          }),
        );
        return results;
      }),
  }),

  // ─── Uploads (logos, photos, banner images) ────────────────────────────────
  upload: router({
    file: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          filename: z.string(),
          contentType: z.string(),
          base64: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const buffer = Buffer.from(input.base64, 'base64');
        const { key, url } = await storagePut(
          input.brandId,
          input.filename,
          buffer,
          input.contentType,
        );
        // Document Locker: every signature asset the user uploads (logo, headshot,
        // banner) is mirrored into the brand's Public Brand Assets. Insert-only —
        // replacing an asset keeps the previous one as history. Best-effort: a
        // locker failure must never fail the upload the UI is waiting on.
        await recordBrandAsset(ctx.db, {
          brandId: input.brandId,
          url,
          name: fileNameFromUrl(input.filename, 'Signature asset'),
          uploadedBy: ctx.user.id,
          size: buffer.length,
          type: input.contentType.startsWith('image/')
            ? 'image'
            : fileTypeFromName(input.filename),
          category: 'signature',
          note: 'Uploaded as an email-signature asset',
          sourceType: 'signatureAsset',
          sourceId: key,
        }).catch((e) =>
          console.error('[signatures] locker copy failed', (e as Error).message),
        );
        return { key, url };
      }),
  }),

  // ─── Signature brands (the DEFAULT department of a Prodesk brand) ────────────
  // The signature "brand" IS the Prodesk tenant brand: every brand the user can
  // access is automatically a signatures workspace. Its default brandKits row is
  // provisioned lazily on read (list/get call ensureBrandKit). Every procedure
  // here is brandId-first and resolves the DEFAULT department internally — use
  // the `departments` router below to reach a specific one.
  brands: router({
    // The brand's default department — auto-provisioned on access so every brand
    // the caller can reach is a ready workspace. `list` is kept (returns
    // [default]) for the Home preview selector.
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const combined = await loadCombinedBrandKit(
          ctx.db,
          input.brandId,
          ctx.user.id,
        );
        return combined ? [combined] : [];
      }),
    get: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        return (
          (await loadCombinedBrandKit(ctx.db, input.brandId, ctx.user.id)) ??
          null
        );
      }),

    /**
     * Update the brand's signature design + brand kit. Overlapping identity /
     * palette / font fields are routed to `brands` (the single source of truth);
     * signature-render + brand-kit-only fields go to the brand_kits satellite.
     */
    update: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          data: SignatureBrandInput.partial(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const sbId = await ensureBrandKit(ctx.db, input.brandId, ctx.user.id);

        const [brand] = await ctx.db
          .select({ colors: brands.colors, typography: brands.typography })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1);

        const { brandPatch, kitPatch } = splitBrandKitUpdate(
          input.data as Record<string, unknown>,
          { colors: brand?.colors ?? null, typography: brand?.typography ?? null },
        );

        if (Object.keys(kitPatch).length) {
          await ctx.db
            .update(brandKits)
            .set(kitPatch)
            .where(eq(brandKits.id, sbId));
        }
        if (Object.keys(brandPatch).length) {
          await ctx.db
            .update(brands)
            .set(brandPatch)
            .where(eq(brands.id, input.brandId));
        }

        // If icon colours changed, re-render all member icon PNGs in the
        // background (fire-and-forget; icons regenerate on next view otherwise).
        await reRenderMemberIconsIfColoursChanged(
          ctx,
          input.brandId,
          input.data as Record<string, unknown>,
        );
        return { success: true };
      }),
  }),

  // ─── Departments (many signature designs per brand) ──────────────────────────
  // A department is a complete, independently-editable signature design for the
  // brand: Sales, Support, Execs… They share the brand's MEMBERS, campaigns and
  // analytics — only the design differs — and each has its own share page.
  //
  // Exactly one department per brand is the DEFAULT: it doubles as the brand kit
  // the rest of the suite reads, and its identity/palette edits flow through to
  // `brands`. Secondary departments keep their divergences on their own row.
  departments: router({
    /** Every department for a brand, default first, then the user's own order. */
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        // Guarantees the brand has at least its default department.
        await ensureBrandKit(ctx.db, input.brandId, ctx.user.id);
        return listBrandDepartments(ctx, input.brandId);
      }),

    /** One department's full combined design (what the editor loads). */
    get: protectedProcedure
      .input(z.object({ signatureBrandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { sb } = await requireBrandKitRead(ctx, input.signatureBrandId);
        return sb;
      }),

    /**
     * Create a department. The signature form is long, so a new one is almost
     * always cloned rather than filled in from scratch:
     *   • `copyFromSignatureBrandId` — any department of any brand the caller has
     *     signatures access to. Same-brand copies keep the source's inherited
     *     (NULL) identity so they keep tracking the brand; cross-brand copies
     *     MATERIALISE the resolved values, because "copy from Acme's Sales" means
     *     the look you can see, not this brand's identity in Acme's layout.
     *   • `data` — an explicit design patch, applied last. The client uses it to
     *     seed from a locally saved signature.
     */
    create: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          departmentName: z.string().min(1).max(80),
          copyFromSignatureBrandId: z.string().uuid().optional(),
          data: SignatureBrandInput.partial().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        // The brand must own a default department before it can gain a second.
        await ensureBrandKit(ctx.db, input.brandId, ctx.user.id);

        let seed: Record<string, unknown> = {};
        if (input.copyFromSignatureBrandId) {
          const [source] = await ctx.db
            .select()
            .from(brandKits)
            .where(eq(brandKits.id, input.copyFromSignatureBrandId))
            .limit(1);
          if (!source)
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'The department you copied from no longer exists.',
            });
          // Copying reads the source, so it needs read access to the source brand.
          await assertBrandAccess(ctx, source.brandId, 'signatures');
          seed = cloneDepartmentDesign(
            source,
            source.brandId === input.brandId
              ? null
              : await loadCombinedBrandKitById(ctx.db, source.id),
          );
        }

        const [brand] = await ctx.db
          .select({ businessName: brands.businessName })
          .from(brands)
          .where(eq(brands.id, input.brandId))
          .limit(1);

        const siblings = await ctx.db
          .select({ slug: brandKits.slug, sortOrder: brandKits.sortOrder })
          .from(brandKits)
          .where(eq(brandKits.brandId, input.brandId));
        const next =
          siblings.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1;
        // Free within THIS brand — the unique index is (brand_id, lower(slug)),
        // so another brand's "sales" is none of our business.
        const slug = mintDepartmentSlug(
          input.departmentName,
          siblings.map((s) => s.slug),
        );

        // `data` is a combined-view patch; a new department is never the default,
        // so every consolidated field lands on its own override columns.
        const { kitPatch } = splitBrandKitUpdate(
          (input.data ?? {}) as Record<string, unknown>,
          { colors: null, typography: null },
          false,
        );

        const [created] = await ctx.db
          .insert(brandKits)
          .values({
            ...seed,
            ...kitPatch,
            brandId: input.brandId,
            createdByUserId: ctx.user.id,
            name:
              (kitPatch.name as string | undefined) ??
              (seed.name as string | undefined) ??
              brand?.businessName ??
              'My Brand',
            departmentName: input.departmentName,
            // Minted once, here. Never re-derived — see `rename`.
            slug,
            isDefault: false,
            sortOrder: next,
            // Icons re-render per department on first view; never inherit a cache.
            renderedIconUrls: null,
          })
          .returning({ id: brandKits.id });

        return { id: created!.id };
      }),

    /**
     * Update one department's design. Routing is department-aware: the default
     * department writes identity/palette/font through to `brands` (it IS the brand
     * kit), a secondary one writes them to its own overrides.
     */
    update: protectedProcedure
      .input(
        z.object({
          signatureBrandId: z.string().uuid(),
          data: SignatureBrandInput.partial(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const kit = await requireDepartmentWrite(ctx, input.signatureBrandId);

        const [brand] = await ctx.db
          .select({ colors: brands.colors, typography: brands.typography })
          .from(brands)
          .where(eq(brands.id, kit.brandId))
          .limit(1);

        const { brandPatch, kitPatch } = splitBrandKitUpdate(
          input.data as Record<string, unknown>,
          { colors: brand?.colors ?? null, typography: brand?.typography ?? null },
          kit.isDefault,
        );

        if (Object.keys(kitPatch).length) {
          await ctx.db
            .update(brandKits)
            .set(kitPatch)
            .where(eq(brandKits.id, kit.id));
        }
        if (Object.keys(brandPatch).length) {
          await ctx.db
            .update(brands)
            .set(brandPatch)
            .where(eq(brands.id, kit.brandId));
        }

        await reRenderMemberIconsIfColoursChanged(ctx, kit.brandId, input.data);
        return { success: true };
      }),

    /**
     * Rename a department — its label only. The share slug is deliberately NOT
     * re-derived: signatures live in real inboxes for years, and silently moving
     * the URL would 404 every one already sent. Changing a live link should be a
     * separate, deliberate act with its own warning, not a side effect of fixing
     * a typo in a name.
     */
    rename: protectedProcedure
      .input(
        z.object({
          signatureBrandId: z.string().uuid(),
          departmentName: z.string().min(1).max(80),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const kit = await requireDepartmentWrite(ctx, input.signatureBrandId);
        await ctx.db
          .update(brandKits)
          .set({ departmentName: input.departmentName })
          .where(eq(brandKits.id, kit.id));
        return { success: true };
      }),

    /**
     * Promote a department to the brand's default — the one new signatures start
     * from and the one the rest of the suite treats as the brand kit.
     *
     * Demote-then-promote in a transaction: the partial UNIQUE index rejects two
     * defaults, so the order matters and a half-applied swap would leave the brand
     * with none.
     */
    setDefault: protectedProcedure
      .input(z.object({ signatureBrandId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const kit = await requireDepartmentWrite(ctx, input.signatureBrandId);
        if (kit.isDefault) return { success: true };
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(brandKits)
            .set({ isDefault: false })
            .where(
              and(
                eq(brandKits.brandId, kit.brandId),
                eq(brandKits.isDefault, true),
              ),
            );
          await tx
            .update(brandKits)
            .set({ isDefault: true })
            .where(eq(brandKits.id, kit.id));
        });
        return { success: true };
      }),

    /**
     * Delete a department. The default one can't be deleted — promote another
     * first — because the suite and every member's fallback design resolve
     * through it.
     *
     * Members and campaigns are BRAND-level but still carry a department FK that
     * cascades on delete, so they're re-pointed at the default department first.
     * Without that, removing a department would silently delete the people whose
     * seats were created while it was open — and their billing with them.
     */
    delete: protectedProcedure
      .input(z.object({ signatureBrandId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const kit = await requireDepartmentWrite(ctx, input.signatureBrandId);
        if (kit.isDefault)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message:
              'This is the brand’s default department. Make another one the default before deleting it.',
          });
        const fallback = await defaultBrandKitId(ctx.db, kit.brandId);
        if (!fallback)
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This brand has no default department to fall back to.',
          });
        await ctx.db.transaction(async (tx) => {
          await tx
            .update(signatureMembers)
            .set({ signatureBrandId: fallback })
            .where(eq(signatureMembers.signatureBrandId, kit.id));
          await tx
            .update(signatureCampaigns)
            .set({ signatureBrandId: fallback })
            .where(eq(signatureCampaigns.signatureBrandId, kit.id));
          // Analytics keeps its department FK as ON DELETE SET NULL — the events
          // stay attributed to the brand, which is the level the dashboard reads.
          await tx.delete(brandKits).where(eq(brandKits.id, kit.id));
        });
        return { success: true };
      }),

    /**
     * Everything the "Copy from" picker can offer: every department of every brand
     * the caller has signatures access to, grouped by brand, with the calling
     * brand first. Members/campaigns aren't copied — only the design.
     */
    copySources: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const accessible = await accessibleSignatureBrandIds(ctx);
        if (!accessible.length) return [];

        const rows = await ctx.db
          .select({
            id: brandKits.id,
            brandId: brandKits.brandId,
            brandName: brands.businessName,
            name: brandKits.name,
            departmentName: brandKits.departmentName,
            isDefault: brandKits.isDefault,
            sortOrder: brandKits.sortOrder,
            defaultTemplate: brandKits.defaultTemplate,
            logoUrl: sql<string | null>`coalesce(${brandKits.logoUrl}, ${brands.logoUrl})`,
            primaryColor: sql<string | null>`coalesce(${brandKits.primaryColor}, ${brands.colors}[1])`,
            barColor: brandKits.barColor,
          })
          .from(brandKits)
          .innerJoin(brands, eq(brandKits.brandId, brands.id))
          .where(inArray(brandKits.brandId, accessible))
          .orderBy(
            brands.businessName,
            desc(brandKits.isDefault),
            asc(brandKits.sortOrder),
          );

        const byBrand = new Map<string, (typeof rows)[number][]>();
        for (const row of rows) {
          const list = byBrand.get(row.brandId) ?? [];
          list.push(row);
          byBrand.set(row.brandId, list);
        }
        return [...byBrand.entries()]
          .map(([brandId, departments]) => ({
            brandId,
            brandName: departments[0]!.brandName,
            isCurrentBrand: brandId === input.brandId,
            departments,
          }))
          // The caller's own brand leads; the rest keep their name order.
          .sort((a, b) => Number(b.isCurrentBrand) - Number(a.isCurrentBrand));
      }),
  }),

  // ─── Members ────────────────────────────────────────────────────────────────
  members: router({
    /**
     * The brand's signature members (seats). Members are BRAND-level and shared by
     * every department — one person, one billable seat, however many department
     * designs the brand runs — so this deliberately does NOT narrow by department.
     * Callers may pass either the brandId or any of its department ids.
     */
    list: protectedProcedure
      .input(
        z
          .object({
            brandId: z.string().uuid().optional(),
            signatureBrandId: z.string().uuid().optional(),
          })
          .refine((v) => v.brandId || v.signatureBrandId, {
            message: 'Either brandId or signatureBrandId must be provided',
          }),
      )
      .query(async ({ ctx, input }) => {
        let brandId = input.brandId;
        if (brandId) {
          await assertBrandAccess(ctx, brandId, 'signatures');
        } else {
          const kit = await requireDepartmentWrite(ctx, input.signatureBrandId!);
          brandId = kit.brandId;
        }
        // Only ACTIVE seats — a pending (unpaid) seat is hidden until its checkout
        // completes and the webhook flips it on. Shared with the AI
        // list_signature_members tool.
        return listSignatureMembers(ctx.db, { brandId });
      }),
    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [m] = await ctx.db
          .select()
          .from(signatureMembers)
          .where(eq(signatureMembers.id, input.id))
          .limit(1);
        if (!m) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertBrandAccess(ctx, m.brandId, 'signatures');
        return m;
      }),
    /**
     * Add a signature member (SEAT). Per-seat billing (first seat free). The seat row
     * is ALWAYS written up-front so its data survives the Stripe redirect (no client
     * localStorage); it's created ACTIVE unless payment is required, in which case
     * it's created INACTIVE and the Stripe webhook / on-file charge activates it
     * (recordFeatureSubscription → pendingEnableMemberId), mirroring short links.
     *   (a) beta OR within the free allowance → create active.
     *   (b) billable & owner already subscribed → create active + bump quantity.
     *   (c) billable & no sub → create inactive, return `needs_checkout` + memberId;
     *       the client runs featureSubscriptions.checkout with pendingEnableMemberId.
     */
    create: protectedProcedure
      .input(MemberInput)
      .mutation(async ({ ctx, input }) => {
        const { sb } = await requireBrandKitWrite(ctx, input.signatureBrandId);
        const ownerId = await brandOwnerId(ctx.db, sb.brandId);
        if (!ownerId)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand owner not found' });

        // Decide whether this seat needs payment before it can go live.
        const [beta, currentSeats] = await Promise.all([
          isBetaUser(ctx.db, ownerId),
          countOwnerSignatureMembers(ctx.db, ownerId),
        ]);
        let needsCheckout = false;
        let priceId: string | null = null;
        if (!beta && signaturesBillableUnits(currentSeats + 1) > 0) {
          const existingSub = await getOwnerSignaturesSubscription(ctx.db, ownerId);
          if (!existingSub) {
            const offer = await getSignaturesOffer(ctx.db);
            if (!offer?.priceId)
              throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'Signatures subscription is not configured yet.',
              });
            needsCheckout = true;
            priceId = offer.priceId;
          }
        }

        const { signatureBrandId: _requested, ...rest } = input;
        const renderedIconUrls = await renderIconsForMember(
          sb.brandId,
          input as Record<string, unknown>,
          sb,
        );
        // A member belongs to the BRAND, not to whichever department was open when
        // they were added: they're one seat that every department renders. Anchor
        // the row to the default department so deleting a department can never
        // cascade a paid seat away.
        const anchorKitId = await ensureBrandKit(ctx.db, sb.brandId, ctx.user.id);
        const [created] = await ctx.db
          .insert(signatureMembers)
          .values({
            ...rest,
            signatureBrandId: anchorKitId,
            brandId: sb.brandId,
            renderedIconUrls,
            isActive: !needsCheckout,
          })
          .returning({ id: signatureMembers.id });

        if (needsCheckout) {
          // Seat is parked inactive; the client subscribes and the webhook/on-file
          // charge flips it active via pendingEnableMemberId.
          return { status: 'needs_checkout' as const, priceId: priceId!, memberId: created.id };
        }
        // Active seat added → bump the owner's quantity (prorated) when subscribed.
        await syncSignaturesQuantity(ctx.db, ownerId);
        return { status: 'created' as const };
      }),
    /**
     * Add MANY signature members (seats) in one call — the bulk-import path (CSV
     * import, AI assistant confirm card). Unlike `create`, which parks a single
     * billable seat inactive behind `needs_checkout`, bulk NEVER writes rows it
     * can't activate: when the batch would add billable seats and the owner has
     * no subscription yet, it creates NOTHING and returns `needs_subscription`
     * so the caller subscribes first (card-on-file checkout activates instantly)
     * and retries. Keeps the pending-seat webhook plumbing single-seat only.
     */
    bulkCreate: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          members: z
            .array(MemberInput.omit({ signatureBrandId: true }))
            .min(1)
            .max(50),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const sb = await loadCombinedBrandKit(ctx.db, input.brandId, ctx.user.id);
        if (!sb) throw new TRPCError({ code: 'NOT_FOUND' });
        const sbId = sb.id;
        const ownerId = await brandOwnerId(ctx.db, sb.brandId);
        if (!ownerId)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand owner not found' });

        // Server-side duplicate backstop: reject emails already on this brand's
        // roster (or repeated within the batch) so an import re-run can't
        // silently double people up.
        const batchEmails = input.members
          .map((m) => m.email?.trim().toLowerCase())
          .filter((e): e is string => !!e);
        const dupesInBatch = batchEmails.filter((e, i) => batchEmails.indexOf(e) !== i);
        if (dupesInBatch.length)
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `Duplicate emails in the batch: ${[...new Set(dupesInBatch)].join(', ')}`,
          });
        if (batchEmails.length) {
          const existing = await ctx.db
            .select({ email: signatureMembers.email })
            .from(signatureMembers)
            .where(eq(signatureMembers.brandId, sb.brandId));
          const existingEmails = new Set(
            existing.map((e) => e.email?.trim().toLowerCase()).filter(Boolean),
          );
          const already = batchEmails.filter((e) => existingEmails.has(e));
          if (already.length)
            throw new TRPCError({
              code: 'CONFLICT',
              message: `Already on the roster: ${[...new Set(already)].join(', ')}`,
            });
        }

        const [beta, currentSeats] = await Promise.all([
          isBetaUser(ctx.db, ownerId),
          countOwnerSignatureMembers(ctx.db, ownerId),
        ]);
        const billableAfter = signaturesBillableUnits(
          currentSeats + input.members.length,
        );
        if (!beta && billableAfter > 0) {
          const existingSub = await getOwnerSignaturesSubscription(ctx.db, ownerId);
          if (!existingSub) {
            const offer = await getSignaturesOffer(ctx.db);
            if (!offer?.priceId)
              throw new TRPCError({
                code: 'PRECONDITION_FAILED',
                message: 'Signatures subscription is not configured yet.',
              });
            return {
              status: 'needs_subscription' as const,
              priceId: offer.priceId,
              unitAmount: offer.unitAmount,
              currency: offer.currency,
            };
          }
        }

        const memberIds: string[] = [];
        for (const member of input.members) {
          const renderedIconUrls = await renderIconsForMember(
            sb.brandId,
            member as Record<string, unknown>,
            sb,
          );
          const [created] = await ctx.db
            .insert(signatureMembers)
            .values({
              ...member,
              signatureBrandId: sbId,
              brandId: sb.brandId,
              renderedIconUrls,
              isActive: true,
            })
            .returning({ id: signatureMembers.id });
          memberIds.push(created.id);
        }
        // One quantity sync for the whole batch (prorated on Stripe).
        await syncSignaturesQuantity(ctx.db, ownerId);
        return {
          status: 'created' as const,
          createdCount: memberIds.length,
          memberIds,
        };
      }),
    update: protectedProcedure
      .input(z.object({ id: z.string().uuid(), data: MemberInput.partial() }))
      .mutation(async ({ ctx, input }) => {
        const { m } = await requireMemberWrite(ctx, input.id);
        // Re-render icon PNGs when social links (or the parent brand) change.
        let renderedIconUrls: string | undefined;
        const touchedSocial =
          input.data.signatureBrandId !== undefined ||
          Object.keys(input.data).some((k) =>
            (SOCIAL_KEYS as readonly string[]).includes(k),
          );
        if (touchedSocial) {
          const merged = { ...m, ...input.data };
          const [kit] = await ctx.db
            .select({ brandId: brandKits.brandId })
            .from(brandKits)
            .where(eq(brandKits.id, merged.signatureBrandId))
            .limit(1);
          const sb = kit ? await loadCombinedBrandKit(ctx.db, kit.brandId) : null;
          if (sb) {
            renderedIconUrls = await renderIconsForMember(
              sb.brandId,
              merged as Record<string, unknown>,
              sb,
            );
          }
        }
        // signatureBrandId is not editable via update (a member can't be moved
        // across brand kits here); drop it from the set payload if present.
        const { signatureBrandId: _ignore, ...data } = input.data;
        await ctx.db
          .update(signatureMembers)
          .set({
            ...data,
            ...(renderedIconUrls !== undefined ? { renderedIconUrls } : {}),
          })
          .where(eq(signatureMembers.id, input.id));
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { m } = await requireMemberWrite(ctx, input.id);
        await ctx.db.delete(signatureMembers).where(eq(signatureMembers.id, input.id));
        // Lower the owner's seat quantity (cancels the sub at 0 billable seats).
        const ownerId = await brandOwnerId(ctx.db, m.brandId);
        if (ownerId) await syncSignaturesQuantity(ctx.db, ownerId);
        return { success: true };
      }),
    reRenderIcons: protectedProcedure
      .input(z.object({ signatureBrandId: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const { sb } = await requireBrandKitWrite(ctx, input.signatureBrandId);
        const members = await ctx.db
          .select()
          .from(signatureMembers)
          .where(eq(signatureMembers.signatureBrandId, input.signatureBrandId));
        let rendered = 0;
        await Promise.all(
          members.map(async (member) => {
            try {
              const renderedIconUrls = await renderIconsForMember(
                sb.brandId,
                member as Record<string, unknown>,
                sb,
              );
              await ctx.db
                .update(signatureMembers)
                .set({ renderedIconUrls })
                .where(eq(signatureMembers.id, member.id));
              rendered++;
            } catch {
              // Skip on error.
            }
          }),
        );
        return { success: true, rendered };
      }),
  }),

  // ─── Campaigns (rotating promo banners) ──────────────────────────────────────
  campaigns: router({
    list: protectedProcedure
      .input(
        z.object({
          signatureBrandId: z.string().uuid().optional(),
          brandId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const query = ctx.db
          .select({
            id: signatureCampaigns.id,
            signatureBrandId: signatureCampaigns.signatureBrandId,
            brandId: signatureCampaigns.brandId,
            memberId: signatureCampaigns.memberId,
            name: signatureCampaigns.name,
            linkUrl: signatureCampaigns.linkUrl,
            startsAt: signatureCampaigns.startsAt,
            endsAt: signatureCampaigns.endsAt,
            isActive: signatureCampaigns.isActive,
            rotationMode: signatureCampaigns.rotationMode,
            rotationCounter: signatureCampaigns.rotationCounter,
            createdAt: signatureCampaigns.createdAt,
            updatedAt: signatureCampaigns.updatedAt,
            brandName: brands.businessName,
          })
          .from(signatureCampaigns)
          .innerJoin(brandKits, eq(signatureCampaigns.signatureBrandId, brandKits.id))
          .innerJoin(brands, eq(brandKits.brandId, brands.id));

        let campaigns: any[] = [];
        if (input.signatureBrandId) {
          await requireBrandKitRead(ctx, input.signatureBrandId);
          campaigns = await query
            .where(eq(signatureCampaigns.signatureBrandId, input.signatureBrandId))
            .orderBy(desc(signatureCampaigns.createdAt));
        } else if (input.brandId) {
          await assertBrandAccess(ctx, input.brandId, 'signatures');
          campaigns = await query
            .where(eq(signatureCampaigns.brandId, input.brandId))
            .orderBy(desc(signatureCampaigns.createdAt));
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Either signatureBrandId or brandId must be provided',
          });
        }

        if (campaigns.length === 0) return [];

        // Fetch banners for all these campaigns
        const campaignIds = campaigns.map((c) => c.id);
        const banners = await ctx.db
          .select()
          .from(signatureCampaignBanners)
          .where(inArray(signatureCampaignBanners.campaignId, campaignIds))
          .orderBy(signatureCampaignBanners.sortOrder);

        // Group banners by campaignId
        const bannersByCampaignId = new Map<string, typeof banners>();
        for (const b of banners) {
          const list = bannersByCampaignId.get(b.campaignId) ?? [];
          list.push(b);
          bannersByCampaignId.set(b.campaignId, list);
        }

        // Attach banners to each campaign
        return campaigns.map((c) => ({
          ...c,
          banners: bannersByCampaignId.get(c.id) ?? [],
        }));
      }),
    get: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [c] = await ctx.db
          .select()
          .from(signatureCampaigns)
          .where(eq(signatureCampaigns.id, input.id))
          .limit(1);
        if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertBrandAccess(ctx, c.brandId, 'signatures');
        return c;
      }),
    create: protectedProcedure
      .input(CampaignInput)
      .mutation(async ({ ctx, input }) => {
        const { sb } = await requireBrandKitWrite(ctx, input.signatureBrandId);
        const { signatureBrandId, ...rest } = input;
        await ctx.db.insert(signatureCampaigns).values({
          ...rest,
          signatureBrandId,
          brandId: sb.brandId,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          data: CampaignInput.partial(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireCampaignWrite(ctx, input.id);
        const { signatureBrandId: _ignore, ...data } = input.data;
        await ctx.db
          .update(signatureCampaigns)
          .set(data)
          .where(eq(signatureCampaigns.id, input.id));
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        await requireCampaignWrite(ctx, input.id);
        await ctx.db
          .delete(signatureCampaigns)
          .where(eq(signatureCampaigns.id, input.id));
        return { success: true };
      }),
    getBanners: protectedProcedure
      .input(z.object({ campaignId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [c] = await ctx.db
          .select()
          .from(signatureCampaigns)
          .where(eq(signatureCampaigns.id, input.campaignId))
          .limit(1);
        if (!c) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertBrandAccess(ctx, c.brandId, 'signatures');
        return ctx.db
          .select()
          .from(signatureCampaignBanners)
          .where(eq(signatureCampaignBanners.campaignId, input.campaignId))
          .orderBy(signatureCampaignBanners.sortOrder);
      }),
    addBanner: protectedProcedure
      .input(
        z.object({
          campaignId: z.string().uuid(),
          imageKey: z.string(),
          imageUrl: z.string(),
          sortOrder: z.number().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requireCampaignWrite(ctx, input.campaignId);
        await ctx.db.insert(signatureCampaignBanners).values({
          campaignId: input.campaignId,
          imageKey: input.imageKey,
          imageUrl: input.imageUrl,
          sortOrder: input.sortOrder ?? 0,
        });
        return { success: true };
      }),
    deleteBanner: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [banner] = await ctx.db
          .select()
          .from(signatureCampaignBanners)
          .where(eq(signatureCampaignBanners.id, input.id))
          .limit(1);
        if (!banner) throw new TRPCError({ code: 'NOT_FOUND' });
        await requireCampaignWrite(ctx, banner.campaignId);
        await ctx.db
          .delete(signatureCampaignBanners)
          .where(eq(signatureCampaignBanners.id, input.id));
        return { success: true };
      }),
    getActive: protectedProcedure
      .input(
        z.object({
          signatureBrandId: z.string().uuid(),
          memberId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await requireBrandKitRead(ctx, input.signatureBrandId);
        const now = new Date();
        const activeCampaigns = await ctx.db
          .select()
          .from(signatureCampaigns)
          .where(
            and(
              eq(signatureCampaigns.signatureBrandId, input.signatureBrandId),
              eq(signatureCampaigns.isActive, true),
              or(
                isNull(signatureCampaigns.memberId),
                input.memberId
                  ? eq(signatureCampaigns.memberId, input.memberId)
                  : isNull(signatureCampaigns.memberId),
              ),
              or(
                isNull(signatureCampaigns.startsAt),
                lte(signatureCampaigns.startsAt, now),
              ),
              or(
                isNull(signatureCampaigns.endsAt),
                gte(signatureCampaigns.endsAt, now),
              ),
            ),
          );
        const results = await Promise.all(
          activeCampaigns.map(async (campaign) => {
            const banners = await ctx.db
              .select()
              .from(signatureCampaignBanners)
              .where(eq(signatureCampaignBanners.campaignId, campaign.id))
              .orderBy(signatureCampaignBanners.sortOrder);
            if (!banners.length) return { campaign, banner: null };
            const idx =
              campaign.rotationMode === 'random'
                ? Math.floor(Math.random() * banners.length)
                : campaign.rotationCounter % banners.length;
            return { campaign, banner: banners[idx] };
          }),
        );
        return results.filter((r) => r.banner !== null);
      }),
  }),

  // ─── Analytics ────────────────────────────────────────────────────────────
  analytics: router({
    /**
     * Consolidated analytics for the signatures dashboard, modeled on the links
     * `shortLinks.analytics` procedure. One round trip returns headline totals,
     * a gap-filled daily series (clicks + unique visitors), and every dimensional
     * breakdown (event type, member, campaign, device, browser, OS, country,
     * referrer) plus a recent-activity feed. All windowed metrics honor `days`
     * and exclude bot/prefetch hits unless `includeBots` is set.
     *
     * Single-brand: the user-level frontend calls this per accessible brand and
     * merges client-side (the "All brands" view).
     */
    overview: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          signatureBrandId: z.string().uuid().optional(),
          days: z.number().min(1).max(365).default(30),
          includeBots: z.boolean().default(false),
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');

        const ev = signatureAnalyticsEvents;
        const base = [eq(ev.brandId, input.brandId)];
        if (input.signatureBrandId)
          base.push(eq(ev.signatureBrandId, input.signatureBrandId));
        if (!input.includeBots) base.push(eq(ev.isBot, false));

        const since = new Date(Date.now() - input.days * 86_400_000);
        const win = [...base, gte(ev.createdAt, since)];

        // Headline totals: all-time clicks (bot-filtered) + windowed clicks /
        // unique visitors / active members / bot count.
        const [allTime] = await ctx.db
          .select({ clicks: count() })
          .from(ev)
          .where(and(...base));
        const [winTotals] = await ctx.db
          .select({
            clicks: count(),
            unique: countDistinct(ev.ipHash),
            members: countDistinct(ev.memberId),
          })
          .from(ev)
          .where(and(...win));
        const [botTotals] = await ctx.db
          .select({ bots: count() })
          .from(ev)
          .where(and(...base, gte(ev.createdAt, since), eq(ev.isBot, true)));

        // Gap-filled daily series (clicks + unique).
        const dayExpr = sql<string>`to_char(date_trunc('day', ${ev.createdAt}), 'YYYY-MM-DD')`;
        const seriesRows = await ctx.db
          .select({
            day: dayExpr,
            clicks: count(),
            unique: countDistinct(ev.ipHash),
          })
          .from(ev)
          .where(and(...win))
          .groupBy(dayExpr)
          .orderBy(dayExpr);
        const byDay = new Map(
          seriesRows.map((r) => [
            r.day,
            { clicks: Number(r.clicks), unique: Number(r.unique) },
          ]),
        );
        const series: { day: string; clicks: number; unique: number }[] = [];
        for (let i = input.days - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86_400_000)
            .toISOString()
            .slice(0, 10);
          series.push({ day: d, clicks: 0, unique: 0, ...byDay.get(d) });
        }

        // Clicks by event type (windowed).
        const typeRows = await ctx.db
          .select({ eventType: ev.eventType, n: count() })
          .from(ev)
          .where(and(...win))
          .groupBy(ev.eventType)
          .orderBy(desc(count()));
        const byType = typeRows.map((r) => ({
          eventType: r.eventType,
          count: Number(r.n),
        }));
        // Explicit union so the type honestly includes null (no clicks → no top).
        const topEventType: (typeof byType)[number]['eventType'] | null =
          byType.length ? byType[0].eventType : null;

        // Clicks by team member (windowed, clicks + unique).
        const memberRows = await ctx.db
          .select({
            memberId: ev.memberId,
            memberName: signatureMembers.fullName,
            clicks: count(),
            unique: countDistinct(ev.ipHash),
          })
          .from(ev)
          .leftJoin(signatureMembers, eq(ev.memberId, signatureMembers.id))
          .where(and(...win))
          .groupBy(ev.memberId, signatureMembers.fullName)
          .orderBy(desc(count()));
        const byMember = memberRows.map((r) => ({
          memberId: r.memberId ?? '',
          memberName: r.memberName ?? 'Unknown',
          clicks: Number(r.clicks),
          unique: Number(r.unique),
        }));

        // Clicks by campaign (windowed; only events attributed to a campaign).
        const campaignRows = await ctx.db
          .select({
            campaignId: ev.campaignId,
            name: signatureCampaigns.name,
            clicks: count(),
          })
          .from(ev)
          .leftJoin(
            signatureCampaigns,
            eq(ev.campaignId, signatureCampaigns.id),
          )
          .where(and(...win, sql`${ev.campaignId} is not null`))
          .groupBy(ev.campaignId, signatureCampaigns.name)
          .orderBy(desc(count()));
        const byCampaign = campaignRows.map((r) => ({
          campaignId: r.campaignId ?? '',
          name: r.name ?? 'Untitled campaign',
          clicks: Number(r.clicks),
        }));

        // Dimensional breakdowns (windowed, top 8). `referer` is a full URL, so
        // reduce it to a bare host for a useful breakdown.
        const refererHostExpr = sql`substring(${ev.referer} from '^https?://(?:www\\.)?([^/?#]+)')`;
        const breakdown = async (col: AnyColumn | SQL, fallback: string) => {
          const keyExpr = sql<string>`coalesce(nullif(${col}, ''), ${fallback})`;
          const rows = await ctx.db
            .select({ key: keyExpr, n: count() })
            .from(ev)
            .where(and(...win))
            // group by SELECT ordinal — see shortLinks.analytics for the 42803
            // bind-parameter rationale.
            .groupBy(sql`1`)
            .orderBy(desc(count()))
            .limit(8);
          return rows.map((r) => ({ key: r.key, n: Number(r.n) }));
        };
        const [byDevice, byBrowser, byOs, byCountry, byReferrer] =
          await Promise.all([
            breakdown(ev.device, 'other'),
            breakdown(ev.browser, 'Unknown'),
            breakdown(ev.os, 'Unknown'),
            breakdown(ev.country, 'Unknown'),
            breakdown(refererHostExpr, 'Direct / none'),
          ]);

        // Recent activity feed (bot-filtered unless included).
        const recent = await ctx.db
          .select({
            id: ev.id,
            eventType: ev.eventType,
            label: ev.label,
            memberId: ev.memberId,
            device: ev.device,
            country: ev.country,
            isBot: ev.isBot,
            createdAt: ev.createdAt,
          })
          .from(ev)
          .where(and(...base))
          .orderBy(desc(ev.createdAt))
          .limit(50);

        return {
          days: input.days,
          includeBots: input.includeBots,
          totalClicks: Number(allTime?.clicks ?? 0),
          windowClicks: Number(winTotals?.clicks ?? 0),
          uniqueVisitors: Number(winTotals?.unique ?? 0),
          activeMembers: Number(winTotals?.members ?? 0),
          botCount: Number(botTotals?.bots ?? 0),
          topEventType,
          series,
          byType,
          byMember,
          byCampaign,
          byDevice,
          byBrowser,
          byOs,
          byCountry,
          byReferrer,
          recent,
        };
      }),
    summary: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          signatureBrandId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        // Shared with the AI get_signature_analytics tool.
        return signatureEventTotals(ctx.db, {
          brandId: input.brandId,
          signatureBrandId: input.signatureBrandId,
        });
      }),
    byMember: protectedProcedure
      // Accepts either a `signatureBrandId` (the 1:1 satellite) or a Prodesk
      // `brandId` (parity with `summary`, so the user-level frontend can fan out
      // over every accessible brand without a `brands.get` round-trip per brand).
      .input(
        z.object({
          signatureBrandId: z.string().uuid().optional(),
          brandId: z.string().uuid().optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        // Resolve to a brand-scoped filter; signature brand is 1:1 with the
        // Prodesk brand, so filtering by brandId alone is equivalent.
        let brandId: string;
        if (input.signatureBrandId) {
          const { sb } = await requireBrandKitRead(
            ctx,
            input.signatureBrandId,
          );
          brandId = sb.brandId;
        } else if (input.brandId) {
          await assertBrandAccess(ctx, input.brandId, 'signatures');
          brandId = input.brandId;
        } else {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Either signatureBrandId or brandId must be provided',
          });
        }
        // Shared with the AI get_signature_analytics tool.
        return signatureEventsByMember(ctx.db, { brandId });
      }),
    recent: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        return ctx.db
          .select()
          .from(signatureAnalyticsEvents)
          .where(eq(signatureAnalyticsEvents.brandId, input.brandId))
          .orderBy(desc(signatureAnalyticsEvents.createdAt))
          .limit(50);
      }),
    // Public: signatures live in real inboxes, so interaction tracking is
    // unauthenticated. Scoped by brandId, which the share link carries.
    track: publicProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          signatureBrandId: z.string().uuid().optional(),
          memberId: z.string().uuid().optional(),
          campaignId: z.string().uuid().optional(),
          eventType: z.enum([
            'banner_click',
            'cta_click',
            'verdiict_review_click',
            'verdiict_reviews_click',
            'social_click',
            'email_click',
            'phone_click',
            'website_click',
          ]),
          label: z.string().optional(),
          redirectUrl: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await ctx.db.insert(signatureAnalyticsEvents).values({
          brandId: input.brandId,
          signatureBrandId: input.signatureBrandId ?? null,
          memberId: input.memberId ?? null,
          campaignId: input.campaignId ?? null,
          eventType: input.eventType,
          label: input.label ?? null,
        });
        return { success: true, redirectUrl: input.redirectUrl };
      }),
  }),

  // ─── Public share (a hosted, view-only signature directory for a brand kit) ─
  share: router({
    // Resolve by brand-kit id — the ORIGINAL share link (/share/:id). Kept intact
    // so links already embedded in real inboxes keep resolving.
    getBrand: publicProcedure
      .input(z.object({ signatureBrandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const [kit] = await ctx.db
          .select({ brandId: brandKits.brandId })
          .from(brandKits)
          .where(eq(brandKits.id, input.signatureBrandId))
          .limit(1);
        if (!kit)
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });
        return buildShareResponse(ctx, input.signatureBrandId, kit.brandId);
      }),
    /**
     * `/team/:brandSlug` — the brand's CURRENT default department.
     *
     * Following the default (rather than pinning a department) is what lets a
     * brand promote a different design without invalidating the plain link, and
     * it's the shape every link already in the wild has.
     */
    getBrandBySlug: publicProcedure
      .input(z.object({ slug: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const match = await resolveBrandSlug(ctx, input.slug, null);
        return buildShareResponse(ctx, match.id, match.brandId);
      }),

    /**
     * `/team/:brandSlug/:departmentSlug` — one specific department.
     *
     * The department segment is matched against the PERSISTED `brand_kits.slug`,
     * case-insensitively, scoped to the brand — so "sales" belongs to whichever
     * brand the first segment named, and renaming the department later doesn't
     * move its URL.
     */
    getDepartmentBySlug: publicProcedure
      .input(
        z.object({
          brandSlug: z.string().min(1),
          departmentSlug: z.string().min(1),
        }),
      )
      .query(async ({ ctx, input }) => {
        const match = await resolveBrandSlug(
          ctx,
          input.brandSlug,
          input.departmentSlug,
        );
        return buildShareResponse(ctx, match.id, match.brandId);
      }),
  }),

  // ─── Saved signatures (server-backed store; the shipped UI uses localStorage,
  // this API is provided for cross-device persistence) ────────────────────────
  saved: router({
    list: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        return ctx.db
          .select()
          .from(savedSignatures)
          .where(
            and(
              eq(savedSignatures.brandId, input.brandId),
              ne(savedSignatures.name, '__active_editor_state__')
            )
          )
          .orderBy(desc(savedSignatures.updatedAt));
      }),
    // The editor's per-user working state. Scoped to the BRAND as well as the
    // user: saved signatures are brand-level, so switching brands in the context
    // selector must not drag the previous brand's open workspace along.
    getActiveState: protectedProcedure
      .input(z.object({ brandId: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        const [row] = await ctx.db
          .select()
          .from(savedSignatures)
          .where(
            and(
              eq(savedSignatures.brandId, input.brandId),
              eq(savedSignatures.createdByUserId, ctx.user.id),
              eq(savedSignatures.name, '__active_editor_state__')
            )
          )
          .limit(1);
        return row ? JSON.parse(row.data) : null;
      }),
    setActiveState: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          data: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');

        const [existing] = await ctx.db
          .select()
          .from(savedSignatures)
          .where(
            and(
              eq(savedSignatures.brandId, input.brandId),
              eq(savedSignatures.createdByUserId, ctx.user.id),
              eq(savedSignatures.name, '__active_editor_state__')
            )
          )
          .limit(1);

        if (existing) {
          await ctx.db
            .update(savedSignatures)
            .set({ data: input.data, updatedAt: new Date() })
            .where(eq(savedSignatures.id, existing.id));
        } else {
          await ctx.db.insert(savedSignatures).values({
            brandId: input.brandId,
            createdByUserId: ctx.user.id,
            name: '__active_editor_state__',
            data: input.data,
          });
        }
        return { success: true };
      }),
    save: protectedProcedure
      .input(
        z.object({
          brandId: z.string().uuid(),
          name: z.string().min(1),
          data: z.string(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await assertBrandAccess(ctx, input.brandId, 'signatures');
        await ctx.db.insert(savedSignatures).values({
          brandId: input.brandId,
          createdByUserId: ctx.user.id,
          name: input.name,
          data: input.data,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(
        z.object({
          id: z.string().uuid(),
          name: z.string().optional(),
          data: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(savedSignatures)
          .where(eq(savedSignatures.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertBrandAccess(ctx, row.brandId, 'signatures');
        const upd: Record<string, unknown> = {};
        if (input.name) upd.name = input.name;
        if (input.data) upd.data = input.data;
        await ctx.db
          .update(savedSignatures)
          .set(upd)
          .where(eq(savedSignatures.id, input.id));
        return { success: true };
      }),
    delete: protectedProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(async ({ ctx, input }) => {
        const [row] = await ctx.db
          .select()
          .from(savedSignatures)
          .where(eq(savedSignatures.id, input.id))
          .limit(1);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await assertBrandAccess(ctx, row.brandId, 'signatures');
        await ctx.db.delete(savedSignatures).where(eq(savedSignatures.id, input.id));
        return { success: true };
      }),
  }),
});
