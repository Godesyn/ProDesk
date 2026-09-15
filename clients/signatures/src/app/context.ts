import { useActiveContext } from '@shared/hooks/use-active-context';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Brand permissions that gate the Email Signatures (SIGKITT) frontend. A staff
 * member sees a brand here only when they hold this for it (owners always
 * qualify): `signatures` is manage-only — there is no viewer role. Mirrors the
 * server gate (assertBrandAccess 'signatures').
 */
export const SIGNATURES_BRAND_PERMISSIONS = ['signatures'];

/**
 * Signatures-scoped active context — `useActiveContext` filtered to the brands
 * this frontend can actually use. The switcher never lists a brand the staffer
 * has no Signatures access to, and when their access to the selected brand is
 * revoked, `brandId`/`activeBrand` fall back to the first still-accessible brand
 * (or null → the create-brand empty state). Pair with `useEnsureBrandContext` in
 * App.tsx, which persists that fallback server-side.
 */
export function useSignaturesContext() {
  return useActiveContext({ appPermissions: SIGNATURES_BRAND_PERMISSIONS });
}

/** The active Prodesk brand (tenant) id, or null while none is selected. */
export function useActiveBrandId(): string | null {
  return useSignaturesContext().brandId;
}

/**
 * Every Prodesk brand the caller owns or is `signatures`-staff of. Signatures is a
 * USER-LEVEL app: screens fan out over this list rather than pinning to the single
 * active-context brand (`useActiveBrandId`). Each entry carries `isOwner` +
 * `permissions`. Signature brands are 1:1 with a Prodesk brand, so this IS the
 * real brand list.
 */
export function useSignatureBrands() {
  return useSignaturesContext().brands;
}

/**
 * The subset of {@link useSignatureBrands} the caller OWNS. Billing is owner-scoped
 * (one signatures subscription per owner, keyed by userId), so the Billing screen
 * resolves via an owned brand instead of the active brand.
 */
export function useOwnedSignatureBrands() {
  return useSignaturesContext().brands.filter((b) => b.isOwner);
}

/**
 * Whether the current user may edit signatures. Mirrors the server gate
 * (`assertBrandAccess(ctx, brandId, 'signatures')`): the brand owner always
 * edits; staff need the `signatures` permission — the tool's single MANAGE
 * role (signatures has no viewer permission).
 */
export function useCanEditSignatures(): boolean {
  const { data: user } = useCurrentUser();
  const permissions: string[] = user?.permissions ?? [];
  return user?.role === 'brandOwner' || permissions.includes('signatures');
}
