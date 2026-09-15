import { env } from '../../../../lib/env.js';
import type { GeoJsonArea } from '../../../../lib/geojson.js';
import { pointInArea, type Point } from '../../../../lib/geometry.js';

/**
 * What is inside this region?
 *
 * The coverage map needs a denominator, and the denominator used to be a list
 * of 38 names typed into regions.ts. Migration 0104 has the full account of why
 * that was wrong; the short version is that it matched on strings, its strings
 * did not match the ones region search returns, and three of the councils it
 * claimed for Greater Sydney are not inside the polygon a Sydney run actually
 * scrapes.
 *
 * OpenStreetMap already knows. It is where the boundaries we scrape come from,
 * so asking it what those boundaries contain keeps one source of truth instead
 * of two that drift.
 *
 * **Overpass, not Nominatim.** Nominatim answers "what is this place called"
 * and "where is it"; it has no good answer for "what is inside it" — its
 * /details hierarchy is documented as a debugging aid and is unreliable at this
 * size. Overpass is the query language for exactly this, at the cost of being a
 * second donation-funded service to be polite to.
 *
 * Verified against the live services on 2026-08-17 — see the findings at the
 * foot of this file. They are not incidental: two of the three rules this
 * module applies exist because the obvious query returns the wrong answer.
 */

export interface DiscoveredChild {
  /** OSM object identity, "R1251053" — the same key `place_id` uses. */
  osmId: string;
  label: string;
  adminLevel: number;
  /** Overpass's `center`, verified to fall inside the parent. */
  point: Point;
}

export interface Discovery {
  /** The level the children came back at, for the record. */
  adminLevel: number;
  children: DiscoveredChild[];
  /** How many the query returned before containment filtering. */
  candidates: number;
}

export class RegionHierarchyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegionHierarchyError';
  }
}

/**
 * The levels worth asking about, shallowest first.
 *
 * OSM's admin_level is a fixed 1–11 vocabulary, not a guess about a particular
 * country, so enumerating it is not the hardcoding this rewrite exists to
 * remove — the question "which of these levels does THIS region decompose
 * into" is answered by the data every time it is asked.
 *
 * Starting at 4 rather than 1: nothing anyone scrapes for cold outreach sits
 * above a state, and each level costs a five-second round trip.
 */
const LEVELS = [4, 5, 6, 7, 8, 9, 10];

/**
 * One child is not a decomposition — it is usually the region's own
 * administrative twin at the next level down. Two is the point at which a
 * denominator starts meaning something.
 */
const MIN_CHILDREN = 2;

/**
 * A cap with a voice. If a region really does contain more areas than this the
 * grid is unreadable anyway, but the log line says so rather than letting the
 * truncation read as the whole answer.
 */
const MAX_CHILDREN = 250;

/**
 * Their servers are donated. One query at a time, with a gap after each.
 *
 * The gap is imposed on the NEXT caller rather than charged to this one: a
 * lone query should not sit still for a second after it already has its answer,
 * and the rate limit is satisfied either way.
 */
const QUERY_GAP_MS = 1_000;
let chain: Promise<unknown> = Promise.resolve();
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  const gap = () => new Promise((r) => setTimeout(r, QUERY_GAP_MS));
  chain = run.then(gap, gap);
  return run;
}

const USER_AGENT =
  'ProDeskBot/1.0 (+https://prodesk.com/bot; region hierarchy for outreach coverage; hello@prodesk.com)';

/**
 * Per-query and whole-discovery ceilings.
 *
 * Both matter because the slow path is real: probing a region that decomposes
 * into nothing means one query per level, and a mirror under load takes tens of
 * seconds to say 504. Four mirrors × seven levels × a three-minute query is an
 * hour and a half of a Worker slot spent learning that a council has no
 * subdivisions.
 *
 * So a query gets 90 seconds — Overpass answers a real one of these in five —
 * and the whole discovery gets four minutes, after which it gives up and is
 * recorded as a failure. Failures retry on a six-hour cooldown, so giving up
 * early costs nothing but a later attempt on a quieter afternoon.
 */
const QUERY_TIMEOUT_S = 90;
const DISCOVERY_BUDGET_MS = 4 * 60 * 1_000;

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
  center?: { lat?: number; lon?: number };
}

function endpoints(): string[] {
  return env.OVERPASS_URLS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Ask every mirror in turn, and only give up when all of them have refused.
 *
 * The public overpass-api.de instance answers 504 within ten seconds when it is
 * busy, which it frequently is — measured on 2026-08-17, three queries in a row.
 * A single-endpoint client would report "this region has no children", which is
 * indistinguishable in the UI from a region that genuinely has none. Hence the
 * list, and hence the error rather than an empty array on total failure.
 */
async function overpass(query: string): Promise<OverpassElement[]> {
  const tried: string[] = [];
  for (const url of endpoints()) {
    try {
      const res = await queued(() =>
        fetch(url, {
          method: 'POST',
          headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'text/plain' },
          body: query,
          signal: AbortSignal.timeout((QUERY_TIMEOUT_S + 10) * 1_000),
        }),
      );
      if (!res.ok) {
        tried.push(`${new URL(url).host} ${res.status}`);
        continue;
      }
      const body = (await res.json().catch(() => null)) as {
        elements?: OverpassElement[];
        remark?: string;
      } | null;
      // Overpass reports its own timeouts and memory limits in a `remark` on a
      // 200, so a successful HTTP status is not a successful query.
      if (body?.remark) {
        tried.push(`${new URL(url).host} ${body.remark.slice(0, 80)}`);
        continue;
      }
      return body?.elements ?? [];
    } catch (e) {
      tried.push(`${new URL(url).host} ${(e as Error).message}`);
    }
  }
  throw new RegionHierarchyError(`No Overpass mirror answered — ${tried.join('; ')}`);
}

/** "R1251053" → the Overpass selector for that object. Areas need a shape. */
function selectorFor(osmId: string): string | null {
  const match = /^([RW])(\d+)$/.exec(osmId);
  if (!match) return null;
  return `${match[1] === 'R' ? 'rel' : 'way'}(${match[2]})`;
}

function query(selector: string, level: number): string {
  return `[out:json][timeout:${QUERY_TIMEOUT_S}];
${selector};map_to_area->.a;
rel(area.a)["boundary"="administrative"]["admin_level"="${level}"];
out ids tags center;`;
}

/**
 * Is this candidate a place, or a piece of administrative bookkeeping?
 *
 * At admin_level 6 inside Sydney, OSM returns 64 relations and only 33 of them
 * are councils. The other 31 are wharves, islands, marinas and a museum —
 * correctly tagged, genuinely at that level, and not places anybody scrapes.
 * Two rules clear them out, in the order they were learned:
 *
 *  1. **Not unincorporated.** 30 of the 31 carry
 *     `boundary_type=unincorporated area`: land belonging to no council. OSM's
 *     own vocabulary, and exactly the right meaning.
 *  2. **Described by more than its outline.** The one that slipped through was
 *     "Walsh Bay Wharves", whose entire tag set is name, type, boundary and
 *     admin_level. Every real council carries a description of the place as
 *     well as its shape — `place`, a `wikidata` id, a population, a website, a
 *     government reference. An administrative area nobody has bothered to
 *     describe beyond drawing it is not a market.
 *
 * Rule 2 is the looser of the two and is deliberately a family of signals
 * rather than one required tag: `place` is near-universal on administrative
 * boundaries in Australia but not everywhere, and this has to keep working when
 * the first region outside it is scraped.
 */
const IDENTITY_TAGS = ['place', 'wikidata', 'wikipedia', 'population', 'website'];

export function isRegion(tags: Record<string, string> | undefined): boolean {
  if (!tags?.name) return false;
  if (tags.boundary_type === 'unincorporated area') return false;
  return (
    IDENTITY_TAGS.some((k) => !!tags[k]) || Object.keys(tags).some((k) => k.startsWith('ref'))
  );
}

/**
 * The administrative areas inside `parent`, at the shallowest level that has
 * more than one of them.
 *
 * Returns null when nothing decomposes it — a council whose only subdivisions
 * are suburbs OSM has not mapped, say. That is a real answer and is stored as
 * one, so the UI can tell "nothing inside" from "never asked".
 */
export async function childRegionsOf(parent: {
  osmId: string;
  boundary: GeoJsonArea;
  adminLevel: number | null;
}): Promise<Discovery | null> {
  const selector = selectorFor(parent.osmId);
  if (!selector) {
    // A node has no extent, so it can never be an area to look inside.
    throw new RegionHierarchyError(`${parent.osmId} is not an OSM way or relation.`);
  }

  const deadline = Date.now() + DISCOVERY_BUDGET_MS;

  for (const level of LEVELS) {
    if (parent.adminLevel !== null && level <= parent.adminLevel) continue;
    if (Date.now() > deadline) {
      // Deliberately an error rather than "no children": we did not finish
      // asking, and a half-asked region reported as empty is a region the map
      // would claim to know about.
      throw new RegionHierarchyError(
        `Gave up enumerating ${parent.osmId} after ${Math.round(
          DISCOVERY_BUDGET_MS / 60_000,
        )} minutes — Overpass is too slow right now. It will be retried.`,
      );
    }

    const elements = await overpass(query(selector, level));
    const children: DiscoveredChild[] = [];
    const seen = new Set<string>();

    for (const el of elements) {
      const osmId = `R${el.id}`;
      if (!el.id || osmId === parent.osmId || seen.has(osmId)) continue;
      if (!isRegion(el.tags)) continue;
      const lng = el.center?.lon;
      const lat = el.center?.lat;
      if (typeof lng !== 'number' || typeof lat !== 'number') continue;
      /**
       * The containment test, and it is not belt-and-braces.
       *
       * `rel(area.a)` matches a relation with any node inside the area, so the
       * query returns every neighbour that shares a border. Measured on Sydney:
       * 64 candidates, of which Central Coast, Blue Mountains, Hawkesbury and
       * Wollondilly are outside the polygon a Sydney run is actually scraped
       * against. Trusting the query would mark four councils as bought that no
       * run has touched — the precise failure the old hardcoded list had.
       */
      if (!pointInArea(parent.boundary, [lng, lat])) continue;
      seen.add(osmId);
      children.push({
        osmId,
        label: el.tags?.name ?? osmId,
        adminLevel: level,
        point: [lng, lat],
      });
    }

    if (children.length < MIN_CHILDREN) continue;

    if (children.length > MAX_CHILDREN) {
      console.warn('[outreach] region children truncated', {
        parent: parent.osmId,
        level,
        found: children.length,
        kept: MAX_CHILDREN,
      });
    }
    children.sort((a, b) => a.label.localeCompare(b.label));
    return {
      adminLevel: level,
      children: children.slice(0, MAX_CHILDREN),
      candidates: elements.length,
    };
  }

  return null;
}

/* Verified against the live services (2026-08-17).
 *
 *   • "Sydney" is R5750005, `place=city` with NO admin_level — Australia has no
 *     metropolitan tier between state (4) and council (6). It does carry a
 *     970-point polygon, so it is scrapeable and it can be an area; a parent
 *     without an admin_level is normal, not a data error.
 *   • overpass-api.de returned 504 on three consecutive queries;
 *     overpass.kumi.systems answered the same query in 5.0s. Hence the mirror
 *     list, and hence the mirror leading it.
 *   • `map_to_area` works on a `place=city` relation, not only on
 *     boundary=administrative — which is what makes a metro parent possible.
 *   • admin_level 6 inside Sydney: 64 relations, 33 councils. The other 31 are
 *     all `boundary_type=unincorporated area`. 30 councils pass containment;
 *     Blue Mountains, Hawkesbury, Wollondilly and Central Coast fall outside
 *     the OSM Sydney polygon and are correctly excluded.
 */
