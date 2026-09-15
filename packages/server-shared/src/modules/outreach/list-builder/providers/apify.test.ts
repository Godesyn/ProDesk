/**
 * What the scraper is pointed at.
 *
 * This is the one input field where being wrong is silent and expensive. A
 * search term that misses returns nothing and the operator sees it; a LOCATION
 * that misses either kills the run outright or — the case that actually
 * happened — resolves to a different, much smaller area, scrapes it, and
 * reports as a covered region on the coverage map.
 *
 * So the contract under test is that a run carrying a boundary is scraped by
 * that boundary and never by its name, and that the input hash stays a pure
 * function of the spec, because orphan adoption compares hashes to decide
 * whether we have already paid for a scrape.
 *
 * See the note on `locationOf` in apify.ts.
 */
import { describe, it, expect } from 'vitest';
import { apifyProvider, buildApifyInput } from './apify.js';
import type { GeoJsonArea, ScrapeSpec } from './types.js';

const SQUARE: GeoJsonArea = {
  type: 'Polygon',
  // [longitude, latitude], first pair repeated last to close the ring.
  coordinates: [
    [
      [151.1123025, -33.9337883],
      [151.1965806, -33.9337883],
      [151.1965806, -33.8459892],
      [151.1123025, -33.8459892],
      [151.1123025, -33.9337883],
    ],
  ],
};

const spec = (over: Partial<ScrapeSpec> = {}): ScrapeSpec => ({
  searchTerm: 'dentist',
  region: 'Inner West Council',
  countryCode: 'au',
  boundary: SQUARE,
  maxRecords: 400,
  ...over,
});

describe('buildApifyInput', () => {
  it('searches the boundary, and does not mention the region name at all', () => {
    const input = buildApifyInput(spec());
    expect(input.customGeolocation).toEqual(SQUARE);
    // The regression: `city: "Inner West Council"` is unresolvable through the
    // actor's structured lookup, so its presence would put the run back on the
    // path that dies as LOCATION NOT FOUND.
    expect(input).not.toHaveProperty('city');
    expect(input).not.toHaveProperty('countryCode');
  });

  it('passes a MultiPolygon through untouched, for a region with islands', () => {
    const multi: GeoJsonArea = {
      type: 'MultiPolygon',
      coordinates: [SQUARE.coordinates, SQUARE.coordinates],
    };
    expect(buildApifyInput(spec({ boundary: multi })).customGeolocation).toEqual(multi);
  });

  it('falls back to the region name only when there is no boundary', () => {
    const input = buildApifyInput(spec({ boundary: null }));
    expect(input.city).toBe('Inner West Council');
    expect(input.countryCode).toBe('au');
    expect(input).not.toHaveProperty('customGeolocation');
  });

  it('keeps the search term and the cap independent of how location is passed', () => {
    for (const boundary of [SQUARE, null]) {
      const input = buildApifyInput(spec({ boundary }));
      expect(input.searchStringsArray).toEqual(['dentist']);
      expect(input.maxCrawledPlacesPerSearch).toBe(400);
    }
  });
});

describe('inputHash', () => {
  it('is a pure function of the spec', () => {
    expect(apifyProvider.inputHash(spec())).toBe(apifyProvider.inputHash(spec()));
  });

  it('survives a JSON round-trip of the boundary', () => {
    // Adoption re-hashes the INPUT record read back out of Apify's key-value
    // store, so a polygon that hashes differently after a serialise/parse cycle
    // would break the check that stops us paying for a scrape twice.
    const round = JSON.parse(JSON.stringify(SQUARE)) as GeoJsonArea;
    expect(apifyProvider.inputHash(spec({ boundary: round }))).toBe(
      apifyProvider.inputHash(spec()),
    );
  });

  it('distinguishes two regions that differ only by boundary', () => {
    const shifted: GeoJsonArea = {
      type: 'Polygon',
      coordinates: [SQUARE.coordinates[0].map(([lng, lat]) => [lng + 1, lat])],
    };
    expect(apifyProvider.inputHash(spec({ boundary: shifted }))).not.toBe(
      apifyProvider.inputHash(spec()),
    );
  });

  it('does not confuse a boundary run with the name run it replaced', () => {
    expect(apifyProvider.inputHash(spec({ boundary: null }))).not.toBe(
      apifyProvider.inputHash(spec()),
    );
  });
});
