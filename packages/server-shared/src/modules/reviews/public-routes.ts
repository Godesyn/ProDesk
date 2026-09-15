/**
 * Public, unauthenticated Express routes for the Reviews tool — the embeddable
 * review widget (iframe + JSON config + analytics beacon) and the directory
 * badge. Ported from the Manus export's embedRoutes.ts / badgeRoutes.ts and
 * folded into the single backend Express app (no second server). Framed on any
 * origin: these serve public read-only data only.
 */
import type { Express, Request, Response } from 'express';
import express from 'express';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import {
  reviewEmbedCollectionLocations,
  reviewEmbedCollections,
  reviewEmbedConfigs,
  reviewEmbedViews,
  reviewLocations,
  reviewSubmissions,
  reviewWinTags,
} from '../../db/schema.js';
import {
  DEFAULT_EMBED_THEME,
  EMBED_THEME_UNLOCK_LOCATION_REVIEWS,
  EMBED_UNLOCK_ACCOUNT_REVIEWS,
  sanitizeTheme,
  type ReviewEmbedTheme,
} from './embed.js';
import {
  pickPublicReviews,
  renderEmbedHtml,
  renderReviewCard,
  renderLockedHtml,
  type EmbedReview,
} from './embed-render.js';
import { renderBadgeHtml } from './badge-render.js';
import { sanitizeBadgeTheme } from './badge-theme.js';
import { emailBaseUrl } from '../email/branding.js';
import {
  countBrandReviews,
  countLocationReviews,
  getDirectoryProfile,
  getIndustryRankForLocation,
  locationBySlugOrHistory,
} from './queries.js';

function setEmbedHeaders(res: Response) {
  res.removeHeader?.('X-Frame-Options');
  res.setHeader('Content-Security-Policy', 'frame-ancestors *');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
}

// Resolves via slug history too, so embeds installed before a rename keep working.
async function locationBySlug(slug: string) {
  return locationBySlugOrHistory(db, slug);
}

async function collectionBySlug(slug: string) {
  const [col] = await db
    .select()
    .from(reviewEmbedCollections)
    .where(eq(reviewEmbedCollections.slug, slug))
    .limit(1);
  return col ?? null;
}

async function publicSubmissions(locationId: string, locationName?: string) {
  const rows = await db
    .select({
      id: reviewSubmissions.id,
      stars: reviewSubmissions.stars,
      generatedReview: reviewSubmissions.generatedReview,
      createdAt: reviewSubmissions.createdAt,
    })
    .from(reviewSubmissions)
    .where(
      and(
        eq(reviewSubmissions.locationId, locationId),
        eq(reviewSubmissions.submissionType, 'public'),
      ),
    )
    .orderBy(desc(reviewSubmissions.createdAt))
    .limit(50);
  return pickPublicReviews(rows.map((r) => ({ ...r, locationName })));
}

/** How many cards each embed page holds. Kept in sync with the `&limit=` the embed
 *  HTML's lazy-loader requests; the endpoint clamps to {@link EMBED_PAGE_MAX}. */
const EMBED_PAGE_SIZE = 8;
const EMBED_PAGE_MAX = 24;

/** Encoded keyset cursor: `${createdAtMs}_${id}`. `id` is a uuid (no underscores),
 *  so we split on the first underscore to recover both halves. */
function encodeCursor(r: { createdAt: number; id: string | number }): string {
  return `${r.createdAt}_${r.id}`;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseCursor(raw: unknown): { ts: number; id: string } | null {
  if (typeof raw !== 'string') return null;
  const i = raw.indexOf('_');
  if (i < 0) return null;
  const ts = Number(raw.slice(0, i));
  const id = raw.slice(i + 1);
  // Reject a malformed id (client-supplied) so it can't reach the uuid cast and 500
  // the request — an unparseable cursor just falls back to the first page.
  if (!Number.isFinite(ts) || !UUID_RE.test(id)) return null;
  return { ts, id };
}
function clampLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return EMBED_PAGE_SIZE;
  return Math.min(EMBED_PAGE_MAX, n);
}

/**
 * One keyset page of public, text-bearing reviews across one or more locations,
 * newest first, ordered by `(createdAt desc, id desc)`. The text/star filters live
 * in SQL so paging stays consistent (a JS post-filter would make pages ragged and
 * the cursor lie). Returns the page plus the cursor for the NEXT page (null when
 * the pool is exhausted). Powers both the initial embed render and `/reviews.json`.
 */
async function publicReviewsPage(opts: {
  locationIds: string[];
  cursor: { ts: number; id: string } | null;
  limit: number;
  minStars?: number;
  includeLocationName?: boolean;
}): Promise<{ reviews: EmbedReview[]; nextCursor: string | null }> {
  const { locationIds, cursor, limit, minStars, includeLocationName } = opts;
  if (locationIds.length === 0) return { reviews: [], nextCursor: null };
  const conds = [
    inArray(reviewSubmissions.locationId, locationIds),
    eq(reviewSubmissions.submissionType, 'public'),
    sql`length(trim(coalesce(${reviewSubmissions.generatedReview}, ''))) > 0`,
  ];
  if (minStars != null) conds.push(sql`${reviewSubmissions.stars} >= ${minStars}`);
  if (cursor) {
    // Strictly "older than" the cursor tuple, matching the (createdAt desc, id desc)
    // sort. ISO string + ::timestamptz cast — never a JS Date in a raw sql fragment.
    const iso = new Date(cursor.ts).toISOString();
    conds.push(
      sql`(${reviewSubmissions.createdAt} < ${iso}::timestamptz OR (${reviewSubmissions.createdAt} = ${iso}::timestamptz AND ${reviewSubmissions.id} < ${cursor.id}))`,
    );
  }
  // Fetch one extra to know whether a further page exists without a second query.
  const rows = await db
    .select({
      id: reviewSubmissions.id,
      stars: reviewSubmissions.stars,
      generatedReview: reviewSubmissions.generatedReview,
      createdAt: reviewSubmissions.createdAt,
      locationName: reviewLocations.name,
    })
    .from(reviewSubmissions)
    .leftJoin(reviewLocations, eq(reviewLocations.id, reviewSubmissions.locationId))
    .where(and(...conds))
    .orderBy(desc(reviewSubmissions.createdAt), desc(reviewSubmissions.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const reviews = pickPublicReviews(
    page.map((r) => ({
      id: r.id,
      stars: r.stars,
      generatedReview: r.generatedReview,
      createdAt: r.createdAt,
      locationName: includeLocationName ? (r.locationName ?? undefined) : undefined,
    })),
  );
  const last = reviews[reviews.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;
  return { reviews, nextCursor };
}

function recordView(data: { locationId?: string; collectionId?: string; referrer?: string | null }) {
  void db
    .insert(reviewEmbedViews)
    .values({
      locationId: data.locationId ?? null,
      collectionId: data.collectionId ?? null,
      referrer: data.referrer ?? null,
    })
    .catch((e) => console.warn('[reviews embedView]', e));
}

export function mountReviewPublicRoutes(app: Express) {
  // Single-location embed iframe.
  app.get('/embed/loc/:slug', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    const loc = await locationBySlug(String(req.params.slug ?? '').trim());
    if (!loc || loc.deletedAt) return res.status(410).send('Gone');
    const brandReviews = await countBrandReviews(db, loc.brandId);
    if (brandReviews < EMBED_UNLOCK_ACCOUNT_REVIEWS) {
      return res
        .status(402)
        .send(renderLockedHtml(`Embed unlocks at ${EMBED_UNLOCK_ACCOUNT_REVIEWS} reviews.`));
    }
    const [cfg] = await db
      .select()
      .from(reviewEmbedConfigs)
      .where(eq(reviewEmbedConfigs.locationId, loc.id))
      .limit(1);
    const locationReviews = await countLocationReviews(db, loc.id);
    const brandedUnlocked = locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS;
    const theme = sanitizeTheme(cfg?.theme ?? DEFAULT_EMBED_THEME, brandedUnlocked);
    // wall/carousel lazy-load further pages from /reviews.json; marquee/hero are
    // deliberately small showcases, so they still render their bounded set eagerly.
    const paginated = theme.variant === 'carousel' || theme.variant === 'wall';
    let reviews: EmbedReview[];
    let nextCursor: string | null = null;
    if (paginated) {
      const page = await publicReviewsPage({
        locationIds: [loc.id],
        cursor: null,
        limit: EMBED_PAGE_SIZE,
        minStars: theme.onlyFiveStar ? 5 : undefined,
      });
      reviews = page.reviews;
      nextCursor = page.nextCursor;
    } else {
      reviews = await publicSubmissions(loc.id);
    }
    const winTags = await db
      .select({ label: reviewWinTags.label })
      .from(reviewWinTags)
      .where(eq(reviewWinTags.locationId, loc.id))
      .orderBy(reviewWinTags.sortOrder, reviewWinTags.id);
    const html = renderEmbedHtml({
      title: loc.name,
      reviews,
      theme,
      brandedUnlocked,
      configUrl: `/embed/loc/${loc.slug}/config.json`,
      logoUrl: loc.logoUrl,
      winTags: winTags.map((w) => w.label),
      reviewsUrl: paginated ? `/embed/loc/${loc.slug}/reviews.json` : undefined,
      nextCursor,
    });
    recordView({ locationId: loc.id, referrer: req.get('referer') });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // Multi-location collection embed iframe.
  app.get('/embed/col/:slug', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    const col = await collectionBySlug(String(req.params.slug ?? '').trim());
    if (!col) return res.status(404).send('Not found');
    const links = await db
      .select({
        locationId: reviewEmbedCollectionLocations.locationId,
        locationName: reviewLocations.name,
      })
      .from(reviewEmbedCollectionLocations)
      .leftJoin(reviewLocations, eq(reviewLocations.id, reviewEmbedCollectionLocations.locationId))
      .where(eq(reviewEmbedCollectionLocations.collectionId, col.id))
      .orderBy(reviewEmbedCollectionLocations.sortOrder);
    const theme = sanitizeTheme((col.theme as ReviewEmbedTheme) ?? DEFAULT_EMBED_THEME, true);
    const paginated = theme.variant === 'carousel' || theme.variant === 'wall';
    let reviews: EmbedReview[] = [];
    let nextCursor: string | null = null;
    if (paginated) {
      // One keyset query across every location in the collection (merged newest-first)
      // instead of fetching each location's full history and merging in memory.
      const page = await publicReviewsPage({
        locationIds: links.map((l) => l.locationId),
        cursor: null,
        limit: EMBED_PAGE_SIZE,
        minStars: theme.onlyFiveStar ? 5 : undefined,
        includeLocationName: true,
      });
      reviews = page.reviews;
      nextCursor = page.nextCursor;
    } else {
      for (const link of links) {
        reviews.push(...(await publicSubmissions(link.locationId, link.locationName ?? undefined)));
      }
      reviews.sort((a, b) => b.createdAt - a.createdAt);
    }
    const html = renderEmbedHtml({
      title: col.name,
      reviews,
      theme,
      brandedUnlocked: true,
      configUrl: `/embed/col/${col.slug}/config.json`,
      reviewsUrl: paginated ? `/embed/col/${col.slug}/reviews.json` : undefined,
      nextCursor,
    });
    recordView({ collectionId: col.id, referrer: req.get('referer') });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  // Keyset page of pre-rendered review cards for the single-location embed iframe.
  // Returns `{ cards: string[], nextCursor: string | null }` — the iframe's lazy
  // loader appends `cards` and re-requests with `?cursor=nextCursor` until it's null.
  app.get('/embed/loc/:slug/reviews.json', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    res.set('Content-Type', 'application/json; charset=utf-8');
    const loc = await locationBySlug(String(req.params.slug ?? '').trim());
    if (!loc || loc.deletedAt) return res.status(404).json({ error: 'not_found' });
    const brandReviews = await countBrandReviews(db, loc.brandId);
    if (brandReviews < EMBED_UNLOCK_ACCOUNT_REVIEWS) return res.status(402).json({ error: 'locked' });
    const [cfg] = await db
      .select()
      .from(reviewEmbedConfigs)
      .where(eq(reviewEmbedConfigs.locationId, loc.id))
      .limit(1);
    const locationReviews = await countLocationReviews(db, loc.id);
    const brandedUnlocked = locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS;
    const theme = sanitizeTheme(cfg?.theme ?? DEFAULT_EMBED_THEME, brandedUnlocked);
    const { reviews, nextCursor } = await publicReviewsPage({
      locationIds: [loc.id],
      cursor: parseCursor(req.query.cursor),
      limit: clampLimit(req.query.limit),
      minStars: theme.onlyFiveStar ? 5 : undefined,
    });
    res.json({ cards: reviews.map((r) => renderReviewCard(r, theme)), nextCursor });
  });

  // Keyset page of review cards for the multi-location collection embed iframe.
  app.get('/embed/col/:slug/reviews.json', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    res.set('Content-Type', 'application/json; charset=utf-8');
    const col = await collectionBySlug(String(req.params.slug ?? '').trim());
    if (!col) return res.status(404).json({ error: 'not_found' });
    const links = await db
      .select({ locationId: reviewEmbedCollectionLocations.locationId })
      .from(reviewEmbedCollectionLocations)
      .where(eq(reviewEmbedCollectionLocations.collectionId, col.id));
    const theme = sanitizeTheme((col.theme as ReviewEmbedTheme) ?? DEFAULT_EMBED_THEME, true);
    const { reviews, nextCursor } = await publicReviewsPage({
      locationIds: links.map((l) => l.locationId),
      cursor: parseCursor(req.query.cursor),
      limit: clampLimit(req.query.limit),
      minStars: theme.onlyFiveStar ? 5 : undefined,
      includeLocationName: true,
    });
    res.json({ cards: reviews.map((r) => renderReviewCard(r, theme)), nextCursor });
  });

  // JSON config for the web-component variant.
  app.get('/embed/loc/:slug/config.json', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    res.set('Content-Type', 'application/json; charset=utf-8');
    const loc = await locationBySlug(String(req.params.slug ?? '').trim());
    if (!loc) return res.status(404).json({ error: 'not_found' });
    const brandReviews = await countBrandReviews(db, loc.brandId);
    if (brandReviews < EMBED_UNLOCK_ACCOUNT_REVIEWS) return res.status(402).json({ error: 'locked' });
    const [cfg] = await db
      .select()
      .from(reviewEmbedConfigs)
      .where(eq(reviewEmbedConfigs.locationId, loc.id))
      .limit(1);
    const locationReviews = await countLocationReviews(db, loc.id);
    const brandedUnlocked = locationReviews >= EMBED_THEME_UNLOCK_LOCATION_REVIEWS;
    const theme = sanitizeTheme(cfg?.theme ?? DEFAULT_EMBED_THEME, brandedUnlocked);
    res.json({
      title: loc.name,
      slug: loc.slug,
      theme,
      logoUrl: theme.showLogo ? loc.logoUrl : null,
      reviews: await publicSubmissions(loc.id),
    });
  });

  // JSON config for a multi-location collection (the collection iframe passes
  // this URL as its data-pm-config; without it the web component 404s).
  app.get('/embed/col/:slug/config.json', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    res.set('Content-Type', 'application/json; charset=utf-8');
    const col = await collectionBySlug(String(req.params.slug ?? '').trim());
    if (!col) return res.status(404).json({ error: 'not_found' });
    const links = await db
      .select({
        locationId: reviewEmbedCollectionLocations.locationId,
        locationName: reviewLocations.name,
      })
      .from(reviewEmbedCollectionLocations)
      .leftJoin(reviewLocations, eq(reviewLocations.id, reviewEmbedCollectionLocations.locationId))
      .where(eq(reviewEmbedCollectionLocations.collectionId, col.id))
      .orderBy(reviewEmbedCollectionLocations.sortOrder);
    const all: EmbedReview[] = [];
    for (const link of links) {
      all.push(...(await publicSubmissions(link.locationId, link.locationName ?? undefined)));
    }
    all.sort((a, b) => b.createdAt - a.createdAt);
    res.json({
      title: col.name,
      slug: col.slug,
      theme: sanitizeTheme((col.theme as ReviewEmbedTheme) ?? DEFAULT_EMBED_THEME, true),
      reviews: all,
    });
  });

  // Analytics beacon (web-component variant).
  app.post('/embed/beacon', express.json({ limit: '1kb' }), async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    const body = req.body as { locationSlug?: string; collectionSlug?: string } | undefined;
    if (!body) return res.status(204).end();
    if (body.locationSlug) {
      const loc = await locationBySlug(body.locationSlug);
      if (loc) recordView({ locationId: loc.id, referrer: req.get('referer') });
    } else if (body.collectionSlug) {
      const col = await collectionBySlug(body.collectionSlug);
      if (col) recordView({ collectionId: col.id, referrer: req.get('referer') });
    }
    res.status(204).end();
  });

  // Directory "best in industry" badge data (used by an embeddable badge).
  app.get('/badge/:slug.json', async (req: Request, res: Response) => {
    setEmbedHeaders(res);
    res.set('Content-Type', 'application/json; charset=utf-8');
    const profile = await getDirectoryProfile(
      db,
      String(req.params.slug ?? '').trim(),
      typeof req.query.location === 'string' ? req.query.location : undefined,
    );
    if (!profile) return res.status(404).json({ error: 'not_found' });
    res.json({
      name: profile.name,
      avgRating: profile.avgRating,
      reviewCount: profile.totalReviews,
      primaryIndustry: profile.primaryIndustry,
      profilePath: profile.path,
    });
  });

  // Directory "Verdiict Verified" badge widget — embeddable iframe HTML.
  // Registered after `/badge/:slug.json` so `.json` requests keep hitting the
  // JSON route (Express matches in registration order).
  app.get('/badge/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!slug) return res.status(400).send('Missing slug');
    const profile = await getDirectoryProfile(
      db,
      slug,
      typeof req.query.location === 'string' ? req.query.location : undefined,
    );
    if (!profile) return res.status(404).send('Business not found or not listed in directory');
    const rank = profile.primaryIndustry
      ? await getIndustryRankForLocation(db, profile.locationId, profile.primaryIndustry)
      : null;
    const isBestInIndustry = rank?.rank != null && rank.rank <= 3;
    // The directory profile lives on the reviews FRONTEND, not this API origin.
    // The snippet passes the frontend origin as `?o=`; validate it against the
    // same allow-list email links use (client-controlled input) before trusting.
    const origin = typeof req.query.o === 'string' ? req.query.o : null;
    const baseUrl = emailBaseUrl(origin).replace(/\/$/, '');
    const industryLabel = (profile.primaryIndustry || 'industry')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    // The badge's design travels in the query string (see badge-theme.ts) rather
    // than the DB, so one brand can style differently-placed badges and the
    // response stays cacheable per-URL. Whitelisted before it reaches the render.
    const theme = sanitizeBadgeTheme(req.query);
    setEmbedHeaders(res);
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.set('Content-Type', 'text/html; charset=utf-8').send(
      renderBadgeHtml({
        name: profile.name,
        avgRating: profile.avgRating,
        reviewCount: profile.totalReviews,
        profileUrl: `${baseUrl}${profile.path}`,
        isBestInIndustry,
        industry: industryLabel,
        logoUrl: profile.logoUrl,
        theme,
      }),
    );
  });
}
