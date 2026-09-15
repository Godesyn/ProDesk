import { apifyProvider } from './apify.js';
import { outscraperProvider } from './outscraper.js';
import { MAPS_USD_PER_1K, VERIFY_USD_EACH, type MapsProvider } from './types.js';

export * from './types.js';
export { verifier, type Verifier, type VerifyResult } from './verifier.js';

/**
 * The active scraper. Apify unless only Outscraper is configured — an
 * unconfigured provider reports itself rather than throwing at import time, so
 * the List Builder can show a setup prompt instead of a crash.
 */
export function mapsProvider(): MapsProvider {
  if (!apifyProvider.configured && outscraperProvider.configured) return outscraperProvider;
  return apifyProvider;
}

/**
 * What a run will cost before it starts.
 *
 * Presented as an UPPER BOUND, and it genuinely is one: Apify bills per place
 * scraped, so the cap is the budget control rather than a guess at yield. A
 * region with fewer businesses than the cap simply costs less, which is the
 * common case — a mainstream local-service vertical across Greater Sydney is
 * 1,500–4,000 listings (§8b).
 *
 * The verification line is included because it is real money spent on the same
 * run, even though it is an order of magnitude smaller than the scrape.
 */
export function estimateCostUsd(maxRecords: number): number {
  const scrape = (maxRecords / 1000) * MAPS_USD_PER_1K;
  const verify = maxRecords * VERIFY_USD_EACH;
  return Math.round((scrape + verify) * 100) / 100;
}
