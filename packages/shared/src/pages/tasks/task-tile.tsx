import { useState } from 'react';
import { Bot, Users, Lock } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import { Avatar, AvatarImage, AvatarFallback } from '../../components/ui/avatar';
import { Tooltip } from '../../components/ui/tooltip';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { useCurrentUser } from '../../auth/auth-context';
import { cn } from '../../lib/utils';
import {
  displayTitle,
  isUnviewed,
  timeAgo,
  memberInitials,
  type TaskRow,
  type TaskCategory,
} from './task-utils';

interface TaskTileProps {
  task: TaskRow;
  showCheckbox?: boolean;
  lastViewedAt: Date | string | null | undefined;
  /** Team-pane tiles get a reduced menu (open / move-to-top / move-to-end). */
  isTeamSection?: boolean;
  onOpen: (task: TaskRow) => void;
  onComplete: (task: TaskRow) => void;
  onMove: (task: TaskRow, category: TaskCategory) => void;
  onMoveTop: (task: TaskRow) => void;
  onMoveEnd: (task: TaskRow) => void;
  onDelete: (task: TaskRow) => void;
  onToggleVisibility?: (task: TaskRow, visibleTo: string[] | null) => void;
  // DnD
  onDragStart?: (task: TaskRow) => void;
  onDragEnd?: () => void;
  draggable?: boolean;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function TaskTile({
  task,
  showCheckbox = false,
  lastViewedAt,
  isTeamSection = false,
  onOpen,
  onComplete,
  onMove,
  onMoveTop,
  onMoveEnd,
  onDelete,
  onToggleVisibility,
  onDragStart,
  onDragEnd,
  draggable = true,
}: TaskTileProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const confirm = useConfirm();
  const { data: me } = useCurrentUser();
  const unviewed = isUnviewed(task, lastViewedAt);
  const cat = task.category as TaskCategory;

  const isSystem = task.assignedBy === 'system';
  const assignerName = isSystem
    ? 'System'
    : (task.assignedByName ?? 'A team member');

  // Visibility control is only relevant to the task's own assignee/assigner.
  const canSeeVisibility =
    me?.id != null && (me.id === task.assigneeId || me.id === task.assignedBy);
  const isPrivate = !!task.visibleTo && task.visibleTo.length > 0;

  function toggleVisibility() {
    if (!onToggleVisibility) return;
    if (isPrivate) {
      onToggleVisibility(task, null); // → visible to whole team
    } else {
      // Private to assignee + assigner (drop the 'system' sentinel / non-uuids).
      const ids = [task.assigneeId, task.assignedBy].filter(
        (v): v is string => !!v && UUID_RE.test(v),
      );
      onToggleVisibility(task, [...new Set(ids)]);
    }
  }

  // Category-specific menu (mirrors TaskTileContextMenu). Team tiles get the
  // reduced set; personal tiles get category-appropriate move actions.
  // Archived tiles get no category moves (matches TaskTileContextMenu); the
  // other categories offer the forward moves available from that column.
  const moveItems =
    !isTeamSection && cat !== 'archived' ? (
      <>
        {cat === 'inbox' && (
          <DropdownMenuItem onSelect={() => onMove(task, 'todo')}>
            Move to To-do
          </DropdownMenuItem>
        )}
        {cat !== 'completed' && (
          <DropdownMenuItem onSelect={() => onMove(task, 'completed')}>
            Move to Completed
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onMove(task, 'archived')}>
          Move to Archived
        </DropdownMenuItem>
        <DropdownMenuSeparator />
      </>
    ) : null;

  return (
    <div
      draggable={draggable}
      onDragStart={() => onDragStart?.(task)}
      onDragEnd={() => onDragEnd?.()}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      onClick={() => onOpen(task)}
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-[6px] border px-2.5 py-1.5 transition-colors',
        'border-[color:var(--color-border-hairline)] hover:border-ink-100/30 hover:bg-inset',
        unviewed ? 'bg-paper' : 'bg-card',
      )}
    >
      {unviewed && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink-100"
          aria-label="New"
        />
      )}

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[13px] text-ink-100',
          unviewed ? 'font-semibold' : 'font-normal',
        )}
      >
        {displayTitle(task)}
      </span>

      <span className="shrink-0 text-[11px] text-ink-40">
        {timeAgo(task.createdAt)}
      </span>

      {/* Visibility toggle (group ↔ private) — assignee/assigner only. */}
      {canSeeVisibility && onToggleVisibility && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleVisibility();
          }}
          className={cn(
            'shrink-0 transition-colors',
            isPrivate ? 'text-danger' : 'text-ink-40 hover:text-ink-100',
          )}
          title={isPrivate ? 'Private task' : 'Visible to team'}
          aria-label={isPrivate ? 'Make visible to team' : 'Make private'}
        >
          {isPrivate ? (
            <Lock className="h-3.5 w-3.5" />
          ) : (
            <Users className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {/* Assigned-by avatar (system robot or the assigner's avatar). Hovering
          names the assigner — full name for a person, "System" for auto-tasks. */}
      <Tooltip label={isSystem ? 'System' : `Assigned by ${assignerName}`} side="top">
        <span className="shrink-0">
          {isSystem ? (
            <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-ink-100/10 text-ink-40">
              <Bot className="h-3.5 w-3.5" />
            </span>
          ) : (
            <Avatar className="h-[22px] w-[22px] text-[9px]">
              {task.assignedByProfileUrl && (
                <AvatarImage src={task.assignedByProfileUrl} alt={assignerName} />
              )}
              <AvatarFallback>{memberInitials(assignerName)}</AvatarFallback>
            </Avatar>
          )}
        </span>
      </Tooltip>

      {/* Context menu trigger (kebab on hover). */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(true);
            }}
            className="shrink-0 px-1 text-ink-40 opacity-0 transition-opacity hover:text-ink-100 group-hover:opacity-100"
            aria-label="Task actions"
          >
            ⋮
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          {moveItems}
          <DropdownMenuItem onSelect={() => onOpen(task)}>
            Open details
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMoveTop(task)}>
            Move to top
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onMoveEnd(task)}>
            Move to end
          </DropdownMenuItem>
          {!isTeamSection && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (!(await confirm({
                    title: 'Delete task?',
                    description: <>Permanently delete <span className="font-medium text-ink-100">{displayTitle(task)}</span>? This cannot be undone.</>,
                    confirmLabel: 'Delete',
                    destructive: true,
                  }))) return;
                  onDelete(task);
                }}
              >
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Complete checkbox (To-do tiles only — Inbox intentionally has none). */}
      {showCheckbox && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onComplete(task);
          }}
          className="grid h-5 w-5 shrink-0 place-items-center rounded-[4px] border border-ink-40 hover:border-ink-100"
          aria-label="Complete task"
        >
          <span className="sr-only">Complete</span>
        </button>
      )}
    </div>
  );
}
