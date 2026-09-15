import type { GeoJsonArea } from './geojson.js';

/**
 * Containment, on the shapes we already store.
 *
 * The coverage map used to answer "has this region been scraped?" by comparing
 * strings against a list of 38 names we typed out ourselves. That list was
 * wrong in both directions: it claimed to know Australia's geography, and it
 * did not match what OpenStreetMap actually returns — the council we call
 * "Inner West" is "Inner West Council" there, so the run landed in a bucket
 * marked "no denominator" while the square for the region it had just scraped
 * stayed empty. Worse, a whole-metro run genuinely covers 33 councils and the
 * map could not say so, because nothing in it understood that one area can be
 * inside another.
 *
 * Every run already carries the answer. `region_boundary` is the polygon the
 * scraper was pointed at, stored since migration 0102. Containment is therefore
 * not a fact we need to look up or maintain — it is a fact we can compute, and
 * this file is the arithmetic for it.
 *
 * **Plane geometry on lon/lat, deliberately.** No projection, no geodesics, no
 * dependency. Every consumer here compares an area with another area a few tens
 * of kilometres away, at Australian latitudes, and asks a yes/no question with
 * a 2% margin. The error a projection would correct is orders of magnitude
 * below that margin. Do not reach for turf.js on the strength of this comment.
 *
 * RFC 7946 order throughout: [longitude, latitude].
 */

/** [minLng, minLat, maxLng, maxLat]. */
export type Bbox = [number, number, number, number];

/** [longitude, latitude]. */
export type Point = [number, number];

/** A polygon as GeoJSON has it: outer ring first, holes after. */
type Rings = number[][][];

/** Both area types, flattened to the one shape the maths works on. */
export function polygonsOf(area: GeoJsonArea): Rings[] {
  return area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
}

export function bboxOf(area: GeoJsonArea): Bbox {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const rings of polygonsOf(area)) {
    // The outer ring bounds the polygon; holes are inside it by definition.
    for (const [lng, lat] of rings[0] ?? []) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

export function bboxIntersects(a: Bbox, b: Bbox): boolean {
  return !(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
}

export function bboxContainsPoint(b: Bbox, [lng, lat]: Point): boolean {
  return lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3];
}

/** Rough size, for "is this candidate absurdly bigger than its parent?". */
export function bboxSpan(b: Bbox): number {
  return Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Point in area
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Ray casting. A ray east from the point crosses the ring an odd number of
 * times iff the point is inside it.
 *
 * Points exactly ON an edge are undefined — they land inside or outside
 * depending on floating-point luck. That is tolerable here and nowhere near
 * the accuracy this file promises: every caller either samples many points and
 * takes a ratio, or tests an interior point that is nowhere near an edge.
 */
function inRing(ring: number[][], lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inPolygon(rings: Rings, lng: number, lat: number): boolean {
  if (!rings.length || !inRing(rings[0], lng, lat)) return false;
  // A hole punches the point back out — a council with an enclave in it.
  for (let i = 1; i < rings.length; i++) {
    if (inRing(rings[i], lng, lat)) return false;
  }
  return true;
}

export function pointInArea(area: GeoJsonArea, [lng, lat]: Point): boolean {
  for (const rings of polygonsOf(area)) {
    if (inPolygon(rings, lng, lat)) return true;
  }
  return false;
}

/* ──────────────────────────────────────────────────────────────────────────
 * A point that is definitely inside
 * ────────────────────────────────────────────────────────────────────────── */

/** Shoelace. Signed, so the sign tells us the winding; callers want the size. */
function ringArea(ring: number[][]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return sum / 2;
}

function ringCentroid(ring: number[][]): Point {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    twiceArea += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  if (twiceArea === 0) return [ring[0][0], ring[0][1]];
  return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

/** All the x's where a horizontal line at `lat` crosses this polygon. */
function crossingsAt(rings: Rings, lat: number): number[] {
  const xs: number[] = [];
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > lat !== yj > lat) xs.push(((xj - xi) * (lat - yi)) / (yj - yi) + xi);
    }
  }
  return xs.sort((a, b) => a - b);
}

/**
 * A point guaranteed to be inside the area — the thing a centroid is not.
 *
 * A centroid falls outside anything sufficiently concave, and councils are
 * routinely concave: a harbour, a river mouth, a shire wrapped around a city.
 * Getting this wrong is not cosmetic — it is how a genuine child region gets
 * dropped from the gazetteer for not being inside its own parent.
 *
 * So: try the centroid of the largest polygon, and when that lands in the
 * water, walk the horizontal line through it and take the middle of the widest
 * span that is actually inside.
 */
export function interiorPointOf(area: GeoJsonArea): Point {
  const polys = polygonsOf(area).filter((rings) => (rings[0]?.length ?? 0) >= 3);
  if (!polys.length) return [0, 0];

  // The mainland, not an island: a representative point should sit in the part
  // of the region that most of it is.
  const largest = polys.reduce((best, rings) =>
    Math.abs(ringArea(rings[0])) > Math.abs(ringArea(best[0])) ? rings : best,
  );

  const centroid = ringCentroid(largest[0]);
  if (inPolygon(largest, centroid[0], centroid[1])) return centroid;

  const xs = crossingsAt(largest, centroid[1]);
  let best: Point | null = null;
  let bestWidth = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const width = xs[i + 1] - xs[i];
    if (width > bestWidth && inPolygon(largest, mid, centroid[1])) {
      bestWidth = width;
      best = [mid, centroid[1]];
    }
  }
  // Degenerate shapes only — a ring too coarse to have an interior at this
  // latitude. A vertex is wrong but bounded, and never silently plausible.
  return best ?? [largest[0][0][0], largest[0][0][1]];
}

/* ──────────────────────────────────────────────────────────────────────────
 * Containment
 * ────────────────────────────────────────────────────────────────────────── */

/** Square of the distance from a point to a line segment. */
function distanceSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

/** Is this point within `tolerance` degrees of the area's outline? */
export function pointNearArea(area: GeoJsonArea, [lng, lat]: Point, tolerance: number): boolean {
  const tolSq = tolerance * tolerance;
  for (const rings of polygonsOf(area)) {
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        if (distanceSqToSegment(lng, lat, ring[j][0], ring[j][1], ring[i][0], ring[i][1]) <= tolSq) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * How far outside its parent a child is allowed to stray, in degrees.
 *
 * ~330m at Australian latitudes, and it is a statement about mapping rather
 * than about geography. Boundaries come out of Nominatim simplified to 0.001°
 * (~110m), and a child and its parent are simplified independently — so along
 * a shared border the two disagree by up to twice that, in both directions, at
 * dozens of points, and rather more than twice it where a corner is cut on both
 * sides at once. Three times the simplification tolerance covers the corners.
 *
 * It is safe to be generous here. The threshold this feeds is 98% of a region's
 * outline, so calling something contained still requires nearly all of it to be
 * within 330m of a parent it is not inside — and the nearest thing we might
 * confuse it with, a neighbouring council, has its far side tens of kilometres
 * away.
 *
 * The regression that set this number: Annandale is unambiguously inside Inner
 * West Council, and a strict test said it was not. The suburb is about a
 * kilometre across, so a 110m simplification error is a tenth of it, and most
 * of its outline is shared border. Proportional slack cannot fix that — 2% of
 * a small region is 20m — which is why the tolerance is absolute and tied to
 * the simplification, not to the size of what is being tested.
 */
export const BOUNDARY_TOLERANCE_DEGREES = 0.003;

/**
 * How much of the child sits inside the parent, as a fraction of sampled
 * points. 1 is fully inside; 0 is fully outside.
 *
 * Sampling rather than exact polygon clipping, because the answer only has to
 * survive a threshold and clipping is a library. The samples are the child's
 * own vertices, tested as "inside the parent, or close enough to its border to
 * be a mapping artefact" — see the tolerance above.
 */
export function containmentRatio(parent: GeoJsonArea, child: GeoJsonArea): number {
  const polys = polygonsOf(child).filter((rings) => (rings[0]?.length ?? 0) >= 3);
  if (!polys.length) return 0;

  const held = (p: Point) =>
    pointInArea(parent, p) || pointNearArea(parent, p, BOUNDARY_TOLERANCE_DEGREES);

  let inside = 0;
  let total = 0;
  for (const rings of polys) {
    const ring = rings[0];
    // Cap the work. A state boundary is 6,291 points against a parent of the
    // same order, and the ratio does not get more true for being measured
    // 6,291 times.
    const step = Math.max(1, Math.ceil(ring.length / MAX_SAMPLES_PER_RING));
    for (let i = 0; i < ring.length; i += step) {
      total += 1;
      if (held([ring[i][0], ring[i][1]])) inside += 1;
    }
  }

  // The interior point counts too, and counts for the case the ring samples
  // cannot see: a doughnut parent whose hole is exactly this child.
  total += 1;
  if (held(interiorPointOf(child))) inside += 1;

  return total === 0 ? 0 : inside / total;
}

const MAX_SAMPLES_PER_RING = 400;

/**
 * Is the child inside the parent?
 *
 * Two per cent of slack, which is a statement about mapping and simplification
 * rather than about geography: administrative areas nest exactly, so anything
 * genuinely inside scores ~1 and anything genuinely beside scores near 0. There
 * is no real population of regions in the 0.5–0.97 band to be wrong about.
 */
export const CONTAINMENT_RATIO = 0.98;

export function contains(parent: GeoJsonArea, child: GeoJsonArea): boolean {
  // Cheap rejection first: most pairs this is asked about are two councils on
  // opposite sides of a city, and a bbox test settles those without touching a
  // ring.
  if (!bboxIntersects(bboxOf(parent), bboxOf(child))) return false;
  return containmentRatio(parent, child) >= CONTAINMENT_RATIO;
}
