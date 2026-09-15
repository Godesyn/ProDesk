/**
 * The `?beta=<code>` signup parameter.
 *
 * The code has to survive several navigations before it can be redeemed: the
 * visitor lands on /signup, submits (or takes the Google OAuth round-trip, which
 * leaves and re-enters the app), and only then does `auth.ensureUser` provision the
 * `users` row that carries the grant. Reading `window.location.search` at that
 * point would find nothing, so the code is stashed in localStorage the instant it
 * appears — the same technique the invite token uses (see use-invite-redemption).
 *
 * It is cleared once provisioning has run so a later signup on the same browser
 * can't inherit a stale cohort.
 */

/** localStorage key holding a pending beta code across the signup → provision hops. */
export const BETA_CODE_KEY = 'pd_beta_code';

/** Codes are letters, numbers and hyphens (mirrors the server's codeSchema). */
const CODE_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,39}$/;

/**
 * Capture `?beta=<code>` from the current URL into localStorage, and return the
 * code now in play (freshly captured, or previously stashed). Invalid codes are
 * ignored rather than stored, so a junk value can't sit in storage forever.
 *
 * Safe to call on every render — it's idempotent and does no network work.
 */
export function captureBetaCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = new URLSearchParams(window.location.search).get('beta');
    const code = raw?.trim() ?? '';
    if (code && CODE_RE.test(code)) {
      localStorage.setItem(BETA_CODE_KEY, code);
      return code;
    }
    const stored = localStorage.getItem(BETA_CODE_KEY);
    return stored && CODE_RE.test(stored) ? stored : null;
  } catch {
    // Private-browsing / storage-disabled: fall back to the URL only. The signup
    // still works; the code just won't survive an OAuth round-trip.
    return null;
  }
}

/** The stashed code without touching the URL. */
export function pendingBetaCode(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(BETA_CODE_KEY);
    return stored && CODE_RE.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

/** Drop the stashed code — called once provisioning has consumed it. */
export function clearBetaCode(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(BETA_CODE_KEY);
  } catch {
    /* nothing to clear */
  }
}
