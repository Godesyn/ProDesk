import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from './auth-context';
import { getSubdomain, getSubdomainUrl, isLocalhost } from '../lib/subdomain';

/**
 * Post-login white-label redirect — a 1:1 port of the Flutter
 * `RouterNotifier._checkAndRedirectToAgencySubdomain` + `redirectToAgencySubdomain`.
 *
 * When an authenticated user is on a subdomain that does NOT match their
 * referring agency (the common case: they signed in on the default `app`
 * domain), we hand their session off to the agency's white-label subdomain so
 * they always work under their referrer's brand/theme. Because Supabase
 * sessions are scoped per-origin we cannot copy the session across hosts;
 * instead we mint a one-time magic-link token (auth.createSubdomainHandoff),
 * sign out of THIS origin — so a later visit to `app` shows the login screen
 * again rather than bouncing — and redirect to `<username>.<domain>/auth/handoff`,
 * which redeems the token to establish a session there.
 *
 * Returns `true` while a redirect is pending so the caller can hold a loading
 * screen instead of flashing the dashboard. Skipped on localhost (subdomains
 * are query-param simulated in dev — mirrors Flutter's `!kDebugMode` guard) and
 * runs at most once per session.
 */
export function useSubdomainRedirect(): boolean {
  const trpc = useTRPC();
  const { data: user } = useCurrentUser();
  const handoff = useMutation(trpc.auth.createSubdomainHandoff.mutationOptions());
  const firedRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);

  const referredId = user?.referredByAgencyId ?? null;
  // Eligible to even check: a real referral and not on the dev host.
  const eligible = !isLocalhost() && !!referredId;

  const agencyQuery = useQuery({
    ...trpc.agencies.byId.queryOptions({ id: referredId ?? '' }),
    enabled: eligible && !firedRef.current,
  });
  const username = (agencyQuery.data as { username?: string } | null)?.username;

  // Synchronously derived (no one-render gap): we still need to redirect while
  // the agency is loading, or once we know its username differs from where we
  // are. `started` latches it through the async sign-out + navigation window.
  const needsRedirect =
    eligible && (agencyQuery.isLoading || (!!username && username !== getSubdomain()));

  useEffect(() => {
    if (firedRef.current) return;
    if (!eligible || agencyQuery.isLoading) return;
    if (!username || username === getSubdomain()) return;
    firedRef.current = true;
    setStarted(true);
    (async () => {
      try {
        const { tokenHash } = await handoff.mutateAsync();
        await supabase.auth.signOut();
        const target = `${getSubdomainUrl(username)}/auth/handoff?token_hash=${encodeURIComponent(tokenHash)}`;
        window.location.replace(target);
      } catch {
        // Hand-off failed — let the user continue on the current domain rather
        // than trapping them on a loading screen.
        setFailed(true);
        setStarted(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, agencyQuery.isLoading, username]);

  if (failed) return false;
  return needsRedirect || started;
}
