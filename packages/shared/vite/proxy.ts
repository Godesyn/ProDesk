import type { ProxyOptions } from 'vite';

/**
 * Dev/preview proxy target — the backend API base, scheme-normalized.
 *
 * `VITE_API_URL` is `RAILWAY_PUBLIC_DOMAIN`, which is scheme-LESS (e.g.
 * `stage-api.prodesk.com`, no `https://`). http-proxy's `url.parse()` then
 * returns a null protocol and `setupOutgoing` crashes with "Cannot read
 * properties of null (reading 'split')" the moment any request hits a proxied
 * path. So prepend `https://` when the scheme is missing — mirroring the
 * bundle-side normalization in packages/shared/src/lib/env.ts. Falls back to the
 * local API in dev where the var is unset.
 */
export function apiProxyTarget(): string {
  const raw = process.env.VITE_API_URL?.trim();
  if (!raw) return 'http://localhost:4000';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/**
 * The dev/preview proxy map: every path the Express API (not the SPA) owns,
 * forwarded to the backend so a single-origin dev app — and a locally-built
 * `vite preview` whose bundle has a relative API_URL — reaches it. Shared by all
 * client vite.configs so the (crash-prone) target derivation lives in one place.
 */
export function apiProxy(): Record<string, ProxyOptions> {
  const target = apiProxyTarget();
  return Object.fromEntries(
    ['/trpc', '/api', '/confirm', '/unsubscribe', '/webhooks', '/health'].map(
      (route) => [route, { target, changeOrigin: true }],
    ),
  );
}
