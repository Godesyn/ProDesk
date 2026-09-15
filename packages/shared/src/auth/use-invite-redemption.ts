import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from './auth-context';

/** localStorage key holding a pending new-user invite token across the signup→verify hops. */
export const INVITE_TOKEN_KEY = 'pd_invite_token';

/**
 * Drives the new-user invitation flow (the `/signup?invite=<token>` email links).
 *
 * The token must survive several navigations — the invited user lands on /signup,
 * signs up, gets bounced to the verify-email gate, clicks the verification link
 * (/auth/confirm), and only THEN returns authenticated + verified. So we stash the
 * token in localStorage the moment it appears in the URL, and redeem it once the
 * user is fully verified:
 *
 *  - staff      → server links + activates the staff seat and switches the user
 *                 into the staff context; we clear the token and let App route to
 *                 the staff workspace.
 *  - contractor → we route to the contractor-create screen and KEEP the token; it
 *                 is consumed by contractor.create (which wires up the agency
 *                 connection once a profile exists) and cleared there.
 *
 * Called once near the top of App so it runs on every route regardless of branch.
 */
export function useInviteRedemption(): void {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const redeem = useMutation(trpc.auth.redeemInvite.mutationOptions());
  const handled = useRef(false);

  // Capture the token as soon as it appears in the URL (before any navigation drops it).
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite');
    if (token) localStorage.setItem(INVITE_TOKEN_KEY, token);
  }, []);

  // Redeem once the user exists and has verified their email.
  useEffect(() => {
    if (handled.current) return;
    const token = localStorage.getItem(INVITE_TOKEN_KEY);
    if (!token || !user || !user.isEmailVerified) return;
    handled.current = true;

    redeem
      .mutateAsync({ token })
      .then((res) => {
        if (res.kind === 'staff') {
          localStorage.removeItem(INVITE_TOKEN_KEY);
          toast.success('Invitation accepted');
          qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
          navigate('/'); // App resolves the staff dashboard from the refreshed role
        } else if (res.kind === 'contractor') {
          if (res.alreadyContractor) {
            // Already a contractor — the server activated the connection during
            // redemption, so there's no profile step. Clear the token and route
            // to their workspace instead of the contractor-create screen.
            localStorage.removeItem(INVITE_TOKEN_KEY);
            toast.success('Invitation accepted');
            qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
            navigate('/');
          } else {
            // New contractor — keep the token; contractor.create consumes it
            // once the profile is built.
            navigate('/create-contractor');
          }
        } else if (res.kind === 'proposal') {
          // Proposal link redeemed after signup/login: the server connected the
          // proposal (claimed the agency's referral brand) → open it. If it
          // couldn't auto-connect (brand owned by someone else), send them to the
          // public page to choose which brand to attach it to.
          localStorage.removeItem(INVITE_TOKEN_KEY);
          qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
          if (res.reason) {
            toast.error(res.reason);
            navigate('/');
          } else if (res.connected && res.proposalId) {
            toast.success('Proposal connected');
            navigate(`/proposal/${res.proposalId}`);
          } else {
            navigate(`/public/proposal/${token}`);
          }
        } else {
          localStorage.removeItem(INVITE_TOKEN_KEY);
          if (res.reason) toast.error(res.reason);
        }
      })
      .catch(() => {
        // Transient failure (e.g. network) — clear the guard so a later load retries.
        handled.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.isEmailVerified]);
}
