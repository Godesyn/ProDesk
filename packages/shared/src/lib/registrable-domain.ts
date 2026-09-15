/**
 * Registrable-domain (eTLD+1) helpers, shared by the auth-cookie storage
 * (lib/supabase.ts) and the cross-app hand-off decision (auth/use-cross-app.ts)
 * so both agree on what "the same site" means. A naive last-two-labels rule is
 * wrong for multi-part public suffixes: `foo.noize.com.au` is NOT on the site
 * `com.au`, and a cookie scoped to `.com.au` (or `.railway.app`) is rejected by
 * the browser outright ("rejected for invalid domain").
 */

/**
 * Public suffixes where the naive last-two-labels apex is NOT a registrable
 * domain. Covers the PaaS preview hosts we may be reached on directly (e.g. a
 * raw `*.up.railway.app` URL) plus the multi-part ccTLDs our real/white-label
 * domains use (noize.com.au, …). This is a pragmatic subset of the Public
 * Suffix List — enough for the domains this app is served from.
 */
export const PUBLIC_SUFFIXES = new Set([
  'up.railway.app', 'railway.app', 'vercel.app', 'netlify.app', 'pages.dev',
  'com.au', 'net.au', 'org.au', 'co.uk', 'org.uk', 'co.nz', 'com.br',
]);

/**
 * The registrable domain (eTLD+1) of a hostname — the parent a cross-subdomain
 * cookie can be scoped to — or `null` when there is no valid shared parent:
 * localhost / a bare host, an IPv4 literal, or a public-suffix apex where the
 * only safe scope is the host itself (e.g. `*.up.railway.app`). Handles
 * multi-part suffixes: `stage-app.noize.com.au` → `noize.com.au`.
 */
export function registrableDomain(hostname: string): string | null {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  const labels = host.split('.');
  if (labels.length < 2) return null;
  const two = labels.slice(-2).join('.');
  if (!PUBLIC_SUFFIXES.has(two)) return two;
  // The 2-label apex is itself a public suffix, so the registrable domain needs
  // 3 labels (e.g. `noize.com.au`). If we don't have that many, or it's still a
  // suffix (`*.up.railway.app`), there is no valid shared parent.
  const three = labels.slice(-3).join('.');
  if (labels.length < 3 || PUBLIC_SUFFIXES.has(three)) return null;
  return three;
}

/**
 * The `Domain` attribute for a cross-subdomain cookie (`.<registrable domain>`),
 * or `undefined` for a host-only cookie when no valid shared parent exists.
 *
 * Note this cannot separate environments: `dev-app`, `stage-app` and `app` are
 * siblings under `prodesk.com`, so all three share one cookie jar and one
 * ~16 KB request-header ceiling at Railway's edge — which is why lib/supabase.ts
 * keeps only the current environment's session (see the eviction note there).
 * Naming the lower envs as a subtree instead (`app.dev.prodesk.com`, scoped to
 * `.dev.prodesk.com`) would isolate them properly and allow simultaneous
 * multi-env logins, but that is a DNS + Railway-domain change, not a code one.
 */
export function cookieDomain(hostname: string): string | undefined {
  const rd = registrableDomain(hostname);
  return rd ? '.' + rd : undefined;
}

/**
 * Do two hosts share auth — i.e. can a cookie set by one be read by the other?
 * True only when they are the same host, or resolve to the SAME real registrable
 * domain (so a `.parent` cookie covers both). Two hosts with no valid shared
 * parent (both host-only) never share unless identical.
 */
export function sameRegistrableSite(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const ra = registrableDomain(a);
  return ra !== null && ra === registrableDomain(b);
}
