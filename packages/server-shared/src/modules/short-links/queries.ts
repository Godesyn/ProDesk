/**
 * Short-links — shared read/query helpers used by BOTH the tRPC router
 * (shortLinks.ts) and the AI chatbot tools (ai/tools/links.ts).
 *
 * Each function takes an already-authorized `brandId` and performs NO permission
 * check — the caller gates access first (tRPC via assertBrandAccess*, the AI
 * tools via the brand-bound ToolModuleCtx). They return raw rows / a computed
 * superset; each caller keeps its own projection on top (UI shape + cursor vs.
 * the token-lean model shape). This is the single source of truth for the query
 * logic so the chatbot and the dashboard can never silently drift apart.
 */
import { and, count, countDistinct, desc, eq, gte, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import {
  brands,
  linkDestinationWindows,
  linkEvents,
  shortLinks,
  type ShortLinkKind,
} from '../../db/schema.js';
import {
  activeWindow,
  nextScheduleChange,
  resolveCampaignDestination,
} from './campaign-schedule.js';

/** Encode a keyset cursor from the last row's (createdAt, id). */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`, 'utf8').toString('base64url');
}
/** Decode a keyset cursor; returns null if absent or malformed. */
export function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const [createdAt, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    if (!createdAt || !id) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

export interface ListShortLinksOpts {
  search?: string;
  /** 'link' = plain short links, 'campaign' = scheduled links. Omit for both. */
  kind?: ShortLinkKind;
  /** Filter by active state: true=active, false=inactive, omit=all. */
  isActive?: boolean;
  /** Page size. The caller adds its own cap (tool=30, tRPC=1–100). */
  limit: number;
  /** Keyset cursor from a previous page (base64 of `<createdAt ISO>|<id>`). */
  cursor?: string;
}

/**
 * Brand-scoped short links, newest first, keyset-paginated on (createdAt, id).
 * Returns the full rows plus a nextCursor; callers project as they need.
 */
export async function listShortLinks(db: DB, brandId: string, opts: ListShortLinksOpts) {
  const filters = [eq(shortLinks.brandId, brandId)];
  if (opts.kind) filters.push(eq(shortLinks.kind, opts.kind));
  if (opts.isActive !== undefined) filters.push(eq(shortLinks.isActive, opts.isActive));
  if (opts.search) {
    const like = '%' + opts.search + '%';
    filters.push(
      sql`(${shortLinks.nickname} ILIKE ${like} OR ${shortLinks.slug} ILIKE ${like} OR ${shortLinks.destinationUrl} ILIKE ${like})`,
    );
  }
  const cur = decodeCursor(opts.cursor);
  if (cur) {
    filters.push(sql`(${shortLinks.createdAt}, ${shortLinks.id}) < (${cur.createdAt}, ${cur.id})`);
  }
  const rows = await db
    .select()
    .from(shortLinks)
    .where(and(...filters))
    .orderBy(desc(shortLinks.createdAt), desc(shortLinks.id))
    .limit(opts.limit + 1); // fetch one extra to detect a next page

  const hasMore = rows.length > opts.limit;
  const items = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;
  return { items, nextCursor };
}

/**
 * Every destination window for a set of campaign links, grouped by link id and
 * ordered newest-start-first. One query for a page of campaigns (no N+1), so the
 * list can show each campaign's schedule and what it currently resolves to.
 */
export async function windowsByLink(
  db: DB,
  linkIds: string[],
): Promise<Map<string, (typeof linkDestinationWindows.$inferSelect)[]>> {
  const out = new Map<string, (typeof linkDestinationWindows.$inferSelect)[]>();
  if (linkIds.length === 0) return out;
  const rows = await db
    .select()
    .from(linkDestinationWindows)
    .where(inArray(linkDestinationWindows.linkId, linkIds))
    .orderBy(desc(linkDestinationWindows.startsAt));
  for (const r of rows) {
    const list = out.get(r.linkId) ?? [];
    list.push(r);
    out.set(r.linkId, list);
  }
  return out;
}

/**
 * Brand-scoped campaigns (kind='campaign') with their windows attached and the
 * destination each one serves RIGHT NOW, resolved through the shared schedule
 * rule so the list can never disagree with the redirector.
 *
 * Backs both the tRPC campaigns.list and the AI chatbot's list_link_campaigns.
 */
export async function listCampaignsWithSchedule(
  db: DB,
  brandId: string,
  opts: { search?: string; isActive?: boolean; limit: number; cursor?: string },
  now: Date = new Date(),
) {
  const { items, nextCursor } = await listShortLinks(db, brandId, {
    ...opts,
    kind: 'campaign',
  });
  const windows = await windowsByLink(db, items.map((l) => l.id));
  return {
    nextCursor,
    items: items.map((l) => {
      const ws = windows.get(l.id) ?? [];
      return {
        ...l,
        windows: ws,
        // What a visitor hitting this slug gets at `now`, and when that changes.
        current: resolveCampaignDestination(l, ws, now),
        activeWindowId: activeWindow(ws, now)?.id ?? null,
        nextChangeAt: nextScheduleChange(ws, now),
      };
    }),
  };
}

export interface LinkAnalyticsOpts {
  /** Event window in days (1–365). Caller validates the range. */
  days?: number;
  /** Include bot/prefetch hits in the windowed event breakdowns. */
  includeBots?: boolean;
  /** How many top links to return (default 10). */
  topLimit?: number;
}

/**
 * Full click-analytics superset for a brand: all-time totals + top links, plus
 * the windowed event-based series and
 * device/browser/os/referrer/country/source breakdowns from link_events.
 * Both the dashboard (`shortLinks.analytics`) and the chatbot read this; the
 * chatbot returns a subset.
 */
export async function getLinkAnalytics(db: DB, brandId: string, opts: LinkAnalyticsOpts = {}) {
  const days = opts.days ?? 30;
  const includeBots = opts.includeBots ?? false;
  const topLimit = opts.topLimit ?? 10;

  const scope = [eq(shortLinks.brandId, brandId)];

  const [totals] = await db
    .select({
      totalLinks: count(),
      activeLinks: sql<number>`count(*) filter (where ${shortLinks.isActive})`,
      totalClicks: sql<number>`coalesce(sum(${shortLinks.clickCount}), 0)`,
    })
    .from(shortLinks)
    .where(and(...scope));

  const topLinks = await db
    .select({
      id: shortLinks.id,
      slug: shortLinks.slug,
      nickname: shortLinks.nickname,
      clickCount: shortLinks.clickCount,
      isActive: shortLinks.isActive,
    })
    .from(shortLinks)
    .where(and(...scope))
    .orderBy(desc(shortLinks.clickCount))
    .limit(topLimit);

  // ── Event-based windowed analytics (link_events) ──────────────────────
  const since = new Date(Date.now() - days * 86_400_000);
  const evScope = [eq(linkEvents.brandId, brandId), gte(linkEvents.occurredAt, since)];
  if (!includeBots) evScope.push(eq(linkEvents.isBot, false));

  const dayExpr = sql<string>`to_char(date_trunc('day', ${linkEvents.occurredAt}), 'YYYY-MM-DD')`;
  const seriesRows = await db
    .select({ day: dayExpr, clicks: count(), unique: countDistinct(linkEvents.ipHash) })
    .from(linkEvents)
    .where(and(...evScope))
    .groupBy(dayExpr)
    .orderBy(dayExpr);

  // Fill gaps so the chart has one bucket per day across the window.
  const byDay = new Map(
    seriesRows.map((r) => [r.day, { clicks: Number(r.clicks), unique: Number(r.unique) }]),
  );
  const series: { day: string; clicks: number; unique: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ day: d, clicks: 0, unique: 0, ...byDay.get(d) });
  }

  const breakdown = async (col: AnyColumn | SQL, fallback: string) => {
    const keyExpr = sql<string>`coalesce(nullif(${col}, ''), ${fallback})`;
    const rows = await db
      .select({ key: keyExpr, n: count() })
      .from(linkEvents)
      .where(and(...evScope))
      // Group by the SELECT ordinal, not by re-emitting keyExpr: `fallback` is a
      // bind parameter, so re-emitting the expression gives GROUP BY a different
      // parameter position than SELECT and Postgres rejects it (42803). `group by
      // 1` refers to the first output column (keyExpr) and sidesteps the mismatch.
      .groupBy(sql`1`)
      .orderBy(desc(count()))
      .limit(8);
    return rows.map((r) => ({ key: r.key, n: Number(r.n) }));
  };

  const [byDevice, byBrowser, byOs, byReferrer, byCountry, bySource, [eventTotals], [botTotals]] =
    await Promise.all([
      breakdown(linkEvents.device, 'other'),
      breakdown(linkEvents.browser, 'Unknown'),
      breakdown(linkEvents.os, 'Unknown'),
      breakdown(linkEvents.referrerHost, 'Direct / none'),
      breakdown(linkEvents.country, 'Unknown'),
      breakdown(linkEvents.source, 'link'),
      db.select({ clicks: count(), unique: countDistinct(linkEvents.ipHash) }).from(linkEvents).where(and(...evScope)),
      // Bot hits in the window regardless of the includeBots filter, so the UI
      // can show "+N filtered" even when they're excluded.
      db
        .select({ bots: count() })
        .from(linkEvents)
        .where(
          and(
            eq(linkEvents.brandId, brandId),
            gte(linkEvents.occurredAt, since),
            eq(linkEvents.isBot, true),
          ),
        ),
    ]);

  return {
    totalLinks: Number(totals?.totalLinks ?? 0),
    activeLinks: Number(totals?.activeLinks ?? 0),
    totalClicks: Number(totals?.totalClicks ?? 0),
    topLinks: topLinks.map((l) => ({ ...l, clickCount: Number(l.clickCount) })),
    days,
    windowClicks: Number(eventTotals?.clicks ?? 0),
    uniqueVisitors: Number(eventTotals?.unique ?? 0),
    botCount: Number(botTotals?.bots ?? 0),
    includeBots,
    series,
    byDevice,
    byBrowser,
    byOs,
    byReferrer,
    byCountry,
    bySource,
  };
}

/** The brand's default QR design (seeds new links). Null when unset. */
export async function getBrandDefaultQrConfig(db: DB, brandId: string) {
  const [b] = await db
    .select({ cfg: brands.defaultLinkQrConfig })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return b?.cfg ?? null;
}
