/**
 * A dependency-light world choropleth. Countries are shaded by a metric (e.g.
 * clicks) supplied as ISO 3166-1 alpha-2 codes — the form our redirector stores
 * from `cf-ipcountry` / GeoIP. Built directly on d3-geo + a bundled world-atlas
 * topojson (no react-simple-maps) so it's fully themeable via props and has no
 * runtime network fetch.
 *
 * Lazy-load this from consumers (`React.lazy`) so d3-geo + the topojson stay out
 * of the main bundle — it's only needed on the analytics screens.
 */
import { useMemo, useState } from 'react';
import { geoNaturalEarth1, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import { ISO_A2, ISO_NUMERIC_NAME } from './iso-country.js';
// world-atlas ships JSON without type declarations; the shape is a topojson
// Topology, which `feature()` accepts.
import worldTopo from 'world-atlas/countries-110m.json';

const WIDTH = 800;
const HEIGHT = 400;

type GeoFeature = {
  id?: string | number;
  type: string;
  properties: { name?: string };
  geometry: unknown;
};

// The projection + path generator only depend on the (static) topology and the
// fixed viewBox, so build them once at module load rather than per render.
const FEATURES: GeoFeature[] = (() => {
  const topo = worldTopo as unknown as Parameters<typeof feature>[0];
  const fc = feature(topo, (topo as any).objects.countries) as unknown as {
    features: GeoFeature[];
  };
  return fc.features;
})();

const PROJECTION = geoNaturalEarth1().fitSize([WIDTH, HEIGHT], {
  type: 'FeatureCollection',
  features: FEATURES as any,
} as any);

const PATH = geoPath(PROJECTION as any);

/** Parse "#rrggbb" → [r,g,b]; falls back to a green if malformed. */
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [22, 163, 74];
  const int = parseInt(m[1], 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

export interface WorldMapDatum {
  /** ISO 3166-1 alpha-2 country code (e.g. "US", "AU"). */
  country: string;
  count: number;
}

export interface WorldMapProps {
  data: WorldMapDatum[];
  /** Fill for countries with the highest value; lower values scale toward transparent. */
  accentColor?: string;
  /** Fill for countries with no data. */
  emptyColor?: string;
  /** Stroke between countries. */
  strokeColor?: string;
  className?: string;
}

export function WorldMap({
  data,
  accentColor = '#16a34a',
  emptyColor = 'rgba(148, 163, 184, 0.18)',
  strokeColor = 'rgba(148, 163, 184, 0.35)',
  className,
}: WorldMapProps) {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    name: string;
    count: number;
  } | null>(null);

  // Roll the alpha-2 data up onto the topojson's numeric ids.
  const { byNumeric, max } = useMemo(() => {
    const byNumeric = new Map<string, number>();
    let max = 0;
    for (const d of data) {
      const entry = ISO_A2[(d.country || '').toUpperCase()];
      if (!entry) continue;
      const n = entry[0];
      const next = (byNumeric.get(n) ?? 0) + d.count;
      byNumeric.set(n, next);
      if (next > max) max = next;
    }
    return { byNumeric, max };
  }, [data]);

  const [ar, ag, ab] = useMemo(() => hexToRgb(accentColor), [accentColor]);

  const fillFor = (count: number): string => {
    if (!count || max <= 0) return emptyColor;
    // sqrt easing lifts small-but-nonzero countries out of near-invisibility.
    const ratio = Math.sqrt(count / max);
    const alpha = 0.22 + 0.78 * ratio;
    return `rgba(${ar}, ${ag}, ${ab}, ${alpha.toFixed(3)})`;
  };

  return (
    <div className={className} style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        height="auto"
        role="img"
        aria-label="World map of activity by country"
        style={{ display: 'block' }}
        onMouseLeave={() => setTip(null)}
      >
        {FEATURES.map((geo, i) => {
          const id = geo.id == null ? '' : String(geo.id).padStart(3, '0');
          const count = byNumeric.get(id) ?? 0;
          const name =
            ISO_NUMERIC_NAME[id] ?? geo.properties?.name ?? 'Unknown';
          const d = PATH(geo as any) ?? undefined;
          if (!d) return null;
          return (
            <path
              key={id || i}
              d={d}
              fill={fillFor(count)}
              stroke={strokeColor}
              strokeWidth={0.5}
              style={{ cursor: count ? 'pointer' : 'default' }}
              onMouseMove={(e) => {
                const box = (
                  e.currentTarget.ownerSVGElement as SVGSVGElement
                ).getBoundingClientRect();
                setTip({
                  x: e.clientX - box.left,
                  y: e.clientY - box.top,
                  name,
                  count,
                });
              }}
            />
          );
        })}
      </svg>
      {tip && (
        <div
          style={{
            position: 'absolute',
            left: tip.x + 12,
            top: tip.y + 12,
            pointerEvents: 'none',
            background: 'rgba(17, 24, 39, 0.92)',
            color: '#fff',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 500,
            whiteSpace: 'nowrap',
            zIndex: 20,
            transform:
              tip.x > WIDTH * 0.75 ? 'translateX(-100%)' : undefined,
          }}
        >
          {tip.name}: {tip.count.toLocaleString()}
        </div>
      )}
    </div>
  );
}

export default WorldMap;
