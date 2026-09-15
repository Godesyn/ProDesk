import { z } from 'zod';
import { and, eq, gt, lt, or } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { chatMessages, chatThreadMembers } from '../../db/schema.js';
import { tryJoinBrandAiThread } from '../../modules/chat/threads.js';
import type { Context } from '../../trpc/context.js';

export const identityTypeEnum = z.enum(['agency', 'brand', 'contractor', 'platformAdmin', 'user']);
export const navigationTargetEnum = z.enum([
  'allThread',
  'brandThread',
  'agencyThread',
  'interAgencyThread',
  'personalThread',
]);

/**
 * Opaque keyset cursor over the `(timestamp, id)` compound key of chat_messages
 * — pages walk backwards on the `chat_messages_thread_idx` index, O(page)
 * regardless of thread depth. The compound key disambiguates messages sharing a
 * millisecond timestamp. Cursor = the oldest row already loaded; omit for the
 * newest page.
 */
export const messageCursorInput = z
  .object({
    timestamp: z.string(),
    id: z.string().uuid(),
    /**
     * Which way this cursor walks. It lives ON THE CURSOR rather than beside it
     * because react-query threads exactly one page-param through an infinite
     * query — `fetchNextPage` and `fetchPreviousPage` both hand back a cursor and
     * nothing else. Encoding the direction here is what lets one query page in
     * both directions, which is what reading forward out of a jump requires.
     * Absent means 'older', so every cursor minted before this existed still
     * means what it always meant.
     */
    dir: z.enum(['older', 'newer']).optional(),
  })
  .nullish();

export type MessageCursor =
  | { timestamp: string; id: string; dir?: 'older' | 'newer' }
  | null
  | undefined;

/** Keyset predicate: chat messages strictly older than the cursor (or no-op without one). */
export function messagesBeforeCursor(cursor: MessageCursor) {
  if (!cursor) return undefined;
  const ts = new Date(cursor.timestamp);
  return or(lt(chatMessages.timestamp, ts), and(eq(chatMessages.timestamp, ts), lt(chatMessages.id, cursor.id)));
}

/**
 * The mirror image: strictly NEWER than the cursor.
 *
 * History only ever needed to walk backwards, so this did not exist. Jumping to
 * a quoted message does need it: landing deep in the archive is only useful if
 * you can then read FORWARD out of it, and without a newer-than predicate the
 * only route back to the present is to throw the window away and start again
 * from the newest page.
 */
export function messagesAfterCursor(cursor: MessageCursor) {
  if (!cursor) return undefined;
  const ts = new Date(cursor.timestamp);
  return or(gt(chatMessages.timestamp, ts), and(eq(chatMessages.timestamp, ts), gt(chatMessages.id, cursor.id)));
}

/** Cursor for the next-NEWER page, or null when this page was the newest. */
export function prevMessageCursor(
  pageRows: Array<{ timestamp: Date | string; id: string }>,
  hasMore: boolean,
): { timestamp: string; id: string; dir: 'newer' } | null {
  // pageRows are newest-first, so the newest row is the head.
  const first = pageRows[0];
  return hasMore && first
    ? { timestamp: new Date(first.timestamp).toISOString(), id: first.id, dir: 'newer' }
    : null;
}

/**
 * Cursor for the next-older page, or null when this page was the last. Pair with
 * the over-fetch-by-one pattern: `hasMore = rows.length > limit`.
 */
export function nextMessageCursor(
  pageRows: Array<{ timestamp: Date | string; id: string }>,
  hasMore: boolean,
): { timestamp: string; id: string; dir: 'older' } | null {
  const last = pageRows[pageRows.length - 1];
  return hasMore && last
    ? { timestamp: new Date(last.timestamp).toISOString(), id: last.id, dir: 'older' }
    : null;
}

export function meName(user: { firstName?: string | null; lastName?: string | null; email: string }) {
  return [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
}

/**
 * Throw unless the signed-in user is a member of the thread.
 *
 * A brand's AI thread is the one exception: its membership is a snapshot taken
 * when the thread was created, so a brand member who joined later can be missing
 * a row while plainly being entitled to the thread. `tryJoinBrandAiThread`
 * re-checks the brand roster and backfills the rows for those, and only those.
 */
export async function assertMember(ctx: Context, threadId: string) {
  if (!ctx.user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  const member = (
    await ctx.db
      .select()
      .from(chatThreadMembers)
      .where(and(eq(chatThreadMembers.threadId, threadId), eq(chatThreadMembers.userId, ctx.user.id)))
      .limit(1)
  )[0];
  if (member) return;
  if (await tryJoinBrandAiThread(ctx.user.id, threadId, ctx.db)) return;
  throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this thread' });
}
