/**
 * Short-link event capture. The redirector calls `recordLinkEvent` fire-and-
 * forget on every hit; the analytics router aggregates `link_events`. The UA /
 * referrer parsing is dependency-free (no ua-parser) and pure, so it's unit
 * tested directly.
 */
import { db as defaultDb } from '../../db/index.js';
import { linkEvents } from '../../db/schema.js';

type Db = typeof defaultDb;

export type Device = 'mobile' | 'tablet' | 'desktop' | 'other';

/** Best-effort device / browser / OS classification from a User-Agent string. */
export function parseUserAgent(ua: string | undefined): {
  device: Device;
  browser: string;
  os: string;
} {
  const s = (ua || '').toLowerCase();
  if (!s) return { device: 'other', browser: 'Unknown', os: 'Unknown' };

  // Device — tablets first (an Android tablet lacks "mobile").
  const isTablet = /ipad|tablet|kindle|silk|playbook/.test(s) ||
    (/android/.test(s) && !/mobile/.test(s));
  const isMobile =
    /iphone|ipod|windows phone|iemobile|blackberry|bb10|opera mini/.test(s) ||
    (/android/.test(s) && /mobile/.test(s)) ||
    /mobile/.test(s);
  const device: Device = isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop';

  // OS
  let os = 'Unknown';
  if (/windows/.test(s)) os = 'Windows';
  else if (/iphone|ipad|ipod|(cpu os )/.test(s)) os = 'iOS';
  else if (/mac os x|macintosh/.test(s)) os = 'macOS';
  else if (/android/.test(s)) os = 'Android';
  else if (/cros/.test(s)) os = 'ChromeOS';
  else if (/linux/.test(s)) os = 'Linux';

  // Browser — order matters (Edge/Opera masquerade as Chrome; Chrome as Safari).
  let browser = 'Unknown';
  if (/edg\/|edge\//.test(s)) browser = 'Edge';
  else if (/opr\/|opera/.test(s)) browser = 'Opera';
  else if (/samsungbrowser/.test(s)) browser = 'Samsung Internet';
  else if (/chrome|crios|chromium/.test(s)) browser = 'Chrome';
  else if (/firefox|fxios/.test(s)) browser = 'Firefox';
  else if (/safari/.test(s)) browser = 'Safari';

  return { device, browser, os };
}

/** Bare hostname of a referrer URL (www. stripped), or null if absent/invalid. */
export function referrerHost(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname.replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

/**
 * Persist one link event. Never throws into the caller's hot path — the
 * redirector should still `.catch()` it, but parsing is defensive here too.
 */
export async function recordLinkEvent(
  db: Db,
  input: {
    linkId: string;
    brandId: string;
    userAgent?: string;
    referer?: string;
    country?: string | null;
    /** 'qr' when the hit came from a scanned QR code, else 'link'. */
    source?: 'link' | 'qr' | null;
    /** Automated / prefetch traffic, filtered out of analytics by default. */
    isBot?: boolean;
    /** Daily-rotating unique-visitor fingerprint (see analytics/capture). */
    ipHash?: string | null;
  },
): Promise<void> {
  const { device, browser, os } = parseUserAgent(input.userAgent);
  await db.insert(linkEvents).values({
    linkId: input.linkId,
    brandId: input.brandId,
    referrerHost: referrerHost(input.referer),
    device,
    browser,
    os,
    country: input.country ?? null,
    source: input.source ?? 'link',
    isBot: input.isBot ?? false,
    ipHash: input.ipHash ?? null,
  });
}
