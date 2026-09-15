/**
 * Jobs tRPC router (trpc.jobs.*). Scaffold for the multi-role Jobs frontend
 * (clients/jobs) — any authenticated identity (agency, brand, contractor,
 * admin) may call it, so procedures use `protectedProcedure` with no brand/agency
 * gate. There is no Jobs data model yet; `overview` just proves the namespace is
 * wired end-to-end. Grow this router (and add DB tables) as the product is built.
 */
import { protectedProcedure, router } from '../trpc/trpc.js';

export const jobsRouter = router({
  /** Starter endpoint — confirms the trpc.jobs.* namespace resolves for the
   *  signed-in user. Reflects the caller's identity/active context. */
  overview: protectedProcedure.query(({ ctx }) => ({
    ok: true as const,
    userId: ctx.user.id,
    role: ctx.user.role,
    selectedAgencyId: ctx.user.selectedAgencyId,
    selectedBrandId: ctx.user.selectedBrandId,
  })),
});
