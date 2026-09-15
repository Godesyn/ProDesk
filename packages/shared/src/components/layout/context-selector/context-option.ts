import type { UserRole } from '../sidebar';

/**
 * A switchable context shown in the context selector — 1:1 port of the Flutter
 * ContextOption model (lib/src/shared/components/context_selector/context_option.dart).
 * Produced server-side by `auth.contextOptions`; consumed by `auth.switchContext`.
 */
export type ContextOptionType = 'admin' | 'agency' | 'brand' | 'contractor';

export interface ContextOption {
  id: string;
  label: string;
  role: UserRole;
  entityId: string | null;
  type: ContextOptionType;
  logoUrl: string | null;
  isDisabled: boolean;
  status: 'pending' | 'deleted' | null;
  /**
   * The caller's granular staff permissions for this context. Present for STAFF
   * options only (owner/admin/contractor bypass permission checks → omitted).
   * A brand-only frontend passes its tool permission(s) to the ContextSelector as
   * `appPermissions` to hide brand options where the staffer holds none of them.
   */
  permissions?: string[];
}

/**
 * Whether a context option should be shown in a frontend gated by `appPermissions`
 * (a brand-only tool's permission keys, e.g. ['links','linksViewer']). Non-brand
 * options and owned brands always qualify (owners bypass permission checks); a
 * brand-staff option qualifies only when it holds at least one of `appPermissions`.
 * With no `appPermissions` (multi-tool frontend), everything qualifies.
 */
export function optionAllowedByApp(o: ContextOption, appPermissions?: string[]): boolean {
  if (!appPermissions || appPermissions.length === 0) return true;
  if (o.type !== 'brand' || o.role === 'brandOwner') return true;
  return (o.permissions ?? []).some((p) => appPermissions.includes(p));
}

/** Section header label per type (mirrors ContextDropdownItems header logic). */
export function sectionLabel(type: ContextOptionType): string {
  switch (type) {
    case 'agency':
      return 'AGENCIES';
    case 'brand':
      return 'BRANDS';
    case 'admin':
      return 'ADMIN';
    case 'contractor':
      return 'CONTRACTOR';
  }
}
