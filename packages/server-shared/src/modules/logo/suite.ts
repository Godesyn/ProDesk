/**
 * The LOGO SUITE — the twelve files a brand is actually handed: six forms, each
 * in the brand colour and in monochrome.
 *
 * WHY this module exists rather than a list of `LockupSlot`s. A slot carries a
 * form AND a colour contract at once (`layout.ts` `toneColor`), which is right for
 * the editor — picking "Coloured reversed" IS picking a colourway — but it makes
 * the *deliverable* set impossible to state: `mono` and `primary` resolve to the
 * identical ink-on-transparent horizontal lockup whenever colour isn't committed,
 * so the eight slots yield only six distinct files and every one of them is black.
 * A brand sheet is a MATRIX: form down one axis, colourway across the other. This
 * module is that matrix, composed from the engine's own tone contracts (nothing
 * here invents a colour) so the suite, the share page, and the zips agree.
 */
import {
  composeLockup,
  primaryHexOf,
  resolveAdjust,
  toneColor,
  type LockupSlot,
} from './layout.js';
import { measureWordmark } from './svg.js';
import type { LogoSpec } from './types.js';

/** The two colourways every form is delivered in. */
export type Colourway = 'ink' | 'colour';

export interface SuiteForm {
  /** Stable key — also the filename stem, so `reversed-stacked-colour.svg`. */
  key: string;
  label: string;
  /** The GEOMETRY this form composes against (the slot's tone is overridden). */
  slot: LockupSlot;
  /**
   * Knocked out of a plate rather than drawn on transparency. Plated forms are
   * how a sheet shows a logo surviving a dark or saturated surface, and they are
   * the reason the matrix is 6×2 and not 4×2.
   */
  plated: boolean;
}

/**
 * The six forms, in the order they are presented and exported.
 *
 * Positive first (the four the engine composes geometry for), then the two
 * knockouts. There is deliberately no "monochrome" form: monochrome is the
 * colourway, and listing it as a form is what produced the duplicate tile.
 */
export const SUITE_FORMS: SuiteForm[] = [
  { key: 'primary', label: 'Primary', slot: 'primary', plated: false },
  { key: 'stacked', label: 'Stacked', slot: 'stacked', plated: false },
  { key: 'mark', label: 'Mark only', slot: 'mark', plated: false },
  { key: 'wordmark', label: 'Wordmark only', slot: 'wordmark', plated: false },
  { key: 'reversed', label: 'Reversed', slot: 'primary', plated: true },
  { key: 'reversed-stacked', label: 'Reversed stacked', slot: 'stacked', plated: true },
];

/** One delivered file: a form in a colourway. */
export interface SuiteAsset {
  /** `<form>-<colourway>`, e.g. `reversed-stacked-colour`. Unique in the suite. */
  key: string;
  form: string;
  label: string;
  colourway: Colourway;
  /**
   * The plate the artwork is knocked out of, or null when it sits on
   * transparency. The SVG carries its own ground rect either way; this is here so
   * a viewer can frame the TILE in the same colour instead of showing a plate
   * band floating on a chequerboard.
   */
  plate: string | null;
  svg: string;
}

/** How many files the suite yields per format. Kept beside the matrix. */
export const SUITE_FILE_COUNT = SUITE_FORMS.length * 2;

/**
 * A safe file stem from a name. Every logo download — server-side export or
 * client-side zip — names its files through here, so `acme-coffee-primary-ink.svg`
 * means the same thing wherever it came from.
 */
export function assetStem(name: string): string {
  return (
    (name || 'logo')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'logo'
  );
}

/**
 * Compose the full suite.
 *
 * The wordmark is measured ONCE and reused across all twelve compositions — it is
 * the only step that reads a font binary, and measuring per lockup made building
 * the suite twelve times more expensive than it needs to be.
 */
export function buildLogoSuite(args: {
  /** The normalised mark SVG. */
  mark: string;
  /** The wordmark text (usually the business name). */
  wordmark: string;
  spec: LogoSpec;
}): SuiteAsset[] {
  const { mark, spec } = args;
  const outline = measureWordmark(args.wordmark, spec);
  const adjust = resolveAdjust(spec.adjust);
  const palette = spec.palette;

  /**
   * The four tone contracts the matrix draws on, taken straight from the slots
   * that already own them: ink and brand-colour on transparency, white on ink,
   * and the brand-colour knockout. Reading them out of `toneColor` is what keeps
   * this module free of colour decisions of its own.
   */
  const tones: Record<Colourway, Record<'flat' | 'plated', { ink: string; ground: string | null }>> = {
    ink: {
      flat: toneColor('primary', palette, false),
      plated: toneColor('reversed', palette),
    },
    colour: {
      flat: toneColor('color', palette),
      plated: toneColor('colorReversed', palette),
    },
  };

  const out: SuiteAsset[] = [];
  // Colourway-major: the monochrome six, then the coloured six — the order the
  // suite is shown in and the order the zips list.
  for (const colourway of ['ink', 'colour'] as const) {
    for (const form of SUITE_FORMS) {
      const tone = tones[colourway][form.plated ? 'plated' : 'flat'];
      out.push({
        key: `${form.key}-${colourway}`,
        form: form.key,
        label: form.label,
        colourway,
        plate: tone.ground,
        svg: composeLockup({
          mark,
          outline,
          slot: form.slot,
          adjust,
          palette,
          ink: tone.ink,
          ground: tone.ground,
        }),
      });
    }
  }
  return out;
}

/**
 * The brand colour the suite is built around — exposed so a surface can state it
 * ("Coloured versions use #1F4A3C") without re-deriving the palette order.
 */
export function suitePrimaryHex(spec: Pick<LogoSpec, 'palette'>): string {
  return primaryHexOf(spec.palette);
}
