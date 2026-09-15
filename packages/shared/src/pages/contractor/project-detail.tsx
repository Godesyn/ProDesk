import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FileText, History, Lock, Paperclip } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { cn, formatCurrency, formatDate, initialsOf } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { DeliverablesPanel, type Deliverable } from '../projects/deliverables-panel';
import { ProjectSelections } from '../projects/project-selections';
import {
  buildCycles, cadenceLabel, currentCycleOf, cycleOfRow, isCycleBased, pad2,
  type CycleCell,
} from '../projects/cycle-utils';
import { timeAgo } from '../tasks/task-utils';
import { contractorDeadline } from './contractor-utils';

const STATUS_LABEL: Record<string, string> = {
  production: 'In production', revision: 'Revision requested', brief: 'Being briefed',
  allocate: 'Allocate', internalApproval: 'Internal approval', clientApproval: 'Client approval',
  upcoming: 'Upcoming', completed: 'Complete', clientBrief: 'Client brief',
};

const isHeadlineRow = (d: Deliverable) => d.type === 'text' && (d.content ?? '').startsWith('# ');
const shortDate = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';

export function RevisionCallout({ project }: { project: { revisionCount?: number | null; revisionNote?: string | null; revisionComments?: string[] | null; revisionAttachmentUrl?: string | null } }) {
  const comments = (project.revisionComments ?? []).slice(-2).reverse();
  return (
    <div className="rounded-[var(--radius-sm)] border border-warn/15 bg-warn/5 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-warn"><History className="h-4 w-4" /> Revision #{project.revisionCount} Feedback</div>
      {comments.length > 0 ? (
        comments.map((c, i) => <p key={i} className="text-sm text-ink-80">• {c}</p>)
      ) : project.revisionNote ? (
        <p className="text-sm text-ink-80">{project.revisionNote}</p>
      ) : null}
      {project.revisionAttachmentUrl && (
        <a href={project.revisionAttachmentUrl} target="_blank" rel="noreferrer" className="mt-1.5 flex items-center gap-1 text-xs text-warn underline"><Paperclip className="h-3 w-3" /> View annotated document</a>
      )}
    </div>
  );
}

/**
 * Full project view for the contractor workspace. Cycle-based projects get a
 * cycles rail: completed cycles are locked/read-only (deliverables + revision
 * feedback stay downloadable), the current cycle is the live workspace, and
 * upcoming cycles accept STAGED work that carries in when the cycle opens.
 */
export function ContractorProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = trpc.contractor.projectById.queryKey({ id: projectId });
  const q = useQuery(trpc.contractor.projectById.queryOptions({ id: projectId }));
  const invalidate = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: trpc.contractor.myProjects.queryKey() }); };

  const [cycleN, setCycleN] = useState<number | null>(null);

  // Optimistic deliverable add + reorder (see ManageDeliverablesDialog history):
  // snapshot in a ref so onMutate stays void for tRPC's mutationOptions types.
  const prevSnapshot = useRef<any>(null);
  const patchDeliverables = async (fn: (list: Deliverable[]) => Deliverable[]) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<any>(key);
    prevSnapshot.current = prev;
    if (prev) qc.setQueryData(key, { ...prev, deliverables: fn(prev.deliverables ?? []) });
    return undefined;
  };
  const rollback = (e: { message: string }) => {
    if (prevSnapshot.current) qc.setQueryData(key, prevSnapshot.current);
    toastError(e);
  };

  const add = useMutation({
    ...trpc.contractor.addDeliverable.mutationOptions(),
    onMutate: (vars) => patchDeliverables((list) => [
      ...list,
      {
        id: `temp-${crypto.randomUUID()}`,
        type: vars.type ?? 'text',
        content: vars.content ?? null,
        fileName: vars.fileName ?? null,
        description: null,
        status: 'pending',
        rejectionReason: null,
        cycle: vars.cycle ?? null,
      },
    ]),
    onError: rollback,
    onSettled: invalidate,
  });
  const remove = useMutation({ ...trpc.contractor.removeDeliverable.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const rename = useMutation({ ...trpc.contractor.updateDeliverable.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const reorder = useMutation({
    ...trpc.contractor.reorderDeliverables.mutationOptions(),
    onMutate: (vars) => patchDeliverables((list) => {
      const byId = new Map(list.map((d) => [d.id, d]));
      const ordered = vars.orderedIds.map((id) => byId.get(id)).filter(Boolean) as Deliverable[];
      const rest = list.filter((d) => !vars.orderedIds.includes(d.id));
      return [...ordered, ...rest];
    }),
    onError: rollback,
    onSettled: invalidate,
  });
  const submit = useMutation({
    ...trpc.contractor.submitForApproval.mutationOptions(),
    onSuccess: () => { toast.success('Submitted for internal approval'); invalidate(); },
    onError: (e) => toastError(e),
  });

  const p = q.data as any;

  const cycleBased = p ? isCycleBased(p) : false;
  const current = p ? currentCycleOf(p) : 1;
  const cells = useMemo<CycleCell[]>(() => {
    if (!p || !cycleBased) return [];
    const staged = (p.deliverables as Deliverable[]).map((d) => cycleOfRow(d, current)).filter((c) => c > current);
    return buildCycles(p, p.cycles ?? [], { extraCycles: staged });
  }, [p, cycleBased, current]);

  // Auto-position the rail so the current cycle (and one before) is in view.
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el || cells.length === 0) return;
    const idx = cells.findIndex((c) => c.state === 'current');
    const cell = el.children[Math.max(0, idx - 1)] as HTMLElement | undefined;
    if (cell) el.scrollLeft = cell.offsetLeft - el.offsetLeft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, cells.length]);

  if (!p) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All contracts</Button>
        <div className="mt-6 space-y-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>
      </div>
    );
  }

  const sel = cycleN ?? current;
  const cell = cells.find((c) => c.n === sel) ?? null;
  const selState: CycleCell['state'] = cell?.state ?? 'current';
  const editableStatus = p.status === 'production' || p.status === 'revision';
  const editable = editableStatus && selState === 'current';
  const staging = selState === 'upcoming';
  const lockedCycle = selState === 'completed';
  const canAdd = editable || staging;

  const allDeliverables = p.deliverables as Deliverable[];
  const deliverables = cycleBased ? allDeliverables.filter((d) => cycleOfRow(d, current) === sel) : allDeliverables;
  const itemCount = deliverables.filter((d) => !isHeadlineRow(d)).length;
  const cycleRevisions = cycleBased && lockedCycle
    ? (p.revisions as any[]).filter((r) => (r.cycle ?? 1) === sel && r.content)
    : [];

  const due = contractorDeadline(p.updatedAt, p.estimatedContractorDurationInHours);
  const overdue = due ? due.getTime() < Date.now() && p.status !== 'completed' : false;

  // Per-cycle brief: current = the live project brief (hidden while the agency
  // is still preparing it), other cycles = their snapshot / pre-brief.
  const brief: string | null =
    sel === current
      ? (p.status === 'brief' && cycleBased ? null : (p.briefContext ?? null))
      : (cell?.briefContext ?? null);

  // Contextual notice for the selected cycle / project state.
  let notice: string | null = null;
  let noticeLock = false;
  if (lockedCycle) {
    notice = `Cycle ${pad2(sel)}${cell?.completedAt ? ` completed ${shortDate(cell.completedAt)}` : ' completed'}. Completed cycles are locked — deliverables and feedback are read only.`;
    noticeLock = true;
  } else if (staging) {
    notice = `${cell?.opensAt ? `Opens ${shortDate(cell.opensAt)}` : 'Opens'} once cycle ${pad2(current)} completes and the agency confirms the brief. Work staged below carries into the cycle when it opens.`;
  } else if (p.status === 'internalApproval') {
    notice = 'Submitted for internal approval. Editing is paused during review.';
    noticeLock = true;
  } else if (p.status === 'clientApproval') {
    notice = 'With the client for sign off. Editing is paused until they respond.';
    noticeLock = true;
  } else if (p.status === 'brief') {
    notice = 'The agency is preparing this brief. Production opens once it is confirmed.';
  } else if (p.status === 'upcoming') {
    notice = 'This phase has not opened yet.';
    noticeLock = true;
  } else if (p.status === 'completed' && !cycleBased) {
    notice = 'Completed work is locked and read only.';
    noticeLock = true;
  }

  const subline = [p.agency?.name, p.brand?.name, p.serviceName].filter(Boolean).join(' · ');
  const title = p.title ?? p.taskTitle ?? p.serviceName ?? 'Untitled';

  const onSubmit = async () => {
    if (itemCount === 0 && !(await confirm({
      title: 'Submit without deliverables?',
      description: 'Nothing is attached to this cycle. The agency will review an empty submission.',
      confirmLabel: 'Submit anyway',
    }))) return;
    submit.mutate({ id: p.id });
  };

  return (
    <div>
      <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeft className="h-4 w-4" /> All contracts</Button>

      {/* Header */}
      <div className="mt-5 flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <div className="min-w-[250px] flex-1 basis-[340px]">
          {p.packageName && <span className="inline-flex rounded-full bg-inset px-2.5 py-1 text-xs font-medium text-ink-80">{p.packageName}</span>}
          <h1 className="mb-1.5 mt-2 text-2xl font-semibold tracking-tight text-ink-100">{title}</h1>
          <div className="text-sm text-ink-60">{subline}</div>
        </div>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div>
            <div className="mb-1.5 text-xs text-ink-40">Status</div>
            <Badge variant={editableStatus ? 'default' : 'muted'}>{STATUS_LABEL[p.status] ?? p.status}</Badge>
          </div>
          {p.allocatedAt && (
            <div>
              <div className="mb-1 text-xs text-ink-40">Assigned</div>
              <div className="font-mono text-[15px] tabular-nums text-ink-100" title={formatDate(p.allocatedAt)}>
                {timeAgo(p.allocatedAt) === 'now' ? 'just now' : `${timeAgo(p.allocatedAt)} ago`}
              </div>
            </div>
          )}
          {p.contractorBudget && (
            <div>
              <div className="mb-1 text-xs text-ink-40">{cycleBased ? 'Budget, this cycle' : 'Budget'}</div>
              <div className="font-mono text-[15px] tabular-nums text-success">{formatCurrency(p.contractorBudget)}</div>
            </div>
          )}
          {p.estimatedContractorDurationInHours != null && (
            <div>
              <div className="mb-1 text-xs text-ink-40">Estimated</div>
              <div className="font-mono text-[15px] tabular-nums text-ink-100">{p.estimatedContractorDurationInHours} h</div>
            </div>
          )}
          <div>
            <div className="mb-1 text-xs text-ink-40">Deadline</div>
            <div className={cn('font-mono text-[15px] tabular-nums', overdue ? 'font-medium text-danger' : 'text-ink-100')}>
              {due ? formatDate(due) : 'No deadline'}{overdue && ' · overdue'}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 border-t border-[color:var(--color-border-hairline)]" />

      {/* Cycles rail */}
      {cycleBased && cells.length > 0 && (
        <div className="mt-7">
          <div className="mb-3 flex flex-wrap items-baseline gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-100">Cycles</h2>
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-40">Repeats {cadenceLabel(p.deliverableFrequency, p.repeatsEvery).toLowerCase()}</span>
            <span className="ml-auto text-xs text-ink-40">Completed cycles are locked</span>
          </div>
          <div ref={railRef} className="flex scroll-smooth gap-0.5 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset/60 p-0.5">
            {cells.map((c) => {
              const count = allDeliverables.filter((d) => cycleOfRow(d, current) === c.n && !isHeadlineRow(d)).length;
              const sub = c.state === 'completed'
                ? `Completed ${c.completedAt ? shortDate(c.completedAt) : ''}`.trim()
                : c.state === 'current'
                  ? (STATUS_LABEL[p.status] ?? p.status)
                  : c.opensAt ? `Opens ${shortDate(c.opensAt)}` : 'Upcoming';
              const selected = c.n === sel;
              return (
                <button
                  key={c.n}
                  onClick={() => setCycleN(c.n)}
                  className={cn(
                    'flex min-w-[132px] flex-1 shrink-0 flex-col items-start gap-1.5 rounded-[calc(var(--radius-sm)-2px)] px-3.5 py-3 text-left transition-colors',
                    selected ? 'bg-card shadow-sm ring-1 ring-[color:var(--color-border-hairline)]' : 'hover:bg-card/60',
                  )}
                >
                  <span className="flex w-full items-center gap-1.5">
                    <span className={cn('font-mono text-[11px] tracking-wider', selected ? 'font-semibold text-ink-100' : 'text-ink-40')}>{pad2(c.n)}</span>
                    {c.state === 'completed' && <Lock className="ml-auto h-3 w-3 text-ink-40" />}
                  </span>
                  <span className="whitespace-nowrap text-sm font-medium text-ink-100">{c.label}</span>
                  <span className="flex items-center gap-2 whitespace-nowrap text-xs text-ink-40">
                    {sub}
                    {count > 0 && <span className="flex items-center gap-1 font-mono tabular-nums"><FileText className="h-3 w-3" />{pad2(count)}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-x-12 gap-y-8">
        {/* Main column */}
        <div className="min-w-[280px] flex-1 basis-[460px]">
          {cycleBased && cell && (
            <div className="mb-4 font-mono text-[11px] uppercase tracking-wider text-ink-40">Cycle {pad2(sel)} · {cell.label}</div>
          )}

          {notice && (
            <div className="mb-6 flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-3.5 text-sm leading-relaxed text-ink-60">
              {noticeLock && <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-40" />}
              <span>{notice}</span>
            </div>
          )}

          {p.status === 'revision' && (p.revisionCount ?? 0) > 0 && sel === current && (
            <div className="mb-6"><RevisionCallout project={p} /></div>
          )}

          {brief && (
            <div className="mb-8">
              <h2 className="mb-2 text-base font-semibold tracking-tight text-ink-100">Brief</h2>
              <p className="max-w-[62ch] whitespace-pre-line text-sm leading-relaxed text-ink-60">{brief}</p>
            </div>
          )}
          {staging && !brief && cell?.opensAt && (
            <div className="mb-8">
              <h2 className="mb-2 text-base font-semibold tracking-tight text-ink-100">Brief</h2>
              <p className="text-sm text-ink-40">Not briefed yet — the agency confirms this cycle's brief when it opens.</p>
            </div>
          )}

          {/* Locked-cycle revision feedback (history stays readable per cycle). */}
          {cycleRevisions.length > 0 && (
            <div className="mb-8">
              <h2 className="mb-2 text-base font-semibold tracking-tight text-ink-100">Revision feedback</h2>
              <div className="flex flex-col gap-2">
                {cycleRevisions.map((r: any) => (
                  <div key={r.id} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-3 text-sm">
                    <p className="text-ink-80">{r.content}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-40">
                      {r.authorName && <span>{r.authorName}</span>}
                      {r.createdAt && <span>{formatDate(r.createdAt)}</span>}
                      {(r.attachmentUrls ?? []).map((u: string, i: number) => (
                        <a key={i} href={u} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent underline"><Paperclip className="h-3 w-3" /> Attachment {i + 1}</a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold tracking-tight text-ink-100">Deliverables</h2>
            <span className="font-mono text-[11px] tabular-nums tracking-wider text-ink-40">{pad2(itemCount)}</span>
          </div>
          {staging && (
            <p className="mb-3 text-xs leading-relaxed text-ink-40">
              This cycle has not opened. Staged work is held here and carries in{cell?.opensAt ? ` on ${shortDate(cell.opensAt)}` : ' when it opens'}.
            </p>
          )}
          <DeliverablesPanel
            projectId={p.id}
            deliverables={deliverables}
            editable={canAdd}
            onAdd={(input) => add.mutate({ projectId: p.id, ...(cycleBased ? { cycle: sel } : {}), ...input })}
            onRemove={(id) => remove.mutate({ id })}
            onRename={(id, patch) => rename.mutate({ id, ...patch })}
            onReorder={(orderedIds) => reorder.mutate({ projectId: p.id, orderedIds })}
            pending={add.isPending}
            pendingBadge={staging ? 'Staged' : undefined}
            emptyLabel={canAdd ? 'Nothing here yet. Upload work or add a note to get started.' : 'No deliverables recorded for this cycle.'}
          />

          {editable && (
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <Button variant="accent" disabled={submit.isPending} onClick={onSubmit}>Submit for approval</Button>
              <span className="text-xs text-ink-40">
                {p.status === 'revision'
                  ? 'Resubmits this work for internal approval.'
                  : cycleBased ? 'Moves this cycle to internal approval.' : 'Moves this project to internal approval.'}
              </span>
            </div>
          )}
        </div>

        {/* Side column */}
        <aside className="min-w-[230px] max-w-[340px] flex-1 basis-[250px]">
          <h2 className="mb-1 text-base font-semibold tracking-tight text-ink-100">Details</h2>
          <dl>
            <FactRow k="Type" v={cycleBased ? 'Cycle-based' : 'One-shot'} />
            {cycleBased && <FactRow k="Repeats" v={cadenceLabel(p.deliverableFrequency, p.repeatsEvery)} />}
            {cycleBased && p.nextCycleAt && <FactRow k="Next cycle" v={formatDate(p.nextCycleAt)} />}
            {p.agency && <FactRow k="Agency" v={<OrgFact name={p.agency.name} logoUrl={p.agency.logoUrl} />} />}
            {p.brand && <FactRow k="Client" v={<OrgFact name={p.brand.name} logoUrl={p.brand.logoUrl} />} />}
            {p.serviceName && <FactRow k="Service" v={p.serviceName} />}
          </dl>
          <div className="border-t border-[color:var(--color-border-hairline)]" />

          <div className="mt-6">
            <ProjectSelections options={p.selectedOptions as Record<string, string> | null} addons={p.selectedAddons as unknown[] | null} />
          </div>

          {p.contractorBudgetNote && (
            <div className="mt-6">
              <div className="mb-1.5 text-[13px] font-semibold tracking-tight text-ink-100">Budget note</div>
              <p className="text-[13px] leading-relaxed text-ink-60">{p.contractorBudgetNote}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function FactRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-[color:var(--color-border-hairline)] py-2.5 text-[13px] leading-snug">
      <dt className="shrink-0 text-ink-40">{k}</dt>
      <dd className="text-right text-ink-100">{v}</dd>
    </div>
  );
}

function OrgFact({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <Avatar className="h-5 w-5">{logoUrl ? <AvatarImage src={logoUrl} /> : null}<AvatarFallback className="text-[9px]">{initialsOf(name)}</AvatarFallback></Avatar>
      {name}
    </span>
  );
}
