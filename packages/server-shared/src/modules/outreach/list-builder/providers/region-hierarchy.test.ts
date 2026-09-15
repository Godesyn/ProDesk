/**
 * The rules that turn an Overpass answer into a denominator.
 *
 * Each of these encodes something measured against the live services on
 * 2026-08-17 rather than something reasoned about, because the obvious query
 * returns the wrong answer in three separate ways and every one of them is
 * silent: a bad denominator does not throw, it just quietly tells the operator
 * that a region is covered when nothing has been scraped there.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { GeoJsonArea } from '../../../../lib/geojson.js';
import { childRegionsOf, isRegion, RegionHierarchyError } from './region-hierarchy.js';

/** A 1°×1° box at Sydney-ish coordinates. */
const PARENT: GeoJsonArea = {
  type: 'Polygon',
  coordinates: [
    [
      [150.5, -34.2],
      [151.5, -34.2],
      [151.5, -33.2],
      [150.5, -33.2],
      [150.5, -34.2],
    ],
  ],
};

const inside = { lat: -33.8, lon: 151.0 };
const outside = { lat: -32.0, lon: 149.0 };

type Element = { id: number; tags?: Record<string, string>; center?: { lat: number; lon: number } };

/** Answers each Overpass call in order; records the bodies it was sent. */
function mockOverpass(pages: (Element[] | 'fail')[]) {
  const sent: string[] = [];
  let call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(init.body);
      const page = pages[call++] ?? [];
      if (page === 'fail') return { ok: false, status: 504 } as unknown as Response;
      return {
        ok: true,
        json: async () => ({ elements: page }),
      } as unknown as Response;
    }),
  );
  return sent;
}

const levelsQueried = (sent: string[]) =>
  sent.map((b) => Number(/"admin_level"="(\d+)"/.exec(b)?.[1]));

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('isRegion', () => {
  /**
   * At admin_level 6 inside Sydney, OSM returns 64 relations and only 33 are
   * councils. The rest are wharves, islands, marinas and a museum — correctly
   * tagged, genuinely at that level, and not places anyone scrapes. Every one
   * of them carries this tag.
   */
  it('drops unincorporated areas, which is most of what level 6 returns', () => {
    expect(isRegion({ name: 'Inner West Council', place: 'municipality' })).toBe(true);
    expect(
      isRegion({ name: 'Bare Island', boundary_type: 'unincorporated area' }),
    ).toBe(false);
    expect(
      isRegion({ name: 'Unincorporated Sydney Harbour', boundary_type: 'unincorporated area' }),
    ).toBe(false);
  });

  /**
   * The one that got through the first rule, caught on live data: "Walsh Bay
   * Wharves" carries nothing but name, type, boundary and admin_level. Every
   * real council describes the place as well as drawing it.
   */
  it('drops a boundary with no description beyond its outline', () => {
    expect(
      isRegion({
        name: 'Walsh Bay Wharves',
        type: 'boundary',
        boundary: 'administrative',
        admin_level: '6',
      }),
    ).toBe(false);
  });

  it('accepts any of the signals that describe a real place, not just one', () => {
    expect(isRegion({ name: 'Somewhere', wikidata: 'Q123' })).toBe(true);
    expect(isRegion({ name: 'Somewhere', population: '4000' })).toBe(true);
    // A government reference — `ref:psma:lga_pid` on every Australian council.
    expect(isRegion({ name: 'Somewhere', 'ref:psma:lga_pid': 'NSW331' })).toBe(true);
  });

  it('drops anything without a name — a cell has to be labelled', () => {
    expect(isRegion({ place: 'municipality' })).toBe(false);
    expect(isRegion(undefined)).toBe(false);
  });
});

describe('childRegionsOf', () => {
  it('keeps only the candidates whose own point is inside the parent', async () => {
    // `rel(area.a)` matches any relation with a node in the area, so the query
    // returns every neighbour that shares a border. Measured on Sydney: four
    // councils came back that the Sydney polygon does not contain.
    mockOverpass([
      [
        { id: 1, tags: { name: 'Inner West Council', place: 'municipality' }, center: inside },
        { id: 2, tags: { name: 'Burwood Council', place: 'municipality' }, center: inside },
        { id: 3, tags: { name: 'Blue Mountains City Council', place: 'municipality' }, center: outside },
        { id: 4, tags: { name: 'Bare Island', boundary_type: 'unincorporated area' }, center: inside },
      ],
    ]);

    const result = await childRegionsOf({ osmId: 'R5750005', boundary: PARENT, adminLevel: 5 });
    expect(result?.children.map((c) => c.label)).toEqual([
      'Burwood Council',
      'Inner West Council',
    ]);
    expect(result?.candidates).toBe(4);
  });

  it('never returns the parent as its own child', async () => {
    mockOverpass([
      [
        { id: 5750005, tags: { name: 'Sydney', place: 'municipality' }, center: inside },
        { id: 1, tags: { name: 'Inner West Council', place: 'municipality' }, center: inside },
        { id: 2, tags: { name: 'Burwood Council', place: 'municipality' }, center: inside },
      ],
    ]);
    const result = await childRegionsOf({ osmId: 'R5750005', boundary: PARENT, adminLevel: 5 });
    expect(result?.children.map((c) => c.osmId)).toEqual(['R2', 'R1']);
  });

  /**
   * Which level a region decomposes into is a fact about the country, not
   * something to hardcode: Australia's councils are level 6 and sit directly
   * under the state, with no metropolitan tier. So we probe, and stop at the
   * first level that has more than one thing in it.
   */
  it('probes downward and stops at the first level that decomposes', async () => {
    const sent = mockOverpass([
      [{ id: 9, tags: { name: 'New South Wales', place: 'municipality' }, center: outside }], // L6: nothing inside
      [], // L7
      [
        { id: 1, tags: { name: 'Marrickville', place: 'municipality' }, center: inside },
        { id: 2, tags: { name: 'Balmain', place: 'municipality' }, center: inside },
      ], // L8
    ]);

    const result = await childRegionsOf({ osmId: 'R1251053', boundary: PARENT, adminLevel: 5 });
    expect(result?.adminLevel).toBe(8);
    expect(levelsQueried(sent)).toEqual([6, 7, 8]);
  });

  it('never asks about a level at or above the parent itself', async () => {
    const sent = mockOverpass([
      [
        { id: 1, tags: { name: 'A', place: 'municipality' }, center: inside },
        { id: 2, tags: { name: 'B', place: 'municipality' }, center: inside },
      ],
    ]);
    await childRegionsOf({ osmId: 'R1251053', boundary: PARENT, adminLevel: 9 });
    expect(levelsQueried(sent)).toEqual([10]);
  });

  it('treats a single child as no decomposition — usually an administrative twin', async () => {
    const sent = mockOverpass([[{ id: 1, tags: { name: 'Only one', place: 'municipality' }, center: inside }], []]);
    expect(await childRegionsOf({ osmId: 'R2', boundary: PARENT, adminLevel: 8 })).toBeNull();
    expect(levelsQueried(sent)).toEqual([9, 10]);
  });

  /**
   * The failure that matters most. If every mirror refuses and we returned an
   * empty array, the UI would say "this region contains nothing" — which reads
   * exactly like a region we have fully covered.
   */
  it('throws when no mirror answers, rather than reporting an empty region', async () => {
    mockOverpass(['fail', 'fail', 'fail', 'fail']);
    await expect(
      childRegionsOf({ osmId: 'R1', boundary: PARENT, adminLevel: 5 }),
    ).rejects.toBeInstanceOf(RegionHierarchyError);
  });

  it('treats an Overpass remark on a 200 as a failure, because it is one', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ elements: [], remark: 'runtime error: Query timed out' }),
      })) as unknown as typeof fetch,
    );
    await expect(
      childRegionsOf({ osmId: 'R1', boundary: PARENT, adminLevel: 5 }),
    ).rejects.toThrow(/timed out/);
  });

  it('refuses a node, which has no extent to look inside', async () => {
    mockOverpass([]);
    await expect(
      childRegionsOf({ osmId: 'N123', boundary: PARENT, adminLevel: null }),
    ).rejects.toBeInstanceOf(RegionHierarchyError);
  });
});
