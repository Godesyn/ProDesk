import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useActiveContext } from '../hooks/use-active-context';
import { useTRPC } from '../lib/trpc';
import { DEFAULT_ACCENT_HEX } from '../lib/accent-swatches';
import { applyAccentVars, readStoredAccent, storeAccent } from '../lib/theme-accent';
import { getSubdomain } from '../lib/subdomain';

/**
 * `setPreviewAccent(hex)` re-themes the whole app immediately, without
 * persisting; `setPreviewAccent(null)` clears the preview and reverts to the
 * resolved tenant theme. The raw state setter is exposed (stable identity) so
 * consumers can use it in effect deps safely.
 */
const PreviewCtx = createContext<(hex: string | null) => void>(() => {});

export function useAccentTheme() {
  return useContext(PreviewCtx);
}

/** Read uiPreferences.accentColor off an agency row, or null when unset. */
function accentOf(agency: { uiPreferences?: unknown } | null | undefined): string | null {
  const ui = agency?.uiPreferences as { accentColor?: unknown } | undefined;
  return typeof ui?.accentColor === 'string' && ui.accentColor ? ui.accentColor : null;
}

/**
 * Drives the global accent palette, porting the Flutter tenantAgencyProvider +
 * ThemeAccentNotifier resolution. The theme is always an agency's:
 *
 *   1. If the active context IS an agency (agencyOwner/agencyStaff) → that
 *      agency's accent.
 *   2. Otherwise → the tenant subdomain's agency. In production the user lands
 *      on that subdomain; in dev a `?subdomain=` param stands in. This agency
 *      equals the user's referredByAgency, so when no subdomain is present we
 *      fall back to resolving referredByAgencyId from the user record.
 *   3. If none of the above → the Forest default.
 *
 * A transient live `previewAccent` (set by the branding picker) overrides the
 * resolved value; clearing it reverts to the resolved tenant theme.
 */
export function AccentThemeProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const { workspace, activeAgency, user, loading } = useActiveContext();
  const [previewAccent, setPreviewAccent] = useState<string | null>(null);

  // Active-context agency theme (rule 1).
  const agencyContextAccent = workspace === 'agency' ? accentOf(activeAgency) : null;

  // Tenant subdomain agency (rule 2, live from the URL). byUsername is public,
  // so this themes the login/signup screens of a tenant site too.
  const subdomain = getSubdomain();
  const subdomainAgency = useQuery({
    ...trpc.agencies.byUsername.queryOptions({ username: subdomain ?? '' }),
    enabled: !agencyContextAccent && !!subdomain,
  });

  // referredByAgency fallback (rule 2, from the user record when off-subdomain).
  const referredById = user?.referredByAgencyId ?? null;
  const referredAgency = useQuery({
    ...trpc.agencies.byId.queryOptions({ id: referredById ?? '' }),
    enabled: !agencyContextAccent && !subdomain && !!referredById,
  });

  const tenantAccent =
    agencyContextAccent ?? accentOf(subdomainAgency.data) ?? accentOf(referredAgency.data) ?? null;

  // Has resolution finished down the active path? Only once we KNOW the answer
  // do we trust `tenantAccent ?? default`. Until then we bridge with the cached
  // color. Precedence mirrors the resolution chain so a path that's disabled
  // (e.g. referred query off because we have a subdomain) never blocks us.
  let resolved: boolean;
  if (!user || loading) resolved = false; // auth/membership still loading
  else if (agencyContextAccent !== null) resolved = true; // active agency themed
  else if (subdomain) resolved = subdomainAgency.isFetched; // waiting on subdomain agency
  else if (referredById) resolved = referredAgency.isFetched; // waiting on referred agency
  else resolved = true; // no agency/subdomain/referrer → genuine Forest default

  // Once resolved, honor the real answer (including "no theme → default"); only
  // while still loading do we bridge with the cached color to avoid a flash.
  const fallback = resolved ? DEFAULT_ACCENT_HEX : readStoredAccent() ?? DEFAULT_ACCENT_HEX;
  const effective = previewAccent ?? tenantAccent ?? fallback;

  useEffect(() => {
    applyAccentVars(effective);
  }, [effective]);

  // Cache the resolved theme for the next cold load — including the default,
  // so switching to an unthemed context (brand with no referral) overwrites a
  // stale brown with Forest. Gated on `resolved` so we never persist mid-load,
  // and skipped during transient previews (the branding picker).
  useEffect(() => {
    if (previewAccent !== null || !resolved) return;
    storeAccent(tenantAccent ?? DEFAULT_ACCENT_HEX);
  }, [previewAccent, resolved, tenantAccent]);

  return <PreviewCtx.Provider value={setPreviewAccent}>{children}</PreviewCtx.Provider>;
}
