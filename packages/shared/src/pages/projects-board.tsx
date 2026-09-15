import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent, closestCorners, useDndContext } from '@dnd-kit/core';
import { FolderKanban, CalendarDays, Settings, Search, SearchX, SlidersHorizontal, FileText, Users, Wrench, ShieldCheck, RotateCcw, ThumbsUp, CheckCircle2, Plus, ChevronsUpDown, CornerDownRight, X, ArrowUpDown, LayoutGrid, List } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '../lib/supabase';
import { subscribeResilient } from '../lib/resilient-channel';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { useDragScroll } from '../hooks/use-drag-scroll';
import { useCurrentUser } from '../auth/auth-context';
import { formatCurrency, formatDate, cn, initialsOf } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Skeleton } from '../components/ui/skeleton';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { SERVICE_TYPE_DISPLAY_NAME, type ServiceType } from '@server/lib/service-type';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { NewProjectDialog } from './projects/new-project-dialog';
import { TAG_COLOR_MAP } from '../lib/tag-colors';
import { WorkflowTransitionHost } from './projects/workflow-transition-dialogs';
import { resolveDropAction, type KanbanTransitionAction, type ProjectStatus } from './projects/transition-action';
import { cyclePrice, projectPriceSummary } from './projects/cycle-price';
import { ProjectsTableView } from './projects/projects-table-view';
import { Popover } from '../components/ui/popover';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';

// Mirror of kanban_status_helpers.dart: title + Material status color used for the
// header dot, the tinted column, and the valid drop-target highlight. Order
// matches the Flutter ProjectStatus enum (clientBrief, upcoming, brief, …).
const STAGES = [
  { key: 'clientBrief', label: 'Client Brief', bgHex: '#F1F3F5', accentHex: '#495057', icon: FileText },
  { key: 'upcoming', label: 'Future Phases', bgHex: '#F1F3F5', accentHex: '#495057', icon: CalendarDays },
  { key: 'brief', label: 'Brief', bgHex: '#EDF2F7', accentHex: '#2B6CB0', icon: FileText },
  { key: 'allocate', label: 'Allocate', bgHex: '#FAF0E6', accentHex: '#B7791F', icon: Users },
  { key: 'production', label: 'Production', bgHex: '#EBF8FF', accentHex: '#2B6CB0', icon: Wrench },
  { key: 'internalApproval', label: 'Internal Approval', bgHex: '#FAF5FF', accentHex: '#6B46C1', icon: ShieldCheck },
  { key: 'revision', label: 'Revision', bgHex: '#FFFAF0', accentHex: '#C05621', icon: RotateCcw },
  { key: 'clientApproval', label: 'Client Approval', bgHex: '#E6FFFA', accentHex: '#319795', icon: ThumbsUp },
  { key: 'completed', label: 'Completed', bgHex: '#F0FFF4', accentHex: '#2F855A', icon: CheckCircle2 },
] as const;

const INVALID = '244, 67, 54'; // Material red, for the rejected drop-target state

/** rgba() string from a #rrggbb hex + alpha (mirrors Color.withValues(alpha:)). */
function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Debounce a value so the board search query only fires after typing settles. */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}



type Project = {
  id: string;
  title: string | null;
  taskTitle: string | null;
  /** Counter-party names resolved by the board query for the card title prefix:
   *  brandName for the agency-side view, agencyName for the brand-side view. */
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
  /** Display info for the assignee avatar (name + profile picture), from the board query. */
  assignee: { name: string; avatar: string | null } | null;
  isInternal: boolean | null;
  briefDocuments: unknown;
  customFieldResponses: unknown;
  allowedTransitions: ProjectStatus[];
  /** The fulfilling agency — used to distinguish own vs sold projects for sales agencies. */
  agencyId: string | null;
  tags: { id: string; name: string; color: string }[];
  sortOrder: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export function ProjectsBoardPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { workspace, agencyId, brandId } = useActiveContext();
  const enabled = workspace === 'brand' ? !!brandId : !!agencyId;
  const isAgencyView = workspace === 'agency';

  // Sales agency detection: when the active agency has isSalesAgency=true, show
  // toggle chips so the user can switch between their own projects and projects
  // they sold but another agency fulfills (Flutter AgencyProjectsSecondaryToolbar).
  const agencyInfo = useQuery({ ...trpc.agencies.byId.queryOptions({ id: agencyId! }), enabled: isAgencyView && !!agencyId });
  const isSalesAgency = !!(agencyInfo.data as { isSalesAgency?: boolean } | undefined)?.isSalesAgency;
  const agencyDisplayName = (agencyInfo.data as { businessName?: string } | undefined)?.businessName ?? 'Own projects';
  const [showOwn, setShowOwn] = useState(true);
  const [showProposed, setShowProposed] = useState(true);
  // When both toggles are on (or the agency isn't a sales agency), request the
  // combined set from the server; client-side filter narrows when one is off.
  const includeSalesAgency = isAgencyView && isSalesAgency && (showOwn || showProposed);

  // Server-side full-text search: the debounced term is part of the query input,
  // so the board query re-runs (and the DB filters) as the user types.
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search.trim(), 300);
  const scope = workspace === 'brand' ? { brandId: brandId! } : { agencyId: agencyId! };

  // Server-side filters (mirror the Flutter board's filter bar). Brand/service/
  // type narrow the agency view; agency/type narrow the brand view. Empty string
  // = "All" (filter omitted from the query input).
  const [filterBrandId, setFilterBrandId] = useState('');
  const [filterAgencyId, setFilterAgencyId] = useState('');
  const [filterServiceNames, setFilterServiceNames] = useState<string[]>([]);
  const [filterServiceTypes, setFilterServiceTypes] = useState<ServiceType[]>([]);
  const [filterDate, setFilterDate] = useState<{
    operator: 'inLast' | 'equals' | 'between' | 'greaterThan' | 'lessThan';
    value: any;
    unit?: 'days' | 'hours' | 'weeks' | 'months';
  } | null>(null);
  const [filterAmount, setFilterAmount] = useState<{
    operator: 'equals' | 'between' | 'greaterThan' | 'lessThan';
    value: any;
  } | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([]);

  const [sortBy, setSortBy] = useState<'custom' | 'deadline' | 'amount' | 'createdAt' | 'updatedAt' | 'title' | 'brand' | 'assignee'>(() => {
    const saved = localStorage.getItem('kanban_sort_by');
    return (saved as any) || 'custom';
  });

  const handleSortChange = (value: 'custom' | 'deadline' | 'amount' | 'createdAt' | 'updatedAt' | 'title' | 'brand' | 'assignee') => {
    setSortBy(value);
    localStorage.setItem('kanban_sort_by', value);
  };

  // View mode is derived from the user's server-persisted uiPreferences
  // (written via updatePref below, alongside hiddenKanbanColumns etc.).
  // We keep a local override so the toggle feels instant (optimistic).
  const [viewModeOverride, setViewModeOverride] = useState<'kanban' | 'table' | null>(null);
  const handleViewModeChange = (mode: 'kanban' | 'table') => {
    setViewModeOverride(mode);
    updatePref.mutate({ key: 'projectBoardViewMode', value: mode });
  };


  // Dropdown option lists, derived server-side from the unfiltered scope so they
  // stay stable while the board narrows.
  const facetsScope = { ...scope, ...(includeSalesAgency ? { includeSalesAgency: true } : {}) };
  const facets = useQuery({ ...trpc.projects.boardFacets.queryOptions(facetsScope), enabled });

  const queryInput = {
    ...scope,
    ...(includeSalesAgency ? { includeSalesAgency: true } : {}),
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(isAgencyView && filterBrandId ? { filterBrandId } : {}),
    ...(!isAgencyView && filterAgencyId ? { filterAgencyId } : {}),
    ...(filterServiceNames.length > 0 ? { serviceName: filterServiceNames } : {}),
    ...(filterServiceTypes.length > 0 ? { serviceType: filterServiceTypes as any } : {}),
    ...(filterDate ? { dateFilter: filterDate } : {}),
    ...(filterAmount ? { amountFilter: filterAmount } : {}),
    ...(filterTags.length > 0 ? { filterTags } : {}),
  };
  const filtersActive = !!(
    debouncedSearch ||
    filterBrandId ||
    filterAgencyId ||
    filterServiceNames.length > 0 ||
    filterServiceTypes.length > 0 ||
    filterDate ||
    filterAmount ||
    filterTags.length > 0 ||
    sortBy !== 'custom'
  );
  const clearFilters = () => {
    setSearch('');
    setFilterBrandId('');
    setFilterAgencyId('');
    setFilterServiceNames([]);
    setFilterServiceTypes([]);
    setFilterDate(null);
    setFilterAmount(null);
    setFilterTags([]);
    handleSortChange('custom');
  };

  // On mobile the filter dropdowns + column toggles are hidden behind a single
  // "Filters" button beside the search and surfaced in a sheet; on desktop the
  // same fields render inline. `stacked` switches them to full-width for the sheet.
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const renderFilterFields = (stacked: boolean) => (
    <div className={cn("flex flex-wrap items-center gap-1.5", stacked && "flex-col items-stretch w-full")}>
      <Popover
        align={stacked ? "start" : "start"}
        className="w-60 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
        trigger={({ toggle }) => (
          <FilterPill
            label={isAgencyView ? "Brand" : "Agency"}
            activeLabel={
              isAgencyView
                ? `Brand: ${(facets.data?.brands ?? []).find((b) => b.id === filterBrandId)?.name || 'Selected'}`
                : `Agency: ${(facets.data?.agencies ?? []).find((a) => a.id === filterAgencyId)?.name || 'Selected'}`
            }
            isActive={isAgencyView ? !!filterBrandId : !!filterAgencyId}
            onClick={toggle}
            onClear={() => {
              if (isAgencyView) setFilterBrandId('');
              else setFilterAgencyId('');
            }}
          />
        )}
      >
        {(close) => (
          <BrandSelectPopover
            value={isAgencyView ? filterBrandId : filterAgencyId}
            options={isAgencyView ? (facets.data?.brands ?? []) : (facets.data?.agencies ?? [])}
            isAgencyView={isAgencyView}
            onChange={(id) => {
              if (isAgencyView) setFilterBrandId(id);
              else setFilterAgencyId(id);
            }}
            close={close}
          />
        )}
      </Popover>

      {isAgencyView && (
        <Popover
          align={stacked ? "start" : "start"}
          className="w-60 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
          trigger={({ toggle }) => (
            <FilterPill
              label="Service"
              activeLabel={
                filterServiceNames.length === 1
                  ? `Service: ${filterServiceNames[0]}`
                  : `Services (${filterServiceNames.length})`
              }
              isActive={filterServiceNames.length > 0}
              onClick={toggle}
              onClear={() => setFilterServiceNames([])}
            />
          )}
        >
          {(close) => (
            <ChecklistFilterPopover
              value={filterServiceNames}
              options={facets.data?.services ?? []}
              onChange={setFilterServiceNames}
              close={close}
            />
          )}
        </Popover>
      )}

      {isAgencyView && (
        <Popover
          align={stacked ? "start" : "start"}
          className="w-60 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
          trigger={({ toggle }) => (
            <FilterPill
              label="Tags"
              activeLabel={
                filterTags.length === 1
                  ? `Tag: ${(facets.data?.tags ?? []).find(t => t.id === filterTags[0])?.name || 'Unknown'}`
                  : `Tags (${filterTags.length})`
              }
              isActive={filterTags.length > 0}
              onClick={toggle}
              onClear={() => setFilterTags([])}
            />
          )}
        >
          {(close) => (
            <ChecklistFilterPopover
              value={filterTags}
              options={(facets.data?.tags ?? []).map(t => t.id)}
              displayLabel={(opt) => (facets.data?.tags ?? []).find(t => t.id === opt)?.name || opt}
              renderLabel={(opt) => {
                const tag = (facets.data?.tags ?? []).find(t => t.id === opt);
                if (!tag) return opt;
                return (
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: TAG_COLOR_MAP[tag.color] || tag.color }} />
                    <span className="truncate">{tag.name}</span>
                  </span>
                );
              }}
              onChange={setFilterTags}
              close={close}
            />
          )}
        </Popover>
      )}

      <Popover
        align={stacked ? "start" : "start"}
        className="w-60 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
        trigger={({ toggle }) => (
          <FilterPill
            label="Type"
            activeLabel={
              filterServiceTypes.length === 1
                ? `Type: ${SERVICE_TYPE_DISPLAY_NAME[filterServiceTypes[0]]}`
                : `Types (${filterServiceTypes.length})`
            }
            isActive={filterServiceTypes.length > 0}
            onClick={toggle}
            onClear={() => setFilterServiceTypes([])}
          />
        )}
      >
        {(close) => (
          <ChecklistFilterPopover
            value={filterServiceTypes}
            options={facets.data?.serviceTypes ?? []}
            displayLabel={(opt) => SERVICE_TYPE_DISPLAY_NAME[opt]}
            onChange={setFilterServiceTypes}
            close={close}
          />
        )}
      </Popover>

      <Popover
        align={stacked ? "start" : "start"}
        className="w-64 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
        trigger={({ toggle }) => {
          let activeLabel = 'Date and time';
          if (filterDate) {
            const { operator, value, unit } = filterDate;
            if (operator === 'inLast') activeLabel = `In last ${value} ${unit}`;
            else if (operator === 'equals') activeLabel = `Date = ${value}`;
            else if (operator === 'between') activeLabel = `Date: ${value[0]} - ${value[1]}`;
            else if (operator === 'greaterThan') activeLabel = `Date > ${value}`;
            else if (operator === 'lessThan') activeLabel = `Date < ${value}`;
          }
          return (
            <FilterPill
              label="Date and time"
              activeLabel={activeLabel}
              isActive={!!filterDate}
              onClick={toggle}
              onClear={() => setFilterDate(null)}
            />
          );
        }}
      >
        {(close) => (
          <DateFilterPopover
            value={filterDate}
            onChange={setFilterDate}
            close={close}
          />
        )}
      </Popover>

      <Popover
        align={stacked ? "start" : "start"}
        className="w-64 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
        trigger={({ toggle }) => {
          let activeLabel = 'Amount';
          if (filterAmount) {
            const { operator, value } = filterAmount;
            if (operator === 'equals') activeLabel = `Amount = $${value}`;
            else if (operator === 'between') activeLabel = `Amount: $${value[0]} - $${value[1]}`;
            else if (operator === 'greaterThan') activeLabel = `Amount > ${value}`;
            else if (operator === 'lessThan') activeLabel = `Amount < ${value}`;
          }
          return (
            <FilterPill
              label="Amount"
              activeLabel={activeLabel}
              isActive={!!filterAmount}
              onClick={toggle}
              onClear={() => setFilterAmount(null)}
            />
          );
        }}
      >
        {(close) => (
          <AmountFilterPopover
            value={filterAmount}
            onChange={setFilterAmount}
            close={close}
          />
        )}
      </Popover>

      <Popover
        align={stacked ? "start" : "start"}
        className="w-48 shadow-xl border border-white/30 !p-1.5 !bg-white/30 !backdrop-blur-lg"
        trigger={({ toggle }) => (
          <SortPill
            label="Sort"
            activeLabel={`Sort: ${SORT_OPTIONS.find((o) => o.value === sortBy)?.label || 'Custom'}`}
            isActive={sortBy !== 'custom'}
            onClick={toggle}
          />
        )}
      >
        {(close) => (
          <SortSelectPopover
            value={sortBy}
            options={SORT_OPTIONS}
            onChange={handleSortChange}
            close={close}
          />
        )}
      </Popover>


      {filtersActive && !stacked && (
        <div
          role="button"
          onClick={clearFilters}
          className="flex w-fit h-[26px] items-center gap-1 rounded-full px-2 text-xs font-medium border border-solid border-slate-300 bg-slate-50/20 text-slate-600 hover:bg-slate-100/50 transition-colors select-none cursor-pointer"
        >
          <X className="h-2.5 w-2.5 stroke-[3]" />
          <span>Clear</span>
        </div>
      )}
    </div>
  );

  const key = trpc.projects.board.queryKey(queryInput);
  const board = useQuery({ ...trpc.projects.board.queryOptions(queryInput), enabled });

  // RLS (app_is_agency_member) causes Supabase Realtime's postgres_changes to
  // drop events, so we listen to explicit pings from the server.
  // Use the procedure-level prefix (no input) so this invalidates every cached
  // board query regardless of filters — and the effect doesn't re-subscribe when
  // filters/search change.
  const boardKeyPrefix = trpc.projects.board.queryKey();
  useEffect(() => {
    if (!enabled) return;
    const topic = workspace === 'agency' ? `projects:agency:${agencyId}` : `projects:brand:${brandId}`;
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic,
      build: () => supabase.channel(topic).on('broadcast', { event: 'changed' }, () => qc.invalidateQueries({ queryKey: boardKeyPrefix })),
      onCatchUp: () => qc.invalidateQueries({ queryKey: boardKeyPrefix }),
    });
    return () => handle.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, workspace, agencyId, brandId]);

  // Client-side filter for sales agency own/proposed toggle (Option A from the
  // plan: load the combined set, filter on the client). When both toggles are
  // off, show nothing; when only one is on, filter to that subset.
  // Per-user hidden columns (uiPreferences.hiddenKanbanColumns), mirroring the
  // Flutter ColumnVisibilityDialog + kanban_board column filter.
  const { data: user } = useCurrentUser();
  const hiddenColumns = ((user?.uiPreferences as any)?.hiddenKanbanColumns as string[] | undefined) ?? [];
  const collapseEmptyKanbanColumns = ((user?.uiPreferences as any)?.collapseEmptyKanbanColumns as boolean | undefined) ?? true;
  const serverViewMode = ((user?.uiPreferences as any)?.projectBoardViewMode as string | undefined);
  const viewMode: 'kanban' | 'table' = viewModeOverride ?? (serverViewMode === 'table' ? 'table' : 'kanban');
  const visibleStages = STAGES.filter((s) => !hiddenColumns.includes(s.key));
  const prevUserSnapshot = useRef<any>(null);
  const updatePref = useMutation({
    ...trpc.users.updateUiPreference.mutationOptions(),
    onMutate: (vars) => {
      qc.cancelQueries({ queryKey: trpc.auth.me.queryKey() });
      const previousUser = qc.getQueryData<any>(trpc.auth.me.queryKey());
      prevUserSnapshot.current = previousUser;
      if (previousUser) {
        const nextUser = structuredClone(previousUser);
        const existingPrefs = (nextUser.uiPreferences ?? {}) as Record<string, any>;
        nextUser.uiPreferences = {
          ...existingPrefs,
          [vars.key]: vars.value,
        };
        qc.setQueryData(trpc.auth.me.queryKey(), nextUser);
      }
      return undefined;
    },
    onError: (err) => {
      if (prevUserSnapshot.current) {
        qc.setQueryData(trpc.auth.me.queryKey(), prevUserSnapshot.current);
      }
      toastError(err);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    },
  });

  const handleSaveSettings = (h: string[], c: boolean) => {
    if (JSON.stringify(h) !== JSON.stringify(hiddenColumns)) {
      updatePref.mutate({ key: 'hiddenKanbanColumns', value: h });
    }
    if (c !== collapseEmptyKanbanColumns) {
      updatePref.mutate({ key: 'collapseEmptyKanbanColumns', value: c });
    }
  };

  const rawColumns = board.data?.columns as Record<string, Project[]> | undefined;

  const columns = useMemo(() => {
    let cols = rawColumns;
    if (rawColumns && isSalesAgency && !(showOwn && showProposed)) {
      if (!showOwn && !showProposed) {
        // Both off → empty board
        cols = Object.fromEntries(STAGES.map((s) => [s.key, []])) as Record<string, Project[]>;
      } else {
        // Filter each column: showOwn keeps agencyId === viewer's agency;
        // showProposed keeps agencyId !== viewer's agency (sold projects).
        const filterFn = showOwn
          ? (p: Project) => p.agencyId === agencyId
          : (p: Project) => p.agencyId !== agencyId;
        cols = Object.fromEntries(
          Object.entries(rawColumns).map(([status, list]) => [status, list.filter(filterFn)]),
        ) as Record<string, Project[]>;
      }
    }

    if (!cols) return cols;

    return Object.fromEntries(
      Object.entries(cols).map(([status, list]) => {
        if (sortBy === 'custom') {
          const sorted = [...list].sort((a, b) => {
            return (a.sortOrder ?? 'a0').localeCompare(b.sortOrder ?? 'a0');
          });
          return [status, sorted];
        }

        const sorted = [...list].sort((a, b) => {
          if (sortBy === 'deadline') {
            if (!a.deadline && !b.deadline) return 0;
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
          }
          if (sortBy === 'amount') {
            return cyclePrice(b) - cyclePrice(a);
          }
          if (sortBy === 'createdAt') {
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          }
          if (sortBy === 'updatedAt') {
            return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
          }
          if (sortBy === 'title') {
            const aTitle = a.title || a.taskTitle || a.serviceName || '';
            const bTitle = b.title || b.taskTitle || b.serviceName || '';
            return aTitle.localeCompare(bTitle);
          }
          if (sortBy === 'brand') {
            const aBrand = a.brandName || '';
            const bBrand = b.brandName || '';
            return aBrand.localeCompare(bBrand);
          }
          if (sortBy === 'assignee') {
            const aName = a.assignee?.name || '';
            const bName = b.assignee?.name || '';
            return aName.localeCompare(bName);
          }
          return 0;
        });
        return [status, sorted];
      })
    ) as Record<string, Project[]>;
  }, [rawColumns, isSalesAgency, showOwn, showProposed, agencyId, sortBy]);

  // Flat id→project lookup for the drag overlay + drop resolution.
  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    if (columns) for (const list of Object.values(columns)) for (const p of list) m.set(p.id, p);
    return m;
  }, [columns]);

  const prevSnapshot = useRef<any>(null);
  const setStatus = useMutation({
    ...trpc.projects.setStatus.mutationOptions(),
    onMutate: (vars) => {
      qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      prevSnapshot.current = prev;
      if (prev) {
        const next = structuredClone(prev);
        for (const st of Object.keys(next.columns)) {
          const idx = next.columns[st].findIndex((p: Project) => p.id === vars.id);
          if (idx >= 0) {
            const [moved] = next.columns[st].splice(idx, 1);
            moved.status = vars.status;
            // Place at top of column — set a sortOrder before the first item
            // so the useMemo client-side re-sort preserves this position.
            const dest = next.columns[vars.status] as any[];
            const firstSort: string | undefined = dest[0]?.sortOrder;
            if (firstSort) {
              const code = firstSort.charCodeAt(0);
              moved.sortOrder = String.fromCharCode(Math.max(code - 1, 32)) + firstSort.slice(1);
            }
            dest.unshift(moved);
            break;
          }
        }
        qc.setQueryData(key, next);
      }
      return undefined;
    },
    onError: (e) => { if (prevSnapshot.current) qc.setQueryData(key, prevSnapshot.current); toastError(e); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  const moveProject = useMutation({
    ...trpc.projects.moveProject.mutationOptions(),
    onMutate: (vars) => {
      qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<any>(key);
      prevSnapshot.current = prev;
      if (prev) {
        const next = structuredClone(prev);
        // Find the project in its current column
        let moved: any = null;
        for (const st of Object.keys(next.columns)) {
          const idx = next.columns[st].findIndex((p: Project) => p.id === vars.id);
          if (idx >= 0) {
            [moved] = next.columns[st].splice(idx, 1);
            moved.status = vars.status;
            break;
          }
        }
        if (moved) {
          // Re-insert into the new column in the specified order and compute a
          // synthetic sortOrder so the useMemo client-side re-sort preserves the
          // optimistic position (the real fractional key is written server-side).
          const destCol: any[] = next.columns[vars.status] ?? [];
          const nextCol: any[] = [];
          for (const pid of vars.orderedIds) {
            if (pid === vars.id) {
              nextCol.push(moved);
            } else {
              const p = destCol.find((x: Project) => x.id === pid);
              if (p) nextCol.push(p);
            }
          }
          // Derive a sortOrder for the moved project that sits between its neighbors.
          const movedIdx = nextCol.indexOf(moved);
          const prevSort: string | null = movedIdx > 0 ? (nextCol[movedIdx - 1].sortOrder ?? 'a0') : null;
          const nextSort: string | null = movedIdx < nextCol.length - 1 ? (nextCol[movedIdx + 1].sortOrder ?? 'a0') : null;
          if (prevSort && nextSort) {
            // Simple midpoint: append '1' to the larger-or-equal prefix — enough
            // to sort between them until the server's real key arrives.
            moved.sortOrder = prevSort < nextSort ? prevSort + 'V' : nextSort + 'V';
          } else if (prevSort) {
            moved.sortOrder = prevSort + 'V';
          } else if (nextSort) {
            // Sort before the first item
            const code = nextSort.charCodeAt(0);
            moved.sortOrder = String.fromCharCode(Math.max(code - 1, 32)) + nextSort.slice(1);
          }
          next.columns[vars.status] = nextCol;
        }
        qc.setQueryData(key, next);
      }
      return undefined;
    },
    onError: (e) => { if (prevSnapshot.current) qc.setQueryData(key, prevSnapshot.current); toastError(e); },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  // Grab-anywhere horizontal panning (Flutter ScrollConfiguration parity).
  const scrollRef = useDragScroll<HTMLDivElement>();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeProject = activeId ? projectsById.get(activeId) ?? null : null;
  const [dialog, setDialog] = useState<{ project: Project; action: KanbanTransitionAction; orderedIds?: string[]; targetStatus?: string } | null>(null);

  const isEmpty = useMemo(() => {
    if (!columns) return true;
    return visibleStages.every((s) => (columns[s.key] ?? []).length === 0);
  }, [columns, visibleStages]);

  function onDragStart(e: DragStartEvent) { setActiveId(e.active.id as string); }
  function onDragCancel() { setActiveId(null); }

  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const id = e.active.id as string;
    const overId = e.over?.id as string | undefined;
    if (!overId) return;

    const project = projectsById.get(id);
    if (!project) return;
    const from = project.status as ProjectStatus;

    const targetIsStatus = STAGES.some((s) => s.key === overId);
    let to: ProjectStatus;
    let targetIndex = -1;

    if (targetIsStatus) {
      to = overId as ProjectStatus;
    } else {
      const targetProj = projectsById.get(overId);
      if (!targetProj) return;
      to = targetProj.status as ProjectStatus;
      const colProjects = columns?.[to] ?? [];
      targetIndex = colProjects.findIndex((p) => p.id === overId);
    }

    if (from === to) {
      if (sortBy !== 'custom') {
        toast.error('Set sorting to custom to reorder');
        return;
      }
      const colProjects = columns?.[from] ?? [];
      const fromIndex = colProjects.findIndex((p) => p.id === id);
      if (fromIndex === targetIndex || targetIndex === -1) return;

      const nextProjects = [...colProjects];
      const [moved] = nextProjects.splice(fromIndex, 1);
      nextProjects.splice(targetIndex, 0, moved);

      const newOrder = nextProjects.map((p) => p.id);
      moveProject.mutate({ id, status: to, orderedIds: newOrder });
      return;
    }

    // Client-side gate: only proceed if the server marked this column allowed
    // (the server re-validates and runs side effects regardless).
    if (!(project.allowedTransitions ?? []).includes(to)) return;

    // Calculate the target order for cross-column drops
    const destColProjects = columns?.[to] ?? [];
    const nextIds = destColProjects.map((p) => p.id);
    if (targetIndex !== -1 && sortBy === 'custom') {
      nextIds.splice(targetIndex, 0, id);
    } else {
      nextIds.unshift(id); // Drop at top if not custom sorting or no target
    }

    const action = resolveDropAction(from, to, { workspace: isAgencyView ? 'agency' : 'brand', isInternal: !!project.isInternal });
    switch (action) {
      // Direct (dialog-less) transitions — mirror kanban_column._handleDrop.
      // Completion (directComplete/markComplete) is NOT direct: it falls through
      // to the review dialog so the delivery list is seen before completing.
      case 'startRevision': moveProject.mutate({ id, status: 'production' as never, orderedIds: nextIds }); return;
      case 'moveToClientBrief': moveProject.mutate({ id, status: 'clientBrief' as never, orderedIds: nextIds }); return;
      case 'forceStartUpcoming': moveProject.mutate({ id, status: 'brief' as never, orderedIds: nextIds }); return;
      case 'invalid': toast.error('Invalid transition'); return;
      case 'completeClientBrief':
        // The client-brief questionnaire is the brand's to fill; an agency just
        // advances the stage (the brand form would 403 for agency users).
        if (isAgencyView) { setStatus.mutate({ id, status: to as never }); return; }
        break;
    }
    // Everything else opens the matching confirmation dialog.
    setDialog({ project, action, orderedIds: nextIds, targetStatus: to });
  }

  return (
    <div className="-mx-4 -mt-4 md:-mx-8 md:-mt-8 relative min-h-[calc(100vh-64px)] overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808006_1px,transparent_1px),linear-gradient(to_bottom,#80808006_1px,transparent_1px)] bg-[size:24px_24px]"></div>
        {/* Glowing theme-colored orb */}
        <div className="absolute left-1/2 top-0 -z-10 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] opacity-[0.025] blur-[120px]"></div>
      </div>
      
      <div className="relative z-10 flex h-full flex-col">
        <div className="px-4 pt-4 md:px-8 md:pt-8">
          {!isAgencyView && (
            <PageHeader
              title="Projects"
              description="Drag cards across the production pipeline, or open a card for full detail."
              action={
                <div className="flex items-center gap-2">
                  {/* Columns picker is desktop-only; on mobile it lives in the filter sheet. */}
                  <BoardSettingsButton 
                    className="hidden md:inline-flex h-8 text-xs py-1" 
                    hidden={hiddenColumns} 
                    collapseEmpty={collapseEmptyKanbanColumns}
                    saving={updatePref.isPending} 
                    onSave={handleSaveSettings} 
                  />
                </div>
              }
            />
          )}

          {/* Filter bar — server-side search + filters (ports the Flutter board's filter row).
              Desktop shows the dropdowns inline; mobile collapses them (plus the column
              picker) into a single "Filters" button beside the search. */}
          <div className="flex flex-wrap items-center gap-1.5 pb-3">
        {/* View toggle (Kanban / Table) — desktop only */}
        <div className="hidden md:inline-flex h-8 items-center border border-[color:var(--color-border-default)] bg-card p-0.5">
          <button
            type="button"
            onClick={() => handleViewModeChange('kanban')}
            className={cn(
              'inline-flex h-6 items-center justify-center px-2 text-xs font-medium transition-colors',
              viewMode === 'kanban' ? 'bg-accent text-white shadow-sm' : 'text-ink-60 hover:text-ink-100',
            )}
            title="Kanban view"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange('table')}
            className={cn(
              'inline-flex h-6 items-center justify-center px-2 text-xs font-medium transition-colors',
              viewMode === 'table' ? 'bg-accent text-white shadow-sm' : 'text-ink-60 hover:text-ink-100',
            )}
            title="Table view"
          >
            <List className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="relative flex-1 md:flex-none">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-40" />
          <Input
            className={cn(
              "w-full pl-8 h-8 text-xs md:w-48 py-1 !bg-transparent",
              search && "pr-8"
            )}
            placeholder="Search projects…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-40 hover:text-ink-80 transition-colors"
              title="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Inline filters — desktop only (`contents` so they join the flex row). */}
        <div className="hidden md:contents">
          {renderFilterFields(false)}
        </div>

        {isAgencyView && (
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            <BoardSettingsButton 
              className="hidden md:inline-flex h-8 w-8 p-0" 
              iconOnly 
              hidden={hiddenColumns} 
              collapseEmpty={collapseEmptyKanbanColumns}
              saving={updatePref.isPending} 
              onSave={handleSaveSettings} 
            />
            {agencyId && <NewProjectDialog agencyId={agencyId} onCreated={(id) => navigate(`/project/${id}`)} iconOnly className="h-8 w-8 p-0" />}
          </div>
        )}

        {/* Mobile: open filters + columns in a sheet. */}
        <Button variant="outline" className="relative shrink-0 md:hidden h-8 w-8 p-0" aria-label="Filters" onClick={() => setFilterSheetOpen(true)}>
          <SlidersHorizontal className="h-3.5 w-3.5" />
          {(filtersActive || hiddenColumns.length > 0) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
        </Button>
      </div>

      {/* Sales agency toggle chips — shown when the active agency is a sales
          agency, mirroring the Flutter AgencyProjectsSecondaryToolbar. Desktop
          only; on mobile these appear in the filter sheet above. */}
      {isAgencyView && isSalesAgency && (
        <div className="hidden items-center gap-2 pb-3 md:flex">
          <ToggleChip label={agencyDisplayName} selected={showOwn} onChange={setShowOwn} />
          <ToggleChip label="Other agencies" selected={showProposed} onChange={setShowProposed} />
        </div>
      )}
      </div>

      {/* Mobile filter + column-visibility sheet. */}
      <Dialog open={filterSheetOpen} onOpenChange={setFilterSheetOpen}>
        <DialogContent className="md:hidden">
          <DialogHeader><DialogTitle>Filters</DialogTitle></DialogHeader>
          <div className="flex flex-col gap-3">
            {renderFilterFields(true)}
            {filtersActive && <Button variant="ghost" className="self-start" onClick={clearFilters}>Clear filters</Button>}
          </div>
          <div className="mt-2 border-t border-[color:var(--color-border-hairline)] pt-3">
            <p className="mb-2 text-sm font-medium text-ink-80">View Mode</p>
            <div className="inline-flex h-8 items-center border border-[color:var(--color-border-default)] bg-card p-0.5 w-full">
              <button
                type="button"
                onClick={() => handleViewModeChange('kanban')}
                className={cn(
                  'flex-1 inline-flex h-6 items-center justify-center gap-1.5 text-xs font-medium transition-colors',
                  viewMode === 'kanban' ? 'bg-accent text-white shadow-sm' : 'text-ink-60 hover:text-ink-100',
                )}
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                Kanban
              </button>
              <button
                type="button"
                onClick={() => handleViewModeChange('table')}
                className={cn(
                  'flex-1 inline-flex h-6 items-center justify-center gap-1.5 text-xs font-medium transition-colors',
                  viewMode === 'table' ? 'bg-accent text-white shadow-sm' : 'text-ink-60 hover:text-ink-100',
                )}
              >
                <List className="h-3.5 w-3.5" />
                Table
              </button>
            </div>
          </div>
          {/* Sales agency toggles — mobile version of the desktop chips above. */}
          {isSalesAgency && (
            <div className="mt-2 flex items-center gap-2 border-t border-[color:var(--color-border-hairline)] pt-3">
              <ToggleChip label={agencyDisplayName} selected={showOwn} onChange={setShowOwn} />
              <ToggleChip label="Other agencies" selected={showProposed} onChange={setShowProposed} />
            </div>
          )}
          <div className="mt-2 border-t border-[color:var(--color-border-hairline)] pt-3">
            <p className="mb-1 text-sm font-medium text-ink-80">Columns</p>
            <div className="flex flex-col">
              {STAGES.map((s) => {
                const visible = !hiddenColumns.includes(s.key);
                return (
                  <label key={s.key} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm font-medium text-ink-80">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[var(--color-accent)]"
                      checked={visible}
                      onChange={(e) => {
                        const next = e.target.checked ? hiddenColumns.filter((k) => k !== s.key) : [...hiddenColumns, s.key];
                        updatePref.mutate({ key: 'hiddenKanbanColumns', value: next });
                      }}
                    />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>
          <DialogFooter><Button variant="accent" onClick={() => setFilterSheetOpen(false)}>Done</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {board.isLoading ? (
        <div className="flex gap-4">{visibleStages.slice(0, 4).map((s) => <Skeleton key={s.key} className="h-64 w-[350px]" />)}</div>
      ) : isEmpty ? (
        filtersActive ? (
          debouncedSearch ? (
            <EmptyState
              icon={SearchX}
              title="No projects match this search"
              description={`No projects match "${debouncedSearch}"${filterBrandId || filterAgencyId || filterServiceNames.length > 0 || filterServiceTypes.length > 0 || filterDate || filterAmount || filterTags.length > 0 ? ' with the current filters' : ''}.`}
              action={
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => setSearch('')}>
                    <X className="mr-1.5 h-3 w-3" /> Clear search
                  </Button>
                  {(filterBrandId || filterAgencyId || filterServiceNames.length > 0 || filterServiceTypes.length > 0 || filterDate || filterAmount || filterTags.length > 0) && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      Clear all filters
                    </Button>
                  )}
                </div>
              }
            />
          ) : (
            <EmptyState
              icon={SlidersHorizontal}
              title="No projects match these filters"
              description="Try adjusting or removing some filters to see more projects."
              action={
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  <X className="mr-1.5 h-3 w-3" /> Clear all filters
                </Button>
              }
            />
          )
        ) : (
          <EmptyState
            icon={FolderKanban}
            title="No projects yet"
            description={isAgencyView ? 'Create your first project or wait for clients to purchase services.' : 'Projects will appear here once your agency starts working on services.'}
            action={
              isAgencyView && agencyId ? (
                <NewProjectDialog agencyId={agencyId} onCreated={(id) => navigate(`/project/${id}`)} className="mt-1" />
              ) : undefined
            }
          />
        )
      ) : viewMode === 'table' ? (
        <ProjectsTableView
          stages={visibleStages}
          columns={columns}
          projectsById={projectsById}
          isAgencyView={isAgencyView}
          sortBy={sortBy}
          onNavigate={navigate}
          onMoveProject={(vars) => moveProject.mutate(vars as any)}
          onSetStatus={(vars) => setStatus.mutate(vars as any)}
          onOpenDialog={(project, action, orderedIds, targetStatus) => setDialog({ project: project as any, action, orderedIds, targetStatus })}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
          {/* max-md:items-start — on mobile, columns size to their own content
              (empty columns stay short) instead of stretching to the tallest one,
              which wasted ~350px on a phone. Desktop keeps equal-height columns. */}
          <div ref={scrollRef} className="flex cursor-grab gap-4 overflow-x-auto pb-6 max-md:items-start">
            <div className="w-0 shrink-0 md:w-4" />
            {visibleStages.map((s) => (
            <Column
              key={s.key}
              stage={s}
              projects={columns?.[s.key] ?? []}
              activeProject={activeProject}
              isAgencyView={isAgencyView}
              onOpen={(pid) => navigate(`/project/${pid}`)}
              collapseEmptyKanbanColumns={collapseEmptyKanbanColumns}
            />
          ))}
            <div className="w-0 shrink-0 md:w-4" />
          </div>
          {/* Rotated, slightly-faded drag preview (KanbanProjectCard feedback). */}
          <DragOverlay>
            {activeProject ? (
              <div style={{ width: 334, transform: 'rotate(2.86deg)', opacity: 0.9 }}>
                <CardView project={activeProject} isAgencyView={isAgencyView} color={STAGES.find((s) => s.key === activeProject.status)?.accentHex} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      {dialog && (
        <WorkflowTransitionHost
          project={dialog.project}
          action={dialog.action}
          orderedIds={dialog.orderedIds}
          targetStatus={dialog.targetStatus}
          agencyId={agencyId ?? null}
          onClose={() => setDialog(null)}
          onChanged={() => qc.invalidateQueries({ queryKey: key })}
        />
      )}
      </div>
    </div>
  );
}

function Column({ stage, projects, activeProject, isAgencyView, onOpen, collapseEmptyKanbanColumns }: {
  stage: { key: string; label: string; bgHex: string; accentHex: string; icon: React.ElementType };
  projects: Project[];
  activeProject: Project | null;
  isAgencyView: boolean;
  onOpen: (id: string) => void;
  collapseEmptyKanbanColumns: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const total = projects.reduce((sum, p) => sum + cyclePrice(p), 0);

  // Valid/invalid drop highlight, only while a card is hovering (mirrors the
  // Flutter DragTarget candidate/rejected states).
  const dragging = !!activeProject && activeProject.status !== stage.key;
  const canDrop = dragging && (activeProject!.allowedTransitions ?? []).includes(stage.key as ProjectStatus);
  const { over } = useDndContext();
  const isOverColumn = isOver || (over && projects.some(p => p.id === over.id));
  const dropStyle: React.CSSProperties =
    isOverColumn && canDrop
      ? { backgroundColor: rgba(stage.accentHex, 0.15), border: `2px solid ${stage.accentHex}` }
      : isOverColumn && dragging
        ? { backgroundColor: `rgba(${INVALID}, 0.05)`, border: `2px solid rgba(${INVALID}, 0.3)` }
        : { border: '2px solid transparent' };

  const isCollapsed = collapseEmptyKanbanColumns && projects.length === 0 && !canDrop;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-full shrink-0 flex-col rounded-none transition-[width] duration-200 ease-in-out",
        isCollapsed ? "w-[32px] max-md:w-[32px]" : "w-[350px] max-md:w-[85vw]"
      )}
      style={{ boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}
    >
      <div 
        className={cn(
          "flex gap-2 rounded-[8px] transition-all duration-200",
          isCollapsed ? "flex-col items-center py-4 px-0 justify-start min-h-[200px]" : "items-center px-3 py-2"
        )} 
        style={{ border: projects.length === 0 ? `1px dashed ${rgba(stage.accentHex, 0.1)}` : `1px solid ${stage.accentHex}`, opacity: isCollapsed ? 0.6 : 1 }}
      >
        <stage.icon className="h-4 w-4 shrink-0" style={{ color: stage.accentHex }} />
        <span 
          className="text-[13px] font-semibold leading-none whitespace-nowrap" 
          style={{ 
            color: stage.accentHex,
            writingMode: isCollapsed ? 'vertical-rl' : 'horizontal-tb',
            transform: isCollapsed ? 'rotate(180deg)' : 'none'
          }}
        >
          {stage.label}
        </span>
        {projects.length > 0 && (
          <span 
            className={cn("text-[13px] font-semibold opacity-60", isCollapsed && "mt-2")} 
            style={{ 
              color: stage.accentHex,
              writingMode: isCollapsed ? 'vertical-rl' : 'horizontal-tb',
              transform: isCollapsed ? 'rotate(180deg)' : 'none'
            }}
          >
            {projects.length}
          </span>
        )}
        {!isCollapsed && (
          <div className="ml-auto flex items-center gap-2">
            {isAgencyView && total > 0 && (
              <span className="rounded-[12px] px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: rgba('#4CAF50', 0.1), color: '#2E7D32' }}>{formatCurrency(total)}</span>
            )}
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="mt-2 flex-1 transition-colors" style={{ ...dropStyle, minHeight: projects.length === 0 ? '80px' : '400px' }}>
          <SortableContext items={projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {projects.length === 0 && !dragging && (
              <div 
                className="flex flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed py-8 px-4 text-center transition-all hover:bg-card/50"
                style={{
                  borderColor: rgba(stage.accentHex, 0.25),
                  backgroundColor: rgba(stage.accentHex, 0.02),
                  minHeight: '130px'
                }}
              >
                <div 
                  className="flex h-8 w-8 items-center justify-center rounded-full border shadow-sm"
                  style={{
                    backgroundColor: rgba(stage.accentHex, 0.08),
                    borderColor: rgba(stage.accentHex, 0.18),
                    color: stage.accentHex
                  }}
                >
                  <stage.icon className="h-4 w-4" />
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] font-semibold text-ink-80">No projects in {stage.label}</p>
                  <p className="text-[10px] text-ink-40 leading-normal max-w-[220px] mx-auto">
                    {stage.key === 'clientBrief'
                      ? 'Waiting for new briefs to be submitted.'
                      : stage.key === 'completed'
                      ? 'Completed projects will appear here.'
                      : 'No active cards in this phase.'}
                  </p>
                </div>
              </div>
            )}
            {projects.map((p) => <ProjectCard key={p.id} project={p} isAgencyView={isAgencyView} onOpen={onOpen} color={stage.accentHex} />)}
          </SortableContext>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, isAgencyView, onOpen, color }: { project: Project; isAgencyView: boolean; onOpen: (id: string) => void; color: string }) {
  const draggable = (project.allowedTransitions?.length ?? 0) > 0;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: project.id });
  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
      }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-kanban-card
      {...(draggable ? listeners : {})}
      {...attributes}
      onClick={() => { if (!isDragging) onOpen(project.id); }}
      className={cn('mb-[2px] cursor-pointer last:mb-0', draggable && 'cursor-grab active:cursor-grabbing', isDragging && 'opacity-50')}
    >
      <CardView project={project} isAgencyView={isAgencyView} color={color} />
    </div>
  );
}

/** Presentational card (used in-column and in the drag overlay). Mirrors KanbanProjectCard. */
function CardView({ project, isAgencyView, color }: { project: Project; isAgencyView: boolean; color?: string }) {
  const overdue = isAgencyView && project.deadline ? new Date(project.deadline) < new Date() && project.status !== 'completed' : false;
  const title = project.title ?? project.taskTitle ?? project.serviceName ?? 'Untitled';
  // Counter-party prefix (mirrors KanbanProjectCard): the agency sees the client
  // brand, a brand sees the fulfilling agency. Rendered at lower opacity than the
  // task title, followed by a pipe. Hidden when no name resolves.
  const partyName = (isAgencyView ? project.brandName : project.agencyName) || null;
  const cr = project.clientRevisionCount ?? 0;
  const rv = project.revisionCount ?? 0;
  const onlyPriceOnFirstRow = isAgencyView && !project.productionAssigneeId && !project.deadline && cr === 0 && rv === 0;

  return (
    <div
      className={cn('rounded-l-[4px] rounded-r-none bg-white/50 backdrop-blur-sm', isAgencyView ? 'p-1 px-1.5' : 'p-1.5 px-2')}
      style={overdue ? { border: '2px solid #F44336', backgroundColor: 'rgba(244,67,54,0.04)' } : { border: 'none', borderLeft: color ? `5px solid ${color}` : undefined }}
    >
      {(isAgencyView && (project.productionAssigneeId || project.deadline)) || project.deadline || cr > 0 || rv > 0 || isAgencyView ? (
        <div className="flex items-center gap-2">
          {isAgencyView && project.productionAssigneeId && (
            <Avatar
              className="h-5 w-5"
              title={project.assignee?.name ?? (project.assigneeType === 'contractor' ? 'Contractor assigned' : 'Staff assigned')}
            >
              {project.assignee?.avatar && <AvatarImage src={project.assignee.avatar} />}
              <AvatarFallback className="text-[9px]">
                {project.assignee?.name
                  ? initialsOf(project.assignee.name)
                  : project.assigneeType === 'contractor'
                    ? 'C'
                    : 'S'}
              </AvatarFallback>
            </Avatar>
          )}
          {project.deadline && (
            <span className={cn('flex items-center gap-1 text-[11px]', overdue ? 'text-danger' : 'text-ink-40')}>
              <CalendarDays className="h-3 w-3" /> {formatDate(project.deadline)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {cr > 0 && <span className="rounded-[4px] border px-1 py-px text-[9px] font-bold" style={{ backgroundColor: '#FFEBEE', borderColor: '#EF9A9A', color: '#C62828' }}>CR{cr}</span>}
            {rv > 0 && <span className="rounded-[4px] border px-1 py-px text-[9px] font-bold" style={{ backgroundColor: '#FFF8E1', borderColor: '#FFE082', color: '#EF6C00' }}>R{rv}</span>}
            {isAgencyView && <span className="text-[11px] font-bold" style={{ color: '#388E3C' }}>{projectPriceSummary(project)}</span>}
          </span>
        </div>
      ) : null}

      {project.packageName && (
        <div className={onlyPriceOnFirstRow ? "mt-0" : "mt-0.5"}>
          <span className="inline-block rounded-[4px] border px-1 py-px text-[8px] font-bold uppercase tracking-[0.1px]" style={{ borderColor: 'var(--color-ink-40)' }}>{project.packageName}</span>
        </div>
      )}

      <div className={cn(onlyPriceOnFirstRow ? "mt-0" : "mt-1", 'font-normal', isAgencyView ? 'text-[12px]' : 'text-[14px]')}>
        {partyName && <span className="text-ink-60">{partyName} | </span>}
        <span className="text-ink-100">{title}</span>
        {project.tags && project.tags.length > 0 && (
          <span className="inline-flex items-center gap-1 ml-1.5 align-middle">
            {project.tags.map(t => (
              <span key={t.id} className="h-2 w-2 rounded-full inline-block" style={{ backgroundColor: TAG_COLOR_MAP[t.color] || t.color }} title={t.name} />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

/** Sales-agency toggle chip — mirrors the Flutter AppFilterChip in
 *  AgencyProjectsSecondaryToolbar (showOwnChip / showProposedChip). */
function ToggleChip({ label, selected, onChange }: { label: string; selected: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={() => onChange(!selected)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        selected
          ? 'border-[color:var(--color-accent)] bg-[var(--color-accent)] text-white'
          : 'border-[color:var(--color-border-default)] bg-card text-ink-80 hover:bg-muted',
      )}
    >
      {selected && (
        <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}
      {label}
    </button>
  );
}

/** Board settings picker — persists to uiPreferences.hiddenKanbanColumns and uiPreferences.collapseEmptyKanbanColumns. */
function BoardSettingsButton({ hidden, collapseEmpty, saving, onSave, className, iconOnly }: { hidden: string[]; collapseEmpty: boolean; saving: boolean; onSave: (hidden: string[], collapseEmpty: boolean) => void; className?: string; iconOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [draftHidden, setDraftHidden] = useState<Set<string>>(new Set(hidden));
  const [draftCollapse, setDraftCollapse] = useState(collapseEmpty);
  const toggle = (key: string, visible: boolean) =>
    setDraftHidden((prev) => { const n = new Set(prev); if (visible) n.delete(key); else n.add(key); return n; });

  return (
    <>
      <Button variant="outline" className={cn(className, iconOnly && "w-10 px-0")} onClick={() => { setDraftHidden(new Set(hidden)); setDraftCollapse(collapseEmpty); setOpen(true); }}>
        <Settings className="h-4 w-4" /> {!iconOnly && "Settings"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Board settings</DialogTitle></DialogHeader>
          
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1.5">
              <label className="flex cursor-pointer items-center justify-between text-sm font-medium text-ink-100">
                <span>Collapse empty columns</span>
                <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={draftCollapse} onChange={(e) => setDraftCollapse(e.target.checked)} />
              </label>
              <p className="text-xs text-ink-60">Save space by collapsing columns with no active projects.</p>
            </div>
            
            <div className="border-t border-[color:var(--color-border-default)]" />
            
            <div className="flex flex-col">
              <h4 className="text-sm font-semibold text-ink-100 mb-2">Column visibility</h4>
              {STAGES.map((s) => {
                const visible = !draftHidden.has(s.key);
                return (
                  <label key={s.key} className="flex cursor-pointer items-center gap-2 py-1.5 text-sm font-medium text-ink-80">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--color-accent)]" checked={visible} onChange={(e) => toggle(s.key, e.target.checked)} />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="accent" disabled={saving} onClick={() => { onSave([...draftHidden], draftCollapse); setOpen(false); }}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterPill({
  label,
  activeLabel,
  isActive,
  onClear,
  onClick,
}: {
  label: string;
  activeLabel?: string;
  isActive?: boolean;
  onClear?: () => void;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex w-fit h-[26px] items-center gap-1 rounded-full px-2 text-xs font-medium transition-all cursor-pointer select-none",
        isActive
          ? "border border-solid border-accent bg-accent/5 text-accent hover:bg-accent/10"
          : "border border-dashed border-slate-300 bg-transparent text-slate-700 hover:border-slate-400 hover:bg-slate-50/50"
      )}
      onClick={onClick}
    >
      <div className="flex h-3 w-3 items-center justify-center rounded-full border border-current">
        <Plus className="h-1.5 w-1.5 stroke-[3.5]" />
      </div>
      <span className="truncate max-w-[12rem]">{isActive ? activeLabel : label}</span>
      {isActive && onClear && (
        <span
          className="ml-0.5 p-0.5 rounded-full hover:bg-accent/20 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
        >
          <X className="h-2.5 w-2.5 stroke-[3]" />
        </span>
      )}
    </div>
  );
}

function BrandSelectPopover({
  value,
  options,
  isAgencyView,
  onChange,
  close,
}: {
  value: string;
  options: { id: string; name: string }[];
  isAgencyView: boolean;
  onChange: (val: string) => void;
  close: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-[160px] p-0">
      <div className="relative">
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            close();
          }}
          className="w-full h-8 pl-2 pr-7 text-xs text-ink-100 !bg-transparent border border-slate-300 rounded-md appearance-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
        >
          <option value="">{isAgencyView ? 'All brands' : 'All agencies'}</option>
          {options.map((opt) => (
            <option key={opt.id} value={opt.id}>{opt.name}</option>
          ))}
        </select>
        <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-slate-500" />
      </div>
    </div>
  );
}

function ChecklistFilterPopover<T extends string>({
  value,
  options,
  displayLabel,
  renderLabel,
  onChange,
}: {
  value: T[];
  options: T[];
  displayLabel?: (opt: T) => string;
  renderLabel?: (opt: T) => React.ReactNode;
  onChange: (val: T[]) => void;
  close?: () => void;
}) {
  const toggle = (val: T) => {
    const next = value.includes(val) ? value.filter((x) => x !== val) : [...value, val];
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5 min-w-[180px] p-0">
      <div className="max-h-48 overflow-y-auto pr-1 flex flex-col gap-0.5">
        {options.map((opt) => (
          <label key={opt} className="flex items-center gap-1.5 px-1.5 py-0.5 cursor-pointer rounded hover:bg-slate-50/50 select-none">
            <input
              type="checkbox"
              checked={value.includes(opt)}
              onChange={() => toggle(opt)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-accent focus:ring-accent accent-[var(--color-accent)]"
            />
            <span className="text-xs text-slate-700 font-medium">{renderLabel ? renderLabel(opt) : (displayLabel ? displayLabel(opt) : opt)}</span>
          </label>
        ))}
        {options.length === 0 && (
          <div className="text-xs text-slate-400 p-1">No options available</div>
        )}
      </div>
    </div>
  );
}

function DateFilterPopover({
  value,
  onChange,
}: {
  value: any;
  onChange: (val: any) => void;
  close?: () => void;
}) {
  const operator = value?.operator || 'inLast';
  const val = value?.value || '';
  const unit = value?.unit || 'days';

  const update = (newOp: string, newVal: any, newUnit: string) => {
    if (!newVal || (newOp === 'between' && (!newVal[0] || !newVal[1]))) {
      onChange(null);
    } else {
      onChange({ operator: newOp, value: newVal, unit: newUnit });
    }
  };

  return (
    <div className="flex flex-col gap-2 min-w-[200px] p-0 text-slate-700 text-xs">
      <div className="relative">
        <select
          value={operator}
          onChange={(e) => {
            const newOp = e.target.value;
            const newVal = newOp === 'between' ? ['', ''] : '';
            update(newOp, newVal, unit);
          }}
          className="w-full h-8 pl-2 pr-7 text-xs text-ink-100 !bg-transparent border border-slate-300 rounded-md appearance-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
        >
          <option value="inLast">is in the last</option>
          <option value="equals">is equal to</option>
          <option value="between">is between</option>
          <option value="greaterThan">is greater than</option>
          <option value="lessThan">is less than</option>
        </select>
        <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-slate-500" />
      </div>

      {operator === 'inLast' ? (
        <div className="flex items-center gap-1.5 pl-1">
          <CornerDownRight className="h-3.5 w-3.5 text-accent/80 shrink-0" />
          <input
            type="number"
            min="1"
            placeholder="0"
            value={val}
            onChange={(e) => update(operator, e.target.value, unit)}
            className="w-12 h-8 px-1.5 text-center text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
          />
          <div className="relative flex-1">
            <select
              value={unit}
              onChange={(e) => update(operator, val, e.target.value)}
              className="w-full h-8 pl-2 pr-6 text-xs !bg-transparent border border-slate-300 rounded-md appearance-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            >
              <option value="days">days</option>
              <option value="hours">hours</option>
              <option value="weeks">weeks</option>
              <option value="months">months</option>
            </select>
            <ChevronsUpDown className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none text-slate-500" />
          </div>
        </div>
      ) : operator === 'between' ? (
        <div className="flex flex-col gap-1.5 pl-1">
          <div className="flex items-center gap-1.5">
            <CornerDownRight className="h-3.5 w-3.5 text-accent/80 shrink-0" />
            <input
              type="date"
              value={Array.isArray(val) ? val[0] || '' : ''}
              onChange={(e) => {
                const v1 = e.target.value;
                const v2 = Array.isArray(val) ? val[1] || '' : '';
                update(operator, [v1, v2], unit);
              }}
              className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            />
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-[10px] text-slate-400 font-medium">to</span>
            <input
              type="date"
              value={Array.isArray(val) ? val[1] || '' : ''}
              onChange={(e) => {
                const v1 = Array.isArray(val) ? val[0] || '' : '';
                const v2 = e.target.value;
                update(operator, [v1, v2], unit);
              }}
              className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pl-1">
          <CornerDownRight className="h-3.5 w-3.5 text-accent/80 shrink-0" />
          <input
            type="date"
            value={typeof val === 'string' ? val : ''}
            onChange={(e) => update(operator, e.target.value, unit)}
            className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
          />
        </div>
      )}
    </div>
  );
}

function AmountFilterPopover({
  value,
  onChange,
}: {
  value: any;
  onChange: (val: any) => void;
  close?: () => void;
}) {
  const operator = value?.operator || 'equals';
  const val = value?.value || '';

  const update = (newOp: string, newVal: any) => {
    if (newVal === '' || (newOp === 'between' && (!newVal[0] || !newVal[1]))) {
      onChange(null);
    } else {
      onChange({ operator: newOp, value: newVal });
    }
  };

  return (
    <div className="flex flex-col gap-2 min-w-[200px] p-0 text-slate-700 text-xs">
      <div className="relative">
        <select
          value={operator}
          onChange={(e) => {
            const newOp = e.target.value;
            const newVal = newOp === 'between' ? ['', ''] : '';
            update(newOp, newVal);
          }}
          className="w-full h-8 pl-2 pr-7 text-xs text-ink-100 !bg-transparent border border-slate-300 rounded-md appearance-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
        >
          <option value="equals">is equal to</option>
          <option value="between">is between</option>
          <option value="greaterThan">is greater than</option>
          <option value="lessThan">is less than</option>
        </select>
        <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-slate-500" />
      </div>

      {operator === 'between' ? (
        <div className="flex flex-col gap-1.5 pl-1">
          <div className="flex items-center gap-1.5">
            <CornerDownRight className="h-3.5 w-3.5 text-accent/80 shrink-0" />
            <input
              type="number"
              min="0"
              placeholder="Min amount"
              value={Array.isArray(val) ? val[0] || '' : ''}
              onChange={(e) => {
                const v1 = e.target.value;
                const v2 = Array.isArray(val) ? val[1] || '' : '';
                update(operator, [v1, v2]);
              }}
              className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            />
          </div>
          <div className="flex items-center gap-1.5 pl-5">
            <span className="text-[10px] text-slate-400 font-medium">to</span>
            <input
              type="number"
              min="0"
              placeholder="Max amount"
              value={Array.isArray(val) ? val[1] || '' : ''}
              onChange={(e) => {
                const v1 = Array.isArray(val) ? val[0] || '' : '';
                const v2 = e.target.value;
                update(operator, [v1, v2]);
              }}
              className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
            />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 pl-1">
          <CornerDownRight className="h-3.5 w-3.5 text-accent/80 shrink-0" />
          <input
            type="number"
            min="0"
            placeholder="0"
            value={typeof val === 'string' ? val : ''}
            onChange={(e) => update(operator, e.target.value)}
            className="flex-1 h-8 px-2 text-xs !bg-transparent border border-slate-300 rounded-md outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
          />
        </div>
      )}
    </div>
  );
}

const SORT_OPTIONS = [
  { value: 'custom', label: 'Custom (Manual)' },
  { value: 'deadline', label: 'Deadline' },
  { value: 'amount', label: 'Project Value' },
  { value: 'createdAt', label: 'Created Date' },
  { value: 'updatedAt', label: 'Last Updated' },
  { value: 'title', label: 'Project Title' },
  { value: 'brand', label: 'Client / Brand' },
  { value: 'assignee', label: 'Assignee' },
] as const;

function SortPill({
  label,
  activeLabel,
  isActive,
  onClick,
}: {
  label: string;
  activeLabel?: string;
  isActive?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex w-fit h-[26px] items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-all cursor-pointer select-none",
        isActive
          ? "border border-solid border-accent bg-accent/5 text-accent hover:bg-accent/10"
          : "border border-dashed border-slate-300 bg-transparent text-slate-700 hover:border-slate-400 hover:bg-slate-50/50"
      )}
      onClick={onClick}
    >
      <ArrowUpDown className="h-3 w-3 stroke-[2]" />
      <span className="truncate max-w-[12rem]">{isActive ? activeLabel : label}</span>
    </div>
  );
}

function SortSelectPopover({
  value,
  options,
  onChange,
  close,
}: {
  value: string;
  options: readonly { readonly value: string; readonly label: string }[];
  onChange: (val: any) => void;
  close: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 min-w-[160px] p-0">
      <div className="relative">
        <select
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            close();
          }}
          className="w-full h-8 pl-2 pr-7 text-xs text-ink-100 !bg-transparent border border-slate-300 rounded-md appearance-none outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 transition-all"
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <ChevronsUpDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none text-slate-500" />
      </div>
    </div>
  );
}

