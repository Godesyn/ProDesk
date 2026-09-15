import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from './auth-context';
import { INVITE_TOKEN_KEY } from './use-invite-redemption';
import type { ContextOption } from '../components/layout/context-selector/context-option';

/**
 * Auto-select a context on login when the user has NO active role but already has
 * one or more identities available (an invited/accepted staff seat, an owned/staff
 * org, or a contractor profile). Without this, such a user is parked on the
 * role-selection screen even though valid roles already exist for them — instead
 * we switch them into the FIRST available (non-disabled) context, mirroring the
 * ContextSelector's "first option" display fallback but PERSISTING it server-side
 * (auth.switchContext sets role + selected org) so the app routes to a real
 * dashboard rather than onboarding.
 *
 * Skipped while an invite token is pending — useInviteRedemption owns that flow and
 * sets the role itself. Genuinely role-less users (no options) are left on
 * role-selection. Fires once per session; clears its guard on failure so a later
 * load can retry.
 *
 * Called once near the top of App so it runs regardless of the current route.
 */
export function useAutoSelectContext(): void {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();
  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());
  const handled = useRef(false);

  // Only the role-less case this hook exists to resolve: a verified, non-super-admin
  // user with no active role and no pending invite. Super-admins are routed to their
  // console separately, so they must not be auto-switched into an org context.
  const eligible =
    !!user &&
    user.isEmailVerified &&
    !user.role &&
    !user.isSuperAdmin &&
    !localStorage.getItem(INVITE_TOKEN_KEY);

  const { data: options } = useQuery({
    ...trpc.auth.contextOptions.queryOptions(),
    enabled: eligible,
  });

  useEffect(() => {
    if (handled.current || !eligible || !options) return;
    const first = (options as ContextOption[]).find((o) => !o.isDisabled);
    if (!first) return; // genuinely role-less → leave them on role-selection
    handled.current = true;
    switchCtx
      .mutateAsync({ type: first.type, entityId: first.entityId ?? undefined })
      .then(() => {
        qc.invalidateQueries();
        navigate('/'); // App resolves the dashboard from the now-set role
      })
      .catch(() => {
        handled.current = false; // transient failure — allow a retry on next load
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, options]);
}
