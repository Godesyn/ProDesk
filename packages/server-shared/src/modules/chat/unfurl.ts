import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * LINK UNFURLING — turning a pasted URL into a card.
 *
 * This runs on the server and not in the browser, and that is forced rather than
 * chosen: almost nothing sets `Access-Control-Allow-Origin`, so a client-side
 * fetch of an arbitrary page fails for every site worth previewing.
 *
 * Which makes this an SSRF surface, because the URL is chosen by whoever typed
 * the message. Anyone in any conversation gets to point our server at a URL of
 * their choosing, so four rules are load-bearing:
 *
 *   1. http(s) only. `file:`, `gopher:` and friends are a way to read the disk.
 *   2. Every hop's IP is resolved and checked against the private ranges BEFORE
 *      the request goes out — link-local included, which is where cloud metadata
 *      services live and is the single most valuable target on a hosted box.
 *   3. Redirects are followed MANUALLY, so a public URL cannot 302 to
 *      169.254.169.254 and skip the check. A redirect is a new URL and gets the
 *      full inspection again.
 *   4. Hard caps on time and bytes. A preview is worth a second, not a worker.
 *
 * Nothing here throws for a link that simply cannot be previewed: a URL with no
 * card is the normal case (a private page, a PDF, a site that is down), and the
 * client renders a plain link for it.
 */

export interface LinkPreview {
  url: string;
  /** The URL actually fetched after redirects — what the card should link to. */
  finalUrl: string;
  siteName: string | null;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  /** Host, for the card's label line. Always present when a preview is returned. */
  host: string;
}

const FETCH_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;
/** A real UA: a lot of sites serve nothing at all to an unrecognised client. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; ProdeskBot/1.0; +https://prodesk.com) Chrome/124 Safari/537.36';

/* ── Cache ────────────────────────────────────────────────────────────────
 * In-process, TTL'd, bounded. Per-instance rather than shared, which is the
 * right trade here: the alternative is a table and a migration for data that is
 * free to re-derive, and the value being bought is "the same link in a busy
 * thread is fetched once", which one process already delivers. Negative results
 * are cached too, and for longer — a link that has no card will still have no
 * card in ten minutes, and re-fetching it on every render of the message is how
 * a preview feature turns into an outbound traffic problem.
 */
const TTL_OK_MS = 6 * 60 * 60_000;
const TTL_MISS_MS = 30 * 60_000;
const MAX_CACHE_ENTRIES = 2_000;
const cache = new Map<string, { at: number; ttl: number; value: LinkPreview | null }>();

function readCache(key: string): { value: LinkPreview | null } | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > hit.ttl) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order so the eviction below is roughly LRU rather than
  // strictly by age — a link people keep opening should not be the one dropped.
  cache.delete(key);
  cache.set(key, hit);
  return { value: hit.value };
}

function writeCache(key: string, value: LinkPreview | null): void {
  cache.set(key, { at: Date.now(), ttl: value ? TTL_OK_MS : TTL_MISS_MS, value });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/* ── Address safety ───────────────────────────────────────────────────────── */

/** Private, loopback, link-local and other non-routable space, v4 and v6. */
function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local → cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }
  if (family === 6) {
    const v6 = address.toLowerCase();
    if (v6 === '::' || v6 === '::1') return true;
    if (v6.startsWith('fe80') || v6.startsWith('fc') || v6.startsWith('fd')) return true;
    // v4-mapped (::ffff:10.0.0.1) — check the embedded address, not the wrapper.
    const mapped = v6.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return true; // not an IP we understand → refuse
}

/** Parse + vet a URL. Returns null for anything we will not fetch. */
async function safeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // An IP literal is checked directly; a name is resolved first. Both paths end
  // at the same test, because "is this address ours" is the only real question.
  const literal = isIP(url.hostname) ? url.hostname : null;
  if (literal) return isPrivateAddress(literal) ? null : url;
  try {
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length) return null;
    // ALL of them, not the first: a name that resolves to one public and one
    // private address is a deliberate attack, not a misconfiguration.
    if (addresses.some((a) => isPrivateAddress(a.address))) return null;
    return url;
  } catch {
    return null;
  }
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

/**
 * Fetch a URL's HTML head, following redirects by hand so each hop is vetted.
 * Returns the body text and the URL it finally came from.
 */
async function fetchHtml(start: URL): Promise<{ html: string; finalUrl: URL } | null> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en',
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) return null;
        const next = await safeUrl(new URL(location, current).toString());
        if (!next) return null;
        current = next;
        continue;
      }
      if (!response.ok) return null;

      const contentType = response.headers.get('content-type') ?? '';
      // Only HTML has a card in it. A PDF or an image is a fine link and a
      // pointless preview, and downloading it to find that out is the waste.
      if (!/text\/html|application\/xhtml/i.test(contentType)) return null;

      const html = await readCapped(response);
      return html === null ? null : { html, finalUrl: current };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Read at most MAX_BYTES and stop.
 *
 * `response.text()` would read whatever the other end decides to send, and the
 * meta tags we want are in the first few KB of every page ever written. Reading
 * the stream by hand is what makes a hostile 4GB response a non-event.
 */
async function readCapped(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let out = '';
  let read = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      read += value.byteLength;
      out += decoder.decode(value, { stream: true });
      // </head> is the point past which nothing we want can appear.
      if (read >= MAX_BYTES || /<\/head>/i.test(out)) break;
    }
  } catch {
    return out || null;
  } finally {
    void reader.cancel().catch(() => {});
  }
  return out;
}

/* ── Parse ────────────────────────────────────────────────────────────────── */

/** Pull one meta tag's content, matching either attribute order. */
function meta(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1]).trim() || null;
  }
  return null;
}

/** The five entities that actually appear in title and description tags. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function clamp(value: string | null, max: number): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

/**
 * Unfurl one URL. Returns null when there is nothing worth showing — which is a
 * normal outcome, not an error.
 */
export async function unfurl(rawUrl: string): Promise<LinkPreview | null> {
  const cached = readCache(rawUrl);
  if (cached) return cached.value;

  const url = await safeUrl(rawUrl);
  if (!url) {
    writeCache(rawUrl, null);
    return null;
  }

  const fetched = await fetchHtml(url);
  if (!fetched) {
    writeCache(rawUrl, null);
    return null;
  }
  const { html, finalUrl } = fetched;

  const title =
    clamp(meta(html, 'og:title') ?? meta(html, 'twitter:title'), 140) ??
    clamp(decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ''), 140);
  const description = clamp(
    meta(html, 'og:description') ?? meta(html, 'twitter:description') ?? meta(html, 'description'),
    220,
  );
  const rawImage = meta(html, 'og:image') ?? meta(html, 'twitter:image');
  // Resolve a relative og:image against the page, and only keep it if the
  // result is an address we would have fetched ourselves — the browser will
  // load it directly, so it is the same class of target.
  let imageUrl: string | null = null;
  if (rawImage) {
    try {
      const resolved = new URL(rawImage, finalUrl);
      imageUrl = (await safeUrl(resolved.toString()))?.toString() ?? null;
    } catch {
      imageUrl = null;
    }
  }

  // A card with nothing but a host on it is worse than the plain link it would
  // replace — the link at least says where it goes.
  if (!title && !description && !imageUrl) {
    writeCache(rawUrl, null);
    return null;
  }

  const preview: LinkPreview = {
    url: rawUrl,
    finalUrl: finalUrl.toString(),
    siteName: clamp(meta(html, 'og:site_name'), 60),
    title,
    description,
    imageUrl,
    host: finalUrl.hostname.replace(/^www\./, ''),
  };
  writeCache(rawUrl, preview);
  return preview;
}
