import { useActiveContext } from '@shared/hooks/use-active-context';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Brand permissions that gate the Logo frontend. Logo is brand-only (like
 * Links/Reviews). The `logo` staff permission (migration 0074) is the single
 * MANAGE key; brand owners always pass. Staff without it don't see the app.
 * Mirror clients/signatures `context.ts`.
 */
export const LOGO_BRAND_PERMISSIONS = ['logo'];

/** Logo-scoped active context (see clients/links useLinksContext). */
export function useLogoContext() {
  return useActiveContext({ appPermissions: LOGO_BRAND_PERMISSIONS });
}

/** The active Prodesk brand (tenant) id, or null while none is selected. */
export function useActiveBrandId(): string | null {
  return useLogoContext().brandId;
}

/** Can the current user edit (owner or holds the `logo` permission)? */
export function useCanEditLogo(): boolean {
  const { data: user } = useCurrentUser();
  const permissions: string[] = user?.permissions ?? [];
  return user?.role === 'brandOwner' || permissions.includes('logo');
}
