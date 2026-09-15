import { useTRPC } from '@shared/lib/trpc';
import { useActiveContext } from '@shared/hooks/use-active-context';

/** Platform tRPC client — payments procedures live under `trpc.payments.*`. */
export function usePaymentsTrpc() {
  return useTRPC();
}

/**
 * Brand permissions that gate the Payments (EziQuotes) frontend. A staff member
 * sees a brand here only when they hold one of these for it (owners always
 * qualify): `payments` = editor, `paymentsViewer` = read-only. Mirrors the server
 * gate (assertBrandAccess 'payments' / assertBrandAccessAny ['payments','paymentsViewer']).
 */
export const PAYMENTS_BRAND_PERMISSIONS = ['payments', 'paymentsViewer'];

/**
 * Payments-scoped active context — `useActiveContext` filtered to the brands this
 * frontend can actually use. The BrandSwitcher never lists a brand the staffer
 * has no Payments access to, and when their access to the selected brand is
 * revoked, `brandId`/`activeBrand` fall back to the first still-accessible brand
 * (or null → the create-brand empty state). Pair with `useEnsureBrandContext` in
 * App.tsx, which persists that fallback server-side.
 */
export function usePaymentsContext() {
  return useActiveContext({ appPermissions: PAYMENTS_BRAND_PERMISSIONS });
}

/** Active brand id for tenant-scoped procedure inputs. Null until context resolves.
 * Uses the canonical brandId (server-persisted selectedBrandId, first-brand
 * fallback) — filtered to brands with Payments access. */
export function useBrandId(): string | null {
  const { brandId } = usePaymentsContext();
  return brandId;
}
