import { PRODESK_ORIGINS } from './env';

/**
 * Subdomain detector — multi-tenant white-label: the leading host label (prod)
 * or a `?subdomain=` query param (dev) identifies the tenant agency whose
 * `username` equals that subdomain. That agency is the session's
 * "referredByAgency" and drives the app theme.
 *
 * Tenants are recognized as exactly one label in front of any configured ROOT
 * domain (the hostnames in PRODESK_ORIGINS, `www.` stripped) — so both the
 * platform root `noize.app.prodesk.com` AND a custom brand root
 * `noize.verdiict.com` resolve to tenant `noize`. This is why detection is
 * root-driven rather than counting labels: a 3-label host can be either a bare
 * custom root (`www.verdiict.com`) or a tenant (`noize.verdiict.com`), and only
 * the configured roots can tell them apart.
 */
const DEFAULT_SUBDOMAIN = 'app';
const MAIN_DOMAIN_PATTERNS = ['www', 'localhost', '127.0.0.1'];

/**
 * The base host of every frontend the app is served on (protocol dropped,
 * leading `www.` stripped, de-duplicated). A tenant host is `<username>.<root>`.
 * Empty when no origins are configured (e.g. SSR / tests) → no tenant is ever
 * detected, which is the safe default.
 */
function rootHosts(): string[] {
  const roots = new Set<string>();
  for (const origin of Object.values(PRODESK_ORIGINS)) {
    if (!origin) continue;
    try {
      // PRODESK_ORIGINS values are bare hosts (`app.prodesk.com`,
      // `localhost:5173`) — scheme-less strings that new URL() rejects (or
      // mis-parses, `localhost:` as a scheme), so prefix one before parsing.
      const withScheme = origin.includes('://') ? origin : `https://${origin}`;
      const hostname = new URL(withScheme).hostname.toLowerCase().replace(/^www\./, '');
      if (hostname) roots.add(hostname);
    } catch {
      /* malformed origin — skip */
    }
  }
  return [...roots];
}

/**
 * Prodesk's own platform/legal identity — 1:1 with the Flutter
 * `SubdomainDetector` constants (defaultApplicationName / tagline / business
 * address / ABN / ACN). Kept here, beside the detector, exactly as in Flutter.
 * The server mirror lives in `server/src/lib/prodesk-identity.ts` and is what
 * actually populates the platform party on tax invoices.
 */
export const PRODESK_IDENTITY = {
  applicationName: 'Prodesk',
  applicationNameLower: 'prodesk',
  tagline: 'EVERYTHING CLICKS',
  businessAddress: '227/10 Albert Avenue, Broadbeach QLD 4218 AU',
  businessAbn: '38696024432',
  businessAcn: '696024432',
} as const;

/** Subdomains must be alphanumeric + hyphens (matches the agency username rule). */
function isValidSubdomain(s: string): boolean {
  return /^[a-z0-9-]+$/.test(s);
}

/**
 * The current tenant subdomain, or null when on a bare root / main domain.
 * - localhost / 127.0.0.1 → the `?subdomain=` query param (dev simulation).
 * - production → the single label in front of a configured root, e.g. `noize`
 *   in both `noize.app.prodesk.com` and `noize.verdiict.com`. A bare root
 *   (`app.prodesk.com`, `verdiict.com`, `www.verdiict.com`), a main-domain
 *   pattern, the default `app`, `deleted`, or `dev` all resolve to null.
 */
export function getSubdomain(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const host = window.location.hostname.toLowerCase();

    if (host === 'localhost' || host === '127.0.0.1') {
      const dev = new URLSearchParams(window.location.search).get('subdomain');
      return dev && dev.trim() ? dev.trim().toLowerCase() : null;
    }

    const stripped = host.replace(/^www\./, '');
    const roots = rootHosts();
    // A bare root domain has no tenant (`verdiict.com`, `app.prodesk.com`).
    if (roots.includes(stripped)) return null;
    // Otherwise a tenant is exactly one label ahead of a known root.
    for (const root of roots) {
      const suffix = `.${root}`;
      if (!stripped.endsWith(suffix)) continue;
      const candidate = stripped.slice(0, -suffix.length);
      if (candidate.includes('.')) continue; // deeper than one label → not a tenant
      if (candidate === 'dev' || candidate === DEFAULT_SUBDOMAIN || candidate === 'deleted') return null;
      if (MAIN_DOMAIN_PATTERNS.includes(candidate)) return null;
      if (!isValidSubdomain(candidate)) return null;
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

/** True on the dev host, where subdomains are simulated via `?subdomain=`. */
export function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1';
}

/**
 * The absolute base URL of a tenant agency's subdomain (port of Flutter
 * `SubdomainDetector.getSubdomainUrl`). Used to redirect a referred user to
 * their agency's white-label domain after login.
 * - dev (localhost) → same origin with `?subdomain=<username>` (simulation).
 * - production → `https://<username>.<base>`, where `<base>` is the current host
 *   with any existing tenant subdomain label stripped (e.g. on
 *   `acme.app.prodesk.com` the base is `app.prodesk.com`).
 */
export function getSubdomainUrl(username: string): string {
  const { protocol, host, hostname } = window.location;
  if (isLocalhost()) {
    return `${protocol}//${host}/?subdomain=${encodeURIComponent(username)}`;
  }
  // Drop a leading `www.` first — otherwise a www-canonical host bakes it into
  // the base and we'd send the user to `<username>.www.<domain>` (a bogus host
  // that isn't provisioned and isn't on the wildcard cert).
  const bareHost = hostname.replace(/^www\./, '');
  // Strip the leading label only when we are already on a tenant subdomain, so
  // we always build off the bare default domain (app.prodesk.com).
  const base = getSubdomain() ? bareHost.replace(/^[^.]+\./, '') : bareHost;
  return `${protocol}//${username}.${base}`;
}

/**
 * The referrer to stamp on a brand-new user at provisioning time
 * (Flutter: `refAgencyId ?? SubdomainDetector.referredByAgency?.id`). Resolved
 * from the current URL:
 * - `?ref_user_id=<userId>` — an individual affiliate link (profile AffiliateCard).
 * - `?ref=<agencyId>` — an agency affiliate link; wins over the subdomain.
 * - otherwise the tenant subdomain (resolved to an agency id server-side).
 */
export function detectReferral(): {
  referredByUserId?: string;
  referredByAgencyId?: string;
  referredBySubdomain?: string;
} {
  if (typeof window === 'undefined') return {};
  const params = new URLSearchParams(window.location.search);
  const ref = params.get('ref');
  const refUser = params.get('ref_user_id');
  const subdomain = getSubdomain();
  return {
    referredByUserId: refUser && refUser.trim() ? refUser.trim() : undefined,
    referredByAgencyId: ref && ref.trim() ? ref.trim() : undefined,
    referredBySubdomain: subdomain ?? undefined,
  };
}
