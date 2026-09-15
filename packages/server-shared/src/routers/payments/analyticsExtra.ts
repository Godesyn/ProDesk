/**
 * Payments (EziQuotes) analytics-extra router — merged client timeline and
 * referral credit, ported from the export's server/routers/analytics-extra.ts.
 * Note: the export called listClientNotes(clientId, accountId) with swapped
 * arguments (its helper is (accountId, clientId)) — corrected here to
 * (brandId, clientId), matching modules/payments/db.ts.
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { paymentClientReferrals, paymentClients } from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import {
  listClientNotes,
  listPayments,
  listProposals,
} from '../../modules/payments/db.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

export const analyticsExtraRouter = router({
  // Merged chronological timeline: manual notes + proposal events + payment events
  mergedTimeline: protectedProcedure
    .input(z.object({ clientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [client] = await ctx.db
        .select()
        .from(paymentClients)
        .where(eq(paymentClients.id, input.clientId))
        .limit(1);
      if (!client) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, client.brandId);

      // Manual notes
      const notes = await listClientNotes(client.brandId, input.clientId);
      const noteEvents = (notes as any[]).map((n: any) => ({
        id: `note-${n.id}`,
        type: n.type as string,
        icon: n.type === 'call' ? 'call' : n.type === 'email' ? 'email' : n.type === 'meeting' ? 'meeting' : 'note',
        label: (n.type as string).charAt(0).toUpperCase() + (n.type as string).slice(1),
        summary: n.content,
        occurredAt: n.occurredAt,
        noteId: n.id,
        deletable: true,
      }));

      // Proposal events for this client
      const proposalsResult = await listProposals(client.brandId, { limit: 200 });
      const allProposals = (proposalsResult as any).rows ?? proposalsResult;
      const clientProposals = (Array.isArray(allProposals) ? allProposals : []).filter(
        (p: any) => p.clientId === input.clientId,
      );

      const proposalEvents: any[] = [];
      for (const p of clientProposals) {
        if (p.createdAt) proposalEvents.push({ id: `prop-created-${p.id}`, type: 'proposal_created', icon: 'proposal', label: 'Proposal created', summary: `"${p.title || 'Untitled'}" created as draft`, occurredAt: p.createdAt, deletable: false });
        if (p.sentAt) proposalEvents.push({ id: `prop-sent-${p.id}`, type: 'proposal_sent', icon: 'sent', label: 'Proposal sent', summary: `"${p.title || 'Untitled'}" sent to client`, occurredAt: p.sentAt, deletable: false });
        if (p.viewedAt) proposalEvents.push({ id: `prop-viewed-${p.id}`, type: 'proposal_viewed', icon: 'viewed', label: 'Proposal viewed', summary: `"${p.title || 'Untitled'}" opened by client`, occurredAt: p.viewedAt, deletable: false });
        if (p.acceptedAt) proposalEvents.push({ id: `prop-accepted-${p.id}`, type: 'proposal_accepted', icon: 'accepted', label: 'Proposal accepted', summary: `"${p.title || 'Untitled'}" accepted`, occurredAt: p.acceptedAt, deletable: false });
      }

      // Payment events
      const paymentsResult = await listPayments(client.brandId, { limit: 200 });
      const allPayments = ((paymentsResult as any).rows ?? paymentsResult) as any[];
      const clientPaymentEvents: any[] = [];
      for (const pay of allPayments) {
        const matchingProp = clientProposals.find((p: any) => p.id === pay.proposalId);
        if (!matchingProp) continue;
        if (pay.paidAt) clientPaymentEvents.push({
          id: `pay-${pay.id}`,
          type: 'payment',
          icon: 'payment',
          label: 'Payment received',
          summary: `$${((pay.amountCents ?? 0) / 100).toLocaleString('en-AU')} received for "${matchingProp.title || 'Untitled'}"`,
          occurredAt: pay.paidAt,
          deletable: false,
        });
      }

      // Merge and sort descending
      const all = [...noteEvents, ...proposalEvents, ...clientPaymentEvents]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

      return all;
    }),

  // Apply referral credit
  applyReferralCredit: protectedProcedure
    .input(z.object({ referralId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [ref] = await ctx.db
        .select()
        .from(paymentClientReferrals)
        .where(eq(paymentClientReferrals.id, input.referralId))
        .limit(1);
      if (!ref) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, ref.brandId);

      await ctx.db
        .update(paymentClientReferrals)
        .set({ creditApplied: true })
        .where(
          and(
            eq(paymentClientReferrals.id, input.referralId),
            eq(paymentClientReferrals.brandId, ref.brandId),
          ),
        );

      return { success: true };
    }),
});
