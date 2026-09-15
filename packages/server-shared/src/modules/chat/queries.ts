import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { chatMessages, chatThreadMembers, chatThreads, users } from '../../db/schema.js';
import { inferThreadName } from '../../routers/chat/display.js';
import { MESSENGER_THREAD_TYPES, type ThreadType } from './thread-types.js';

/**
 * Read cores for the messenger, shared by tRPC procedures and by the assistant's
 * tools (modules/ai/tools/messenger.ts).
 *
 * The house rule for this file: AUTHORISATION STAYS IN THE CALLER, but SCOPE
 * lives here. Every function takes the acting user's id and constrains its query
 * to what that user is a member of, so a caller cannot accidentally widen it by
 * passing the wrong thread id — the membership join is not optional, it is the
 * FROM clause. That matters more than usual for the AI tools: the backend runs
 * as owner and bypasses RLS, so a query that forgets the join returns the whole
 * platform's conversations.
 *
 * What is deliberately NOT here is any lookup keyed on an email address.
 * Resolving "does this address have an account" is a membership oracle and is
 * answered in exactly one place — routers/chat/directory.ts#discoverByEmail —
 * behind three rate-limit budgets and a single indistinguishable negative
 * result. Nothing in this file may become a second door to that question.
 */

/** A conversation as the assistant sees it: identity and state, never content. */
export interface ConversationSummary {
  threadId: string;
  name: string;
  type: ThreadType;
  /** Which product the conversation belongs to — they behave differently. */
  surface: 'messenger' | 'workspace';
  memberCount: number;
  /** Everyone else in it, by name. The handle the assistant refers to them by. */
  otherMembers: { userId: string; name: string }[];
  unreadCount: number;
  lastMessage: string | null;
  lastMessageAt: string | null;
  isArchived: boolean;
  isMuted: boolean;
  isPinned: boolean;
  /** True when the caller can rename the group / manage its members. */
  iAmAdmin: boolean;
}

function surfaceOf(type: ThreadType): 'messenger' | 'workspace' {
  return MESSENGER_THREAD_TYPES.includes(type) ? 'messenger' : 'workspace';
}

/**
 * The conversations a user is in.
 *
 * The `ai` type is excluded and always will be: that is the thread the assistant
 * is speaking in, and listing it invites the model to reason about its own
 * transcript as if it were a third party's conversation.
 *
 * Declined requests are excluded too — a declined request is the user's way of
 * saying the conversation does not exist for them, and the assistant honouring
 * that is the whole point of the queue.
 */
export async function listConversationsFor(
  db: DB,
  userId: string,
  opts: { query?: string; includeArchived?: boolean; limit?: number } = {},
): Promise<ConversationSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 60);
  const conditions = [
    eq(chatThreadMembers.userId, userId),
    ne(chatThreads.type, 'ai'),
    sql`${chatThreadMembers.requestState} <> 'declined'`,
  ];
  if (!opts.includeArchived) conditions.push(eq(chatThreadMembers.isArchived, false));

  const rows = await db
    .select({ thread: chatThreads, member: chatThreadMembers })
    .from(chatThreadMembers)
    .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
    .where(and(...conditions))
    .orderBy(desc(chatThreads.lastMessageAt))
    // Over-fetch, because the name filter below can only be applied after the
    // display name is resolved — a `direct` thread has no stored name at all, it
    // is derived from who is in it.
    .limit(opts.query ? limit * 4 : limit);

  if (!rows.length) return [];

  const threadIds = rows.map((r) => r.thread.id);
  const roster = await rosterFor(db, threadIds);

  const needle = opts.query?.trim().toLowerCase();
  const out: ConversationSummary[] = [];
  for (const row of rows) {
    const name = await inferThreadName(db, row.thread, userId);
    const people = roster.get(row.thread.id) ?? [];
    if (needle) {
      const hay = [name, ...people.map((p) => p.name)].join(' ').toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push({
      threadId: row.thread.id,
      name,
      type: row.thread.type as ThreadType,
      surface: surfaceOf(row.thread.type as ThreadType),
      memberCount: people.length + 1,
      otherMembers: people.filter((p) => p.userId !== userId),
      unreadCount: row.member.unreadCount ?? 0,
      lastMessage: row.thread.lastMessage ?? null,
      lastMessageAt: row.thread.lastMessageAt
        ? new Date(row.thread.lastMessageAt).toISOString()
        : null,
      isArchived: row.member.isArchived,
      isMuted: !!row.member.mutedUntil && new Date(row.member.mutedUntil) > new Date(),
      isPinned: row.member.isPinned,
      iAmAdmin: row.member.isAdmin,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Everyone in each of these threads, in one query. */
async function rosterFor(
  db: DB,
  threadIds: string[],
): Promise<Map<string, { userId: string; name: string }[]>> {
  const map = new Map<string, { userId: string; name: string }[]>();
  if (!threadIds.length) return map;
  const rows = await db
    .select({
      threadId: chatThreadMembers.threadId,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
    })
    .from(chatThreadMembers)
    .innerJoin(users, eq(chatThreadMembers.userId, users.id))
    .where(inArray(chatThreadMembers.threadId, threadIds));
  for (const r of rows) {
    const list = map.get(r.threadId) ?? [];
    list.push({
      userId: r.userId,
      // Email as the last resort only. It is the person's own address and the
      // caller shares a conversation with them, so it is not a disclosure — but
      // a name is what a human would use, so it wins whenever there is one.
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email,
    });
    map.set(r.threadId, list);
  }
  return map;
}

/** Is this user a member of this thread? The precondition for every read below. */
export async function isThreadMember(db: DB, userId: string, threadId: string): Promise<boolean> {
  const [row] = await db
    .select({ threadId: chatThreadMembers.threadId })
    .from(chatThreadMembers)
    .where(and(eq(chatThreadMembers.threadId, threadId), eq(chatThreadMembers.userId, userId)))
    .limit(1);
  return !!row;
}

export interface ConversationTranscript {
  threadId: string;
  name: string;
  type: ThreadType;
  members: { userId: string; name: string }[];
  /** Oldest-first, so the assistant reads it the way a person would. */
  messages: {
    id: string;
    senderName: string | null;
    /** True when the acting user wrote it. */
    mine: boolean;
    text: string | null;
    /** Set for an attachment: what it is, so the model doesn't invent content. */
    attachment: { kind: string; name: string | null } | null;
    at: string;
  }[];
}

/**
 * The recent run of one conversation.
 *
 * Deleted messages come back as a tombstone rather than being filtered out: a
 * hole in a transcript changes what the surrounding messages appear to mean, and
 * the model has no way to know it is reading around one.
 */
export async function readConversationFor(
  db: DB,
  userId: string,
  threadId: string,
  limit = 30,
): Promise<ConversationTranscript | null> {
  if (!(await isThreadMember(db, userId, threadId))) return null;
  const [thread] = await db
    .select()
    .from(chatThreads)
    .where(eq(chatThreads.id, threadId))
    .limit(1);
  if (!thread) return null;

  const rows = await db
    .select({
      id: chatMessages.id,
      senderId: chatMessages.senderId,
      senderName: chatMessages.senderName,
      content: chatMessages.content,
      type: chatMessages.type,
      fileName: chatMessages.fileName,
      deletedAt: chatMessages.deletedAt,
      timestamp: chatMessages.timestamp,
    })
    .from(chatMessages)
    .where(eq(chatMessages.threadId, threadId))
    .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
    .limit(Math.min(Math.max(limit, 1), 100));

  const roster = (await rosterFor(db, [threadId])).get(threadId) ?? [];
  return {
    threadId,
    name: await inferThreadName(db, thread, userId),
    type: thread.type as ThreadType,
    members: roster,
    messages: rows.reverse().map((m) => ({
      id: m.id,
      senderName: m.senderName,
      mine: m.senderId === userId,
      text: m.deletedAt ? '(deleted)' : m.content,
      attachment:
        !m.deletedAt && m.type !== 'text' && m.type !== 'system'
          ? { kind: m.type, name: m.fileName }
          : null,
      at: new Date(m.timestamp).toISOString(),
    })),
  };
}

/** A hit from a cross-conversation text search. */
export interface MessageHit {
  messageId: string;
  threadId: string;
  threadName: string;
  senderName: string | null;
  text: string;
  at: string;
}

/**
 * Find a message by its words, across every conversation the user is in.
 *
 * Scoped by an explicit membership subquery rather than by RLS — these queries
 * run as the owner role, which bypasses RLS entirely.
 */
export async function searchMessagesFor(
  db: DB,
  userId: string,
  query: string,
  opts: { threadId?: string; limit?: number } = {},
): Promise<MessageHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 40);

  const myThreads = db
    .select({ threadId: chatThreadMembers.threadId })
    .from(chatThreadMembers)
    .where(
      and(
        eq(chatThreadMembers.userId, userId),
        sql`${chatThreadMembers.requestState} <> 'declined'`,
      ),
    );

  const rows = await db
    .select({ message: chatMessages, thread: chatThreads })
    .from(chatMessages)
    .innerJoin(chatThreads, eq(chatMessages.threadId, chatThreads.id))
    .where(
      and(
        opts.threadId
          ? eq(chatMessages.threadId, opts.threadId)
          : sql`${chatMessages.threadId} in ${myThreads}`,
        ne(chatThreads.type, 'ai'),
        sql`${chatMessages.deletedAt} is null`,
        // Escape the LIKE metacharacters — a search for "50%" must not become a
        // wildcard that matches the whole table.
        sql`${chatMessages.content} ilike ${'%' + needle.replace(/[%_\\]/g, '\\$&') + '%'}`,
      ),
    )
    .orderBy(desc(chatMessages.timestamp))
    .limit(limit);

  // A thread id the caller passed by hand still has to be one of theirs.
  if (opts.threadId && !(await isThreadMember(db, userId, opts.threadId))) return [];

  return Promise.all(
    rows.map(async (r) => ({
      messageId: r.message.id,
      threadId: r.message.threadId,
      threadName: await inferThreadName(db, r.thread, userId),
      senderName: r.message.senderName,
      text: r.message.content ?? '',
      at: new Date(r.message.timestamp).toISOString(),
    })),
  );
}

/** A first message from someone the user shares no other conversation with. */
export interface PendingRequest {
  threadId: string;
  fromName: string;
  fromUserId: string | null;
  preview: string | null;
  at: string | null;
}

export async function listRequestsFor(db: DB, userId: string): Promise<PendingRequest[]> {
  const rows = await db
    .select({ thread: chatThreads })
    .from(chatThreadMembers)
    .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreadMembers.userId, userId),
        sql`${chatThreadMembers.requestState} = 'pending'`,
      ),
    )
    .orderBy(desc(chatThreads.createdAt))
    .limit(30);
  if (!rows.length) return [];

  const senderIds = [
    ...new Set(
      rows
        .map((r) =>
          r.thread.participantAId === userId ? r.thread.participantBId : r.thread.participantAId,
        )
        .filter((id): id is string => !!id),
    ),
  ];
  const people = senderIds.length
    ? await db
        .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email })
        .from(users)
        .where(inArray(users.id, senderIds))
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  return rows.map((r) => {
    const otherId =
      r.thread.participantAId === userId ? r.thread.participantBId : r.thread.participantAId;
    const person = otherId ? byId.get(otherId) : null;
    return {
      threadId: r.thread.id,
      fromName:
        [person?.firstName, person?.lastName].filter(Boolean).join(' ').trim() ||
        person?.email ||
        'Someone',
      fromUserId: otherId ?? null,
      preview: r.thread.lastMessage ?? null,
      at: r.thread.createdAt ? new Date(r.thread.createdAt).toISOString() : null,
    };
  });
}

/** Someone the user already shares at least one conversation with. */
export interface KnownPerson {
  userId: string;
  name: string;
  /** How many conversations they share — a rough "how well do you know them". */
  sharedConversations: number;
}

/**
 * The people a user can already reach.
 *
 * This exists so the assistant can act on "add Sam to the design group" without
 * anyone typing an email address, and it is safe precisely because it is derived
 * from conversations that already exist: it introduces nobody. Resolving a
 * STRANGER stays where it belongs — the client asks discoverByEmail when the
 * user confirms the card, so the lookup happens through the same rate-limited
 * door as the UI, as a deliberate act.
 */
export async function listKnownPeopleFor(
  db: DB,
  userId: string,
  opts: { query?: string; limit?: number } = {},
): Promise<KnownPerson[]> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 100);
  const mine = db
    .select({ threadId: chatThreadMembers.threadId })
    .from(chatThreadMembers)
    .where(eq(chatThreadMembers.userId, userId));

  const rows = await db
    .select({
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      shared: sql<number>`count(distinct ${chatThreadMembers.threadId})::int`,
    })
    .from(chatThreadMembers)
    .innerJoin(users, eq(chatThreadMembers.userId, users.id))
    .where(
      and(
        sql`${chatThreadMembers.threadId} in ${mine}`,
        ne(chatThreadMembers.userId, userId),
      ),
    )
    .groupBy(users.id, users.firstName, users.lastName, users.email)
    .orderBy(desc(sql`count(distinct ${chatThreadMembers.threadId})`), asc(users.firstName))
    .limit(limit * 2);

  const needle = opts.query?.trim().toLowerCase();
  return rows
    .map((r) => ({
      userId: r.userId,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || r.email,
      sharedConversations: r.shared,
    }))
    .filter((p) => !needle || p.name.toLowerCase().includes(needle))
    .slice(0, limit);
}

/** Resolve a set of thread ids to display names, for card copy. Membership-scoped. */
export async function nameThreadsFor(
  db: DB,
  userId: string,
  threadIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!threadIds.length) return out;
  const rows = await db
    .select({ thread: chatThreads })
    .from(chatThreadMembers)
    .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreadMembers.userId, userId),
        inArray(chatThreadMembers.threadId, threadIds),
      ),
    );
  for (const r of rows) out.set(r.thread.id, await inferThreadName(db, r.thread, userId));
  return out;
}
