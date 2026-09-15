import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db as defaultDb } from '../../db/index.js';
import {
  chatInvites,
  chatThreadMembers,
  chatThreads,
  chatUserBlocks,
  users,
} from '../../db/schema.js';
import { isConsumerThread, type ThreadType } from './thread-types.js';

type Db = typeof defaultDb;

/**
 * The consumer messenger's thread lifecycle (chat.prodesk.com).
 *
 * Deliberately a separate module from `modules/chat/threads.ts`. That file is
 * entirely org-driven fan-out — a connection forms, a permission is granted, a
 * contractor joins, and threads appear for people who never asked for them. This
 * one is the opposite: every thread here exists because a person chose to talk to
 * another person. Mixing the two would mean every future edit to either has to
 * reason about both.
 */

/** Cap on a single group. Generous, but not "paste in the whole company". */
export const MAX_GROUP_MEMBERS = 256;
/** Cap on one add-people action, so a slip can't create 200 notifications. */
export const MAX_ADD_AT_ONCE = 50;
/** Pinned threads per user. Five is enough to be useful and few enough to scan. */
export const MAX_PINNED = 5;

/* ------------------------------------------------------------------ guards */

/**
 * Throw if either person has blocked the other.
 *
 * Checked in BOTH directions and at BOTH ends — creating a DM and sending into
 * one. A one-directional check would let the blocker keep messaging the person
 * they blocked, which is the wrong half of the feature.
 */
export async function assertNotBlocked(db: Db, aId: string, bId: string): Promise<void> {
  const rows = await db
    .select({ blockerId: chatUserBlocks.blockerId })
    .from(chatUserBlocks)
    .where(
      or(
        and(eq(chatUserBlocks.blockerId, aId), eq(chatUserBlocks.blockedId, bId)),
        and(eq(chatUserBlocks.blockerId, bId), eq(chatUserBlocks.blockedId, aId)),
      ),
    )
    .limit(1);
  if (rows.length > 0) {
    // Deliberately the same message in both directions: "you blocked them" and
    // "they blocked you" must be indistinguishable, or blocking announces itself.
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This conversation is not available.' });
  }
}

/** True if either party has blocked the other. The non-throwing form. */
export async function isBlocked(db: Db, aId: string, bId: string): Promise<boolean> {
  const rows = await db
    .select({ blockerId: chatUserBlocks.blockerId })
    .from(chatUserBlocks)
    .where(
      or(
        and(eq(chatUserBlocks.blockerId, aId), eq(chatUserBlocks.blockedId, bId)),
        and(eq(chatUserBlocks.blockerId, bId), eq(chatUserBlocks.blockedId, aId)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export type ConsumerThreadRow = typeof chatThreads.$inferSelect;

/**
 * Load a thread and refuse unless it is a messenger thread.
 *
 * THIS IS THE MOST IMPORTANT LINE IN THE MODULE. Every mutation the messenger
 * adds — rename, add members, remove, leave, set photo, set admin — is a
 * perfectly reasonable operation that must NEVER be pointed at an org-derived
 * thread. `assertMember` alone would happily allow it: a brand owner IS a member
 * of their `all` thread, so without this guard they could rename it, or eject the
 * agency from it, through an API the workspace UI never exposes.
 *
 * Every new mutation calls this. No exceptions, including the ones that "obviously
 * only make sense for groups".
 */
export async function assertConsumerThread(db: Db, threadId: string): Promise<ConsumerThreadRow> {
  const thread = (
    await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1)
  )[0];
  if (!thread) throw new TRPCError({ code: 'NOT_FOUND' });
  if (!isConsumerThread(thread.type as ThreadType)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This conversation is managed by your workspace and cannot be changed here.',
    });
  }
  return thread;
}

/** Load a `group` thread, refusing DMs (which have no name, photo or members to manage). */
export async function assertGroupThread(db: Db, threadId: string): Promise<ConsumerThreadRow> {
  const thread = await assertConsumerThread(db, threadId);
  if (thread.type !== 'group') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'That only applies to a group.' });
  }
  return thread;
}

/** Throw unless the user administers this group (an explicit admin, or its creator). */
export async function assertThreadAdmin(
  db: Db,
  threadId: string,
  userId: string,
): Promise<ConsumerThreadRow> {
  const thread = await assertGroupThread(db, threadId);
  if (thread.createdBy === userId) return thread;
  const member = (
    await db
      .select({ isAdmin: chatThreadMembers.isAdmin })
      .from(chatThreadMembers)
      .where(and(eq(chatThreadMembers.threadId, threadId), eq(chatThreadMembers.userId, userId)))
      .limit(1)
  )[0];
  if (!member?.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Only a group admin can do that.' });
  }
  return thread;
}

/* --------------------------------------------------------------- creation */

/** Do these two people already share any thread at all? */
async function alreadyConnected(db: Db, aId: string, bId: string): Promise<boolean> {
  const rows = await db
    .select({ threadId: chatThreadMembers.threadId })
    .from(chatThreadMembers)
    .where(inArray(chatThreadMembers.userId, [aId, bId]))
    .groupBy(chatThreadMembers.threadId)
    .having(sql`count(distinct ${chatThreadMembers.userId}) = 2`)
    .limit(1);
  return rows.length > 0;
}

export type DirectThreadResult = {
  threadId: string;
  /** False when an existing DM was returned. */
  created: boolean;
  /** The RECIPIENT's request state — 'pending' means it landed in Requests. */
  requestState: 'accepted' | 'pending';
};

/**
 * The DM between two people, creating it if it does not exist.
 *
 * Race-safe by construction: the `chat_threads_direct_pair_uq` partial unique
 * index (migration 0098) normalises the pair with least()/greatest(), so two
 * people pressing "message" in the same instant both INSERT, one wins, and the
 * loser's `onConflictDoNothing` returns nothing and re-selects the winner's row.
 * Without that index they would each get a thread and neither would ever see the
 * other's messages — a bug that is invisible in testing and unfixable in
 * production.
 *
 * The participants are stored in a stable (min, max) order. Postgres compares
 * uuid by its 16 bytes and the canonical text form is those bytes in order, so a
 * plain JS string compare gives the same ordering the index uses.
 */
export async function getOrCreateDirectThread(
  db: Db,
  meId: string,
  otherId: string,
): Promise<DirectThreadResult> {
  if (meId === otherId) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Use your own Notes thread to message yourself.',
    });
  }
  await assertNotBlocked(db, meId, otherId);

  const [a, b] = meId < otherId ? [meId, otherId] : [otherId, meId];
  const pairWhere = and(
    eq(chatThreads.type, 'direct'),
    eq(chatThreads.participantAId, a),
    eq(chatThreads.participantBId, b),
  );

  const existing = (
    await db.select({ id: chatThreads.id }).from(chatThreads).where(pairWhere).limit(1)
  )[0];
  if (existing) {
    // Re-opening a DM you had declined un-declines it: you went looking for it.
    await db
      .update(chatThreadMembers)
      .set({ requestState: 'accepted', isArchived: false })
      .where(
        and(
          eq(chatThreadMembers.threadId, existing.id),
          eq(chatThreadMembers.userId, meId),
          eq(chatThreadMembers.requestState, 'declined'),
        ),
      );
    return { threadId: existing.id, created: false, requestState: 'accepted' };
  }

  // A first message is only a "request" when these two are strangers. People who
  // already share a brand, an agency or an earlier conversation are not strangers,
  // and routing a colleague's first DM into a Requests queue would be absurd.
  const connected = await alreadyConnected(db, meId, otherId);
  const recipientState: 'accepted' | 'pending' = connected ? 'accepted' : 'pending';

  const [created] = await db
    .insert(chatThreads)
    .values({ type: 'direct', participantAId: a, participantBId: b, createdBy: meId })
    .onConflictDoNothing()
    .returning({ id: chatThreads.id });

  if (!created) {
    // Lost the race — the winner's row is now committed.
    const winner = (
      await db.select({ id: chatThreads.id }).from(chatThreads).where(pairWhere).limit(1)
    )[0];
    if (!winner) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not open that conversation.' });
    return { threadId: winner.id, created: false, requestState: 'accepted' };
  }

  await db
    .insert(chatThreadMembers)
    .values([
      { threadId: created.id, userId: meId, role: 'user', requestState: 'accepted' },
      { threadId: created.id, userId: otherId, role: 'user', requestState: recipientState },
    ])
    .onConflictDoNothing();

  return { threadId: created.id, created: true, requestState: recipientState };
}

/**
 * A group with arbitrary members.
 *
 * Group invitations are NOT requests. Being added to a group by someone is a
 * different act from being cold-messaged by them — there is a shared context, and
 * a group that half its members cannot see is not a group. The spam surface is
 * bounded instead by the block check below and by the member cap.
 */
export async function createGroupThread(
  db: Db,
  creatorId: string,
  opts: { name?: string | null; memberIds: string[]; photoUrl?: string | null },
): Promise<{ threadId: string; memberIds: string[] }> {
  const invited = [...new Set(opts.memberIds.filter((id) => id && id !== creatorId))];
  if (invited.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one other person.' });
  }
  if (invited.length + 1 > MAX_GROUP_MEMBERS) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `A group can hold ${MAX_GROUP_MEMBERS} people.`,
    });
  }

  // Every invitee is checked, and a block anywhere fails the whole create rather
  // than silently dropping that person — a group you think has six people but
  // actually has five is worse than an error you can act on.
  for (const id of invited) await assertNotBlocked(db, creatorId, id);

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, invited));
  if (existing.length !== invited.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'One of those people no longer has an account.' });
  }

  const [created] = await db
    .insert(chatThreads)
    .values({
      type: 'group',
      name: opts.name?.trim() || null,
      photoUrl: opts.photoUrl ?? null,
      createdBy: creatorId,
    })
    .returning({ id: chatThreads.id });

  await db.insert(chatThreadMembers).values([
    // role stays 'user' — see the schema note on why group admin is `isAdmin`
    // and not `role`, and what breaks in the super-admin badge if it isn't.
    { threadId: created.id, userId: creatorId, role: 'user', isAdmin: true, requestState: 'accepted' as const },
    ...invited.map((userId) => ({
      threadId: created.id,
      userId,
      role: 'user',
      requestState: 'accepted' as const,
    })),
  ]);

  return { threadId: created.id, memberIds: [creatorId, ...invited] };
}

/** Current member ids of a thread — the audience for a realtime ping. */
export async function threadMemberIds(db: Db, threadId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: chatThreadMembers.userId })
    .from(chatThreadMembers)
    .where(eq(chatThreadMembers.threadId, threadId));
  return rows.map((r) => r.userId);
}

/* ----------------------------------------------------------------- invites */

/**
 * Claim any messenger invites addressed to a newly-created account and turn each
 * into an open DM.
 *
 * Called from the signup path (`ensurePlatformAdminThread`), which already runs
 * once per new user and is already idempotent. The resulting DMs are ACCEPTED,
 * not pending: someone emailed this person an invitation and they acted on it by
 * signing up, so routing the inviter into a Requests queue would be perverse.
 *
 * Best-effort — a failure here must never block a signup.
 */
export async function claimChatInvites(userId: string, email: string, db: Db = defaultDb): Promise<number> {
  try {
    const pending = await db
      .select({ id: chatInvites.id, invitedBy: chatInvites.invitedBy })
      .from(chatInvites)
      .where(and(eq(chatInvites.email, email.trim().toLowerCase()), eq(chatInvites.status, 'pending')));
    if (pending.length === 0) return 0;

    let opened = 0;
    for (const invite of pending) {
      if (!invite.invitedBy || invite.invitedBy === userId) continue;
      try {
        const { threadId } = await getOrCreateDirectThread(db, invite.invitedBy, userId);
        await db
          .update(chatThreadMembers)
          .set({ requestState: 'accepted' })
          .where(eq(chatThreadMembers.threadId, threadId));
        opened += 1;
      } catch {
        // A block placed between invite and signup, or a since-deleted inviter.
        // Mark the invite claimed anyway so it stops being live.
      }
    }

    await db
      .update(chatInvites)
      .set({ status: 'claimed', claimedBy: userId, claimedAt: new Date() })
      .where(
        inArray(
          chatInvites.id,
          pending.map((p) => p.id),
        ),
      );
    return opened;
  } catch (err) {
    console.error('[chat] claimChatInvites failed', (err as Error).message);
    return 0;
  }
}
