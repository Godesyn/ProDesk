import { and, eq, inArray } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  agencies,
  brands,
  staff,
  users,
  agencyContractorConnections,
  contractors,
  brandAgencyConnections,
  chatThreads,
  chatThreadMembers,
} from '../../db/schema.js';

/**
 * The kind of entity a user is chatting *as*. Mirrors Flutter's
 * `ChatIdentityType` (chat_identity.dart). The persisted wire value is the
 * camelCase enum name (matching the rest of the new stack's enums).
 */
export type ChatIdentityType = 'agency' | 'brand' | 'contractor' | 'platformAdmin' | 'user';

/**
 * Who the user can chat as. Ported from `ChatIdentity` (chat_identity.dart) and
 * the `chatIdentitiesProvider` builder (chat_state_provider.dart:148-289).
 */
export interface ChatIdentity {
  type: ChatIdentityType;
  /** brand/agency id, or the user's id for contractor/user/platformAdmin ('app'). */
  entityId: string;
  entityName: string;
  userUid: string;
  /** 'owner' | 'staff' | 'contractor' | 'admin' | 'user' */
  entityRole: string;
  entityLogo?: string | null;
  isOwner: boolean;
}

/** Stable key for an identity's unread bucket. Ports `chatIdentityKeyFor`. */
export function chatIdentityKeyFor(i: Pick<ChatIdentity, 'type' | 'entityId'>): string {
  return `${i.type}_${i.entityId}`;
}

/** The synthetic application name shown for platform-admin / personal chats. */
export const PLATFORM_ENTITY_ID = 'app';

/**
 * Build the list of identities a user can chat as. Mirrors
 * `chatIdentitiesProvider` exactly: owned agencies, staff agencies, owned
 * brands, staff brands, a contractor identity (if connected/has a profile), a
 * platformAdmin identity (super-admins only), and the always-present personal
 * `user` identity.
 */
export async function listChatIdentities(
  user: { id: string; firstName?: string | null; lastName?: string | null; profileUrl?: string | null; role?: string | null; isSuperAdmin?: boolean },
  _appName = 'Prodesk',
  db = defaultDb,
): Promise<ChatIdentity[]> {
  const identities: ChatIdentity[] = [];
  const displayName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

  // ── Agencies (owned + staff) ───────────────────────────────────────────
  const ownedAgencies = await db.select().from(agencies).where(eq(agencies.ownerId, user.id));
  for (const a of ownedAgencies) {
    identities.push({
      type: 'agency',
      entityId: a.id,
      userUid: user.id,
      entityName: a.businessName,
      entityLogo: a.logoUrl,
      entityRole: 'owner',
      isOwner: true,
    });
  }

  const staffAgencyRows = await db
    .select({ agency: agencies })
    .from(staff)
    .innerJoin(agencies, eq(staff.agencyId, agencies.id))
    .where(and(eq(staff.userId, user.id), eq(staff.type, 'agency'), eq(staff.status, 'active')));
  for (const { agency: a } of staffAgencyRows) {
    if (!identities.some((i) => i.entityId === a.id)) {
      identities.push({
        type: 'agency',
        entityId: a.id,
        userUid: user.id,
        entityName: a.businessName,
        entityLogo: a.logoUrl,
        entityRole: 'staff',
        isOwner: false,
      });
    }
  }

  // ── Brands (owned + staff) ─────────────────────────────────────────────
  const ownedBrands = await db.select().from(brands).where(eq(brands.ownerId, user.id));
  for (const b of ownedBrands) {
    identities.push({
      type: 'brand',
      entityId: b.id,
      userUid: user.id,
      entityName: b.businessName,
      entityLogo: b.logoUrl,
      entityRole: 'owner',
      isOwner: true,
    });
  }

  const staffBrandRows = await db
    .select({ brand: brands })
    .from(staff)
    .innerJoin(brands, eq(staff.brandId, brands.id))
    .where(and(eq(staff.userId, user.id), eq(staff.type, 'brand'), eq(staff.status, 'active')));
  for (const { brand: b } of staffBrandRows) {
    if (!identities.some((i) => i.entityId === b.id)) {
      identities.push({
        type: 'brand',
        entityId: b.id,
        userUid: user.id,
        entityName: b.businessName,
        entityLogo: b.logoUrl,
        entityRole: 'staff',
        isOwner: false,
      });
    }
  }

  // ── Contractor identity ────────────────────────────────────────────────
  const contractorProfile = (await db.select().from(contractors).where(eq(contractors.id, user.id)).limit(1))[0];
  const activeContractorConns = await db
    .select()
    .from(agencyContractorConnections)
    .where(and(eq(agencyContractorConnections.contractorId, user.id), eq(agencyContractorConnections.status, 'active')));
  if (user.role === 'individualContractor' || contractorProfile) {
    if (activeContractorConns.length > 0 || contractorProfile) {
      identities.push({
        type: 'contractor',
        entityId: user.id,
        userUid: user.id,
        entityName: displayName || 'Contractor',
        entityLogo: user.profileUrl,
        entityRole: 'contractor',
        isOwner: false,
      });
    }
  }

  // ── Platform admin identity (super-admins only) ────────────────────────
  if (user.isSuperAdmin) {
    identities.push({
      type: 'platformAdmin',
      entityId: PLATFORM_ENTITY_ID,
      userUid: user.id,
      entityName: displayName || 'Super Admin',
      entityLogo: user.profileUrl,
      entityRole: 'admin',
      isOwner: true,
    });
  }

  // ── Personal user identity (everyone) ──────────────────────────────────
  identities.push({
    type: 'user',
    entityId: user.id,
    userUid: user.id,
    entityName: displayName || 'You',
    entityLogo: user.profileUrl,
    entityRole: 'user',
    isOwner: false,
  });

  return identities;
}

/**
 * Brands available for the "Chat about" selector given the active identity.
 * Mirrors `chatBrandsProvider` (chat_state_provider.dart:292-355):
 * - platformAdmin / user → the synthetic platform "brand" (locked).
 * - brand → just that brand.
 * - agency → connected brands.
 * - contractor → brands the contractor has threads with.
 */
export async function listChatBrands(
  identity: { type: ChatIdentityType; entityId: string; userUid: string },
  appName = 'Prodesk',
  db = defaultDb,
): Promise<Array<{ id: string; name: string; logoUrl?: string | null; locked: boolean }>> {
  if (identity.type === 'platformAdmin' || identity.type === 'user') {
    return [{ id: PLATFORM_ENTITY_ID, name: appName, logoUrl: null, locked: true }];
  }

  if (identity.type === 'brand') {
    const b = (await db.select().from(brands).where(eq(brands.id, identity.entityId)).limit(1))[0];
    return b ? [{ id: b.id, name: b.businessName, logoUrl: b.logoUrl, locked: true }] : [];
  }

  if (identity.type === 'agency') {
    const rows = await db
      .select({ brand: brands })
      .from(brandAgencyConnections)
      .innerJoin(brands, eq(brandAgencyConnections.brandId, brands.id))
      .where(eq(brandAgencyConnections.agencyId, identity.entityId));
    return rows.map(({ brand: b }) => ({ id: b.id, name: b.businessName, logoUrl: b.logoUrl, locked: false }));
  }

  // contractor: brands derived from the contractor's threads.
  const threadRows = await db
    .select({ brandId: chatThreads.brandId })
    .from(chatThreadMembers)
    .innerJoin(chatThreads, eq(chatThreadMembers.threadId, chatThreads.id))
    .where(and(eq(chatThreadMembers.userId, identity.userUid), eq(chatThreads.type, 'agencyContractorPersonal')));
  const brandIds = [...new Set(threadRows.map((r) => r.brandId).filter((id): id is string => !!id && id !== PLATFORM_ENTITY_ID))];
  if (brandIds.length === 0) return [];
  const rows = await db.select().from(brands).where(inArray(brands.id, brandIds));
  return rows.map((b) => ({ id: b.id, name: b.businessName, logoUrl: b.logoUrl, locked: false }));
}

/** Resolve a user's display name (used for thread naming). */
export async function userDisplayName(userId: string, db = defaultDb): Promise<string> {
  const u = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!u) return 'Unknown User';
  return [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email;
}
