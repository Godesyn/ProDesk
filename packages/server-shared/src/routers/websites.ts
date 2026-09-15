/**
 * Websites tRPC router (trpc.websites.*). Scaffold for the brand-only Websites
 * frontend (clients/websites). Every procedure is brand-scoped: the client passes
 * the active `brandId` (from useActiveContext) and we gate with `assertBrandAccess`
 * (brand owner or active staff; super-admin always passes).
 *
 * Websites has no dedicated staff permission YET, so the gate admits any brand
 * member. When it gets a `websites`/`websitesViewer` permission, pass it as the
 * 3rd arg (`assertBrandAccess(ctx, brandId, 'websites')`) / use
 * `assertBrandAccessAny`. There is no Websites data model yet; `overview` just
 * proves the namespace is wired. Grow this router (and add DB tables) as the
 * product is built. Mirror routers/signatures.ts.
 */
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc/trpc.js';
import { assertBrandAccess } from '../trpc/permissions.js';

export const websitesRouter = router({
  /** Starter endpoint — confirms the trpc.websites.* namespace resolves and the
   *  caller has access to the given brand. */
  overview: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { isOwner } = await assertBrandAccess(ctx, input.brandId);
      return { ok: true as const, brandId: input.brandId, isOwner };
    }),
});
