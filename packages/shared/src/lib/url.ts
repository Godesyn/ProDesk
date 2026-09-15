/**
 * URL helpers for optional website / social fields.
 *
 * Users routinely type a bare domain ("example.com", "www.acme.io/team") and
 * expect it to be accepted — forcing them to prefix "https://" is a common
 * source of false "invalid URL" errors. So we normalize first: when a value has
 * no scheme we prepend `https://`, then validate the result. Empty stays empty
 * (these fields are all optional).
 */

// A dotted host + optional path/query, with or without a leading scheme.
const URL_WITH_SCHEME = /^(https?):\/\/[\w-]+(\.[\w-]+)+([\w\-.,@?^=%&:/~+#]*[\w\-@?^=%&/~+#])?$/i;

/** Prepend `https://` when the value is a bare domain (no http/https scheme). */
export function normalizeUrl(value: string): string {
  const v = value.trim();
  if (!v) return '';
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

/**
 * Null when the field is empty or a valid URL (after normalization); otherwise
 * an error string. Accepts bare domains since {@link normalizeUrl} fills in the
 * scheme.
 */
export function urlError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return URL_WITH_SCHEME.test(normalizeUrl(v)) ? null : 'Enter a valid URL (e.g. example.com)';
}

/** Normalize for submit: returns the https-normalized URL, or undefined if empty. */
export function normalizeUrlOrUndefined(value: string): string | undefined {
  return normalizeUrl(value) || undefined;
}

/**
 * Success/cancel URLs for a Stripe checkout that should return the user to the
 * page (and origin) they started from. The dashboard and prodesk clients run on
 * different origins, so we derive these from `window.location` rather than a
 * single server-side default — Stripe then redirects back to whichever client
 * triggered the checkout, landing on the originating route with `?sub=...`.
 */
export function checkoutReturnUrls(): { successUrl: string; cancelUrl: string } | undefined {
  if (typeof window === 'undefined') return undefined;
  const base = `${window.location.origin}${window.location.pathname}`;
  return {
    successUrl: `${base}?sub=success`,
    cancelUrl: `${base}?sub=cancel`,
  };
}
