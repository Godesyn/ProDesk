/**
 * Read-only view of the browser's Supabase session from a request's cookies.
 *
 * The frontends persist the session in a cookie scoped to the registrable
 * domain (`.adeyy.com`) rather than localStorage — see
 * packages/shared/src/lib/supabase.ts — so every host under that domain,
 * including this server, receives it. Nothing here is HttpOnly and nothing here
 * grants access: the redirector only asks "is this visitor signed in?" so it can
 * send them to the app instead of the marketing page. Authorisation still
 * happens in the backend against a verified JWT.
 *
 * This is a server-side mirror of that module's cookie layout (env-prefixed key,
 * URL-encoded value, `.N` chunking); the two must stay in step.
 *
 * Not reproducible in local dev: on localhost the frontends fall back to
 * localStorage (no shared cookie domain exists), so a locally signed-in browser
 * looks signed OUT to this server and always gets the landing page. Exercise the
 * signed-in branch on a real *.adeyy.com host, or with a hand-made
 * `dev-sb-auth-token` cookie.
 */

/** Session envelope shape we care about (auth-js stores `JSON.stringify(session)`). */
interface StoredSession {
  access_token?: string;
  refresh_token?: string;
  /** Unix seconds. */
  expires_at?: number;
}

/**
 * Environment prefix on the auth-cookie key, derived from the request host —
 * a 1:1 port of `getEnvPrefix()` in packages/shared/src/lib/supabase.ts. All
 * environments are siblings under one registrable domain, so the prefix is the
 * only thing separating their sessions in a shared cookie jar.
 */
export function envPrefix(host: string | undefined): 'dev' | 'stg' | 'prod' {
  const hostname = (host ?? '').split(':')[0].toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('dev-'))
    return 'dev';
  if (hostname.startsWith('stage-')) return 'stg';
  return 'prod';
}

/**
 * Parse a `Cookie` header into name → value, keeping the FIRST occurrence of a
 * name. Duplicates are normal here: a host-only cookie and a `.adeyy.com`-scoped
 * one can coexist, and the browser lists the more specific match first — which
 * is also the one `document.cookie` reads on the client, so first-wins keeps
 * both sides agreeing on which session is live.
 */
function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!header) return jar;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const name = part.slice(0, eq).trim();
    if (!name || jar.has(name)) continue;
    try {
      jar.set(name, decodeURIComponent(part.slice(eq + 1).trim()));
    } catch {
      /* malformed percent-encoding — ignore this cookie */
    }
  }
  return jar;
}

/**
 * Reassemble a possibly-chunked cookie value. Large sessions are split across
 * `<key>.0`, `<key>.1`, … because browsers cap a single cookie at 4 KB.
 */
function chunkedValue(jar: Map<string, string>, key: string): string | null {
  const single = jar.get(key);
  if (single !== undefined) return single;
  let value = '';
  for (let i = 0; ; i++) {
    const chunk = jar.get(`${key}.${i}`);
    if (chunk === undefined) break;
    value += chunk;
  }
  return value.length > 0 ? value : null;
}

/**
 * Is this request carrying a usable Supabase session?
 *
 * True when the envelope parses and still has a refresh token — an expired
 * access token is fine, the app refreshes it on load. A session with no refresh
 * token counts only while its access token is unexpired. Anything unparseable
 * reads as signed out, which keeps the visitor on the marketing page rather than
 * bouncing them to an app that would show them a login screen.
 *
 * Presence, not proof: this only decides which of two pages to serve. The Links
 * app re-establishes the session itself on arrival and the backend still checks a
 * verified JWT, so a stale cookie costs the visitor a login screen, nothing more.
 */
export function hasSupabaseSession(
  cookieHeader: string | undefined,
  host: string | undefined,
): boolean {
  const raw = chunkedValue(parseCookies(cookieHeader), `${envPrefix(host)}-sb-auth-token`);
  if (!raw) return false;
  let session: StoredSession;
  try {
    session = JSON.parse(raw) as StoredSession;
  } catch {
    return false;
  }
  if (typeof session?.refresh_token === 'string' && session.refresh_token) return true;
  if (!session?.access_token) return false;
  return typeof session.expires_at === 'number' && session.expires_at * 1000 > Date.now();
}
