import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL as url,
  SUPABASE_PUBLISHABLE_KEY as publishableKey,
} from './env';
import { cookieDomain } from './registrable-domain';

if (!url || !publishableKey) {
  // eslint-disable-next-line no-console
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing — auth will not work.',
  );
}

// ─── Cross-subdomain cookie storage ────────────────────────────────
// Shares auth sessions across sibling subdomains (e.g. app ↔ dashboard on
// *.prodesk.com) while keeping environments (prod / staging / dev) isolated
// via prefixed keys.

const isLocalhost =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1');

/**
 * Cookie domain — the registrable domain (so all sibling subdomains share the
 * session), derived from the page host rather than hard-coded to `.prodesk.com`
 * so a frontend served from another domain (noize.com.au, adeyy.com, …) works
 * too. `cookieDomain` returns `undefined` (a host-only cookie) whenever a shared
 * Domain would be INVALID: localhost, an IPv4 host, or a public-suffix apex.
 * That last case is the important one — the naive last-two-labels of
 * `foo.up.railway.app` is `railway.app`, a public suffix the browser silently
 * rejects, so NONE of the auth cookies persist and the user can never stay
 * signed in. A host-only cookie sidesteps that; multi-part TLDs like
 * `stage-app.noize.com.au` still resolve to `.noize.com.au` for real SSO. Other
 * domains that can't see the cookie get their own session via the /auth/handoff
 * flow (auth/use-cross-app). See lib/registrable-domain.ts.
 */
const COOKIE_DOMAIN =
  isLocalhost || typeof window === 'undefined'
    ? undefined
    : cookieDomain(window.location.hostname);
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400; // 400 days (max allowed by browsers)

/** Derive environment from hostname to prevent cross-env session leakage. */
function getEnvPrefix(): 'dev' | 'stg' | 'prod' {
  if (typeof window === 'undefined') return 'dev';
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('dev-'))
    return 'dev';
  if (host.startsWith('stage-')) return 'stg';
  return 'prod';
}

const ENV_PREFIX = getEnvPrefix();

function setCookie(name: string, value: string) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'path=/',
    `max-age=${COOKIE_MAX_AGE}`,
    'SameSite=Lax',
  ];
  if (COOKIE_DOMAIN) parts.push(`domain=${COOKIE_DOMAIN}`);
  if (window.location.protocol === 'https:') parts.push('Secure');
  document.cookie = parts.join('; ');
}

function getCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function removeCookie(name: string) {
  const parts = [`${name}=`, 'path=/', 'max-age=0', 'SameSite=Lax'];
  // Expire BOTH representations. A deletion only clears a cookie whose Domain
  // matches, so the domain-scoped write leaves a host-only twin (written by an
  // older deploy, or on a host where COOKIE_DOMAIN was undefined) in the jar
  // forever — and that twin also shadows the shared one on read, because
  // document.cookie lists the more specific match first.
  document.cookie = parts.join('; ');
  if (COOKIE_DOMAIN)
    document.cookie = [...parts, `domain=${COOKIE_DOMAIN}`].join('; ');
}

/** Names of every cookie visible to this document, in jar order. */
function cookieNames(): string[] {
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0].trim())
    .filter(Boolean);
}

// ─── Cookie chunking ───────────────────────────────────────────────
// Browsers cap each cookie at 4096 B (name + value + attributes). A full
// Supabase session (JWT + refresh token + user object) easily exceeds this,
// so we split large values across `${key}.0`, `${key}.1`, … cookies and
// reassemble on read — mirroring @supabase/ssr's chunker.

/** Max encoded value length per cookie; leaves headroom for name + attributes under 4096 B. */
const MAX_CHUNK_SIZE = 3200;

/** Split a value so each chunk's URL-encoded form stays within MAX_CHUNK_SIZE. */
function splitIntoChunks(value: string): string[] {
  let encoded = encodeURIComponent(value);
  const chunks: string[] = [];
  while (encoded.length > 0) {
    let head = encoded.slice(0, MAX_CHUNK_SIZE);
    // Don't slice through a %XX escape sequence.
    const pct = head.lastIndexOf('%');
    if (pct > head.length - 3) head = head.slice(0, pct);
    let raw = '';
    while (head.length > 0) {
      try {
        raw = decodeURIComponent(head);
        break;
      } catch {
        head = head.slice(0, -1);
      }
    }
    chunks.push(raw);
    encoded = encoded.slice(head.length);
  }
  return chunks;
}

/**
 * Remove every cookie representing `key` — the single cookie AND all `key.N`
 * chunks — found by scanning the jar rather than probing indices upward. A
 * contiguous probe stops at the first gap, so any chunk past a missing index
 * (left by a larger earlier session, or hidden behind a host-only twin at
 * index 0) would linger in the jar for its full 400-day max-age. That leak is
 * unforgiving here: every *.prodesk.com host shares one jar, and Railway's edge
 * answers 431 once a request's headers exceed ~16 KB — the document itself never
 * loads, so no client-side cleanup can ever run to undo it.
 */
function removeAllChunks(key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const chunkName = new RegExp(`^${escaped}\\.\\d+$`);
  for (const name of cookieNames()) {
    if (name === key || chunkName.test(name)) removeCookie(name);
  }
}

// ─── One environment's session per jar ─────────────────────────────
// dev-*, stage-* and production hosts all live on *.prodesk.com, so a single
// cookie jar can hold three sessions (`dev-`, `stg-`, `prod-sb-auth-token`) and
// EVERY request to EVERY prodesk.com host carries all of them. A session is not
// just a token — Supabase persists the whole envelope (access + refresh token
// plus the full user record with user_metadata and a per-provider identities
// array), which measures ~7 KB once percent-encoded. Two of those plus ordinary
// request headers already sit on top of the ~16 KB ceiling Railway's edge
// enforces, and past it every prodesk.com frontend answers 431 at once — while
// adeyy.com / sigkitt.com stay healthy, since a white-label domain only ever
// sees its own environment.
//
// So the invariant is one environment's session per jar, enforced on the way in
// rather than as a size heuristic: at ~7 KB apiece there is no room for two, and
// a jar that merely *approaches* the ceiling would brick the browser on a page
// that hasn't loaded yet — where no cleanup of ours can run. Signing into dev
// therefore signs the browser out of prod, and vice versa. (Use separate browser
// profiles, or see the follow-up note in registrable-domain.ts, to keep both.)

/** `<env>-sb-auth-token`, its `.N` chunks, and its `-code-verifier` sibling. */
const AUTH_COOKIE_NAME = /^(dev|stg|prod)-sb-auth-token(?:[.-].*)?$/;

/** Jar size we expect to stay under; a breach means something else is bloating. */
const COOKIE_JAR_BUDGET = 12288;

/**
 * Drop every auth cookie that belongs to another environment. `document.cookie`
 * is byte-for-byte what the `Cookie` header carries (nothing here is HttpOnly),
 * so its length is the number being defended.
 */
function evictForeignEnvSessions() {
  if (typeof document === 'undefined' || isLocalhost) return;
  for (const name of cookieNames()) {
    const env = AUTH_COOKIE_NAME.exec(name)?.[1];
    if (env && env !== ENV_PREFIX) removeCookie(name);
  }
  if (document.cookie.length > COOKIE_JAR_BUDGET) {
    // eslint-disable-next-line no-console
    console.warn(
      `[auth] cookie jar is ${document.cookie.length} B with one session — at ~16 KB the edge 431s every request.`,
    );
  }
}

function getChunkedCookie(key: string): string | null {
  const single = getCookie(key);
  if (single !== null) return single;
  let result = '';
  for (let i = 0; ; i++) {
    const chunk = getCookie(`${key}.${i}`);
    if (chunk === null) break;
    result += chunk;
  }
  return result.length > 0 ? result : null;
}

function setChunkedCookie(key: string, value: string) {
  // Make room BEFORE growing the jar. This is the only write path — sign-in and
  // every token refresh both land here — so evicting here means the jar never
  // holds two sessions at once, not even for the single navigation that a
  // size-triggered sweep would let through.
  evictForeignEnvSessions();
  // Clear any prior representation (single or chunked) before writing.
  removeAllChunks(key);
  if (encodeURIComponent(value).length <= MAX_CHUNK_SIZE) {
    setCookie(key, value);
    return;
  }
  splitIntoChunks(value).forEach((chunk, i) => setCookie(`${key}.${i}`, chunk));
}

/**
 * Custom storage adapter that persists Supabase auth tokens in a cookie
 * scoped to `.prodesk.com`, enabling cross-subdomain SSO.
 * Falls back to localStorage on localhost where cookies lack a shared domain.
 */
const crossDomainStorage: Storage = isLocalhost
  ? globalThis.localStorage
  : {
      get length() {
        return document.cookie.split(';').length;
      },
      clear() {
        /* no-op — we only manage our own keys */
      },
      key() {
        return null;
      },
      getItem: (key: string) => getChunkedCookie(key),
      setItem: (key: string, value: string) => setChunkedCookie(key, value),
      removeItem: (key: string) => removeAllChunks(key),
    };

const storageKey = `${ENV_PREFIX}-sb-auth-token`;

// A tab that only reads its session never reaches the write path, so sweep once
// at boot too. This can't rescue the current document — a 431 means this module
// never ran — but it brings the next navigation back under the ceiling, which is
// what turns the failure from "clear your cookies by hand" into a reload.
evictForeignEnvSessions();

/** Browser Supabase client (publishable key). Handles login/session + storage uploads. */
export const supabase = createClient(url ?? '', publishableKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: crossDomainStorage,
    storageKey,
  },
  // Run the realtime heartbeat in a Web Worker (inline blob — no external fetch).
  // Background tabs throttle page timers to ≥1/min, which starves the 25s
  // heartbeat, closes the websocket, and silently drops every postgres_changes
  // event until the tab is foregrounded. Worker timers aren't throttled, so the
  // socket stays alive while the tab is hidden.
  realtime: { worker: true },
});
