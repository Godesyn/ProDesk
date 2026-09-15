import { useEffect, useState, type DragEvent } from 'react';
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { formatCurrency, formatDate, cn, initialsOf } from '../../lib/utils';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '../../components/ui/avatar';
import { TAG_COLOR_MAP } from '../../lib/tag-colors';
import { cyclePrice, projectPriceSummary } from './cycle-price';
import {
  resolveDropAction,
  type KanbanTransitionAction,
  type ProjectStatus,
} from './transition-action';

/* ─── types ─────────────────────────────────────────────────────────────── */

type Project = {
  id: string;
  title: string | null;
  taskTitle: string | null;
  brandName: string | null;
  agencyName: string | null;
  serviceName: string | null;
  packageName: string | null;
  description: string | null;
  status: string;
  amount: unknown;
  cycleCount: number | null;
  contractorBudget: string | null;
  deadline: Date | string | null;
  revisionCount: number | null;
  clientRevisionCount: number | null;
  assigneeType: string;
  productionAssigneeId: string | null;
  assignee: { name: string; avatar: string | null } | null;
  isInternal: boolean | null;
  briefDocuments: unknown;
  customFieldResponses: unknown;
  allowedTransitions: ProjectStatus[];
  agencyId: string | null;
  tags: { id: string; name: string; color: string }[];
  sortOrder: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Stage = {
  readonly key: string;
  readonly label: string;
  readonly bgHex: string;
  readonly accentHex: string;
  readonly icon: React.ElementType;
};

export interface ProjectsTableViewProps {
  stages: readonly Stage[];
  columns: Record<string, Project[]> | undefined;
  projectsById: Map<string, Project>;
  isAgencyView: boolean;
  sortBy: string;
  onNavigate: (path: string) => void;
  onMoveProject: (vars: {
    id: string;
    status: ProjectStatus;
    orderedIds: string[];
  }) => void;
  onSetStatus: (vars: { id: string; status: ProjectStatus }) => void;
  onOpenDialog: (
    project: Project,
    action: KanbanTransitionAction,
    orderedIds?: string[],
    targetStatus?: string,
  ) => void;
}

/** rgba() string from a #rrggbb hex + alpha. */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* ─── drag state ────────────────────────────────────────────────────────── */

interface DragState {
  project: Project;
  fromStatus: string;
}

/* ─── main component ────────────────────────────────────────────────────── */

export function ProjectsTableView({
  stages,
  columns,
  isAgencyView,
  sortBy,
  onNavigate,
  onMoveProject,
  onSetStatus,
  onOpenDialog,
}: ProjectsTableViewProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(stages.map((s) => [s.key, true])),
  );
  const [dragState, setDragState] = useState<DragState | null>(null);
  // Which gap (insertion point) is currently active: { stageKey, index }.
  const [activeGap, setActiveGap] = useState<{
    stage: string;
    index: number;
  } | null>(null);
  // Which status header is being hovered during drag.
  const [hoveredHeader, setHoveredHeader] = useState<string | null>(null);

  // Clear gap state when drag ends.
  useEffect(() => {
    if (!dragState) {
      setActiveGap(null);
      setHoveredHeader(null);
    }
  }, [dragState]);

  const colCount = isAgencyView ? 7 : 4;

  const handleDragStart = (project: Project) => {
    setDragState({ project, fromStatus: project.status });
  };

  const handleDragEnd = () => {
    setDragState(null);
  };

  /**
   * Commit a drop at a specific insertion index within a status group.
   * Handles same-status reorder and cross-status moves (with transition logic).
   */
  const handleDropAt = (targetStatus: string, insertIndex: number) => {
    if (!dragState) return;
    const { project, fromStatus } = dragState;
    const destProjects = columns?.[targetStatus] ?? [];
    const from = fromStatus as ProjectStatus;
    const to = targetStatus as ProjectStatus;

    if (from === to) {
      // Same-status reorder
      if (sortBy !== 'custom') {
        toast.error('Set sorting to custom to reorder');
        setDragState(null);
        return;
      }
      const colProjects = columns?.[from] ?? [];
      const fromIndex = colProjects.findIndex((p) => p.id === project.id);
      if (fromIndex === insertIndex || insertIndex === -1) {
        setDragState(null);
        return;
      }

      const nextProjects = [...colProjects];
      const [moved] = nextProjects.splice(fromIndex, 1);
      const adjustedIndex =
        fromIndex < insertIndex ? insertIndex - 1 : insertIndex;
      nextProjects.splice(adjustedIndex, 0, moved);
      const newOrder = nextProjects.map((p) => p.id);
      onMoveProject({ id: project.id, status: to, orderedIds: newOrder });
    } else {
      // Cross-status move
      if (!(project.allowedTransitions ?? []).includes(to)) {
        setDragState(null);
        return;
      }

      // Build the destination order with the project inserted at the right spot.
      const nextIds = destProjects.map((p) => p.id);
      if (insertIndex !== -1 && sortBy === 'custom') {
        nextIds.splice(insertIndex, 0, project.id);
      } else {
        nextIds.unshift(project.id);
      }

      const action = resolveDropAction(from, to, {
        workspace: isAgencyView ? 'agency' : 'brand',
        isInternal: !!project.isInternal,
      });

      switch (action) {
        case 'startRevision':
          onMoveProject({
            id: project.id,
            status: 'production',
            orderedIds: nextIds,
          });
          break;
        case 'moveToClientBrief':
          onMoveProject({
            id: project.id,
            status: 'clientBrief',
            orderedIds: nextIds,
          });
          break;
        case 'forceStartUpcoming':
          onMoveProject({
            id: project.id,
            status: 'brief',
            orderedIds: nextIds,
          });
          break;
        case 'invalid':
          toast.error('Invalid transition');
          break;
        case 'completeClientBrief':
          if (isAgencyView) {
            onSetStatus({ id: project.id, status: to });
            break;
          }
          onOpenDialog(project, action, nextIds, to);
          break;
        default:
          onOpenDialog(project, action, nextIds, to);
          break;
      }
    }
    setDragState(null);
  };

  /** Drop on a status header (no specific insertion index — prepend). */
  const handleDropOnHeader = (targetStatus: string) => {
    if (!dragState) return;
    const { project, fromStatus } = dragState;
    const from = fromStatus as ProjectStatus;
    const to = targetStatus as ProjectStatus;

    if (from === to) {
      setDragState(null);
      return;
    }

    if (!(project.allowedTransitions ?? []).includes(to)) {
      setDragState(null);
      return;
    }

    const destProjects = columns?.[to] ?? [];
    const nextIds = [project.id, ...destProjects.map((p) => p.id)];

    const action = resolveDropAction(from, to, {
      workspace: isAgencyView ? 'agency' : 'brand',
      isInternal: !!project.isInternal,
    });

    switch (action) {
      case 'startRevision':
        onMoveProject({
          id: project.id,
          status: 'production',
          orderedIds: nextIds,
        });
        break;
      case 'moveToClientBrief':
        onMoveProject({
          id: project.id,
          status: 'clientBrief',
          orderedIds: nextIds,
        });
        break;
      case 'forceStartUpcoming':
        onMoveProject({ id: project.id, status: 'brief', orderedIds: nextIds });
        break;
      case 'invalid':
        toast.error('Invalid transition');
        break;
      case 'completeClientBrief':
        if (isAgencyView) {
          onSetStatus({ id: project.id, status: to });
          break;
        }
        onOpenDialog(project, action, nextIds, to);
        break;
      default:
        onOpenDialog(project, action, nextIds, to);
        break;
    }
    setDragState(null);
  };

  return (
    <div className="px-4 pb-6 md:px-8">
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          {stages.map((stage) => {
            const projects = columns?.[stage.key] ?? [];
            const isExpanded = expanded[stage.key] ?? true;
            const total = projects.reduce((sum, p) => sum + cyclePrice(p), 0);

            // Determine drop highlight for this header
            const dragging = !!dragState;
            const isDifferentStatus =
              dragging && dragState!.fromStatus !== stage.key;
            const canDrop =
              isDifferentStatus &&
              (dragState!.project.allowedTransitions ?? []).includes(
                stage.key as ProjectStatus,
              );
            const isHeaderHovered = hoveredHeader === stage.key;

            const headerBg =
              isHeaderHovered && canDrop
                ? rgba(stage.accentHex, 0.2)
                : rgba(stage.accentHex, 0.06);

            const headerBorder =
              isHeaderHovered && canDrop
                ? `2px solid ${stage.accentHex}`
                : `2px solid transparent`;

            return (
              <StatusGroup
                key={stage.key}
                stage={stage}
                projects={projects}
                isExpanded={isExpanded}
                isAgencyView={isAgencyView}
                colCount={colCount}
                total={total}
                headerBg={headerBg}
                headerBorder={headerBorder}
                sortBy={sortBy}
                dragState={dragState}
                activeGap={activeGap}
                onToggle={() =>
                  setExpanded((s) => ({ ...s, [stage.key]: !s[stage.key] }))
                }
                onAutoExpand={() =>
                  setExpanded((s) =>
                    s[stage.key] ? s : { ...s, [stage.key]: true },
                  )
                }
                onNavigate={onNavigate}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onSetActiveGap={setActiveGap}
                onDropAt={handleDropAt}
                onHeaderHover={setHoveredHeader}
                onDropOnHeader={handleDropOnHeader}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ─── status group ──────────────────────────────────────────────────────── */

function StatusGroup({
  stage,
  projects,
  isExpanded,
  isAgencyView,
  colCount,
  total,
  headerBg,
  headerBorder,
  sortBy,
  dragState,
  activeGap,
  onToggle,
  onAutoExpand,
  onNavigate,
  onDragStart,
  onDragEnd,
  onSetActiveGap,
  onDropAt,
  onHeaderHover,
  onDropOnHeader,
}: {
  stage: Stage;
  projects: Project[];
  isExpanded: boolean;
  isAgencyView: boolean;
  colCount: number;
  total: number;
  headerBg: string;
  headerBorder: string;
  sortBy: string;
  dragState: DragState | null;
  activeGap: { stage: string; index: number } | null;
  onToggle: () => void;
  onAutoExpand: () => void;
  onNavigate: (path: string) => void;
  onDragStart: (p: Project) => void;
  onDragEnd: () => void;
  onSetActiveGap: (g: { stage: string; index: number } | null) => void;
  onDropAt: (status: string, index: number) => void;
  onHeaderHover: (status: string | null) => void;
  onDropOnHeader: (status: string) => void;
}) {
  const dragging = !!dragState;

  const handleHeaderDragOver = (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    onHeaderHover(stage.key);
    // Auto-expand collapsed groups when hovering with a drag.
    if (!isExpanded) onAutoExpand();
  };

  const handleHeaderDragLeave = () => {
    onHeaderHover(null);
  };

  const handleHeaderDrop = (e: DragEvent) => {
    e.preventDefault();
    onHeaderHover(null);
    onDropOnHeader(stage.key);
  };

  return (
    <>
      {/* Status group header — merged-cell row */}
      <tr
        onDragOver={handleHeaderDragOver}
        onDragLeave={handleHeaderDragLeave}
        onDrop={handleHeaderDrop}
      >
        <td colSpan={colCount} className="py-1">
          <button
            type="button"
            onClick={onToggle}
            className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:brightness-95"
            style={{
              backgroundColor: headerBg,
              border: headerBorder,
            }}
          >
            {isExpanded ? (
              <ChevronDown
                className="h-4 w-4 shrink-0"
                style={{ color: stage.accentHex }}
              />
            ) : (
              <ChevronRight
                className="h-4 w-4 shrink-0"
                style={{ color: stage.accentHex }}
              />
            )}
            <stage.icon
              className="h-4 w-4 shrink-0"
              style={{ color: stage.accentHex }}
            />
            <span
              className="text-[13px] font-semibold leading-none"
              style={{ color: stage.accentHex }}
            >
              {stage.label}
            </span>
            {projects.length > 0 && (
              <span
                className="text-[13px] font-semibold opacity-60"
                style={{ color: stage.accentHex }}
              >
                {projects.length}
              </span>
            )}
            {isAgencyView && total > 0 && (
              <span
                className="ml-auto px-2 py-0.5 text-[10px] font-bold"
                style={{
                  backgroundColor: rgba('#4CAF50', 0.1),
                  color: '#2E7D32',
                }}
              >
                {formatCurrency(total)}
              </span>
            )}
          </button>
        </td>
      </tr>

      {/* Project rows (only when expanded) */}
      {isExpanded && (
        <>
          {/* Top gap for dropping at position 0 (only visible during drag) */}
          <GapRow
            stageKey={stage.key}
            index={0}
            active={activeGap?.stage === stage.key && activeGap.index === 0}
            dragging={dragging}
            colCount={colCount}
            onEnter={onSetActiveGap}
            onDrop={onDropAt}
          />
          {projects.map((p, i) => {
            const isDragged = dragging && dragState?.project.id === p.id;
            return (
              <ProjectRow
                key={p.id}
                project={p}
                index={i}
                stageKey={stage.key}
                stageAccent={stage.accentHex}
                isAgencyView={isAgencyView}
                isDragged={isDragged}
                sortBy={sortBy}
                dragging={dragging}
                activeGap={activeGap}
                colCount={colCount}
                onNavigate={onNavigate}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onSetActiveGap={onSetActiveGap}
                onDropAt={onDropAt}
              />
            );
          })}
          {projects.length === 0 &&
            (dragging &&
            dragState!.fromStatus !== stage.key &&
            (dragState!.project.allowedTransitions ?? []).includes(
              stage.key as ProjectStatus,
            ) ? (
              <tr
                onDragOver={(e) => {
                  e.preventDefault();
                  onSetActiveGap({ stage: stage.key, index: 0 });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  onDropAt(stage.key, 0);
                }}
              >
                <td colSpan={colCount} className="py-1">
                  <div className="grid h-9 place-items-center border border-dashed border-accent/50 bg-accent/5 text-[11px] italic text-ink-40">
                    Drop here to move project
                  </div>
                </td>
              </tr>
            ) : null)}
        </>
      )}
    </>
  );
}

/* ─── project row ───────────────────────────────────────────────────────── */

function ProjectRow({
  project,
  index,
  stageKey,
  stageAccent,
  isAgencyView,
  isDragged,
  sortBy,
  dragging,
  activeGap,
  colCount,
  onNavigate,
  onDragStart,
  onDragEnd,
  onSetActiveGap,
  onDropAt,
}: {
  project: Project;
  index: number;
  stageKey: string;
  stageAccent: string;
  isAgencyView: boolean;
  isDragged: boolean;
  sortBy: string;
  dragging: boolean;
  activeGap: { stage: string; index: number } | null;
  colCount: number;
  onNavigate: (path: string) => void;
  onDragStart: (p: Project) => void;
  onDragEnd: () => void;
  onSetActiveGap: (g: { stage: string; index: number } | null) => void;
  onDropAt: (status: string, index: number) => void;
}) {
  const draggable =
    (project.allowedTransitions?.length ?? 0) > 0 && sortBy === 'custom';
  const overdue =
    isAgencyView && project.deadline
      ? new Date(project.deadline) < new Date() &&
        project.status !== 'completed'
      : false;
  const title =
    project.title ?? project.taskTitle ?? project.serviceName ?? 'Untitled';
  const partyName =
    (isAgencyView ? project.brandName : project.agencyName) || null;
  const cr = project.clientRevisionCount ?? 0;
  const rv = project.revisionCount ?? 0;

  const handleRowDragOver = (e: DragEvent) => {
    if (!dragging) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY - rect.top > rect.height / 2;
    onSetActiveGap({ stage: stageKey, index: after ? index + 1 : index });
  };

  return (
    <>
      <tr
        draggable={draggable}
        onDragStart={() => onDragStart(project)}
        onDragEnd={onDragEnd}
        onDragOver={handleRowDragOver}
        onClick={() => onNavigate(`/project/${project.id}`)}
        className={cn(
          'group cursor-pointer transition-all hover:bg-inset/50',
          isDragged && 'opacity-40',
          overdue && 'bg-red-50/30',
        )}
        style={
          overdue
            ? { borderLeft: '3px solid #F44336' }
            : { borderLeft: `3px solid ${stageAccent}` }
        }
      >
        {/* Assignee avatar (agency view) */}
        {isAgencyView && (
          <td className="w-8 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5">
            {project.productionAssigneeId ? (
              <Avatar
                className="h-6 w-6"
                title={
                  project.assignee?.name ??
                  (project.assigneeType === 'contractor'
                    ? 'Contractor assigned'
                    : 'Staff assigned')
                }
              >
                {project.assignee?.avatar && (
                  <AvatarImage src={project.assignee.avatar} />
                )}
                <AvatarFallback className="text-[9px]">
                  {project.assignee?.name
                    ? initialsOf(project.assignee.name)
                    : project.assigneeType === 'contractor'
                      ? 'C'
                      : 'S'}
                </AvatarFallback>
              </Avatar>
            ) : (
              <span className="inline-block h-6 w-6" />
            )}
          </td>
        )}

        {/* Title */}
        <td className="max-w-0 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5">
          <div className="flex items-center gap-1 truncate">
            {partyName && (
              <span className="shrink-0 text-ink-60">{partyName} |</span>
            )}
            <span
              className={cn('truncate text-ink-100', overdue && 'text-danger')}
            >
              {title}
            </span>
            {project.tags && project.tags.length > 0 && (
              <span className="inline-flex items-center gap-1 ml-1.5 align-middle">
                {project.tags.map((t) => (
                  <span
                    key={t.id}
                    className="h-2 w-2 rounded-full inline-block"
                    style={{
                      backgroundColor: TAG_COLOR_MAP[t.color] || t.color,
                    }}
                    title={t.name}
                  />
                ))}
              </span>
            )}
            {project.packageName && (
              <>
                <span className="mx-2 hidden text-ink-30 md:inline">|</span>
                <span
                  className="inline-block border px-1 py-px text-[8px] font-bold uppercase tracking-[0.1px]"
                  style={{ borderColor: 'var(--color-ink-40)' }}
                >
                  {project.packageName}
                </span>
              </>
            )}
          </div>
        </td>

        {/* Package */}
        <td className="hidden w-24 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5 md:table-cell">
          {project.packageName && (
            <span
              className="inline-block border px-1 py-px text-[8px] font-bold uppercase tracking-[0.1px]"
              style={{ borderColor: 'var(--color-ink-40)' }}
            >
              {project.packageName}
            </span>
          )}
        </td>

        {/* Deadline */}
        <td className="hidden w-28 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5 md:table-cell">
          {project.deadline && (
            <span
              className={cn(
                'flex items-center gap-1 text-[11px]',
                overdue ? 'font-semibold text-danger' : 'text-ink-40',
              )}
            >
              <CalendarDays className="h-3 w-3" />
              {formatDate(project.deadline)}
            </span>
          )}
        </td>

        {/* Revisions */}
        <td className="hidden w-20 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5 text-center md:table-cell">
          <span className="inline-flex items-center gap-1">
            {cr > 0 && (
              <span
                className="border px-1 py-px text-[9px] font-bold"
                style={{
                  backgroundColor: '#FFEBEE',
                  borderColor: '#EF9A9A',
                  color: '#C62828',
                }}
              >
                CR{cr}
              </span>
            )}
            {rv > 0 && (
              <span
                className="border px-1 py-px text-[9px] font-bold"
                style={{
                  backgroundColor: '#FFF8E1',
                  borderColor: '#FFE082',
                  color: '#EF6C00',
                }}
              >
                R{rv}
              </span>
            )}
          </span>
        </td>

        {/* Amount (agency view) */}
        {isAgencyView && (
          <td className="w-24 border-b border-[color:var(--color-border-hairline)] px-2 py-1.5 text-right">
            <span
              className="text-[11px] font-bold"
              style={{ color: '#388E3C' }}
            >
              {projectPriceSummary(project)}
            </span>
          </td>
        )}
      </tr>

      {/* Gap after this row */}
      <GapRow
        stageKey={stageKey}
        index={index + 1}
        active={activeGap?.stage === stageKey && activeGap.index === index + 1}
        dragging={dragging}
        colCount={colCount}
        onEnter={onSetActiveGap}
        onDrop={onDropAt}
      />
    </>
  );
}

/* ─── gap row ───────────────────────────────────────────────────────────── */

/**
 * The insertion-point gap between rows. When idle it's invisible; when it's the
 * active drop target during a drag it expands into an accent-colored dashed row
 * (mirrors the Gap component from task-drop-list.tsx).
 */
function GapRow({
  stageKey,
  index,
  active,
  dragging,
  colCount,
  onEnter,
  onDrop,
}: {
  stageKey: string;
  index: number;
  active: boolean;
  dragging: boolean;
  colCount: number;
  onEnter: (g: { stage: string; index: number } | null) => void;
  onDrop: (status: string, index: number) => void;
}) {
  if (!dragging) return null;

  const handleOver = (e: DragEvent) => {
    e.preventDefault();
    onEnter({ stage: stageKey, index });
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    onDrop(stageKey, index);
  };

  return (
    <tr onDragOver={handleOver} onDrop={handleDrop}>
      <td colSpan={colCount} className="p-0">
        <div
          className={cn(
            'overflow-hidden transition-all duration-150 ease-out',
            active
              ? 'my-0.5 h-8 border border-dashed border-accent/50 bg-accent/10'
              : 'h-0',
          )}
        />
      </td>
    </tr>
  );
}
