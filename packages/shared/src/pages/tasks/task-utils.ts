import type { QueryClient } from '@tanstack/react-query';
import type { RouterOutputs } from '@server/trpc/router';

export type TaskRow = RouterOutputs['tasks']['list']['items'][number];
export type TeamMember = RouterOutputs['tasks']['teamMembers'][number];
export type TaskCategory = 'inbox' | 'todo' | 'completed' | 'archived';
export type SortMode = 'default' | 'createdAtAsc' | 'createdAtDesc';

/** Max length for a manual task title (kept in sync with the server's z.max). */
export const TASK_TITLE_MAX = 50;

export function isSystemTask(t: TaskRow): boolean {
  return t.type !== 'manual';
}

/**
 * Concise, role-aware one-liner for the task list tile. With multiple
 * brands/agencies a bare label is ambiguous, so each summary names the relevant
 * brand/agency (which one of yours, and the counterparty) — mirroring the
 * fuller server `title` shown in the detail dialog.
 */
export function shortSummary(t: TaskRow): string {
  const agency = t.agencyName ?? null;
  const brand = t.brandName ?? null;
  const org = t.organizationName ?? null;
  const connKind = (t.metadata as { type?: string } | null)?.type;
  switch (t.type) {
    case 'staffInvitation':
      return `Staff invitation · ${org ?? 'an organization'}`;
    case 'agencyApproval':
      return `Agency approval${org ? `: ${org}` : ''}`;
    case 'proposalPending':
      return `Proposal for ${brand ?? 'your brand'}${agency ? ` from ${agency}` : ''}`;
    case 'proposalAccepted':
      return `${brand ?? 'A brand'} accepted your proposal${agency ? ` · ${agency}` : ''}`;
    case 'proposalChangeRequested':
      return `Changes from ${brand ?? 'a brand'}${agency ? ` · ${agency}` : ''}`;
    case 'clientApprovalRequest':
      return `Approval needed for ${brand ?? 'your brand'}${agency ? ` · ${agency}` : ''}`;
    case 'agencyWorkflowAction':
      return `Project action${agency ? ` · ${agency}` : ''}`;
    case 'connectionRequest':
      if (connKind === 'invitation') return `Contractor invite from ${agency ?? 'an agency'}`;
      if (connKind === 'application') return `Contractor application${agency ? ` · ${agency}` : ''}`;
      if (connKind === 'brandAgency') return `${agency ?? 'An agency'} wants to connect${brand ? ` with ${brand}` : ''}`;
      return `Connection request${org ? ` · ${org}` : ''}`;
    case 'componentApproval':
      return `Info Hub section for ${brand ?? 'your brand'}${agency ? ` · ${agency}` : ''}`;
    case 'disciplineRequest':
      return 'Discipline request';
    case 'resourceApproval':
      return `Resource review${org ? `: ${org}` : ''}`;
    default:
      return t.title;
  }
}

export function displayTitle(t: TaskRow): string {
  return isSystemTask(t) ? shortSummary(t) : t.title;
}

/** The action-button label for a system task in the detail dialog. */
export function actionLabel(t: TaskRow): string | null {
  switch (t.type) {
    case 'staffInvitation':
      return 'Accept invitation';
    case 'connectionRequest':
      return 'Accept connection';
    case 'agencyApproval':
      return 'Review agency';
    case 'componentApproval':
      return 'Make public';
    case 'resourceApproval':
      return 'Approve resource';
    case 'disciplineRequest':
      return 'Accept discipline';
    case 'clientApprovalRequest':
      return 'Review project';
    case 'proposalPending':
    case 'proposalAccepted':
    case 'proposalChangeRequested':
      return 'Open proposal';
    case 'agencyWorkflowAction':
      return 'Open project';
    default:
      return null;
  }
}

export function isUnviewed(t: TaskRow, lastViewedAt: Date | string | null | undefined): boolean {
  if (!lastViewedAt) return false;
  const seen = new Date(lastViewedAt).getTime();
  const ts = new Date(t.updatedAt ?? t.createdAt).getTime();
  return ts > seen;
}

const TYPE_LABEL: Record<string, string> = {
  staffInvitation: 'Staff Invitation',
  agencyApproval: 'Agency Approval',
  proposalPending: 'Proposal Review',
  proposalAccepted: 'Proposal Accepted',
  clientApprovalRequest: 'Client Approval',
  agencyWorkflowAction: 'Project Action',
  connectionRequest: 'Connection Request',
  componentApproval: 'Component Review',
  proposalChangeRequested: 'Changes Requested',
  disciplineRequest: 'Discipline Request',
  resourceApproval: 'Resource Review',
  manual: 'Task',
};
export function typeLabel(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

/** Compact relative time, like Flutter's timeago en_short. */
export function timeAgo(value: string | Date | null | undefined): string {
  if (!value) return '';
  const then = new Date(value).getTime();
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 60) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.round(d / 7);
  if (w < 5) return `${w}w`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.round(d / 365)}y`;
}

export function memberInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * Build the destination list's id order with `draggedId` inserted at
 * `insertIndex` (mirrors _handleDrop's list rebuild). Works for both same-list
 * reordering (the dragged id is removed first) and cross-list moves.
 */
export function computeOrderedIds(rowIds: string[], draggedId: string, insertIndex: number): string[] {
  const oldIndex = rowIds.indexOf(draggedId);
  const ids = rowIds.filter((id) => id !== draggedId);
  // `insertIndex` is in original coordinates (the drop zones count the dragged
  // row). When the dragged row sat above the drop point, removing it shifts every
  // later slot left by one — without this, dropping C from [C,A,B] after A yields
  // A,B,C instead of A,C,B.
  const target = oldIndex !== -1 && oldIndex < insertIndex ? insertIndex - 1 : insertIndex;
  const clamped = Math.max(0, Math.min(target, ids.length));
  ids.splice(clamped, 0, draggedId);
  return ids;
}

type TaskListData = { items: TaskRow[]; total: number; hasMore: boolean };

/**
 * Optimistically reflect a drag-drop move in the React Query cache so the tile
 * jumps to its new column instantly — before the server round-trip. Updates
 * every cached `tasks.list` page for the source/destination categories plus the
 * counts. The mutation's onSettled invalidate reconciles with the server (and
 * realtime), correcting any cache the optimistic pass couldn't see.
 */
export function optimisticMoveTask(
  qc: QueryClient,
  listKeyPrefix: readonly unknown[],
  countsKey: readonly unknown[],
  task: TaskRow,
  from: TaskCategory,
  to: TaskCategory,
  orderedIds: string[],
) {
  const entries = qc.getQueriesData<TaskListData>({ queryKey: listKeyPrefix });
  // Resolve dest ids → full task objects from any cached page.
  const known = new Map<string, TaskRow>();
  for (const [, data] of entries) if (data?.items) for (const it of data.items) known.set(it.id, it);
  known.set(task.id, { ...task, category: to });

  for (const [key, data] of entries) {
    if (!data) continue;
    const input = (key as [unknown, { input?: { category?: TaskCategory; memberId?: string } }])[1]?.input;
    // Personal board only — team member pages are keyed by memberId and are
    // reconciled by invalidate/realtime, not this optimistic pass.
    if (!input || input.memberId) continue;
    const cat = input.category;
    if (cat === to) {
      const items = orderedIds
        .map((id) => known.get(id))
        .filter((t): t is TaskRow => !!t)
        .map((t) => (t.id === task.id ? { ...t, category: to } : t));
      qc.setQueryData<TaskListData>(key, { ...data, items, total: from === to ? data.total : data.total + 1 });
    } else if (cat === from) {
      qc.setQueryData<TaskListData>(key, { ...data, items: data.items.filter((t) => t.id !== task.id), total: Math.max(0, data.total - 1) });
    }
  }

  if (from !== to) {
    qc.setQueryData<Record<string, number>>(countsKey, (c) =>
      c ? { ...c, [from]: Math.max(0, (c[from] ?? 0) - 1), [to]: (c[to] ?? 0) + 1 } : c,
    );
  }
}

/**
 * Optimistic counterpart of {@link optimisticMoveTask} for the team pane.
 * Relocates `task` from (fromMemberId, fromCategory) to (toMemberId,
 * toCategory) across member-keyed `tasks.list` pages — reordering the dest list
 * by `orderedIds`, or prepending it when `orderedIds` is null (a reassign drop
 * onto a member header). Also patches the teamMembers inbox/todo badge counts.
 * The mutation's onSettled invalidate reconciles with the server/realtime.
 */
export function optimisticTeamMove(
  qc: QueryClient,
  listKeyPrefix: readonly unknown[],
  teamMembersKey: readonly unknown[],
  task: TaskRow,
  fromMemberId: string,
  fromCategory: TaskCategory,
  toMemberId: string,
  toCategory: TaskCategory,
  orderedIds: string[] | null,
) {
  const entries = qc.getQueriesData<TaskListData>({ queryKey: listKeyPrefix });
  const known = new Map<string, TaskRow>();
  for (const [, data] of entries) if (data?.items) for (const it of data.items) known.set(it.id, it);
  const moved = { ...task, category: toCategory, assigneeId: toMemberId };
  known.set(task.id, moved);

  const sameSlot = fromMemberId === toMemberId && fromCategory === toCategory;

  for (const [key, data] of entries) {
    if (!data) continue;
    const input = (key as [unknown, { input?: { category?: TaskCategory; memberId?: string } }])[1]?.input;
    // Personal-board pages (no memberId) belong to optimisticMoveTask.
    if (!input || !input.memberId) continue;
    const isDest = input.memberId === toMemberId && input.category === toCategory;
    const isSrc = input.memberId === fromMemberId && input.category === fromCategory;
    if (isDest) {
      const ids = orderedIds ?? [task.id, ...data.items.filter((t) => t.id !== task.id).map((t) => t.id)];
      const items = ids
        .map((id) => known.get(id))
        .filter((t): t is TaskRow => !!t)
        .map((t) => (t.id === task.id ? moved : t));
      qc.setQueryData<TaskListData>(key, { ...data, items, total: sameSlot ? data.total : data.total + 1 });
    } else if (isSrc) {
      qc.setQueryData<TaskListData>(key, {
        ...data,
        items: data.items.filter((t) => t.id !== task.id),
        total: Math.max(0, data.total - 1),
      });
    }
  }

  if (sameSlot) return;

  // Net inbox/todo deltas per member (a same-member category move touches both).
  const delta = new Map<string, { inbox: number; todo: number }>();
  const bump = (id: string, cat: TaskCategory, d: number) => {
    if (cat !== 'inbox' && cat !== 'todo') return;
    const cur = delta.get(id) ?? { inbox: 0, todo: 0 };
    cur[cat] += d;
    delta.set(id, cur);
  };
  bump(fromMemberId, fromCategory, -1);
  bump(toMemberId, toCategory, 1);

  qc.setQueryData<TeamMember[]>(teamMembersKey, (members) =>
    members?.map((m) => {
      const d = delta.get(m.id);
      return d ? { ...m, inbox: Math.max(0, m.inbox + d.inbox), todo: Math.max(0, m.todo + d.todo) } : m;
    }),
  );
}

/** Colored dot per board category (matches task_detail_category_badge.dart). */
export const CATEGORY_DOT: Record<TaskCategory, string> = {
  inbox: 'bg-blue-500',
  todo: 'bg-amber-500',
  completed: 'bg-green-500',
  archived: 'bg-ink-40',
};

/** Where a system task's association chip navigates (and its label/icon hint). */
export interface AssociationLink {
  label: string;
  /** wouter path, or null for a non-navigable chip. */
  to: string | null;
}
export function associationsFor(t: TaskRow): AssociationLink[] {
  const links: AssociationLink[] = [];
  switch (t.type) {
    case 'proposalPending':
    case 'proposalAccepted':
    case 'proposalChangeRequested':
      links.push({ label: 'Proposal', to: t.proposalId ? `/proposal/${t.proposalId}` : null });
      break;
    case 'staffInvitation':
      links.push({ label: 'Staff Invitation', to: null });
      break;
    case 'connectionRequest':
      links.push({ label: 'Connection Request', to: null });
      break;
    case 'componentApproval':
      links.push({ label: 'Component', to: '/info-hub' });
      break;
    case 'disciplineRequest':
      links.push({ label: 'Discipline Request', to: '/super-admin/disciplines' });
      break;
    case 'agencyApproval':
      links.push({ label: 'Agency Verification', to: '/super-admin/agencies' });
      break;
    case 'resourceApproval':
      links.push({ label: 'Resource Request', to: '/super-admin/resources' });
      break;
    default:
      break;
  }
  if (t.projectId) links.push({ label: 'Project', to: null });
  return links;
}
