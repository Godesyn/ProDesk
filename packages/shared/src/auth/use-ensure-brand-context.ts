import { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from './auth-context';
import { brandAllowedByApp } from '../hooks/use-active-context';

/**
 * For brand-only frontends (links, reviews, payments): the active context is
 * persisted server-side (auth.switchContext → role + selectedBrandId/AgencyId)
 * and shared across ALL frontends, so a user can land here with an AGENCY
 * context selected from another app. These frontends only operate inside a
 * brand context, so instead of dead-ending on "no brand selected", persist a
 * switch into the user's first brand via auth.switchContext — the same
 * DB-persisting flow every context selector uses. Mirrors the dashboard
 * suite's arrival switch (useSuiteContext).
 *
 * `appPermissions` — for a tool gated by brand permission(s), pass its keys
 * (e.g. ['links','linksViewer']). The hook then also re-selects when the
 * currently-selected brand is no longer usable in THIS frontend — a staffer
 * whose tool permission was revoked, who arrives with that brand still selected
 * from another app — switching them into their first still-accessible brand and
 * persisting it. This keeps the server-side selection (and auth.me permissions)
 * in step with what useActiveContext({ appPermissions }) shows. When no brand
 * qualifies, nothing is switched — the app's create-brand empty state handles it.
 *
 * Fires once per mount; clears its guard on failure so a later load can retry.
 * Users with no brand at all are left alone — the app's empty state (or
 * onboarding) handles them.
 *
 * Call once near the top of App, alongside useAutoSelectContext.
 */
export function useEnsureBrandContext(opts?: { appPermissions?: string[] }): void {
  const appPermissions = opts?.appPermissions;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: user } = useCurrentUser();
  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());
  const switchedRef = useRef(false);

  const isBrandContext = user?.role === 'brandOwner' || user?.role === 'brandStaff';
  // Cases we must resolve: arriving in a non-brand context (a brand-only app can't
  // operate there), OR a permission-gated app whose selected brand no longer
  // qualifies (tool permission revoked). Both need brands.mine — useActiveContext
  // only fetches it in a brand context, and only the filtered view.
  const needsResolve = (!!user?.role && !isBrandContext) || (isBrandContext && !!appPermissions);
  const { data: brands } = useQuery({
    ...trpc.brands.mine.queryOptions(),
    enabled: !!user && needsResolve,
  });

  const selected = brands?.find((b) => b.id === user?.selectedBrandId) ?? null;
  const selectedAllowed = !!selected && brandAllowedByApp(selected, appPermissions);
  // Prefer keeping the selected brand when this frontend can use it; otherwise the
  // first brand it can access (owner, or holding one of appPermissions).
  const targetBrandId = selectedAllowed
    ? (selected?.id ?? null)
    : (brands?.find((b) => brandAllowedByApp(b, appPermissions))?.id ?? null);

  useEffect(() => {
    if (switchedRef.current || !user || !needsResolve || !targetBrandId) return;
    // In a brand context already on a usable brand → nothing to persist. (In an
    // agency context we still switch to adopt the brand role, as before.)
    if (isBrandContext && selectedAllowed && targetBrandId === user.selectedBrandId)
      return;
    switchedRef.current = true;
    switchCtx.mutate(
      { type: 'brand', entityId: targetBrandId },
      {
        onSuccess: () => qc.invalidateQueries(),
        onError: () => {
          switchedRef.current = false;
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, needsResolve, targetBrandId, selectedAllowed]);
}
