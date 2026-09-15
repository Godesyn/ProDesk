/**
 * The studio's shipped typefaces — the curated set a wordmark can be set in.
 *
 * WHY A CURATED SET: a lockup's wordmark is converted to vector OUTLINES at build
 * time (see outline.ts) so the SVG/PNG/PDF a user downloads is pixel-identical to
 * the preview and carries no font dependency. Outlining requires the actual font
 * binary, so the studio can only faithfully set type in faces we ship. The model
 * is free to *suggest* any CSS family; `snapTypeface` maps that suggestion onto
 * the nearest shipped face.
 *
 * WHY THESE ONES: they are the Brand Kit's web-font list (packages/shared
 * `FONT_OPTIONS`), so a wordmark set here and a signature, proposal, or review
 * widget set from the same brand kit are the same typeface rather than two houses
 * of type that happen to sit next to each other. The Brand Kit's web-safe
 * classics (Arial, Georgia, Times…) are deliberately NOT here: they are system
 * fonts with no redistributable binary, so we could not outline them.
 *
 * The same families are loaded from Google Fonts in `clients/logo/index.html` and
 * `src/index.css`, so the picker's specimen matches the outlined export.
 *
 * Every binary is SIL Open Font License 1.1 — see assets/fonts/README.md.
 */
import { fileURLToPath } from 'node:url';

export type TypefaceKey =
  | 'inter-tight'
  | 'inter'
  | 'archivo'
  | 'space-grotesk'
  | 'work-sans'
  | 'dm-sans'
  | 'ibm-plex-sans'
  | 'instrument-serif'
  | 'fraunces'
  | 'source-serif'
  | 'jetbrains-mono';

export interface Typeface {
  key: TypefaceKey;
  label: string;
  /** The CSS stack persisted in `spec.fonts` / `brands.typography`. */
  cssFamily: string;
  /** Absolute path to the shipped binary. */
  file: string;
  /**
   * Weight instanced from the variable font for wordmark use. Static faces
   * ignore this (Instrument Serif ships Regular only), and a weight outside the
   * face's own axis range is clamped in outline.ts.
   */
  wordmarkWeight: number;
  category: 'sans' | 'serif' | 'mono';
  /** Default tracking (em) when set as a wordmark — display type wants it tight. */
  tracking: number;
}

/**
 * Resolve a shipped font binary. `src/modules/logo/` and `dist/modules/logo/` sit
 * at the same depth below the package root, so this one relative path is correct
 * both when running from TS source (dev/tests) and from the compiled build.
 */
function fontPath(file: string): string {
  return fileURLToPath(new URL(`../../../assets/fonts/${file}`, import.meta.url));
}

export const TYPEFACES: Record<TypefaceKey, Typeface> = {
  /* ── sans ── */
  'inter-tight': {
    key: 'inter-tight',
    label: 'Inter Tight',
    cssFamily: "'Inter Tight', system-ui, sans-serif",
    file: fontPath('InterTight-var.ttf'),
    wordmarkWeight: 800,
    category: 'sans',
    tracking: -0.035,
  },
  inter: {
    key: 'inter',
    label: 'Inter',
    cssFamily: "'Inter', system-ui, sans-serif",
    file: fontPath('Inter-var.ttf'),
    wordmarkWeight: 800,
    category: 'sans',
    tracking: -0.03,
  },
  archivo: {
    key: 'archivo',
    label: 'Archivo',
    cssFamily: "'Archivo', system-ui, sans-serif",
    file: fontPath('Archivo-var.ttf'),
    wordmarkWeight: 800,
    category: 'sans',
    tracking: -0.03,
  },
  'space-grotesk': {
    key: 'space-grotesk',
    label: 'Space Grotesk',
    cssFamily: "'Space Grotesk', system-ui, sans-serif",
    file: fontPath('SpaceGrotesk-var.ttf'),
    // The axis tops out at 700 — outline.ts clamps, but state the real weight.
    wordmarkWeight: 700,
    category: 'sans',
    tracking: -0.03,
  },
  'work-sans': {
    key: 'work-sans',
    label: 'Work Sans',
    cssFamily: "'Work Sans', system-ui, sans-serif",
    file: fontPath('WorkSans-var.ttf'),
    wordmarkWeight: 700,
    category: 'sans',
    tracking: -0.025,
  },
  'dm-sans': {
    key: 'dm-sans',
    label: 'DM Sans',
    cssFamily: "'DM Sans', system-ui, sans-serif",
    file: fontPath('DMSans-var.ttf'),
    wordmarkWeight: 700,
    category: 'sans',
    tracking: -0.03,
  },
  'ibm-plex-sans': {
    key: 'ibm-plex-sans',
    label: 'IBM Plex Sans',
    cssFamily: "'IBM Plex Sans', system-ui, sans-serif",
    file: fontPath('IBMPlexSans-var.ttf'),
    wordmarkWeight: 600,
    category: 'sans',
    tracking: -0.02,
  },

  /* ── serif ── */
  'instrument-serif': {
    key: 'instrument-serif',
    label: 'Instrument Serif',
    cssFamily: "'Instrument Serif', Georgia, serif",
    file: fontPath('InstrumentSerif-Regular.ttf'),
    wordmarkWeight: 400,
    category: 'serif',
    tracking: -0.01,
  },
  fraunces: {
    key: 'fraunces',
    label: 'Fraunces',
    cssFamily: "'Fraunces', Georgia, serif",
    file: fontPath('Fraunces-var.ttf'),
    wordmarkWeight: 700,
    category: 'serif',
    tracking: -0.02,
  },
  'source-serif': {
    key: 'source-serif',
    label: 'Source Serif 4',
    cssFamily: "'Source Serif 4', Georgia, serif",
    file: fontPath('SourceSerif4-var.ttf'),
    wordmarkWeight: 600,
    category: 'serif',
    tracking: -0.015,
  },

  /* ── mono ── */
  'jetbrains-mono': {
    key: 'jetbrains-mono',
    label: 'JetBrains Mono',
    cssFamily: "'JetBrains Mono', ui-monospace, monospace",
    file: fontPath('JetBrainsMono-var.ttf'),
    wordmarkWeight: 700,
    category: 'mono',
    tracking: -0.02,
  },
};

/** Every shipped key, in picker order (sans → serif → mono). */
export const TYPEFACE_KEYS = Object.keys(TYPEFACES) as TypefaceKey[];

/*
 * `WORDMARK_WEIGHTS` and `weightLabel` live in layout.ts, not here: this module
 * reads `node:url` to resolve the shipped binaries, so the browser cannot import
 * it, and the editor's weight picker needs both. layout.ts is the dependency-free
 * seam both sides already share.
 */

export const DEFAULT_TYPEFACE: TypefaceKey = 'inter-tight';
/** Where a category falls back to when a suggestion only tells us the genre. */
const CATEGORY_DEFAULT: Record<Typeface['category'], TypefaceKey> = {
  sans: DEFAULT_TYPEFACE,
  serif: 'instrument-serif',
  mono: 'jetbrains-mono',
};

export function getTypeface(key: TypefaceKey): Typeface {
  return TYPEFACES[key] ?? TYPEFACES[DEFAULT_TYPEFACE];
}

export function isTypefaceKey(value: unknown): value is TypefaceKey {
  return typeof value === 'string' && value in TYPEFACES;
}

/** Serif family names we recognise in a model-suggested CSS stack. */
const SERIF_HINTS = [
  'serif',
  'georgia',
  'garamond',
  'times',
  'playfair',
  'baskerville',
  'didot',
  'bodoni',
  'lora',
  'merriweather',
  'spectral',
  'cormorant',
  'freight',
  'canela',
  'tiempos',
];

const MONO_HINTS = [
  'mono',
  'code',
  'courier',
  'consolas',
  'menlo',
  'ibm plex mono',
  'space mono',
];

/**
 * Shipped families keyed by their own name, longest first.
 *
 * Longest-first matters: "Inter Tight" contains "Inter", "Space Grotesk" would
 * otherwise be caught by nothing at all and "Source Serif 4" starts with a serif
 * hint. Checking the longest label first means the most specific name wins.
 */
const BY_NAME: { needle: string; key: TypefaceKey }[] = TYPEFACE_KEYS.map((key) => ({
  needle: TYPEFACES[key].label.toLowerCase(),
  key,
})).sort((a, b) => b.needle.length - a.needle.length);

/**
 * Map an arbitrary CSS font-family stack (whatever the model returned, or an old
 * persisted spec) onto the nearest shipped typeface.
 *
 * Order matters: an exact key, then a family we actually ship by name, and only
 * then the genre hints. Mono is checked before serif because several mono
 * families carry "sans"/"serif" in their names.
 */
export function snapTypeface(cssFamily: string | null | undefined): TypefaceKey {
  const raw = String(cssFamily ?? '').toLowerCase();
  if (!raw.trim()) return DEFAULT_TYPEFACE;
  // An exact key match wins (specs written after this change store the key).
  if (isTypefaceKey(raw)) return raw;
  // A face we ship, named in the stack — keep the designer's actual choice.
  for (const { needle, key } of BY_NAME) {
    if (raw.includes(needle)) return key;
  }
  if (MONO_HINTS.some((h) => raw.includes(h))) return CATEGORY_DEFAULT.mono;
  // "sans-serif" contains "serif" — only treat it as serif when it isn't sans.
  const deSans = raw.replace(/sans[-\s]?serif/g, 'sans');
  if (SERIF_HINTS.some((h) => deSans.includes(h))) return CATEGORY_DEFAULT.serif;
  return DEFAULT_TYPEFACE;
}

/** The canonical CSS stack for whatever face a suggestion snaps to. */
export function snapCssFamily(cssFamily: string | null | undefined): string {
  return getTypeface(snapTypeface(cssFamily)).cssFamily;
}
