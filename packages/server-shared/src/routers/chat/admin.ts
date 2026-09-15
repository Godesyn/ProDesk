import { z } from 'zod';
import { and, eq, desc, lt, or, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { superAdminProcedure } from '../../trpc/trpc.js';
import { chatThreads, chatMessages, users, brands } from '../../db/schema.js';
import { messageCursorInput, messagesBeforeCursor, nextMessageCursor } from './common.js';

/** Super-admin: Strategy Feedback console (disliked AI replies). */
export const adminProcedures = {
  /**
   * Every AI reply a user has thumbed-down (aiRating = -1), newest first, for the
   * super-admin Strategy Feedback console. Each row carries the brand it belongs
   * to and the teammate who disliked it, plus whether the feedback has been
   * resolved. Defaults to unresolved-only; pass includeResolved to show all.
   */
  adminListDislikedAiReplies: superAdminProcedure
    .input(
      z.object({
        includeResolved: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: messageCursorInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      const where = and(
        eq(chatMessages.aiRating, -1),
        input.includeResolved ? undefined : isNull(chatMessages.aiFeedbackResolvedAt),
        messagesBeforeCursor(input.cursor),
      );
      const rows = await ctx.db
        .select({
          id: chatMessages.id,
          threadId: chatMessages.threadId,
          content: chatMessages.content,
          timestamp: chatMessages.timestamp,
          resolvedAt: chatMessages.aiFeedbackResolvedAt,
          brandId: chatThreads.brandId,
          brandName: brands.businessName,
          ratedById: users.id,
          ratedByFirst: users.firstName,
          ratedByLast: users.lastName,
          ratedByEmail: users.email,
        })
        .from(chatMessages)
        .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
        .leftJoin(brands, eq(chatThreads.brandId, brands.id))
        .leftJoin(users, eq(chatMessages.aiRatedBy, users.id))
        .where(where)
        .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
        // Over-fetch by one to detect whether an older page exists.
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      const items = pageRows.map((r) => ({
        id: r.id,
        threadId: r.threadId,
        content: r.content,
        timestamp: new Date(r.timestamp).toISOString(),
        resolved: !!r.resolvedAt,
        resolvedAt: r.resolvedAt ? new Date(r.resolvedAt).toISOString() : null,
        // 'app' is the sentinel brand for platform threads — treat as no brand.
        brand:
          r.brandId && r.brandId !== 'app'
            ? { id: r.brandId, name: r.brandName ?? 'Unknown brand' }
            : null,
        ratedBy: r.ratedById
          ? {
              id: r.ratedById,
              name: [r.ratedByFirst, r.ratedByLast].filter(Boolean).join(' ').trim() || r.ratedByEmail,
              email: r.ratedByEmail,
            }
          : null,
      }));
      return { items, nextCursor: nextMessageCursor(pageRows, hasMore) };
    }),

  /**
   * The messages leading up to (and including) a disliked AI reply, so a
   * super-admin can read the exchange in context. Super-admin scoped — this
   * deliberately bypasses thread membership. Returns the newest `limit` messages
   * at or before the target message, in chronological order, with the target's id.
   */
  adminThreadContext: superAdminProcedure
    .input(z.object({ messageId: z.string().uuid(), limit: z.number().int().min(1).max(100).default(40) }))
    .query(async ({ ctx, input }) => {
      const target = (
        await ctx.db
          .select({ id: chatMessages.id, threadId: chatMessages.threadId, timestamp: chatMessages.timestamp })
          .from(chatMessages)
          .where(eq(chatMessages.id, input.messageId))
          .limit(1)
      )[0];
      if (!target) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });

      const rows = await ctx.db
        .select()
        .from(chatMessages)
        .where(
          and(
            eq(chatMessages.threadId, target.threadId),
            // At or before the disliked reply (compound key ties broken by id).
            or(
              lt(chatMessages.timestamp, target.timestamp),
              and(eq(chatMessages.timestamp, target.timestamp), lt(chatMessages.id, target.id)),
              eq(chatMessages.id, target.id),
            ),
          ),
        )
        .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
        .limit(input.limit);

      // Reverse to chronological order for display (query fetched newest-first).
      const items = rows
        .slice()
        .reverse()
        .map((m) => ({ ...m, timestamp: new Date(m.timestamp).toISOString() }));
      return { items, targetId: target.id };
    }),

  /**
   * Mark a disliked reply's feedback resolved (handled) or reopen it. Stamps /
   * clears aiFeedbackResolvedAt, which drives the Strategy Feedback default filter.
   */
  adminResolveAiFeedback: superAdminProcedure
    .input(z.object({ messageId: z.string().uuid(), resolved: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const resolvedAt = input.resolved ? new Date() : null;
      const updated = await ctx.db
        .update(chatMessages)
        .set({ aiFeedbackResolvedAt: resolvedAt })
        .where(eq(chatMessages.id, input.messageId))
        .returning({ id: chatMessages.id });
      if (!updated[0]) throw new TRPCError({ code: 'NOT_FOUND', message: 'Message not found' });
      return {
        messageId: input.messageId,
        resolved: input.resolved,
        resolvedAt: resolvedAt?.toISOString() ?? null,
      };
    }),
};
