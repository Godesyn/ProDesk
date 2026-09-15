/**
 * Signatures (SIGKITT) billing — entitlement + the subscribe offer, on the
 * platform's generic Feature Subscription system (no bespoke Stripe).
 *
 * The signature "brand" IS the Prodesk tenant brand: every brand the user can
 * access is automatically a signatures workspace (its 1:1 brandKits satellite
 * is provisioned lazily on access — see routers/signatures.ts brands.get/list).
 * Billing is OWNER-scoped and PER-SEAT — the owner pays for each signature MEMBER
 * (seat) across all their brands (SIGNATURES_FREE_ALLOWANCE = 0).
 * Quantity is metered by modules/signatures/per-unit.ts.
 *
 * The super-admin creates the "Signatures" product (featureKey = email_signatures,
 * perUnit = true) in the Feature Subscriptions panel; checkout/cancel/resume reuse
 * the generic `featureSubscriptions` router.
 */
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  brands,
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  brandKits,
  signatureMembers,
} from '../../db/schema.js';
import { slugify } from './departments.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';
import {
  brandHasFeature,
  brandOwnerId,
  isBetaUser,
} from '../feature-subscriptions/entitlements.js';

type Db = typeof defaultDb;

/** How many signature seats (members) an owner gets free before billing kicks in. */
export const SIGNATURES_FREE_ALLOWANCE = 0;

/** ACTIVE signature members (seats) across ALL an owner's brands — the unit count.
 *  Inactive (unpaid, pending-checkout) seats never count toward billing. */
export async function countOwnerSignatureMembers(
  db: Db,
  ownerId: string,
): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(signatureMembers)
    .innerJoin(brands, eq(signatureMembers.brandId, brands.id))
    .where(and(eq(brands.ownerId, ownerId), eq(signatureMembers.isActive, true)));
  return Number(row?.n ?? 0);
}

/** Billable units for an owner: every seat past the free allowance. */
export function signaturesBillableUnits(seatCount: number): number {
  return Math.max(0, seatCount - SIGNATURES_FREE_ALLOWANCE);
}

/**
 * Ensure the brand's DEFAULT brand-kit row exists. Returns its id.
 * Idempotent and race-safe (the partial UNIQUE on (brand_id) WHERE is_default →
 * onConflictDoNothing).
 *
 * Since migration 0087 a brand holds MANY kits — one per signature department —
 * but exactly one is the default, and that one is the brand kit the rest of the
 * suite means when it says "the brand kit". Every non-signatures consumer must
 * resolve through here (or {@link defaultBrandKitId}) rather than picking an
 * arbitrary row for the brand.
 *
 * website/address/logo, palette and fonts live solely on `brands` (the single
 * source of truth). The kit keeps its OWN `name` (seeded from the brand's
 * businessName so it defaults sensibly, but it edits independently and never
 * renames the brand).
 */
export async function ensureBrandKit(
  db: Db,
  brandId: string,
  createdByUserId?: string | null,
): Promise<string> {
  const existing = await defaultBrandKitId(db, brandId);
  if (existing) return existing;

  const [brand] = await db
    .select({ businessName: brands.businessName })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  const [created] = await db
    .insert(brandKits)
    .values({
      brandId,
      createdByUserId: createdByUserId ?? null,
      name: brand?.businessName ?? 'My Brand',
      departmentName: DEFAULT_DEPARTMENT_NAME,
      // First department in the brand, so `main` is always free.
      slug: DEFAULT_DEPARTMENT_SLUG,
      isDefault: true,
    })
    // `where` is the conflict TARGET predicate — it must match the partial unique
    // index (brand_id) WHERE is_default for Postgres to infer it.
    .onConflictDoNothing({
      target: brandKits.brandId,
      where: eq(brandKits.isDefault, true),
    })
    .returning({ id: brandKits.id });
  if (created) return created.id;

  // Lost an insert race — re-read the row the other writer created.
  const row = await defaultBrandKitId(db, brandId);
  return row!;
}

/** The department name a brand's first (default) kit is seeded with. */
export const DEFAULT_DEPARTMENT_NAME = 'Main';

/** Its URL segment — `/team/<brand>/main`. Matches migration 0089's backfill. */
export const DEFAULT_DEPARTMENT_SLUG = 'main';

/**
 * Ensure the brand has its public share slug (URL segment 1 of
 * `/team/<slug>/<department>`) and return it.
 *
 * Minted lazily rather than required at brand creation: `brands` is written by
 * billing, onboarding, the marketplace and several test factories, none of which
 * should have to care about a signatures URL. Migration 0090 backfilled every
 * brand that already existed, so this only fires for brands created afterwards.
 *
 * Uniqueness is GLOBAL (it's the first segment of a public URL), so a collision
 * takes a numeric suffix. The unique index is the real arbiter — on a lost race
 * the insert fails, so re-read and retry a bounded number of times rather than
 * trusting the pre-check.
 */
export async function ensureBrandSignatureSlug(
  db: Db,
  brandId: string,
): Promise<string | null> {
  const [brand] = await db
    .select({ slug: brands.signatureSlug, businessName: brands.businessName })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) return null;
  if (brand.slug) return brand.slug;

  const [kit] = await db
    .select({ name: brandKits.name })
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
    .limit(1);
  // The kit's own name is what the OLD derived links used, so seeding from it
  // keeps a freshly-minted slug matching whatever was already shared.
  const base = slugify(kit?.name || brand.businessName || '') || 'brand';

  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(sql`lower(${brands.signatureSlug}) = ${candidate}`)
      .limit(1);
    if (taken) continue;
    try {
      await db
        .update(brands)
        .set({ signatureSlug: candidate })
        .where(and(eq(brands.id, brandId), isNull(brands.signatureSlug)));
    } catch {
      continue; // lost the race on the unique index — try the next suffix
    }
    const [after] = await db
      .select({ slug: brands.signatureSlug })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);
    if (after?.slug) return after.slug;
  }
  return null;
}

/**
 * The brand's DEFAULT kit id, or null when the brand has no kit yet. Read-only —
 * use {@link ensureBrandKit} when the caller may provision.
 */
export async function defaultBrandKitId(
  db: Db,
  brandId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: brandKits.id })
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.isDefault, true)))
    .limit(1);
  return row?.id ?? null;
}

/** The active Signatures product + its default monthly (per-unit) price, or null. */
export async function getSignaturesOffer(db: Db) {
  const [product] = await db
    .select()
    .from(featureSubscriptionProducts)
    .where(
      and(
        eq(featureSubscriptionProducts.active, true),
        eq(featureSubscriptionProducts.featureKey, FEATURE_KEYS.EMAIL_SIGNATURES),
      ),
    )
    .limit(1);
  if (!product) return null;

  const [offer] = await db
    .select({
      tierId: featureSubscriptionTiers.id,
      priceId: featureSubscriptionPrices.id,
      amount: featureSubscriptionPrices.amount,
      currency: featureSubscriptionPrices.currency,
    })
    .from(featureSubscriptionTiers)
    .innerJoin(
      featureSubscriptionPrices,
      eq(featureSubscriptionPrices.tierId, featureSubscriptionTiers.id),
    )
    .where(
      and(
        eq(featureSubscriptionTiers.productId, product.id),
        eq(featureSubscriptionTiers.active, true),
        eq(featureSubscriptionPrices.active, true),
        eq(featureSubscriptionPrices.interval, 'month'),
      ),
    )
    .orderBy(asc(featureSubscriptionTiers.sortOrder))
    .limit(1);

  return {
    productId: product.id,
    tierId: offer?.tierId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer ? Number(offer.amount) : null,
    currency: offer?.currency ?? 'AUD',
  };
}

export type SignaturesEntitlement = {
  /** Building signatures is allowed for this brand right now (always true — every
   *  accessible brand is a workspace; kept for API/UI compatibility). */
  live: boolean;
  betaExempt: boolean;
  /** The owner holds an active paid (or beta) signatures subscription. */
  ownerSubscribed: boolean;
  productId: string | null;
  priceId: string | null;
  /** Per-seat monthly price. */
  unitAmount: number | null;
  currency: string;
  /** ACTIVE seats across ALL the owner's brands (the billing unit count). */
  ownerSeatCount: number;
  /** Seats included free before per-seat billing starts. */
  freeAllowance: number;
};

/**
 * Resolve a brand's signatures entitlement (drives the billing UI). Every brand a
 * user can access is a signatures workspace, so `live` is always true; billing is a
 * PER-SEAT offset (first seat free — see per-unit.ts), not an entitlement gate.
 */
export async function signaturesEntitlement(
  db: Db,
  brandId: string,
): Promise<SignaturesEntitlement> {
  const ownerId = await brandOwnerId(db, brandId);

  const [betaExempt, paid, offer, ownerSeatCount] = await Promise.all([
    ownerId ? isBetaUser(db, ownerId) : Promise.resolve(false),
    brandHasFeature(db, brandId, FEATURE_KEYS.EMAIL_SIGNATURES),
    getSignaturesOffer(db),
    ownerId ? countOwnerSignatureMembers(db, ownerId) : Promise.resolve(0),
  ]);

  return {
    live: true,
    betaExempt,
    ownerSubscribed: betaExempt || paid,
    productId: offer?.productId ?? null,
    priceId: offer?.priceId ?? null,
    unitAmount: offer?.unitAmount ?? null,
    currency: offer?.currency ?? 'AUD',
    ownerSeatCount,
    freeAllowance: SIGNATURES_FREE_ALLOWANCE,
  };
}
