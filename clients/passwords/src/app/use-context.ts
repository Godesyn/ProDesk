import { useActiveContext } from '@shared/hooks/use-active-context';
import { useCurrentUser } from '@shared/auth/auth-context';

/**
 * Brand permissions that gate KEYMASTR. The Links/Reviews split: `passwords`
 * manages (create, share, reveal, rotate), `passwordsViewer` reads and copies
 * but never reveals or shares. Brand owners always pass.
 *
 * Both keys still need adding to the Postgres `staff_permission` enum, the
 * `PERMISSIONS` allow-list in routers/staff.ts, and the labels + per-frontend
 * group in packages/shared/src/pages/agency/constants.ts — see DESIGN.md §7.
 */
export const PASSWORDS_BRAND_PERMISSIONS = ['passwords', 'passwordsViewer'];

/**
 * KEYMASTR-scoped active context.
 *
 * NOTE this app is USER-LEVEL, not brand-scoped (see DESIGN.md §4): there is no
 * brand switcher in the panel, because the cross-brand screens — Access map,
 * Watchtower, Offboarding — are the whole point and a switcher would make them
 * impossible to build. The context is still read here for the brand LIST and the
 * user's permissions per brand; scoping lives in the content, not the chrome.
 */
export function usePasswordsContext() {
  return useActiveContext({ appPermissions: PASSWORDS_BRAND_PERMISSIONS });
}

/** Can the current user manage keys (owner or holds `passwords`)? */
export function useCanManage(): boolean {
  const { data: user } = useCurrentUser();
  const permissions: string[] = user?.permissions ?? [];
  return user?.role === 'brandOwner' || permissions.includes('passwords');
}
