/**
 * Outbound-redirect helpers. Product rule: every redirect OUT of the app
 * (Stripe Checkout, Stripe Connect / payout onboarding, calendar OAuth) opens in
 * a SEPARATE TAB so the current tab — and anything unsaved in it, like the cart —
 * stays intact. Internal route changes keep using the router (`navigate`).
 *
 * When the destination URL is known synchronously inside a click handler, call
 * {@link openInNewTab}. When the URL only arrives from an async mutation, call
 * {@link reserveNewTab} INSIDE the click handler — it opens a blank tab against
 * the user gesture (so popup blockers allow it) and you point it at the URL once
 * the mutation resolves (or close it on failure).
 */

/** Open a known URL in a new tab. */
export function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export interface ReservedTab {
  /** Send the reserved tab to `url` (falls back to a fresh tab if it was blocked). */
  go: (url: string) => void;
  /** Close the reserved tab (call when the mutation that would fill it failed). */
  cancel: () => void;
}

/**
 * Reserve a blank tab during a user gesture so an async-resolved URL can be
 * loaded into it later without tripping popup blockers. Note: we cannot pass
 * `noopener` here (it forces `window.open` to return `null`, losing the handle),
 * so we null the opener manually for the blank tab.
 */
export function reserveNewTab(): ReservedTab {
  const tab = window.open('about:blank', '_blank');
  if (tab) {
    try {
      tab.opener = null;
    } catch {
      /* cross-origin once navigated — ignore */
    }
  }
  return {
    go: (url: string) => {
      if (tab && !tab.closed) tab.location.href = url;
      else openInNewTab(url); // popup was blocked at reserve time — try again now
    },
    cancel: () => {
      try {
        tab?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
