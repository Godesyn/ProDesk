import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { useCurrentUser } from '../auth/auth-context';

export type Workspace = 'agency' | 'brand' | 'contractor' | 'admin';

/**
 * Whether the caller may see a brand in a frontend gated by `appPermissions`
 * (a brand-only tool's permission keys, e.g. ['links','linksViewer']). Owners
 * always qualify (they bypass permission checks); a staffer qualifies only when
 * they hold at least one of `appPermissions` for that brand. `isOwner` and
 * `permissions` are supplied per brand by `brands.mine`.
 */
export function brandAllowedByApp(
  b: { isOwner?: boolean | null; permissions?: string[] | null },
  appPermissions?: string[],
): boolean {
  if (!appPermissions || appPermissions.length === 0) return true;
  return b.isOwner === true || (b.permissions ?? []).some((p) => appPermissions.includes(p));
}

/**
 * Resolves which organization the user is currently acting as.
 * Agency/brand workspaces fall back to the user's first membership when no
 * explicit selection is stored yet.
 *
 * `appPermissions` — for a brand-only frontend, the tool permission(s) that gate
 * it. When passed, the returned `brands` list is filtered to brands where the
 * caller is the owner OR holds at least one of those permissions, and
 * `brandId`/`activeBrand` are resolved against that filtered list. So a staffer
 * whose tool permission for the selected brand is revoked falls back to their
 * first still-accessible brand (and to null — the app's create-brand empty state —
 * when none remain). Pair with `useEnsureBrandContext({ appPermissions })`, which
 * persists that fallback server-side.
 */
export function useActiveContext(opts?: { appPermissions?: string[] }) {
  const appPermissions = opts?.appPermissions;
  const { data: user } = useCurrentUser();
  const trpc = useTRPC();
  const role = user?.role ?? undefined;

  const isAgency = role === 'agencyOwner' || role === 'agencyStaff';
  const isBrand = role === 'brandOwner' || role === 'brandStaff';
  const isContractor = role === 'individualContractor';

  const agencies = useQuery({ ...trpc.agencies.mine.queryOptions(), enabled: isAgency });
  const brands = useQuery({ ...trpc.brands.mine.queryOptions(), enabled: isBrand });

  const allBrands = brands.data ?? [];
  const visibleBrands = appPermissions
    ? allBrands.filter((b) => brandAllowedByApp(b, appPermissions))
    : allBrands;

  const agencyId = isAgency ? (user?.selectedAgencyId ?? agencies.data?.[0]?.id ?? null) : null;
  // Keep the server-selected brand only when it's still visible in THIS frontend;
  // otherwise fall back to the first accessible brand (or null → create-brand state).
  const brandId = isBrand
    ? (visibleBrands.some((b) => b.id === user?.selectedBrandId)
        ? (user?.selectedBrandId ?? null)
        : (visibleBrands[0]?.id ?? null))
    : null;

  const workspace: Workspace = user?.isSuperAdmin
    ? 'admin'
    : isAgency
      ? 'agency'
      : isBrand
        ? 'brand'
        : 'contractor';

  return {
    user,
    role,
    workspace,
    agencyId,
    brandId,
    isContractor,
    agencies: agencies.data ?? [],
    brands: visibleBrands,
    activeAgency: agencies.data?.find((a) => a.id === agencyId) ?? agencies.data?.[0] ?? null,
    activeBrand: visibleBrands.find((b) => b.id === brandId) ?? visibleBrands[0] ?? null,
    loading: agencies.isLoading || brands.isLoading,
  };
}
