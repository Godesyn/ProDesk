import { useActiveContext } from '@shared/hooks/use-active-context';

/**
 * Brand permissions that gate the Websites frontend. Websites is brand-only
 * (like Links/Reviews), but has no dedicated tool permission YET — so the list
 * is empty, which means no per-brand filtering: every brand the user belongs to
 * (owner or staff) shows in the switcher.
 *
 * When Websites gets its own backend + a `websites`/`websitesViewer` staff
 * permission, add those keys here (e.g. `['websites', 'websitesViewer']`) — the
 * switcher, `useEnsureBrandContext`, and the scoped Team panel will then all gate
 * on them together. Mirror clients/links `use-context.ts`.
 */
export const WEBSITES_BRAND_PERMISSIONS: string[] = [];

/** Websites-scoped active context (see clients/links useLinksContext). */
export function useWebsitesContext() {
  return useActiveContext({ appPermissions: WEBSITES_BRAND_PERMISSIONS });
}
