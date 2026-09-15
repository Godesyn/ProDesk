import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { protectedProcedure } from '../../trpc/trpc.js';
import { chatInvites, chatUserBlocks, users } from '../../db/schema.js';
import { enqueueEmail } from '../../lib/notify.js';
import { assertRateLimit, assertRateLimits, DAY, MINUTE } from '../../lib/rate-limit.js';
import { isBlocked } from '../../modules/chat/consumer.js';

/**
 * Finding a person, and refusing to find them.
 *
 * This is the only procedure in the platform that answers "does this email
 * address have an account?", and that makes it the one an attacker would want. So
 * the whole module is written around a single rule:
 *
 *   THE ANSWER MUST BE INDISTINGUISHABLE FOR "no account", "opted out", and
 *   "they blocked you".
 *
 * If those three differ in any way — a different message, a different shape, a
 * measurably different latency — then the opt-out advertises exactly what it
 * exists to hide, and the directory becomes a membership oracle.
 */

/** What a successful lookup may return. Nothing may be added to this. */
export type DiscoverResult =
  | { found: true; user: { id: string; name: string; avatarUrl: string | null } }
  | { found: false; canInvite: true };

/** The single negative answer. One object, three very different causes. */
const NOT_FOUND: DiscoverResult = { found: false, canInvite: true };

export const directoryProcedures = {
  /**
   * Resolve an email address to a person you may message.
   *
   * A MUTATION, not a query, and that is deliberate on two counts: react-query
   * never caches the result (so a probed address does not sit in a browser's
   * memory), and it never travels as a URL, so it stays out of access logs and
   * out of the Referer header.
   */
  discoverByEmail: protectedProcedure
    .input(z.object({ email: z.string().email().max(254) }))
    .mutation(async ({ ctx, input }): Promise<DiscoverResult> => {
      const email = input.email.trim().toLowerCase();

      // Three budgets, all FAIL-CLOSED. `users.email` is unique and indexed, so a
      // lookup is cheap — the limits are not about load, they are the only thing
      // between this procedure and someone walking a list of a million addresses.
      // A Redis outage must therefore close the door, not open it.
      await assertRateLimits(
        [
          { key: `chat:disc:u:${ctx.user.id}`, limit: 20, windowMs: 15 * MINUTE },
          { key: `chat:disc:u:${ctx.user.id}:d`, limit: 100, windowMs: DAY },
          { key: `chat:disc:ip:${ctx.ip ?? 'unknown'}`, limit: 60, windowMs: 15 * MINUTE },
        ],
        'Too many lookups. Try again in a few minutes.',
      );

      if (email === ctx.user.email.trim().toLowerCase()) return NOT_FOUND;

      // EXACT match only. Never `ilike`, never '%'-wrapped. connections.ts has a
      // partial-match user search for the agency contractor picker; that shape is
      // an enumeration primitive and must not be copied here — with it, three
      // characters would return a slice of the user table.
      const row = (
        await ctx.db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            email: users.email,
            profileUrl: users.profileUrl,
            discoverableByEmail: users.discoverableByEmail,
          })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
      )[0];

      if (!row) return NOT_FOUND;
      if (!row.discoverableByEmail) return NOT_FOUND;
      if (await isBlocked(ctx.db, ctx.user.id, row.id)) return NOT_FOUND;

      return {
        found: true,
        user: {
          id: row.id,
          // Name and face only. No email echo (the caller already typed it, and
          // echoing it would confirm the exact casing on file), no role, no
          // organisation, no last-seen, no created-at. Every one of those is a
          // fact about a person the caller has not yet been introduced to.
          name: [row.firstName, row.lastName].filter(Boolean).join(' ').trim() || 'Prodesk user',
          avatarUrl: row.profileUrl ?? null,
        },
      };
    }),

  /**
   * Invite an address that has no account yet.
   *
   * Creates NO thread. `chat_thread_members.user_id` is a NOT NULL foreign key to
   * `users`, so a person without an account is simply not representable as a
   * member — the pending row lives in `chat_invites` and becomes a real DM at
   * signup (`claimChatInvites`).
   *
   * Note this happily accepts an address that DOES have an account. It has to:
   * `discoverByEmail` cannot tell the caller which of the three negative cases
   * they hit, so the client cannot know either. The unique index makes a repeat
   * a no-op, and the worker sends at most one email per (inviter, address).
   */
  inviteByEmail: protectedProcedure
    .input(z.object({ email: z.string().email().max(254) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      await assertRateLimit(
        `chat:invite:${ctx.user.id}`,
        10,
        DAY,
        'You’ve sent a lot of invitations today. Try again tomorrow.',
      );
      if (email === ctx.user.email.trim().toLowerCase()) {
        return { invited: false as const };
      }

      const [created] = await ctx.db
        .insert(chatInvites)
        .values({ email, invitedBy: ctx.user.id })
        .onConflictDoNothing()
        .returning({ id: chatInvites.id });

      // No row back = an identical live invite already exists. Report success
      // anyway: from the caller's side the outcome is the same ("they've been
      // invited"), and saying "already invited" would leak that this address is
      // one they personally invited before, across sessions.
      if (created) {
        // Thread the originating frontend through so the signup link points back
        // at the app the invite was sent from (chat.prodesk.com), not app.
        await enqueueEmail('chat-invite', {
          email,
          invitedBy: ctx.user.id,
          origin: ctx.clientOrigin,
        });
      }
      return { invited: true as const };
    }),

  /* ----------------------------------------------------------- preferences */

  /** Whether the signed-in user can be found by their email address. */
  discoverySettings: protectedProcedure.query(async ({ ctx }) => {
    const row = (
      await ctx.db
        .select({ discoverableByEmail: users.discoverableByEmail })
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .limit(1)
    )[0];
    return { discoverableByEmail: row?.discoverableByEmail ?? true };
  }),

  setDiscoverable: protectedProcedure
    .input(z.object({ discoverable: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(users)
        .set({ discoverableByEmail: input.discoverable })
        .where(eq(users.id, ctx.user.id));
      return { discoverableByEmail: input.discoverable };
    }),

  /* ---------------------------------------------------------------- blocks */

  blockUser: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.user.id) return { ok: true as const };
      await ctx.db
        .insert(chatUserBlocks)
        .values({ blockerId: ctx.user.id, blockedId: input.userId })
        .onConflictDoNothing();
      return { ok: true as const };
    }),

  unblockUser: protectedProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chatUserBlocks)
        .where(
          and(
            eq(chatUserBlocks.blockerId, ctx.user.id),
            eq(chatUserBlocks.blockedId, input.userId),
          ),
        );
      return { ok: true as const };
    }),

  /** People you have blocked — the Settings list. Never the reverse direction. */
  listBlocked: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        userId: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        profileUrl: users.profileUrl,
        blockedAt: chatUserBlocks.createdAt,
      })
      .from(chatUserBlocks)
      .innerJoin(users, eq(chatUserBlocks.blockedId, users.id))
      .where(eq(chatUserBlocks.blockerId, ctx.user.id));

    return rows.map((r) => ({
      userId: r.userId,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ').trim() || 'Prodesk user',
      avatarUrl: r.profileUrl ?? null,
      blockedAt: r.blockedAt,
    }));
  }),
};
