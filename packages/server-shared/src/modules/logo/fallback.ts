/**
 * Deterministic procedural generator. Produces valid, on-contract concepts with
 * no LLM call — used when no AI family is configured (local dev / missing key),
 * or as a graceful fallback when a model returns unusable SVG. Keyed off the
 * brand name + index so results are stable across reloads (no Math.random, which
 * also keeps it usable inside the migration/test harness).
 *
 * These are honest geometric marks (the studio's strength), not placeholders —
 * they follow the same currentColor + <g id="mark"> contract as generated marks.
 */
import type { GeneratedConcept, LogoBrief, LogoColor, MarkKind } from './types.js';
import { personalityWords } from './prompts.js';

/** Cheap deterministic hash → 32-bit int. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A tasteful palette rotation; index picks a family, all accessible on paper. */
const PALETTES: { primary: [string, string]; accent: [string, string]; rule: string }[] = [
  { primary: ['Forest', '#2E9E58'], accent: ['Deep Pine', '#14532D'], rule: '#C9C7BD' },
  { primary: ['Cobalt', '#2563EB'], accent: ['Ink Blue', '#1E3A8A'], rule: '#CBD5E1' },
  { primary: ['Ember', '#EA580C'], accent: ['Clay', '#9A3412'], rule: '#E7D9CE' },
  { primary: ['Plum', '#7C3AED'], accent: ['Aubergine', '#4C1D95'], rule: '#DDD6FE' },
  { primary: ['Teal', '#0D9488'], accent: ['Deep Teal', '#134E4A'], rule: '#CCE3E0' },
  { primary: ['Crimson', '#DC2626'], accent: ['Maroon', '#7F1D1D'], rule: '#E9D5D5' },
];

function paletteFor(i: number): LogoColor[] {
  const p = PALETTES[i % PALETTES.length];
  return [
    { role: 'Primary', name: p.primary[0], hex: p.primary[1] },
    { role: 'Accent', name: p.accent[0], hex: p.accent[1] },
    { role: 'Ink', name: 'Graphite', hex: '#0E0E0C' },
    { role: 'Background', name: 'Paper', hex: '#FFFFFF' },
    { role: 'Rule', name: 'Mist', hex: p.rule },
  ];
}

/** Nine hand-authored mark bodies (inner markup of <g id="mark">). */
function markBody(variant: number, initials: string): string {
  const sw = 'stroke="currentColor" stroke-width="7" fill="none"';
  const fw = 'fill="currentColor"';
  const letter = (initials || 'A').slice(0, 1).toUpperCase();
  const bodies: string[] = [
    // 0 — Peak: ascending ridge + summit dot
    `<path d="M16 74 L38 40 L52 57 L86 20" ${sw}/><circle cx="86" cy="20" r="5" ${fw}/>`,
    // 1 — Loop: interlocking M
    `<path d="M22 78 L22 26 L50 60 L78 26 L78 78" ${sw}/>`,
    // 2 — Orbit: concentric arcs
    `<circle cx="50" cy="50" r="30" ${sw}/><circle cx="50" cy="50" r="18" ${sw}/><circle cx="50" cy="50" r="6" ${fw}/>`,
    // 3 — Prism: faceted triangle
    `<path d="M50 18 L82 74 L18 74 Z" ${sw}/><path d="M50 18 L50 74" ${sw}/><path d="M50 46 L82 74" ${sw}/>`,
    // 4 — Compass: cardinal cross in a ring
    `<circle cx="50" cy="50" r="32" ${sw}/><path d="M50 34 L62 50 L50 66 L38 50 Z" ${fw}/>`,
    // 5 — Strata: stacked ridges
    `<path d="M20 46 L50 30 L80 46" ${sw}/><path d="M20 60 L50 44 L80 60" ${sw}/><path d="M20 74 L50 58 L80 74" ${sw}/>`,
    // 6 — Aperture: hexagon shutter
    `<path d="M50 16 L79 33 L79 67 L50 84 L21 67 L21 33 Z" ${sw}/><circle cx="50" cy="50" r="12" ${fw}/>`,
    // 7 — Node: linked network
    `<circle cx="30" cy="34" r="8" ${fw}/><circle cx="72" cy="30" r="8" ${fw}/><circle cx="50" cy="72" r="8" ${fw}/><path d="M30 34 L72 30 L50 72 Z" ${sw}/>`,
    // 8 — Lettermark: initial in a rounded square
    `<rect x="18" y="18" width="64" height="64" rx="16" ${sw}/><text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-family="'Inter Tight', sans-serif" font-weight="800" font-size="42" ${fw}>${letter}</text>`,
  ];
  return bodies[variant % bodies.length];
}

const NAMES = ['Peak', 'Loop', 'Orbit', 'Prism', 'Compass', 'Strata', 'Aperture', 'Node', 'Cipher'];
const NOTES = [
  'Ascending ridge mark',
  'Interlocking monogram',
  'Concentric guidance arcs',
  'Faceted geometric prism',
  'Cardinal compass in a ring',
  'Stacked strata form',
  'Aperture / shutter mark',
  'Linked network nodes',
  'Rounded lettermark',
];
const KINDS: MarkKind[] = [
  'geometric', 'monogram', 'geometric', 'combination', 'geometric',
  'monogram', 'geometric', 'combination', 'monogram',
];

function conceptAt(brief: LogoBrief, index: number): GeneratedConcept {
  const seed = hash(`${brief.businessName}:${index}`);
  const variant = seed % 9;
  const initials = brief.initials || brief.businessName.slice(0, 2);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ` +
    `stroke-linecap="round" stroke-linejoin="round" role="img">` +
    `<g id="mark">${markBody(variant, initials)}</g></svg>`;
  return {
    name: NAMES[variant],
    kind: KINDS[variant],
    note: NOTES[variant],
    svg,
    spec: {
      palette: paletteFor(seed % PALETTES.length),
      fonts: {
        heading: "'Inter Tight', system-ui, sans-serif",
        body: "'Inter Tight', system-ui, sans-serif",
      },
      geometry: NOTES[variant],
      rationale: `A ${personalityWords(brief)[0]} form for ${brief.businessName}.`,
      elements: ['mark'],
    },
  };
}

/** Generate `count` distinct concepts, offset so "six more" stays fresh. */
export function fallbackConcepts(
  brief: LogoBrief,
  count: number,
  offset = 0,
): GeneratedConcept[] {
  return Array.from({ length: count }, (_, i) => conceptAt(brief, offset + i));
}

/** A minimal deterministic iteration: rotate to the next variant. */
export function fallbackIterate(
  brief: LogoBrief,
  currentIndex: number,
): GeneratedConcept {
  return conceptAt(brief, currentIndex + 1);
}
