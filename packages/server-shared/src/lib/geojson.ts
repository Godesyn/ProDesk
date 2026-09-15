/**
 * The one GeoJSON shape this codebase passes around: an area to search.
 *
 * It lives here, in a leaf with no imports, because it is named in three places
 * that must not depend on each other — the `outreach_list_runs` column, the
 * scrape spec, and the region-search provider that produces it.
 *
 * RFC 7946 order: [longitude, latitude]. Getting that backwards is the classic
 * way to scrape the Atlantic, and it is not something a type can catch, so it
 * is written down at every boundary that hands one of these over.
 */
export type GeoJsonArea =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] };

/** Cheap structural check for something that crossed a wire or came out of jsonb. */
export function isGeoJsonArea(value: unknown): value is GeoJsonArea {
  if (!value || typeof value !== 'object') return false;
  const { type, coordinates } = value as { type?: unknown; coordinates?: unknown };
  return (type === 'Polygon' || type === 'MultiPolygon') && Array.isArray(coordinates);
}
