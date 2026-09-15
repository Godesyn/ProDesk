/**
 * Payments (EziQuotes) — proposal revision history, ported from
 * server/routers/revisions.ts: snapshots on update, version listing, and
 * revert (which auto-saves the current state first). Procedures are
 * proposal-scoped: the proposal row is loaded and access is gated on its
 * brandId. NOTE: the export's inserts passed accountId/changeNote fields that
 * do not exist on the revisions table (drizzle silently dropped them at
 * runtime) — the ported table matches the real columns, and `changeNote`
 * remains accepted in the input for shape parity but is not persisted.
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { paymentProposalRevisions, proposals } from '../../db/schema.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';

/** Load a proposal row by id (tenancy is asserted by the caller from row.brandId). */
async function loadProposal(proposalId: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
  // Payer proposals always carry the vendor brandId — narrow for the callers.
  return { ...proposal, brandId: proposal.brandId! };
}

/** Next revision number for a proposal (max existing version + 1). */
async function nextVersionFor(proposalId: string): Promise<number> {
  const existing = await db
    .select({ version: paymentProposalRevisions.version })
    .from(paymentProposalRevisions)
    .where(eq(paymentProposalRevisions.proposalId, proposalId))
    .orderBy(desc(paymentProposalRevisions.version))
    .limit(1);
  return existing.length > 0 ? existing[0].version + 1 : 1;
}

export const revisionsRouter = router({
  // List all revisions for a proposal
  list: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const proposal = await loadProposal(input.proposalId);
      await requirePaymentRead(ctx, proposal.brandId);

      const revisions = await db
        .select()
        .from(paymentProposalRevisions)
        .where(eq(paymentProposalRevisions.proposalId, input.proposalId))
        .orderBy(desc(paymentProposalRevisions.version));

      return revisions;
    }),

  // Save a new revision snapshot (called internally on proposal update)
  save: protectedProcedure
    .input(z.object({
      proposalId: z.string().uuid(),
      changeNote: z.string().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(input.proposalId);
      await requirePaymentWrite(ctx, proposal.brandId);

      const nextVersion = await nextVersionFor(input.proposalId);

      await db.insert(paymentProposalRevisions).values({
        proposalId: input.proposalId,
        version: nextVersion,
        title: proposal.title,
        structure: proposal.structure as Record<string, unknown>,
        totalCents: proposal.totalCents ?? 0,
        createdByUserId: ctx.user.id,
      });

      return { version: nextVersion };
    }),

  // Revert proposal to a specific revision
  revert: protectedProcedure
    .input(z.object({
      proposalId: z.string().uuid(),
      revisionId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await loadProposal(input.proposalId);
      await requirePaymentWrite(ctx, proposal.brandId);

      // Fetch the target revision
      const [revision] = await db
        .select()
        .from(paymentProposalRevisions)
        .where(
          and(
            eq(paymentProposalRevisions.id, input.revisionId),
            eq(paymentProposalRevisions.proposalId, input.proposalId),
          ),
        )
        .limit(1);

      if (!revision) throw new TRPCError({ code: 'NOT_FOUND', message: 'Revision not found' });

      // Save current state as a new revision before reverting
      const nextVersion = await nextVersionFor(input.proposalId);

      await db.insert(paymentProposalRevisions).values({
        proposalId: input.proposalId,
        version: nextVersion,
        title: proposal.title,
        structure: proposal.structure as Record<string, unknown>,
        totalCents: proposal.totalCents ?? 0,
        createdByUserId: ctx.user.id,
      });

      // Apply the revision to the proposal
      await db
        .update(proposals)
        .set({
          title: revision.title ?? proposal.title,
          structure: revision.structure as Record<string, unknown>,
          totalCents: revision.totalCents,
          updatedAt: new Date(),
        })
        .where(eq(proposals.id, input.proposalId));

      return { revertedToVersion: revision.version, savedVersion: nextVersion };
    }),
});
