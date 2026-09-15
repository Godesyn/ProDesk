/**
 * Payments (EziQuotes) — payer lifecycle router (Sprint 4), ported 1:1 from the
 * Manus export's server/routers/lifecycle.ts.
 *
 * Handles all lifecycle actions for both vendors (protected, brand-scoped) and
 * payers (public, portal-session-token gated).
 *
 * Key design rules from spec:
 * - allow_payer_* flags are the source of truth for what a payer can do
 * - For hybrid proposals, check commitmentPeriodMonths before granting
 *   ongoing-service permissions (spec §2.3): before commitment period ends →
 *   fixed-engagement rules; after → ongoing-service rules
 * - Deferral (spec §5): original schedule stays unchanged until vendor approves.
 *   Missed-payment sequence continues firing during pending state.
 *   On approval → deferred installment moved to end of schedule.
 */
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { protectedProcedure, publicProcedure, router } from '../../trpc/trpc.js';
import { db } from '../../db/index.js';
import {
  paymentClientPortalTokens,
  paymentInstallmentSchedules,
  paymentLifecycleRequests,
  paymentPayerLifecycleEvents,
  proposals,
} from '../../db/schema.js';
import { requirePaymentRead, requirePaymentWrite } from '../../modules/payments/access.js';
import { dispatchLifecycleEvent } from '../../modules/payments/webhook-dispatcher.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type ProposalLifecycleFields = {
  commercialIntent: string;
  commitmentPeriodMonths: number | null;
  acceptedAt: Date | null;
  allowPayerCancel: boolean;
  allowPayerPause: boolean;
  allowPayerPayoutFull: boolean;
  allowPayerSkip: boolean;
  allowPayerCardUpdate: boolean;
  maxSkipsPerYear: number;
  maxPauseDaysPerYear: number;
  maxDeferralsPerPlan: number;
};

/**
 * Resolve effective permissions for a proposal, accounting for hybrid
 * intent commitment period expiry (spec §2.3).
 */
export function resolvePermissions(proposal: ProposalLifecycleFields) {
  const base = {
    allowPayerCancel: proposal.allowPayerCancel,
    allowPayerPause: proposal.allowPayerPause,
    allowPayerPayoutFull: proposal.allowPayerPayoutFull,
    allowPayerSkip: proposal.allowPayerSkip,
    allowPayerCardUpdate: proposal.allowPayerCardUpdate,
    maxSkipsPerYear: proposal.maxSkipsPerYear,
    maxPauseDaysPerYear: proposal.maxPauseDaysPerYear,
    maxDeferralsPerPlan: proposal.maxDeferralsPerPlan,
    inCommitmentPeriod: false,
    commitmentEndsAt: null as Date | null,
  };

  if (
    proposal.commercialIntent === 'hybrid' &&
    proposal.commitmentPeriodMonths &&
    proposal.acceptedAt
  ) {
    const commitmentEndsAt = new Date(proposal.acceptedAt);
    commitmentEndsAt.setMonth(commitmentEndsAt.getMonth() + proposal.commitmentPeriodMonths);
    base.commitmentEndsAt = commitmentEndsAt;
    if (new Date() < commitmentEndsAt) {
      // Still in commitment period — apply fixed-engagement rules
      base.inCommitmentPeriod = true;
      base.allowPayerCancel = false;
      base.allowPayerPause = false;
      // payout-in-full remains governed by the vendor's flag
    }
    // After commitment period ends, ongoing-service rules apply (base flags as set)
  }

  return base;
}

async function logLifecycleEvent(data: {
  proposalId: string;
  brandId: string;
  payerId?: string | null;
  eventType: (typeof paymentPayerLifecycleEvents.$inferInsert)['eventType'];
  initiatedBy: 'payer' | 'vendor' | 'system';
  initiatedByUserId?: string | null;
  metadata?: Record<string, unknown>;
  stripeObjectId?: string | null;
}) {
  await db.insert(paymentPayerLifecycleEvents).values({
    proposalId: data.proposalId,
    brandId: data.brandId,
    payerId: data.payerId ?? null,
    eventType: data.eventType,
    initiatedBy: data.initiatedBy,
    initiatedByUserId: data.initiatedByUserId ?? null,
    metadata: data.metadata ?? {},
    stripeObjectId: data.stripeObjectId ?? null,
  });
  // Fire-and-forget outbound webhook dispatch
  dispatchLifecycleEvent(db, {
    brandId: data.brandId,
    eventType: data.eventType,
    proposalId: data.proposalId,
    data: {
      initiatedBy: data.initiatedBy,
      payerId: data.payerId ?? null,
      ...(data.metadata ?? {}),
    },
  }).catch((err: unknown) => console.error('[Webhook] dispatch error:', err));
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const lifecycleRouter = router({
  // ── Vendor: get lifecycle state for a proposal ──────────────────────────
  getProposalLifecycle: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(eq(proposals.id, input.proposalId));
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentRead(ctx, proposal.brandId!);

      const permissions = resolvePermissions(proposal);

      const events = await db
        .select()
        .from(paymentPayerLifecycleEvents)
        .where(eq(paymentPayerLifecycleEvents.proposalId, input.proposalId))
        .orderBy(desc(paymentPayerLifecycleEvents.occurredAt))
        .limit(50);

      const pendingRequests = await db
        .select()
        .from(paymentLifecycleRequests)
        .where(
          and(
            eq(paymentLifecycleRequests.proposalId, input.proposalId),
            eq(paymentLifecycleRequests.status, 'pending'),
          ),
        )
        .orderBy(desc(paymentLifecycleRequests.requestedAt));

      return { proposal, permissions, events, pendingRequests };
    }),

  // ── Vendor: update lifecycle settings on a proposal ─────────────────────
  updateLifecycleSettings: protectedProcedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        commercialIntent: z.enum(['ongoing_service', 'fixed_engagement', 'hybrid']).optional(),
        commercialIntentLabel: z.string().optional(),
        allowPayerCancel: z.boolean().optional(),
        allowPayerPause: z.boolean().optional(),
        allowPayerPayoutFull: z.boolean().optional(),
        allowPayerSkip: z.boolean().optional(),
        allowPayerCardUpdate: z.boolean().optional(),
        minTermCompletionRequired: z.boolean().optional(),
        commitmentPeriodMonths: z.number().int().min(1).max(120).nullable().optional(),
        earlyPayoutDiscountPct: z.string().nullable().optional(),
        maxSkipsPerYear: z.number().int().min(0).max(52).optional(),
        maxPauseDaysPerYear: z.number().int().min(0).max(365).optional(),
        maxDeferralsPerPlan: z.number().int().min(0).max(24).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { proposalId, ...fields } = input;

      const [existing] = await db
        .select({ id: proposals.id, brandId: proposals.brandId })
        .from(proposals)
        .where(eq(proposals.id, proposalId));
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await requirePaymentWrite(ctx, existing.brandId!);

      await db
        .update(proposals)
        .set({ ...fields, updatedAt: new Date() })
        .where(eq(proposals.id, proposalId));

      await logLifecycleEvent({
        proposalId,
        brandId: existing.brandId!,
        eventType: 'vendor_override',
        initiatedBy: 'vendor',
        initiatedByUserId: ctx.user.id,
        metadata: { fields: Object.keys(fields) },
      });

      return { success: true };
    }),

  // ── Vendor: decide on a lifecycle request (approve / reject) ────────────
  decideRequest: protectedProcedure
    .input(
      z.object({
        requestId: z.string().uuid(),
        decision: z.enum(['approved', 'rejected']),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [request] = await db
        .select()
        .from(paymentLifecycleRequests)
        .where(
          and(
            eq(paymentLifecycleRequests.id, input.requestId),
            eq(paymentLifecycleRequests.status, 'pending'),
          ),
        );
      if (!request)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Request not found or already decided' });
      await requirePaymentWrite(ctx, request.brandId);

      await db
        .update(paymentLifecycleRequests)
        .set({
          status: input.decision,
          decidedAt: new Date(),
          decidedByUserId: ctx.user.id,
          decisionReason: input.reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(paymentLifecycleRequests.id, input.requestId));

      // If deferral approved, move the deferred installment to end of schedule (spec §5)
      if (request.requestType === 'defer' && input.decision === 'approved') {
        const payload = request.payload as { installmentId?: string };
        if (payload.installmentId) {
          const schedules = await db
            .select()
            .from(paymentInstallmentSchedules)
            .where(eq(paymentInstallmentSchedules.proposalId, request.proposalId))
            .orderBy(paymentInstallmentSchedules.dueAt);

          const lastDue = schedules[schedules.length - 1]?.dueAt;
          const newDueAt = lastDue
            ? new Date(new Date(lastDue).getTime() + 30 * 24 * 60 * 60 * 1000)
            : new Date();

          await db
            .update(paymentInstallmentSchedules)
            .set({ dueAt: newDueAt })
            .where(eq(paymentInstallmentSchedules.id, payload.installmentId));
        }
      }

      const eventType =
        request.requestType === 'defer'
          ? input.decision === 'approved'
            ? ('defer_approved' as const)
            : ('defer_rejected' as const)
          : ('vendor_override' as const);

      await logLifecycleEvent({
        proposalId: request.proposalId,
        brandId: request.brandId,
        payerId: request.payerId,
        eventType,
        initiatedBy: 'vendor',
        initiatedByUserId: ctx.user.id,
        metadata: {
          requestId: input.requestId,
          decision: input.decision,
          reason: input.reason,
        },
      });

      return { success: true };
    }),

  // ── Vendor: list all pending lifecycle requests across the brand ─────────
  listPendingRequests: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);

      const requests = await db
        .select({
          request: paymentLifecycleRequests,
          proposalTitle: proposals.title,
        })
        .from(paymentLifecycleRequests)
        .leftJoin(proposals, eq(paymentLifecycleRequests.proposalId, proposals.id))
        .where(
          and(
            eq(paymentLifecycleRequests.brandId, input.brandId),
            eq(paymentLifecycleRequests.status, 'pending'),
          ),
        )
        .orderBy(desc(paymentLifecycleRequests.requestedAt));

      return requests;
    }),

  // ── Public (payer portal): get permissions for a portal session ──────────
  getPortalPermissions: publicProcedure
    .input(z.object({ sessionToken: z.string(), proposalId: z.string().uuid() }))
    .query(async ({ input }) => {
      // Validate session token
      const [session] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(
          and(
            eq(paymentClientPortalTokens.token, input.sessionToken),
            gt(paymentClientPortalTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!session) throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Session expired' });

      // Verify the proposal belongs to this client's brand
      const [proposal] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.proposalId),
            eq(proposals.brandId, session.brandId),
          ),
        );
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });

      // Verify the client is the owner of this proposal
      if (proposal.recipientContactId !== session.clientId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const permissions = resolvePermissions(proposal);

      // Get pending requests for this proposal
      const pendingRequests = await db
        .select()
        .from(paymentLifecycleRequests)
        .where(
          and(
            eq(paymentLifecycleRequests.proposalId, proposal.id),
            eq(paymentLifecycleRequests.status, 'pending'),
          ),
        );

      return {
        proposalId: proposal.id,
        brandId: session.brandId,
        clientId: session.clientId,
        permissions,
        commercialIntent: proposal.commercialIntent,
        commitmentPeriodMonths: proposal.commitmentPeriodMonths,
        acceptedAt: proposal.acceptedAt,
        proposalStatus: proposal.status,
        proposalTitle: proposal.title,
        pendingRequests,
      };
    }),

  // ── Public (payer portal): submit a lifecycle request ───────────────────
  submitPayerRequest: publicProcedure
    .input(
      z.object({
        sessionToken: z.string(),
        proposalId: z.string().uuid(),
        requestType: z.enum(['defer', 'custom_amount_change', 'pause_extension']),
        payload: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [session] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(
          and(
            eq(paymentClientPortalTokens.token, input.sessionToken),
            gt(paymentClientPortalTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!session) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const [proposal] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.proposalId),
            eq(proposals.brandId, session.brandId),
          ),
        );
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.recipientContactId !== session.clientId) throw new TRPCError({ code: 'FORBIDDEN' });

      const permissions = resolvePermissions(proposal);

      // Check deferral limits
      if (input.requestType === 'defer') {
        // Check for existing pending deferral
        const [pendingDeferral] = await db
          .select({ id: paymentLifecycleRequests.id })
          .from(paymentLifecycleRequests)
          .where(
            and(
              eq(paymentLifecycleRequests.proposalId, proposal.id),
              eq(paymentLifecycleRequests.status, 'pending'),
              eq(paymentLifecycleRequests.requestType, 'defer'),
            ),
          );
        if (pendingDeferral) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A deferral request is already pending' });
        }

        // Check total approved deferrals against plan limit
        const approvedRows = await db
          .select({ count: sql<string>`count(*)` })
          .from(paymentLifecycleRequests)
          .where(
            and(
              eq(paymentLifecycleRequests.proposalId, proposal.id),
              eq(paymentLifecycleRequests.status, 'approved'),
              eq(paymentLifecycleRequests.requestType, 'defer'),
            ),
          );
        const approvedCount = parseInt(approvedRows[0]?.count ?? '0', 10);
        if (approvedCount >= permissions.maxDeferralsPerPlan) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: `Maximum deferrals (${permissions.maxDeferralsPerPlan}) reached for this plan`,
          });
        }
      }

      // Create the request
      const [newRequest] = await db
        .insert(paymentLifecycleRequests)
        .values({
          proposalId: proposal.id,
          brandId: session.brandId,
          payerId: session.clientId,
          requestType: input.requestType,
          payload: input.payload ?? {},
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        })
        .returning();

      // Log the event
      await logLifecycleEvent({
        proposalId: proposal.id,
        brandId: session.brandId,
        payerId: session.clientId,
        eventType: input.requestType === 'defer' ? 'defer_requested' : 'vendor_override',
        initiatedBy: 'payer',
        metadata: { requestId: newRequest.id, payload: input.payload },
      });

      return { success: true, requestId: newRequest.id };
    }),

  // ── Public (payer portal): payer self-service actions ───────────────────
  payerAction: publicProcedure
    .input(
      z.object({
        sessionToken: z.string(),
        proposalId: z.string().uuid(),
        action: z.enum(['cancel', 'pause', 'resume', 'payout_full', 'skip_installment', 'update_card']),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const [session] = await db
        .select()
        .from(paymentClientPortalTokens)
        .where(
          and(
            eq(paymentClientPortalTokens.token, input.sessionToken),
            gt(paymentClientPortalTokens.expiresAt, new Date()),
          ),
        )
        .limit(1);
      if (!session) throw new TRPCError({ code: 'UNAUTHORIZED' });

      const [proposal] = await db
        .select()
        .from(proposals)
        .where(
          and(
            eq(proposals.id, input.proposalId),
            eq(proposals.brandId, session.brandId),
          ),
        );
      if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
      if (proposal.recipientContactId !== session.clientId) throw new TRPCError({ code: 'FORBIDDEN' });

      const permissions = resolvePermissions(proposal);

      // Permission checks
      const permissionMap: Record<string, boolean> = {
        cancel: permissions.allowPayerCancel,
        pause: permissions.allowPayerPause,
        resume: true, // resuming is always allowed
        payout_full: permissions.allowPayerPayoutFull,
        skip_installment: permissions.allowPayerSkip,
        update_card: permissions.allowPayerCardUpdate,
      };

      if (!permissionMap[input.action]) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: `Your plan does not allow ${input.action.replace(/_/g, ' ')}`,
        });
      }

      // Map action to event type
      const eventTypeMap: Record<string, (typeof paymentPayerLifecycleEvents.$inferInsert)['eventType']> = {
        cancel: 'cancel_requested',
        pause: 'pause_started',
        resume: 'plan_resumed',
        payout_full: 'payout_full',
        skip_installment: 'skip_requested',
        update_card: 'card_update',
      };

      // Apply state changes
      if (input.action === 'cancel') {
        await db
          .update(proposals)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
      } else if (input.action === 'pause') {
        await db
          .update(proposals)
          .set({ sequencesPaused: true, updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
      } else if (input.action === 'resume') {
        await db
          .update(proposals)
          .set({ sequencesPaused: false, updatedAt: new Date() })
          .where(eq(proposals.id, proposal.id));
      }

      await logLifecycleEvent({
        proposalId: proposal.id,
        brandId: session.brandId,
        payerId: session.clientId,
        eventType: eventTypeMap[input.action],
        initiatedBy: 'payer',
        metadata: input.metadata ?? {},
      });

      return { success: true };
    }),
});
