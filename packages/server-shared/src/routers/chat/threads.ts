import { z } from 'zod';
import { and, eq, desc, sql, count, inArray, notInArray } from 'drizzle-orm';
import { protectedProcedure } from '../../trpc/trpc.js';
import { chatThreads, chatThreadMembers } from '../../db/schema.js';
import { paginationInput, page } from '../../lib/pagination.js';
import { listChatIdentities, listChatBrands, type ChatIdentityType } from '../../modules/chat/identity.js';
import {
  visibleThreadTypesForIdentity,
  sectionForThread,
  CONSUMER_THREAD_TYPES,
  type ThreadType,
} from '../../modules/chat/thread-types.js';
import { ensureNotesThread, ensurePlatformAdminThread } from '../../modules/chat/threads.js';
import { resolveChatNavigation } from '../../modules/chat/navigation.js';
import { identityTypeEnum, navigationTargetEnum } from './common.js';
import { inferThreadName, inferThreadGroupLabel, inferThreadLogo } from './display.js';

/** Identity selection, thread lists, unread badges, and chat-launch navigation. */
export const threadProcedures = {
  /** Who the signed-in user can chat as (identity selector). */
  identities: protectedProcedure.query(async ({ ctx }) => {
    const appName = ctx.tenant?.businessName ?? 'Prodesk';
    return listChatIdentities(ctx.user, appName, ctx.db);
  }),

  /** Brands available to chat about, scoped to the active identity. */
  brandsForIdentity: protectedProcedure
    .input(z.object({ identityType: identityTypeEnum, entityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const appName = ctx.tenant?.businessName ?? 'Prodesk';
      return listChatBrands(
        { type: input.identityType, entityId: input.entityId, userUid: ctx.user.id },
        appName,
        ctx.db,
      );
    }),

  /**
   * Threads for the current user, optionally filtered to an identity + brand,
   * each grouped into a display section and decorated with a resolved display
   * name + counterparty logo. Mirrors `watchBrandThreads` +
   * `_groupThreadsForDisplay` + `cachedInferThreadName` + `chatThreadLogoProvider`.
   */
  threads: protectedProcedure
    .input(
      paginationInput.extend({
        identityType: identityTypeEnum.optional(),
        entityId: z.string().optional(),
        brandId: z.string().optional(),
        unreadOnly: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conds = [
        eq(chatThreadMembers.userId, ctx.user.id),
        eq(chatThreadMembers.isArchived, false),
      ];

      // Type-driven visibility for the active identity.
      let visibleTypes: ThreadType[] | null = null;
      if (input.identityType) {
        visibleTypes = visibleThreadTypesForIdentity(input.identityType as ChatIdentityType);
        conds.push(inArray(chatThreads.type, visibleTypes));
      }
      // REQUIRED, and not redundant with the filter above.
      //
      // The consumer types are in no identity predicate, so `visibleTypes` never
      // contains them — but `identityType` is OPTIONAL, and the main app's
      // cross-identity unread overview (packages/shared/src/pages/chat.tsx) calls
      // this WITHOUT one. In that mode there is no type filter at all, so a DM
      // would appear in the workspace list, where `threadVisuals()` would be asked
      // for an icon it has no case for and the destructure would blank the screen.
      conds.push(notInArray(chatThreads.type, CONSUMER_THREAD_TYPES));
      if (input.brandId) conds.push(eq(chatThreads.brandId, input.brandId));
      if (input.unreadOnly) conds.push(sql`${chatThreadMembers.unreadCount} > 0`);

      const where = and(...conds);
      const [rows, [{ value: total }]] = await Promise.all([
        ctx.db
          .select({ thread: chatThreads, unreadCount: chatThreadMembers.unreadCount })
          .from(chatThreadMembers)
          .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
          .where(where)
          .orderBy(desc(chatThreads.lastMessageAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ value: count() })
          .from(chatThreadMembers)
          .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
          .where(where),
      ]);

      // Agency identity: only threads that include this agency in agencyIds.
      let filtered = rows;
      if (input.identityType === 'agency' && input.entityId) {
        filtered = rows.filter((r) => (r.thread.agencyIds ?? []).includes(input.entityId!));
      }

      const decorated = await Promise.all(
        filtered.map(async (r) => {
          const displayName = await inferThreadName(ctx.db, r.thread, ctx.user.id);
          const logoUrl = await inferThreadLogo(ctx.db, r.thread, ctx.user.id);
          const section = input.identityType
            ? sectionForThread(r.thread.type as ThreadType, input.identityType as ChatIdentityType)
            : 'THREADS';
          // Brand label drives the "ABOUT {BRAND}" dividers in the cross-identity
          // unread overview (chat_thread_list_unread_overview.dart:_BrandDividerHeader).
          const groupLabel = await inferThreadGroupLabel(ctx, r.thread);
          return { ...r.thread, unreadCount: r.unreadCount, displayName, logoUrl, section, groupLabel };
        }),
      );

      return page(decorated, total, input);
    }),

  /**
   * Per-identity unread counts, keyed `{type}_{entityId}` (e.g. `agency_<id>`,
   * `user_<uid>`). Drives the unread badges on each row of the "Chat as"
   * selector and the FAB. Ports `chatUnreadIndexProvider.perIdentity`
   * (chat_unread_index.dart) — the bucket a thread lands in is decided by the
   * user's membership `role` on that thread (set at thread creation).
   */
  unreadByIdentity: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        role: chatThreadMembers.role,
        unreadCount: chatThreadMembers.unreadCount,
        brandId: chatThreads.brandId,
        agencyIds: chatThreads.agencyIds,
      })
      .from(chatThreadMembers)
      .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
      .where(
        and(
          eq(chatThreadMembers.userId, ctx.user.id),
          eq(chatThreadMembers.isArchived, false),
          sql`${chatThreadMembers.unreadCount} > 0`,
          // Messenger threads carry role='user', so without this they would fall
          // into the `user_<uid>` bucket below and inflate the "Personal" badge in
          // the workspace identity selector — an app that cannot open them.
          notInArray(chatThreads.type, CONSUMER_THREAD_TYPES),
        ),
      );

    const byKey: Record<string, number> = {};
    for (const r of rows) {
      let key: string | null = null;
      switch (r.role) {
        case 'brand':
          key = r.brandId ? `brand_${r.brandId}` : null;
          break;
        case 'agency':
          key = r.agencyIds?.[0] ? `agency_${r.agencyIds[0]}` : null;
          break;
        case 'contractor':
          key = `contractor_${ctx.user.id}`;
          break;
        case 'admin':
          key = 'platformAdmin_app';
          break;
        case 'user':
        default:
          key = `user_${ctx.user.id}`;
          break;
      }
      if (key) byKey[key] = (byKey[key] ?? 0) + (r.unreadCount ?? 0);
    }
    return byKey;
  }),

  /**
   * Ensure the user's `you` self-thread and `platformAdmin` support thread
   * exist. Idempotent — safe to call when the chat screen opens. Ports
   * `ensurePlatformAdminThread`.
   */
  ensureSupportThreads: protectedProcedure.mutation(async ({ ctx }) => {
    return ensurePlatformAdminThread(ctx.user.id, ctx.db);
  }),

  /**
   * Ensure ONLY the caller's personal notes thread (the `you` self-thread).
   *
   * The messenger calls this on boot, and that is why it is not
   * `ensureSupportThreads`: that one also provisions a platform-admin support
   * thread and claims pending chat invites — a signup-shaped amount of work to do
   * on every page load. This is two indexed reads in the common case and writes
   * nothing.
   *
   * Idempotent, and it never touches archive / mute / pin — see
   * `ensureNotesThread`.
   */
  ensureNotes: protectedProcedure.mutation(async ({ ctx }) => {
    return ensureNotesThread(ctx.user.id, ctx.db);
  }),

  /**
   * Resolve where a chat-launch chip/button should land: pick the identity to
   * chat as and the target thread for the given intent (brand/agency/inter-agency
   * group, or a 1-on-1 with a specific user). Ports `ChatNavigationService`
   * (chat_navigation_service.dart) — the client opens the docked panel and
   * navigates to the returned identity + brand + thread.
   */
  resolveNavigation: protectedProcedure
    .input(
      z.object({
        brandId: z.string().uuid(),
        agencyId: z.string().uuid().nullish(),
        target: navigationTargetEnum,
        targetUserId: z.string().uuid().nullish(),
        selfAgencyId: z.string().uuid().nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const appName = ctx.tenant?.businessName ?? 'Prodesk';
      return resolveChatNavigation(ctx.user, input, appName, ctx.db);
    }),
};
