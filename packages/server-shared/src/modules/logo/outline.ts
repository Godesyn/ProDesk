/**
 * Wordmark outlining — converts text into vector paths using the shipped
 * typefaces (typefaces.ts).
 *
 * WHY: a lockup's wordmark used to be a live `<text>` node with a
 * `font-family: 'Inter Tight'` stack. That renders correctly in the browser (the
 * client loads the webfont) but NOT on the server: `sharp`/librsvg has no such
 * font installed, so every exported PNG/PDF silently fell back to a different
 * face and the download did not match the preview. Converting to outlines is what
 * an identity designer does before handing off files — it makes the geometry the
 * source of truth, so SVG, PNG, and PDF are all identical and font-independent.
 *
 * Everything here works in FONT UNITS (y-up, `unitsPerEm` per em) and is
 * converted to SVG user units (y-down) by the placement transform in `textNode`.
 */
import { openSync } from 'fontkit';
import { WORDMARK_WEIGHTS } from './layout.js';
import { getTypeface, type TypefaceKey } from './typefaces.js';

/* fontkit's published types describe a broad union (single faces and
 * collections). We only ever open single-face binaries we ship, so narrow to the
 * handful of members we use rather than threading that union through every call. */
interface GlyphPath {
  toSVG(): string;
  translate(x: number, y: number): GlyphPath;
}
interface LoadedFace {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  capHeight?: number;
  variationAxes?: Record<string, { min?: number; max?: number } | undefined>;
  getVariation?: (settings: Record<string, number>) => LoadedFace;
  layout: (text: string) => {
    glyphs: { path: GlyphPath }[];
    positions: { xAdvance: number; xOffset: number; yOffset: number }[];
    advanceWidth: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number };
  };
}

/** Loaded faces are cached per typeface+weight — instancing is not free. */
const faceCache = new Map<string, LoadedFace>();
/** The uninstanced binaries, cached separately so the axis can be read once. */
const baseCache = new Map<TypefaceKey, LoadedFace>();

function baseFace(key: TypefaceKey): LoadedFace {
  const hit = baseCache.get(key);
  if (hit) return hit;
  const face = openSync(getTypeface(key).file) as unknown as LoadedFace;
  baseCache.set(key, face);
  return face;
}

function loadFace(key: TypefaceKey, weight: number): LoadedFace {
  const cacheKey = `${key}:${weight}`;
  const hit = faceCache.get(cacheKey);
  if (hit) return hit;

  let face = baseFace(key);
  // Instance the weight on variable faces; static faces have no wght axis.
  const axis = weightAxis(key);
  if (axis && typeof face.getVariation === 'function') {
    // CLAMP to the face's own range. The shipped faces do not agree on one —
    // Space Grotesk and IBM Plex Sans stop at 700, Source Serif starts at 200,
    // DM Sans goes to 1000 — and asking for a weight off the end of the axis is
    // not a documented no-op, so a shared "make it heavy" default could quietly
    // produce a differently-instanced face on some of them.
    face = face.getVariation({ wght: Math.min(axis.max, Math.max(axis.min, weight)) });
  }
  faceCache.set(cacheKey, face);
  return face;
}

/** The weight range a face can actually be instanced across. */
export interface WeightAxis {
  min: number;
  max: number;
}

const axisCache = new Map<TypefaceKey, WeightAxis | null>();

/**
 * A face's `wght` axis, or null when the binary is static (Instrument Serif ships
 * Regular only). Read from the font itself rather than declared in the registry:
 * the ranges genuinely differ face to face, and a hand-maintained table would
 * eventually offer the editor a weight the binary cannot cut.
 */
export function weightAxis(key: TypefaceKey): WeightAxis | null {
  const hit = axisCache.get(key);
  if (hit !== undefined) return hit;
  const raw = baseFace(key).variationAxes?.wght;
  const min = Math.round(Number(raw?.min));
  const max = Math.round(Number(raw?.max));
  const out = Number.isFinite(min) && Number.isFinite(max) && max > min ? { min, max } : null;
  axisCache.set(key, out);
  return out;
}

/**
 * The weights the editor offers for a face — the standard ladder, clipped to what
 * this binary supports, with the face's own display weight guaranteed present.
 *
 * A static face returns exactly one entry, which is the editor's signal to show
 * the weight as a fact rather than a control.
 */
export function weightSteps(key: TypefaceKey): number[] {
  const own = getTypeface(key).wordmarkWeight;
  const axis = weightAxis(key);
  if (!axis) return [own];
  const clamped = Math.min(axis.max, Math.max(axis.min, own));
  const steps = WORDMARK_WEIGHTS.filter((w) => w >= axis.min && w <= axis.max);
  if (!steps.includes(clamped)) steps.push(clamped);
  return steps.sort((a, b) => a - b);
}

/** The face's own display weight, clamped to what the binary can cut. */
export function defaultWeight(key: TypefaceKey): number {
  const own = getTypeface(key).wordmarkWeight;
  const axis = weightAxis(key);
  return axis ? Math.min(axis.max, Math.max(axis.min, own)) : own;
}

/**
 * Strip characters that have no business in a wordmark and would render as
 * `.notdef` tofu boxes: C0/C1 controls, zero-width and bidi marks, and the
 * exotic Unicode spaces. Collapses remaining whitespace to single spaces.
 */
const STRIP_RE = new RegExp(
  '[' +
    '\u0000-\u001F\u007F-\u009F' + // C0 / C1 control characters
    '\u200B-\u200F\u2028\u2029' + // zero-width, bidi marks, separators
    '\u202A-\u202E\u2060\uFEFF' + // bidi embedding, word joiner, BOM
    ']',
  'g',
);

export function cleanWordmark(text: string): string {
  return (
    String(text ?? '')
      // Fold real whitespace (tabs/newlines included) to spaces FIRST. Doing it
      // after the strip would delete a tab outright and weld two words
      // together — "Meridian<TAB>Co" has to stay two words.
      .replace(/\s+/g, ' ')
      // Now drop what must vanish rather than separate: zero-width spaces, bidi
      // marks, BOM, and the remaining control codes.
      .replace(STRIP_RE, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

export interface OutlinedText {
  /** Combined path data for the whole string, in font units (y-up). */
  d: string;
  /** Total advance in font units, including tracking between glyphs. */
  advance: number;
  unitsPerEm: number;
  ascent: number;
  descent: number;
  /** Cap height in font units — what display type is optically centred on. */
  capHeight: number;
  /** Tight ink bounds in font units. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Lay out `text` and return its combined outline. Tracking is expressed in em
 * (matching CSS `letter-spacing` in em) and applied BETWEEN glyphs only, so the
 * advance carries no trailing gap.
 */
export function outlineText(
  text: string,
  opts: { typeface: TypefaceKey; weight?: number; tracking?: number },
): OutlinedText {
  const tf = getTypeface(opts.typeface);
  const weight = opts.weight ?? tf.wordmarkWeight;
  const tracking = opts.tracking ?? tf.tracking;
  const face = loadFace(tf.key, weight);
  const upem = face.unitsPerEm || 1000;
  const capHeight = face.capHeight ?? face.ascent * 0.72;
  const clean = cleanWordmark(text);

  if (!clean) {
    return {
      d: '',
      advance: 0,
      unitsPerEm: upem,
      ascent: face.ascent,
      descent: face.descent,
      capHeight,
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    };
  }

  const run = face.layout(clean);
  const trackUnits = tracking * upem;

  // Bake each glyph's pen position into its path data so the finished wordmark
  // is a single <path> — smallest possible output, and trivially rasterisable.
  const parts: string[] = [];
  let pen = 0;
  for (let i = 0; i < run.glyphs.length; i++) {
    const pos = run.positions[i] ?? { xAdvance: 0, xOffset: 0, yOffset: 0 };
    const d = run.glyphs[i].path.translate(pen + pos.xOffset, pos.yOffset).toSVG();
    if (d) parts.push(d);
    pen += pos.xAdvance;
    if (i < run.glyphs.length - 1) pen += trackUnits;
  }

  return {
    d: parts.join(' '),
    advance: pen,
    unitsPerEm: upem,
    ascent: face.ascent,
    descent: face.descent,
    capHeight,
    bbox: run.bbox,
  };
}

export interface TextNode {
  /** Ready-to-embed SVG markup, positioned in the caller's user space. */
  svg: string;
  /** Advance width in SVG user units at the requested font size. */
  width: number;
  /** Cap height in SVG user units — use this to optically centre the wordmark. */
  capHeight: number;
}

/**
 * Compose an outlined wordmark as SVG markup placed at (`x`, `y`), where `y` is
 * the TEXT BASELINE. The `scale(s, -s)` flip converts font units (y-up) to SVG
 * user units (y-down).
 */
export function textNode(args: {
  text: string;
  typeface: TypefaceKey;
  fontSize: number;
  weight?: number;
  tracking?: number;
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  /** Defaults to `currentColor` so the lockup's ink drives it. */
  fill?: string;
}): TextNode {
  const out = outlineText(args.text, {
    typeface: args.typeface,
    weight: args.weight,
    tracking: args.tracking,
  });
  const scale = args.fontSize / out.unitsPerEm;
  const width = out.advance * scale;
  const capHeight = out.capHeight * scale;
  if (!out.d) return { svg: '', width: 0, capHeight };

  const anchor = args.anchor ?? 'start';
  const dx = anchor === 'middle' ? -width / 2 : anchor === 'end' ? -width : 0;
  return {
    svg:
      `<path transform="translate(${round(args.x + dx)} ${round(args.y)}) ` +
      `scale(${round(scale, 6)} ${round(-scale, 6)})" ` +
      `fill="${args.fill ?? 'currentColor'}" d="${out.d}"/>`,
    width,
    capHeight,
  };
}

/** Measure an outlined wordmark without emitting markup (for layout maths). */
export function measureText(args: {
  text: string;
  typeface: TypefaceKey;
  fontSize: number;
  weight?: number;
  tracking?: number;
}): { width: number; capHeight: number } {
  const out = outlineText(args.text, {
    typeface: args.typeface,
    weight: args.weight,
    tracking: args.tracking,
  });
  const scale = args.fontSize / out.unitsPerEm;
  return { width: out.advance * scale, capHeight: out.capHeight * scale };
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
