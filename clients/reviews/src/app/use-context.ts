import { useActiveContext } from '@shared/hooks/use-active-context';

/**
 * Brand permissions that gate the Reviews (Verdiict) frontend. A staff member
 * sees a brand here only when they hold one of these for it (owners always
 * qualify): `reviews` = editor, `reviewsViewer` = read-only. Mirrors the server
 * gate (assertBrandAccess 'reviews' / assertBrandAccessAny ['reviews','reviewsViewer']).
 */
export const REVIEWS_BRAND_PERMISSIONS = ['reviews', 'reviewsViewer'];

/**
 * Reviews-scoped active context — `useActiveContext` filtered to the brands this
 * frontend can actually use. The BrandSwitcher never lists a brand the staffer
 * has no Reviews access to, and when their access to the selected brand is
 * revoked, `brandId`/`activeBrand` fall back to the first still-accessible brand
 * (or null → the create-brand empty state). Pair with `useEnsureBrandContext` in
 * App.tsx, which persists that fallback server-side.
 */
export function useReviewsContext() {
  return useActiveContext({ appPermissions: REVIEWS_BRAND_PERMISSIONS });
}
