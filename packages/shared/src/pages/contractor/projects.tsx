import { useMemo, useState } from 'react';
import { useSearch } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck, ChevronDown, ChevronRight, ArrowDownUp, FileText } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../../components/ui/dropdown-menu';
import { type Deliverable } from '../projects/deliverables-panel';
import { cadenceLabel, currentCycleOf, cycleOfRow, isCycleBased, pad2 } from '../projects/cycle-utils';
import { timeAgo } from '../tasks/task-utils';
import { contractorDeadline } from './contractor-utils';
import { ContractorProjectDetail } from './project-detail';

// Mirror contractor_contracts_screen status order.
const STATUS_ORDER = ['production', 'revision', 'brief', 'allocate', 'internalApproval', 'clientApproval', 'upcoming', 'completed'] as const;
const STATUS_LABEL: Record<string, string> = {
  production: 'Production', revision: 'Revision', brief: 'Brief', allocate: 'Allocate',
  internalApproval: 'Internal Approval', clientApproval: 'Client Approval', upcoming: 'Upcoming', completed: 'Completed',
};

type Sort = 'nearestDue' | 'furthestDue' | 'newest' | 'oldest';
const SORTS: { key: Sort; label: string }[] = [
  { key: 'nearestDue', label: 'Nearest Due Date' },
  { key: 'furthestDue', label: 'Furthest Due Date' },
  { key: 'newest', label: 'Newest First' },
  { key: 'oldest', label: 'Oldest First' },
];

type ContractorProject = {
  id: string; title: string | null; taskTitle: string | null; serviceName: string | null; packageName: string | null;
  serviceType: string | null; deliverableFrequency: string | null; repeatsEvery: number | null;
  cycleCount: number | null; nextCycleAt: string | Date | null;
  agencyName: string | null; resolvedBrandName: string | null; allocatedAt: string | Date | null;
  status: string; deadline: string | Date | null; createdAt: string | Date | null; updatedAt: string | Date | null; amount: unknown;
  contractorBudget: string | null; contractorBudgetNote: string | null; estimatedContractorDurationInHours: number | null;
  revisionCount: number | null; revisionNote: string | null; revisionComments: string[] | null; revisionAttachmentUrl: string | null;
  deliverables: Deliverable[]; revisions: any[];
};

/** The contractor's working deadline (updatedAt + estimated hours over business days). */
const dueOf = (p: ContractorProject) => contractorDeadline(p.updatedAt, p.estimatedContractorDurationInHours);

function sortProjects(list: ContractorProject[], sort: Sort): ContractorProject[] {
  const arr = [...list];
  const t = (v: string | Date | null) => (v ? new Date(v).getTime() : null);
  const due = (p: ContractorProject) => dueOf(p)?.getTime() ?? null;
  switch (sort) {
    case 'nearestDue': arr.sort((a, b) => (due(a) ?? Infinity) - (due(b) ?? Infinity)); break;
    case 'furthestDue': arr.sort((a, b) => (due(b) ?? -Infinity) - (due(a) ?? -Infinity)); break;
    case 'newest': arr.sort((a, b) => (t(b.createdAt) ?? 0) - (t(a.createdAt) ?? 0)); break;
    case 'oldest': arr.sort((a, b) => (t(a.createdAt) ?? 0) - (t(b.createdAt) ?? 0)); break;
  }
  return arr;
}

const isHeadlineRow = (d: Deliverable) => d.type === 'text' && (d.content ?? '').startsWith('# ');

export function ContractorProjectsPage() {
  const trpc = useTRPC();
  const search = useSearch();
  const [sort, setSort] = useState<Sort>('newest');
  const [grouping, setGrouping] = useState<'status' | 'flat'>('status');
  const [openId, setOpenId] = useState<string | null>(new URLSearchParams(search).get('openProject'));

  const q = useQuery(trpc.contractor.myProjects.queryOptions());
  const projects = (q.data ?? []) as unknown as ContractorProject[];

  const groups = useMemo(() => {
    if (grouping === 'flat') return [{ status: 'all', label: 'All projects', items: sortProjects(projects, sort) }];
    const map: Record<string, ContractorProject[]> = {};
    for (const p of projects) (map[p.status] ??= []).push(p);
    const order = [...STATUS_ORDER, ...Object.keys(map).filter((s) => !STATUS_ORDER.includes(s as any))];
    return order.filter((s) => map[s]?.length).map((s) => ({ status: s, label: STATUS_LABEL[s] ?? s, items: sortProjects(map[s], sort) }));
  }, [projects, sort, grouping]);

  if (openId) return <ContractorProjectDetail projectId={openId} onBack={() => setOpenId(null)} />;

  return (
    <div>
      <PageHeader
        title="My Contracts"
        description="Everything assigned to you. Cycle-based work shows its current cycle, one-shots run once."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-0.5">
              {(['status', 'flat'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGrouping(g)}
                  className={cn(
                    'rounded-[calc(var(--radius-sm)-2px)] px-3 py-1.5 text-xs font-medium transition-colors',
                    grouping === g ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:text-ink-100',
                  )}
                >
                  {g === 'status' ? 'By status' : 'All projects'}
                </button>
              ))}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><ArrowDownUp className="h-4 w-4" /> {SORTS.find((s) => s.key === sort)!.label}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {SORTS.map((s) => <DropdownMenuItem key={s.key} onSelect={() => setSort(s.key)}>{s.label}</DropdownMenuItem>)}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />
      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : projects.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No active contracts assigned." description="Assigned projects appear here once an agency allocates work to you." />
      ) : (
        <div>
          {groups.map((g) => (
            <StatusGroup
              key={g.status}
              label={g.label}
              items={g.items}
              defaultOpen={g.status !== 'completed'}
              showStatus={grouping === 'flat'}
              onOpen={setOpenId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function StatusGroup({ label, items, defaultOpen, showStatus, onOpen }: {
  label: string; items: ContractorProject[]; defaultOpen: boolean; showStatus: boolean; onOpen: (id: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button onClick={() => setOpen(!open)} className="flex w-full items-baseline gap-2.5 border-t border-[color:var(--color-border-hairline)] px-0.5 pb-3 pt-4 text-left">
        <ChevronDown className={cn('relative top-0.5 h-3.5 w-3.5 shrink-0 text-ink-40 transition-transform', !open && '-rotate-90')} />
        <span className="text-[15px] font-semibold tracking-tight text-ink-100">{label}</span>
        <span className="font-mono text-[11px] tabular-nums tracking-wider text-ink-40">{pad2(items.length)}</span>
      </button>
      {open && (
        <div className="pb-3">
          {items.map((p) => <ContractRow key={p.id} project={p} showStatus={showStatus} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

function ContractRow({ project: p, showStatus, onOpen }: { project: ContractorProject; showStatus: boolean; onOpen: (id: string) => void }) {
  const due = dueOf(p);
  const overdue = due ? due.getTime() < Date.now() && p.status !== 'completed' : false;
  const cycleBased = isCycleBased(p);
  const current = currentCycleOf(p);
  const cycleLabel = cycleBased
    ? `Cycle ${pad2(current)} · ${cadenceLabel(p.deliverableFrequency, p.repeatsEvery)}`
    : 'One-shot';
  const count = p.deliverables.filter((d) => !isHeadlineRow(d) && (!cycleBased || cycleOfRow(d, current) === current)).length;
  const subline = [p.agencyName, p.resolvedBrandName, p.serviceName].filter(Boolean).join(' · ');
  const editableStatus = p.status === 'production' || p.status === 'revision';

  return (
    <button
      onClick={() => onOpen(p.id)}
      className="-mx-2 flex w-[calc(100%+16px)] flex-wrap items-center gap-x-6 gap-y-2 rounded-[var(--radius-sm)] border-t border-[color:var(--color-border-hairline)] px-2 py-3.5 text-left transition-colors hover:bg-inset/60"
    >
      <span className="min-w-[230px] flex-1 basis-[300px]">
        <span className="flex flex-wrap items-center gap-2.5">
          <span className="text-[15px] font-medium tracking-tight text-ink-100">{p.title ?? p.taskTitle ?? p.serviceName ?? 'Untitled'}</span>
          {p.packageName && <span className="inline-flex whitespace-nowrap rounded-full bg-inset px-2 py-0.5 text-[11px] font-medium text-ink-80">{p.packageName}</span>}
        </span>
        {subline && <span className="mt-0.5 block text-[13px] text-ink-40">{subline}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <span className="w-[150px] shrink-0 font-mono text-[11px] uppercase tracking-wider text-ink-40">{cycleLabel}</span>
        {p.allocatedAt && (
          <span title="When this project was assigned to you" className="w-[110px] shrink-0 font-mono text-xs tabular-nums text-ink-40">
            {timeAgo(p.allocatedAt) === 'now' ? 'Assigned just now' : `Assigned ${timeAgo(p.allocatedAt)} ago`}
          </span>
        )}
        <span title="Deliverables added" className="flex w-11 shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums text-ink-40">
          <FileText className="h-3 w-3" /> {pad2(count)}
        </span>
        <span className={cn('w-[150px] shrink-0 font-mono text-xs tabular-nums', overdue ? 'font-medium text-danger' : 'text-ink-40')}>
          {due ? formatDate(due) : p.status === 'brief' ? 'Awaiting brief' : '—'}{overdue && ' · overdue'}
        </span>
        {p.contractorBudget && <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-ink-100">{formatCurrency(p.contractorBudget)}</span>}
        {showStatus && <Badge className="w-[120px] justify-center" variant={editableStatus ? 'default' : 'muted'}>{STATUS_LABEL[p.status] ?? p.status}</Badge>}
        <ChevronRight className="h-3.5 w-3.5 text-ink-40" />
      </span>
    </button>
  );
}
