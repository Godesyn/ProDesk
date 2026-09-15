/**
 * Shared analytics-capture helpers used by the redirector on the redirect hot
 * path (both short links and email-signature clicks). Pure and dependency-free
 * so they can be unit tested directly, mirroring `parseUserAgent`.
 *
 * Two concerns live here:
 *  - `detectBot`  — flag automated / prefetch traffic so analytics can exclude
 *    it. Email clients (Apple Mail Privacy Protection, Gmail's image proxy) and
 *    chat/link-preview crawlers fetch links before a human ever clicks, which
 *    otherwise inflates click counts. We FLAG rather than drop, so the raw data
 *    is preserved and an "include bots" toggle can reveal it.
 *  - `visitorHash` — a privacy-preserving, daily-rotating fingerprint used to
 *    count unique visitors without ever storing a raw IP.
 */
import { createHash } from 'node:crypto';

/** User-Agent substrings that mark automated / non-human traffic. */
const BOT_UA = new RegExp(
  [
    'bot',
    'crawler',
    'spider',
    'crawl',
    'slurp',
    'preview',
    'fetch',
    'monitor',
    'headless',
    'phantom',
    'python-requests',
    'curl',
    'wget',
    'go-http',
    'okhttp',
    'axios',
    'httpclient',
    'facebookexternalhit',
    'facebookcatalog',
    'meta-externalagent',
    'slackbot',
    'slack-imgproxy',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
    'discordbot',
    'skypeuripreview',
    'pinterest',
    'redditbot',
    'googleimageproxy',
    'google-read-aloud',
    'apple mail',
    'mailproxy',
    'bingpreview',
    'proofpoint',
    'barracuda',
    'mimecast',
    'safelinks',
    'urldefense',
  ].join('|'),
  'i',
);

/**
 * True when a request looks like automated or prefetch traffic rather than a
 * real human click. Combines a User-Agent denylist with the standard prefetch /
 * link-preview header signals that browsers and mail clients send ahead of
 * (or instead of) a real navigation.
 *
 * `getHeader` mirrors Express's `req.get` — case-insensitive header lookup.
 */
export function detectBot(
  userAgent: string | undefined,
  getHeader?: (name: string) => string | undefined,
): boolean {
  if (userAgent && BOT_UA.test(userAgent)) return true;
  if (!userAgent) return true; // real browsers always send a UA

  if (getHeader) {
    const purpose = (getHeader('purpose') ?? '').toLowerCase();
    const xPurpose = (getHeader('x-purpose') ?? '').toLowerCase();
    const secPurpose = (getHeader('sec-purpose') ?? '').toLowerCase();
    const xMoz = (getHeader('x-moz') ?? '').toLowerCase();
    if (
      purpose === 'prefetch' ||
      purpose === 'preview' ||
      xPurpose === 'preview' ||
      xPurpose === 'prefetch' ||
      secPurpose.includes('prefetch') ||
      secPurpose.includes('prerender') ||
      xMoz === 'prefetch'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A privacy-preserving unique-visitor fingerprint. The `dayStamp` (e.g.
 * "2026-07-13") is folded into the hash so the value rotates every day and can
 * never be used to follow a visitor across days. No raw IP is ever persisted.
 * Returns null when there's no IP to fingerprint (nothing to count).
 */
export function visitorHash(
  ip: string | undefined | null,
  userAgent: string | undefined,
  dayStamp: string,
  secret: string,
): string | null {
  if (!ip) return null;
  return createHash('sha256')
    .update(`${ip}|${userAgent ?? ''}|${dayStamp}|${secret}`)
    .digest('hex');
}

/** UTC day stamp ("YYYY-MM-DD") for the given date (defaults to now). */
export function utcDayStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
