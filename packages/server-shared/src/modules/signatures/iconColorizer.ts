/**
 * iconColorizer — recolours a social-icon SVG to any hex colour, rasterises it
 * to a 32×32 PNG (sharp), uploads to Supabase Storage, and caches the result by
 * `iconKey_hexcolour` so the same colour is never regenerated. Email clients
 * (Outlook especially) don't render inline SVG, so signatures embed these hosted
 * PNGs. Ported from the Manus export's server/iconColorizer.ts; the only changes
 * are inlined SVG sources (icons.ts) and the Supabase storagePut backend.
 */
import sharp from 'sharp';
import { ICON_KEYS, ICON_SVGS, type IconKey } from './icons.js';
import { storagePut } from './storage.js';

export { ICON_KEYS, type IconKey };

// In-memory cache keyed by "iconKey_hexcolour" → hosted PNG URL, for the life of
// the process. Keyed per brand+colour, not per brand, so it's shared globally.
const iconUrlCache = new Map<string, string>();

/** Normalise a hex colour to lowercase 6-digit form, e.g. "#1A1A2E" → "1a1a2e". */
function normaliseHex(hex: string): string {
  const clean = hex.replace(/^#/, '').toLowerCase();
  if (clean.length === 3) {
    return clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return clean.slice(0, 6);
}

function isIconKey(key: string): key is IconKey {
  return (ICON_KEYS as readonly string[]).includes(key);
}

/**
 * Recolour a bundled icon SVG to `hexColor` and rasterise it to a 32×32 PNG.
 * This is the pure render step behind {@link getColoredIconUrl} (no storage);
 * exported so one-off tooling can reproduce the exact legacy icon bytes.
 */
export async function renderColoredIconPng(
  iconKey: string,
  hexColor: string,
): Promise<Buffer> {
  if (!isIconKey(iconKey)) throw new Error(`Icon not found: ${iconKey}`);
  const normColor = normaliseHex(hexColor);
  const recoloured = ICON_SVGS[iconKey]
    // Recolour: replace the fill colour with the requested colour.
    .replace(/fill="#[0-9a-fA-F]{3,6}"/g, `fill="#${normColor}"`)
    .replace(/fill='#[0-9a-fA-F]{3,6}'/g, `fill='#${normColor}'`);
  return sharp(Buffer.from(recoloured)).resize(32, 32).png().toBuffer();
}

/**
 * Return a hosted PNG URL for the given icon key in the given colour, scoped to
 * a brand's storage. Results are cached in memory for the process lifetime.
 */
export async function getColoredIconUrl(
  brandId: string,
  iconKey: string,
  hexColor: string,
): Promise<string> {
  const normColor = normaliseHex(hexColor);
  const cacheKey = `${iconKey}_${normColor}`;

  const cached = iconUrlCache.get(cacheKey);
  if (cached) return cached;

  const pngBuffer = await renderColoredIconPng(iconKey, normColor);

  const { url } = await storagePut(
    brandId,
    `icons/${cacheKey}.png`,
    pngBuffer,
    'image/png',
  );

  iconUrlCache.set(cacheKey, url);
  return url;
}
