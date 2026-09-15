import { and, eq, inArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  chatThreads,
  chatThreadMembers,
  chatMessages,
  brands,
  agencies,
  users,
  staff,
  brandAgencyConnections,
} from '../../db/schema.js';
import type { ThreadType } from './thread-types.js';
import { claimChatInvites } from './consumer.js';

type Db = typeof defaultDb;

/**
 * Post a system message into a thread and bump its preview. `senderId` carries
 * the actor whose action produced the event (required by the FK), but the
 * message renders as a centered system notice (type='system', name 'System').
 * Falls back to the thread creator when no actor is supplied.
 */
export async function postSystemMessage(threadId: string, content: string, db: Db = defaultDb, actorId?: string) {
  let senderId = actorId;
  if (!senderId) {
    const t = (await db.select({ createdBy: chatThreads.createdBy, a: chatThreads.participantAId }).from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1))[0];
    senderId = t?.createdBy ?? t?.a ?? undefined;
  }
  if (!senderId) return null; // no valid actor — skip rather than violate the FK.
  const [message] = await db
    .insert(chatMessages)
    .values({ threadId, senderId, senderName: 'System', content, type: 'system' })
    .returning();
  await db.update(chatThreads).set({ lastMessage: content, lastMessageAt: message.timestamp }).where(eq(chatThreads.id, threadId));
  return message;
}

async function addMembers(threadId: string, members: Array<{ userId: string; role: string }>, db: Db) {
  const unique = members.filter((m, i, arr) => arr.findIndex((x) => x.userId === m.userId) === i);
  if (unique.length === 0) return;
  await db
    .insert(chatThreadMembers)
    .values(unique.map((m) => ({ threadId, userId: m.userId, role: m.role })))
    .onConflictDoNothing();
}

/** Owner + active staff user-ids for an agency. */
async function agencyMemberIds(agencyId: string, db: Db): Promise<string[]> {
  const agency = (await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
  const staffRows = await db
    .select({ userId: staff.userId })
    .from(staff)
    .where(and(eq(staff.agencyId, agencyId), eq(staff.type, 'agency'), eq(staff.status, 'active')));
  return [agency?.ownerId, ...staffRows.map((s) => s.userId)].filter((id): id is string => !!id);
}

/** Owner + active staff user-ids for a brand. */
async function brandMemberIds(brandId: string, db: Db): Promise<string[]> {
  const brand = (await db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  const staffRows = await db
    .select({ userId: staff.userId })
    .from(staff)
    .where(and(eq(staff.brandId, brandId), eq(staff.type, 'brand'), eq(staff.status, 'active')));
  return [brand?.ownerId, ...staffRows.map((s) => s.userId)].filter((id): id is string => !!id);
}

/**
 * Reconcile the membership of a brand's AI thread with the brand's CURRENT
 * roster (owner + active brand staff). Thread membership is otherwise only
 * written at two moments — thread creation and `handleStaffPermissionGranted` —
 * so anyone who joined the brand by another route (a staff row created outside
 * the invite flow, an ownership transfer, a seed/import) is left without a
 * `chat_thread_members` row and gets "Not an AI thread you can access." Safe to
 * call on every access: it's an upsert with `onConflictDoNothing`.
 */
export async function syncBrandAiThreadMembers(brandId: string, threadId: string, db: Db = defaultDb) {
  const members = await brandMemberIds(brandId, db);
  await addMembers(threadId, members.map((userId) => ({ userId, role: 'brand' })), db);
}

/**
 * Self-heal for the case above, applied at access time: if `threadId` is a
 * brand's AI thread and `userId` is on that brand's current roster, backfill the
 * membership rows and report true. Any other thread type is left alone — the
 * caller's normal member check stands.
 */
export async function tryJoinBrandAiThread(userId: string, threadId: string, db: Db = defaultDb): Promise<boolean> {
  const thread = (
    await db
      .select({ type: chatThreads.type, brandId: chatThreads.brandId })
      .from(chatThreads)
      .where(eq(chatThreads.id, threadId))
      .limit(1)
  )[0];
  if (!thread || thread.type !== 'ai' || !thread.brandId) return false;
  const roster = await brandMemberIds(thread.brandId, db);
  if (!roster.includes(userId)) return false;
  await syncBrandAiThreadMembers(thread.brandId, threadId, db);
  return true;
}

/**
 * Ensure a brand's dedicated AI assistant thread exists (type='ai', one per
 * brand, shared across the brand team) AND that every current brand member can
 * reach it. Idempotent: an existing thread is reused, membership is reconciled.
 * Sets brands.chatbotThreadId so we can reach it directly. Used on brand
 * creation, by the dashboard Growth Strategy app, and by the backfill script.
 */
export async function ensureBrandAiThread(brandId: string, db: Db = defaultDb): Promise<string | null> {
  const brand = (await db.select().from(brands).where(eq(brands.id, brandId)).limit(1))[0];
  if (!brand) return null;
  if (brand.chatbotThreadId) {
    await syncBrandAiThreadMembers(brandId, brand.chatbotThreadId, db);
    return brand.chatbotThreadId;
  }

  // Guard against a stray pre-existing ai thread (e.g. partial prior run).
  const existing = (
    await db.select({ id: chatThreads.id }).from(chatThreads).where(and(eq(chatThreads.brandId, brandId), eq(chatThreads.type, 'ai'))).limit(1)
  )[0];
  if (existing) {
    await db.update(brands).set({ chatbotThreadId: existing.id }).where(eq(brands.id, brandId));
    await syncBrandAiThreadMembers(brandId, existing.id, db);
    return existing.id;
  }

  const [thread] = await db
    .insert(chatThreads)
    .values({ type: 'ai', name: 'Strategist', brandId, createdBy: brand.ownerId })
    .returning();

  const members = await brandMemberIds(brandId, db);
  await addMembers(thread.id, members.map((userId) => ({ userId, role: 'brand' })), db);
  await postSystemMessage(
    thread.id,
    `Hi! I'm your AI assistant for ${brand.businessName}. Ask me about your projects, proposals, connected agencies, documents, or the marketplace.`,
    db,
    brand.ownerId,
  );
  await db.update(brands).set({ chatbotThreadId: thread.id }).where(eq(brands.id, brandId));
  return thread.id;
}

/**
 * Create the brand↔agency group thread (`all`) + the per-member private
 * `brandAgencyStaff` threads when a connection forms. Ports
 * `autoCreatePersonalThreadsForConnection` (chat_repository.dart).
 */
export async function createConnectionThreads(connectionId: string, brandId: string, agencyId: string, db: Db = defaultDb) {
  const [brand, agency] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, brandId)).limit(1),
    db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1),
  ]);
  const brandName = brand[0]?.businessName ?? 'Brand';
  const agencyName = agency[0]?.businessName ?? 'Agency';
  const name = `${brandName} · ${agencyName}`;

  const [groupThread] = await db
    .insert(chatThreads)
    .values({ connectionId, type: 'all', name, brandId, agencyIds: [agencyId], createdBy: agency[0]?.ownerId })
    .returning();

  const [brandMembers, agencyMembers] = await Promise.all([brandMemberIds(brandId, db), agencyMemberIds(agencyId, db)]);

  // `all` group thread — everyone on both sides.
  await addMembers(
    groupThread.id,
    [
      ...brandMembers.map((userId) => ({ userId, role: 'brand' })),
      ...agencyMembers.map((userId) => ({ userId, role: 'agency' })),
    ],
    db,
  );
  await postSystemMessage(groupThread.id, `${brandName} and ${agencyName} are now connected.`, db);

  // Per-member private brand↔agency threads, so any agency member can reach any
  // brand member 1-on-1. Ports the staff personal-thread fan-out.
  await createBrandAgencyStaffThreads(connectionId, brandId, agencyId, db);

  return groupThread;
}

/**
 * Ensure a brand↔agency connection (and its chat threads) exists. Ports
 * `ensureChatConnection` (chat_utils.ts): used when work links a brand and agency
 * that aren't formally connected yet (e.g. a contractor is assigned to the
 * brand's project). Idempotent — returns the existing connection if present.
 */
export async function ensureChatConnection(brandId: string, agencyId: string, db: Db = defaultDb) {
  const existing = (
    await db
      .select()
      .from(brandAgencyConnections)
      .where(and(eq(brandAgencyConnections.brandId, brandId), eq(brandAgencyConnections.agencyId, agencyId)))
      .limit(1)
  )[0];
  if (existing) return existing;
  const [conn] = await db
    .insert(brandAgencyConnections)
    .values({ brandId, agencyId })
    .onConflictDoNothing()
    .returning();
  if (!conn) {
    // Lost a race — fetch the row the other writer created.
    return (
      await db
        .select()
        .from(brandAgencyConnections)
        .where(and(eq(brandAgencyConnections.brandId, brandId), eq(brandAgencyConnections.agencyId, agencyId)))
        .limit(1)
    )[0];
  }
  await createConnectionThreads(conn.id, brandId, agencyId, db);
  return conn;
}

/**
 * Fan-out: create a `brandAgencyStaff` 1-on-1 thread between every agency-side
 * member and every brand-side member of a connection (idempotent). Ports
 * `autoCreatePersonalThreadsForStaff` + the connection fan-out.
 */
export async function createBrandAgencyStaffThreads(connectionId: string, brandId: string, agencyId: string, db: Db = defaultDb) {
  const [brand, agency] = await Promise.all([
    db.select().from(brands).where(eq(brands.id, brandId)).limit(1),
    db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1),
  ]);
  const [brandMembers, agencyMembers] = await Promise.all([brandMemberIds(brandId, db), agencyMemberIds(agencyId, db)]);

  for (const agencyUser of agencyMembers) {
    for (const brandUser of brandMembers) {
      if (agencyUser === brandUser) continue;
      const exists = await personalThreadExists('brandAgencyStaff', agencyUser, brandUser, db, { brandId, agencyId });
      if (exists) continue;
      const [thread] = await db
        .insert(chatThreads)
        .values({
          connectionId,
          type: 'brandAgencyStaff',
          name: `${agency[0]?.businessName ?? 'Agency'} · ${brand[0]?.businessName ?? 'Brand'}`,
          brandId,
          agencyIds: [agencyId],
          participantAId: agencyUser,
          participantBId: brandUser,
          createdBy: agency[0]?.ownerId,
        })
        .returning();
      await addMembers(thread.id, [
        { userId: agencyUser, role: 'agency' },
        { userId: brandUser, role: 'brand' },
      ], db);
    }
  }
}

/** Whether a 1-on-1 personal thread of the given type already links two users. */
async function personalThreadExists(
  type: ThreadType,
  userA: string,
  userB: string,
  db: Db,
  scope?: { brandId?: string; agencyId?: string },
): Promise<boolean> {
  const conds = [eq(chatThreads.type, type)];
  if (scope?.brandId) conds.push(eq(chatThreads.brandId, scope.brandId));
  const rows = await db
    .select({ id: chatThreads.id, a: chatThreads.participantAId, b: chatThreads.participantBId })
    .from(chatThreads)
    .where(and(...conds));
  return rows.some(
    (r) => (r.a === userA && r.b === userB) || (r.a === userB && r.b === userA),
  );
}

/**
 * Create a 1:1 agency↔contractor thread when a contractor joins an agency.
 * Ports `autoCreatePersonalThreadsForNewContractor`.
 */
export async function createContractorThread(agencyId: string, contractorId: string, db: Db = defaultDb) {
  const agency = (await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1))[0];
  if (!agency) return null;
  if (await personalThreadExists('agencyContractorPersonal', agency.ownerId, contractorId, db, { agencyId })) return null;
  const [thread] = await db
    .insert(chatThreads)
    .values({
      type: 'agencyContractorPersonal',
      name: agency.businessName,
      agencyIds: [agencyId],
      contractorId,
      participantAId: agency.ownerId,
      participantBId: contractorId,
      createdBy: agency.ownerId,
    })
    .returning();
  await addMembers(thread.id, [
    { userId: agency.ownerId, role: 'agency' },
    { userId: contractorId, role: 'contractor' },
  ], db);
  await postSystemMessage(thread.id, `Contractor joined ${agency.businessName}.`, db);
  return thread;
}

/**
 * Archive (soft-remove) the agency↔contractor threads when a contractor is
 * removed from an agency. Ports `handleContractorRemovedFromAgency`. We archive
 * rather than delete to preserve history.
 */
export async function handleContractorRemovedFromAgency(agencyId: string, contractorId: string, db: Db = defaultDb) {
  const rows = await db
    .select({ id: chatThreads.id })
    .from(chatThreads)
    .where(
      and(
        eq(chatThreads.type, 'agencyContractorPersonal'),
        eq(chatThreads.contractorId, contractorId),
        sql`${agencyId} = ANY(${chatThreads.agencyIds})`,
      ),
    );
  for (const r of rows) {
    await db.update(chatThreads).set({ isArchived: true }).where(eq(chatThreads.id, r.id));
    await postSystemMessage(r.id, 'Contractor removed from agency. This conversation is now archived.', db);
  }
}

/**
 * When a staff member gains a chat permission, create their personal threads to
 * the relevant counterparties. Ports `autoCreatePersonalThreadsForStaff` /
 * `handleStaffPermissionGranted`. `permissions` should already reflect the
 * post-grant state.
 *
 * NOTE: the external trigger (the staff-permission mutation) lives outside the
 * chat domain — wire this from the staff router. See deferred notes.
 */
export async function handleStaffPermissionGranted(
  staffUserId: string,
  org: { agencyId?: string | null; brandId?: string | null },
  permissions: string[],
  db: Db = defaultDb,
) {
  const canChatBrands = permissions.includes('chatWithBrands');
  const canChatStaffs = permissions.includes('chatWithStaffs');

  if (org.agencyId) {
    // Agency staff: open brand-side threads (if chatWithBrands) for each connected brand.
    if (canChatBrands) {
      const conns = await db.select().from(brandAgencyConnections).where(eq(brandAgencyConnections.agencyId, org.agencyId));
      for (const conn of conns) {
        await createBrandAgencyStaffThreads(conn.id, conn.brandId, conn.agencyId, db);
      }
    }
    // Agency staff: open agency-internal staff threads (if chatWithStaffs).
    if (canChatStaffs) {
      await ensureOrgStaffThreads('agencyStaff', { agencyId: org.agencyId }, staffUserId, db);
    }
  }

  if (org.brandId) {
    if (canChatStaffs) {
      await ensureOrgStaffThreads('brandStaff', { brandId: org.brandId }, staffUserId, db);
    }
    // Brand staff also join the brand's shared AI assistant thread.
    const aiThreadId = (await db.select({ id: brands.chatbotThreadId }).from(brands).where(eq(brands.id, org.brandId)).limit(1))[0]?.id;
    if (aiThreadId) await addMembers(aiThreadId, [{ userId: staffUserId, role: 'brand' }], db);
  }
}

/**
 * Create the internal-staff 1-on-1 threads between a (new) staff member and the
 * other org members. Used by handleStaffPermissionGranted.
 */
async function ensureOrgStaffThreads(
  type: 'agencyStaff' | 'brandStaff',
  org: { agencyId?: string; brandId?: string },
  newUserId: string,
  db: Db,
) {
  const orgId = org.agencyId ?? org.brandId!;
  const members = org.agencyId ? await agencyMemberIds(orgId, db) : await brandMemberIds(orgId, db);
  const orgRow = org.agencyId
    ? (await db.select().from(agencies).where(eq(agencies.id, orgId)).limit(1))[0]
    : (await db.select().from(brands).where(eq(brands.id, orgId)).limit(1))[0];
  const orgName = orgRow?.businessName ?? 'Team';
  for (const other of members) {
    if (other === newUserId) continue;
    if (await personalThreadExists(type, newUserId, other, db, org.brandId ? { brandId: org.brandId } : undefined)) continue;
    const [thread] = await db
      .insert(chatThreads)
      .values({
        type,
        name: orgName,
        brandId: org.brandId,
        agencyIds: org.agencyId ? [org.agencyId] : undefined,
        participantAId: newUserId,
        participantBId: other,
        createdBy: newUserId,
      })
      .returning();
    await addMembers(thread.id, [
      { userId: newUserId, role: org.agencyId ? 'agency' : 'brand' },
      { userId: other, role: org.agencyId ? 'agency' : 'brand' },
    ], db);
  }
}

/**
 * When a staff member loses a chat permission, archive the threads they should
 * no longer see. Ports `handleStaffPermissionRevoked`. We archive the user's
 * membership rows (so the thread disappears from their list) rather than delete
 * the shared thread.
 *
 * NOTE: external trigger lives in the staff router. See deferred notes.
 */
export async function handleStaffPermissionRevoked(
  staffUserId: string,
  org: { agencyId?: string | null; brandId?: string | null },
  remainingPermissions: string[],
  db: Db = defaultDb,
) {
  const stillBrands = remainingPermissions.includes('chatWithBrands');
  const stillStaffs = remainingPermissions.includes('chatWithStaffs');

  const typesToRevoke: ThreadType[] = [];
  if (!stillBrands) typesToRevoke.push('brandAgencyStaff', 'brandAgencyPersonal');
  if (!stillStaffs) typesToRevoke.push('agencyStaff', 'brandStaff', 'agencyPersonal', 'brandPersonal');
  if (typesToRevoke.length === 0) return;

  // Find this user's threads of the revoked types scoped to the org and archive
  // their membership.
  const orgId = org.agencyId ?? org.brandId;
  const rows = await db
    .select({ threadId: chatThreads.id })
    .from(chatThreadMembers)
    .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
    .where(
      and(
        eq(chatThreadMembers.userId, staffUserId),
        inArray(chatThreads.type, typesToRevoke),
        org.agencyId ? sql`${orgId} = ANY(${chatThreads.agencyIds})` : eq(chatThreads.brandId, orgId!),
      ),
    );
  for (const r of rows) {
    await db
      .update(chatThreadMembers)
      .set({ isArchived: true })
      .where(and(eq(chatThreadMembers.threadId, r.threadId), eq(chatThreadMembers.userId, staffUserId)));
  }
}

/**
 * Ensure the caller's `you` self-thread — their personal notes surface — exists,
 * and return it. Idempotent, and safe to call on every app boot.
 *
 * This is the ONE personal-notes thread a user has: the workspace lists it under
 * PLATFORM ADMIN, and the messenger (chat.prodesk.com) shows it as "Notes". It is
 * looked up through the MEMBERSHIP row rather than `participant_a_id`, because
 * membership is what every reader (inbox, threadMeta, assertMember) actually
 * joins on — a thread with the right participant and no member row is invisible
 * everywhere, which is precisely the state this function has to be able to fix.
 *
 * It deliberately touches nothing but existence. Archive / mute / pin live on the
 * member row, so an ensure that "restored" anything would un-archive the notes
 * thread of everyone who had filed it away, every time they opened the app.
 */
export async function ensureNotesThread(
  userId: string,
  db: Db = defaultDb,
): Promise<{ threadId: string; created: boolean }> {
  const existing = (
    await db
      .select({ id: chatThreads.id })
      .from(chatThreadMembers)
      .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
      .where(and(eq(chatThreadMembers.userId, userId), eq(chatThreads.type, 'you')))
      .limit(1)
  )[0];
  if (existing) return { threadId: existing.id, created: false };

  // An orphan from before the member row existed (or from a failed create) is
  // adopted rather than duplicated — two `you` threads would mean two Notes rows
  // in the messenger and a coin-toss over which one the workspace opens.
  const orphan = (
    await db
      .select({ id: chatThreads.id })
      .from(chatThreads)
      .where(and(eq(chatThreads.type, 'you'), eq(chatThreads.participantAId, userId)))
      .limit(1)
  )[0];
  if (orphan) {
    await addMembers(orphan.id, [{ userId, role: 'user' }], db);
    return { threadId: orphan.id, created: false };
  }

  const [created] = await db
    .insert(chatThreads)
    .values({ type: 'you', name: 'You', participantAId: userId, createdBy: userId })
    .returning();
  await addMembers(created.id, [{ userId, role: 'user' }], db);
  // No seeded messages: the room's own empty state ("Notes to yourself. Nobody
  // else can see this.") says it better than a fake note would, and a system
  // notice here would give every user an unread they never asked for.
  return { threadId: created.id, created: true };
}

/**
 * Ensure the per-user `you` self-thread and the `platformAdmin` support thread
 * exist (idempotent). Ports `ensurePlatformAdminThread`
 * (chat_repository.dart:408-465). Call on signup.
 *
 * NOTE: the signup-side trigger is in the auth router; this function is the
 * chat-local port. See deferred notes.
 */
export async function ensurePlatformAdminThread(userId: string, db: Db = defaultDb): Promise<{ youThreadId: string; adminThreadId: string }> {
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  const displayName = u ? [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email : 'You';

  // 1. `you` self-thread — the personal notes surface, shared with the messenger.
  const youThread = await ensureNotesThread(userId, db);

  // 2. `platformAdmin` support thread (with the super-admin).
  let adminThread = (
    await db
      .select({ id: chatThreads.id })
      .from(chatThreadMembers)
      .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
      .where(and(eq(chatThreadMembers.userId, userId), eq(chatThreads.type, 'platformAdmin')))
      .limit(1)
  )[0];
  if (!adminThread) {
    const superAdmin = (await db.select().from(users).where(eq(users.isSuperAdmin, true)).limit(1))[0];
    const [created] = await db
      .insert(chatThreads)
      .values({
        type: 'platformAdmin',
        name: 'Platform Admin',
        participantAId: userId,
        participantBId: superAdmin?.id,
        createdBy: userId,
      })
      .returning();
    const members = [{ userId, role: 'user' }];
    if (superAdmin) members.push({ userId: superAdmin.id, role: 'admin' });
    await addMembers(created.id, members, db);
    await postSystemMessage(created.id, `Welcome, ${displayName}! Reach out to the team here any time.`, db);
    adminThread = { id: created.id };
  }

  // Messenger invites sent to this address before the account existed become open
  // DMs now. This runs on every signup and is already idempotent, which makes it
  // the right hook — and `claimChatInvites` swallows its own failures, so a bad
  // invite can never break account provisioning.
  if (u?.email) await claimChatInvites(userId, u.email, db);

  return { youThreadId: youThread.threadId, adminThreadId: adminThread.id };
}
