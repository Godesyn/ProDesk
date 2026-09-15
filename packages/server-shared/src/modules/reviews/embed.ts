/**
 * Reviews (Verdiict) embed + milestone constants and the gating-aware theme
 * sanitizer. Ported verbatim (intent-preserving) from the Manus export's
 * shared/embed.ts. Pure — no server imports — so the reviews CLIENT imports it
 * too (via the @server alias) and there is a single source of truth for the
 * unlock thresholds and theme shape.
 */
import type { ReviewEmbedTheme } from '../../db/schema.js';

export type { ReviewEmbedTheme } from '../../db/schema.js';

/** Free-trial cap: captured reviews brand-wide before a subscription is needed. */
export const REVIEWS_FREE_TRIAL = 10;

/** Embed unlock thresholds (review counts). */
export const EMBED_UNLOCK_ACCOUNT_REVIEWS = 10; // single-location embed
export const EMBED_THEME_UNLOCK_LOCATION_REVIEWS = 25; // branded customisation
// Multi-location collection embeds are NOT review-gated — they work from the
// first captured review.

/** Milestone thresholds for physical rewards. */
export const STICKER_PACK_THRESHOLD_LOCATION_REVIEWS = 20;
export const GOLD_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS = 1_000;
export const PLATINUM_PLAQUE_THRESHOLD_ACCOUNT_REVIEWS = 10_000;

export type EmbedVariant = ReviewEmbedTheme['variant'];
export type EmbedFont = NonNullable<ReviewEmbedTheme['fontFamily']>;
export type EmbedDensity = NonNullable<ReviewEmbedTheme['density']>;
export type EmbedRadius = NonNullable<ReviewEmbedTheme['radius']>;

export const DEFAULT_EMBED_THEME: ReviewEmbedTheme = {
  variant: 'wall',
  fontFamily: 'geist',
  dark: false,
  showLogo: false,
  showWinTags: true,
  showStarCount: true,
  onlyFiveStar: true,
  density: 'cozy',
  radius: 'soft',
};

/** Whitelist a raw theme JSON to a safe, gating-aware theme. */
export function sanitizeTheme(
  input: unknown,
  brandedUnlocked: boolean,
): ReviewEmbedTheme {
  const t = (
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  ) as Partial<ReviewEmbedTheme>;
  const out: ReviewEmbedTheme = { ...DEFAULT_EMBED_THEME };
  const variants: EmbedVariant[] = ['carousel', 'wall', 'marquee', 'hero'];
  if (typeof t.variant === 'string' && variants.includes(t.variant as EmbedVariant)) {
    out.variant = t.variant as EmbedVariant;
  }
  if (typeof t.dark === 'boolean') out.dark = t.dark;
  if (typeof t.showWinTags === 'boolean') out.showWinTags = t.showWinTags;
  if (typeof t.showStarCount === 'boolean') out.showStarCount = t.showStarCount;
  if (typeof t.onlyFiveStar === 'boolean') out.onlyFiveStar = t.onlyFiveStar;
  const densities: EmbedDensity[] = ['compact', 'cozy', 'comfortable'];
  if (typeof t.density === 'string' && densities.includes(t.density as EmbedDensity)) {
    out.density = t.density as EmbedDensity;
  }
  const radii: EmbedRadius[] = ['sharp', 'soft', 'round'];
  if (typeof t.radius === 'string' && radii.includes(t.radius as EmbedRadius)) {
    out.radius = t.radius as EmbedRadius;
  }
  if (brandedUnlocked) {
    const fonts: EmbedFont[] = ['geist', 'inter', 'system', 'playfair', 'dm-sans'];
    if (typeof t.fontFamily === 'string' && fonts.includes(t.fontFamily as EmbedFont)) {
      out.fontFamily = t.fontFamily as EmbedFont;
    }
    if (typeof t.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(t.accentColor)) {
      out.accentColor = t.accentColor;
    }
    if (typeof t.showLogo === 'boolean') out.showLogo = t.showLogo;
  }
  return out;
}
