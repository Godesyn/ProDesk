/**
 * Cross-frontend origin helpers. The host map itself lives in the central env
 * module (`./env`) with every other build-time var; it is re-exported here so
 * origin consumers keep a single import.
 */
export { PRODESK_ORIGINS } from './env';
import { PRODESK_ORIGINS } from './env';

/**
 * An absolute URL on `host`, reusing the current page's protocol (so local dev
 * stays `http://` and hosted stays `https://`). Falls back to the current host
 * when `host` is unset (e.g. the env var is missing in a given environment).
 */
export function originUrl(host: string | undefined, pathAndSearch = ''): string {
  const h = host || window.location.host;
  return `${window.location.protocol}//${h}${pathAndSearch}`;
}

/**
 * The ONE host the redirector answers on in this environment (`www.adeyy.com` in
 * production, `dev-url.prodesk.com` / `stage-url.prodesk.com` below it).
 *
 * Every generated short link, QR target and signature tracking hop MUST be built
 * from this and nothing else — never from `window.location.host`. A frontend can
 * be served from a host the redirector does not answer on (a brand subdomain such
 * as `noize.adeyy.com`, a white-label domain), and a link minted against that host
 * is dead for everyone who opens it — including on print, where it can't be fixed.
 *
 * The env value is normalised, so a protocol, a trailing slash or an accidental
 * label in front of the configured host can never leak into a generated URL:
 * anything ahead of the last three labels is dropped (`noize.www.adeyy.com` →
 * `www.adeyy.com`), while `localhost:4001` and two-label hosts pass through.
 */
export function redirectorHost(): string | undefined {
  const raw = PRODESK_ORIGINS.redirector?.trim();
  if (!raw) return undefined;
  const host = raw
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
  if (!host) return undefined;
  const labels = host.split('.');
  const www = labels.indexOf('www');
  if (www > 0) return labels.slice(www).join('.');
  return labels.length > 3 ? labels.slice(-3).join('.') : host;
}

/**
 * An absolute URL on the redirector for a generated link — `/<slug>`, `/v/<id>`,
 * `/s/?…`. Returns `undefined` when the redirector origin isn't configured, so
 * callers surface that rather than silently minting a link on their own host.
 */
export function redirectorUrl(pathAndSearch = ''): string | undefined {
  const host = redirectorHost();
  if (!host) return undefined;
  const protocol =
    typeof window === 'undefined' ? 'https:' : window.location.protocol;
  return `${protocol}//${host}${pathAndSearch}`;
}

/**
 * An absolute URL into the MAIN Prodesk app at the given path. Used by satellite
 * frontends (dashboard, links, …) to hand off routes they don't own.
 */
export function mainAppUrl(pathAndSearch = ''): string {
  return originUrl(PRODESK_ORIGINS.app, pathAndSearch);
}
