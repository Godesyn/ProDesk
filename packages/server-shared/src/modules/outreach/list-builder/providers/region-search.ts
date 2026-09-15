import type { GeoJsonArea } from '../../../../lib/geojson.js';

/**
 * Naming a region, and drawing it.
 *
 * The curated list in regions.ts exists because a free-text region field puts a
 * hand-typed string into half of a uniqueness key, and "Inner West" vs
 * "inner-west" is two ledger rows, two Apify runs, and two bills for the same
 * businesses. But a hardcoded list of 38 names is a poor answer to that: it
 * can't reach Melbourne's councils without someone hand-verifying 31 of them,
 * and it makes the operator pick from our imagination rather than the world.
 *
 * So the field is searchable, and what comes back carries a stable ID. The ID
 * is the whole point — it is what the second unique index keys on, so one
 * council spelled three ways is refused rather than billed twice.
 *
 * **And a boundary.** Resolving a region yields its geometry as well as its
 * name, because the name alone turned out not to be enough to scrape it: the
 * scraper re-geocodes whatever string it is given, through a lookup that
 * cannot see administrative areas at all. The full account is on `locationOf`
 * in apify.ts. The consequence here is that a region search backend has to be
 * able to answer "where exactly is this", not just "what is it called".
 *
 * **OpenStreetMap (Nominatim)** is therefore the only backend. No key, no
 * billing, no account, and — the part that decides it — `polygon_geojson=1`
 * returns the actual administrative boundary. Its usage policy is the
 * constraint: max 1 request/second, a real User-Agent, and no per-keystroke
 * autocomplete, which is why the UI searches on a debounce rather than as you
 * type.
 *
 * Google Places used to sit behind this interface and was removed with the
 * move to boundaries. It reads informal names slightly better, but the Places
 * API returns only a rectangular `viewport` for a region, never its shape, and
 * a rectangle laid over a council spills into its neighbours — which under a
 * cost model billed per place found means paying twice for the same
 * businesses, in the one place the whole design exists to prevent. It was the
 * better namer and could not do the job that now matters.
 *
 * Runs server-side only.
 */

export interface RegionSuggestion {
  /** Opaque to us and to the client — only ever round-tripped. */
  placeId: string;
  /** "Inner West Council" — what the operator recognises. */
  label: string;
  /** "Sydney, New South Wales, Australia" — separates two councils of a name. */
  context: string;
}

export interface ResolvedRegion {
  placeId: string;
  label: string;
  /** ISO 3166-1 alpha-2, lowercased. Kept for display and for Outscraper. */
  countryCode: string;
  /** The administrative boundary itself — what actually gets scraped. */
  boundary: GeoJsonArea;
  /**
   * OSM's hierarchy depth, when the region has one.
   *
   * Null is normal and load-bearing rather than a gap: "Sydney" is
   * `place=city` with no admin_level, because Australia has no metropolitan
   * tier between state (4) and council (6). The gazetteer uses this to know
   * which levels are worth asking about when it enumerates what is inside —
   * a region of unknown depth simply gets probed from the top, which costs a
   * query and no correctness.
   */
  adminLevel: number | null;
}

export interface RegionSearchProvider {
  readonly name: 'osm';
  /** Attribution to render beside results. ODbL requires it for OSM. */
  readonly attribution: string;
  suggest(query: string): Promise<RegionSuggestion[]>;
  resolve(placeId: string): Promise<ResolvedRegion>;
}

export class RegionSearchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'RegionSearchError';
  }
}

/**
 * Region-sized results only.
 *
 * A café is not a region, and neither is a suburb: §2 is explicit that the unit
 * is an LGA or a whole metro, because the actor tiles whatever it is given and
 * a suburb-sized box wastes the tiling on an area Google would have covered
 * anyway.
 */
const OSM_ADDRESS_TYPES = new Set([
  'municipality',
  'city',
  'town',
  'county',
  'state_district',
  'district',
  'region',
  'province',
  'state',
  'borough',
  'city_district',
]);

/**
 * How much boundary detail to keep, as a tolerance in degrees.
 *
 * Raw OSM boundaries are far finer than a map scrape can use, and the polygon
 * is not a throwaway: it goes into the actor input, into the ledger row, and
 * into the input hash that orphan adoption recomputes for up to 25 candidate
 * runs. Measured against Nominatim:
 *
 *   Inner West Council   raw 1,673 pts / 43 KB   →  0.001°: 64 pts / 1.7 KB
 *   New South Wales      raw 79,450 pts / 2.0 MB →  0.001°: 6,291 pts / 161 KB
 *
 * 0.001° is ~110 m at Sydney's latitude, comfortably inside a single z17 map
 * tile — the finest the actor tiles at — so no tile can be lost to the
 * rounding. This is not a knob to raise: at 0.005° the same council collapses
 * to 17 points, which visibly cuts corners off a harbour boundary.
 */
const POLYGON_TOLERANCE_DEGREES = 0.001;

/* ──────────────────────────────────────────────────────────────────────────
 * OpenStreetMap
 * ────────────────────────────────────────────────────────────────────────── */

const NOMINATIM = 'https://nominatim.openstreetmap.org';

/**
 * Nominatim's own `place_id` is NOT stable — it is an internal row id that
 * changes whenever they re-import. Verified: the same council came back as
 * 23576796 from /search and 23554452 from /lookup in the same minute. The
 * stable identity is the OSM object, so that is what we store: "R1251053".
 */
function osmIdentity(row: { osm_type?: string; osm_id?: number }): string | null {
  const kind = { relation: 'R', way: 'W', node: 'N' }[row.osm_type ?? ''];
  return kind && row.osm_id ? `${kind}${row.osm_id}` : null;
}

/** Nominatim's `/lookup` wants "R1251053" back in exactly that form. */
const OSM_ID_PATTERN = /^[RWN]\d+$/;

interface NominatimRow {
  osm_type?: string;
  osm_id?: number;
  name?: string;
  display_name?: string;
  addresstype?: string;
  category?: string;
  type?: string;
  address?: { country_code?: string };
  /** Only present when `extratags=1` was asked for. */
  extratags?: { admin_level?: string };
  /** Only present when `polygon_geojson=1` was asked for. */
  geojson?: { type?: string; coordinates?: unknown };
}

/**
 * One request per second, process-wide, because that is their published limit
 * and they are a donation-funded service doing us a favour. Serialised rather
 * than throttled-and-dropped: a region search is a single interactive call, so
 * waiting is always better than failing.
 */
let osmChain: Promise<unknown> = Promise.resolve();
function osmQueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = osmChain.then(async () => {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      const wait = 1_100 - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    }
  });
  // Keep the chain alive even when a call rejects, or one failure would wedge
  // every later search behind a rejected promise.
  osmChain = next.catch(() => undefined);
  return next as Promise<T>;
}

/** Their policy requires a real identifying User-Agent, not a browser's. */
const OSM_USER_AGENT =
  'ProDeskBot/1.0 (+https://prodesk.com/bot; region lookup for outreach list building; hello@prodesk.com)';

async function osmFetch(path: string): Promise<NominatimRow[]> {
  const res = await fetch(`${NOMINATIM}${path}`, {
    headers: { 'User-Agent': OSM_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    throw new RegionSearchError(
      res.status === 429
        ? 'OpenStreetMap is rate-limiting us. Wait a moment and search again.'
        : `OpenStreetMap returned ${res.status}.`,
      res.status,
    );
  }
  const body = (await res.json().catch(() => null)) as NominatimRow[] | null;
  return Array.isArray(body) ? body : [];
}

function osmLabel(row: NominatimRow): string {
  return (row.name ?? row.display_name?.split(',')[0] ?? '').trim();
}

/** The rest of the display name — what tells two "Richmond"s apart. */
function osmContext(row: NominatimRow): string {
  return (row.display_name ?? '').split(',').slice(1).join(',').trim();
}

function isRegion(row: NominatimRow): boolean {
  if (row.category === 'boundary' && row.type === 'administrative') return true;
  return OSM_ADDRESS_TYPES.has(row.addresstype ?? '');
}

export const openStreetMap: RegionSearchProvider = {
  name: 'osm',
  attribution: 'via OpenStreetMap',

  async suggest(query) {
    const rows = await osmQueue(() =>
      osmFetch(`/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=8`),
    );
    const out: RegionSuggestion[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (!isRegion(row)) continue;
      const placeId = osmIdentity(row);
      const label = osmLabel(row);
      if (!placeId || !label || seen.has(placeId)) continue;
      seen.add(placeId);
      out.push({ placeId, label, context: osmContext(row) });
    }
    return out;
  },

  async resolve(placeId) {
    if (!OSM_ID_PATTERN.test(placeId)) {
      throw new RegionSearchError(`"${placeId}" is not an OpenStreetMap id.`, 400);
    }
    const [row] = await osmQueue(() =>
      osmFetch(
        `/lookup?osm_ids=${encodeURIComponent(placeId)}&format=jsonv2&addressdetails=1` +
          `&extratags=1&polygon_geojson=1&polygon_threshold=${POLYGON_TOLERANCE_DEGREES}`,
      ),
    );
    const label = row ? osmLabel(row) : '';
    const country = row?.address?.country_code;
    if (!label) throw new RegionSearchError('OpenStreetMap no longer has that region.', 404);
    if (!country) throw new RegionSearchError(`No country for "${label}".`, 502);

    // No boundary, no run. A region we can name but cannot draw would fall back
    // to being geocoded from its name by the scraper, which is exactly the path
    // that silently scrapes the wrong area — better to refuse here, where the
    // operator is standing in front of the error and nothing has been billed,
    // than to start a run that quietly covers a suburb of the intended council.
    const geo = row?.geojson;
    if (geo?.type !== 'Polygon' && geo?.type !== 'MultiPolygon') {
      throw new RegionSearchError(
        `OpenStreetMap has no boundary shape for "${label}" — only ${
          geo?.type ?? 'a point'
        }. Pick the council or city that contains it instead.`,
        502,
      );
    }

    const level = Number.parseInt(row?.extratags?.admin_level ?? '', 10);
    return {
      placeId,
      label,
      countryCode: country.toLowerCase(),
      boundary: geo as GeoJsonArea,
      adminLevel: Number.isFinite(level) ? level : null,
    };
  },
};

/**
 * The active backend.
 *
 * One entry, no config switch. It stays a function because every caller
 * already goes through it and because the seam is worth keeping — but the
 * choice it used to make is gone, and the comment above says why.
 */
export function regionSearch(): RegionSearchProvider {
  return openStreetMap;
}

/* Verified against the live service (2026-08-17): "Inner West Council"
 * resolves to R1251053 with country_code "au" and a 64-point simplified
 * Polygon, while the structured lookup the scraper performs for the same name
 * — /search?city=Inner+West+Council&country=Australia — returns zero rows.
 * Nominatim's own `place_id` differed between /search and /lookup for that one
 * council in the same minute, which is why identity is osm_type+id. */
