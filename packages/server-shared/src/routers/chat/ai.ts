import { z } from 'zod';
import { asc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../../trpc/trpc.js';
import { chatThreads, chatMessages, brands, aiPlanItems } from '../../db/schema.js';
import type { Context } from '../../trpc/context.js';
import { streamAiReply } from '../../modules/ai/chat.js';
import { generateContinuations } from '../../modules/ai/continuations.js';
import { applyCompaction, summarizeThread } from '../../modules/ai/compaction.js';
import { isAiEnabled } from '../../modules/ai/client.js';
import { regenerateCardContent } from '../../modules/ai/regenerate.js';
import { brandHasFeature } from '../../modules/feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../../modules/feature-subscriptions/feature-keys.js';
import { pingAiTurnDone, pingContinuations, pingPlanChanged } from '../../lib/realtime.js';
import { assertMember } from './common.js';

/**
 * Hard cap on "Regenerate" presses per action card. After this many the UI hides
 * the button and points the user at the strategist instead of letting them spin
 * on the model — regenerating is a rejection signal, and past a handful of tries
 * the gap is usually judgement the assistant can't close on its own.
 */
const MAX_CARD_REGENERATIONS = 5;

/** AI-thread extras: thumbs feedback, confirm-card outcomes, plan, and `/clear`. */
export const aiProcedures = {
  /**
   * Read the AI-owned to-do plan for a thread (the Strategy To-Do panel). The
   * assistant writes it via the silent plan tools; the user views it read-only.
   * Positions are 1-based to match what the model addresses in update_plan_item.
   */
  getAiPlan: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const rows = await ctx.db
        .select({
          id: aiPlanItems.id,
          title: aiPlanItems.title,
          description: aiPlanItems.description,
          status: aiPlanItems.status,
          position: aiPlanItems.position,
        })
        .from(aiPlanItems)
        .where(eq(aiPlanItems.threadId, input.threadId))
        .orderBy(asc(aiPlanItems.position), asc(aiPlanItems.createdAt));
      return { items: rows };
    }),

  /**
   * The thread's latest out-of-band continuation suggestions (next-prompt chips
   * for the Strategy starter bar). Rehydrates on reload / when a headless turn
   * refreshes them; the live SSE stream also delivers them directly.
   */
  getAiContinuations: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const [row] = await ctx.db
        .select({ continuations: chatThreads.aiContinuations })
        .from(chatThreads)
        .where(eq(chatThreads.id, input.threadId))
        .limit(1);
      return { continuations: row?.continuations ?? [] };
    }),
  /**
   * Thumbs feedback on an AI reply. Stored on the message row (shared across the
   * brand team, survives reloads). `rating` is 1 (up), -1 (down), or null (clear).
   * Only AI replies in AI threads the caller belongs to are ratable.
   */
  rateAiMessage: protectedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        rating: z.union([z.literal(1), z.literal(-1)]).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = (
        await ctx.db
          .select({ id: chatMessages.id, threadId: chatMessages.threadId, isAi: chatMessages.isAi })
          .from(chatMessages)
          .where(eq(chatMessages.id, input.messageId))
          .limit(1)
      )[0];
      if (!message || !message.isAi) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI message not found' });
      // Membership check (also implicitly scopes to the caller's brand threads).
      await assertMember(ctx, message.threadId);
      // Record who cast the vote so super-admin Strategy Feedback can attribute a
      // dislike to a person; clear the attribution when the rating is cleared.
      await ctx.db
        .update(chatMessages)
        .set({ aiRating: input.rating, aiRatedBy: input.rating === null ? null : ctx.user.id })
        .where(eq(chatMessages.id, input.messageId));
      return { messageId: input.messageId, rating: input.rating };
    }),

  /**
   * Record the outcome of confirm-action cards on an AI message so they render
   * with the right persisted state (confirmed → done + View; rejected → dismissed)
   * inline in scrollback and after a reload. Writes the given toolUseIds into the
   * message's actionOutcomes map with the supplied outcome, and also appends them
   * to the legacy resolvedActionIds set (deduped) so older readers stay correct.
   */
  resolveAiActions: protectedProcedure
    .input(
      z.object({
        messageId: z.string().uuid(),
        toolUseIds: z.array(z.string()).min(1),
        outcome: z.enum(['confirmed', 'rejected']),
        // The final field values the user confirmed with (post-edit), keyed by
        // toolUseId. Only meaningful on 'confirmed'; stored so a later AI turn
        // can see what was actually applied vs. what it proposed.
        edits: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
        // Host surface the chat is embedded in (e.g. 'strategy'). tRPC calls
        // don't carry the x-prodesk-surface header the SSE stream does, so the
        // client passes it here — it gates whether the settlement follow-up
        // regenerates the strategy starter-chip continuations when it ends.
        surface: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const message = (
        await ctx.db
          .select({
            id: chatMessages.id,
            threadId: chatMessages.threadId,
            isAi: chatMessages.isAi,
            resolvedActionIds: chatMessages.resolvedActionIds,
            actionOutcomes: chatMessages.actionOutcomes,
            actionEdits: chatMessages.actionEdits,
            pendingActions: chatMessages.pendingActions,
            awaitSettlementFollowup: chatMessages.awaitSettlementFollowup,
            settlementFollowupFiredAt: chatMessages.settlementFollowupFiredAt,
          })
          .from(chatMessages)
          .where(eq(chatMessages.id, input.messageId))
          .limit(1)
      )[0];
      if (!message || !message.isAi) throw new TRPCError({ code: 'NOT_FOUND', message: 'AI message not found' });
      await assertMember(ctx, message.threadId);
      const mergedResolved = [...new Set([...(message.resolvedActionIds ?? []), ...input.toolUseIds])];
      const mergedOutcomes = { ...(message.actionOutcomes ?? {}) };
      for (const id of input.toolUseIds) mergedOutcomes[id] = input.outcome;
      const mergedEdits = { ...(message.actionEdits ?? {}) };
      if (input.edits) for (const [id, values] of Object.entries(input.edits)) mergedEdits[id] = values;

      // Settlement follow-up: if the model asked to be re-invoked once every card
      // it showed is settled, and they now are (and we haven't fired yet), stamp
      // the gate and kick off one headless AI turn. Stamping firedAt in the same
      // write closes the race so it fires at most once.
      const cards = message.pendingActions ?? [];
      const allSettled = cards.length > 0 && cards.every((c) => mergedOutcomes[c.toolUseId]);
      const fireFollowup =
        !!message.awaitSettlementFollowup && !message.settlementFollowupFiredAt && allSettled;

      await ctx.db
        .update(chatMessages)
        .set({
          resolvedActionIds: mergedResolved,
          actionOutcomes: mergedOutcomes,
          actionEdits: mergedEdits,
          ...(fireFollowup ? { settlementFollowupFiredAt: new Date() } : {}),
        })
        .where(eq(chatMessages.id, input.messageId));

      if (fireFollowup) void runSettlementFollowup(ctx, message.threadId, input.surface ?? null);
      // `followupFired` lets the client show the "thinking" spinner while the
      // headless follow-up turn runs — otherwise settling the last card looks
      // like nothing is happening and the user assumes it's their turn again.
      return {
        messageId: input.messageId,
        resolvedActionIds: mergedResolved,
        actionOutcomes: mergedOutcomes,
        followupFired: fireFollowup,
      };
    }),

  /**
   * "Regenerate" an action card — a REJECTION signal. Reimagines the card's prose
   * from the ORIGINAL draft (the `payload` base, always the same across presses,
   * so it's A→B, A→C, A→D — never a drift off the last take), in a fresh
   * single-shot AI conversation separate from the chat thread. The prior
   * generations for this card are read back from the message and handed to the
   * model so the new take differs from every one of them. The result is appended
   * to the message's actionRegenerations[toolUseId] history (capped at 5) so the
   * gen chips survive reloads and are shared across the team, and returned for the
   * client to drop into the card's editable fields.
   */
  regenerateCard: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        messageId: z.string().uuid(),
        toolUseId: z.string().min(1),
        kind: z.string().min(1),
        // The ORIGINAL card payload (base A), in the card's regenerate shape.
        payload: z.record(z.string(), z.unknown()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isAiEnabled()) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'AI assistant is not configured.' });
      }
      await assertMember(ctx, input.threadId);
      const thread = (
        await ctx.db
          .select({ type: chatThreads.type, brandId: chatThreads.brandId })
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1)
      )[0];
      if (!thread || thread.type !== 'ai' || !thread.brandId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an AI thread' });
      }
      // Same entitlement gate as the chat endpoint: regenerating spends the AI
      // feature, so it's unlocked only when the brand owner holds Growth Strategy.
      if (!(await brandHasFeature(ctx.db, thread.brandId, FEATURE_KEYS.AI_GROWTH_STRATEGY))) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'subscription_required' });
      }
      const brand = (
        await ctx.db.select().from(brands).where(eq(brands.id, thread.brandId)).limit(1)
      )[0];
      if (!brand) throw new TRPCError({ code: 'NOT_FOUND', message: 'Brand not found' });

      // Load the message so we can diverge from — and append to — this card's
      // existing generation history. The message must belong to this thread.
      const message = (
        await ctx.db
          .select({
            id: chatMessages.id,
            threadId: chatMessages.threadId,
            isAi: chatMessages.isAi,
            actionRegenerations: chatMessages.actionRegenerations,
          })
          .from(chatMessages)
          .where(eq(chatMessages.id, input.messageId))
          .limit(1)
      )[0];
      if (!message || !message.isAi || message.threadId !== input.threadId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'AI message not found' });
      }
      const history = { ...(message.actionRegenerations ?? {}) };
      const previous = history[input.toolUseId] ?? [];
      if (previous.length >= MAX_CARD_REGENERATIONS) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Please try communicating with the strategist about concerns.',
        });
      }

      const payload = await regenerateCardContent({
        db: ctx.db,
        brand,
        kind: input.kind,
        payload: input.payload,
        previous,
        userId: ctx.user.id,
        client: ctx.client ?? null,
      });

      const generations = [...previous, payload];
      history[input.toolUseId] = generations;
      await ctx.db
        .update(chatMessages)
        .set({ actionRegenerations: history })
        .where(eq(chatMessages.id, input.messageId));

      return { payload, generations };
    }),

  /**
   * `/clear` command for an AI thread: reset the model's context window. Sets a
   * boundary timestamp so future turns only replay history AFTER now (see
   * buildMessages), clears any server-side compaction state, and drops a visible
   * system divider into the thread. The existing messages stay on screen — only
   * the AI's memory of them is reset. Returns the divider message row.
   */
  clearAiContext: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const thread = (
        await ctx.db
          .select({ type: chatThreads.type })
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1)
      )[0];
      if (!thread || thread.type !== 'ai') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an AI thread' });
      }
      const [marker] = await ctx.db
        .insert(chatMessages)
        .values({
          threadId: input.threadId,
          senderId: null,
          isAi: false,
          senderName: 'System',
          content: 'Context cleared — earlier messages won’t be referenced from here.',
          type: 'system',
        })
        .returning();
      await ctx.db
        .update(chatThreads)
        .set({
          aiContextResetAt: marker.timestamp,
          aiCompactionState: null,
          aiContextSummary: null,
          aiContinuations: null,
        })
        .where(eq(chatThreads.id, input.threadId));
      // `/clear` also disposes the assistant's to-do plan — a fresh context means
      // a fresh plan. The panel refreshes live via the broadcast.
      await ctx.db.delete(aiPlanItems).where(eq(aiPlanItems.threadId, input.threadId));
      void pingPlanChanged(input.threadId);
      // Reset the starter-chip bar to its static prompts (continuations cleared).
      void pingContinuations(input.threadId);
      return { ...marker, timestamp: new Date(marker.timestamp).toISOString() };
    }),

  /**
   * `/compact` command for an AI thread: summarise the conversation, then move the
   * context boundary to now — so future turns replay only new messages plus the
   * summary (injected as a leading turn by buildMessages). Unlike `/clear` this
   * PRESERVES the gist (and the to-do plan): it's for trimming a long thread
   * without losing the thread. If summarisation fails we refuse to move the
   * boundary — dropping messages with no summary would be silent context loss.
   */
  compactAiContext: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      if (!isAiEnabled()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'AI is not available' });
      }
      const thread = (
        await ctx.db
          .select({
            type: chatThreads.type,
            brandId: chatThreads.brandId,
            aiContextResetAt: chatThreads.aiContextResetAt,
            aiContextSummary: chatThreads.aiContextSummary,
          })
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1)
      )[0];
      if (!thread || thread.type !== 'ai') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not an AI thread' });
      }

      let summary: string | null;
      try {
        summary = await summarizeThread({
          db: ctx.db,
          threadId: input.threadId,
          contextResetAt: thread.aiContextResetAt,
          priorSummary: thread.aiContextSummary,
          brandId: thread.brandId,
          userId: ctx.user.id,
          client: ctx.client ?? null,
        });
      } catch (e) {
        console.error('[ai] compaction failed', (e as Error).message);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "Couldn't compact the conversation — please try again.",
        });
      }

      // Nothing in the window and no prior summary — there's nothing to compact.
      // Report it as a divider without touching the boundary.
      if (!summary) {
        const [marker] = await ctx.db
          .insert(chatMessages)
          .values({
            threadId: input.threadId,
            senderId: null,
            isAi: false,
            senderName: 'System',
            content: 'Nothing to compact yet.',
            type: 'system',
          })
          .returning();
        return { ...marker, timestamp: new Date(marker.timestamp).toISOString(), compacted: false };
      }

      // Commit the compaction (shared with the automatic path): drop the divider,
      // move the boundary to it and stash the summary. The to-do plan and
      // continuations are intentionally left intact — compaction preserves state.
      const marker = await applyCompaction({
        db: ctx.db,
        threadId: input.threadId,
        summary,
        dividerText:
          'Conversation compacted — earlier messages are summarised from here to keep things focused.',
      });
      return { ...marker, timestamp: new Date(marker.timestamp).toISOString(), compacted: true };
    }),
};

/**
 * Fire one headless AI turn after the user has settled every card the model
 * proposed (it opted in via request_settlement_followup). Not streamed — the AI
 * reply is persisted and reaches clients over the normal chat realtime channel.
 * The synthetic prompt below is NOT persisted (streamAiReply only stores the
 * assistant's reply); the settled outcomes reach the model through history.
 * Best-effort and fire-and-forget: a failure never blocks the confirm click.
 *
 * `surface` is the host surface the settling click came from (forwarded by the
 * client on resolveAiActions). When the strategy surface's follow-up chain ENDS
 * here — this turn armed no further follow-up, so it's finally the user's turn —
 * the starter-chip continuations are regenerated from this turn's messages (the
 * streamed turn that armed the chain deliberately skipped them).
 */
async function runSettlementFollowup(ctx: Context, threadId: string, surface: string | null): Promise<void> {
  try {
    if (!ctx.user) return;
    const userId = ctx.user.id;
    const thread = (
      await ctx.db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1)
    )[0];
    if (!thread?.brandId) return;
    const brand = (
      await ctx.db.select().from(brands).where(eq(brands.id, thread.brandId)).limit(1)
    )[0];
    if (!brand) return;
    const aiTexts: string[] = [];
    const result = await streamAiReply({
      db: ctx.db,
      thread,
      brand,
      user: { id: userId },
      client: null,
      content:
        "SYSTEM: The user has just settled the interaction from your previous message — every confirm card or question form now has an outcome (confirmed / dismissed / edited, or answered, with the final values), visible in the conversation above. Continue naturally toward what they asked you to do:\n" +
        '- Acknowledge what was applied and honour any edits; react briefly to anything dismissed, and do not silently re-propose it.\n' +
        '- If valuable work remains toward their goal — especially an open-ended request to set up, improve, or grow the brand — take the next step NOW: use any answers they just gave and propose the next focused batch of confirm cards. Showing those cards automatically re-invokes you again once the user settles them, so you can just keep proposing the next batch turn after turn — no need to call request_settlement_followup. Keep driving until the brand is in strong shape or they redirect you; assume "yes, keep going" unless they said otherwise.\n' +
        '- If the goal is met or nothing useful remains, give a short acknowledgement (optionally a one-line summary of what is set up and what is optional next) and stop.\n' +
        'Keep each turn focused and concise.',
      attachments: [],
      excludeIds: [],
      onDelta: () => {},
      onMessage: (m) => {
        aiTexts.push(m.content);
      },
    });
    // Strategy only: the follow-up chain just ended (this turn armed no further
    // follow-up), so it's genuinely the user's turn again — regenerate the
    // starter-chip continuations from everything this turn said. Fire-and-forget
    // (mirrors the SSE endpoint) so it never delays the end-of-turn ping below;
    // only overwrites when it produced something. If this turn armed ANOTHER
    // follow-up, skip — the next settle re-enters here and the chain's real end
    // regenerates them.
    if (surface === 'strategy' && !result.followupArmed) {
      void (async () => {
        const suggestions = await generateContinuations({
          db: ctx.db,
          brand,
          threadId,
          lastUserText: '',
          assistantTexts: aiTexts,
          userId,
          client: ctx.client ?? null,
        });
        if (!suggestions.length) return;
        await ctx.db
          .update(chatThreads)
          .set({ aiContinuations: suggestions })
          .where(eq(chatThreads.id, threadId))
          .catch((e) => console.error('[ai] persist continuations failed', (e as Error).message));
        void pingContinuations(threadId);
      })();
    }
  } catch (e) {
    console.error('[ai] settlement follow-up failed', (e as Error).message);
  } finally {
    // End-of-turn signal: drops the client's "thinking" spinner. Fired on every
    // exit (including the early returns and errors above) so the spinner never
    // waits out its failsafe timeout when no reply is coming. The per-round
    // message INSERTs deliberately don't clear it — tools may still be running
    // between rounds.
    void pingAiTurnDone(threadId);
  }
}
