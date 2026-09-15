import { createHash } from 'node:crypto';
import { env } from '../../../../lib/env.js';
import {
  num,
  str,
  type MapsProvider,
  type RawPlace,
  type RunHandle,
  type RunPoll,
  type ScrapeSpec,
} from './types.js';

/**
 * Apify — `compass/crawler-google-places`.
 *
 * Pay-per-event, and the events we deliberately leave OFF cost as much as the
 * ones we use, so the input below is a cost decision as much as a config.
 * See docs/agents/outreach-apify.md §3 and §4.
 */

const BASE = 'https://api.apify.com/v2';

/**
 * Where to search: the boundary if we have one, the name if we don't.
 *
 * The name path is the one that broke, and it broke in both directions.
 *
 * The actor resolves `city` through Nominatim's STRUCTURED lookup —
 * `?city=…&country=…` — which only matches populated places: city, town,
 * village. An Australian LGA is a `boundary=administrative` relation, so
 * "Inner West Council" (the official name our own region search returns) comes
 * back with zero rows and the run dies as LOCATION NOT FOUND. Verified against
 * Nominatim: `city=Inner West Council` → 0 rows, and so do `City of
 * Parramatta` and `Willoughby City Council`. `county=` does not reach them
 * either.
 *
 * The quiet failure is worse than the loud one. `city=Brisbane City` DOES
 * resolve — to the postcode-4000 CBD locality, not the 1,300 km² council. That
 * run succeeds, scrapes a few square kilometres, and reports as a covered
 * region on the coverage map.
 *
 * So we hand over geometry. We already resolve every region to a stable OSM
 * object to get its id; asking that same lookup for its boundary costs one
 * extra query parameter and takes the geocoder out of the loop entirely — the
 * actor searches the area the operator picked rather than its best guess at a
 * name. `customGeolocation` is the actor's own documented answer for this, it
 * takes a bare RFC 7946 geometry, and its readme points at Nominatim's
 * `geojson` field as the place to get one.
 *
 * `countryCode` and `city` are deliberately NOT sent alongside a boundary: they
 * are the alternative way of saying the same thing, and the actor's docs treat
 * custom geolocation as the replacement for them rather than a refinement.
 *
 * The name fallback stays for one reason only — a ledger row written before
 * boundaries were stored must still hash to what it hashed then. `inputHash`
 * has to be a pure function of the stored spec, or orphan adoption stops
 * matching, and an adoption that fails to match is a second charge for a scrape
 * we already paid for.
 */
function locationOf(spec: ScrapeSpec): Record<string, unknown> {
  return spec.boundary
    ? { customGeolocation: spec.boundary }
    : { countryCode: spec.countryCode, city: spec.region };
}

/**
 * The actor input.
 *
 * Three details here are the difference between this working and this being
 * expensive nonsense:
 *
 *  • The location is passed as GEOMETRY, never glued into the search string. A
 *    bare search string makes the actor open one map viewport and scroll it,
 *    which is exactly where Google's ~120-result cap bites. Given a real area
 *    it tiles the bounding box and scrapes each tile — ~17k ceiling instead of
 *    ~120. See `locationOf` for why it's a polygon and not a place name.
 *  • `website: "withWebsite"` is the single biggest cost lever. We bin websiteless
 *    places anyway, so paying to collect them is pure waste. (§9 has this as an
 *    open question: if the filter is applied AFTER the billing event it saves
 *    nothing on the base scrape. It still costs nothing to ask for.)
 *  • Every optional enrichment is switched off EXPLICITLY rather than left to
 *    its default, because each one is a separate billable event and defaults
 *    are the provider's to change. `scrapeSocialMediaProfiles` alone would be
 *    ~2.3× the entire rest of the pipeline.
 *
 * `categoryFilterWords` is absent on purpose: the actor's own docs call it
 * dangerous, because Google's category labels are inconsistent and it produces
 * silent false negatives. We filter on `categoryName` server-side instead,
 * where a mistake is visible and free to fix.
 */
export function buildApifyInput(spec: ScrapeSpec): Record<string, unknown> {
  return {
    // One term per run. Two terms in ONE run is fine — the actor dedupes by
    // placeId before billing — but the same term in two runs pays twice for the
    // same business.
    searchStringsArray: [spec.searchTerm],
    ...locationOf(spec),
    language: 'en',
    maxCrawledPlacesPerSearch: spec.maxRecords,
    // "withWebsite", NOT "only" — the actor rejects the run outright with
    // `Field input.website must be equal to one of the allowed values:
    // "allPlaces", "withWebsite", "withoutWebsite"`. Verified against the live
    // API on the first real run; the value in our spec notes was wrong.
    website: 'withWebsite',
    skipClosedPlaces: true,
    // Emails, scraped off the business's own website. The second of our two
    // billable events.
    scrapeContacts: true,
    // ── explicitly off; each is its own billable event ──
    scrapePlaceDetailPage: false,
    maxReviews: 0,
    maxImages: 0,
    maxQuestions: 0,
    scrapeSocialMediaProfiles: {},
    maximumLeadsEnrichmentRecords: 0,
    // MillionVerifier is already the deliverability gate. Don't pay twice.
    verifyLeadsEnrichmentEmails: false,
    enableCompetitorAnalysis: false,
    scrapeDirectories: false,
    includeWebResults: false,
    scrapeTableReservationProvider: false,
    scrapeOrderOnline: false,
  };
}

/** Key order is normalised so the hash is a property of the input, not of JSON. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

function hashInput(input: Record<string, unknown>): string {
  return createHash('sha256').update(canonical(input)).digest('hex').slice(0, 32);
}

/**
 * The base item already carries everything a cold email needs, which is why
 * `scrapePlaceDetailPage` stays off: it costs the same as the base scrape and
 * returns opening hours, Q&A and review distribution, none of which reaches an
 * email.
 */
export function toRawPlace(item: Record<string, unknown>): RawPlace {
  const emails = Array.isArray(item.emails) ? item.emails : [];
  const email = str(emails[0]) ?? str(item.email);
  return {
    placeId: str(item.placeId),
    name: str(item.title) ?? str(item.name),
    email: email ? email.toLowerCase() : null,
    website: str(item.website),
    phone: str(item.phone) ?? str(item.phoneUnformatted),
    address: str(item.address),
    category:
      str(item.categoryName) ?? (Array.isArray(item.categories) ? str(item.categories[0]) : null),
    rating: num(item.totalScore),
    reviewsCount: num(item.reviewsCount),
    permanentlyClosed: item.permanentlyClosed === true || item.temporarilyClosed === true,
  };
}

/**
 * The token goes in a header, never the query string: a URL ends up in logs,
 * error messages and stack traces, and this one buys real money.
 */
async function apify<T>(path: string, init?: RequestInit): Promise<T> {
  if (!env.APIFY_TOKEN) throw new Error('Apify is not configured (APIFY_TOKEN).');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...init?.headers,
      Authorization: `Bearer ${env.APIFY_TOKEN}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Apify returned ${res.status}. ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

interface ApifyRun {
  id: string;
  status: string;
  startedAt?: string;
  defaultDatasetId: string;
  defaultKeyValueStoreId?: string;
  usageTotalUsd?: number;
  statusMessage?: string;
}

const TERMINAL_FAILURE = ['FAILED', 'ABORTED', 'TIMED-OUT', 'TIMING-OUT'];

export const apifyProvider: MapsProvider = {
  name: 'apify',
  supportsAdoption: true,

  get configured() {
    return !!env.APIFY_TOKEN;
  },

  inputHash(spec) {
    // The actor id is part of the fingerprint: the same search against a
    // different actor is a different run, and adopting across actors would
    // bind a ledger row to a dataset with a different shape.
    return hashInput({ actor: env.APIFY_MAPS_ACTOR_ID, ...buildApifyInput(spec) });
  },

  /**
   * Start ASYNC. The `run-sync-get-dataset-items` shortcut caps out around five
   * minutes, which a region-sized scrape blows straight through — and a
   * timed-out sync run is still fully billed.
   */
  async startRun(spec) {
    const actor = encodeURIComponent(env.APIFY_MAPS_ACTOR_ID);
    const started = await apify<{ data: ApifyRun }>(`/acts/${actor}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildApifyInput(spec)),
    });
    return { runId: started.data.id, datasetId: started.data.defaultDatasetId };
  },

  async pollRun(runId): Promise<RunPoll> {
    const { data } = await apify<{ data: ApifyRun }>(`/actor-runs/${runId}`);
    const status = data.status;
    return {
      status:
        status === 'SUCCEEDED' ? 'succeeded' : TERMINAL_FAILURE.includes(status) ? 'failed' : 'running',
      datasetId: data.defaultDatasetId ?? null,
      // Read back on every poll rather than only at the end, so an aborted run
      // still records what it cost us. This is the figure that will correct the
      // $3.00/1k estimate in types.ts once real invoices exist.
      costUsd: typeof data.usageTotalUsd === 'number' ? data.usageTotalUsd : null,
      detail: data.statusMessage ?? status ?? null,
    };
  },

  /**
   * Paging a dataset is NOT a billable event, so this is free to retry — which
   * is what makes every stage after the scrape genuinely resumable rather than
   * nominally so.
   */
  async fetchPage(datasetId, offset, limit) {
    const items = await apify<Record<string, unknown>[]>(
      `/datasets/${datasetId}/items?offset=${offset}&limit=${limit}&format=json`,
    );
    return Array.isArray(items) ? items.map(toRawPlace) : [];
  },

  /**
   * Find a run we may have already paid for.
   *
   * Apify's run list doesn't carry the input, so each candidate's INPUT record
   * is read out of its key-value store and hashed the same way `inputHash`
   * hashes ours. A read costs nothing; a duplicate run costs the whole scrape.
   *
   * Only recent, non-failed runs are considered — adopting a run that failed
   * would inherit its failure, and adopting an old one risks binding to a
   * scrape from a previous month whose data we no longer want.
   */
  async findRunsByInput(hash, since) {
    const actor = encodeURIComponent(env.APIFY_MAPS_ACTOR_ID);
    const list = await apify<{ data: { items: ApifyRun[] } }>(
      `/acts/${actor}/runs?desc=1&limit=25`,
    ).catch(() => null);
    if (!list) return [];

    const out: RunHandle[] = [];
    for (const run of list.data.items ?? []) {
      if (TERMINAL_FAILURE.includes(run.status)) continue;
      if (run.startedAt && new Date(run.startedAt) < since) continue;
      if (!run.defaultKeyValueStoreId) continue;

      const input = await apify<Record<string, unknown>>(
        `/key-value-stores/${run.defaultKeyValueStoreId}/records/INPUT`,
      ).catch(() => null);
      if (!input) continue;

      if (hashInput({ actor: env.APIFY_MAPS_ACTOR_ID, ...input }) === hash) {
        out.push({ runId: run.id, datasetId: run.defaultDatasetId });
      }
    }
    return out;
  },
};
