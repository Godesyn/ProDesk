import type { ChatIdentityType } from './identity.js';

/**
 * The thread types. Wire values are camelCase (matching the pg enum in
 * schema.ts). Ports Flutter's `ThreadType` (chat_model.dart:10-32), plus the two
 * consumer types the messenger added.
 */
export type ThreadType =
  | 'all'
  | 'you'
  | 'brandAgencyStaff'
  | 'agencyStaff'
  | 'brandStaff'
  | 'brandAgencyPersonal'
  | 'agencyPersonal'
  | 'brandPersonal'
  | 'agencyContractorPersonal'
  | 'platformAdmin'
  | 'interAgency'
  | 'ai'
  | 'direct'
  | 'group';

export const ALL_THREAD_TYPES: ThreadType[] = [
  'all',
  'you',
  'brandAgencyStaff',
  'agencyStaff',
  'brandStaff',
  'brandAgencyPersonal',
  'agencyPersonal',
  'brandPersonal',
  'agencyContractorPersonal',
  'platformAdmin',
  'interAgency',
  'ai',
  'direct',
  'group',
];

/* ── The consumer messenger (chat.prodesk.com) ─────────────────────────────
 *
 * `direct` and `group` are in ALL_THREAD_TYPES but in NO identity predicate
 * below, and that is load-bearing rather than an oversight.
 *
 * Workspace visibility is `ALL_THREAD_TYPES.filter(<predicate>)`, so staying out
 * of every predicate keeps the existing app's thread list bit-identical for free.
 * That alone is NOT enough, though: packages/shared/src/pages/chat.tsx calls
 * `chat.threads` WITHOUT an identityType in its unread-overview mode, and
 * routers/chat/threads.ts only applies the type filter when one is supplied. So
 * the workspace branch of that query also carries an explicit
 * `notInArray(chatThreads.type, CONSUMER_THREAD_TYPES)`.
 *
 * Get this wrong and a DM appears in the main app's list, where
 * `threadVisuals()` — an exhaustive switch with no `default` — returns undefined
 * into a destructure. A white screen, in the app this feature never touches.
 */
export const CONSUMER_THREAD_TYPES: ThreadType[] = ['direct', 'group'];

export function isConsumerThread(t: ThreadType): boolean {
  return t === 'direct' || t === 'group';
}

/**
 * What the messenger shows: DMs, groups, and your own `you` notes thread — which
 * already exists for every user and is the natural "note to self" surface.
 */
export const MESSENGER_THREAD_TYPES: ThreadType[] = ['direct', 'group', 'you'];

// ── Identity-visibility flags (chat_model.dart:36-60) ──────────────────────

export function brandIdentityThreads(t: ThreadType): boolean {
  // 'ai' = the brand's dedicated AI assistant thread; only surfaced under the
  // brand identity (the "Chat as <brand>" selection).
  return t === 'all' || t === 'brandAgencyStaff' || t === 'brandStaff' || t === 'brandAgencyPersonal' || t === 'brandPersonal' || t === 'ai';
}

export function agencyIdentityThreads(t: ThreadType): boolean {
  return (
    t === 'all' ||
    t === 'brandAgencyStaff' ||
    t === 'agencyStaff' ||
    t === 'brandAgencyPersonal' ||
    t === 'agencyPersonal' ||
    t === 'agencyContractorPersonal' ||
    t === 'interAgency'
  );
}

export function contractorIdentityThreads(t: ThreadType): boolean {
  return t === 'agencyContractorPersonal';
}

export function userIdentityThreads(t: ThreadType): boolean {
  return t === 'you' || t === 'platformAdmin';
}

export function isPersonal(t: ThreadType): boolean {
  return t === 'brandAgencyPersonal' || t === 'agencyPersonal' || t === 'brandPersonal' || t === 'agencyContractorPersonal';
}

// ── Grouping flags (chat_model.dart:76-93) ─────────────────────────────────

export function groupAsInterBrandAgencyThread(t: ThreadType): boolean {
  return t === 'all' || t === 'brandAgencyPersonal' || t === 'brandAgencyStaff' || t === 'interAgency';
}

export function groupAsPrivateOrgThread(t: ThreadType): boolean {
  return t === 'agencyStaff' || t === 'agencyPersonal' || t === 'interAgency' || t === 'brandStaff' || t === 'brandPersonal';
}

export function groupAsContractorThread(t: ThreadType): boolean {
  return t === 'agencyContractorPersonal';
}

/**
 * The thread types visible for a given identity type. Mirrors the
 * `watchBrandThreads` query-type filter (chat_repository.dart:90-109).
 */
export function visibleThreadTypesForIdentity(identityType: ChatIdentityType): ThreadType[] {
  switch (identityType) {
    case 'platformAdmin':
    case 'user':
      return ALL_THREAD_TYPES.filter(userIdentityThreads);
    case 'contractor':
      return ALL_THREAD_TYPES.filter(contractorIdentityThreads);
    case 'brand':
      return ALL_THREAD_TYPES.filter(brandIdentityThreads);
    case 'agency':
      return ALL_THREAD_TYPES.filter(agencyIdentityThreads);
  }
}

/**
 * Section bucket a thread falls into in the grouped list, given the active
 * identity. Mirrors `_groupThreadsForDisplay`
 * (chat_thread_list_grouped.dart:106-143).
 */
export type ThreadSection =
  | 'AI ASSISTANT'
  | 'BRAND THREADS'
  | 'AGENCY THREADS'
  | 'STAFF THREADS'
  | 'CONTRACTOR THREADS'
  | 'PLATFORM ADMIN'
  | 'OTHER THREADS'
  | 'THREADS';

export const THREAD_SECTION_ORDER: ThreadSection[] = [
  'AI ASSISTANT',
  'BRAND THREADS',
  'AGENCY THREADS',
  'STAFF THREADS',
  'CONTRACTOR THREADS',
  'PLATFORM ADMIN',
  'OTHER THREADS',
  'THREADS',
];

export function sectionForThread(t: ThreadType, identityType: ChatIdentityType): ThreadSection {
  if (identityType === 'agency') {
    if (groupAsInterBrandAgencyThread(t)) return 'BRAND THREADS';
    if (groupAsPrivateOrgThread(t)) return 'STAFF THREADS';
    if (groupAsContractorThread(t)) return 'CONTRACTOR THREADS';
    if (t === 'platformAdmin' || t === 'you') return 'PLATFORM ADMIN';
    return 'OTHER THREADS';
  }
  if (identityType === 'brand') {
    if (t === 'ai') return 'AI ASSISTANT';
    if (groupAsPrivateOrgThread(t)) return 'STAFF THREADS';
    if (groupAsInterBrandAgencyThread(t)) return 'AGENCY THREADS';
    if (t === 'platformAdmin' || t === 'you') return 'PLATFORM ADMIN';
    return 'OTHER THREADS';
  }
  return 'THREADS';
}
