import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { outreachListRuns, outreachRegions, type OutreachRegion } from '../../../db/schema.js';
import type { GeoJsonArea } from '../../../lib/geojson.js';
import { interiorPointOf } from '../../../lib/geometry.js';
import { childRegionsOf, RegionHierarchyError } from './providers/region-hierarchy.js';

/**
 * The gazetteer: what we know about what is inside what.
 *
 * This is the replacement for the 38 hand-written region names that used to be
 * the coverage map's denominator. Nothing in here is authored — a region enters
 * because a run was started for it, and its contents enter because we asked
 * OpenStreetMap. See migration 0104 for why the list had to go.
 *
 * Two writes, deliberately split:
 *
 *  • `rememberRegion` is synchronous, local and free. It runs on the path that
 *    starts a run, so the region the operator just picked is on the map
 *    immediately, before anything has been scraped.
 *  • `discoverChildrenFor` talks to Overpass and takes five to fifteen seconds.
 *    It runs in the Worker. Nothing waits on it, and a run is never blocked by
 *    a donation-funded geocoding service having a bad afternoon.
 */

/**
 * Put a region on the map.
 *
 * Called when a run is created, with what region search already resolved — so
 * it costs nothing and cannot fail in a way that should stop a run. Existing
 * rows are refreshed but never downgraded: `children_fetched_at` and its
 * companions are left alone, because re-picking a region is not a reason to
 * throw away an enumeration that cost an Overpass query.
 */
export async function rememberRegion(input: {
  osmId: string;
  label: string;
  countryCode: string;
  adminLevel: number | null;
  boundary: GeoJsonArea;
}): Promise<void> {
  const point = interiorPointOf(input.boundary);
  await db
    .insert(outreachRegions)
    .values({
      osmId: input.osmId,
      label: input.label,
      countryCode: input.countryCode,
      adminLevel: input.adminLevel,
      point,
    })
    .onConflictDoUpdate({
      target: outreachRegions.osmId,
      set: {
        label: input.label,
        countryCode: input.countryCode,
        adminLevel: input.adminLevel,
        point,
        updatedAt: new Date(),
      },
    });
}

/**
 * Ask OpenStreetMap what is inside a region, and write down the answer.
 *
 * The parent's boundary comes off its ledger row rather than being re-fetched,
 * for the same reason the scrape uses the stored one: OSM boundaries are edited
 * continuously, and the polygon that decides what counts as covered must be the
 * polygon that was actually scraped. A region with no run carrying a boundary
 * is skipped — there is nothing to test containment against.
 *
 * Failure is recorded, not thrown. An Overpass outage must read as "we could
 * not ask" in the UI, never as "this region contains nothing".
 */
export async function discoverChildrenFor(osmId: string): Promise<{
  status: 'stored' | 'empty' | 'failed' | 'skipped';
  children?: number;
}> {
  const [parent] = await db
    .select()
    .from(outreachRegions)
    .where(eq(outreachRegions.osmId, osmId))
    .limit(1);
  if (!parent) return { status: 'skipped' };

  // Any run for this region, whatever the vertical: the boundary is a property
  // of the region, and every run that named it was scraped against the same one.
  const [run] = await db
    .select({ boundary: outreachListRuns.regionBoundary })
    .from(outreachListRuns)
    .where(
      and(
        eq(outreachListRuns.placeId, osmId),
        sql`${outreachListRuns.regionBoundary} IS NOT NULL`,
      ),
    )
    .orderBy(desc(outreachListRuns.createdAt))
    .limit(1);
  if (!run?.boundary) return { status: 'skipped' };

  let discovery = null;
  try {
    discovery = await childRegionsOf({
      osmId,
      boundary: run.boundary,
      adminLevel: parent.adminLevel,
    });
  } catch (e) {
    const message =
      e instanceof RegionHierarchyError ? e.message : `Region lookup failed: ${(e as Error).message}`;
    await db
      .update(outreachRegions)
      .set({ childrenFetchedAt: new Date(), childrenError: message, updatedAt: new Date() })
      .where(eq(outreachRegions.osmId, osmId));
    console.warn('[outreach] region children lookup failed', { osmId, message });
    return { status: 'failed' };
  }

  if (discovery && discovery.children.length > 0) {
    await db
      .insert(outreachRegions)
      .values(
        discovery.children.map((c) => ({
          osmId: c.osmId,
          label: c.label,
          countryCode: parent.countryCode,
          adminLevel: c.adminLevel,
          point: c.point,
          parentOsmId: osmId,
        })),
      )
      // A council can be picked and scraped in its own right after being
      // discovered under a metro, and vice versa. Keep the richer of the two:
      // the label and level are the same either way, and a row that already
      // knows its own children must not lose them.
      .onConflictDoUpdate({
        target: outreachRegions.osmId,
        set: {
          label: sql`excluded.label`,
          adminLevel: sql`excluded.admin_level`,
          point: sql`excluded.point`,
          parentOsmId: sql`excluded.parent_osm_id`,
          updatedAt: new Date(),
        },
      });
  }

  await db
    .update(outreachRegions)
    .set({
      childrenFetchedAt: new Date(),
      childrenAdminLevel: discovery?.adminLevel ?? null,
      childrenError: null,
      updatedAt: new Date(),
    })
    .where(eq(outreachRegions.osmId, osmId));

  console.log('[outreach] region children', {
    osmId,
    label: parent.label,
    level: discovery?.adminLevel ?? null,
    candidates: discovery?.candidates ?? 0,
    kept: discovery?.children.length ?? 0,
  });

  return discovery
    ? { status: 'stored', children: discovery.children.length }
    : { status: 'empty' };
}

/**
 * How long to leave a failed lookup alone.
 *
 * Overpass 504s are common and transient — measured on 2026-08-17, three
 * consecutive refusals from the main instance and one from a mirror, on queries
 * that succeeded minutes later. So a failure cannot be permanent, or a region's
 * grid would stay empty forever because of one bad afternoon. Six hours is slow
 * enough to be polite to a donated service (four attempts a day per region) and
 * fast enough that nobody has to know this retry exists.
 */
const RETRY_AFTER_MS = 6 * 60 * 60 * 1_000;

/**
 * Regions to ask about: never asked, or asked and refused long enough ago.
 *
 * A region that answered — even to say it contains nothing — is done and is
 * never re-asked. Geography does not change on the timescale of a cold email
 * campaign, and the cost of being wrong about that is a query nobody needed.
 */
export async function regionsNeedingChildren(limit = 5): Promise<string[]> {
  const rows = await db
    .select({ osmId: outreachRegions.osmId })
    .from(outreachRegions)
    .where(
      or(
        isNull(outreachRegions.childrenFetchedAt),
        and(
          sql`${outreachRegions.childrenError} IS NOT NULL`,
          lt(outreachRegions.childrenFetchedAt, new Date(Date.now() - RETRY_AFTER_MS)),
        ),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.osmId);
}

/**
 * Runs whose region never made it onto the map at all — everything scraped
 * before this table existed. Registers them from the ledger row, which carries
 * everything the gazetteer needs except the admin level.
 */
export async function backfillRegionsFromRuns(limit = 20): Promise<number> {
  const rows = await db
    .select({
      placeId: outreachListRuns.placeId,
      label: outreachListRuns.regionLabel,
      regionKey: outreachListRuns.regionKey,
      countryCode: outreachListRuns.countryCode,
      boundary: outreachListRuns.regionBoundary,
    })
    .from(outreachListRuns)
    .where(
      and(
        sql`${outreachListRuns.placeId} IS NOT NULL`,
        sql`${outreachListRuns.regionBoundary} IS NOT NULL`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${outreachRegions}
          WHERE ${outreachRegions.osmId} = ${outreachListRuns.placeId}
        )`,
      ),
    )
    .orderBy(desc(outreachListRuns.createdAt))
    .limit(limit);

  const seen = new Set<string>();
  for (const row of rows) {
    if (!row.placeId || !row.boundary || seen.has(row.placeId)) continue;
    seen.add(row.placeId);
    await rememberRegion({
      osmId: row.placeId,
      label: row.label ?? row.regionKey,
      countryCode: row.countryCode,
      // Unknown for a backfilled row — the probe simply starts one level higher
      // and finds nothing there, which costs a query and no correctness.
      adminLevel: null,
      boundary: row.boundary,
    });
  }
  return seen.size;
}

/**
 * Would scraping this region be paying for something we already own?
 *
 * The authoritative answer is `findCoveringRun`, which compares polygons and
 * runs on the path that creates a run — but it needs the region resolved, which
 * costs a Nominatim call. This is the cheap version for the form: walk the
 * gazetteer up from the region the operator just picked and see whether this
 * vertical has a live run on any ancestor. No network, no geometry, and exact
 * whenever the region is one we have already discovered — which is the case
 * that matters, because a council under a metro we have scraped is precisely
 * the mistake worth catching before the button is pressed.
 *
 * A null answer means "no reason to object that we can see from here", not
 * "safe": the real check still runs at the start of the run.
 */
export async function coveringParentFor(
  vertical: string,
  osmId: string,
): Promise<{ region: string; osmId: string; status: string; runId: string } | null> {
  const seen = new Set<string>([osmId]);
  let current: OutreachRegion | undefined;
  let cursor: string | null = osmId;

  while (cursor) {
    [current] = await db
      .select()
      .from(outreachRegions)
      .where(eq(outreachRegions.osmId, cursor))
      .limit(1);
    const parentId: string | null = current?.parentOsmId ?? null;
    // A cycle would be a data error rather than a geography, but it would also
    // be an infinite loop, and this runs on a keystroke path.
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);

    const [run] = await db
      .select({
        id: outreachListRuns.id,
        status: outreachListRuns.status,
        label: outreachListRuns.regionLabel,
        key: outreachListRuns.regionKey,
      })
      .from(outreachListRuns)
      .where(
        and(
          eq(outreachListRuns.vertical, vertical),
          eq(outreachListRuns.placeId, parentId),
          // A failed run still owns its area once it has a provider run id —
          // the money is gone and the businesses are bought. Worded to match
          // `HOLDS_REGION` in ledger.ts exactly: this warning exists to predict
          // the refusal that happens at the start of a run, and a prediction
          // that disagrees with the refusal is worse than no prediction.
          sql`${outreachListRuns.status} <> 'superseded'`,
          sql`(${outreachListRuns.status} <> 'failed' OR ${outreachListRuns.runId} IS NOT NULL)`,
        ),
      )
      .limit(1);
    if (run) {
      return {
        region: run.label ?? run.key,
        osmId: parentId,
        status: run.status,
        runId: run.id,
      };
    }
    cursor = parentId;
  }
  return null;
}

/** Everything on the map, for the coverage read. */
export async function allRegions(): Promise<OutreachRegion[]> {
  return db.select().from(outreachRegions);
}

/** The children we hold for a set of parents, in one query. */
export async function childrenOf(parentIds: string[]): Promise<OutreachRegion[]> {
  if (parentIds.length === 0) return [];
  return db
    .select()
    .from(outreachRegions)
    .where(inArray(outreachRegions.parentOsmId, parentIds));
}
