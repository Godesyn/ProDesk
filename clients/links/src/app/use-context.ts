import { useActiveContext } from '@shared/hooks/use-active-context';

/**
 * Brand permissions that gate the Links & QR frontend. A staff member sees a
 * brand here only when they hold one of these for it (owners always qualify):
 * `links` = editor, `linksViewer` = read-only. Mirrors the server gate
 * (assertBrandAccess 'links' / assertBrandAccessAny ['links','linksViewer']).
 */
export const LINKS_BRAND_PERMISSIONS = ['links', 'linksViewer'];

/**
 * Links-scoped active context — `useActiveContext` filtered to the brands this
 * frontend can actually use. The BrandSwitcher never lists a brand the staffer
 * has no Links access to, and when their access to the selected brand is revoked,
 * `brandId`/`activeBrand` fall back to the first still-accessible brand (or null
 * → the create-brand empty state). Pair with `useEnsureBrandContext` in App.tsx,
 * which persists that fallback server-side.
 */
export function useLinksContext() {
  return useActiveContext({ appPermissions: LINKS_BRAND_PERMISSIONS });
}
