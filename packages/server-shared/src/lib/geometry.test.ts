/**
 * The arithmetic the coverage map now rests on.
 *
 * These are cheap tests for an expensive mistake. Containment decides two
 * things that cost real money: whether a region the operator is about to scrape
 * has already been bought inside a bigger one, and whether a council counts as
 * covered by the metro run above it. A false positive refuses a legitimate run;
 * a false negative pays twice. Both are silent.
 */
import { describe, it, expect } from 'vitest';
import type { GeoJsonArea } from './geojson.js';
import {
  bboxOf,
  contains,
  containmentRatio,
  interiorPointOf,
  pointInArea,
  polygonsOf,
} from './geometry.js';

/** A closed axis-aligned box, [lng, lat] and first pair repeated last. */
const box = (minLng: number, minLat: number, maxLng: number, maxLat: number): GeoJsonArea => ({
  type: 'Polygon',
  coordinates: [
    [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ],
  ],
});

// Roughly Greater Sydney and roughly the Inner West, in the numbers the real
// data uses — so a sign error shows up as a failure rather than as a pass on
// tidy coordinates around the origin.
const SYDNEY = box(150.5, -34.2, 151.4, -33.4);
const INNER_WEST = box(151.1, -33.94, 151.19, -33.85);
const NEWCASTLE = box(151.6, -33.0, 151.85, -32.85);

describe('pointInArea', () => {
  it('finds a point inside, and rejects one outside', () => {
    expect(pointInArea(SYDNEY, [151.0, -33.8])).toBe(true);
    expect(pointInArea(SYDNEY, [152.0, -33.8])).toBe(false);
  });

  it('treats a hole as outside — an enclave inside a shire', () => {
    const withHole: GeoJsonArea = {
      type: 'Polygon',
      coordinates: [
        (box(0, 0, 10, 10) as { coordinates: number[][][] }).coordinates[0],
        [
          [4, 4],
          [6, 4],
          [6, 6],
          [4, 6],
          [4, 4],
        ],
      ],
    };
    expect(pointInArea(withHole, [1, 1])).toBe(true);
    expect(pointInArea(withHole, [5, 5])).toBe(false);
  });

  it('searches every polygon of a MultiPolygon — a council with islands', () => {
    const islands: GeoJsonArea = {
      type: 'MultiPolygon',
      coordinates: [
        (INNER_WEST as { coordinates: number[][][] }).coordinates,
        (NEWCASTLE as { coordinates: number[][][] }).coordinates,
      ],
    };
    expect(pointInArea(islands, [151.7, -32.9])).toBe(true);
    expect(pointInArea(islands, [151.15, -33.9])).toBe(true);
    expect(pointInArea(islands, [151.4, -33.5])).toBe(false);
  });
});

describe('interiorPointOf', () => {
  it('returns a point that is actually inside a concave region', () => {
    // A U — the centroid falls in the notch, which is water. This is the case
    // that drops a genuine child from the gazetteer if it is got wrong.
    const u: GeoJsonArea = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [3, 0],
          [3, 3],
          [2, 3],
          [2, 1],
          [1, 1],
          [1, 3],
          [0, 3],
          [0, 0],
        ],
      ],
    };
    const p = interiorPointOf(u);
    expect(pointInArea(u, p)).toBe(true);
  });

  it('picks the mainland, not the island', () => {
    const mainlandAndSpeck: GeoJsonArea = {
      type: 'MultiPolygon',
      coordinates: [
        (box(0, 0, 10, 10) as { coordinates: number[][][] }).coordinates,
        (box(50, 50, 50.1, 50.1) as { coordinates: number[][][] }).coordinates,
      ],
    };
    const [lng] = interiorPointOf(mainlandAndSpeck);
    expect(lng).toBeLessThan(11);
  });
});

describe('contains', () => {
  it('says a council inside a metro is inside it', () => {
    expect(contains(SYDNEY, INNER_WEST)).toBe(true);
  });

  it('does not say the metro is inside the council', () => {
    expect(contains(INNER_WEST, SYDNEY)).toBe(false);
  });

  it('rejects a region that merely sits nearby', () => {
    expect(contains(SYDNEY, NEWCASTLE)).toBe(false);
  });

  it('rejects a neighbour that shares a border', () => {
    // Directly east of Sydney's box and touching it. Under a bbox-only test
    // this passes; it must not.
    expect(contains(SYDNEY, box(151.4, -34.2, 152.0, -33.4))).toBe(false);
  });

  /**
   * The regression this whole approach exists for.
   *
   * A council on the edge of its metro shares a border with it, and the two
   * boundaries were drawn by different mappers and then simplified to 0.001°
   * independently. The child therefore pokes a little way outside the parent
   * along the shared edge. Strict containment calls that "not inside" and the
   * coverage map goes back to lying.
   */
  it('tolerates a child poking out along a shared border', () => {
    const ragged: GeoJsonArea = {
      type: 'Polygon',
      coordinates: [
        [
          [150.498, -34.202],
          [150.7, -34.2],
          [150.7, -34.0],
          [150.5, -34.001],
          [150.498, -34.202],
        ],
      ],
    };
    expect(contains(SYDNEY, ragged)).toBe(true);
  });

  /**
   * The same thing, at the scale that actually broke it.
   *
   * Annandale sits inside Inner West Council and a proportional 2% inset said
   * it did not: the suburb is about a kilometre across, so the 110m
   * simplification error is a tenth of its width, and nearly all of its outline
   * is shared border. The tolerance has to be absolute, or small regions can
   * never be contained in anything.
   */
  it('holds a small region on its parent’s border, where slack is proportionally huge', () => {
    const council = box(151.13, -33.9, 151.19, -33.86);
    // A ~1km suburb in the council's corner, overshooting by ~150m — inside the
    // 0.001-degree simplification error the two boundaries were built with.
    const suburb: GeoJsonArea = {
      type: 'Polygon',
      coordinates: [
        [
          [151.1285, -33.9015],
          [151.139, -33.9014],
          [151.139, -33.892],
          [151.1284, -33.892],
          [151.1285, -33.9015],
        ],
      ],
    };
    expect(contains(council, suburb)).toBe(true);
  });

  it('is a ratio, so half-in half-out is neither', () => {
    const straddling = box(151.2, -33.6, 151.8, -33.5);
    const ratio = containmentRatio(SYDNEY, straddling);
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(0.98);
    expect(contains(SYDNEY, straddling)).toBe(false);
  });
});

describe('bboxOf', () => {
  it('bounds both area types in [minLng, minLat, maxLng, maxLat]', () => {
    expect(bboxOf(INNER_WEST)).toEqual([151.1, -33.94, 151.19, -33.85]);
    expect(
      bboxOf({
        type: 'MultiPolygon',
        coordinates: [
          (INNER_WEST as { coordinates: number[][][] }).coordinates,
          (NEWCASTLE as { coordinates: number[][][] }).coordinates,
        ],
      }),
    ).toEqual([151.1, -33.94, 151.85, -32.85]);
  });

  it('ignores holes, which are inside the outer ring by definition', () => {
    expect(polygonsOf(INNER_WEST)).toHaveLength(1);
  });
});
