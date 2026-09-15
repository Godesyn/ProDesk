import { useState } from 'react';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, ArrowDownUp } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { Skeleton } from '../../components/ui/skeleton';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import { NewTaskField } from './new-task-field';
import { TaskDropList } from './task-drop-list';
import { optimisticMoveTask, type TaskRow, type TaskCategory, type SortMode } from './task-utils';

const PAGE = 15;
const SORT_LABELS: Record<SortMode, string> = {
  default: 'Manual order',
  createdAtAsc: 'Oldest first',
  createdAtDesc: 'Newest first',
};
function nextSort(m: SortMode): SortMode {
  return m === 'default' ? 'createdAtAsc' : m === 'createdAtAsc' ? 'createdAtDesc' : 'default';
}

const CATEGORIES: TaskCategory[] = ['inbox', 'todo', 'completed', 'archived'];
const TITLE: Record<TaskCategory, string> = { inbox: 'Inbox', todo: 'To Do', completed: 'Completed', archived: 'Archived' };
// Completed/archived columns are dimmed (Flutter opacity 0.7 / 0.5).
const DIM: Partial<Record<TaskCategory, string>> = { completed: 'opacity-70', archived: 'opacity-50' };

interface DragState { task: TaskRow; from: TaskCategory; }

export function MySection({
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
  const [sortMode, setSortMode] = useState<SortMode>('default');
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<Record<TaskCategory, boolean>>({
    inbox: true,
    todo: true,
    completed: false,
    archived: false,
  });
  const [limits, setLimits] = useState<Record<TaskCategory, number>>({
    inbox: PAGE,
    todo: PAGE,
    completed: PAGE,
    archived: PAGE,
  });

  const counts = useQuery(trpc.tasks.counts.queryOptions());

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: trpc.tasks.list.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.counts.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.tasks.teamMembers.queryKey() });
  };

  const create = useMutation({
    ...trpc.tasks.create.mutationOptions(),
    onSuccess: () => { invalidate(); toast.success('Task created'); },
    onError: (e) => toastError(e),
  });
  const setCategory = useMutation({
    ...trpc.tasks.setCategory.mutationOptions(),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const setSortOrder = useMutation({
    ...trpc.tasks.setSortOrder.mutationOptions(),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const setVisibility = useMutation({
    ...trpc.tasks.setVisibility.mutationOptions(),
    onSuccess: invalidate,
    onError: (e) => toastError(e),
  });
  const del = useMutation({
    ...trpc.tasks.delete.mutationOptions(),
    onSuccess: () => { invalidate(); toast.success('Task deleted'); },
    onError: (e) => toastError(e),
  });
  const move = useMutation({
    ...trpc.tasks.move.mutationOptions(),
    // Optimistic (see onDropAt); reconcile with server/realtime once settled.
    onSettled: invalidate,
    onError: (e) => toastError(e),
  });

  return (
    <div className="flex flex-col md:h-full">
      {/* Sort header */}
      <div className="flex items-center justify-between gap-2 border-b border-[color:var(--color-border-hairline)] px-3 py-2">
        <div className="flex items-center gap-3">
          {/* Redundant with the mobile tab label — shown on desktop only. */}
          <span className="hidden text-sm font-semibold text-ink-100 md:inline">My Tasks</span>
          <button
            onClick={() => setSortMode(nextSort(sortMode))}
            className="flex items-center gap-1.5 text-xs font-medium text-ink-60 hover:text-ink-100"
            title="Cycle sort mode"
          >
            <ArrowDownUp className="h-3.5 w-3.5" /> {SORT_LABELS[sortMode]}
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowNew(true)} aria-label="Add task">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </div>

      <div className="px-3 py-2 md:flex-1 md:overflow-y-auto">
        {showNew && (
          <NewTaskField
            placeholder="New task for yourself…"
            onSubmit={(title) => create.mutate({ title })}
            onClose={() => setShowNew(false)}
          />
        )}

        {CATEGORIES.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            count={counts.data?.[cat] ?? 0}
            expanded={expanded[cat]}
            limit={limits[cat]}
            sortMode={sortMode}
            lastViewedAt={lastViewedAt}
            dragState={dragState}
            onToggle={() => setExpanded((s) => ({ ...s, [cat]: !s[cat] }))}
            onAutoExpand={() => setExpanded((s) => (s[cat] ? s : { ...s, [cat]: true }))}
            onLoadMore={() => setLimits((s) => ({ ...s, [cat]: s[cat] + PAGE }))}
            onOpenTask={onOpenTask}
            onComplete={(t) => setCategory.mutate({ id: t.id, category: 'completed', position: 'top' })}
            onMove={(t, c) => setCategory.mutate({ id: t.id, category: c, position: 'top' })}
            onMoveTop={(t) => setSortOrder.mutate({ id: t.id, position: 'top' })}
            onMoveEnd={(t) => setSortOrder.mutate({ id: t.id, position: 'bottom' })}
            onDelete={(t) => del.mutate({ id: t.id })}
            onToggleVisibility={(t, visibleTo) => setVisibility.mutate({ id: t.id, visibleTo })}
            onDragStart={(t) => setDragState({ task: t, from: t.category as TaskCategory })}
            onDragEnd={() => setDragState(null)}
            onDropAt={(orderedIds, droppedInto) => {
              if (!dragState) return;
              const { task, from } = dragState;
              // Move the tile instantly, then fire the mutation.
              optimisticMoveTask(qc, trpc.tasks.list.queryKey(), trpc.tasks.counts.queryKey(), task, from, droppedInto, orderedIds);
              move.mutate({
                id: task.id,
                newCategory: droppedInto,
                newAssigneeId: task.assigneeId!,
                orderedIds,
              });
              setDragState(null);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function CategorySection({
  category,
  count,
  expanded,
  limit,
  sortMode,
  lastViewedAt,
  dragState,
  onToggle,
  onAutoExpand,
  onLoadMore,
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
  category: TaskCategory;
  count: number;
  expanded: boolean;
  limit: number;
  sortMode: SortMode;
  lastViewedAt: Date | string | null | undefined;
  dragState: DragState | null;
  onToggle: () => void;
  onAutoExpand: () => void;
  onLoadMore: () => void;
  onOpenTask: (t: TaskRow) => void;
  onComplete: (t: TaskRow) => void;
  onMove: (t: TaskRow, c: TaskCategory) => void;
  onMoveTop: (t: TaskRow) => void;
  onMoveEnd: (t: TaskRow) => void;
  onDelete: (t: TaskRow) => void;
  onToggleVisibility: (t: TaskRow, visibleTo: string[] | null) => void;
  onDragStart: (t: TaskRow) => void;
  onDragEnd: () => void;
  onDropAt: (orderedIds: string[], category: TaskCategory) => void;
}) {
  const trpc = useTRPC();
  const list = useQuery({
    ...trpc.tasks.list.queryOptions({ category, sortMode, limit, offset: 0 }),
    enabled: expanded,
    // "Load more" grows `limit` → a new query key. Keep the already-rendered rows
    // visible while the larger window loads, instead of flashing back to a skeleton.
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const hasMore = list.data?.hasMore ?? false;
  const showCheckbox = category === 'todo';

  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        // Hovering a collapsed header while dragging auto-expands it (DragTarget).
        onDragOver={(e) => { if (dragState) { e.preventDefault(); if (!expanded) onAutoExpand(); } }}
        className="flex w-full items-center gap-1.5 rounded-[6px] px-1 py-1.5 text-left hover:bg-inset"
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-ink-40" /> : <ChevronRight className="h-4 w-4 text-ink-40" />}
        <span className="text-sm font-semibold text-ink-100">{TITLE[category]}</span>
        <span className="text-xs text-ink-40">{count}</span>
      </button>

      {expanded && (
        <div className={cn('rounded-[6px] px-1 py-1', DIM[category])}>
          {list.isLoading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <>
              <TaskDropList
                rows={rows}
                dragState={dragState}
                showCheckbox={showCheckbox}
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
                onDropAt={(orderedIds) => onDropAt(orderedIds, category)}
              />
              {hasMore && (
                <div className="flex justify-center py-1">
                  <Button size="sm" variant="outline" onClick={onLoadMore}>Load More</Button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
