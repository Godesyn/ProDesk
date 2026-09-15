/* Prodesk Suite — live data layer.
   Maps the brand-scoped tRPC backend onto the suite's view shapes and exposes a
   single hook (useSuiteContext) the shell consumes. This client is brand-only:
   switching brand goes through auth.switchContext (the same DB-persisting flow the
   prodesk context selector uses — sets role + selected brand, clears any agency),
   and if the user lands here with an AGENCY context selected we auto-switch them
   into the first brand they have. */

import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useCurrentUser } from '@shared/auth/auth-context';
import type { RouterOutputs } from '@server/trpc/router';
import type { Brand, Vendor } from './data';

type BrandRow = RouterOutputs['brands']['mine'][number];
type UserMe = NonNullable<RouterOutputs['auth']['me']>;

/* A small, stable palette so brands without a set colour still differ visibly. */
const FALLBACK_COLOURS = [
  '#1f6f54',
  '#2d4f6b',
  '#7a4a22',
  '#5a1f2b',
  '#33424a',
  '#3c5a2e',
  '#5b2a3e',
  '#9a3b2e',
];
function colourFor(id: string, set?: string[] | null): string {
  const c = set?.find((x) => typeof x === 'string' && x.startsWith('#'));
  if (c) return c;
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLOURS[h % FALLBACK_COLOURS.length];
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?'
  );
}

export function mapBrandRow(row: BrandRow): Brand {
  const name = row.businessName || 'Untitled brand';
  return {
    id: row.id,
    name,
    mono: initials(name),
    shape: 'rich',
    type: row.industry || 'Brand',
    colour: colourFor(row.id, row.colors as string[] | null | undefined),
    status: {},
    logo: row.logoUrl ?? undefined,
    chatbotThreadId: row.chatbotThreadId ?? null,
    derivedAgencyId: row.derivedToAgencyId ?? null,
  };
}

export function vendorFromUser(user: UserMe | null | undefined): Vendor {
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() ||
    user?.email ||
    'You';
  return {
    name,
    initials: initials(name),
    email: user?.email || '',
    plan: 'Brand account',
    team: 0,
    profileUrl: user?.profileUrl ?? undefined,
  };
}

export interface SuiteContext {
  user: UserMe | null;
  vendor: Vendor;
  brands: Brand[];
  activeBrand: Brand | null;
  activeBrandId: string | null;
  loading: boolean;
  hasNoBrand: boolean;
  setActiveBrand: (id: string) => void;
  createBrand: (name: string, type: string) => void;
}

export function useSuiteContext(): SuiteContext {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: user, isLoading: userLoading } = useCurrentUser();

  const brandsQ = useQuery(trpc.brands.mine.queryOptions());
  const mine = brandsQ.data ?? [];

  // brandStaff may not appear in userBrands; fall back to the selected brand by id.
  const selectedId = user?.selectedBrandId ?? null;
  const needFallback = !!selectedId && !mine.some((b) => b.id === selectedId);
  const fallbackQ = useQuery({
    ...trpc.brands.byId.queryOptions({ id: selectedId ?? '' }),
    enabled: needFallback,
  });

  const rawBrands = useMemo<BrandRow[]>(() => {
    if (needFallback && fallbackQ.data)
      return [fallbackQ.data as BrandRow, ...mine];
    return mine;
  }, [mine, needFallback, fallbackQ.data]);

  const brands = useMemo(() => rawBrands.map(mapBrandRow), [rawBrands]);
  const activeBrandId = selectedId ?? brands[0]?.id ?? null;
  const activeBrand =
    brands.find((b) => b.id === activeBrandId) ?? brands[0] ?? null;
  const vendor = vendorFromUser(user);

  // auth.switchContext is the canonical context switch: it verifies membership,
  // sets role (brandOwner/brandStaff), selectedBrandId, and clears selectedAgencyId.
  // Switching context changes role-scoped data everywhere, so we invalidate broadly
  // (matching the prodesk ContextSelector).
  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());
  const createBrandM = useMutation(trpc.brands.create.mutationOptions());

  const setActiveBrand = (id: string) => {
    switchCtx.mutate(
      { type: 'brand', entityId: id },
      { onSuccess: () => qc.invalidateQueries() },
    );
  };

  // Note: brands.create only takes businessName here; the optional "what it does"
  // text from the dialog isn't a create field, so it's ignored (set later in Brand kit).
  const createBrand = (name: string, _type: string) => {
    void _type;
    createBrandM.mutate(
      { businessName: name },
      {
        onSuccess: async (created: { id: string }) => {
          await qc.invalidateQueries({ queryKey: trpc.brands.mine.queryKey() });
          switchCtx.mutate(
            { type: 'brand', entityId: created.id },
            { onSuccess: () => qc.invalidateQueries() },
          );
        },
      },
    );
  };

  // The dashboard is brand-only, but the user may arrive with an AGENCY context
  // selected (role agencyOwner/agencyStaff). In that case persist a switch into the
  // first brand the user has, so role + selectedBrandId match what this app needs.
  // Fires once; clears its guard on failure so a later load can retry.
  const inBrandContext =
    user?.role === 'brandOwner' || user?.role === 'brandStaff';
  const isAgencyContext =
    user?.role === 'agencyOwner' || user?.role === 'agencyStaff';
  const firstUserBrandId = mine[0]?.id ?? null;
  const switchedRef = useRef(false);
  useEffect(() => {
    if (switchedRef.current) return;
    if (!user || inBrandContext || !isAgencyContext) return;
    if (!firstUserBrandId) return; // no brand to switch into → hasNoBrand UI handles it
    switchedRef.current = true;
    switchCtx.mutate(
      { type: 'brand', entityId: firstUserBrandId },
      {
        onSuccess: () => qc.invalidateQueries(),
        onError: () => {
          switchedRef.current = false;
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, inBrandContext, isAgencyContext, firstUserBrandId]);

  const loading =
    userLoading || brandsQ.isLoading || (needFallback && fallbackQ.isLoading);

  return {
    user: user ?? null,
    vendor,
    brands,
    activeBrand,
    activeBrandId,
    loading,
    hasNoBrand: !loading && brands.length === 0,
    setActiveBrand,
    createBrand,
  };
}
