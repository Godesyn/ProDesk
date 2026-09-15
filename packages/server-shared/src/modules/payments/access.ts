/**
 * Payments (EziQuotes) — brand access gates. The tool is brand-scoped: staff
 * hold `payments` (editor) or `paymentsViewer` (read-only) permissions; owners
 * and super-admins always pass (see trpc/permissions.ts).
 */
import type { Context } from '../../trpc/context.js';
import { assertBrandAccess, assertBrandAccessAny } from '../../trpc/permissions.js';

/** Reads are allowed for both editors and read-only viewers. */
export async function requirePaymentRead(
  ctx: Context,
  brandId: string,
): Promise<{ isOwner: boolean }> {
  return assertBrandAccessAny(ctx, brandId, ['payments', 'paymentsViewer']);
}

/** Writes require the `payments` (editor) permission. */
export async function requirePaymentWrite(
  ctx: Context,
  brandId: string,
): Promise<{ isOwner: boolean }> {
  return assertBrandAccess(ctx, brandId, 'payments');
}
