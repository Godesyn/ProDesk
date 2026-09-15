/**
 * SVG utilities for Logo Studio — the layer that makes model-generated marks
 * safe to store/render and composable into lockups.
 *
 * Contract for a MARK SVG (what a provider returns and we persist):
 *   • a single square root `<svg viewBox="0 0 100 100">`;
 *   • the symbol lives in `<g id="mark">…</g>`;
 *   • the mark's primary ink is `currentColor` (fill and/or stroke), so mono /
 *     reversed / colour-committed states are one CSS `color` change — this is the
 *     literal "colour is a decision" mechanism. A secondary palette colour may be
 *     used sparingly as an explicit HEX.
 *
 * The sanitise/normalise half is dependency-free (regex/string). Composition is
 * split deliberately: the LAYOUT maths lives in the pure `layout.ts` next door so
 * the browser can run it verbatim, and this module is the SERVER-ONLY seam that
 * measures the wordmark into outlines (it needs the shipped font binaries) and
 * hands the result over. That split is what lets the editor's canvas repaint on
 * the next frame instead of waiting on a round trip, while still rendering the
 * exact bytes the export produces.
 */
import { outlineText } from './outline.js';
import { snapTypeface, type TypefaceKey } from './typefaces.js';
import {
  layoutLockup,
  resolveAdjust,
  viewBoxOf,
  type LockupLayout,
  type WordmarkOutline,
} from './layout.js';
import type { LockupSlot, LogoColor, LogoSpec } from './types.js';

/**
 * The geometry half is re-exported from here so existing call sites (export,
 * guidelines, the router) keep importing lockup helpers from one place.
 * `markContent` keeps its established name: it hands back the mark group WITH its
 * own tag, which is what the composer and bbox.ts both rely on.
 */
export {
  ALL_SLOTS,
  COMPONENT_SLOTS,
  DEFAULT_ADJUST,
  LOCKUP_SLOTS,
  SLOT_LABELS,
  applyMarkAdjust,
  composeLockup,
  inkOn,
  layoutLockup,
  lockupFrame,
  luminance,
  markInner as markContent,
  primaryHexOf,
  resolveAdjust,
  stripSvgComments,
  toneColor,
  viewBoxOf,
  type ComposeArgs,
  type LockupLayout,
  type MarkAdjust,
  type PaletteEntry,
  type WordmarkOutline,
} from './layout.js';

const MAX_SVG_BYTES = 60_000;

/**
 * Defuse the comments in a mark rather than delete them.
 *
 * The engine annotates its drawings — `<!-- stem -->`, `<!-- counter -->` — and
 * those notes are what make the SVG legible to the next editor, human or model,
 * so they are kept in the STORED mark. Keeping them safely is the catch: every
 * reader in this module is a regex, not an XML parser, so a comment containing
 * `</g>` would break group balancing in `markInner`, and one containing
 * `<g id="…">` would invent an element the inspector then offers to hide. So the
 * markers stay and their CONTENT is reduced to inert text: no angle brackets, no
 * stray `--`, and short enough to stay a label.
 */
function defuseComments(svg: string): string {
  return svg.replace(/<!--([\s\S]*?)-->/g, (_m, body: string) => {
    const text = String(body)
      .replace(/[<>]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return text ? `<!-- ${text} -->` : '';
  });
}


/**
 * Harden a model- or user-derived SVG before we persist, render inline, or
 * rasterize it. Conservative allow-listing by removal: kills script vectors,
 * external references, and event handlers. Not a full XML parser (we control the
 * generator), but defense-in-depth against prompt-injected payloads.
 */
export function sanitizeSvg(raw: string): string {
  let svg = String(raw ?? '').trim();

  // Pull just the <svg>…</svg> if the model wrapped it in prose or a code fence.
  const match = svg.match(/<svg[\s\S]*<\/svg>/i);
  if (match) svg = match[0];

  svg = svg
    // Strip XML/doctype preamble — we re-wrap ourselves.
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    // Executable / external-content elements have no place in a logo.
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/<(style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<(image|use|iframe|a|animate|animateTransform|set)\b[^>]*>/gi, '')
    // Inline event handlers (onload, onclick, …) and javascript: URLs.
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/(href|xlink:href)\s*=\s*"(?!#)[^"]*"/gi, '')
    .replace(/(href|xlink:href)\s*=\s*'(?!#)[^']*'/gi, '');

  // After the removals above, so a comment can never shelter markup that the
  // strippers would otherwise have caught.
  svg = defuseComments(svg);

  if (!/^<svg[\s>]/i.test(svg)) return '';
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) return '';
  return svg.trim();
}

/** The IDs of the named, editable groups the editor can target. */
export function extractElementIds(svg: string): string[] {
  const ids = new Set<string>();
  const re = /<g\b[^>]*\bid\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) ids.add(m[1]);
  return [...ids];
}

/** True when the SVG has drawable content and a usable root. */
export function isValidMarkSvg(svg: string): boolean {
  if (!/^<svg[\s>]/i.test(svg)) return false;
  return /<(path|circle|rect|polygon|polyline|ellipse|line|g)\b/i.test(svg);
}

/**
 * Normalise a raw mark to the persisted contract: square 100-viewBox, a single
 * `<g id="mark">`, no hard-coded width/height (so it scales), rounded joins.
 */
export function normalizeMarkSvg(raw: string): string {
  const clean = sanitizeSvg(raw);
  if (!clean || !isValidMarkSvg(clean)) return '';
  const [, , w, h] = viewBoxOf(clean);
  const size = Math.max(w, h) || 100;
  let inner = clean.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i)?.[1] ?? '';
  // If the artwork isn't already wrapped in the mark group, wrap it.
  if (!/\bid\s*=\s*["']mark["']/i.test(inner)) inner = `<g id="mark">${inner}</g>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none"`,
    ` stroke-linecap="round" stroke-linejoin="round" role="img">`,
    inner,
    `</svg>`,
  ].join('');
}

/** XML-escape text for safe insertion into an SVG attribute or text node. */
export function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Measure a wordmark into vector outlines for the spec's typeface — the one step
 * of composition that cannot run in the browser, since it reads the shipped font
 * binary. Returns null when there is no type to set, which the composer answers
 * with the mark-only box rather than an empty lockup.
 *
 * The numbers come back in FONT UNITS, so a single measurement serves every font
 * size the lockups use. That is also what lets the studio ship one outline per
 * typeface to the client and have it recompose any lockup locally.
 */
export function measureWordmark(
  wordmark: string,
  spec: Pick<LogoSpec, 'fonts' | 'adjust'>,
): WordmarkOutline | null {
  return measureWordmarkAs(
    wordmark,
    snapTypeface(spec.fonts?.heading),
    resolveAdjust(spec.adjust).wordmarkWeight,
  );
}

/**
 * Measure in an EXPLICIT face and weight rather than reading the spec.
 *
 * The studio ships the browser a matrix of these — every shipped face, plus every
 * weight of the current one — so a typeface click or a weight click repaints on
 * the next frame instead of round-tripping to the only machine with the binaries.
 * Passing the pair outright is what lets the router build that matrix without
 * forging a throwaway spec per cell.
 */
export function measureWordmarkAs(
  wordmark: string,
  typeface: TypefaceKey,
  weight?: number | null,
): WordmarkOutline | null {
  if (!String(wordmark ?? '').trim()) return null;
  const out = outlineText(wordmark, { typeface, weight: weight ?? undefined });
  if (!out.d) return null;
  return {
    d: out.d,
    unitsPerEm: out.unitsPerEm,
    advance: out.advance,
    capHeight: out.capHeight,
  };
}

interface LockupArgs {
  /** The normalised mark SVG. */
  mark: string;
  /** The wordmark text (usually the business name). */
  wordmark: string;
  spec: LogoSpec;
  slot: LockupSlot;
  /** Has the user committed colour on this mark? Drives ink vs primary. */
  committed?: boolean;
  /**
   * Override the composed ink. `null` declares NO colour, leaving `currentColor`
   * for the consumer to resolve — what the raster exports want, since they bake
   * their own per-asset colour (a favicon in the palette's ink, an avatar in the
   * primary) and `bakeColor` treats a declared colour as authoritative.
   */
  inkOverride?: string | null;
  /**
   * Override the composed ground. `null` draws no ground rect at all — see
   * `ComposeArgs.ground` in layout.ts for when that is the right call.
   */
  groundOverride?: string | null;
}

/**
 * Compose a lockup and return its geometry alongside the markup.
 *
 * The editor needs width/height/cap-unit to draw the clearspace boundary at the
 * lockup's real aspect ratio — a mark is square, but the moment a wordmark is
 * involved the lockup is wide (or, stacked, tall). Everything else only wants the
 * markup, which is what `buildLockupSvg` returns.
 */
export function buildLockup(args: LockupArgs): LockupLayout {
  return layoutLockup({
    mark: args.mark,
    outline: measureWordmark(args.wordmark, args.spec),
    slot: args.slot,
    adjust: resolveAdjust(args.spec.adjust),
    palette: args.spec.palette,
    committed: args.committed ?? false,
    ink: args.inkOverride,
    ground: args.groundOverride,
  });
}

/** Compose a lockup SVG from a mark + wordmark. */
export function buildLockupSvg(args: LockupArgs): string {
  return buildLockup(args).svg;
}

/**
 * The mark alone, centred on its own INK inside a square — the favicon / avatar
 * geometry, with no colour declared so the caller can bake its own.
 *
 * Exported because every square-icon asset MUST come through here rather than
 * rasterising the generated mark directly: the artwork routinely sits high, low,
 * or short of one edge inside its 100-box, and at 16px that offset is the whole
 * icon reading as crooked.
 */
export function buildMarkSquareSvg(mark: string, spec: LogoSpec): string {
  return buildLockupSvg({ mark, wordmark: '', spec, slot: 'mark', inkOverride: null });
}

/** Default five-role palette in the brand-suite token order. */
export function orderedPalette(palette: LogoColor[]): {
  primary: string;
  accent: string;
  ink: string;
  background: string;
  rule: string;
} {
  const by = (role: string) => palette.find((c) => c.role.toLowerCase() === role)?.hex;
  return {
    primary: by('primary') ?? palette[0]?.hex ?? '#2E9E58',
    accent: by('accent') ?? palette[1]?.hex ?? '#14532D',
    ink: by('ink') ?? '#0E0E0C',
    background: by('background') ?? by('paper') ?? '#F3F1EA',
    rule: by('rule') ?? '#C9C7BD',
  };
}
