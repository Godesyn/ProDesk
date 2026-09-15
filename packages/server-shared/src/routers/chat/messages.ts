import { z } from 'zod';
import { and, asc, eq, desc, sql, inArray, notInArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { protectedProcedure } from '../../trpc/trpc.js';
import {
  chatThreads,
  chatThreadMembers,
  chatMessages,
  chatMessageReactions,
  users,
  brands,
  agencies,
  staff,
  projects,
} from '../../db/schema.js';
import { scheduleChatDigests } from '../../lib/notify.js';
import {
  recordLockerFile,
  BRAND_AGENCY_THREAD_TYPES,
  BRAND_ONLY_THREAD_TYPES,
  chatThreadKindLabel,
} from '../../modules/locker/record.js';
import { brandHasFeature } from '../../modules/feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../../modules/feature-subscriptions/feature-keys.js';
import {
  CONSUMER_THREAD_TYPES,
  isConsumerThread,
  type ThreadType,
} from '../../modules/chat/thread-types.js';
import { assertNotBlocked } from '../../modules/chat/consumer.js';
import { unfurl } from '../../modules/chat/unfurl.js';
import {
  assertMember,
  meName,
  messageCursorInput,
  messagesAfterCursor,
  messagesBeforeCursor,
  nextMessageCursor,
  prevMessageCursor,
} from './common.js';

/** Message history, sending, thread members, and read state. */
export const messageProcedures = {
  /**
   * Keyset-paginated message history for a thread, newest-first (reversed
   * client-side). No `count()` scan — "has more" comes from over-fetching by one.
   * See `messageCursorInput` for the cursor mechanics.
   *
   * THREE MODES, and the second and third exist so that jumping to a quoted
   * message stays O(page) no matter how far back it is:
   *
   *   default          newest page, then `cursor` walks OLDER.
   *   cursor.dir 'newer'  `cursor` walks NEWER — how you read forward out of a jump.
   *   around:<id>      a window CENTRED on one message, returning BOTH cursors, so
   *                    the client can land on a two-year-old message and then
   *                    scroll either way from there.
   *
   * Without `around`, following a quote means paging backwards until you happen
   * to reach it: thousands of rows and dozens of round trips for a link the user
   * expects to be instant. With it, it is one query.
   */
  messages: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: messageCursorInput,
        /** Centre the first page on this message (ignored once a cursor is set). */
        around: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);

      const inThread = eq(chatMessages.threadId, input.threadId);
      // The direction rides on the cursor — see `messageCursorInput`.
      const direction = input.cursor?.dir ?? 'older';
      let pageRows: (typeof chatMessages.$inferSelect)[];
      let hasOlder: boolean;
      let hasNewer: boolean;

      if (input.around && !input.cursor) {
        // Anchored window. The target itself may have been deleted or moved
        // threads since the quote was written — treat that as "no window" rather
        // than an error, and let the client fall back to the newest page.
        const target = (
          await ctx.db
            .select({ timestamp: chatMessages.timestamp, id: chatMessages.id })
            .from(chatMessages)
            .where(and(inThread, eq(chatMessages.id, input.around)))
            .limit(1)
        )[0];
        if (!target) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'That message is no longer here.' });
        }
        const half = Math.max(1, Math.floor(input.limit / 2));
        const anchor = { timestamp: new Date(target.timestamp).toISOString(), id: target.id };

        // Newer half comes back oldest-first (that is the only way to take the
        // rows ADJACENT to the anchor rather than the newest in the thread), so
        // it is reversed before being joined onto the older half.
        const newer = await ctx.db
          .select()
          .from(chatMessages)
          .where(and(inThread, messagesAfterCursor(anchor)))
          .orderBy(asc(chatMessages.timestamp), asc(chatMessages.id))
          .limit(half + 1);
        const older = await ctx.db
          .select()
          .from(chatMessages)
          .where(and(inThread, messagesBeforeCursor(anchor)))
          .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
          .limit(half + 1);
        const self = (
          await ctx.db.select().from(chatMessages).where(and(inThread, eq(chatMessages.id, target.id))).limit(1)
        )[0];

        hasNewer = newer.length > half;
        hasOlder = older.length > half;
        pageRows = [
          ...(hasNewer ? newer.slice(0, half) : newer).reverse(),
          ...(self ? [self] : []),
          ...(hasOlder ? older.slice(0, half) : older),
        ];
      } else if (direction === 'newer') {
        // Reading forward. Take the rows immediately newer than the cursor
        // (oldest-first), then flip to the newest-first shape every caller expects.
        const rows = await ctx.db
          .select()
          .from(chatMessages)
          .where(and(inThread, messagesAfterCursor(input.cursor)))
          .orderBy(asc(chatMessages.timestamp), asc(chatMessages.id))
          .limit(input.limit + 1);
        hasNewer = rows.length > input.limit;
        pageRows = (hasNewer ? rows.slice(0, input.limit) : rows).reverse();
        // Walking forward never tells us anything about what is older.
        hasOlder = false;
      } else {
        const rows = await ctx.db
          .select()
          .from(chatMessages)
          .where(and(inThread, messagesBeforeCursor(input.cursor)))
          .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
          .limit(input.limit + 1);
        hasOlder = rows.length > input.limit;
        pageRows = hasOlder ? rows.slice(0, input.limit) : rows;
        // The newest page by definition has nothing newer; a cursor page might,
        // but the caller already holds it, so this stays false.
        hasNewer = false;
      }

      // Attach lightweight project cards for messages carrying a projectId.
      const projectIds = [
        ...new Set(pageRows.map((r) => r.projectId).filter((id): id is string => !!id)),
      ];
      const projectMap = new Map<string, { id: string; title: string | null; status: string | null }>();
      if (projectIds.length) {
        const ps = await ctx.db
          .select({ id: projects.id, title: projects.title, status: projects.status })
          .from(projects)
          .where(inArray(projects.id, projectIds));
        for (const p of ps) projectMap.set(p.id, p);
      }

      const items = pageRows.map((m) => ({
        ...m,
        // Serialize to ISO so the client treats timestamps uniformly as strings
        // (matches realtime-mapped + optimistic rows).
        timestamp: new Date(m.timestamp).toISOString(),
        project: m.projectId ? projectMap.get(m.projectId) ?? null : null,
      }));
      return {
        items,
        /** Walk OLDER. Null when this page reached the beginning of the thread. */
        nextCursor: nextMessageCursor(pageRows, hasOlder),
        /** Walk NEWER. Null when this page is already at the live edge. */
        prevCursor: prevMessageCursor(pageRows, hasNewer),
      };
    }),

  /**
   * One-line previews of specific messages, by id.
   *
   * Exists for quoted replies. A reply can point at a message thousands of rows
   * back, and the quote has to READ before you decide whether to follow it —
   * "Attachment" or an empty box is not a quote, it is a dead end. Rather than
   * paging the whole archive in to resolve one line, the client asks for exactly
   * the ids it cannot see.
   *
   * Scoped by an explicit membership subquery: these run as the owner role, which
   * bypasses RLS, so a bare `inArray(id, …)` would hand any caller a line of text
   * from any conversation on the platform given a uuid.
   */
  messagePreviews: protectedProcedure
    .input(z.object({ messageIds: z.array(z.string().uuid()).min(1).max(100) }))
    .query(async ({ ctx, input }) => {
      const myThreads = ctx.db
        .select({ threadId: chatThreadMembers.threadId })
        .from(chatThreadMembers)
        .where(eq(chatThreadMembers.userId, ctx.user.id));

      const rows = await ctx.db
        .select({
          id: chatMessages.id,
          threadId: chatMessages.threadId,
          senderId: chatMessages.senderId,
          senderName: chatMessages.senderName,
          content: chatMessages.content,
          type: chatMessages.type,
          fileName: chatMessages.fileName,
          deletedAt: chatMessages.deletedAt,
        })
        .from(chatMessages)
        .where(
          and(
            inArray(chatMessages.id, [...new Set(input.messageIds)]),
            sql`${chatMessages.threadId} in ${myThreads}`,
          ),
        );
      return rows.map((r) => ({
        ...r,
        // A tombstone still quotes — as a tombstone. Leaking the words of a
        // message its author deleted would make "delete" a lie told through the
        // reply that quoted it.
        content: r.deletedAt ? null : r.content,
      }));
    }),

  /** Members of a thread, each resolved to a role + entity (members dialog). */
  members: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const thread = (
        await ctx.db.select().from(chatThreads).where(eq(chatThreads.id, input.threadId)).limit(1)
      )[0];
      if (!thread) throw new TRPCError({ code: 'NOT_FOUND' });

      const memberRows = await ctx.db
        .select({ member: chatThreadMembers, user: users })
        .from(chatThreadMembers)
        .innerJoin(users, eq(chatThreadMembers.userId, users.id))
        .where(eq(chatThreadMembers.threadId, input.threadId));

      const brand = thread.brandId
        ? (await ctx.db.select().from(brands).where(eq(brands.id, thread.brandId)).limit(1))[0]
        : null;
      const agencyId = thread.agencyIds?.[0];
      const agency = agencyId
        ? (await ctx.db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0]
        : null;

      const brandStaffIds = brand
        ? (
            await ctx.db
              .select({ userId: staff.userId })
              .from(staff)
              .where(and(eq(staff.brandId, brand.id), eq(staff.type, 'brand')))
          ).map((s) => s.userId)
        : [];
      const agencyStaffIds = agency
        ? (
            await ctx.db
              .select({ userId: staff.userId })
              .from(staff)
              .where(and(eq(staff.agencyId, agency.id), eq(staff.type, 'agency')))
          ).map((s) => s.userId)
        : [];

      return memberRows.map(({ member, user }) => {
        let role = user.role === 'individualContractor' ? 'Contractor' : 'Member';
        let entity = '';
        if (brand && (user.id === brand.ownerId || brandStaffIds.includes(user.id))) {
          role = user.id === brand.ownerId ? 'Owner' : 'Staff';
          entity = brand.businessName;
        } else if (agency && (user.id === agency.ownerId || agencyStaffIds.includes(user.id))) {
          role = user.id === agency.ownerId ? 'Owner' : 'Staff';
          entity = agency.businessName;
        }
        return {
          userId: user.id,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email,
          avatar: user.profileUrl,
          role,
          entity,
          memberRole: member.role,
          // Group admin (consumer messenger) — deliberately separate from
          // `memberRole`, which means something else entirely on org threads.
          isAdmin: member.isAdmin,
          // Presence. The messenger docks each member's face on the transcript's
          // spine at their last-read message, and a filled bead means "here now" —
          // so the read position and the online state have to arrive together.
          lastSeenAt: user.lastSeenAt,
        };
      });
    }),

  send: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        // Client-generated message id (optimistic-UI correlation): the optimistic
        // bubble and the confirmed row share it so the client can dedupe them and
        // there's no flicker between "pending" and "sent". Falls back to a DB uuid.
        id: z.string().uuid().optional(),
        content: z.string().optional(),
        type: z.enum(['text', 'image', 'video', 'document']).default('text'),
        fileUrl: z.string().url().optional(),
        fileName: z.string().optional(),
        fileSize: z.number().int().optional(),
        thumbnailUrl: z.string().url().optional(),
        projectId: z.string().uuid().optional(),
        replyToId: z.string().uuid().optional(),
        // Sender's active identity, surfaced on the message (senderRole/Business).
        senderRole: z.string().optional(),
        senderBusinessName: z.string().optional(),
        // This send is a Forward. Stamps `isForwarded` so the destination thread
        // renders the marker. Set by ForwardDialog on EVERY target, including
        // when the message being forwarded was itself forwarded — the marker
        // travels with the content, as it does in every other messenger.
        forwarded: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      // Load the thread once: drives both the notification guard (AI threads are
      // notification/email-exempt) and the locker mirroring below.
      const thread = (
        await ctx.db
          .select({
            type: chatThreads.type,
            brandId: chatThreads.brandId,
            agencyIds: chatThreads.agencyIds,
            participantAId: chatThreads.participantAId,
            participantBId: chatThreads.participantBId,
          })
          .from(chatThreads)
          .where(eq(chatThreads.id, input.threadId))
          .limit(1)
      )[0];
      const isAiThread = thread?.type === 'ai';
      const isConsumer = !!thread && isConsumerThread(thread.type as ThreadType);

      if (isConsumer) {
        // Blocking has to bite HERE as well as at thread creation: a DM created
        // before a block still exists, and its composer is still on screen.
        if (thread.type === 'direct') {
          const otherId =
            thread.participantAId === ctx.user.id ? thread.participantBId : thread.participantAId;
          if (otherId) await assertNotBlocked(ctx.db, ctx.user.id, otherId);
        }
        // REPLYING ACCEPTS. Someone who answers a stranger has decided, and making
        // them also press Accept would be asking a question they just answered.
        await ctx.db
          .update(chatThreadMembers)
          .set({ requestState: 'accepted' })
          .where(
            and(
              eq(chatThreadMembers.threadId, input.threadId),
              eq(chatThreadMembers.userId, ctx.user.id),
              eq(chatThreadMembers.requestState, 'pending'),
            ),
          );
      }
      // Feature Subscription gate (defense in depth — the AI flow normally goes
      // through /api/ai/chat): posting into an AI thread requires the brand owner
      // to hold an active Growth Strategy subscription.
      if (isAiThread && thread?.brandId) {
        const entitled = await brandHasFeature(ctx.db, thread.brandId, FEATURE_KEYS.AI_GROWTH_STRATEGY);
        if (!entitled) {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'subscription_required' });
        }
      }
      const [message] = await ctx.db
        .insert(chatMessages)
        .values({
          ...(input.id ? { id: input.id } : {}),
          threadId: input.threadId,
          senderId: ctx.user.id,
          senderName: meName(ctx.user),
          senderAvatar: ctx.user.profileUrl,
          senderRole: input.senderRole,
          senderBusinessName: input.senderBusinessName,
          content: input.content,
          type: input.type,
          fileUrl: input.fileUrl,
          fileName: input.fileName,
          fileSize: input.fileSize,
          thumbnailUrl: input.thumbnailUrl,
          projectId: input.projectId,
          replyToId: input.replyToId,
          isForwarded: input.forwarded ?? false,
        })
        .returning();

      const preview =
        input.content ||
        (input.type === 'image' ? '📷 Photo' : input.type === 'video' ? '🎬 Video' : input.fileName) ||
        'Attachment';
      // MONOTONIC, and the guard is not defensive programming.
      //
      // Two sends land concurrently; both read their own row and write the
      // thread's preview, and whichever transaction commits LAST wins regardless
      // of which message is actually newer. The visible result is an inbox whose
      // preview line and sort position flap backwards during exactly the burst
      // that makes people look at it — and since `lastMessageAt` is also the
      // keyset sort expression, a thread can jump DOWN the list while it is being
      // actively written to. Making the write conditional means the newest
      // message always wins, whatever order the transactions finish in.
      await ctx.db
        .update(chatThreads)
        .set({
          lastMessage: preview,
          lastMessageAt: message.timestamp,
          // Drives the messenger row's "You: …" preview prefix. Harmless for
          // workspace threads, which never read it.
          lastMessageSenderId: ctx.user.id,
        })
        .where(
          and(
            eq(chatThreads.id, input.threadId),
            // `sql` with an explicit cast rather than a JS Date in a raw
            // fragment — postgres.js cannot serialise a Date inside sql``.
            sql`(${chatThreads.lastMessageAt} is null or ${chatThreads.lastMessageAt} <= ${new Date(message.timestamp).toISOString()}::timestamptz)`,
          ),
        );
      // AI threads are notification/email-exempt: don't bump unread counts or
      // schedule digests. (The AI flow goes through /api/ai/chat, not here, but
      // this guards any path that posts into an AI thread.)
      if (!isAiThread) {
        const others = await ctx.db
          .update(chatThreadMembers)
          .set({ unreadCount: sql`${chatThreadMembers.unreadCount} + 1` })
          .where(
            and(
              eq(chatThreadMembers.threadId, input.threadId),
              sql`${chatThreadMembers.userId} <> ${ctx.user.id}`,
            ),
          )
          .returning({
            userId: chatThreadMembers.userId,
            requestState: chatThreadMembers.requestState,
            mutedUntil: chatThreadMembers.mutedUntil,
            isArchived: chatThreadMembers.isArchived,
          });
        // ANTI-SPAM GATE 1 OF 2, and it is load-bearing. Anyone can be found by
        // email address, so a muted thread — or one the recipient archived, which
        // is the same thing (routers/chat/consumer.ts#decorateThreads) — notifies
        // nobody. (Gate 2 is in the digest worker, which recomputes unread at fire
        // time and would otherwise re-introduce exactly this.)
        //
        // A PENDING REQUEST NOW SCHEDULES A DIGEST, where it used to be dropped
        // here. The gate has moved rather than gone: the worker never puts a
        // stranger's words or name in the email, only the number of people
        // waiting, so this cannot be used to deliver a message to someone who has
        // not accepted you. A `declined` member stays silent forever.
        const notifiable = others.filter(
          (o) =>
            o.requestState !== 'declined' &&
            !o.isArchived &&
            (!o.mutedUntil || o.mutedUntil.getTime() <= Date.now()),
        );
        // Schedule a debounced digest email for each recipient (the worker checks
        // email_unsubscribes + whether the thread is still unread at fire time).
        // Live delivery is handled by Supabase Realtime: this send bumps
        // chat_threads.last_message(_at) above and chat_thread_members.unread_count
        // below, both of which are in the supabase_realtime publication
        // (server/sql/rls.sql), so subscribed clients refresh their thread list +
        // unread badge without an explicit broadcast call.
        await scheduleChatDigests(notifiable.map((o) => o.userId));
      }

      // Document Locker: a chat attachment in a brand thread is mirrored into the
      // brand's locker. brand↔agency thread → Agency Documents (that agency);
      // brand-only thread → Private Documents. Threads without a brand are skipped.
      if (input.fileUrl) {
        const isBrandAgency = !!thread && BRAND_AGENCY_THREAD_TYPES.has(thread.type as string);
        const isBrandOnly = !!thread && BRAND_ONLY_THREAD_TYPES.has(thread.type as string);
        if (thread?.brandId && (isBrandAgency || isBrandOnly)) {
          // A group ('all') thread may involve several agencies — attribute the
          // file to ALL of them so it shows in each agency's documents.
          const agencyIds = isBrandAgency ? (thread.agencyIds ?? []).filter(Boolean) : [];
          await recordLockerFile(ctx.db, {
            brandId: thread.brandId,
            url: input.fileUrl,
            name: input.fileName ?? 'Attachment',
            agencyId: agencyIds[0] ?? null,
            agencyIds,
            uploadedBy: ctx.user.id,
            size: input.fileSize ?? null,
            type: input.type,
            category: 'chat',
            source:
              input.senderRole === 'brand' || input.senderRole === 'agency'
                ? input.senderRole
                : agencyIds[0]
                  ? 'agency'
                  : 'brand',
            note: `Sent by ${message.senderName ?? 'a member'} in the ${chatThreadKindLabel(thread.type as string)}`,
            isPrivate: isBrandOnly,
            sourceType: 'chat',
            sourceId: message.id,
          }).catch((e) => console.error('[chat] locker copy failed', (e as Error).message));
        }
      }
      return message;
    }),

  /**
   * Mark the thread read for the current user: zero their unread counter and
   * advance their last-read pointer to the newest message. (Per-message readBy
   * arrays are not modeled in this schema — see deferred.)
   */
  markRead: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      // Ordered by the SAME compound key the transcript pages on — `(timestamp,
      // id)`, not timestamp alone. Under a burst several messages routinely share
      // a timestamp, and picking an arbitrary one of them as "newest" parks every
      // other member's read bead on a message that is not the last one. The
      // pointer then disagrees with the order everyone is reading in, which shows
      // up as a double tick that never quite arrives.
      const newest = (
        await ctx.db
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(eq(chatMessages.threadId, input.threadId))
          .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
          .limit(1)
      )[0];
      await ctx.db
        .update(chatThreadMembers)
        .set({ unreadCount: 0, lastReadMessageId: newest?.id, lastReadAt: new Date() })
        .where(and(eq(chatThreadMembers.threadId, input.threadId), eq(chatThreadMembers.userId, ctx.user.id)));
      return { ok: true };
    }),

  /** Last-read pointers of every other member — drives read-receipt ticks. */
  readState: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const rows = await ctx.db
        .select({
          userId: chatThreadMembers.userId,
          lastReadMessageId: chatThreadMembers.lastReadMessageId,
          lastReadAt: chatThreadMembers.lastReadAt,
        })
        .from(chatThreadMembers)
        .where(
          and(
            eq(chatThreadMembers.threadId, input.threadId),
            sql`${chatThreadMembers.userId} <> ${ctx.user.id}`,
          ),
        );
      return rows;
    }),

  /**
   * Total unread across all of the user's threads — sidebar badge.
   *
   * `surface` defaults to 'workspace' so every existing caller (the FAB badge in
   * the main app, the dashboard dock) keeps returning exactly the number it
   * returned before the messenger existed. Consumer threads would otherwise
   * silently inflate a badge in an app that cannot open them.
   */
  totalUnread: protectedProcedure
    .input(z.object({ surface: z.enum(['workspace', 'messenger']).default('workspace') }).optional())
    .query(async ({ ctx, input }) => {
      const surface = input?.surface ?? 'workspace';
      const conds = [
        eq(chatThreadMembers.userId, ctx.user.id),
        eq(chatThreadMembers.isArchived, false),
      ];
      if (surface === 'messenger') {
        conds.push(inArray(chatThreads.type, CONSUMER_THREAD_TYPES));
        conds.push(sql`${chatThreadMembers.requestState} = 'accepted'`);
      } else {
        // notInArray, not a raw `<> all(...)`: drizzle binds a JS array in a raw
        // sql`` fragment as a parenthesised tuple, which postgres refuses to cast
        // to thread_type[] (42846) — the whole badge query then 500s.
        conds.push(notInArray(chatThreads.type, CONSUMER_THREAD_TYPES));
      }
      const [{ value }] = await ctx.db
        .select({ value: sql<number>`coalesce(sum(${chatThreadMembers.unreadCount}), 0)::int` })
        .from(chatThreadMembers)
        .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
        .where(and(...conds));
      return { total: value ?? 0 };
    }),

  /* ─────────────────────────────────────────────────────────────────────────
   * Consumer messenger message actions (clients/chat)
   *
   * These live here rather than in consumer.ts so the client surface stays flat
   * and every message write sits in one file. They are guarded on authorship
   * rather than on thread type: editing your own message is a reasonable thing
   * to allow anywhere, and neither action can affect anyone else's content.
   * ──────────────────────────────────────────────────────────────────────── */

  /**
   * Edit your own message, within a window.
   *
   * The window exists because an edit is invisible to anyone who already read
   * the message. Fifteen minutes covers "I typed the wrong number"; it does not
   * cover rewriting what you said last week and pretending you always said it.
   */
  editMessage: protectedProcedure
    .input(z.object({ messageId: z.string().uuid(), content: z.string().min(1).max(8000) }))
    .mutation(async ({ ctx, input }) => {
      const existing = (
        await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, input.messageId)).limit(1)
      )[0];
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertMember(ctx, existing.threadId);
      if (existing.senderId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own messages.' });
      }
      if (existing.deletedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That message was deleted.' });
      }
      if (existing.type !== 'text') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only text messages can be edited.' });
      }
      const ageMs = Date.now() - new Date(existing.timestamp).getTime();
      if (ageMs > 15 * 60_000) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That message is too old to edit.' });
      }

      const [updated] = await ctx.db
        .update(chatMessages)
        .set({ content: input.content, editedAt: new Date() })
        .where(eq(chatMessages.id, input.messageId))
        .returning();

      // Keep the thread preview honest when the edited message is the latest one.
      //
      // `eq(column, date)`, NOT sql`${column} = ${date}`. A JS Date interpolated
      // into a raw drizzle fragment reaches postgres.js as a bare object it
      // cannot serialise, and the whole statement throws — which is what made
      // editing a message fail AFTER the message itself had already been
      // rewritten. `eq` goes through the column's own timestamptz mapper.
      await ctx.db
        .update(chatThreads)
        .set({ lastMessage: input.content })
        .where(
          and(
            eq(chatThreads.id, existing.threadId),
            eq(chatThreads.lastMessageAt, existing.timestamp),
          ),
        );
      return updated;
    }),

  /**
   * Delete your own message. SOFT, always.
   *
   * A hard DELETE would orphan every reply that quotes it and the Document
   * Locker row that mirrors its attachment, and realtime ships only the primary
   * key on a delete, so subscribers could not even tell which thread changed. The
   * transcript renders a tombstone instead — which is also simply better than a
   * hole in a conversation two people are reading.
   */
  deleteMessage: protectedProcedure
    .input(z.object({ messageId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = (
        await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, input.messageId)).limit(1)
      )[0];
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertMember(ctx, existing.threadId);
      if (existing.senderId !== ctx.user.id) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only delete your own messages.' });
      }
      if (existing.deletedAt) return { ok: true as const };

      await ctx.db
        .update(chatMessages)
        .set({
          content: null,
          fileUrl: null,
          fileName: null,
          thumbnailUrl: null,
          fileSize: null,
          deletedAt: new Date(),
          deletedBy: ctx.user.id,
        })
        .where(eq(chatMessages.id, input.messageId));

      // `eq`, not a raw sql`` fragment — a JS Date inside one reaches postgres.js
      // as an object it cannot serialise and throws. Same trap as editMessage.
      await ctx.db
        .update(chatThreads)
        .set({ lastMessage: 'Message deleted' })
        .where(
          and(
            eq(chatThreads.id, existing.threadId),
            eq(chatThreads.lastMessageAt, existing.timestamp),
          ),
        );
      return { ok: true as const };
    }),

  /** Reactions on a message. Toggling is idempotent per (message, user, emoji). */
  reactions: protectedProcedure
    .input(z.object({ threadId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);
      const rows = await ctx.db
        .select({
          messageId: chatMessageReactions.messageId,
          emoji: chatMessageReactions.emoji,
          userId: chatMessageReactions.userId,
        })
        .from(chatMessageReactions)
        .where(eq(chatMessageReactions.threadId, input.threadId));
      return rows;
    }),

  toggleReaction: protectedProcedure
    .input(z.object({ messageId: z.string().uuid(), emoji: z.string().min(1).max(16) }))
    .mutation(async ({ ctx, input }) => {
      const message = (
        await ctx.db
          .select({ id: chatMessages.id, threadId: chatMessages.threadId, deletedAt: chatMessages.deletedAt })
          .from(chatMessages)
          .where(eq(chatMessages.id, input.messageId))
          .limit(1)
      )[0];
      if (!message) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertMember(ctx, message.threadId);
      if (message.deletedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That message was deleted.' });
      }

      const where = and(
        eq(chatMessageReactions.messageId, input.messageId),
        eq(chatMessageReactions.userId, ctx.user.id),
        eq(chatMessageReactions.emoji, input.emoji),
      );
      const existing = (
        await ctx.db.select({ emoji: chatMessageReactions.emoji }).from(chatMessageReactions).where(where).limit(1)
      )[0];

      if (existing) {
        await ctx.db.delete(chatMessageReactions).where(where);
        return { reacted: false as const };
      }
      await ctx.db
        .insert(chatMessageReactions)
        .values({
          messageId: input.messageId,
          userId: ctx.user.id,
          emoji: input.emoji,
          // Denormalised so the browser's per-thread realtime filter can see it.
          threadId: message.threadId,
        })
        .onConflictDoNothing();
      return { reacted: true as const };
    }),

  /**
   * Search message text across every thread the caller is in, or one thread.
   *
   * Scoped by an explicit membership subquery rather than by RLS — these queries
   * run as the owner role, which bypasses RLS entirely (see docs/agents: the
   * backend is the enforcement boundary, the policies are for Realtime).
   */
  searchMessages: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(2).max(200),
        threadId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: messageCursorInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.threadId) await assertMember(ctx, input.threadId);

      const myThreads = ctx.db
        .select({ threadId: chatThreadMembers.threadId })
        .from(chatThreadMembers)
        .where(
          and(
            eq(chatThreadMembers.userId, ctx.user.id),
            sql`${chatThreadMembers.requestState} <> 'declined'`,
          ),
        );

      const conds = [
        input.threadId
          ? eq(chatMessages.threadId, input.threadId)
          : sql`${chatMessages.threadId} in ${myThreads}`,
        sql`${chatMessages.deletedAt} is null`,
        sql`${chatMessages.content} ilike ${'%' + input.query.replace(/[%_\\]/g, '\\$&') + '%'}`,
      ];
      const beforeCursor = messagesBeforeCursor(input.cursor);
      if (beforeCursor) conds.push(beforeCursor);

      const rows = await ctx.db
        .select({ message: chatMessages, threadName: chatThreads.name, threadType: chatThreads.type })
        .from(chatMessages)
        .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
        .where(and(...conds))
        .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items: pageRows.map((r) => ({
          id: r.message.id,
          threadId: r.message.threadId,
          threadName: r.threadName,
          threadType: r.threadType,
          senderId: r.message.senderId,
          senderName: r.message.senderName,
          content: r.message.content,
          timestamp: new Date(r.message.timestamp).toISOString(),
        })),
        nextCursor: nextMessageCursor(
          pageRows.map((r) => r.message),
          hasMore,
        ),
      };
    }),

  /**
   * Everything ever attached to one thread, newest-first, split by kind.
   *
   * The alternative — filtering the transcript the client already holds — is
   * wrong for the same reason the inbox is not a lookup into the thread list: the
   * transcript is a paginated WINDOW, so "all the files in this conversation"
   * would silently mean "the files in the last thirty messages", and the file
   * someone is looking for is by definition the one they have scrolled past.
   *
   * Two kinds rather than a type filter the caller composes:
   *   media — images and video, which are looked at, and are shown as a grid.
   *   files — everything else with a payload, which is opened, and is a list.
   * That split is a product decision (they are different questions, asked at
   * different times), so it is made once, here, rather than in each caller.
   */
  threadAttachments: protectedProcedure
    .input(
      z.object({
        threadId: z.string().uuid(),
        kind: z.enum(['media', 'files']),
        limit: z.number().int().min(1).max(100).default(48),
        cursor: messageCursorInput,
      }),
    )
    .query(async ({ ctx, input }) => {
      await assertMember(ctx, input.threadId);

      const conds = [
        eq(chatMessages.threadId, input.threadId),
        sql`${chatMessages.deletedAt} is null`,
        sql`${chatMessages.fileUrl} is not null`,
        input.kind === 'media'
          ? inArray(chatMessages.type, ['image', 'video'])
          : // NOT `= 'document'`: anything carrying a payload that isn't a
            // picture belongs in Files, including message types added later.
            sql`${chatMessages.type} not in ('image', 'video')`,
      ];
      const beforeCursor = messagesBeforeCursor(input.cursor);
      if (beforeCursor) conds.push(beforeCursor);

      const rows = await ctx.db
        .select({
          id: chatMessages.id,
          type: chatMessages.type,
          senderId: chatMessages.senderId,
          senderName: chatMessages.senderName,
          fileUrl: chatMessages.fileUrl,
          fileName: chatMessages.fileName,
          fileSize: chatMessages.fileSize,
          thumbnailUrl: chatMessages.thumbnailUrl,
          timestamp: chatMessages.timestamp,
        })
        .from(chatMessages)
        .where(and(...conds))
        .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items: pageRows.map((r) => ({
          ...r,
          timestamp: new Date(r.timestamp).toISOString(),
        })),
        nextCursor: nextMessageCursor(pageRows, hasMore),
      };
    }),

  /**
   * Unfurl a URL someone pasted into a conversation, for the preview card.
   *
   * A QUERY, so react-query dedupes the twenty rows quoting the same link into
   * one request and caches the answer for the session; the server caches it
   * again across users (modules/chat/unfurl.ts). Authenticated, because an open
   * unfurl endpoint is a URL-fetching service for anyone who finds it.
   *
   * Returns `null` rather than throwing when a link has no card — that is the
   * ordinary outcome for a private page, a PDF or a site that is down, and the
   * client draws a plain link for it.
   */
  linkPreview: protectedProcedure
    .input(z.object({ url: z.string().url().max(2048) }))
    .query(async ({ input }) => unfurl(input.url)),
};
