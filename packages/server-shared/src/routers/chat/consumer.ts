import { z } from 'zod';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../../trpc/trpc.js';
import { chatThreadMembers, chatThreads, chatUserBlocks, users } from '../../db/schema.js';
import type { Context } from '../../trpc/context.js';
import { MESSENGER_THREAD_TYPES } from '../../modules/chat/thread-types.js';
import {
  MAX_ADD_AT_ONCE,
  MAX_GROUP_MEMBERS,
  MAX_PINNED,
  assertConsumerThread,
  assertGroupThread,
  assertNotBlocked,
  assertThreadAdmin,
  createGroupThread,
  getOrCreateDirectThread,
  threadMemberIds,
} from '../../modules/chat/consumer.js';
import { postSystemMessage } from '../../modules/chat/threads.js';
import { pingInbox, pingMembersChanged, pingThreadChanged } from '../../lib/realtime.js';
import { assertMember, meName } from './common.js';

/**
 * The consumer messenger's own surface (chat.prodesk.com): the obligation-ordered
 * inbox, thread lifecycle, and the message-request queue.
 *
 * Every mutation here that changes the THREAD calls `assertConsumerThread` (or
 * one of its narrower cousins) on top of `assertMember`. Membership alone is not
 * enough — a brand owner IS a member of their workspace `all` thread, and without
 * the extra guard `renameThread` or `removeMember` would be an API for
 * vandalising org chat that the workspace UI never exposes.
 *
 * The four per-member preferences (archive / mute / pin / mark-unread) are the
 * documented exception: they write only the caller's own membership row and are
 * invisible to everyone else. See the comment above `setArchived`.
 */

/** How fresh a heartbeat has to be to read as "online". Matches lib/presence.ts. */
const ONLINE_WINDOW_MS = 90_000;

const inboxCursor = z
  .object({ sortAt: z.string(), id: z.string().uuid() })
  .nullish();

/**
 * The two buckets the messenger inbox splits on.
 *
 * This USED to be Owed / Waiting / Settled, derived from
 * `chat_threads.last_message_sender_id` — a thread you had read but not answered
 * still counted as owed. That rule was honest but the labels were not: people
 * read "Owed" as "unread", found read messages in it, and stopped trusting the
 * section. So the split is now the one the labels promise — has this conversation
 * something in it I have not read, or not.
 *
 * A muted (or archived — see below) conversation is always `read`, whatever its
 * counter says. Muting means "stop putting this in front of me", and a section
 * header that keeps doing so is the same broken promise in a different place.
 */
export type InboxSection = 'unread' | 'read';

/**
 * A mute with no end date. Stored as a real (absurdly far future) timestamp
 * rather than a nullable flag so `muted_until > now()` stays the ONE predicate
 * every gate uses — the send-side notify filter, the digest worker's recompute,
 * and the inbox decoration below. A second "muted forever" column would mean
 * three places to remember, and the one that gets forgotten emails somebody.
 */
export const MUTE_FOREVER = new Date('9999-12-31T23:59:59.000Z');

/** True when a mute has no practical end (see MUTE_FOREVER). */
export function isForeverMute(until: Date | null | undefined): boolean {
  return !!until && until.getUTCFullYear() >= 9999;
}

/**
 * Sort key. `last_message_at` is null for a group created and not yet spoken in,
 * and `desc` puts NULLs FIRST in Postgres — which would pin every empty group to
 * the top of the inbox. Coalescing to `created_at` also makes the keyset cursor
 * total, because the expression can never be null.
 */
const SORT_AT = sql<string>`coalesce(${chatThreads.lastMessageAt}, ${chatThreads.createdAt})`;

export const consumerProcedures = {
  /**
   * The messenger inbox — keyset-paginated, ordered by recency, and bucketed
   * into Unread / Read (see `InboxSection`).
   *
   * This does NOT reuse `chat.threads`. That procedure is offset-paginated with a
   * `count()` scan and requires an identity, all of which is right for the
   * workspace's grouped list and wrong for an infinite consumer inbox.
   *
   * Pinned threads come back only on the FIRST page, as their own array. Folding
   * them into the keyset would mean a thread pinned six months ago surfaces on
   * page seven, and lifting them out of already-loaded pages client-side has the
   * same bug in a harder-to-see form. They are capped at five, so a second small
   * query is cheaper than either.
   */
  inbox: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).default(30),
        cursor: inboxCursor,
        /** `archived` is a separate view, not a filter over the same list. */
        filter: z.enum(['all', 'unread', 'archived']).default('all'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const meId = ctx.user.id;
      const archived = input.filter === 'archived';

      const base = [
        eq(chatThreadMembers.userId, meId),
        inArray(chatThreads.type, MESSENGER_THREAD_TYPES),
        // A pending request is NOT in the inbox — it is in Requests. This is the
        // first of the anti-spam gates and the most visible one.
        ne(chatThreadMembers.requestState, 'pending'),
        ne(chatThreadMembers.requestState, 'declined'),
        eq(chatThreadMembers.isArchived, archived),
      ];
      if (input.filter === 'unread') base.push(sql`${chatThreadMembers.unreadCount} > 0`);

      const conds = [...base];
      if (input.cursor) {
        // Row-value comparison over the same expression the ORDER BY uses. An ISO
        // string + explicit cast, never a JS Date in a raw fragment — postgres.js
        // cannot serialise one inside sql``.
        conds.push(
          sql`(coalesce(${chatThreads.lastMessageAt}, ${chatThreads.createdAt}), ${chatThreads.id}) < (${input.cursor.sortAt}::timestamptz, ${input.cursor.id}::uuid)`,
        );
      }
      // Pinned rows are served separately, so exclude them from the flowing list
      // to avoid showing the same thread twice on page one.
      if (!archived) conds.push(eq(chatThreadMembers.isPinned, false));

      const select = {
        thread: chatThreads,
        unreadCount: chatThreadMembers.unreadCount,
        mutedUntil: chatThreadMembers.mutedUntil,
        isPinned: chatThreadMembers.isPinned,
        isArchived: chatThreadMembers.isArchived,
        sortAt: SORT_AT,
      };

      const rows = await ctx.db
        .select(select)
        .from(chatThreadMembers)
        .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
        .where(and(...conds))
        .orderBy(desc(SORT_AT), desc(chatThreads.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;

      const pinnedRows =
        input.cursor || archived
          ? []
          : await ctx.db
              .select(select)
              .from(chatThreadMembers)
              .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
              .where(and(...base, eq(chatThreadMembers.isPinned, true)))
              .orderBy(desc(chatThreadMembers.pinnedAt))
              .limit(MAX_PINNED);

      const decorated = await decorateThreads(ctx.db, meId, [...pinnedRows, ...pageRows]);
      const byId = new Map(decorated.map((d) => [d.id, d]));

      const last = pageRows[pageRows.length - 1];
      return {
        pinned: pinnedRows.map((r) => byId.get(r.thread.id)!).filter(Boolean),
        items: pageRows.map((r) => byId.get(r.thread.id)!).filter(Boolean),
        nextCursor:
          hasMore && last
            ? { sortAt: new Date(last.sortAt).toISOString(), id: last.thread.id }
            : null,
      };
    }),

  /**
   * One thread, decorated exactly like an inbox row.
   *
   * The open room needs its own title, type, photo, unread count and mute state.
   * Reading them out of the inbox query would look tempting and be wrong: the
   * inbox is paginated, so a conversation further down the list simply is not in
   * the loaded pages and the room would fall back to "Conversation" — a bug that
   * only shows up once someone has more than thirty threads.
   */
  threadMeta: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = (
        await ctx.db
          .select({
            thread: chatThreads,
            unreadCount: chatThreadMembers.unreadCount,
            mutedUntil: chatThreadMembers.mutedUntil,
            isPinned: chatThreadMembers.isPinned,
            isArchived: chatThreadMembers.isArchived,
          })
          .from(chatThreadMembers)
          .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
          .where(
            and(
              eq(chatThreadMembers.threadId, input.threadId),
              eq(chatThreadMembers.userId, ctx.user.id),
            ),
          )
          .limit(1)
      )[0];
      if (!row) throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this thread' });
      const [item] = await decorateThreads(ctx.db, ctx.user.id, [row]);
      return item ?? null;
    }),

  /* --------------------------------------------------------------- create */

  /** Open (or reopen) the DM with one person. Idempotent and race-safe. */
  createDirect: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getOrCreateDirectThread(ctx.db, ctx.user.id, input.userId);
      if (result.created) {
        await pingInbox(
          result.requestState === 'pending' ? 'request_new' : 'thread_new',
          input.userId,
        );
      }
      return result;
    }),

  createGroup: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().max(80).optional(),
        memberIds: z.array(z.string().uuid()).min(1).max(MAX_GROUP_MEMBERS),
        photoUrl: z.string().url().nullish(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { threadId, memberIds } = await createGroupThread(ctx.db, ctx.user.id, {
        name: input.name,
        memberIds: input.memberIds,
        photoUrl: input.photoUrl ?? null,
      });
      await postSystemMessage(
        threadId,
        `${meName(ctx.user)} started this group`,
        ctx.db,
        ctx.user.id,
      );
      await pingInbox('thread_new', ...memberIds.filter((id) => id !== ctx.user.id));
      return { threadId };
    }),

  /* ---------------------------------------------------------- membership */

  addMembers: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).min(1).max(MAX_ADD_AT_ONCE),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertThreadAdmin(ctx.db, input.threadId, ctx.user.id);

      const existing = await threadMemberIds(ctx.db, input.threadId);
      const toAdd = [...new Set(input.userIds)].filter((id) => !existing.includes(id));
      if (toAdd.length === 0) return { added: 0 };
      if (existing.length + toAdd.length > MAX_GROUP_MEMBERS) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `A group can hold ${MAX_GROUP_MEMBERS} people.`,
        });
      }
      for (const id of toAdd) await assertNotBlocked(ctx.db, ctx.user.id, id);

      const people = await ctx.db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(inArray(users.id, toAdd));
      if (people.length !== toAdd.length) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'One of those people no longer has an account.' });
      }

      await ctx.db
        .insert(chatThreadMembers)
        .values(
          toAdd.map((userId) => ({
            threadId: input.threadId,
            userId,
            role: 'user',
            requestState: 'accepted' as const,
          })),
        )
        .onConflictDoNothing();

      // Membership changes are part of the record, so they land in the transcript
      // rather than only in a sheet nobody has open.
      const names = people.map((p) => [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email);
      await postSystemMessage(
        input.threadId,
        `${meName(ctx.user)} added ${names.join(', ')}`,
        ctx.db,
        ctx.user.id,
      );
      await pingMembersChanged(input.threadId);
      await pingInbox('thread_new', ...toAdd);
      return { added: toAdd.length };
    }),

  removeMember: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertThreadAdmin(ctx.db, input.threadId, ctx.user.id);
      if (input.userId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Use Leave group instead.' });
      }
      const person = (
        await ctx.db
          .select({ firstName: users.firstName, lastName: users.lastName, email: users.email })
          .from(users)
          .where(eq(users.id, input.userId))
          .limit(1)
      )[0];

      await ctx.db
        .delete(chatThreadMembers)
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, input.userId),
          ),
        );
      const name = person
        ? [person.firstName, person.lastName].filter(Boolean).join(' ').trim() || person.email
        : 'someone';
      await postSystemMessage(input.threadId, `${meName(ctx.user)} removed ${name}`, ctx.db, ctx.user.id);
      await pingMembersChanged(input.threadId);
      await pingInbox('threads_changed', input.userId);
      return { ok: true as const };
    }),

  /**
   * Leave a group. If the last admin leaves, the longest-standing remaining
   * member is promoted — a group with no admin is a group nobody can ever fix.
   */
  leaveThread: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertGroupThread(ctx.db, input.threadId);

      await ctx.db
        .delete(chatThreadMembers)
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );

      const remaining = await ctx.db
        .select({ userId: chatThreadMembers.userId, isAdmin: chatThreadMembers.isAdmin })
        .from(chatThreadMembers)
        .where(eq(chatThreadMembers.threadId, input.threadId))
        .orderBy(asc(chatThreadMembers.joinedAt));

      if (remaining.length > 0 && !remaining.some((m) => m.isAdmin)) {
        await ctx.db
          .update(chatThreadMembers)
          .set({ isAdmin: true })
          .where(
            and(
              eq(chatThreadMembers.threadId, input.threadId),
              eq(chatThreadMembers.userId, remaining[0].userId),
            ),
          );
      }

      if (remaining.length > 0) {
        await postSystemMessage(input.threadId, `${meName(ctx.user)} left`, ctx.db, remaining[0].userId);
        await pingMembersChanged(input.threadId);
      }
      await pingInbox('threads_changed', ctx.user.id);
      return { ok: true as const };
    }),

  setThreadAdmin: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        userId: z.string().uuid(),
        isAdmin: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertThreadAdmin(ctx.db, input.threadId, ctx.user.id);
      await ctx.db
        .update(chatThreadMembers)
        .set({ isAdmin: input.isAdmin })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, input.userId),
          ),
        );
      await pingThreadChanged(input.threadId);
      return { ok: true as const };
    }),

  /* ------------------------------------------------------------- metadata */

  renameThread: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), name: z.string().trim().max(80) }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertThreadAdmin(ctx.db, input.threadId, ctx.user.id);
      const name = input.name.trim() || null;
      await ctx.db.update(chatThreads).set({ name }).where(eq(chatThreads.id, input.threadId));
      await postSystemMessage(
        input.threadId,
        name ? `${meName(ctx.user)} named the group “${name}”` : `${meName(ctx.user)} removed the group name`,
        ctx.db,
        ctx.user.id,
      );
      await pingThreadChanged(input.threadId);
      return { ok: true as const };
    }),

  setThreadPhoto: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), photoUrl: z.string().url().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertThreadAdmin(ctx.db, input.threadId, ctx.user.id);
      await ctx.db
        .update(chatThreads)
        .set({ photoUrl: input.photoUrl })
        .where(eq(chatThreads.id, input.threadId));
      await pingThreadChanged(input.threadId);
      return { ok: true as const };
    }),

  /* ------------------------------------------------- per-member preferences
   *
   * These four are the ONLY mutations in this file that do not call
   * `assertConsumerThread`, and the omission is deliberate rather than an
   * oversight. That guard exists to stop messenger verbs (rename, add member,
   * set photo) from being pointed at an org-derived thread, which they would
   * vandalise for everyone in it. Archive / mute / pin / mark-unread write ONE
   * row — the caller's own `chat_thread_members` — and are invisible to every
   * other member, so there is nothing to vandalise.
   *
   * Requiring it here actively broke two things: the messenger's own `you` notes
   * thread is not a "consumer" type, so pinning or muting it threw FORBIDDEN in
   * the very UI that offers the buttons; and the workspace MessagePanel had no
   * way to mute a noisy org thread at all.
   */

  setArchived: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), archived: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await ctx.db
        .update(chatThreadMembers)
        .set({ isArchived: input.archived, isPinned: input.archived ? false : undefined })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );
      return { ok: true as const };
    }),

  /**
   * Mute until a moment, or (with MUTE_FOREVER) until switched back off.
   *
   * The caller picks the instant rather than a duration enum, so "8 hours" and
   * "until tomorrow morning" are the same procedure and the list of offered
   * durations can change in the UI without a deploy of this file.
   */
  setMuted: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), until: z.date().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await ctx.db
        .update(chatThreadMembers)
        .set({ mutedUntil: input.until })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );
      return { mutedUntil: input.until };
    }),

  setPinned: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), pinned: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      if (input.pinned) {
        const [{ value }] = await ctx.db
          .select({ value: sql<number>`count(*)::int` })
          .from(chatThreadMembers)
          .where(
            and(eq(chatThreadMembers.userId, ctx.user.id), eq(chatThreadMembers.isPinned, true)),
          );
        if ((value ?? 0) >= MAX_PINNED) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `You can pin ${MAX_PINNED} conversations. Unpin one first.`,
          });
        }
      }
      await ctx.db
        .update(chatThreadMembers)
        .set({ isPinned: input.pinned, pinnedAt: input.pinned ? new Date() : null })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );
      return { ok: true as const };
    }),

  /** Put a thread back in the unread state — "I'll deal with this later". */
  markUnread: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await ctx.db
        .update(chatThreadMembers)
        .set({ unreadCount: 1, lastReadMessageId: null })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );
      return { ok: true as const };
    }),

  /* -------------------------------------------------------------- requests */

  /**
   * First messages from people you share nothing with.
   *
   * The whole request queue exists because anyone can be found by email address.
   * Without it, "discoverable" would mean "reachable by every spammer with a list",
   * and the honest response to that would have been not to ship email lookup at all.
   */
  listRequests: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(30) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ thread: chatThreads })
        .from(chatThreadMembers)
        .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
        .where(
          and(
            eq(chatThreadMembers.userId, ctx.user.id),
            eq(chatThreadMembers.requestState, 'pending'),
          ),
        )
        .orderBy(desc(chatThreads.createdAt))
        .limit(input.limit);
      if (rows.length === 0) return [];

      const senderIds = [
        ...new Set(
          rows
            .map((r) =>
              r.thread.participantAId === ctx.user.id
                ? r.thread.participantBId
                : r.thread.participantAId,
            )
            .filter((id): id is string => !!id),
        ),
      ];
      const people = senderIds.length
        ? await ctx.db
            .select({
              id: users.id,
              firstName: users.firstName,
              lastName: users.lastName,
              email: users.email,
              profileUrl: users.profileUrl,
            })
            .from(users)
            .where(inArray(users.id, senderIds))
        : [];
      const byId = new Map(people.map((p) => [p.id, p]));

      return rows.map((r) => {
        const fromId =
          r.thread.participantAId === ctx.user.id
            ? r.thread.participantBId
            : r.thread.participantAId;
        const p = fromId ? byId.get(fromId) : undefined;
        return {
          threadId: r.thread.id,
          // The FULL first message, not a truncated preview — you have to be able
          // to judge a stranger's message to decide on it, and a clipped line is
          // how a legitimate note gets declined by mistake.
          preview: r.thread.lastMessage,
          at: r.thread.lastMessageAt ?? r.thread.createdAt,
          from: {
            id: fromId,
            name: p
              ? [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email
              : 'Someone',
            avatarUrl: p?.profileUrl ?? null,
          },
        };
      });
    }),

  requestCount: protectedProcedure.query(async ({ ctx }) => {
    const [{ value }] = await ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(chatThreadMembers)
      .where(
        and(
          eq(chatThreadMembers.userId, ctx.user.id),
          eq(chatThreadMembers.requestState, 'pending'),
        ),
      );
    return { count: value ?? 0 };
  }),

  acceptRequest: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      await assertConsumerThread(ctx.db, input.threadId);
      await ctx.db
        .update(chatThreadMembers)
        .set({ requestState: 'accepted', isArchived: false })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );
      await pingInbox('threads_changed', ctx.user.id);
      return { ok: true as const };
    }),

  /**
   * Decline. The thread is NOT deleted — the sender keeps their side, exactly as
   * they would if you had simply never replied. Deleting it would tell them they
   * were declined, which is a worse outcome for the person declining.
   */
  declineRequest: protectedProcedure
    .input(z.object({ threadId: z.string().uuid(), block: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const thread = await assertConsumerThread(ctx.db, input.threadId);
      await ctx.db
        .update(chatThreadMembers)
        .set({ requestState: 'declined', isArchived: true, unreadCount: 0 })
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            eq(chatThreadMembers.userId, ctx.user.id),
          ),
        );

      if (input.block) {
        const otherId =
          thread.participantAId === ctx.user.id ? thread.participantBId : thread.participantAId;
        if (otherId) {
          await ctx.db
            .insert(chatUserBlocks)
            .values({ blockerId: ctx.user.id, blockedId: otherId })
            .onConflictDoNothing();
        }
      }
      await pingInbox('threads_changed', ctx.user.id);
      return { ok: true as const };
    }),
};

/* ------------------------------------------------------------- decoration */

type RawRow = {
  thread: typeof chatThreads.$inferSelect;
  unreadCount: number;
  mutedUntil: Date | null;
  isPinned: boolean;
  isArchived: boolean;
};

export type InboxItem = {
  id: string;
  type: 'direct' | 'group' | 'you';
  displayName: string;
  avatarUrl: string | null;
  /** Faces for a group tile — who is in it is what identifies it. */
  faces: { id: string; name: string; avatarUrl: string | null }[];
  memberCount: number;
  lastMessage: string | null;
  lastMessageAt: Date | null;
  lastMessageMine: boolean;
  unreadCount: number;
  isPinned: boolean;
  /** Effective silence: an explicit mute OR the implicit one archiving carries. */
  isMuted: boolean;
  /** When the explicit mute lapses. MUTE_FOREVER-shaped when it never does. */
  mutedUntil: Date | null;
  isArchived: boolean;
  section: InboxSection;
  /** DMs only: the other person, for presence and a direct profile link. */
  counterpartId: string | null;
  counterpartOnline: boolean;
};

/**
 * Turn raw rows into inbox items in a FIXED number of queries.
 *
 * `display.ts#inferThreadName` and `#inferThreadLogo` each run their own SELECT,
 * which is fine for the workspace list's grouped sections and quietly quadratic
 * here: a 30-row inbox would be 60 round trips before the first paint. This
 * batches every counterparty and every group's faces into two.
 */
async function decorateThreads(
  db: Context['db'],
  meId: string,
  rows: RawRow[],
): Promise<InboxItem[]> {
  if (rows.length === 0) return [];
  const now = Date.now();
  const threadIds = rows.map((r) => r.thread.id);

  // Every member of every listed thread, in one query. Used for the DM
  // counterparty, the group face tiles, and the member count.
  const memberRows = await db
    .select({
      threadId: chatThreadMembers.threadId,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      profileUrl: users.profileUrl,
      lastSeenAt: users.lastSeenAt,
    })
    .from(chatThreadMembers)
    .innerJoin(users, eq(chatThreadMembers.userId, users.id))
    .where(inArray(chatThreadMembers.threadId, threadIds));

  const byThread = new Map<string, typeof memberRows>();
  for (const m of memberRows) {
    const list = byThread.get(m.threadId) ?? [];
    list.push(m);
    byThread.set(m.threadId, list);
  }
  const nameOf = (m: (typeof memberRows)[number]) =>
    [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || m.email;

  return rows.map((r) => {
    const t = r.thread;
    const members = byThread.get(t.id) ?? [];
    const others = members.filter((m) => m.userId !== meId);
    // ARCHIVING IS A MUTE. Filing a conversation away and then being pinged by it
    // is the behaviour that teaches people archive means nothing, so the two are
    // one state here rather than two the user has to set separately. Derived
    // instead of written into `muted_until` on archive, so unarchiving restores
    // whatever mute the user had actually chosen instead of clearing it.
    const muted = r.isArchived || (!!r.mutedUntil && r.mutedUntil.getTime() > now);

    let displayName: string;
    let avatarUrl: string | null;
    let counterpartId: string | null = null;
    let counterpartOnline = false;

    if (t.type === 'you') {
      // "Notes", not "You" — which is what `display.ts#inferThreadName` returns
      // for the workspace's list and what this decorator used to copy. In a list
      // of people's names a row called "You" reads as a person; the thread is a
      // place you put things. The workspace label is left alone: there it sits
      // under PLATFORM ADMIN beside "Platform Admin", where "You" is the clearer
      // of the two.
      displayName = 'Notes';
      avatarUrl = members.find((m) => m.userId === meId)?.profileUrl ?? null;
    } else if (t.type === 'direct') {
      const other = others[0];
      counterpartId = other?.userId ?? null;
      counterpartOnline = !!other?.lastSeenAt && now - other.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
      displayName = other ? nameOf(other) : 'Conversation';
      avatarUrl = other?.profileUrl ?? null;
    } else {
      // An unnamed group is identified by the people in it, so build the label
      // from their first names rather than printing a generic "Group".
      displayName =
        t.name?.trim() ||
        (others.length
          ? others
              .slice(0, 3)
              .map((m) => nameOf(m).split(' ')[0])
              .join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '')
          : 'Group');
      avatarUrl = t.photoUrl ?? null;
    }

    const lastMessageMine = !!t.lastMessageSenderId && t.lastMessageSenderId === meId;

    // Unread / Read — see the InboxSection docblock for why this is read state and
    // not who-spoke-last. Muted (or archived) always lands in Read: the counter is
    // still true, it just isn't allowed to shout.
    const section: InboxSection = r.unreadCount > 0 && !muted ? 'unread' : 'read';

    return {
      id: t.id,
      type: t.type as 'direct' | 'group' | 'you',
      displayName,
      avatarUrl,
      faces: others.slice(0, 4).map((m) => ({
        id: m.userId,
        name: nameOf(m),
        avatarUrl: m.profileUrl ?? null,
      })),
      memberCount: members.length,
      lastMessage: t.lastMessage,
      lastMessageAt: t.lastMessageAt,
      lastMessageMine,
      unreadCount: r.unreadCount,
      isPinned: r.isPinned,
      isMuted: muted,
      mutedUntil: r.mutedUntil,
      isArchived: r.isArchived,
      section,
      counterpartId,
      counterpartOnline,
    };
  });
}
