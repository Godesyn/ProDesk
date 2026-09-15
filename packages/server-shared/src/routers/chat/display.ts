import { eq } from 'drizzle-orm';
import { agencies, brands, chatThreads, users } from '../../db/schema.js';
import type { Context } from '../../trpc/context.js';
import { isConsumerThread, type ThreadType } from '../../modules/chat/thread-types.js';

export type ThreadRow = typeof chatThreads.$inferSelect;
type Db = Context['db'];

/**
 * Resolve a human display name for a thread from the current user's vantage.
 * Mirrors `cachedInferThreadName` (chat_state_provider.dart:525-604).
 */
export async function inferThreadName(db: Db, thread: ThreadRow, currentUserId: string): Promise<string> {
  const type = thread.type as ThreadType;
  if (type === 'all') return thread.name ?? 'Group';
  if (type === 'you') return 'You';
  if (type === 'platformAdmin') {
    // For the super admin (participantB), show the other user's name.
    // For regular users (participantA), show the static "Platform Admin" label.
    if (thread.participantBId === currentUserId && thread.participantAId) {
      const u = (await db.select().from(users).where(eq(users.id, thread.participantAId)).limit(1))[0];
      if (u) return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
    }
    return thread.name ?? 'Platform Admin';
  }

  // A messenger group: its own name, or the members' names joined client-side
  // when it has none. Must be resolved here and not only in the frontend — the
  // chat-digest email builder (jobs/worker.ts) calls this too.
  if (type === 'group') return thread.name ?? 'Group';

  // Personal 1-on-1: name is the other participant. `direct` (the messenger DM)
  // rides this branch — it stores both participants exactly like the org-derived
  // personal threads do.
  if (
    type === 'brandAgencyPersonal' ||
    type === 'agencyPersonal' ||
    type === 'brandPersonal' ||
    type === 'agencyContractorPersonal' ||
    type === 'brandAgencyStaff' ||
    type === 'direct'
  ) {
    const otherId = thread.participantAId === currentUserId ? thread.participantBId : thread.participantAId;
    if (otherId) {
      const u = (await db.select().from(users).where(eq(users.id, otherId)).limit(1))[0];
      if (u) return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
    }
    return thread.name ?? 'Personal Chat';
  }

  if (type === 'agencyStaff' || type === 'brandStaff') return thread.name ?? 'Staff';
  if (type === 'ai') return 'Strategist';
  return thread.name ?? 'Conversation';
}

/**
 * Resolve the brand grouping label for the cross-identity unread overview.
 * Real brand → its name; platform/self threads → 'Platform'. Mirrors
 * `_specialConnectionLabel` + the brand-name resolution
 * (chat_thread_list_unread_overview.dart:156-223).
 */
export async function inferThreadGroupLabel(ctx: Context, thread: ThreadRow): Promise<string> {
  const type = thread.type as ThreadType;
  // Messenger threads belong to no brand and no agency — they belong to people.
  if (isConsumerThread(type)) return 'Direct';
  if (type === 'you' || type === 'platformAdmin') return 'Platform';
  if (thread.brandId && thread.brandId !== 'app') {
    const b = (
      await ctx.db
        .select({ name: brands.businessName })
        .from(brands)
        .where(eq(brands.id, thread.brandId))
        .limit(1)
    )[0];
    if (b) return b.name;
  }
  return 'Other';
}

/**
 * Resolve the counterparty logo for a thread. Mirrors `chatThreadLogoProvider`
 * (chat_state_provider.dart:426-523).
 */
export async function inferThreadLogo(db: Db, thread: ThreadRow, currentUserId: string): Promise<string | null> {
  const type = thread.type as ThreadType;
  switch (type) {
    case 'all':
    case 'brandAgencyStaff': {
      // Show the brand logo (agency-side view) — the most common counterparty.
      if (thread.brandId) {
        const b = (await db.select().from(brands).where(eq(brands.id, thread.brandId)).limit(1))[0];
        return b?.logoUrl ?? null;
      }
      return null;
    }
    case 'interAgency': {
      const otherAgency = (thread.agencyIds ?? [])[0];
      if (otherAgency) {
        const a = (await db.select().from(agencies).where(eq(agencies.id, otherAgency)).limit(1))[0];
        return a?.logoUrl ?? null;
      }
      return null;
    }
    case 'group':
      return thread.photoUrl ?? null;
    case 'you':
    case 'brandAgencyPersonal':
    case 'agencyPersonal':
    case 'brandPersonal':
    case 'agencyContractorPersonal':
    case 'direct': {
      const otherId =
        type === 'you'
          ? currentUserId
          : thread.participantAId === currentUserId
            ? thread.participantBId
            : thread.participantAId;
      if (otherId) {
        const u = (await db.select().from(users).where(eq(users.id, otherId)).limit(1))[0];
        return u?.profileUrl ?? null;
      }
      return null;
    }
    case 'platformAdmin': {
      // For the super admin (participantB), show the other user's profile photo.
      // For regular users (participantA), return null so the client shows the app favicon.
      if (thread.participantBId === currentUserId && thread.participantAId) {
        const pu = (await db.select().from(users).where(eq(users.id, thread.participantAId)).limit(1))[0];
        return pu?.profileUrl ?? null;
      }
      return null;
    }
    default:
      return null;
  }
}
