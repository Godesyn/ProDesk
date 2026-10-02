import { useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { PRODESK_ORIGINS, originUrl } from '../lib/origins';
import { IS_EMBEDDED, postToSuite } from '../lib/embed';
import { sameRegistrableSite } from '../lib/registrable-domain';

/**
 * Cross-frontend navigation with auth hand-off.
 *
 * Prodesk frontends share a session automatically when they sit on the same
 * registrable domain (the cookie is scoped to `.prodesk.com`, see
 * lib/supabase.ts). But a frontend may be hosted on a DIFFERENT domain
 * (e.g. the Links app on adeyy.com) — and browsers never share cookies across
 * registrable domains. For those targets we mint a short-lived, single-use
 * hand-off token on the server (auth.createSubdomainHandoff — the same
 * mechanism as the white-label subdomain redirect) and pass it as a query
 * parameter to the target's /auth/handoff route, which redeems it with
 * verifyOtp to establish its own session. The raw access/refresh tokens are
 * never put in a URL, and the two domains end up with independent sessions —
 * sharing one refresh token across origins breaks Supabase token rotation.
 */

function isLocalName(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Does the frontend at `host` (bare host, possibly with a port — see
 * PRODESK_ORIGINS) already see the session established on THIS origin?
 * - Same origin → yes.
 * - Hosted, same registrable domain → yes (shared `.domain` cookie). Uses the
 *   same eTLD+1 rule as the cookie storage (registrable-domain.ts), so a
 *   multi-part TLD like noize.com.au isn't mistaken for the shared site `com.au`
 *   — two DIFFERENT `.com.au` domains must still hand off, not skip it.
 * - Localhost with a different port → no (dev sessions live in localStorage,
 *   which is per-origin), so dev exercises the same hand-off as cross-domain.
 * - Different registrable domain (or a host-only cookie host) → no.
 */
export function sharesAuthWith(host: string | undefined): boolean {
  if (typeof window === 'undefined') return true;
  if (!host) return true; // originUrl falls back to the current host
  const [targetName, targetPort = ''] = host.toLowerCase().split(':');
  const current = window.location.hostname.toLowerCase();
  if (isLocalName(current) || isLocalName(targetName)) {
    return targetName === current && targetPort === window.location.port;
  }
  return sameRegistrableSite(targetName, current);
}

/**
 * Navigate to another Prodesk frontend, carrying the session across when the
 * target can't see it (see sharesAuthWith). Usage:
 *
 *   const openCrossApp = useCrossAppOpen();
 *   openCrossApp(PRODESK_ORIGINS.reviews, '/', { newWindow: true });
 *
 * With `newWindow` the window is opened synchronously (before the token is
 * minted) so popup blockers treat it as part of the user's click.
 */
export function useCrossAppOpen() {
  const trpc = useTRPC();
  const handoff = useMutation(
    trpc.auth.createSubdomainHandoff.mutationOptions(),
  );

  return useCallback(
    async (
      host: string | undefined,
      path = '/',
      // `urlOnly`: resolve the (hand-off) URL without navigating — for callers
      // that embed the target in-page, e.g. the dashboard's app modal.
      opts?: { newWindow?: boolean; urlOnly?: boolean },
    ): Promise<string> => {
      // Inside the dashboard's app modal the suite is the parent page: close
      // the modal (and route there) instead of loading the suite in the frame.
      if (IS_EMBEDDED && host && host === PRODESK_ORIGINS.dashboard) {
        postToSuite('close', path);
        return '';
      }
      // Claim the window inside the click's task, before any await — a popup
      // opened after an async gap is blocked by popup blockers. Embedded apps
      // stay in the modal: no new windows.
      const win =
        opts?.newWindow && !IS_EMBEDDED ? window.open('', '_blank') : null;
      let target = originUrl(host, path);
      if (!sharesAuthWith(host)) {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          try {
            const { tokenHash } = await handoff.mutateAsync();
            target = originUrl(
              host,
              `/auth/handoff?token_hash=${encodeURIComponent(tokenHash)}&next=${encodeURIComponent(path)}`,
            );
          } catch {
            // Minting failed — open the plain URL; the target shows its login.
          }
        }
      }
      if (opts?.urlOnly) return target;
      if (win) win.location.replace(target);
      else window.location.href = target;
      return target;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handoff.mutateAsync],
  );
}
