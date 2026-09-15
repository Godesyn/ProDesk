/**
 * Accent → CSS-variable bridge. The entire palette in index.css derives from
 * three channels on :root (--accent-h/s/l); writing them re-themes the whole
 * app at runtime (mirrors the Flutter theme_accent_service / _tintedSurface).
 */
import { DEFAULT_ACCENT_HEX } from './accent-swatches';
import { getSubdomain } from './subdomain';

/** Convert a hex color to the {h, s, l} channels used by the accent vars. */
export function hexToAccentHsl(hex: string): { h: number; s: number; l: number } {
  const c = hex.replace('#', '');
  if (c.length < 6) return hexToAccentHsl(DEFAULT_ACCENT_HEX);
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h * 10) / 10, s: Math.round(s * 1000) / 10, l: Math.round(l * 1000) / 10 };
}

/**
 * Apply an accent hex to the document root as --accent-h/s/l. The full accent +
 * tinted-surface palette cascades from these, so this re-themes the entire app.
 */
export function applyAccentVars(hex: string, el: HTMLElement = document.documentElement): void {
  const { h, s, l } = hexToAccentHsl(hex);
  el.style.setProperty('--accent-h', String(h));
  el.style.setProperty('--accent-s', `${s}%`);
  el.style.setProperty('--accent-l', `${l}%`);
}

/**
 * The theme is resolved from network data (the tenant agency's accent), so on a
 * cold load there is a window where it isn't known yet. We cache the last
 * resolved accent in localStorage and re-apply it immediately on the next load,
 * so the app paints in the right brand color until the real value arrives.
 *
 * Keyed by tenant subdomain so each white-label site remembers its own color
 * independently (the app domain shares one `__app__` key). A stale value is
 * harmless — it only ever shows briefly before the resolved theme replaces it.
 */
const ACCENT_STORAGE_PREFIX = 'pd:accent:';

function accentStorageKey(): string {
  return ACCENT_STORAGE_PREFIX + (getSubdomain() ?? '__app__');
}

/** Persist the resolved accent for the current tenant. */
export function storeAccent(hex: string): void {
  try {
    localStorage.setItem(accentStorageKey(), hex);
  } catch {
    /* private mode / storage disabled — caching is best-effort */
  }
}

/** The last accent persisted for the current tenant, or null when none. */
export function readStoredAccent(): string | null {
  try {
    return localStorage.getItem(accentStorageKey());
  } catch {
    return null;
  }
}

/**
 * Apply the cached accent (if any) to the document root. Call this as early as
 * possible on startup, before React mounts, to avoid a flash of the default
 * theme while the real tenant theme is still resolving.
 */
export function applyStoredAccent(): void {
  const stored = readStoredAccent();
  if (stored) applyAccentVars(stored);
}
