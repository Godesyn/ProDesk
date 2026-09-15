/**
 * Theme model for the public "Verdiict Verified" directory badge.
 *
 * The badge is stateless — unlike the location embed (whose theme is persisted
 * per-location in `review_embed_configs`), the badge carries its design in the
 * iframe URL's query string. That keeps it cacheable at the edge, lets one
 * brand paste differently-styled badges on different pages, and needs no
 * migration. Every value is whitelisted server-side by `sanitizeBadgeTheme`
 * before it reaches the renderer.
 *
 * Pure — no imports at all — so the reviews CLIENT imports it via the @server
 * alias and the designer UI, the snippet builder and the renderer all agree on
 * one source of truth.
 */

export type BadgeVariant = 'card' | 'compact' | 'inline' | 'seal';
export type BadgeMode = 'light' | 'dark' | 'auto';
export type BadgeSize = 'sm' | 'md' | 'lg';
export type BadgeAlign = 'left' | 'center';

export type ReviewBadgeTheme = {
  variant: BadgeVariant;
  /** `auto` follows the host page's prefers-color-scheme. */
  mode: BadgeMode;
  size: BadgeSize;
  align: BadgeAlign;
  /** Hex (#rrggbb) for the seal ring and the checkmark-tile fallback. */
  accentColor: string;
  /**
   * Lead with the brand's own logo. Falls back to the Verdiict checkmark when
   * the brand has no logo on file (or the image fails to load).
   */
  showLogo: boolean;
  showStars: boolean;
  showCount: boolean;
  /** Show the "Best in <industry>" pill when the brand actually ranks top 3. */
  showBest: boolean;
};

export const DEFAULT_BADGE_THEME: ReviewBadgeTheme = {
  variant: 'card',
  mode: 'light',
  size: 'md',
  align: 'center',
  accentColor: '#6fa8ff',
  showLogo: true,
  showStars: true,
  showCount: true,
  showBest: true,
};

export const BADGE_VARIANTS: BadgeVariant[] = ['card', 'compact', 'inline', 'seal'];
export const BADGE_MODES: BadgeMode[] = ['light', 'dark', 'auto'];
export const BADGE_SIZES: BadgeSize[] = ['sm', 'md', 'lg'];
export const BADGE_ALIGNS: BadgeAlign[] = ['left', 'center'];

/** Multiplies every length in the rendered badge. */
export const BADGE_SCALE: Record<BadgeSize, number> = { sm: 0.85, md: 1, lg: 1.2 };

function pick<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === 'string' && (allowed as string[]).includes(value)
    ? (value as T)
    : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

/** Whitelist an arbitrary object (or parsed query string) into a safe theme. */
export function sanitizeBadgeTheme(input: unknown): ReviewBadgeTheme {
  const t = (
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  ) as Record<string, unknown>;
  // Accept both the long form (designer state) and the short query-string keys.
  const raw = {
    variant: t.variant ?? t.v,
    mode: t.mode ?? t.m,
    size: t.size ?? t.s,
    align: t.align ?? t.al,
    accentColor: t.accentColor ?? t.a,
    showLogo: t.showLogo ?? t.l,
    showStars: t.showStars ?? t.st,
    showCount: t.showCount ?? t.c,
    showBest: t.showBest ?? t.b,
  };

  // Accents arrive hex-encoded without the `#` in query strings (a literal `#`
  // would be parsed as a fragment), so re-attach it before validating.
  let accent = DEFAULT_BADGE_THEME.accentColor;
  if (typeof raw.accentColor === 'string') {
    const hex = raw.accentColor.startsWith('#') ? raw.accentColor : `#${raw.accentColor}`;
    if (/^#[0-9a-fA-F]{6}$/.test(hex)) accent = hex.toLowerCase();
  }

  return {
    variant: pick(raw.variant, BADGE_VARIANTS, DEFAULT_BADGE_THEME.variant),
    mode: pick(raw.mode, BADGE_MODES, DEFAULT_BADGE_THEME.mode),
    size: pick(raw.size, BADGE_SIZES, DEFAULT_BADGE_THEME.size),
    align: pick(raw.align, BADGE_ALIGNS, DEFAULT_BADGE_THEME.align),
    accentColor: accent,
    showLogo: flag(raw.showLogo, DEFAULT_BADGE_THEME.showLogo),
    showStars: flag(raw.showStars, DEFAULT_BADGE_THEME.showStars),
    showCount: flag(raw.showCount, DEFAULT_BADGE_THEME.showCount),
    showBest: flag(raw.showBest, DEFAULT_BADGE_THEME.showBest),
  };
}

/**
 * Serialise a theme to the badge iframe's query string. Values equal to the
 * default are omitted so a stock badge stays a clean `/badge/<slug>?o=…` URL.
 */
export function badgeThemeQuery(theme: ReviewBadgeTheme): string {
  const d = DEFAULT_BADGE_THEME;
  const parts: string[] = [];
  if (theme.variant !== d.variant) parts.push(`v=${theme.variant}`);
  if (theme.mode !== d.mode) parts.push(`m=${theme.mode}`);
  if (theme.size !== d.size) parts.push(`s=${theme.size}`);
  if (theme.align !== d.align) parts.push(`al=${theme.align}`);
  if (theme.accentColor !== d.accentColor) {
    parts.push(`a=${theme.accentColor.replace('#', '')}`);
  }
  if (theme.showLogo !== d.showLogo) parts.push(`l=${theme.showLogo ? 1 : 0}`);
  if (theme.showStars !== d.showStars) parts.push(`st=${theme.showStars ? 1 : 0}`);
  if (theme.showCount !== d.showCount) parts.push(`c=${theme.showCount ? 1 : 0}`);
  if (theme.showBest !== d.showBest) parts.push(`b=${theme.showBest ? 1 : 0}`);
  return parts.join('&');
}

/**
 * Unscaled intrinsic footprint of each variant, in CSS px — the badge's own box
 * plus the shadow bleed the renderer pads the document with.
 */
const BADGE_BASE_BOX: Record<BadgeVariant, { width: number; height: number }> = {
  card: { width: 320, height: 113 },
  compact: { width: 248, height: 73 },
  inline: { width: 334, height: 28 },
  seal: { width: 168, height: 188 },
};

/**
 * Starting box for the install snippet's iframe. Only a first paint: the badge
 * posts `pm:resize` on load and on every resize, and the snippet's listener
 * corrects the height from there (so hidden rows or a wrapped business name
 * never clip).
 */
export function badgeBox(theme: ReviewBadgeTheme): { width: number; height: number } {
  const scale = BADGE_SCALE[theme.size];
  const base = BADGE_BASE_BOX[theme.variant];
  let height = base.height;
  // The "Best in <industry>" pill sits on its own row in the stacked variants.
  if (theme.showBest && theme.variant !== 'inline') height += 24;
  if (theme.variant === 'card' && !theme.showStars && !theme.showCount) height -= 24;
  return {
    width: Math.round(base.width * scale),
    height: Math.round(height * scale),
  };
}
