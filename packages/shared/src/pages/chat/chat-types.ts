import {
  Building2,
  Store,
  User as UserIcon,
  ShieldCheck,
  UserRound,
  Users,
  Lock,
  Bot,
  type LucideIcon,
} from 'lucide-react';

export type ChatIdentityType = 'agency' | 'brand' | 'contractor' | 'platformAdmin' | 'user';

export interface ChatIdentity {
  type: ChatIdentityType;
  entityId: string;
  entityName: string;
  userUid: string;
  entityRole: string;
  entityLogo?: string | null;
  isOwner: boolean;
}

export const PLATFORM_ENTITY_ID = 'app';

/** Avatar icon + accent color class for an identity type. Mirrors `_buildIdentityAvatar`. */
export function identityVisuals(type: ChatIdentityType): { icon: LucideIcon; tint: string; fg: string } {
  switch (type) {
    case 'agency':
      return { icon: Building2, tint: 'bg-ink-100/10', fg: 'text-ink-100' };
    case 'brand':
      return { icon: Store, tint: 'bg-success/10', fg: 'text-success' };
    case 'contractor':
      return { icon: UserIcon, tint: 'bg-warn/10', fg: 'text-warn' };
    case 'platformAdmin':
      return { icon: ShieldCheck, tint: 'bg-[#a855f7]/10', fg: 'text-[#a855f7]' };
    case 'user':
      return { icon: UserRound, tint: 'bg-ink-60/10', fg: 'text-ink-60' };
  }
}

/** Subtitle line for an identity (chat_identity_selector.dart:450-469). */
export function identitySubtitle(i: ChatIdentity): string {
  switch (i.type) {
    case 'agency':
      return `Agency • ${i.isOwner ? 'Owner' : 'Staff'}`;
    case 'brand':
      return `Brand • ${i.isOwner ? 'Owner' : 'Staff'}`;
    case 'contractor':
      return `Contractor • ${i.isOwner ? 'Owner' : 'Staff'}`;
    case 'platformAdmin':
      return 'Super Admin';
    case 'user':
      return 'Personal';
  }
}

export const IDENTITY_GROUPS: Array<{ type: ChatIdentityType; label: string }> = [
  { type: 'agency', label: 'AGENCIES' },
  { type: 'brand', label: 'BRANDS' },
  { type: 'contractor', label: 'CONTRACTORS' },
  { type: 'platformAdmin', label: 'SUPER ADMIN' },
  { type: 'user', label: 'PERSONAL' },
];

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
  // The consumer messenger's own types (chat.prodesk.com). They should never
  // reach THIS list — routers/chat/threads.ts excludes them from the workspace
  // surface — but they are in the union because the union mirrors the pg enum,
  // and threadVisuals() below must therefore handle them. See the note there.
  | 'direct'
  | 'group';

/**
 * Thread-item icon + accent. Mirrors chat_thread_list_item.dart:37-61.
 *
 * NOTE: this switch has no `default`, which is deliberate — it makes TypeScript
 * fail the build when a thread type is added without a decision here. It is also
 * why a missing case is dangerous rather than ugly: `thread-list.tsx` destructures
 * the result, so `undefined` is a white screen, not a missing icon.
 */
export function threadVisuals(type: ThreadType): { icon: LucideIcon; accent: string } {
  switch (type) {
    case 'ai':
      return { icon: Bot, accent: 'text-accent' };
    case 'all':
    case 'brandAgencyStaff':
    case 'brandStaff':
    case 'agencyStaff':
    case 'interAgency':
    // A messenger group, if one ever leaks in. Defence in depth: a stale cache
    // or a future caller that forgets `surface: 'workspace'` should degrade to a
    // slightly odd row, not to a blank app.
    case 'group':
      return { icon: Users, accent: 'text-ink-100' };
    case 'you':
      return { icon: Lock, accent: 'text-ink-100' };
    case 'platformAdmin':
      return { icon: ShieldCheck, accent: 'text-[#a855f7]' };
    case 'brandAgencyPersonal':
    case 'agencyPersonal':
    case 'brandPersonal':
    case 'agencyContractorPersonal':
    case 'direct':
      return { icon: UserIcon, accent: 'text-success' };
  }
}

export const THREAD_SECTION_ORDER = [
  'AI ASSISTANT',
  'BRAND THREADS',
  'AGENCY THREADS',
  'STAFF THREADS',
  'CONTRACTOR THREADS',
  'PLATFORM ADMIN',
  'OTHER THREADS',
  'THREADS',
] as const;

/** Short relative time (timeago en_short style). */
export function timeAgoShort(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Cap unread at "10+" like Flutter (chat_thread_list_item.dart:205). */
export function unreadLabel(n: number): string {
  return n > 10 ? '10+' : String(n);
}

// ── Message time dividers (chat_time_divider.dart + chat_message_utils.dart) ──

/**
 * Whether a divider should precede the message at `curr`, given its predecessor.
 * Ports `ChatMessageUtils.shouldShowTimeDivider`: first message, a gap of ≥2
 * minutes, or a different calendar day.
 */
export function shouldShowTimeDivider(prev: string | Date | null | undefined, curr: string | Date): boolean {
  if (!prev) return true;
  const p = new Date(prev);
  const c = new Date(curr);
  if (c.getTime() - p.getTime() >= 2 * 60 * 1000) return true;
  return p.toDateString() !== c.toDateString();
}

/**
 * Divider label. Ports `ChatTimeDivider` label logic: same day → time; yesterday
 * → "Yesterday"; within a week → weekday name; otherwise dd/MM/yyyy.
 */
export function timeDividerLabel(value: string | Date): string {
  const d = new Date(value);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'long' });
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// ── Sender role colors (chat_message_panel.dart:359-410) ─────────────────────

/**
 * Text-color class for a member's role badge, keyed by which side of the
 * connection they sit on (the membership `role`). Brand → ink, agency → danger,
 * contractor → warn, otherwise muted grey. Ports the roleColor assignment.
 */
export function roleColorClass(memberRole: string | null | undefined): string {
  switch (memberRole) {
    case 'brand':
      return 'text-ink-100';
    case 'agency':
      return 'text-danger';
    case 'contractor':
      return 'text-warn';
    default:
      return 'text-ink-40';
  }
}

// ── Project attachment status dot (project_attachment_card.dart:154-187) ──────

/** Status-dot color for a project card. Ports the Flutter status→color map. */
export function projectStatusColor(status: string | null | undefined): string {
  switch (status) {
    case 'upcoming':
    case 'clientBrief':
      return '#607d8b'; // blueGrey
    case 'brief':
      return '#9e9e9e'; // grey
    case 'allocate':
      return '#2196f3'; // blue
    case 'production':
      return '#3f51b5'; // indigo
    case 'internalApproval':
      return '#9c27b0'; // purple
    case 'revision':
      return '#ff9800'; // orange
    case 'clientApproval':
      return '#009688'; // teal
    case 'completed':
      return '#4caf50'; // green
    default:
      return '#9e9e9e';
  }
}

/** Human label for a project status enum value. */
export function projectStatusLabel(status: string | null | undefined): string {
  if (!status) return '';
  return status
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
