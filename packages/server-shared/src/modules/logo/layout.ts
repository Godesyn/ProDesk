/**
 * Lockup layout — the geometry half of the logo engine, kept DEPENDENCY-FREE on
 * purpose so it runs unchanged in Node and in the browser.
 *
 * WHY THAT MATTERS: the editor's inspector used to send every slider change to
 * the server and wait for a rebuilt lockup to come back, so the canvas lagged a
 * drag by a whole round trip. Composition is pure maths over (mark SVG + one
 * measured wordmark outline + the adjustment), and the only part that genuinely
 * needs the filesystem is measuring the type — so the server measures once, ships
 * the outline to the client, and BOTH sides call `composeLockup` with the same
 * inputs. The canvas repaints on the very next frame and still renders the exact
 * bytes the export will produce, because it is literally the same function.
 *
 * Everything is laid out against the mark's INK (bbox.ts), not its viewBox: a
 * mark whose artwork sits high, low, or short of one edge — which generated marks
 * routinely do — would otherwise hand the wordmark a false centre line and read
 * as visibly misaligned.
 *
 * Keep this module free of imports other than `./bbox.js` (which is itself
 * dependency-free). Anything touching `node:*`, fontkit, or the DB belongs in
 * svg.ts / outline.ts instead.
 */
import { inkBounds } from './bbox.js';

/** The eight lockups a mark is presented and exported in. */
export type LockupSlot =
  | 'primary' // mark + wordmark, horizontal, in ink
  | 'stacked' // mark over wordmark, in ink
  | 'mono' // single-ink on paper
  | 'reversed' // paper-white on ink
  | 'color' // the horizontal lockup in the brand colour
  | 'colorReversed' // knocked out of the brand colour
  | 'mark' // symbol only (a component, not a lockup)
  | 'wordmark'; // type only (a component, not a lockup)

/**
 * Lockups proper — a complete presentation of the identity. Each one carries its
 * OWN colour contract (see `toneColor`), which is why the editor no longer has a
 * separate colourway switch: picking "Coloured reversed" IS picking a colourway.
 */
export const LOCKUP_SLOTS: LockupSlot[] = [
  'primary',
  'stacked',
  'mono',
  'reversed',
  'color',
  'colorReversed',
];

/** Components — the identity's parts, used on their own (favicons, tight rails). */
export const COMPONENT_SLOTS: LockupSlot[] = ['mark', 'wordmark'];

/** Every slot the engine builds, in export order. */
export const ALL_SLOTS: LockupSlot[] = [...LOCKUP_SLOTS, ...COMPONENT_SLOTS];

/** Human labels, shared by the editor, the guidelines, and the export manifest. */
export const SLOT_LABELS: Record<LockupSlot, string> = {
  primary: 'Primary',
  stacked: 'Stacked',
  mono: 'Monochrome',
  reversed: 'Reversed',
  color: 'Coloured',
  colorReversed: 'Coloured reversed',
  mark: 'Mark only',
  wordmark: 'Wordmark only',
};

/**
 * Every name a stored `brand_kits.logoSlots` entry may carry for a given slot,
 * canonical key first.
 *
 * WHY this exists: two surfaces write that column. Logo Studio's push-to-suite
 * writes the engine's own keys (`reversed`, `mark`, …); the dashboard's Brand Kit
 * used to write — and only ever read — its human display names (`Reversed`,
 * `Mark / favicon`, …). Neither knew about the other, so a brand could push a
 * finished identity into the suite and find the Brand Kit still showing empty
 * upload tiles. Resolving through one alias table lets the reader accept both
 * vocabularies while every writer settles on the canonical key.
 *
 * Matching is case-insensitive (see `matchSlot`), so only genuinely different
 * wordings need listing.
 */
export const SLOT_ALIASES: Record<LockupSlot, string[]> = {
  primary: ['primary', 'Primary', 'Lockup, horizontal', 'Horizontal lockup'],
  stacked: ['stacked', 'Stacked', 'Lockup, stacked', 'Vertical lockup'],
  mono: ['mono', 'Monochrome', 'Mono'],
  reversed: ['reversed', 'Reversed'],
  color: ['color', 'Coloured', 'Colored'],
  colorReversed: ['colorReversed', 'Coloured reversed', 'Colored reversed'],
  mark: ['mark', 'Mark only', 'Mark / favicon', 'Mark', 'Favicon', 'Icon'],
  wordmark: ['wordmark', 'Wordmark only', 'Wordmark'],
};

/** The canonical slot a stored entry name belongs to, or null if unrecognised. */
export function matchSlot(name: string): LockupSlot | null {
  const want = String(name ?? '').trim().toLowerCase();
  if (!want) return null;
  for (const [slot, names] of Object.entries(SLOT_ALIASES) as [LockupSlot, string[]][]) {
    if (names.some((n) => n.toLowerCase() === want)) return slot;
  }
  return null;
}

/**
 * Pick the URL for `slot` out of stored kit entries, whichever vocabulary they
 * were written in. Canonical keys win over display-name leftovers so a fresh
 * push always beats a stale hand-upload of the same slot.
 */
export function slotUrlFrom(
  entries: { slot: string; url?: string | null }[] | null | undefined,
  slot: LockupSlot,
): string | null {
  const mine = (entries ?? []).filter((e) => e?.url && matchSlot(e.slot) === slot);
  const canonical = mine.find((e) => e.slot === slot);
  return (canonical ?? mine[0])?.url ?? null;
}

const INK = '#0E0E0C';
const PAPER = '#FFFFFF';

/**
 * The weights a WORDMARK is worth being offered in.
 *
 * Deliberately short of the full 100–900 scale: Thin and Extra Light disappear at
 * the sizes a logo is actually reproduced at (a favicon, an app-store tile, an
 * embroidered polo), so offering them is offering a mark that fails its own job.
 * The list is clipped again per face by `weightSteps` in outline.ts — this is what
 * we would LIKE to offer, that is what the binary can actually cut.
 *
 * Here rather than in typefaces.ts because that module resolves font binaries
 * through `node:url` and so cannot be loaded in the browser, while the editor's
 * weight picker and the settings model both need this vocabulary.
 */
export const WORDMARK_WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

/** What each weight is called, so the journal, the copilot, and the UI agree. */
export const WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'Extra light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra bold',
  900: 'Black',
};

/** "600" → "Semibold"; an off-ladder value falls back to its own number. */
export function weightLabel(weight: number): string {
  return WEIGHT_LABELS[weight] ?? String(weight);
}

/**
 * The cut a face will ACTUALLY be set in: the requested weight snapped to the
 * nearest one this face ships, or the face's own display weight when nothing has
 * been asked for.
 *
 * Both sides must agree on this exactly, which is why it lives here rather than
 * being worked out twice. The server keys its measured-outline matrix by the
 * answer, and the browser looks the matrix up by it — so switching typeface with
 * a weight already chosen lands on a cell that is genuinely there. It did not,
 * once: the matrix held each face at its DEFAULT weight, the client asked for the
 * chosen one, missed, and rendered the default until the round trip returned the
 * right ladder — a visible jump in weight on every typeface click.
 *
 * Snapping matters because the ladders differ. Ask for 800 and switch to Space
 * Grotesk, whose axis stops at 700, and 700 is what the font can cut — so 700 is
 * what the preview must show, because 700 is what the export will contain.
 */
export function effectiveWeight(
  weights: number[],
  defaultWeight: number,
  want: number | null | undefined,
): number {
  if (want === null || want === undefined || !Number.isFinite(Number(want))) return defaultWeight;
  if (!weights.length) return defaultWeight;
  let best = weights[0];
  for (const w of weights) {
    if (Math.abs(w - Number(want)) < Math.abs(best - Number(want))) best = w;
  }
  return best;
}

/** A palette entry, structurally typed so this module needn't import the schema. */
export interface PaletteEntry {
  role: string;
  name: string;
  hex: string;
}

/**
 * Geometry adjustments the editor can make to a mark. These are PERSISTED on
 * `spec.adjust` and applied by the single composer below, so what the editor
 * previews is byte-for-byte what the export produces — the sliders are real
 * edits, not a preview-only affordance.
 */
export interface MarkAdjust {
  /** Uniform mark scale relative to the wordmark. 1 = as drawn. */
  scale: number;
  /** Global stroke-weight override in mark units. null = as drawn. */
  strokeWidth: number | null;
  /** Multiplier on the space between the mark and the wordmark. 1 = as designed. */
  gap: number;
  /** Clearspace multiple (1 = one cap-height) used by guides + guidelines. */
  clearspace: number;
  /** Ids of named mark elements hidden from the render AND the export. */
  hidden: string[];
  /**
   * The weight the wordmark is cut at, or null for the typeface's own display
   * weight.
   *
   * Nothing below reads it — by the time a lockup is composed the wordmark has
   * already been measured — but it belongs on the adjustment all the same: it is
   * an editor control, so it wants the same persistence, journalling, and undo as
   * the rest, and it is what tells `measureWordmark` which instance to cut.
   */
  wordmarkWeight: number | null;
}

export const DEFAULT_ADJUST: MarkAdjust = {
  scale: 1,
  strokeWidth: null,
  gap: 1,
  clearspace: 1,
  hidden: [],
  wordmarkWeight: null,
};

/** Read the adjustment off a spec, tolerating older specs that predate fields. */
export function resolveAdjust(adjust?: Partial<MarkAdjust> | null): MarkAdjust {
  if (!adjust) return DEFAULT_ADJUST;
  const scale = Number(adjust.scale);
  const stroke = adjust.strokeWidth;
  const gap = Number(adjust.gap);
  const clearspace = Number(adjust.clearspace);
  const weight = adjust.wordmarkWeight;
  return {
    scale: Number.isFinite(scale) ? clamp(scale, 0.2, 2) : 1,
    strokeWidth:
      stroke === null || stroke === undefined || !Number.isFinite(Number(stroke))
        ? null
        : clamp(Number(stroke), 0.5, 24),
    // Absent on specs written before the gap control existed — 1 is the
    // designed spacing, so an old mark composes exactly as it always did.
    gap: Number.isFinite(gap) ? clamp(gap, 0, 2.5) : 1,
    clearspace: Number.isFinite(clearspace) ? clamp(clearspace, 0.25, 3) : 1,
    hidden: Array.isArray(adjust.hidden) ? adjust.hidden.filter((h) => typeof h === 'string') : [],
    // Absent on every spec written before the weight control existed — null means
    // "the face's own display weight", so an old mark measures exactly as it did.
    wordmarkWeight:
      weight === null || weight === undefined || !Number.isFinite(Number(weight))
        ? null
        : clamp(Number(weight), 100, 1000),
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Extract the viewBox as [minX, minY, w, h] (defaults to a 100-square). */
export function viewBoxOf(svg: string): [number, number, number, number] {
  const m = svg.match(/viewBox\s*=\s*["']([\d.\-\s]+)["']/i);
  if (m) {
    const parts = m[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n)))
      return parts as [number, number, number, number];
  }
  return [0, 0, 100, 100];
}

/**
 * Return the mark's `<g id="mark">` element — INCLUDING its own tag — or the SVG's
 * whole inner content when there's no such group. Used to compose lockups without
 * nesting `<svg>` (which several rasterizers mishandle).
 *
 * The group's own tag is kept deliberately. It carries the artwork's `transform`
 * and any `display="none"` from an element toggle, and bbox.ts measures the mark
 * WITH those applied. Handing back only the children dropped them from the render
 * while leaving them in the measurement, so a lockup framed a box the artwork was
 * never drawn in — a mark composed as `<g id="mark" transform="translate(…)">` came
 * out shifted clean off its square, worst visible at favicon sizes.
 *
 * The group scan is depth-counted rather than regex-matched: marks legitimately
 * contain nested named groups (`<g id="dot">…`), and a non-greedy match would
 * stop at the FIRST `</g>` and hand back truncated, unbalanced markup.
 */
export function markInner(svg: string): string {
  const open = /<g\b[^>]*\bid\s*=\s*["']mark["'][^>]*?(\/?)>/i.exec(svg);
  if (open) {
    if (open[1] === '/') return ''; // self-closed: an empty mark group
    const from = open.index + open[0].length;
    let depth = 1;
    const re = /<(\/?)g\b[^>]*?(\/?)>/gi;
    re.lastIndex = from;
    let m: RegExpExecArray | null;
    while ((m = re.exec(svg))) {
      if (m[1] === '/') {
        if (--depth === 0) return svg.slice(open.index, m.index + m[0].length);
      } else if (m[2] !== '/') depth++;
    }
    return `${svg.slice(open.index)}</g>`; // unbalanced source — close what there is
  }
  const inner = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  return inner ? inner[1] : '';
}

/**
 * Apply the element-visibility and stroke-weight parts of an adjustment to a mark
 * SVG. Hidden groups are marked `display="none"` rather than deleted: it is safe
 * against nested groups (a regex cannot balance them), reversible, and honoured
 * by both browsers and librsvg when rasterising.
 */
export function stripSvgComments(svg: string): string {
  return svg.replace(/<!--[\s\S]*?-->/g, '');
}

export function applyMarkAdjust(markSvg: string, adjust: MarkAdjust): string {
  /*
    The stored mark is annotated — the engine labels its parts so the next editor
    can read the drawing — but a composed lockup is a deliverable, and those notes
    are workshop marks, not something a brand ships. Dropped here rather than at
    each export site because EVERY delivered form is composed through this
    function, so this is the one place that cannot be forgotten.
  */
  let out = stripSvgComments(markSvg);
  for (const id of adjust.hidden) {
    // The root group is the container, not a sub-element: hiding it isn't an edit,
    // it's an empty logo. Skipped so it can never blank a lockup or an export —
    // and so the ink measurement never loses the artwork it is meant to frame.
    if (id.toLowerCase() === 'mark') continue;
    const re = new RegExp(`(<g\\b[^>]*\\bid\\s*=\\s*["']${escapeRe(id)}["'][^>]*?)(\\s*/?>)`, 'i');
    out = out.replace(re, (_m, open: string, close: string) =>
      /\bdisplay\s*=/.test(open) ? `${open}${close}` : `${open} display="none"${close}`,
    );
  }
  // A global weight control has to win over per-element widths, so strip those.
  if (adjust.strokeWidth !== null) {
    out = out.replace(/\s+stroke-width\s*=\s*["'][^"']*["']/gi, '');
    /*
      …including one declared in `style`. A presentation attribute loses to the
      same property in a style attribute, so an element that wrote its weight
      there keeps it: the control moves the rest of the mark and that one part
      stays put. Matched with the leading space captured so `font-style` — which
      also ends in "style" — is not mistaken for it.
    */
    out = out.replace(/(\s)style\s*=\s*(["'])([^"']*)\2/gi, (_m, sp: string, q: string, css: string) => {
      const kept = css
        .split(';')
        .filter((d) => !/^\s*stroke-width\s*:/i.test(d))
        .join(';')
        .replace(/^;+|;+$/g, '')
        .trim();
      return kept ? `${sp}style=${q}${kept}${q}` : '';
    });
  }
  return out;
}

/** The palette's primary hex, however the roles happen to be labelled. */
export function primaryHexOf(palette: PaletteEntry[] | null | undefined): string {
  const list = palette ?? [];
  return list.find((c) => c.role?.toLowerCase() === 'primary')?.hex ?? list[0]?.hex ?? INK;
}

/** WCAG relative luminance — decides whether ink or paper reads on a colour. */
export function luminance(hex: string): number {
  const h = String(hex ?? '').replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16) / 255;
    return Number.isFinite(v) ? (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4) : 0;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The ink that survives on a given ground. */
export function inkOn(hex: string): string {
  return luminance(hex) > 0.42 ? INK : PAPER;
}

/**
 * The ink colour that drives `currentColor` for a lockup, plus its ground.
 *
 * Each slot owns its colour contract outright — that is what lets the editor drop
 * the old colourway switch: "Reversed" and "Coloured" are not two views of one
 * lockup, they ARE different lockups, and a user picking one has already made the
 * colour decision.
 */
export function toneColor(
  slot: LockupSlot,
  palette: PaletteEntry[] | null | undefined,
  committed = false,
): { ink: string; ground: string | null } {
  const primary = primaryHexOf(palette);
  switch (slot) {
    case 'reversed':
      return { ink: '#FFFFFF', ground: INK };
    case 'mono':
      return { ink: INK, ground: null };
    case 'color':
      // Colour, unconditionally — the slot exists to show the committed colour.
      return { ink: primary, ground: null };
    case 'colorReversed':
      // Knocked out OF the brand colour, the way a guidelines sheet shows it.
      return { ink: inkOn(primary), ground: primary };
    default:
      // Ink until the user commits colour — the studio thesis. Grounds stay
      // transparent so lockups drop onto any surface.
      return { ink: committed ? primary : INK, ground: null };
  }
}

/* Layout constants, expressed against the mark's own 100-unit box so every
 * lockup scales as one system. Tuned so cap height sits at ~0.34 of the mark. */
const MARK_BOX = 100;
const PAD = 8;
const PRIMARY_FONT = 46;
const PRIMARY_GAP = 22;
const STACKED_FONT = 34;
const STACKED_GAP = 18;
/** Descender depth as a share of cap height — reserved so tails aren't clipped. */
const DESCENDER = 0.3;
/**
 * Clearspace fallback for lockups with no type to measure, as a share of the
 * mark's drawn height. Matches the cap height a wordmark would have had, so the
 * keep-clear zone doesn't jump when you switch between the mark and a lockup.
 */
const CAP_RATIO = 0.334;

/**
 * A wordmark measured into vector outlines. Produced server-side by
 * outline.ts (it needs the font binary); the numbers are in FONT UNITS so one
 * measurement serves every font size the lockups use.
 */
export interface WordmarkOutline {
  /** Combined path data for the whole string, in font units (y-up). */
  d: string;
  unitsPerEm: number;
  /** Total advance in font units, including tracking. */
  advance: number;
  /** Cap height in font units — what display type is optically centred on. */
  capHeight: number;
}

interface PlacedText {
  svg: string;
  width: number;
  capHeight: number;
}

/**
 * Place a measured outline at (`x`, `y`), where `y` is the TEXT BASELINE. The
 * `scale(s, -s)` flip converts font units (y-up) to SVG user units (y-down).
 */
function placeText(
  outline: WordmarkOutline | null,
  fontSize: number,
  x: number,
  y: number,
  anchor: 'start' | 'middle',
): PlacedText {
  if (!outline || !outline.unitsPerEm) return { svg: '', width: 0, capHeight: 0 };
  const scale = fontSize / outline.unitsPerEm;
  const width = outline.advance * scale;
  const capHeight = outline.capHeight * scale;
  if (!outline.d) return { svg: '', width: 0, capHeight };
  const dx = anchor === 'middle' ? -width / 2 : 0;
  return {
    svg:
      `<path transform="translate(${round(x + dx)} ${round(y)}) ` +
      `scale(${round(scale, 6)} ${round(-scale, 6)})" ` +
      `fill="currentColor" d="${outline.d}"/>`,
    width,
    capHeight,
  };
}

export interface ComposeArgs {
  /** The normalised mark SVG (square viewBox, `<g id="mark">`, currentColor). */
  mark: string;
  /**
   * The wordmark, already measured into outlines for the chosen typeface. Null
   * (or an empty string) composes the mark-only box instead of clipping type.
   */
  outline: WordmarkOutline | null;
  slot: LockupSlot;
  adjust: MarkAdjust;
  palette: PaletteEntry[] | null | undefined;
  /** Has the user committed colour? Only affects the ink-first slots. */
  committed?: boolean;
  /**
   * Override the composed ink. `null` declares NO colour, leaving `currentColor`
   * for the consumer to resolve — what the raster exports want, since they bake
   * their own per-asset colour (a favicon in the palette's ink, an avatar in the
   * primary) and `bakeColor` treats a declared colour as authoritative.
   */
  ink?: string | null;
  /**
   * Override the composed ground. `null` draws NO ground rect, leaving the lockup
   * transparent.
   *
   * Two slots bake a ground by contract — `reversed` (ink) and `colorReversed`
   * (the brand colour) — because a guidelines sheet shows them plated. A file
   * handed to the rest of the suite is the opposite case: the plate is the thing
   * that makes it unusable, since it can't sit on a header, a dark email, or
   * anything but the exact colour it was baked with. Undefined keeps the slot's
   * own contract, so nothing that doesn't ask for this changes.
   */
  ground?: string | null;
}

/** The composed lockup plus the numbers the editor needs to frame it. */
export interface LockupLayout {
  svg: string;
  /** viewBox width/height in lockup units. */
  width: number;
  height: number;
  /**
   * One clearspace unit in lockup units — the wordmark's cap height, or the
   * equivalent share of the mark for type-less slots. The keep-clear zone is
   * `adjust.clearspace` of these on every side.
   */
  capUnit: number;
}

/**
 * Compose a lockup from a mark + a measured wordmark.
 *
 * The wordmark is set as VECTOR OUTLINES rather than a `<text>` node, and the
 * viewBox is computed from the measured advance width. That fixes two real
 * defects in a fixed-viewBox/live-text approach: long brand names get clipped by
 * a hard-coded box, and server-side rasterisation silently substitutes a
 * different typeface because the webfont is not installed on the server.
 */
export function layoutLockup(args: ComposeArgs): LockupLayout {
  const { mark, outline, slot, adjust, palette } = args;
  const tone = toneColor(slot, palette, args.committed ?? false);
  const ink = args.ink === undefined ? tone.ink : args.ink;
  const ground = args.ground === undefined ? tone.ground : args.ground;
  const adjusted = applyMarkAdjust(mark, adjust);
  const inner = markInner(adjusted);
  const [, , vbW, vbH] = viewBoxOf(adjusted);
  const markUnits = Math.max(vbW, vbH) || MARK_BOX;

  // The drawn mark size, after the editor's scale control.
  const markSize = MARK_BOX * adjust.scale;
  const markScale = markSize / markUnits;
  const strokeAttr =
    adjust.strokeWidth !== null ? ` stroke-width="${round(adjust.strokeWidth / markScale)}"` : '';

  // The artwork's real extent, in lockup units. Measured off the markup that is
  // actually DRAWN (`inner`, under the source root so paint inheritance matches),
  // never off the whole source: anything sitting outside the mark group is dropped
  // from the render, and counting it framed the lockup around ink that isn't there.
  // Unmeasurable geometry falls back to the whole mark box — loose framing, but it
  // can never clip the mark.
  const rootTag = adjusted.match(/<svg\b[^>]*>/i)?.[0] ?? '<svg>';
  const measured = inner
    ? inkBounds(`${rootTag}${inner}</svg>`, {
        strokeWidth: adjust.strokeWidth !== null ? adjust.strokeWidth / markScale : null,
      })
    : null;
  const art = measured
    ? {
        x: measured.minX * markScale,
        y: measured.minY * markScale,
        w: measured.width * markScale,
        h: measured.height * markScale,
      }
    : { x: 0, y: 0, w: markSize, h: markSize };

  /** Place the mark so its INK's top-left lands at (x, y), scaled to `markSize`. */
  const markAt = (x: number, y: number) =>
    inner
      ? `<g transform="translate(${round(x - art.x)} ${round(y - art.y)}) scale(${round(markScale, 5)})"${strokeAttr}>${inner}</g>`
      : '';

  /** A square that centres the artwork — the favicon / avatar case. */
  const squareMark = (): LockupLayout => {
    const side = Math.max(art.w, art.h) + PAD * 2;
    return {
      svg: wrap(
        side,
        side,
        ink,
        groundRect(ground, side, side) + markAt((side - art.w) / 2, (side - art.h) / 2),
      ),
      width: side,
      height: side,
      capUnit: Math.max(art.h, 1) * CAP_RATIO,
    };
  };

  if (slot === 'mark') return squareMark();

  if (slot === 'wordmark') {
    const t = placeText(outline, PRIMARY_FONT, 0, 0, 'start');
    if (!t.width) return squareMark();
    const w = t.width + PAD * 2;
    // Reserve the descender depth below the baseline so tails ("Jaguar") stay in.
    const h = t.capHeight + PAD + Math.max(PAD, t.capHeight * DESCENDER);
    const placed = placeText(outline, PRIMARY_FONT, PAD, PAD + t.capHeight, 'start');
    return {
      svg: wrap(w, h, ink, groundRect(ground, w, h) + placed.svg),
      width: w,
      height: h,
      capUnit: t.capHeight,
    };
  }

  if (slot === 'stacked') {
    const t = placeText(outline, STACKED_FONT, 0, 0, 'middle');
    if (!t.width) return squareMark();
    const gap = STACKED_GAP * adjust.gap;
    const w = Math.max(art.w, t.width) + PAD * 2;
    const baseline = PAD + art.h + gap + t.capHeight;
    const h = baseline + Math.max(PAD, t.capHeight * DESCENDER);
    const placed = placeText(outline, STACKED_FONT, w / 2, baseline, 'middle').svg;
    return {
      svg: wrap(w, h, ink, groundRect(ground, w, h) + markAt((w - art.w) / 2, PAD) + placed),
      width: w,
      height: h,
      capUnit: t.capHeight,
    };
  }

  // primary / mono / reversed / color / colorReversed -> horizontal lockup.
  const t = placeText(outline, PRIMARY_FONT, 0, 0, 'start');
  if (!t.width) return squareMark();
  const gap = PRIMARY_GAP * adjust.gap;
  // Mark and wordmark share ONE centre line: the type's cap band is centred on
  // the symbol's ink, which is what "aligned" reads as to the eye.
  const contentH = Math.max(art.h, t.capHeight * (1 + DESCENDER));
  const h = contentH + PAD * 2;
  const w = PAD + art.w + gap + t.width + PAD;
  const centre = PAD + contentH / 2;
  const placed = placeText(
    outline,
    PRIMARY_FONT,
    PAD + art.w + gap,
    centre + t.capHeight / 2,
    'start',
  ).svg;
  return {
    svg: wrap(w, h, ink, groundRect(ground, w, h) + markAt(PAD, centre - art.h / 2) + placed),
    width: w,
    height: h,
    capUnit: t.capHeight,
  };
}

/** The composed lockup SVG — `layoutLockup` when only the markup is wanted. */
export function composeLockup(args: ComposeArgs): string {
  return layoutLockup(args).svg;
}

/**
 * The frame the editor draws around a lockup: the artwork box plus its
 * keep-clear zone, in lockup units.
 *
 * The canvas boundary is derived from THIS rather than from a fixed square. A
 * mark on its own is square; the moment a wordmark is involved the lockup is
 * wide (or, stacked, tall), and forcing it into a square box is what made the
 * guide cut across the artwork and let a scaled-up mark spill past its own
 * boundary. Because the lockup's viewBox already grows with the mark's scale,
 * the frame tracks every adjustment for free.
 */
export function lockupFrame(layout: LockupLayout, adjust: MarkAdjust): {
  width: number;
  height: number;
  /** Keep-clear padding on every side, in lockup units. */
  pad: number;
} {
  const pad = Math.max(0, layout.capUnit * adjust.clearspace);
  return { width: layout.width + pad * 2, height: layout.height + pad * 2, pad };
}

function groundRect(ground: string | null, w: number, h: number): string {
  return ground
    ? `<rect x="0" y="0" width="${round(w)}" height="${round(h)}" fill="${ground}"/>`
    : '';
}

function wrap(w: number, h: number, color: string | null, body: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(w)} ${round(h)}" ` +
    `fill="none" stroke-linecap="round" stroke-linejoin="round" ` +
    `${color === null ? '' : `style="color:${color}" `}role="img">${body}</svg>`
  );
}
