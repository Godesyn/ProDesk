/**
 * Design tRPC router (trpc.design.*). Scaffold for the user-level Design frontend
 * (clients/design). Like Signatures, Design runs inside a brand context but its
 * experience is user-centric and fans across all the user's brands — so the
 * starter endpoint is `protectedProcedure` (per-user, no single-brand gate).
 * Brand-scoped procedures added later should take a `brandId` and call
 * `assertBrandAccess`. There is no Design data model yet; `overview` just proves
 * the namespace is wired. Grow this router (and add DB tables) as the product is
 * built.
 */
import { protectedProcedure, router } from '../trpc/trpc.js';

export const designRouter = router({
  /** Starter endpoint — confirms the trpc.design.* namespace resolves for the
   *  signed-in user. */
  overview: protectedProcedure.query(({ ctx }) => ({
    ok: true as const,
    userId: ctx.user.id,
    role: ctx.user.role,
  })),
});
