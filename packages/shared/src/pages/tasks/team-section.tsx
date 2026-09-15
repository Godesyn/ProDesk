import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { subscribeResilient } from '../../lib/resilient-channel';
import { ChevronDown, ChevronRight, Plus, Users, Mail, MailX } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { EmptyState } from '../../components/layout/empty-state';
import { cn } from '../../lib/utils';
import { NewTaskField } from './new-task-field';
import { TaskDropList } from './task-drop-list';
import { memberInitials, optimisticTeamMove, type TaskRow, type TaskCategory, type TeamMember } from './task-utils';

const SECTION_LABEL: Record<TeamMember['role'], string> = {
  owner: 'OWNERS',
  staff: 'STAFF',
  contractor: 'CONTRACTORS',
};
const SECTION_ORDER: TeamMember['role'][] = ['owner', 'staff', 'contractor'];

interface DragState { task: TaskRow; from: TaskCategory; }

export function TeamSection({
  lastViewedAt,
  onOpenTask,
  dragState,
  setDragState,
}: {
  lastViewedAt: Date | string | null | undefined;
  onOpenTask: (t: TaskRow) => void;
  dragState: DragState | null;
  setDragState: (d: DragState | null) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [assignedByMe, setAssignedByMe] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showNew, setShowNew] = useState<Record<string, boolean>>({});

  const members = useQuery(trpc.tasks.teamMembers.queryOptions());

  // Liveness for the Team pane: a teammate's task rows can't reach this manager
  // via table-realtime (the `tasks_visible` RLS policy scopes rows to
  // assignee/visibleTo), so the server fires a `tasks:<userId>` broadcast ping on
  // every task write (lib/realtime.ts). Subscribe to each visible member's
  // channel and refetch their board/counts on a ping. Keyed on the member-id set
  // so we only re-subscribe when the team actually changes.
  const memberKey = (members.data ?? []).map((m) => m.id).join(',');
  useEffect(() => {
    const ids = memberKey ? memberKey.split(',') : [];
    if (!ids.length) return;
    const refetch = () => {
      qc.invalidateQueries({ queryKey: trpc.tasks.list.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.tasks.teamMembers.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.tasks.counts.queryKey() });
    };
    // Resilient subscriptions: revive each member's ping channel after
    // sleep/offline drops and refetch the boards on re-join (pings that fired
    // while the channel was down aren't replayed).
    const handles = ids.map((id) =>
      subscribeResilient({
        // Serialises a rebuild behind the same topic's async teardown.
        topic: `tasks:${id}`,
        build: () => supabase.channel(`tasks:${id}`).on('broadcast', { event: 'changed' }, refetch),
        onCatchUp: refetch,
      }),
    );
    return () => {
      for (const h of handles) h.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);

  // Global task-mailing toggle (NotificationChannel.task).
  const channels = useQuery(trpc.users.unsubscribedChannels.queryOptions());
  const mailingEnabled = !(channels.data?.channels ?? []).includes('task');
  const toggleMailing = useMutation({
    ...trpc.users.toggleUnsubscribeChannel.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.users.unsubscribedChannels.queryKey() }),
    onError: (e) => toastError(e),
  });

  const grouped = useMemo(() => {
    const by: Record<TeamMember['role'], TeamMember[]> = { owner: [], staff: [], contractor: [] };
    for (const m of members.data ?? []) by[m.role].push(m);
    return by;
  }, [members.data]);

  return (
    <div className="flex flex-col md:h-full">
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border-hairline)] px-3 py-2">
        {/* Redundant with the mobile tab label — shown on desktop only. */}
        <span className="hidden text-sm font-semibold text-ink-100 md:inline">Team</span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => toggleMailing.mutate({ channel: 'task', unsubscribe: mailingEnabled })}
            className={cn('transition-colors', mailingEnabled ? 'text-ink-60 hover:text-ink-100' : 'text-ink-40')}
            title={mailingEnabled ? 'Task mailings enabled' : 'Task mailings disabled'}
            aria-label="Toggle task mailings"
          >
            {mailingEnabled ? <Mail className="h-4 w-4" /> : <MailX className="h-4 w-4" />}
          </button>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-60">
            <input
              type="checkbox"
              checked={assignedByMe}
              onChange={(e) => setAssignedByMe(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-ink-40"
            />
            Assigned by me
          </label>
        </div>
      </div>

      <div className="px-2 py-2 md:flex-1 md:overflow-y-auto">
        {members.isLoading ? (
          <div className="space-y-2 p-1">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : (members.data?.length ?? 0) === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Connect with staff or contractors to assign tasks." />
        ) : (
          SECTION_ORDER.map((role) =>
            grouped[role].length === 0 ? null : (
              <div key={role} className="mb-1">
                <p className="px-2 pb-1 pt-2 text-[10px] font-bold tracking-[0.12em] text-ink-40">{SECTION_LABEL[role]}</p>
                {grouped[role].map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    assignedByMe={assignedByMe}
                    expanded={!!expanded[m.id]}
                    showNew={!!showNew[m.id]}
                    lastViewedAt={lastViewedAt}
                    dragState={dragState}
                    onToggle={() => setExpanded((s) => ({ ...s, [m.id]: !s[m.id] }))}
                    onAddTask={() => { setExpanded((s) => ({ ...s, [m.id]: true })); setShowNew((s) => ({ ...s, [m.id]: true })); }}
                    onCloseNew={() => setShowNew((s) => ({ ...s, [m.id]: false }))}
                    onOpenTask={onOpenTask}
                    setDragState={setDragState}
                  />
                ))}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}

function MemberRow({
  member,
  assignedByMe,
  expanded,
  showNew,
  lastViewedAt,
  dragState,
  onToggle,
  onAddTask,
  onCloseNew,
  onOpenTask,
  setDragState,
}: {
  member: TeamMember;
  assignedByMe: boolean;
  expanded: boolean;
  showNew: boolean;
  lastViewedAt: Date | string | null | undefined;
  dragState: DragState | null;
  onToggle: () => void;
  onAddTask: () => void;
  onCloseNew: () => void;
  onOpenTask: (t: TaskRow) => void;
  setDragState: (d: DragState | null) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [dragOver, setDragOver] = useState(false);
  const [subExpanded, setSubExpanded] = useState<Record<TaskCategory, boolean>>({
    inbox: true, todo: true, completed: false, archived: false,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.tasks.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.teamMembers.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.counts.queryKey() });
  };

  const create = useMutation({ ...trpc.tasks.create.mutationOptions(), onSuccess: () => { invalidate(); toast.success('Task created'); }, onError: (e) => toastError(e) });
  const setCategory = useMutation({ ...trpc.tasks.setCategory.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const setSortOrder = useMutation({ ...trpc.tasks.setSortOrder.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const setVisibility = useMutation({ ...trpc.tasks.setVisibility.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const del = useMutation({ ...trpc.tasks.delete.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  // reassign/move are optimistic (see drop handlers); onSettled reconciles with the server/realtime.
  const reassign = useMutation({ ...trpc.tasks.reassign.mutationOptions(), onSettled: invalidate, onError: (e) => toastError(e) });
  const move = useMutation({ ...trpc.tasks.move.mutationOptions(), onSettled: invalidate, onError: (e) => toastError(e) });

  const tileHandlers = {
    onComplete: (t: TaskRow) => setCategory.mutate({ id: t.id, category: 'completed', position: 'top' }),
    onMove: (t: TaskRow, c: TaskCategory) => setCategory.mutate({ id: t.id, category: c, position: 'top' }),
    onMoveTop: (t: TaskRow) => setSortOrder.mutate({ id: t.id, position: 'top' }),
    onMoveEnd: (t: TaskRow) => setSortOrder.mutate({ id: t.id, position: 'bottom' }),
    onDelete: (t: TaskRow) => del.mutate({ id: t.id }),
    onToggleVisibility: (t: TaskRow, visibleTo: string[] | null) => setVisibility.mutate({ id: t.id, visibleTo }),
  };

  return (
    <div className="mb-0.5">
      <div
        className={cn('flex items-center gap-2 rounded-[6px] px-1.5 py-1.5 hover:bg-inset', dragOver && 'bg-accent/5 ring-1 ring-accent/30')}
        onDragOver={(e) => { if (dragState) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          // Drop onto a member header → reassign the task to that member (inbox).
          if (dragState && dragState.task.assigneeId !== member.id) {
            const { task, from } = dragState;
            // Move the tile + bump badge counts instantly, then fire the mutation.
            optimisticTeamMove(
              qc,
              trpc.tasks.list.queryKey(),
              trpc.tasks.teamMembers.queryKey(),
              task,
              task.assigneeId!,
              from,
              member.id,
              'inbox',
              null,
            );
            reassign.mutate({ id: task.id, newAssigneeId: member.id });
          }
          setDragState(null);
        }}
      >
        <button onClick={onToggle} className="text-ink-40 hover:text-ink-100" aria-label="Expand">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Avatar className="h-7 w-7">
          {member.profileUrl && <AvatarImage src={member.profileUrl} alt={member.name} />}
          <AvatarFallback>{memberInitials(member.name)}</AvatarFallback>
        </Avatar>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink-100">{member.name}</p>
        {member.inbox + member.todo > 0 && (
          <span className="shrink-0 rounded-pill bg-ink-100/10 px-1.5 text-[11px] font-semibold text-ink-100">{member.inbox + member.todo}</span>
        )}
        <button onClick={onAddTask} className="shrink-0 text-ink-40 hover:text-ink-100" aria-label="Add task for member">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <div className="ml-7 py-1">
          {showNew && (
            <NewTaskField
              placeholder={`Task for ${member.name.split(' ')[0]}…`}
              onSubmit={(title) => create.mutate({ title, assigneeId: member.id })}
              onClose={onCloseNew}
            />
          )}
          {(['inbox', 'todo', 'completed', 'archived'] as TaskCategory[]).map((cat) => (
            <MemberCategory
              key={cat}
              memberId={member.id}
              category={cat}
              assignedByMe={assignedByMe}
              expanded={subExpanded[cat]}
              presetCount={cat === 'inbox' ? member.inbox : cat === 'todo' ? member.todo : undefined}
              lastViewedAt={lastViewedAt}
              dragState={dragState}
              onToggle={() => setSubExpanded((s) => ({ ...s, [cat]: !s[cat] }))}
              onOpenTask={onOpenTask}
              onDragStart={(t) => setDragState({ task: t, from: t.category as TaskCategory })}
              onDragEnd={() => setDragState(null)}
              onDropAt={(orderedIds) => {
                if (!dragState) return;
                const { task, from } = dragState;
                // Move the tile instantly across the member's columns, then fire the mutation.
                optimisticTeamMove(
                  qc,
                  trpc.tasks.list.queryKey(),
                  trpc.tasks.teamMembers.queryKey(),
                  task,
                  task.assigneeId!,
                  from,
                  member.id,
                  cat,
                  orderedIds,
                );
                move.mutate({ id: task.id, newCategory: cat, newAssigneeId: member.id, orderedIds });
                setDragState(null);
              }}
              {...tileHandlers}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const SUB_TITLE: Record<TaskCategory, string> = { inbox: 'Inbox', todo: 'To Do', completed: 'Completed', archived: 'Archived' };
const SUB_DIM: Partial<Record<TaskCategory, string>> = { completed: 'opacity-70', archived: 'opacity-50' };

function MemberCategory({
  memberId,
  category,
  assignedByMe,
  expanded,
  presetCount,
  lastViewedAt,
  dragState,
  onToggle,
  onOpenTask,
  onComplete,
  onMove,
  onMoveTop,
  onMoveEnd,
  onDelete,
  onToggleVisibility,
  onDragStart,
  onDragEnd,
  onDropAt,
}: {
  memberId: string;
  category: TaskCategory;
  assignedByMe: boolean;
  expanded: boolean;
  presetCount: number | undefined;
  lastViewedAt: Date | string | null | undefined;
  dragState: DragState | null;
  onToggle: () => void;
  onOpenTask: (t: TaskRow) => void;
  onComplete: (t: TaskRow) => void;
  onMove: (t: TaskRow, c: TaskCategory) => void;
  onMoveTop: (t: TaskRow) => void;
  onMoveEnd: (t: TaskRow) => void;
  onDelete: (t: TaskRow) => void;
  onToggleVisibility: (t: TaskRow, visibleTo: string[] | null) => void;
  onDragStart: (t: TaskRow) => void;
  onDragEnd: () => void;
  onDropAt: (orderedIds: string[]) => void;
}) {
  const trpc = useTRPC();
  const [limit, setLimit] = useState(20);
  const list = useQuery({
    ...trpc.tasks.list.queryOptions({ category, memberId, assignedByMe, limit, offset: 0 }),
    enabled: expanded,
    // "Load more" grows `limit` → a new query key. Keep the already-rendered rows
    // visible while the larger window loads, instead of flashing back to a skeleton.
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const count = list.data?.total ?? presetCount ?? 0;

  return (
    <div className="mb-0.5">
      <button
        onClick={onToggle}
        onDragOver={(e) => { if (dragState && !expanded) { e.preventDefault(); onToggle(); } }}
        className="flex w-full items-center gap-1 rounded-[6px] px-1 py-1 text-left hover:bg-inset"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-ink-40" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-40" />}
        <span className="text-xs font-semibold text-ink-80">{SUB_TITLE[category]}</span>
        <span className="text-[11px] text-ink-40">{count}</span>
      </button>

      {expanded && (
        <div className={cn('px-1', SUB_DIM[category])}>
          {list.isLoading ? (
            <Skeleton className="h-7 w-full" />
          ) : (
            <>
              <TaskDropList
                rows={rows}
                dragState={dragState}
                isTeamSection
                showCheckbox={category === 'todo'}
                lastViewedAt={lastViewedAt}
                onOpenTask={onOpenTask}
                onComplete={onComplete}
                onMove={onMove}
                onMoveTop={onMoveTop}
                onMoveEnd={onMoveEnd}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onDropAt={onDropAt}
              />
              {(list.data?.hasMore ?? false) && (
                <div className="flex justify-center py-1">
                  <button onClick={() => setLimit((l) => l + 20)} className="text-[11px] text-accent hover:underline">Load more</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
