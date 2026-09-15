/**
 * Reviews tool — DB query helpers for the aggregations the router leans on
 * (review counts, directory profile, leaderboard, weekly streak buckets, win-tag
 * insights, industry rank). Ported from the Manus export's server/db.ts and
 * rewritten for Postgres + brand tenancy. Each takes the `db` handle and is
 * brand- or location-scoped by the caller (the router enforces access first).
 */
import { and, count, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  brands,
  reviewDirectoryBrands,
  reviewDirectorySlugAliases,
  reviewDirectoryProfiles,
  reviewEmbedCollectionLocations,
  reviewEmbedCollections,
  reviewEmbedConfigs,
  reviewLocations,
  reviewLocationSlugHistory,
  reviewSubmissions,
  reviewWinTags,
} from '../../db/schema.js';
import {
  DEFAULT_EMBED_THEME,
  EMBED_THEME_UNLOCK_LOCATION_REVIEWS,
  EMBED_UNLOCK_ACCOUNT_REVIEWS,
} from './embed.js';
import { slugifyName } from './industries.js';

type Db = typeof defaultDb;

/** IDs of every (incl. soft-deleted) location belonging to a brand. */
export async function brandLocationIds(db: Db, brandId: string): Promise<string[]> {
  const rows = await db
    .select({ id: reviewLocations.id })
    .from(reviewLocations)
    .where(eq(reviewLocations.brandId, brandId));
  return rows.map((r) => r.id);
}

/**
 * A brand's non-deleted review-capture locations, newest first. Shared by the
 * tRPC `reviews.locations.list` and the AI `list_review_locations` tool; each
 * caller projects the columns it needs (tool narrows + adds reviewCount).
 */
export async function listBrandLocations(db: Db, brandId: string, opts: { limit?: number } = {}) {
  const q = db
    .select()
    .from(reviewLocations)
    .where(and(eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
    .orderBy(desc(reviewLocations.createdAt));
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Total captured reviews per location, as a Map (0 for locations with none). */
export async function reviewCountsByLocation(
  db: Db,
  locationIds: string[],
): Promise<Map<string, number>> {
  if (locationIds.length === 0) return new Map();
  const rows = await db
    .select({ locationId: reviewSubmissions.locationId, value: count() })
    .from(reviewSubmissions)
    .where(inArray(reviewSubmissions.locationId, locationIds))
    .groupBy(reviewSubmissions.locationId);
  return new Map(rows.map((r) => [r.locationId, Number(r.value)]));
}

/**
 * Aggregate review stats for one location (total, avg stars to 1 dp, public vs.
 * private counts). Shared by tRPC `reviews.dashboard.stats` and the AI
 * `get_review_stats` tool — output-identical.
 */
export async function getLocationStats(
  db: Db,
  locationId: string,
): Promise<{ total: number; avgStars: number; publicCount: number; privateCount: number }> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      avg: sql<number>`coalesce(avg(${reviewSubmissions.stars}), 0)`,
      publicCount: sql<number>`count(*) filter (where ${reviewSubmissions.submissionType} = 'public')`,
      privateCount: sql<number>`count(*) filter (where ${reviewSubmissions.submissionType} = 'private')`,
    })
    .from(reviewSubmissions)
    .where(eq(reviewSubmissions.locationId, locationId));
  return {
    total: Number(row?.total ?? 0),
    avgStars: Math.round(Number(row?.avg ?? 0) * 10) / 10,
    publicCount: Number(row?.publicCount ?? 0),
    privateCount: Number(row?.privateCount ?? 0),
  };
}

/** Recent submissions for a location, newest first. Callers project columns. */
export async function listLocationSubmissions(db: Db, locationId: string, opts: { limit: number }) {
  return db
    .select()
    .from(reviewSubmissions)
    .where(eq(reviewSubmissions.locationId, locationId))
    .orderBy(desc(reviewSubmissions.createdAt))
    .limit(opts.limit);
}

/** A location's CONFIGURED win-tag rows, in display order (sortOrder, id). */
export async function getLocationWinTags(db: Db, locationId: string) {
  return db
    .select()
    .from(reviewWinTags)
    .where(eq(reviewWinTags.locationId, locationId))
    .orderBy(reviewWinTags.sortOrder, reviewWinTags.id);
}

/**
 * A brand's OWN public directory listing (creating the profile row if missing).
 * Shared by tRPC `reviews.directory.myProfile` and the AI `get_directory_listing`
 * tool. Note the write side-effect (ensureDirectoryProfile inserts).
 */
export async function getBrandDirectoryListing(
  db: Db,
  brandId: string,
): Promise<{
  brandSlug: string;
  locationSlug: string;
  locationId: string | null;
  locationName: string;
  profileUrl: string;
  directoryOptIn: boolean;
  websiteUrl: string | null;
  description: string | null;
  city: string | null;
  /** Same brand-then-first-location resolution the public badge renders with. */
  logoUrl: string | null;
}> {
  const [brand] = await db
    .select({ businessName: brands.businessName, logoUrl: brands.logoUrl })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  const [loc] = await db
    .select({
      id: reviewLocations.id,
      name: reviewLocations.name,
      slug: reviewLocations.slug,
      logoUrl: reviewLocations.logoUrl,
    })
    .from(reviewLocations)
    .where(and(eq(reviewLocations.brandId, brandId), isNull(reviewLocations.deletedAt)))
    .orderBy(reviewLocations.createdAt)
    .limit(1);

  if (!loc) {
    return {
      brandSlug: '',
      locationSlug: '',
      locationId: null,
      locationName: '',
      profileUrl: '/directory',
      directoryOptIn: false,
      websiteUrl: null,
      description: null,
      city: null,
      logoUrl: brand?.logoUrl ?? null,
    };
  }

  const brandSlug = await ensureDirectoryBrandSlug(db, brandId, brand?.businessName ?? 'business');
  await ensureDirectoryProfile(db, loc.id, brandId);
  const [row] = await db
    .select()
    .from(reviewDirectoryProfiles)
    .where(eq(reviewDirectoryProfiles.locationId, loc.id))
    .limit(1);

  return {
    brandSlug,
    locationSlug: loc.slug,
    locationId: loc.id,
    locationName: loc.name,
    profileUrl: directoryPath(brandSlug, loc.slug),
    directoryOptIn: row?.optIn ?? true,
    websiteUrl: row?.websiteUrl ?? null,
    description: row?.description ?? null,
    city: row?.city ?? null,
    logoUrl: loc.logoUrl ?? brand?.logoUrl ?? null,
  };
}

/**
 * Embed-widget state for one location: account/location review counts, the two
 * unlock flags (using the canonical thresholds — never hard-code them), and the
 * stored theme + version. Shared by tRPC `reviews.embed.getForLocation` and the
 * AI `get_review_embed` tool; each caller adds slug / locationName / thresholds.
 */
export async function getLocationEmbedState(db: Db, brandId: string, locationId: string) {
  const [brandReviews, locationReviews, cfgRow] = await Promise.all([
    countBrandReviews(db, brandId),
    countLocationReviews(db, locationId),
    db
      .select({ theme: reviewEmbedConfigs.theme, version: reviewEmbedConfigs.version })
      .from(reviewEmbedConfigs)
      .where(eq(reviewEmbedConfigs.locationId, locationId))
      .limit(1),
  ]);
  return {
    brandReviews,
    locationReviews,
    embedUnlocked: brandReviews >= EMBED_UNLOCK_ACCOUNT_REVIEWS,
    brandedUnlocked: locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS,
    theme: cfgRow[0]?.theme ?? DEFAULT_EMBED_THEME,
    version: cfgRow[0]?.version ?? 1,
  };
}

/** A brand's embed collections, newest first. Callers project columns. */
export async function listBrandEmbedCollections(db: Db, brandId: string) {
  return db
    .select()
    .from(reviewEmbedCollections)
    .where(eq(reviewEmbedCollections.brandId, brandId))
    .orderBy(desc(reviewEmbedCollections.createdAt));
}

/** Location counts per embed collection, as a Map (0 when a collection is empty). */
export async function embedCollectionLocationCounts(
  db: Db,
  collectionIds: string[],
): Promise<Map<string, number>> {
  if (collectionIds.length === 0) return new Map();
  const rows = await db
    .select({ collectionId: reviewEmbedCollectionLocations.collectionId, value: count() })
    .from(reviewEmbedCollectionLocations)
    .where(inArray(reviewEmbedCollectionLocations.collectionId, collectionIds))
    .groupBy(reviewEmbedCollectionLocations.collectionId);
  return new Map(rows.map((r) => [r.collectionId, Number(r.value)]));
}

/** Total captured reviews across all of a brand's locations (trial/unlock gate). */
export async function countBrandReviews(
  db: Db,
  brandId: string,
): Promise<number> {
  const ids = await brandLocationIds(db, brandId);
  if (ids.length === 0) return 0;
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(reviewSubmissions)
    .where(inArray(reviewSubmissions.locationId, ids));
  return Number(row?.c ?? 0);
}

/** Captured reviews for a single location. */
export async function countLocationReviews(
  db: Db,
  locationId: string,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(reviewSubmissions)
    .where(eq(reviewSubmissions.locationId, locationId));
  return Number(row?.c ?? 0);
}

/**
 * Whether `slug` is already claimed — by a location's live slug or reserved in
 * slug history (old links must keep resolving to their original location).
 * Case-insensitive, matching the unique lower(slug) indexes. Returns the id of
 * the owning location, or null when free.
 */
export async function locationIdOwningSlug(
  db: Db,
  slug: string,
): Promise<string | null> {
  const lower = slug.toLowerCase();
  const [live] = await db
    .select({ id: reviewLocations.id })
    .from(reviewLocations)
    .where(sql`lower(${reviewLocations.slug}) = ${lower}`)
    .limit(1);
  if (live) return live.id;
  const [past] = await db
    .select({ id: reviewLocationSlugHistory.locationId })
    .from(reviewLocationSlugHistory)
    .where(sql`lower(${reviewLocationSlugHistory.slug}) = ${lower}`)
    .limit(1);
  return past?.id ?? null;
}

/** A slug for a new location that doesn't collide with any live or past one. */
export async function uniqueLocationSlug(
  db: Db,
  base: string,
): Promise<string> {
  const seed = slugifyName(base, 40) || Math.random().toString(36).slice(2, 10);
  let slug = seed;
  let attempt = 0;
  // Bounded loop; collisions are vanishingly unlikely past a couple attempts.
  while (attempt < 50) {
    if (!(await locationIdOwningSlug(db, slug))) return slug;
    attempt += 1;
    slug = `${seed}-${attempt}`;
  }
  return `${seed}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Resolve a public slug to its location: the live slug first, then slug
 * history — so links, QR codes and embeds shared before a rename still work.
 */
export async function locationBySlugOrHistory(db: Db, slug: string) {
  const lower = slug.toLowerCase();
  const [live] = await db
    .select()
    .from(reviewLocations)
    .where(sql`lower(${reviewLocations.slug}) = ${lower}`)
    .limit(1);
  if (live) return live;
  const [past] = await db
    .select({ loc: reviewLocations })
    .from(reviewLocationSlugHistory)
    .innerJoin(
      reviewLocations,
      eq(reviewLocationSlugHistory.locationId, reviewLocations.id),
    )
    .where(sql`lower(${reviewLocationSlugHistory.slug}) = ${lower}`)
    .limit(1);
  return past?.loc ?? null;
}

const startOfIsoWeek = (d: Date): Date => {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = (date.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - day);
  return date;
};

/** Reviews-per-ISO-week buckets for the last `weeks` weeks (streak insight). */
export async function getWeeklyReviewCounts(
  db: Db,
  brandId: string,
  weeks = 12,
): Promise<Array<{ weekStart: Date; count: number }>> {
  const ids = await brandLocationIds(db, brandId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ ts: reviewSubmissions.createdAt })
    .from(reviewSubmissions)
    .where(inArray(reviewSubmissions.locationId, ids))
    .orderBy(desc(reviewSubmissions.createdAt))
    .limit(2000);
  const buckets = new Map<number, number>();
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = 0; i < weeks; i++) {
    buckets.set(startOfIsoWeek(new Date(now - i * msPerWeek)).getTime(), 0);
  }
  for (const r of rows) {
    const t = (
      r.ts instanceof Date ? r.ts : new Date(r.ts as unknown as string)
    ).getTime();
    const start = startOfIsoWeek(new Date(t)).getTime();
    if (buckets.has(start)) buckets.set(start, (buckets.get(start) ?? 0) + 1);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([k, count]) => ({ weekStart: new Date(k), count }));
}

/** Most-selected win tags for a location (public submissions). */
export async function getTopWinTags(
  db: Db,
  locationId: string,
  limit = 5,
): Promise<Array<{ tag: string; count: number; pct: number }>> {
  const rows = await db
    .select({ selectedTags: reviewSubmissions.selectedTags })
    .from(reviewSubmissions)
    .where(
      and(
        eq(reviewSubmissions.locationId, locationId),
        eq(reviewSubmissions.submissionType, 'public'),
      ),
    )
    .limit(1000);
  if (rows.length === 0) return [];
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r.selectedTags ?? []) {
      if (typeof t === 'string') counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  const total = rows.length;
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({
      tag,
      count,
      pct: Math.round((count / total) * 100),
    }));
}

/** Rank a brand among others in `industry` by 90-day review volume. */
export async function getIndustryRankForBrand(
  db: Db,
  brandId: string,
  industry: string,
): Promise<{ rank: number | null; total: number; percentile: number | null }> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      brandId: reviewLocations.brandId,
      reviewCount: sql<number>`count(${reviewSubmissions.id})`,
    })
    .from(reviewLocations)
    .leftJoin(
      reviewSubmissions,
      and(
        eq(reviewSubmissions.locationId, reviewLocations.id),
        gte(reviewSubmissions.createdAt, since),
      ),
    )
    .where(eq(reviewLocations.industry, industry))
    .groupBy(reviewLocations.brandId);
  if (rows.length === 0) return { rank: null, total: 0, percentile: null };
  const sorted = rows
    .map((r) => ({ brandId: r.brandId, reviewCount: Number(r.reviewCount) }))
    .sort((a, b) => b.reviewCount - a.reviewCount);
  const idx = sorted.findIndex((r) => r.brandId === brandId);
  if (idx === -1) return { rank: null, total: sorted.length, percentile: null };
  return {
    rank: idx + 1,
    total: sorted.length,
    percentile: Math.max(
      1,
      Math.round(((idx + 1) / Math.max(1, sorted.length)) * 100),
    ),
  };
}

/**
 * Rank of one LOCATION among the opt-in locations in its industry, by public
 * review volume over the last 90 days.
 *
 * The public directory (search, leaderboard, profile, badge) is location-level,
 * so its "#N Best <industry>" must be counted the same way — the brand-level
 * `getIndustryRankForBrand` above stays for the owner's brand dashboard, where
 * the whole business is the subject. Mixing the two is what let a profile claim
 * "#1" while the leaderboard listed it fourth.
 */
export async function getIndustryRankForLocation(
  db: Db,
  locationId: string,
  industry: string,
): Promise<{ rank: number | null; total: number; percentile: number | null }> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      locationId: reviewLocations.id,
      reviewCount: sql<number>`count(${reviewSubmissions.id})`,
    })
    .from(reviewLocations)
    .innerJoin(
      reviewDirectoryProfiles,
      eq(reviewDirectoryProfiles.locationId, reviewLocations.id),
    )
    .leftJoin(
      reviewSubmissions,
      and(
        eq(reviewSubmissions.locationId, reviewLocations.id),
        eq(reviewSubmissions.publicConsent, true),
        gte(reviewSubmissions.createdAt, since),
      ),
    )
    .where(
      and(
        eq(reviewLocations.industry, industry),
        isNull(reviewLocations.deletedAt),
        eq(reviewDirectoryProfiles.optIn, true),
      ),
    )
    .groupBy(reviewLocations.id);
  if (rows.length === 0) return { rank: null, total: 0, percentile: null };
  const sorted = rows
    .map((r) => ({ locationId: r.locationId, reviewCount: Number(r.reviewCount) }))
    .sort((a, b) => b.reviewCount - a.reviewCount);
  const idx = sorted.findIndex((r) => r.locationId === locationId);
  if (idx === -1) return { rank: null, total: sorted.length, percentile: null };
  return {
    rank: idx + 1,
    total: sorted.length,
    percentile: Math.max(1, Math.round(((idx + 1) / Math.max(1, sorted.length)) * 100)),
  };
}

/**
 * The canonical public path for a directory listing. ONE place builds it, so
 * the shape can never drift between the profile page, the badge, the owner's
 * "public profile URL" and the signature sync picker.
 */
export function directoryPath(brandSlug: string, locationSlug: string): string {
  return `/directory/${brandSlug}/${locationSlug}`;
}

/**
 * Segment-1 slugs that would shadow a directory sub-route. A brand slugging to
 * one of these gets a numeric suffix instead.
 */
const RESERVED_BRAND_SLUGS = new Set(['industry', 'search', 'api', 'badge', 'embed', 'r']);

/**
 * The brand's directory slug (URL segment 1), minting it on first use. Derived
 * from the business name and unique across brands *and* the alias table, so a
 * new brand can never steal a legacy URL that still points somewhere else.
 */
export async function ensureDirectoryBrandSlug(
  db: Db,
  brandId: string,
  businessName: string,
): Promise<string> {
  const [existing] = await db
    .select({ slug: reviewDirectoryBrands.slug })
    .from(reviewDirectoryBrands)
    .where(eq(reviewDirectoryBrands.brandId, brandId))
    .limit(1);
  if (existing) return existing.slug;

  const base = slugifyName(businessName, 60) || `business-${brandId.slice(0, 8)}`;
  let slug = RESERVED_BRAND_SLUGS.has(base) ? `${base}-2` : base;
  let attempt = 1;
  while (attempt < 50) {
    const lower = slug.toLowerCase();
    const [takenBrand] = await db
      .select({ brandId: reviewDirectoryBrands.brandId })
      .from(reviewDirectoryBrands)
      .where(sql`lower(${reviewDirectoryBrands.slug}) = ${lower}`)
      .limit(1);
    const aliasRows = takenBrand
      ? []
      : await db
          .select({ brandId: reviewDirectorySlugAliases.brandId })
          .from(reviewDirectorySlugAliases)
          .where(sql`lower(${reviewDirectorySlugAliases.slug}) = ${lower}`)
          .limit(1);
    const takenAlias = aliasRows[0];
    // Reclaiming an alias this same brand already owns is fine — it points here.
    const conflict =
      (takenBrand && takenBrand.brandId !== brandId) ||
      (takenAlias && takenAlias.brandId !== brandId);
    if (!conflict) break;
    attempt += 1;
    slug = `${base}-${attempt}`;
  }

  await db
    .insert(reviewDirectoryBrands)
    .values({ brandId, slug })
    .onConflictDoNothing({ target: reviewDirectoryBrands.brandId });
  const [row] = await db
    .select({ slug: reviewDirectoryBrands.slug })
    .from(reviewDirectoryBrands)
    .where(eq(reviewDirectoryBrands.brandId, brandId))
    .limit(1);
  return row?.slug ?? slug;
}

/** Ensure a location has a directory profile row (settings only — no slug). */
export async function ensureDirectoryProfile(
  db: Db,
  locationId: string,
  brandId: string,
): Promise<void> {
  await db
    .insert(reviewDirectoryProfiles)
    .values({ locationId, brandId })
    .onConflictDoNothing({ target: reviewDirectoryProfiles.locationId });
}

export type DirectoryTarget = {
  brandId: string;
  locationId: string;
  brandSlug: string;
  locationSlug: string;
  canonicalPath: string;
  /** False when the request arrived on a legacy/alias URL and should redirect. */
  isCanonical: boolean;
};

/** The brand's primary (oldest live) location — what a brand-level URL means. */
async function primaryLocationId(db: Db, brandId: string): Promise<string | null> {
  const [loc] = await db
    .select({ id: reviewLocations.id })
    .from(reviewLocations)
    .innerJoin(
      reviewDirectoryProfiles,
      eq(reviewDirectoryProfiles.locationId, reviewLocations.id),
    )
    .where(
      and(
        eq(reviewLocations.brandId, brandId),
        isNull(reviewLocations.deletedAt),
        eq(reviewDirectoryProfiles.optIn, true),
      ),
    )
    .orderBy(reviewLocations.createdAt)
    .limit(1);
  return loc?.id ?? null;
}

/**
 * Resolve a public directory URL to exactly one opt-in location, in a fixed
 * order so the answer is never ambiguous:
 *
 *   /directory/:brandSlug/:locationSlug  — canonical
 *   /directory/:brandSlug                — brand-level, → primary location
 *   /directory/:legacySlug               — alias table, → the location it named
 *   /directory/:locationSlug             — a bare location slug (or a past one)
 *
 * Everything but the first form reports `isCanonical: false`, and the caller
 * redirects to `canonicalPath`. That is what keeps every URL ever published —
 * brand-level or combined — working after the move to per-location listings.
 */
export async function resolveDirectoryTarget(
  db: Db,
  segment1: string,
  segment2?: string,
): Promise<DirectoryTarget | null> {
  const seg1 = segment1.trim().toLowerCase();
  const seg2 = segment2?.trim().toLowerCase();
  if (!seg1) return null;

  const finish = async (
    brandId: string,
    locationId: string,
    matchedCanonically: boolean,
  ): Promise<DirectoryTarget | null> => {
    const [row] = await db
      .select({
        locationId: reviewLocations.id,
        brandId: reviewLocations.brandId,
        locationSlug: reviewLocations.slug,
        businessName: brands.businessName,
      })
      .from(reviewLocations)
      .innerJoin(brands, eq(brands.id, reviewLocations.brandId))
      .innerJoin(
        reviewDirectoryProfiles,
        eq(reviewDirectoryProfiles.locationId, reviewLocations.id),
      )
      .where(
        and(
          eq(reviewLocations.id, locationId),
          eq(reviewLocations.brandId, brandId),
          isNull(reviewLocations.deletedAt),
          eq(reviewDirectoryProfiles.optIn, true),
        ),
      )
      .limit(1);
    if (!row) return null;
    const brandSlug = await ensureDirectoryBrandSlug(db, row.brandId, row.businessName);
    const isCanonical =
      matchedCanonically &&
      seg1 === brandSlug.toLowerCase() &&
      seg2 === row.locationSlug.toLowerCase();
    return {
      brandId: row.brandId,
      locationId: row.locationId,
      brandSlug,
      locationSlug: row.locationSlug,
      canonicalPath: directoryPath(brandSlug, row.locationSlug),
      isCanonical,
    };
  };

  // Segment 1 is a brand slug (live, then legacy alias).
  const [brandBySlug] = await db
    .select({ brandId: reviewDirectoryBrands.brandId })
    .from(reviewDirectoryBrands)
    .where(sql`lower(${reviewDirectoryBrands.slug}) = ${seg1}`)
    .limit(1);
  const [alias] = brandBySlug
    ? [null]
    : await db
        .select({
          brandId: reviewDirectorySlugAliases.brandId,
          locationId: reviewDirectorySlugAliases.locationId,
        })
        .from(reviewDirectorySlugAliases)
        .where(sql`lower(${reviewDirectorySlugAliases.slug}) = ${seg1}`)
        .limit(1);
  const brandId = brandBySlug?.brandId ?? alias?.brandId ?? null;

  if (brandId) {
    // With a location segment, it must belong to THIS brand — a location slug
    // under the wrong business is a 404, not a silent cross-brand match.
    if (seg2) {
      const loc = await locationBySlugOrHistory(db, seg2);
      if (loc && loc.brandId === brandId) return finish(brandId, loc.id, true);
      return null;
    }
    const locationId = alias?.locationId ?? (await primaryLocationId(db, brandId));
    if (!locationId) return null;
    return finish(brandId, locationId, false);
  }

  // Segment 1 wasn't a brand — try it as a location slug (current or renamed).
  if (!seg2) {
    const loc = await locationBySlugOrHistory(db, seg1);
    if (loc) return finish(loc.brandId, loc.id, false);
  }
  return null;
}

export type DirectoryProfile = {
  locationId: string;
  brandId: string;
  /** Display name — the business, qualified by the location when they differ. */
  name: string;
  locationName: string;
  brandName: string;
  brandSlug: string;
  locationSlug: string;
  /** Canonical `/directory/:brandSlug/:locationSlug`. */
  path: string;
  /** True when the request already arrived on `path`; false → redirect to it. */
  isCanonical: boolean;
  websiteUrl: string | null;
  description: string | null;
  city: string | null;
  /** Location logo (reviewLocations.logoUrl), falling back to brand logo. */
  logoUrl: string | null;
  totalReviews: number;
  avgRating: number;
  primaryIndustry: string;
  /** Sibling locations of the same brand that are themselves listed. */
  locations: Array<{
    id: string;
    name: string;
    industry: string;
    logoUrl: string | null;
    slug: string;
    path: string;
    isCurrent: boolean;
  }>;
  publicReviews: Array<{
    id: string;
    stars: number;
    generatedReview: string | null;
    selectedTags: string[];
    createdAt: Date;
    locationName: string;
  }>;
};

/**
 * Public directory profile for one opt-in LOCATION, resolved from either the
 * canonical `/directory/:brandSlug/:locationSlug` or any legacy URL — see
 * `resolveDirectoryTarget`. The returned `path` / `isCanonical` tell the caller
 * whether to redirect.
 */
export async function getDirectoryProfile(
  db: Db,
  segment1: string,
  segment2?: string,
): Promise<DirectoryProfile | null> {
  const target = await resolveDirectoryTarget(db, segment1, segment2);
  if (!target) return null;

  const [profile] = await db
    .select({
      locationId: reviewDirectoryProfiles.locationId,
      brandId: reviewDirectoryProfiles.brandId,
      websiteUrl: reviewDirectoryProfiles.websiteUrl,
      description: reviewDirectoryProfiles.description,
      city: reviewDirectoryProfiles.city,
      brandName: brands.businessName,
      brandLogo: brands.logoUrl,
      locationName: reviewLocations.name,
      locationLogo: reviewLocations.logoUrl,
      industry: reviewLocations.industry,
    })
    .from(reviewDirectoryProfiles)
    .innerJoin(reviewLocations, eq(reviewLocations.id, reviewDirectoryProfiles.locationId))
    .innerJoin(brands, eq(brands.id, reviewDirectoryProfiles.brandId))
    .where(eq(reviewDirectoryProfiles.locationId, target.locationId))
    .limit(1);
  if (!profile) return null;

  // Sibling locations of the same brand that are themselves listed — the
  // profile links across them, so a hidden location must not leak here.
  const siblingLocs = await db
    .select({
      id: reviewLocations.id,
      name: reviewLocations.name,
      industry: reviewLocations.industry,
      logoUrl: reviewLocations.logoUrl,
      slug: reviewLocations.slug,
    })
    .from(reviewLocations)
    .innerJoin(
      reviewDirectoryProfiles,
      eq(reviewDirectoryProfiles.locationId, reviewLocations.id),
    )
    .where(
      and(
        eq(reviewLocations.brandId, profile.brandId),
        isNull(reviewLocations.deletedAt),
        eq(reviewDirectoryProfiles.optIn, true),
      ),
    )
    .orderBy(reviewLocations.createdAt);

  // Scoped review stats for this location
  const [stats] = await db
    .select({
      count: sql<number>`count(*)`,
      avg: sql<number>`coalesce(avg(${reviewSubmissions.stars}), 0)`,
    })
    .from(reviewSubmissions)
    .where(
      and(
        eq(reviewSubmissions.locationId, profile.locationId),
        eq(reviewSubmissions.publicConsent, true),
      ),
    );

  const totalReviews = Number(stats?.count ?? 0);
  const avgRating = Math.round(Number(stats?.avg ?? 0) * 10) / 10;

  const reviewRows = await db
    .select({
      id: reviewSubmissions.id,
      stars: reviewSubmissions.stars,
      generatedReview: reviewSubmissions.generatedReview,
      selectedTags: reviewSubmissions.selectedTags,
      createdAt: reviewSubmissions.createdAt,
      locationName: reviewLocations.name,
    })
    .from(reviewSubmissions)
    .innerJoin(
      reviewLocations,
      eq(reviewSubmissions.locationId, reviewLocations.id),
    )
    .where(
      and(
        eq(reviewSubmissions.locationId, profile.locationId),
        eq(reviewSubmissions.publicConsent, true),
        sql`${reviewSubmissions.generatedReview} is not null and ${reviewSubmissions.generatedReview} <> ''`,
      ),
    )
    .orderBy(desc(reviewSubmissions.createdAt))
    .limit(24);

  const publicReviews = reviewRows.map((r) => ({
    ...r,
    selectedTags: r.selectedTags ?? [],
    locationName: r.locationName ?? profile.locationName,
  }));

  return {
    locationId: profile.locationId,
    brandId: profile.brandId,
    name: directoryDisplayName(profile.brandName, profile.locationName),
    locationName: profile.locationName,
    brandName: profile.brandName,
    brandSlug: target.brandSlug,
    locationSlug: target.locationSlug,
    path: target.canonicalPath,
    isCanonical: target.isCanonical,
    websiteUrl: profile.websiteUrl,
    description: profile.description,
    city: profile.city ?? null,
    logoUrl: profile.locationLogo ?? profile.brandLogo,
    totalReviews,
    avgRating,
    primaryIndustry: profile.industry ?? 'other',
    locations: siblingLocs.map((l) => ({
      id: l.id,
      name: l.name,
      industry: l.industry,
      logoUrl: l.logoUrl,
      slug: l.slug,
      path: directoryPath(target.brandSlug, l.slug),
      isCurrent: l.id === profile.locationId,
    })),
    publicReviews,
  };
}

/**
 * How a listing is labelled everywhere (search, leaderboard, profile, badge).
 * A location whose name just restates the business — the common single-location
 * case, plus the "Default" / "Main Location" placeholders — is NOT qualified,
 * so a one-shop business reads "Acme Coffee", not "Acme Coffee (Acme Coffee)".
 */
const PLACEHOLDER_LOCATION_NAMES = new Set(['default', 'main location', 'main', 'head office']);

export function directoryDisplayName(brandName: string, locationName: string): string {
  const loc = locationName?.trim() ?? '';
  if (
    !loc ||
    PLACEHOLDER_LOCATION_NAMES.has(loc.toLowerCase()) ||
    loc.toLowerCase() === brandName.trim().toLowerCase()
  ) {
    return brandName;
  }
  return `${brandName} — ${loc}`;
}

export type DirectoryListing = {
  locationId: string;
  brandId: string;
  name: string;
  brandName: string;
  locationName: string;
  brandSlug: string;
  locationSlug: string;
  /** Canonical `/directory/:brandSlug/:locationSlug` — link straight to this. */
  path: string;
  city: string | null;
  description: string | null;
  primaryIndustry: string | null;
  reviewCount: number;
  avgRating: number;
  logoUrl: string | null;
};

/** The columns every directory listing query selects — one shape, one mapper. */
const listingColumns = {
  locationId: reviewDirectoryProfiles.locationId,
  brandId: reviewDirectoryProfiles.brandId,
  city: reviewDirectoryProfiles.city,
  description: reviewDirectoryProfiles.description,
  brandName: brands.businessName,
  brandLogo: brands.logoUrl,
  brandSlug: reviewDirectoryBrands.slug,
  locationName: reviewLocations.name,
  locationLogo: reviewLocations.logoUrl,
  locationSlug: reviewLocations.slug,
  industry: reviewLocations.industry,
} as const;

type ListingRow = {
  locationId: string;
  brandId: string;
  city: string | null;
  description: string | null;
  brandName: string;
  brandLogo: string | null;
  brandSlug: string | null;
  locationName: string;
  locationLogo: string | null;
  locationSlug: string;
  industry: string;
};

/**
 * Attach public review aggregates to a set of listings. One grouped query for
 * the whole page — the previous per-row lookup issued up to 100 round trips per
 * directory search.
 */
async function aggregateListings(db: Db, profiles: ListingRow[]): Promise<DirectoryListing[]> {
  if (profiles.length === 0) return [];
  const statRows = await db
    .select({
      locationId: reviewSubmissions.locationId,
      count: sql<number>`count(*)`,
      avg: sql<number>`coalesce(avg(${reviewSubmissions.stars}), 0)`,
    })
    .from(reviewSubmissions)
    .where(
      and(
        inArray(
          reviewSubmissions.locationId,
          profiles.map((p) => p.locationId),
        ),
        eq(reviewSubmissions.publicConsent, true),
      ),
    )
    .groupBy(reviewSubmissions.locationId);
  const stats = new Map(statRows.map((s) => [s.locationId, s]));

  return profiles
    .map((p) => {
      const s = stats.get(p.locationId);
      // A brand with no slug row yet is simply not linkable; it is minted on the
      // owner's next directory read rather than written from a public search.
      const brandSlug = p.brandSlug ?? '';
      return {
        locationId: p.locationId,
        brandId: p.brandId,
        name: directoryDisplayName(p.brandName, p.locationName),
        brandName: p.brandName,
        locationName: p.locationName,
        brandSlug,
        locationSlug: p.locationSlug,
        path: brandSlug ? directoryPath(brandSlug, p.locationSlug) : `/directory/${p.locationSlug}`,
        city: p.city,
        description: p.description,
        primaryIndustry: p.industry || 'other',
        reviewCount: Number(s?.count ?? 0),
        avgRating: Math.round(Number(s?.avg ?? 0) * 10) / 10,
        logoUrl: p.locationLogo ?? p.brandLogo,
      };
    })
    .sort((a, b) => b.reviewCount - a.reviewCount || a.name.localeCompare(b.name));
}

/** Fuzzy directory search by business name, location name or city (opt-in locations only). */
export async function searchDirectory(
  db: Db,
  query: string,
  limit = 20,
): Promise<DirectoryListing[]> {
  const trimmed = query.replace(/[%_\\]/g, '').trim();
  if (!trimmed) return [];
  const q = `%${trimmed}%`;
  const profiles = await db
    .select(listingColumns)
    .from(reviewDirectoryProfiles)
    .innerJoin(reviewLocations, eq(reviewLocations.id, reviewDirectoryProfiles.locationId))
    .innerJoin(brands, eq(brands.id, reviewDirectoryProfiles.brandId))
    .leftJoin(reviewDirectoryBrands, eq(reviewDirectoryBrands.brandId, reviewDirectoryProfiles.brandId))
    .where(
      and(
        eq(reviewDirectoryProfiles.optIn, true),
        isNull(reviewLocations.deletedAt),
        sql`(${brands.businessName} ilike ${q} or ${reviewLocations.name} ilike ${q} or ${reviewDirectoryProfiles.city} ilike ${q})`,
      ),
    )
    .limit(100);
  const listings = await aggregateListings(db, profiles);
  return listings.slice(0, limit);
}

/** Top locations in an industry, ranked by public review volume (leaderboard). */
export async function getIndustryLeaderboard(
  db: Db,
  industrySlug: string,
  limit = 20,
): Promise<
  Array<DirectoryListing & { rank: number; isBestInIndustry: boolean }>
> {
  const profiles = await db
    .select(listingColumns)
    .from(reviewDirectoryProfiles)
    .innerJoin(reviewLocations, eq(reviewLocations.id, reviewDirectoryProfiles.locationId))
    .innerJoin(brands, eq(brands.id, reviewDirectoryProfiles.brandId))
    .leftJoin(reviewDirectoryBrands, eq(reviewDirectoryBrands.brandId, reviewDirectoryProfiles.brandId))
    .where(
      and(
        eq(reviewDirectoryProfiles.optIn, true),
        isNull(reviewLocations.deletedAt),
        eq(reviewLocations.industry, industrySlug),
      ),
    );
  const listings = await aggregateListings(db, profiles);
  return listings.slice(0, limit).map((l, i) => ({
    ...l,
    rank: i + 1,
    isBestInIndustry: i < 3,
  }));
}
