/**
 * Payments (EziQuotes) — proposal annotations (client change requests), ported
 * from server/routers/annotations.ts. `add`/`listPublic` are public
 * slug-scoped surfaces; owner procedures resolve the proposal row and gate on
 * its brandId. The Manus Forge `notifyOwner` push is replaced by an email to
 * the payment account's address via the payments email module (fire-safe:
 * failures never block the client's submission, matching the export).
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { paymentProposalAnnotations, proposals } from '../../db/schema.js';
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { getPaymentAccount, getProposalBySlug } from '../../modules/payments/db.js';
import { sendEmail } from '../../modules/payments/email.js';

/** Load a proposal row by id (tenancy is asserted by the caller from row.brandId). */
async function loadProposal(proposalId: string) {
  const [proposal] = await db
    .select()
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  // Payer proposals always carry the vendor brandId — narrow for the callers.
  return proposal ? { ...proposal, brandId: proposal.brandId! } : undefined;
}

/** Load an annotation + its proposal, asserting the caller can write to the brand. */
async function loadAnnotationForWrite(ctx: Parameters<typeof requirePaymentWrite>[0], id: string) {
  const [annotation] = await db
    .select()
    .from(paymentProposalAnnotations)
    .where(eq(paymentProposalAnnotations.id, id))
    .limit(1);
  if (!annotation) throw new TRPCError({ code: 'NOT_FOUND' });
  const proposal = await loadProposal(annotation.proposalId);
  if (!proposal) throw new TRPCError({ code: 'FORBIDDEN' });
  await requirePaymentWrite(ctx, proposal.brandId);
  return annotation;
}

export const annotationsRouter = router({
  // Public — client submits an annotation/change request on a proposal
  add: publicProcedure
    .input(z.object({
      slug: z.string(),
      blockId: z.string().optional(),
      anchorText: z.string().max(500).optional(),
      comment: z.string().min(1).max(2000),
      clientName: z.string().max(255).optional(),
      clientEmail: z.string().email().max(255).optional(),
    }))
    .mutation(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await db.insert(paymentProposalAnnotations).values({
        proposalId: proposal.id,
        blockId: input.blockId ?? null,
        anchorText: input.anchorText ?? null,
        comment: input.comment,
        clientName: input.clientName ?? null,
        clientEmail: input.clientEmail ?? null,
        status: 'open',
      });
      // Notify the vendor (replaces the Manus Forge owner notification).
      try {
        const account = await getPaymentAccount(proposal.brandId);
        if (account?.email) {
          const snippet = `${input.comment.slice(0, 120)}${input.comment.length > 120 ? '…' : ''}`;
          const content = `${input.clientName ?? 'A client'} left a comment on "${proposal.title ?? proposal.slug}": "${snippet}"`;
          await sendEmail({
            to: account.email,
            subject: 'New change request on proposal',
            htmlBody: `<p>${content}</p>`,
            textBody: content,
          });
        }
      } catch (err) {
        console.warn('[annotations.add] Failed to notify vendor:', err);
      }
      return { success: true };
    }),

  // Public — list open annotations for a proposal (client can see their own)
  listPublic: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const proposal = await getProposalBySlug(input.slug);
      if (!proposal) return [];
      return db
        .select()
        .from(paymentProposalAnnotations)
        .where(eq(paymentProposalAnnotations.proposalId, proposal.id));
    }),

  // Protected — owner lists all annotations for a proposal
  list: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const proposal = await loadProposal(input.proposalId);
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, proposal.brandId);
      return db
        .select()
        .from(paymentProposalAnnotations)
        .where(eq(paymentProposalAnnotations.proposalId, input.proposalId));
    }),

  // Protected — owner resolves an annotation with optional reply
  resolve: protectedProcedure
    .input(z.object({
      id: z.string().uuid(),
      ownerReply: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await loadAnnotationForWrite(ctx, input.id);
      await db
        .update(paymentProposalAnnotations)
        .set({
          status: 'resolved',
          ownerReply: input.ownerReply ?? null,
          resolvedAt: new Date(),
        })
        .where(eq(paymentProposalAnnotations.id, input.id));
      return { success: true };
    }),

  // Protected — owner deletes an annotation
  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadAnnotationForWrite(ctx, input.id);
      await db
        .delete(paymentProposalAnnotations)
        .where(eq(paymentProposalAnnotations.id, input.id));
      return { success: true };
    }),

  // Protected — owner reopens a resolved annotation
  reopen: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await loadAnnotationForWrite(ctx, input.id);
      await db
        .update(paymentProposalAnnotations)
        .set({
          status: 'open',
          resolvedAt: null,
        })
        .where(eq(paymentProposalAnnotations.id, input.id));
      return { success: true };
    }),
});
