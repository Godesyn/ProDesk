/**
 * Asset export — turn a chosen/edited generation into the full download matrix
 * the market expects, upload it to brand storage, and return a manifest. The
 * editable SVG stays the source of truth; every raster is derived from it.
 *
 * Vectors are a FIRST-CLASS export (never the surprise paywall the incumbents
 * spring). Gating is at the boundary in the router via entitlement.ts.
 */
import { buildLockupSvg, orderedPalette, stripSvgComments } from './svg.js';
import { ALL_SLOTS, composeLockup, resolveAdjust } from './layout.js';
import { guidelinesPdf } from './guidelines.js';
import { bakeColor, faviconPngs, lockupPdf, socialKit, svgToPng, svgToPngWide } from './raster.js';
import { putLogoAsset } from './storage.js';
import { assetStem } from './suite.js';
import type { LockupSlot, LogoGeneration, LogoSpec } from './types.js';

export type ExportFormat = 'svg' | 'png' | 'pdf' | 'favicon' | 'social' | 'guidelines';

export interface ExportedAsset {
  format: ExportFormat;
  label: string;
  /** Individual files (a format like PNG/favicon/social yields several). */
  files: { name: string; url: string; key: string; contentType: string }[];
}

/**
 * Build every lockup SVG for a generation (used by the editor preview + export).
 *
 * `committed` only reaches the ink-first slots. Colour is no longer a mode the
 * caller toggles across the whole set — `color` and `colorReversed` are their own
 * slots and always carry the brand colour, which is what lets the editor drop its
 * colourway switch entirely.
 */
export function buildLockups(
  gen: Pick<LogoGeneration, 'svg' | 'name'>,
  spec: LogoSpec,
  wordmark: string,
  committed: boolean,
): Record<LockupSlot, string> {
  const out = {} as Record<LockupSlot, string>;
  for (const slot of ALL_SLOTS) {
    out[slot] = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot, committed });
  }
  return out;
}

/** A safe file stem from the mark name — one rule for every download (suite.ts). */
const stem = assetStem;

/**
 * Produce and upload the requested format for a generation. Returns the manifest
 * entry with hosted URLs.
 */
export async function exportFormat(
  brandId: string,
  gen: LogoGeneration,
  wordmark: string,
  format: ExportFormat,
  brandName = wordmark,
): Promise<ExportedAsset> {
  const spec = gen.spec ?? ({ palette: [] } as unknown as LogoSpec);
  const pal = orderedPalette(spec.palette ?? []);
  const base = stem(gen.name);
  const primaryLockup = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot: 'primary', committed: true });
  // Every SQUARE raster (app icon, favicon, avatar) uses the ink-centred square,
  // not the raw mark: the generated artwork is rarely centred in its own 100-box,
  // and at 16–48px that offset is the whole icon looking crooked. `ink: null`
  // declares no colour, so each call below still bakes its own.
  const square = composeLockup({
    mark: gen.svg,
    outline: null,
    slot: 'mark',
    adjust: resolveAdjust(spec.adjust),
    palette: spec.palette,
    ink: null,
  });

  switch (format) {
    case 'svg': {
      // Ship the editable mark + every lockup as real vectors. The bare mark is
      // the one delivered file that does NOT go through the composer, so it is
      // also the one that has to shed its authoring notes here.
      const files = [];
      files.push(
        await upload(brandId, `${base}-mark.svg`, stripSvgComments(gen.svg), 'image/svg+xml'),
      );
      // Ink-first, exactly as the editor shows them: the coloured versions are
      // their own `color` / `colorReversed` files rather than a recolour of these.
      for (const slot of ALL_SLOTS) {
        const svg = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot });
        files.push(await upload(brandId, `${base}-${slot}.svg`, svg, 'image/svg+xml'));
      }
      return { format, label: 'SVG (editable vector)', files };
    }
    case 'png': {
      const sizes = [512, 1024, 2048, 4096];
      const files = [];
      for (const s of sizes) {
        const buf = await svgToPng(square, s, { ink: pal.primary });
        files.push(await upload(brandId, `${base}-mark-${s}.png`, buf, 'image/png'));
      }
      const wide = await svgToPngWide(primaryLockup, 2048, { ink: pal.primary });
      files.push(await upload(brandId, `${base}-primary-2048.png`, wide, 'image/png'));
      return { format, label: 'PNG (transparent, @1–4×)', files };
    }
    case 'favicon': {
      const set = await faviconPngs(square, pal.ink);
      // The SVG favicon ships with its ink baked in: a browser tab has no CSS
      // `color` context to resolve `currentColor` against.
      const files = [
        await upload(brandId, `${base}-favicon.svg`, bakeColor(square, pal.ink), 'image/svg+xml'),
      ];
      for (const [size, buf] of Object.entries(set)) {
        files.push(await upload(brandId, `${base}-favicon-${size}.png`, buf, 'image/png'));
      }
      return { format, label: 'Favicon (SVG + PNG set)', files };
    }
    case 'social': {
      const kit = await socialKit(square, primaryLockup, pal.primary, pal.background);
      const files = [];
      for (const { name, buffer } of kit) {
        files.push(await upload(brandId, `${base}-${name}`, buffer, 'image/png'));
      }
      return { format, label: 'Social kit (avatars + covers)', files };
    }
    case 'guidelines': {
      // The full rulebook — the deliverable that makes a solo brand look like it
      // came out of an agency (DESIGN.md 05).
      const pdf = await guidelinesPdf({ gen, spec, wordmark, brandName });
      const files = [await upload(brandId, `${base}-guidelines.pdf`, pdf, 'application/pdf')];
      return { format, label: 'Brand guidelines (PDF)', files };
    }
    case 'pdf': {
      const png = await svgToPngWide(primaryLockup, 2048, { ink: pal.primary });
      const pdf = await lockupPdf(png);
      const files = [await upload(brandId, `${base}-logo.pdf`, pdf, 'application/pdf')];
      return { format, label: 'PDF (print-ready)', files };
    }
  }
}

async function upload(brandId: string, name: string, data: Buffer | Uint8Array | string, contentType: string) {
  const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const { key, url } = await putLogoAsset(brandId, name, buf, contentType);
  return { name, url, key, contentType };
}

/**
 * The white ground every push-to-suite raster is laid on. The suite renders a
 * brand's logo into surfaces it does not control — an email signature in a mail
 * client, a PDF proposal, a review widget on someone else's site — where a
 * transparent PNG inherits whatever sits behind it and a dark mark can vanish
 * outright. A solid white plate is the one ground that reads everywhere.
 */
const SUITE_GROUND = '#FFFFFF';

/**
 * The reversed lockup's ink — flat white, and the one push-to-suite asset that
 * gets NO ground at all. It is the file you reach for when the surface is already
 * dark, so it has to carry its own colour and nothing else.
 */
const REVERSED_INK = '#FFFFFF';

/**
 * The primary identity assets used for brand write-through.
 *
 * PNG-first, on white, by design: these are the files the rest of the suite
 * embeds, and an `<img>` in a mail client is the least forgiving consumer there
 * is (no `currentColor`, no SVG in several clients, no control over the backing
 * surface). The vectors are uploaded alongside so nothing loses the source of
 * truth — they just aren't what `brands.logoUrl` points at.
 *
 * Three rasters, not one:
 *   • the full lockup, on white, for anywhere there is width to set the name;
 *   • the MARK ALONE — no wordmark — on white, for avatars, favicons, and the
 *     tight square slots that would otherwise squash the type illegibly;
 *   • the REVERSED lockup in flat white on a transparent ground, for the dark
 *     surfaces the white-plated pair can't sit on.
 */
export async function exportIdentityAssets(
  brandId: string,
  gen: LogoGeneration,
  wordmark: string,
): Promise<{
  markSvgUrl: string;
  markPngUrl: string;
  primarySvgUrl: string;
  primaryPngUrl: string;
  reversedSvgUrl: string;
  reversedPngUrl: string;
  slots: { slot: LockupSlot; url: string; key: string }[];
}> {
  const spec = gen.spec ?? ({ palette: [] } as unknown as LogoSpec);
  const pal = orderedPalette(spec.palette ?? []);
  const base = stem(gen.name);

  // The lockup — mark + wordmark, in the committed colour, plated on white.
  const primarySvgStr = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot: 'primary', committed: true });
  const primarySvg = await upload(brandId, `${base}-primary.svg`, primarySvgStr, 'image/svg+xml');
  const primaryPngBuf = await svgToPngWide(primarySvgStr, 1600, {
    ink: pal.primary,
    ground: SUITE_GROUND,
  });
  const primaryPng = await upload(brandId, `${base}-primary.png`, primaryPngBuf, 'image/png');

  // The mark on its own — the ink-centred square from the layout engine, so the
  // symbol sits true in an avatar rather than carrying the artwork's own offset.
  const markSvgStr = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot: 'mark', committed: true });
  const markSvg = await upload(brandId, `${base}-mark.svg`, markSvgStr, 'image/svg+xml');
  const markPngBuf = await svgToPng(markSvgStr, 1024, { ink: pal.primary, ground: SUITE_GROUND });
  const markPng = await upload(brandId, `${base}-mark.png`, markPngBuf, 'image/png');

  /**
   * The reversed lockup — pure white artwork on NOTHING.
   *
   * The slot's own contract bakes a near-black plate behind it, which is right
   * for a guidelines page showing how the reversed treatment looks, and wrong for
   * a file: plated, it can only ever sit on that one colour, so it can't go on a
   * dark header, a photo, or brand-coloured merch. `groundOverride: null` drops
   * the rect, and the ink is forced to flat white rather than left as
   * `currentColor`, so the PNG rasterises white instead of inheriting a default.
   */
  const reversedSvgStr = buildLockupSvg({
    mark: gen.svg,
    wordmark,
    spec,
    slot: 'reversed',
    inkOverride: REVERSED_INK,
    groundOverride: null,
  });
  const reversedSvg = await upload(brandId, `${base}-reversed.svg`, reversedSvgStr, 'image/svg+xml');
  const reversedPngBuf = await svgToPngWide(reversedSvgStr, 1600, {
    ink: REVERSED_INK,
    ground: null,
  });
  const reversedPng = await upload(brandId, `${base}-reversed.png`, reversedPngBuf, 'image/png');

  /**
   * Variant lockups → `brand_kits.logoSlots`, keyed by the engine's OWN slot
   * names (layout.ts `LockupSlot`). The dashboard's Brand Kit resolves its
   * display names through `SLOT_ALIASES`, so this side stays canonical.
   */
  const vectorSlots: LockupSlot[] = ['stacked', 'wordmark'];
  const slots: { slot: LockupSlot; url: string; key: string }[] = [
    // `primary` and `mark` are the white PNGs, `reversed` the transparent one:
    // the kit is what the Brand Kit screen and the suite hand to an <img>, and
    // those three are the ones that have to survive an unknown backing surface.
    { slot: 'primary', url: primaryPng.url, key: primaryPng.key },
    { slot: 'mark', url: markPng.url, key: markPng.key },
    { slot: 'reversed', url: reversedPng.url, key: reversedPng.key },
  ];
  for (const slot of vectorSlots) {
    const svg = buildLockupSvg({ mark: gen.svg, wordmark, spec, slot, committed: true });
    const up = await upload(brandId, `${base}-${slot}.svg`, svg, 'image/svg+xml');
    slots.push({ slot, url: up.url, key: up.key });
  }
  return {
    markSvgUrl: markSvg.url,
    markPngUrl: markPng.url,
    primarySvgUrl: primarySvg.url,
    primaryPngUrl: primaryPng.url,
    reversedSvgUrl: reversedSvg.url,
    reversedPngUrl: reversedPng.url,
    slots,
  };
}
