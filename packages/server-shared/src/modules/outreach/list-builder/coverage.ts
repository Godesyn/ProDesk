import { desc, sql } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import {
  outreachListRuns,
  type OutreachListRun,
  type OutreachListRunStatus,
  type OutreachRegion,
} from '../../../db/schema.js';
import { pointInArea } from '../../../lib/geometry.js';
import { countsOf, hasBeenBilled } from './ledger.js';
import { allRegions } from './gazetteer.js';

/**
 * What has been bought, and what is left.
 *
 * Geography is a depleting resource: across ~25 verticals the Sydney basin
 * holds 45,000–60,000 listings → 12,000–18,000 verified contacts, which at
 * 2,000 new contacts a month is 6–9 months. This is the surface that says when
 * to open Melbourne, so it is a first-class read rather than a report someone
 * has to think to go and look at.
 *
 * **It is computed from geometry now, not from names.** Every run stores the
 * polygon it was scraped against, so "is this council covered?" is a question
 * about shapes we already hold — and a whole-metro run, which is the cheapest
 * way to cover a city, finally reads as covering the thirty councils inside it
 * instead of as one lonely filled square. Migration 0104 has the full account
 * of the hand-written list this replaces and the three things it got wrong.
 *
 * Two facts make the shape of this file:
 *
 *  1. **The gazetteer is vertical-agnostic.** "These 30 councils are inside
 *     Sydney" is a fact about the world. So a vertical that has only ever
 *     scraped two councils individually still gets a Sydney row reading 2 of
 *     30 — the runway number — without any dentist run having named Sydney.
 *  2. **Covered is not the same as scraped.** A cell filled because the metro
 *     above it was bought is a different fact from a cell with its own run and
 *     its own bill, and collapsing the two would hide what a top-up would cost.
 */

/** How a cell came to be covered — or that it hasn't been. */
export type CoverageVia = 'direct' | 'parent' | null;

export interface CoverageCell {
  region: string;
  osmId: string | null;
  via: CoverageVia;
  /** The status of whichever run covers this cell, direct or containing. */
  status: OutreachListRunStatus | null;
  runId: string | null;
  /** For a `parent` cell: the region whose run swallowed this one. */
  coveredBy: string | null;
  /** Only meaningful on a `direct` cell — a share of a metro run is a fiction. */
  found: number;
  pushed: number;
  costUsd: number | null;
  scrapedAt: string | null;
}

export interface CoverageRow {
  vertical: string;
  /** The parent region this grid decomposes — "Sydney". */
  region: string;
  osmId: string;
  /** The parent's own run, when this vertical has one. */
  self: {
    status: OutreachListRunStatus;
    runId: string;
    found: number;
    pushed: number;
    costUsd: number | null;
  } | null;
  cells: CoverageCell[];
  done: number;
  total: number;
  /** Set when the enumeration failed, so an empty grid can say which empty. */
  note: string | null;
}

/**
 * A region we have scraped that sits in none of the grids above.
 *
 * Kept separate and without a denominator, which is the honest shape: we have
 * bought this place and we are making no claim about how much of anywhere it
 * represents. Without it, a region picked from search that belongs to no parent
 * we have enumerated would be scraped, billed, and then invisible on the one
 * surface that says what has been covered.
 */
export interface LooseRow {
  vertical: string;
  cells: CoverageCell[];
}

export interface Coverage {
  grids: CoverageRow[];
  loose: LooseRow[];
}

const LIVE = sql`${outreachListRuns.status} <> 'superseded'`;

/** The run that currently owns a (vertical × region) pair, newest first. */
function currentRuns(rows: OutreachListRun[]): Map<string, OutreachListRun> {
  const byPair = new Map<string, OutreachListRun>();
  for (const r of rows) {
    // Rows arrive newest-first, so the first one seen for a key is the current
    // one. Keyed on the OSM id where there is one — the name is a display
    // string and two spellings of one council must not read as two runs.
    const key = `${r.vertical}\u0000${r.placeId ?? r.regionKey}`;
    if (!byPair.has(key)) byPair.set(key, r);
  }
  return byPair;
}

function cellFromRun(region: string, osmId: string | null, run: OutreachListRun): CoverageCell {
  const counts = countsOf(run);
  return {
    region,
    osmId,
    via: 'direct',
    status: run.status,
    runId: run.id,
    coveredBy: null,
    found: counts.found,
    pushed: counts.pushed,
    costUsd: run.costActualUsd ? Number(run.costActualUsd) : null,
    scrapedAt: run.startedAt?.toISOString() ?? null,
  };
}

export async function coverage(): Promise<Coverage> {
  const [runs, regions] = await Promise.all([
    db.select().from(outreachListRuns).where(LIVE).orderBy(desc(outreachListRuns.createdAt)),
    allRegions(),
  ]);

  const byPair = currentRuns(runs);
  const byOsmId = new Map(regions.map((r) => [r.osmId, r]));

  // Parents are the regions we have asked about and got an answer for. A
  // parent with no children discovered yet contributes no grid — an empty
  // denominator is worse than none, because it reads as nothing covered.
  const childrenByParent = new Map<string, OutreachRegion[]>();
  for (const r of regions) {
    if (!r.parentOsmId) continue;
    const list = childrenByParent.get(r.parentOsmId);
    if (list) list.push(r);
    else childrenByParent.set(r.parentOsmId, [r]);
  }

  const verticals = [...new Set(runs.map((r) => r.vertical))].sort();
  const grids: CoverageRow[] = [];
  const loose: LooseRow[] = [];

  for (const vertical of verticals) {
    const mine = runs.filter((r) => r.vertical === vertical);
    /**
     * The runs that can cover something by containment: they have a polygon,
     * and they were actually paid for.
     *
     * "Paid for" is not "did not fail". A run that fell over AFTER its scrape
     * landed owns its area exactly as a finished one does — the businesses are
     * bought, and the map showing that area as empty is what sends somebody to
     * buy them again. A run that never reached the provider spent nothing and
     * must not fill a single square. `hasBeenBilled` is the same line the
     * ledger refuses repeat scrapes on, so the two cannot disagree.
     */
    const covering = mine.filter((r) => r.regionBoundary && hasBeenBilled(r));

    /** Which run, if any, swallowed this point. Direct matches are settled first. */
    const coveringRunFor = (point: [number, number]): OutreachListRun | null => {
      for (const run of covering) {
        if (run.regionBoundary && pointInArea(run.regionBoundary, point)) return run;
      }
      return null;
    };

    const claimed = new Set<string>();

    for (const [parentId, children] of childrenByParent) {
      const parent = byOsmId.get(parentId);
      if (!parent || children.length === 0) continue;

      const selfRun = byPair.get(`${vertical}\u0000${parentId}`) ?? null;
      const cells: CoverageCell[] = [];

      for (const child of children) {
        const own = byPair.get(`${vertical}\u0000${child.osmId}`);
        if (own) {
          cells.push(cellFromRun(child.label, child.osmId, own));
          claimed.add(child.osmId);
          continue;
        }
        const by = coveringRunFor(child.point);
        cells.push({
          region: child.label,
          osmId: child.osmId,
          via: by ? 'parent' : null,
          status: by?.status ?? null,
          runId: by?.id ?? null,
          coveredBy: by ? (by.regionLabel ?? by.regionKey) : null,
          // A cell covered by a metro run has no found/pushed of its own — the
          // scrape did not break its results down by council, and inventing a
          // share of them would be a number nobody could act on.
          found: 0,
          pushed: 0,
          costUsd: null,
          scrapedAt: by?.startedAt?.toISOString() ?? null,
        });
      }

      const anyCovered = cells.some((c) => c.via !== null);
      // Every parent we know about times every vertical would be a wall of
      // empty grids for verticals that have never been near the place. A grid
      // earns its place by having something in it.
      if (!anyCovered && !selfRun) continue;

      if (selfRun) claimed.add(parentId);

      grids.push({
        vertical,
        region: parent.label,
        osmId: parentId,
        self: selfRun
          ? {
              status: selfRun.status,
              runId: selfRun.id,
              found: countsOf(selfRun).found,
              pushed: countsOf(selfRun).pushed,
              costUsd: selfRun.costActualUsd ? Number(selfRun.costActualUsd) : null,
            }
          : null,
        cells,
        done: cells.filter((c) => c.status === 'done').length,
        total: cells.length,
        note: parent.childrenError,
      });
    }

    /**
     * Everything this vertical has bought that no grid above accounted for.
     *
     * Note the test is on the RUN's region, not on a cell: a region can be
     * missing from every grid either because it is a parent nobody has
     * enumerated yet, or because it is somewhere we have simply never asked
     * about. Both are "bought, and not represented above".
     */
    const orphans: CoverageCell[] = [];
    const seen = new Set<string>();
    for (const run of mine) {
      const key = run.placeId ?? run.regionKey;
      if (claimed.has(key) || seen.has(key)) continue;
      seen.add(key);
      orphans.push(cellFromRun(run.regionLabel ?? run.regionKey, run.placeId, run));
    }
    if (orphans.length > 0) loose.push({ vertical, cells: orphans });
  }

  grids.sort(
    (a, b) => a.vertical.localeCompare(b.vertical) || a.region.localeCompare(b.region),
  );
  return { grids, loose };
}
