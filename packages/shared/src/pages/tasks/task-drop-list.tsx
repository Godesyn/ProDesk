import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { cn } from '../../lib/utils';
import { TaskTile } from './task-tile';
import { computeOrderedIds, type TaskRow, type TaskCategory } from './task-utils';

interface DragState {
  task: TaskRow;
  from: TaskCategory;
}

interface TaskDropListProps {
  rows: TaskRow[];
  dragState: DragState | null;
  /** Team-pane tiles get the reduced menu / icon-only styling. */
  isTeamSection?: boolean;
  showCheckbox?: boolean;
  lastViewedAt: Date | string | null | undefined;
  // Tile handlers (forwarded verbatim to each TaskTile).
  onOpenTask: (t: TaskRow) => void;
  onComplete: (t: TaskRow) => void;
  onMove: (t: TaskRow, c: TaskCategory) => void;
  onMoveTop: (t: TaskRow) => void;
  onMoveEnd: (t: TaskRow) => void;
  onDelete: (t: TaskRow) => void;
  onToggleVisibility?: (t: TaskRow, visibleTo: string[] | null) => void;
  onDragStart: (t: TaskRow) => void;
  onDragEnd: () => void;
  /** Commit a reorder/move; receives the destination list's id order. */
  onDropAt: (orderedIds: string[]) => void;
}

/**
 * Reorderable task list with a "make room" drop affordance: instead of aiming
 * for a hairline drop-zone, the gap at the nearest insertion point grows into a
 * full-height dashed placeholder as you drag past it, so the target is large and
 * obvious (mirrors the droppable_task_list, improved). Both the tiles and the
 * gaps report the hovered index, so the layout stays stable as the gap opens.
 */
export function TaskDropList({
  rows,
  dragState,
  isTeamSection = false,
  showCheckbox = false,
  lastViewedAt,
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
}: TaskDropListProps) {
  const dragging = !!dragState;
  // Insertion index the open gap currently sits at (null = no gap shown).
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);

  // Collapse the gap whenever a drag finishes (dropped elsewhere, Esc, etc.).
  useEffect(() => {
    if (!dragging) setActiveIndex(null);
  }, [dragging]);

  const commit = (index: number) => {
    if (dragState) onDropAt(computeOrderedIds(rowIds, dragState.task.id, index));
    setActiveIndex(null);
  };

  // Empty list → a single persistent placeholder accepting a drop at index 0.
  if (rows.length === 0) {
    return (
      <Gap
        index={0}
        empty
        active={activeIndex === 0}
        dragging={dragging}
        onEnter={setActiveIndex}
        onDrop={commit}
      />
    );
  }

  return (
    <div
      onDragLeave={(e) => {
        // Only close the gap when the pointer truly leaves the list — crossing
        // between child tiles/gaps keeps relatedTarget inside this container.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setActiveIndex(null);
      }}
    >
      <Gap index={0} active={activeIndex === 0} dragging={dragging} onEnter={setActiveIndex} onDrop={commit} />
      {rows.map((t, i) => {
        const isDragged = dragging && dragState?.task.id === t.id;
        return (
          <div key={t.id}>
            <div
              className={cn('transition-opacity', isDragged && 'opacity-40')}
              onDragOver={(e) => {
                if (!dragging) return;
                e.preventDefault();
                // Top half → drop above this tile, bottom half → below it.
                const rect = e.currentTarget.getBoundingClientRect();
                const after = e.clientY - rect.top > rect.height / 2;
                setActiveIndex(after ? i + 1 : i);
              }}
            >
              <TaskTile
                task={t}
                isTeamSection={isTeamSection}
                showCheckbox={showCheckbox}
                lastViewedAt={lastViewedAt}
                onOpen={onOpenTask}
                onComplete={onComplete}
                onMove={onMove}
                onMoveTop={onMoveTop}
                onMoveEnd={onMoveEnd}
                onDelete={onDelete}
                onToggleVisibility={onToggleVisibility}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
              />
            </div>
            <Gap
              index={i + 1}
              active={activeIndex === i + 1}
              dragging={dragging}
              onEnter={setActiveIndex}
              onDrop={commit}
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The space between two tiles. Idle it is a 4px spacer; while dragging it stays
 * thin until it becomes the nearest insertion point, then expands into a
 * tile-height dashed accent slot to receive the drop.
 */
function Gap({
  index,
  active,
  dragging,
  empty,
  onEnter,
  onDrop,
}: {
  index: number;
  active: boolean;
  dragging: boolean;
  empty?: boolean;
  onEnter: (index: number) => void;
  onDrop: (index: number) => void;
}) {
  // Static spacing between tiles when nothing is being dragged.
  if (!dragging && !empty) return <div className="h-1" />;

  const handleOver = (e: DragEvent) => {
    e.preventDefault();
    onEnter(index);
  };
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    onDrop(index);
  };

  if (empty) {
    return (
      <div
        onDragOver={handleOver}
        onDrop={handleDrop}
        className={cn(
          'my-1 grid h-9 place-items-center rounded-[6px] border border-dashed text-[11px] italic transition-colors',
          active ? 'border-accent/50 bg-accent/10 text-accent' : 'border-ink-40/40 text-ink-40',
        )}
      >
        {active ? 'Drop here' : 'Drop tasks here'}
      </div>
    );
  }

  return (
    <div
      onDragOver={handleOver}
      onDrop={handleDrop}
      className={cn(
        'overflow-hidden rounded-[6px] transition-all duration-150 ease-out',
        active ? 'my-1 h-9 border border-dashed border-accent/50 bg-accent/10' : 'h-1',
      )}
    />
  );
}
