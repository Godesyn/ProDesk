/**
 * The data-acquisition seam.
 *
 * §15 picks Apify over Outscraper but requires the choice to be swappable, so
 * nothing above this directory knows which scraper ran.
 *
 * The shape of this interface is the whole point, and it is NOT
 * `fetchRegion(): Promise<Business[]>`.
 *
 * A scrape of Greater Sydney legitimately takes tens of minutes. A single
 * blocking call that starts a run, polls it to completion and drains the
 * dataset holds a Worker for that entire window, and — far worse — is
 * unrecoverable: Apify has no idempotency key on run start, so if the process
 * dies anywhere in that window, the retry pays for the whole scrape again.
 *
 * Splitting it into start / poll / fetch makes the expensive step a single
 * atomic act that can be recorded before it happens, and makes every subsequent
 * step free to repeat. Re-reading an Apify dataset is not a billable event,
 * which is what lets the downstream stages be genuinely resumable rather than
 * nominally so.
 *
 * See docs/agents/outreach-apify.md §2 and §7.
 */

import type { GeoJsonArea } from '../../../../lib/geojson.js';

export type { GeoJsonArea };

export type MapsProviderName = 'apify' | 'outscraper';

/** What we ask for. One term, one region — never a suburb list. */
export interface ScrapeSpec {
  /** The literal search term handed to the actor, e.g. "dentist". */
  searchTerm: string;
  /** An LGA ("Inner West Council") or a whole metro ("Sydney"). */
  region: string;
  /** ISO 3166-1 alpha-2, lowercase. */
  countryCode: string;
  /**
   * The region's actual boundary — what Apify searches, in preference to the
   * name above.
   *
   * A name has to be geocoded by whoever receives it, and the receiver's
   * geocoder is not ours: `region` is the official name of an administrative
   * area, and Apify's structured location lookup only resolves populated
   * places. See the note on `locationOf` in apify.ts for what that costs.
   *
   * Null only on ledger rows written before boundaries were stored. Outscraper
   * ignores it and searches by name, which is its own limitation, not a default.
   */
  boundary: GeoJsonArea | null;
  /** The budget ceiling, and what the cost estimate is computed from. */
  maxRecords: number;
}

/** A place as it comes off the wire, before any of our rules apply. */
export interface RawPlace {
  /** Google's stable identity. The cross-run dedupe key. */
  placeId: string | null;
  name: string | null;
  email: string | null;
  website: string | null;
  phone: string | null;
  address: string | null;
  category: string | null;
  /** Star rating. Free in the base item. */
  rating: number | null;
  /** Review count. Free in the base item, and the personalisation hook. */
  reviewsCount: number | null;
  permanentlyClosed: boolean;
}

export type RunStatus = 'running' | 'succeeded' | 'failed';

export interface RunHandle {
  runId: string;
  datasetId: string;
}

export interface RunPoll {
  status: RunStatus;
  datasetId: string | null;
  /** What the provider says it billed. Null while the run is still going. */
  costUsd: number | null;
  /** The provider's own status string, for the failure message. */
  detail: string | null;
}

export interface MapsProvider {
  name: MapsProviderName;
  configured: boolean;
  /**
   * The billable act. Everything either side of it is free, so this is the one
   * call that must be bracketed by a durable write.
   */
  startRun(spec: ScrapeSpec): Promise<RunHandle>;
  pollRun(runId: string): Promise<RunPoll>;
  /** Free and repeatable — the dataset is re-readable at no cost. */
  fetchPage(datasetId: string, offset: number, limit: number): Promise<RawPlace[]>;
  /**
   * Runs started recently whose input matches `hash`.
   *
   * This is the orphan-adoption path: a ledger row stuck in `starting` means we
   * may have already paid for a run whose id we never wrote down. Adopting it
   * costs nothing; starting a second one costs the whole scrape again.
   * Providers that cannot answer this return an empty list, and the caller
   * treats that as "cannot adopt" rather than "nothing was orphaned".
   */
  findRunsByInput(hash: string, since: Date): Promise<RunHandle[]>;
  /** Whether `findRunsByInput` is meaningful for this provider. */
  supportsAdoption: boolean;
  /**
   * A stable fingerprint of what this spec will actually ask the provider for.
   *
   * It lives on the provider because only the provider knows what the request
   * looks like, and adoption is only sound if the hash written to the ledger and
   * the hash computed from a discovered run are produced by the same code.
   */
  inputHash(spec: ScrapeSpec): string;
}

/**
 * Google returns at most ~120 results for a single map viewport, and that cap
 * is real — but it only bites when a location is passed as a bare search
 * string, because then the actor opens one map screen and scrolls it to
 * exhaustion. Given a STRUCTURED location it geocodes, lays a grid over the
 * bounding box, and scrapes each tile at an auto-tuned zoom, deduping by
 * placeId before anything is billed. The practical ceiling is ~17,000 places
 * per (term × region) — an order of magnitude above any Australian vertical.
 *
 * This is why the region unit is an LGA or a whole metro and never a suburb.
 */
export const MAPS_RESULT_CEILING = 17_000;

/**
 * USD per 1,000 places on the Apify Starter rate: the base place scrape ($1.50)
 * plus the contacts enrichment ($1.50). Every other event is switched off.
 *
 * Unverified against a real invoice — outreach-apify.md §9 lists the six
 * billing questions one $5 probe run settles. `cost_actual_usd` on the ledger
 * is what will correct this figure.
 */
export const MAPS_USD_PER_1K = 3.0;

/** MillionVerifier, per address that survives dedupe. */
export const VERIFY_USD_EACH = 0.0008;

/** Shared normaliser: trimmed non-empty strings, or null. */
export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
