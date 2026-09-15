/**
 * The public guidelines link — its vocabulary, in one place.
 *
 * Kept DEPENDENCY-FREE so both ends of the link can import it: the server mints
 * the token (commands.ts) and validates it (routers/logo.ts), while the browser
 * builds the URL and matches the route (clients/logo App.tsx, Guidelines.tsx).
 * When those three lived apart, the route regex and the token format were free
 * to drift and a freshly-minted link could 404 on the page that minted it.
 *
 * Two shapes exist:
 *   • `acme-coffee/v2` — what we mint now, served at `/share/acme-coffee/v2`.
 *     Readable on purpose: you can say it to a printer over the phone.
 *   • 32 hex chars   — minted before that, served at `/g/<token>`. Still valid;
 *     those links are already in circulation.
 */

/** Longest slug we will build. Long enough to stay recognisable, short enough to say. */
const MAX_SLUG = 40;

/**
 * A brand name reduced to the word part of a link: `Acme Coffee Co.` →
 * `acme-coffee-co`. Truncated on a word boundary, never mid-word.
 */
export function brandSlug(name: string): string {
  const words = String(name ?? '')
    .toLowerCase()
    // NFKD splits `é` into `e` + a combining mark, which is then DELETED rather
    // than swept up by the separator pass below — otherwise `Crème` would slug to
    // `cre-me`, splitting a word on its own accent.
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let out = '';
  for (const word of words) {
    const next = out ? `${out}-${word}` : word;
    if (next.length > MAX_SLUG) break;
    out = next;
  }
  return out || 'brand';
}

/** The stored token for a slug + version. */
export const shareTokenFor = (slug: string, version: number | string) => `${slug}/v${version}`;

/**
 * The token as stored, given the two path segments of a `/share/:brand/:version`
 * URL — or null when they aren't a link. Version is hex-tolerant because the
 * minting fallback uses a short random suffix when versions collide.
 */
export function shareTokenFromPath(brand: string, version: string): string | null {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(brand)) return null;
  if (!/^v[0-9a-f]{1,8}$/i.test(version)) return null;
  return `${brand}/${version}`;
}

/** Accepts both shapes — the readable slug and the legacy hex token. */
export const SHARE_TOKEN_RE = /^[a-z0-9][a-z0-9-]*(\/v[0-9a-f]+)?$/i;

/** Where a token is served: readable ones under `/share/`, legacy ones under `/g/`. */
export function shareLinkPath(token: string): string {
  return `${token.includes('/') ? '/share/' : '/g/'}${token}`;
}
