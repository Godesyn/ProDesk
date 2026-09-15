/**
 * Payments (EziQuotes) sequences router — manages cold, engagement, and
 * missed_payment sequences. Each payment account (brand) has one
 * SequenceDefinition per sequence type; SequenceRuns are per-proposal
 * execution states. Ported from the Manus export's routers/sequences.ts:
 * account resolution → brandId input (definition/stats procedures) or the
 * owning row's brandId (run/proposal procedures); the Manus invokeLLM
 * rewrite is re-expressed on the platform Anthropic client (HAIKU).
 */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  proposals,
  paymentSequenceDefinitions,
  paymentSequenceMessageLog,
  paymentSequenceRuns,
} from '../../db/schema.js';
import { completeOnce } from '../../modules/ai/provider-config.js';
import { getPaymentAccount } from '../../modules/payments/db.js';
import {
  requirePaymentRead,
  requirePaymentWrite,
} from '../../modules/payments/access.js';
import { protectedProcedure, router } from '../../trpc/trpc.js';

// ── Zod schemas ───────────────────────────────────────────────────────────────
const touchpointSchema = z.object({
  dayOffset: z.number().optional(),
  viewTier: z.string().optional(),
  smsEnabled: z.boolean(),
  smsBody: z.string(),
  emailEnabled: z.boolean(),
  emailSubject: z.string(),
  emailBody: z.string(),
  isActive: z.boolean(),
});

const rulesSchema = z.object({
  cooldownHours: z.number().optional(),
  maxMessagesPerProposal: z.number().optional(),
  minHoursBetweenMessages: z.number().optional(),
});

// ── Default touchpoints per sequence type ─────────────────────────────────────
function defaultTouchpoints(type: 'cold' | 'engagement' | 'missed_payment') {
  if (type === 'cold') {
    return [
      {
        dayOffset: 2,
        smsEnabled: true,
        smsBody:
          'Hi {{client_first_name}}, just checking in — did you get a chance to review the proposal from {{business_name}}? Happy to answer any questions. {{proposal_url}}',
        emailEnabled: true,
        emailSubject: 'Following up on your proposal',
        emailBody:
          "Hi {{client_first_name}},\n\nI wanted to follow up on the proposal I sent you. If you have any questions or would like to discuss anything, I'm here to help.\n\nYou can view the proposal here: {{proposal_url}}\n\nBest,\n{{sender_name}}",
        isActive: true,
      },
      {
        dayOffset: 5,
        smsEnabled: false,
        smsBody: '',
        emailEnabled: true,
        emailSubject: 'Still available to help — {{proposal_title}}',
        emailBody:
          "Hi {{client_first_name}},\n\nI wanted to reach out one more time about the proposal. If the timing isn't right or you have concerns, please let me know — I'm happy to adjust.\n\n{{proposal_url}}\n\nBest,\n{{sender_name}}",
        isActive: true,
      },
    ];
  }
  if (type === 'engagement') {
    return [
      {
        viewTier: 'warm',
        smsEnabled: true,
        smsBody:
          'Hi {{client_first_name}}, I noticed you viewed the proposal — any questions I can help with? {{proposal_url}}',
        emailEnabled: false,
        emailSubject: '',
        emailBody: '',
        isActive: true,
      },
      {
        viewTier: 'hot',
        smsEnabled: true,
        smsBody:
          "Hi {{client_first_name}}, it looks like you've been reviewing the proposal closely. Ready to move forward or want to chat? {{proposal_url}}",
        emailEnabled: true,
        emailSubject: 'Ready to move forward?',
        emailBody:
          "Hi {{client_first_name}},\n\nI can see you've been reviewing the proposal — that's great! If you're ready to proceed or have any last questions, just reply to this email.\n\n{{proposal_url}}\n\nBest,\n{{sender_name}}",
        isActive: true,
      },
    ];
  }
  // missed_payment
  return [
    {
      dayOffset: 1,
      smsEnabled: true,
      smsBody:
        "Hi {{client_first_name}}, your payment for {{proposal_title}} didn't go through. Please update your card: {{portal_url}}",
      emailEnabled: true,
      emailSubject: 'Payment failed — action required',
      emailBody:
        "Hi {{client_first_name}},\n\nWe weren't able to process your payment for {{proposal_title}}. Please update your payment method to avoid any interruption.\n\n{{portal_url}}\n\nBest,\n{{sender_name}}",
      isActive: true,
    },
    {
      dayOffset: 3,
      smsEnabled: true,
      smsBody:
        'Hi {{client_first_name}}, your payment is still outstanding for {{proposal_title}}. Please update your card today: {{portal_url}}',
      emailEnabled: true,
      emailSubject: 'Second notice: payment required',
      emailBody:
        'Hi {{client_first_name}},\n\nThis is a second notice regarding your outstanding payment for {{proposal_title}}. Please update your payment method as soon as possible.\n\n{{portal_url}}\n\nBest,\n{{sender_name}}',
      isActive: true,
    },
  ];
}

/** Load a sequence run and gate on its brand. */
async function getRunForAccess(runId: string) {
  const [run] = await db
    .select({ id: paymentSequenceRuns.id, brandId: paymentSequenceRuns.brandId })
    .from(paymentSequenceRuns)
    .where(eq(paymentSequenceRuns.id, runId))
    .limit(1);
  if (!run) throw new TRPCError({ code: 'NOT_FOUND' });
  return run;
}

/** Load a proposal and gate on its brand. */
async function getProposalForAccess(proposalId: string) {
  const [proposal] = await db
    .select({ id: proposals.id, brandId: proposals.brandId })
    .from(proposals)
    .where(eq(proposals.id, proposalId))
    .limit(1);
  if (!proposal) throw new TRPCError({ code: 'NOT_FOUND' });
  // Payer proposals always carry the vendor brandId — narrow for the callers.
  return { ...proposal, brandId: proposal.brandId! };
}

// ── Router ────────────────────────────────────────────────────────────────────
export const sequencesRouter = router({
  // Get or create a sequence definition for the brand's payment account
  getDefinition: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        type: z.enum(['cold', 'engagement', 'missed_payment']),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const account = await getPaymentAccount(input.brandId);
      if (!account) throw new TRPCError({ code: 'NOT_FOUND' });
      const tier = (account.tier as string) ?? 'close';

      const [existing] = await db
        .select()
        .from(paymentSequenceDefinitions)
        .where(
          and(
            eq(paymentSequenceDefinitions.brandId, input.brandId),
            eq(paymentSequenceDefinitions.sequenceType, input.type),
          ),
        )
        .limit(1);

      if (existing) return { ...existing, tier };

      // Auto-create with defaults
      const [created] = await db
        .insert(paymentSequenceDefinitions)
        .values({
          brandId: input.brandId,
          sequenceType: input.type,
          isActive: true,
          touchpoints: defaultTouchpoints(input.type),
          rules: { cooldownHours: 24, maxMessagesPerProposal: 5, minHoursBetweenMessages: 4 },
        })
        .returning();
      return { ...created, tier };
    }),

  // Update a sequence definition
  updateDefinition: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        type: z.enum(['cold', 'engagement', 'missed_payment']),
        isActive: z.boolean().optional(),
        touchpoints: z.array(touchpointSchema).optional(),
        rules: rulesSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requirePaymentWrite(ctx, input.brandId);

      const [existing] = await db
        .select({ id: paymentSequenceDefinitions.id })
        .from(paymentSequenceDefinitions)
        .where(
          and(
            eq(paymentSequenceDefinitions.brandId, input.brandId),
            eq(paymentSequenceDefinitions.sequenceType, input.type),
          ),
        )
        .limit(1);

      const updateData: Partial<typeof paymentSequenceDefinitions.$inferInsert> = {
        lastEditedAt: new Date(),
        lastEditedByUserId: ctx.user.id,
        updatedAt: new Date(),
      };
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.touchpoints !== undefined) updateData.touchpoints = input.touchpoints;
      if (input.rules !== undefined) updateData.rules = input.rules;

      if (existing) {
        const [updated] = await db
          .update(paymentSequenceDefinitions)
          .set(updateData)
          .where(eq(paymentSequenceDefinitions.id, existing.id))
          .returning();
        return updated;
      } else {
        const [created] = await db
          .insert(paymentSequenceDefinitions)
          .values({
            brandId: input.brandId,
            sequenceType: input.type,
            isActive: input.isActive ?? true,
            touchpoints: input.touchpoints ?? defaultTouchpoints(input.type),
            rules:
              input.rules ??
              { cooldownHours: 24, maxMessagesPerProposal: 5, minHoursBetweenMessages: 4 },
            lastEditedAt: new Date(),
            lastEditedByUserId: ctx.user.id,
          })
          .returning();
        return created;
      }
    }),

  // AI rewrite of a single touchpoint body
  aiRewriteTouchpoint: protectedProcedure
    .input(
      z.object({
        channel: z.enum(['sms', 'email']),
        currentBody: z.string(),
        tone: z.enum(['professional', 'friendly', 'urgent', 'concise']).default('professional'),
        sequenceType: z.enum(['cold', 'engagement', 'missed_payment']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const toneMap: Record<string, string> = {
        professional: 'professional and polished',
        friendly: 'warm and conversational',
        urgent: 'urgent but respectful',
        concise: 'brief and to the point (under 160 chars for SMS)',
      };
      const channelHint =
        input.channel === 'sms'
          ? 'This is an SMS message — keep it under 160 characters, no HTML.'
          : 'This is an email body — can be 2-4 short paragraphs, plain text.';
      const seqHintMap: Record<string, string> = {
        cold: "following up on a proposal that hasn't been viewed or acted on",
        engagement: "following up after the client viewed the proposal but hasn't accepted",
        missed_payment:
          'notifying the client that their payment failed and asking them to update their card',
      };
      const seqHint = seqHintMap[input.sequenceType];

      const text = await completeOnce({
        db,
        source: 'sequence_rewrite',
        system: `You are a professional copywriter specialising in B2B proposal follow-up messages. Rewrite the provided message in a ${toneMap[input.tone]} tone. ${channelHint} The context is: ${seqHint}. Preserve all {{placeholder}} tokens exactly as-is. Return ONLY the rewritten message text, no commentary.`,
        prompt: input.currentBody,
        maxTokens: 1024,
        userId: ctx.user.id,
        client: ctx.client ?? null,
      });
      const rewritten = text.trim() || input.currentBody;
      return { rewritten };
    }),

  // List sequence runs for a proposal
  listRunsForProposal: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const proposal = await getProposalForAccess(input.proposalId);
      await requirePaymentRead(ctx, proposal.brandId);
      return db
        .select()
        .from(paymentSequenceRuns)
        .where(
          and(
            eq(paymentSequenceRuns.proposalId, input.proposalId),
            eq(paymentSequenceRuns.brandId, proposal.brandId),
          ),
        )
        .orderBy(desc(paymentSequenceRuns.createdAt));
    }),

  // Get message log for a run
  getRunLog: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const run = await getRunForAccess(input.runId);
      await requirePaymentRead(ctx, run.brandId);
      return db
        .select()
        .from(paymentSequenceMessageLog)
        .where(eq(paymentSequenceMessageLog.sequenceRunId, input.runId))
        .orderBy(desc(paymentSequenceMessageLog.firedAt));
    }),

  // Pause a sequence run
  pauseRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getRunForAccess(input.runId);
      await requirePaymentWrite(ctx, run.brandId);
      await db
        .update(paymentSequenceRuns)
        .set({ status: 'paused', haltReason: 'manual_pause', updatedAt: new Date() })
        .where(eq(paymentSequenceRuns.id, input.runId));
      return { success: true };
    }),

  // Resume a paused run
  resumeRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const run = await getRunForAccess(input.runId);
      await requirePaymentWrite(ctx, run.brandId);
      await db
        .update(paymentSequenceRuns)
        .set({ status: 'running', haltReason: null, updatedAt: new Date() })
        .where(eq(paymentSequenceRuns.id, input.runId));
      return { success: true };
    }),

  // Mark as "in conversation" — halts all active runs for a proposal
  markInConversation: protectedProcedure
    .input(z.object({ proposalId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const proposal = await getProposalForAccess(input.proposalId);
      await requirePaymentWrite(ctx, proposal.brandId);
      await db
        .update(paymentSequenceRuns)
        .set({ status: 'halted', haltReason: 'in_conversation', updatedAt: new Date() })
        .where(
          and(
            eq(paymentSequenceRuns.proposalId, input.proposalId),
            eq(paymentSequenceRuns.brandId, proposal.brandId),
            inArray(paymentSequenceRuns.status, ['pending', 'running']),
          ),
        );
      return { success: true };
    }),

  // Get overview stats for the sequences dashboard
  getStats: protectedProcedure
    .input(z.object({ brandId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requirePaymentRead(ctx, input.brandId);
      const runs = await db
        .select({ id: paymentSequenceRuns.id, status: paymentSequenceRuns.status })
        .from(paymentSequenceRuns)
        .where(eq(paymentSequenceRuns.brandId, input.brandId));
      const totalRuns = runs.length;
      const activeRuns = runs.filter((r) => r.status === 'running' || r.status === 'pending').length;
      const haltedRuns = runs.filter((r) => r.status === 'halted').length;
      const completedRuns = runs.filter((r) => r.status === 'completed').length;
      // Count sent messages for this brand's runs (the export counted all
      // accounts' sent messages — scoped here to fix the cross-tenant leak)
      const runIds = runs.map((r) => r.id);
      const msgs = runIds.length
        ? await db
            .select({ id: paymentSequenceMessageLog.id })
            .from(paymentSequenceMessageLog)
            .where(
              and(
                inArray(paymentSequenceMessageLog.sequenceRunId, runIds),
                eq(paymentSequenceMessageLog.status, 'sent'),
              ),
            )
        : [];
      return { totalRuns, activeRuns, haltedRuns, completedRuns, messagesSent: msgs.length };
    }),
});
