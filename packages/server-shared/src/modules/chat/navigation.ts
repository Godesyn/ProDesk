import { and, eq, inArray, or } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { chatThreads } from '../../db/schema.js';
import { listChatIdentities, type ChatIdentity, type ChatIdentityType } from './identity.js';
import type { ThreadType } from './thread-types.js';

type Db = typeof defaultDb;

/**
 * The navigation intents a chip/button can request. Ports Flutter's
 * `ChatNavigationTarget` (chat_navigation_service.dart:14-20).
 */
export type ChatNavigationTarget =
  | 'allThread'
  | 'brandThread'
  | 'agencyThread'
  | 'interAgencyThread'
  | 'personalThread';

export interface ResolveNavigationInput {
  brandId: string;
  /** The project's / target agency. */
  agencyId?: string | null;
  target: ChatNavigationTarget;
  /** For personal threads, the other user. */
  targetUserId?: string | null;
  /**
   * The viewer's *own* agency, used to pick the agency identity when opening an
   * inter-agency thread (a sales agency viewing another agency's project).
   * Mirrors Flutter passing `currentUser.selectedAgencyId` to `_pickIdentity`.
   */
  selfAgencyId?: string | null;
}

export interface ResolveNavigationResult {
  identityType: ChatIdentityType;
  entityId: string;
  brandId: string | null;
  threadId: string | null;
}

/** 1-on-1 thread types in the React data model (have participant A/B). */
const PERSONAL_THREAD_TYPES: ThreadType[] = [
  'brandAgencyStaff',
  'agencyStaff',
  'brandStaff',
  'brandAgencyPersonal',
  'agencyPersonal',
  'brandPersonal',
  'agencyContractorPersonal',
];

/**
 * Resolve the chat destination for a navigation intent. Ports
 * `ChatNavigationService.navigateToChat` + `findGroupThread` + `_pickIdentity` +
 * the thread finders (chat_navigation_service.dart), adapted to the React/Drizzle
 * thread model.
 *
 * Model note: the production Flutter stack has dedicated *group* "Staff Group"
 * and `brandAgencyStaff` group threads; the React stack instead models the
 * brand↔agency group conversation as the single `all` thread and uses
 * `brandAgencyStaff`/`agencyStaff`/`brandStaff` for 1-on-1s. So the brand/agency
 * "group" targets here resolve to that connection's `all` thread, which is the
 * faithful intent ("open the conversation with this brand/agency").
 *
 * Returns the picked identity + resolved thread id (thread id may be null when
 * no matching thread exists yet — the caller still opens the panel to the
 * identity, matching the Flutter no-op-on-missing behavior).
 */
export async function resolveChatNavigation(
  user: { id: string; firstName?: string | null; lastName?: string | null; profileUrl?: string | null; role?: string | null; isSuperAdmin?: boolean },
  input: ResolveNavigationInput,
  appName = 'Prodesk',
  db: Db = defaultDb,
): Promise<ResolveNavigationResult | null> {
  const identities = await listChatIdentities(user, appName, db);
  if (identities.length === 0) return null;

  // 1. Pick the best identity. For inter-agency, pick by the viewer's own agency
  //    (selfAgencyId); otherwise by the project's agency.
  const pickAgencyId = input.target === 'interAgencyThread' ? input.selfAgencyId : input.agencyId;
  const identity = pickIdentity(identities, input.brandId, pickAgencyId ?? null, user.role ?? null);
  if (!identity) return null;

  // 2. Resolve the target thread.
  let threadId: string | null;
  if (input.target === 'personalThread' && input.targetUserId) {
    threadId = await findPersonalThread(db, input.brandId, user.id, input.targetUserId);
  } else {
    threadId = await findGroupThread(db, identity, input.target, input.brandId, input.agencyId ?? null);
  }

  return {
    identityType: identity.type,
    entityId: identity.entityId,
    brandId: input.brandId,
    threadId,
  };
}

/**
 * Pick the identity to chat as. Ports `_pickIdentity`
 * (chat_navigation_service.dart:141-174): for non-brand viewers prefer the
 * agency identity matching the project's agency, then the brand identity, then a
 * contractor identity, then the first available.
 */
function pickIdentity(
  identities: ChatIdentity[],
  brandId: string,
  agencyId: string | null,
  role: string | null,
): ChatIdentity | null {
  const isBrandRole = role === 'brandOwner' || role === 'brandStaff';

  if (!isBrandRole && agencyId) {
    const a = identities.find((i) => i.type === 'agency' && i.entityId === agencyId);
    if (a) return a;
  }
  const b = identities.find((i) => i.type === 'brand' && i.entityId === brandId);
  if (b) return b;
  const c = identities.find((i) => i.type === 'contractor');
  if (c) return c;
  return identities[0] ?? null;
}

/**
 * Find a group thread for the intent. Ports `findGroupThread`
 * (chat_navigation_service.dart:111-139) onto the React model: inter-agency →
 * the `interAgency` thread linking the two agencies on this brand; everything
 * else → the brand↔agency `all` group thread.
 */
async function findGroupThread(
  db: Db,
  identity: ChatIdentity,
  target: ChatNavigationTarget,
  brandId: string,
  agencyId: string | null,
): Promise<string | null> {
  if (target === 'interAgencyThread' && agencyId && identity.type === 'agency') {
    return findInterAgencyThread(db, brandId, identity.entityId, agencyId);
  }
  return findAllThread(db, brandId, agencyId);
}

/** The brand↔agency group `all` thread (scoped to the agency when known). */
async function findAllThread(db: Db, brandId: string, agencyId: string | null): Promise<string | null> {
  const rows = await db
    .select({ id: chatThreads.id, agencyIds: chatThreads.agencyIds })
    .from(chatThreads)
    .where(and(eq(chatThreads.brandId, brandId), eq(chatThreads.type, 'all')));
  if (rows.length === 0) return null;
  if (agencyId) {
    const scoped = rows.find((r) => (r.agencyIds ?? []).includes(agencyId));
    if (scoped) return scoped.id;
  }
  return rows[0].id;
}

/** The `interAgency` thread linking two agencies on the same brand. */
async function findInterAgencyThread(
  db: Db,
  brandId: string,
  myAgencyId: string,
  targetAgencyId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: chatThreads.id, agencyIds: chatThreads.agencyIds })
    .from(chatThreads)
    .where(and(eq(chatThreads.brandId, brandId), eq(chatThreads.type, 'interAgency')));
  const match = rows.find((r) => {
    const ids = r.agencyIds ?? [];
    return ids.includes(myAgencyId) && ids.includes(targetAgencyId);
  });
  return match?.id ?? null;
}

/**
 * Find the 1-on-1 thread between the current user and a target user. Ports
 * `_findPersonalThread` (chat_navigation_service.dart:252-280): match either
 * participant ordering across the 1-on-1 thread types, preferring a thread
 * scoped to this brand.
 */
async function findPersonalThread(
  db: Db,
  brandId: string,
  currentUserId: string,
  targetUserId: string,
): Promise<string | null> {
  const rows = await db
    .select({ id: chatThreads.id, brandId: chatThreads.brandId, lastMessageAt: chatThreads.lastMessageAt })
    .from(chatThreads)
    .where(
      and(
        inArray(chatThreads.type, PERSONAL_THREAD_TYPES),
        or(
          and(eq(chatThreads.participantAId, currentUserId), eq(chatThreads.participantBId, targetUserId)),
          and(eq(chatThreads.participantAId, targetUserId), eq(chatThreads.participantBId, currentUserId)),
        ),
      ),
    );
  if (rows.length === 0) return null;
  const scoped = rows.find((r) => r.brandId === brandId);
  return (scoped ?? rows[0]).id;
}
