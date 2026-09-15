import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Mail, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { reserveNewTab } from '../../lib/redirect';
import { formatCurrency, toNumberInput } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { AvatarSelect } from '../../components/ui/avatar-select';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../../components/ui/dialog';
import { SpotComponentView, spotAnswerIsEmpty, type SpotQuestion } from '../brand/spot-view';
import { briefFieldDef, readBriefAnswer, toSpotQuestion } from './brief-fields';
import { DeliverablesPanel, type Deliverable } from './deliverables-panel';
import { cyclePrice } from './cycle-price';
import { uploadProjectFile } from './storage';
import { isAnnotatable } from '../../components/file-annotator/annotatable';
import type { KanbanTransitionAction } from './transition-action';

// Heavy editor (pdfjs + pdf-lib) — only pulled in when a reviewer opens it.
const FileAnnotator = lazy(() => import('../../components/file-annotator/file-annotator').then((m) => ({ default: m.FileAnnotator })));

/* ──────────────────────────────────────────────────────────────────────────
 * Shared workflow-transition dialogs.
 *
 * One self-contained host renders the confirmation dialog for any Kanban
 * transition that needs input (Submit Brief, Complete Brief, Allocate, Manage
 * Deliverables, Internal Approval, Client Approval / Manual Completion). It owns
 * its own mutations so the Kanban board and the project detail page share a
 * single implementation. Direct (dialog-less) transitions are handled by the
 * caller; this host renders nothing for them.
 * ────────────────────────────────────────────────────────────────────────── */

type HostProject = {
  id: string;
  status: string;
  isInternal?: boolean | null;
  title?: string | null;
  taskTitle?: string | null;
  serviceName?: string | null;
  packageName?: string | null;
  description?: string | null;
  amount?: unknown;
  // Carried so the dialog header can use the canonical cyclePrice (the Kanban
  // card's source of truth) rather than its own divergent amount math.
  cycleCount?: number | null;
  contractorBudget?: string | null;
  briefDocuments?: unknown;
  customFieldResponses?: unknown;
};

/** Compact project header shown atop every transition dialog (mirrors the Flutter approval-dialog project info). */
function DialogProjectInfo({ project }: { project: HostProject }) {
  const title = project.title ?? project.taskTitle ?? project.serviceName ?? 'Untitled';
  const sub = [project.packageName, project.serviceName].filter(Boolean).join(' · ');
  // Same source of truth as the Kanban card + project detail header.
  const price = cyclePrice(project);
  return (
    <div className="rounded-[var(--radius-sm)] bg-inset/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate font-semibold text-ink-100">{title}</span>
        {price > 0 && <span className="shrink-0 text-sm font-semibold text-success">{formatCurrency(price)}</span>}
      </div>
      {sub && <p className="text-xs text-ink-60">{sub}</p>}
      {project.description && <p className="mt-1 line-clamp-3 text-sm text-ink-80">{project.description}</p>}
    </div>
  );
}

export function WorkflowTransitionHost({
  project,
  action,
  orderedIds,
  targetStatus,
  agencyId,
  onClose,
  onChanged,
}: {
  project: HostProject;
  action: KanbanTransitionAction | null;
  orderedIds?: string[];
  targetStatus?: string;
  agencyId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const detailKey = trpc.projects.byId.queryKey({ id: project.id });
  const moveProject = useMutation({ ...trpc.projects.moveProject.mutationOptions() });
  
  const done = () => {
    onClose();
    if (orderedIds && targetStatus) {
      moveProject.mutate(
        { id: project.id, status: targetStatus as any, orderedIds },
        {
          onSuccess: () => onChanged(),
          onError: (err) => {
            toastError(err);
            onChanged();
          },
        }
      );
    } else {
      onChanged();
    }
  };
  const onErr = (e: { message: string }) => toastError(e);

  const submitBrief = useMutation({ ...trpc.projects.submitBrief.mutationOptions(), onSuccess: () => { toast.success('Brief submitted'); done(); }, onError: onErr });
  const completeBrief = useMutation({ ...trpc.projects.completeBrief.mutationOptions(), onSuccess: () => { toast.success('Brief completed'); done(); }, onError: onErr });
  // Allocate + internal-payment are orchestrated together in the allocateProject
  // case (toast/close handled there), so these don't auto-toast or auto-close.
  const allocate = useMutation({ ...trpc.projects.allocate.mutationOptions(), onError: onErr });
  const payInternal = useMutation({ ...trpc.projects.payInternalProject.mutationOptions(), onError: onErr });
  const internalDecision = useMutation({ ...trpc.projects.internalApprovalDecision.mutationOptions(), onSuccess: () => { toast.success('Decision recorded'); done(); }, onError: onErr });
  const clientDecision = useMutation({ ...trpc.projects.clientApprovalDecision.mutationOptions(), onSuccess: () => { toast.success('Decision recorded'); done(); }, onError: onErr });
  const markComplete = useMutation({ ...trpc.projects.markProjectComplete.mutationOptions(), onSuccess: () => { toast.success('Confirmation email sent to the brand'); done(); }, onError: onErr });
  const setStatus = useMutation({ ...trpc.projects.setStatus.mutationOptions(), onSuccess: () => { toast.success('Updated'); done(); }, onError: onErr });
  const invalidateDetail = () => qc.invalidateQueries({ queryKey: detailKey });
  // Optimistic deliverable add + reorder (faded "Saving…" row until confirmed).
  const delivSnapshot = useRef<any>(null);
  const patchDeliverables = async (fn: (list: Deliverable[]) => Deliverable[]) => {
    await qc.cancelQueries({ queryKey: detailKey });
    const prev = qc.getQueryData<any>(detailKey);
    delivSnapshot.current = prev;
    if (prev) qc.setQueryData(detailKey, { ...prev, deliverables: fn(prev.deliverables ?? []) });
    return undefined;
  };
  const rollbackDeliverables = (e: { message: string }) => {
    if (delivSnapshot.current) qc.setQueryData(detailKey, delivSnapshot.current);
    onErr(e);
  };
  const addDeliverable = useMutation({
    ...trpc.projects.addDeliverable.mutationOptions(),
    onMutate: (vars: any) => patchDeliverables((list) => [
      ...list,
      { id: `temp-${crypto.randomUUID()}`, type: vars.type ?? 'text', content: vars.content ?? null, fileName: vars.fileName ?? null, description: null, status: 'pending', rejectionReason: null },
    ]),
    onError: rollbackDeliverables,
    onSettled: invalidateDetail,
  });
  const removeDeliverable = useMutation({ ...trpc.projects.removeDeliverable.mutationOptions(), onSuccess: invalidateDetail });
  const reorderDeliverables = useMutation({
    ...trpc.projects.reorderDeliverables.mutationOptions(),
    onMutate: (vars: any) => patchDeliverables((list) => {
      const byId = new Map(list.map((d) => [d.id, d]));
      const ordered = vars.orderedIds.map((id: string) => byId.get(id)).filter(Boolean) as Deliverable[];
      const rest = list.filter((d) => !vars.orderedIds.includes(d.id));
      return [...ordered, ...rest];
    }),
    onError: rollbackDeliverables,
    onSettled: invalidateDetail,
  });

  // Richer data (deliverables, max-budget) only fetched for the actions that need it.
  // Completion now reviews the delivery list first, so both completion paths
  // need the project's deliverables fetched too.
  const needsDetail = action === 'allocateProject' || action === 'uploadDeliverable' || action === 'internalApprove' || action === 'internalReject' || action === 'clientReject' || action === 'directComplete' || action === 'markComplete';
  const detail = useQuery({ ...trpc.projects.byId.queryOptions({ id: project.id }), enabled: needsDetail });
  const assignee = useQuery({ ...trpc.projects.assigneeOptions.queryOptions({ agencyId: agencyId! }), enabled: action === 'allocateProject' && !!agencyId });

  const pending = submitBrief.isPending || completeBrief.isPending || allocate.isPending || payInternal.isPending || internalDecision.isPending || clientDecision.isPending || markComplete.isPending || setStatus.isPending;
  const open = action != null;
  const close = (o: boolean) => { if (!o) onClose(); };

  switch (action) {
    case 'completeClientBrief':
      return (
        <Dialog open={open} onOpenChange={close}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Submit brief</DialogTitle></DialogHeader>
            <DialogProjectInfo project={project} />
            <ClientBriefForm project={project} pending={submitBrief.isPending} onSubmit={(responses) => submitBrief.mutate({ id: project.id, customFieldResponses: responses })} />
          </DialogContent>
        </Dialog>
      );

    case 'completeBrief':
      return (
        <CompleteBriefDialog
          project={project}
          pending={completeBrief.isPending}
          onClose={onClose}
          onSubmit={(briefContext, briefDocuments) => completeBrief.mutate({ id: project.id, briefContext, briefDocuments })}
        />
      );

    case 'allocateProject':
      return (
        <Dialog open={open} onOpenChange={close}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Allocate</DialogTitle></DialogHeader>
            <DialogProjectInfo project={project} />
            <AllocateForm
              options={assignee.data}
              loading={assignee.isLoading}
              maxBudget={detail.data?.maxContractorBudget ?? null}
              defaultBudget={(detail.data as any)?.contractorBudget ?? null}
              defaultDuration={(detail.data as any)?.estimatedContractorDurationInHours ?? null}
              defaultAssigneeType={(detail.data as any)?.assigneeType ?? (project as any).assigneeType ?? null}
              defaultAssigneeId={(detail.data as any)?.productionAssigneeId ?? (project as any).productionAssigneeId ?? null}
              pending={allocate.isPending || payInternal.isPending}
              onSubmit={(v) => {
                // Internal + contractor + budget → Stripe checkout (webhook then
                // advances allocate→production). Reserve the tab synchronously
                // here, inside the click gesture, so the popup blocker allows it.
                const needsPay = !!project.isInternal && v.assigneeType === 'contractor' && Number(v.contractorBudget ?? 0) > 0;
                const tab = needsPay ? reserveNewTab() : null;
                void (async () => {
                  try {
                    const updated = await allocate.mutateAsync({ id: project.id, ...v });
                    if (tab && updated.status === 'allocate') {
                      const res = await payInternal.mutateAsync({
                        id: project.id,
                        successUrl: `${window.location.origin}/project/${project.id}?internal_paid=true`,
                        cancelUrl: `${window.location.origin}/project/${project.id}`,
                      });
                      if (res.url) { tab.go(res.url); toast.success('Complete payment to move the project to production.'); }
                      else { tab.cancel(); toast.success('Internal project started'); }
                    } else {
                      tab?.cancel();
                      toast.success('Allocated');
                    }
                    done();
                  } catch {
                    tab?.cancel();
                  }
                })();
              }}
            />
          </DialogContent>
        </Dialog>
      );

    case 'uploadDeliverable':
      return (
        <Dialog open={open} onOpenChange={close}>
          <DialogContent className="max-w-2xl">
            <DialogHeader><DialogTitle>Manage deliverables</DialogTitle></DialogHeader>
            <DialogProjectInfo project={project} />
            <DeliverablesPanel
              projectId={project.id}
              deliverables={(detail.data?.deliverables as Deliverable[]) ?? []}
              editable
              onAdd={(input) => addDeliverable.mutate({ projectId: project.id, source: 'agency', ...input })}
              onRemove={(did) => removeDeliverable.mutate({ id: did })}
              onReorder={(orderedIds) => reorderDeliverables.mutate({ projectId: project.id, orderedIds })}
              pending={addDeliverable.isPending}
            />
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button variant="accent" disabled={pending} onClick={() => setStatus.mutate({ id: project.id, status: 'internalApproval' as never })}>Submit &amp; complete → Internal approval</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      );

    case 'internalApprove':
    case 'internalReject':
      return (
        <ApprovalDialog
          title="Internal approval"
          project={project}
          deliverables={(detail.data?.deliverables as Deliverable[]) ?? []}
          startRejecting={false}
          approveLabel="Request client approval"
          rejectLabel="Request revision"
          pending={internalDecision.isPending}
          onClose={onClose}
          onApprove={() => internalDecision.mutate({ id: project.id, approved: true })}
          onReject={(reason, urls) => internalDecision.mutate({ id: project.id, approved: false, rejectionReason: reason, attachmentUrls: urls })}
        />
      );

    case 'clientReject':
      return (
        <ApprovalDialog
          title="Request revision"
          project={project}
          deliverables={(detail.data?.deliverables as Deliverable[]) ?? []}
          startRejecting
          rejectOnly
          approveLabel=""
          rejectLabel="Request revision"
          pending={clientDecision.isPending}
          onClose={onClose}
          onApprove={() => {}}
          onReject={(reason, urls) => clientDecision.mutate({ id: project.id, approved: false, rejectionReason: reason, attachmentUrls: urls })}
        />
      );

    // Brand / internal completion: review the deliverables, then complete
    // directly — or annotate/attach and send it back for revision.
    case 'directComplete':
      return (
        <ApprovalDialog
          title="Approve & complete"
          project={project}
          deliverables={(detail.data?.deliverables as Deliverable[]) ?? []}
          startRejecting={false}
          approveLabel="Approve & complete"
          rejectLabel="Request revision"
          pending={clientDecision.isPending}
          onClose={onClose}
          onApprove={() => clientDecision.mutate({ id: project.id, approved: true })}
          onReject={(reason, urls) => clientDecision.mutate({ id: project.id, approved: false, rejectionReason: reason, attachmentUrls: urls })}
        />
      );

    // Agency completing an external project: same deliverable review, but
    // "complete" requests the brand confirm by email (the brand owns final sign-off).
    case 'markComplete':
      return (
        <ApprovalDialog
          title="Mark project complete"
          project={project}
          deliverables={(detail.data?.deliverables as Deliverable[]) ?? []}
          startRejecting={false}
          approveLabel="Send confirmation email to brand"
          rejectLabel="Request revision"
          notice={<CompletionEmailNotice />}
          pending={markComplete.isPending || clientDecision.isPending}
          onClose={onClose}
          onApprove={() => markComplete.mutate({ id: project.id })}
          onReject={(reason, urls) => clientDecision.mutate({ id: project.id, approved: false, rejectionReason: reason, attachmentUrls: urls })}
        />
      );

    case 'manualClientApprove':
      return (
        <ManualCompletionDialog
          project={project}
          pending={clientDecision.isPending}
          onClose={onClose}
          onConfirm={(approvalMethod, approvedAt) => clientDecision.mutate({ id: project.id, approved: true, approvalMethod, approvedAt })}
        />
      );

    default:
      // directComplete / startRevision / moveToClientBrief / forceStartUpcoming /
      // invalid are handled inline by the caller — nothing to render here.
      return null;
  }
}

/* ---- complete brief (docs + notes) ---- */

function CompleteBriefDialog({ project, pending, onClose, onSubmit }: {
  project: HostProject;
  pending: boolean;
  onClose: () => void;
  onSubmit: (briefContext: string | undefined, briefDocuments: any[]) => void;
}) {
  const [notes, setNotes] = useState('');
  const [docs, setDocs] = useState<{ url: string; fileName: string; source: string }[]>(() => ((project.briefDocuments as any[]) ?? []));
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProjectFile(project.id, 'brief', file);
      setDocs((prev) => [...prev, { url, fileName: file.name, source: 'agency' }]);
    } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  };

  // Flutter requires at least one document OR notes before completing.
  const canSubmit = !uploading && !pending && (docs.length > 0 || notes.trim().length > 0);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Complete brief</DialogTitle></DialogHeader>
        <DialogProjectInfo project={project} />
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label>Brief documents</Label>
          <p className="text-xs text-ink-60">Add supporting documents for this project.</p>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
            <Paperclip className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Attach document'}
          </Button>
          {docs.map((d, i) => (
            <div key={i} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-inset/50 px-2 py-1 text-xs">
              <span className="min-w-0 truncate text-ink-80">{d.fileName}</span>
              <button className="shrink-0 text-ink-40 hover:text-danger" onClick={() => setDocs((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Context / notes</Label>
          <textarea className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2 text-sm" placeholder="Add context or notes for the team…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={!canSubmit} onClick={() => onSubmit(notes.trim() || undefined, docs)}>Complete &amp; move to Allocate</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- internal / client approval (approve + reject-with-reason) ---- */

function ApprovalDialog({ title, project, deliverables, startRejecting, rejectOnly, approveLabel, rejectLabel, notice, pending, onClose, onApprove, onReject }: {
  title: string;
  project: HostProject;
  deliverables: Deliverable[];
  startRejecting: boolean;
  rejectOnly?: boolean;
  approveLabel: string;
  rejectLabel: string;
  // Optional banner shown in the review view (e.g. the "brand confirms by email" note).
  notice?: React.ReactNode;
  pending: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: (reason: string, urls: string[]) => void;
}) {
  const [rejecting, setRejecting] = useState(startRejecting);
  const [reason, setReason] = useState('');
  const [attachments, setAttachments] = useState<{ url: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  // The file currently open in the markup editor; `replaceIndex` distinguishes
  // re-editing an existing attachment from annotating a deliverable (append).
  const [editing, setEditing] = useState<{ src: { url: string; name: string }; replaceIndex?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadProjectFile(project.id, 'revision', file);
      setAttachments((prev) => [...prev, { url, name: file.name }]);
    } catch (e) { toast.error((e as Error).message); } finally { setUploading(false); }
  };

  // Save the marked-up file: upload it, then either replace the attachment it was
  // opened from or append it (and switch to the reason form for deliverable edits).
  const saveAnnotated = async (file: File) => {
    const url = await uploadProjectFile(project.id, 'revision', file);
    setAttachments((prev) => editing?.replaceIndex != null
      ? prev.map((a, i) => (i === editing.replaceIndex ? { url, name: file.name } : a))
      : [...prev, { url, name: file.name }]);
    setRejecting(true);
    setEditing(null);
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{rejecting && !rejectOnly ? 'Reason for rejection' : title}</DialogTitle></DialogHeader>
        <DialogProjectInfo project={project} />
        {!rejecting && deliverables.length > 0 && (
          <DeliverablesPanel
            projectId={project.id}
            deliverables={deliverables}
            editable={false}
            onAnnotate={(d) => setEditing({ src: { url: d.content!, name: d.fileName ?? (d.type === 'image' ? 'image.png' : 'document.pdf') } })}
          />
        )}
        {!rejecting && deliverables.length === 0 && (
          <p className="text-sm text-ink-60">No deliverables were uploaded for this project.</p>
        )}
        {!rejecting && notice}
        {rejecting && (
          <>
            <textarea className="min-h-24 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2 text-sm" placeholder="Explain what needs changing…" value={reason} onChange={(e) => setReason(e.target.value)} />
            {/* Deliverables stay visible while writing the reason so the reviewer
                can open the highlighter on any file and attach the markup as
                feedback — annotating multiple files without leaving this view. */}
            {deliverables.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-normal text-ink-60">Deliverables — tap the highlighter to mark up a file and attach it to your feedback.</Label>
                <div className="max-h-56 overflow-y-auto pr-1">
                  <DeliverablesPanel
                    projectId={project.id}
                    deliverables={deliverables}
                    editable={false}
                    onAnnotate={(d) => setEditing({ src: { url: d.content!, name: d.fileName ?? (d.type === 'image' ? 'image.png' : 'document.pdf') } })}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs font-normal text-ink-60">Attachments</Label>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
              <Button size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> {uploading ? 'Uploading…' : 'Attach file'}
              </Button>
              {attachments.map((a, i) => (
                <div key={i} className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] bg-inset/50 px-2 py-1 text-xs">
                  <span className="min-w-0 truncate text-ink-80">{a.name}</span>
                  <div className="flex shrink-0 items-center gap-2">
                    {isAnnotatable(a.name) && (
                      <button className="text-accent hover:underline" onClick={() => setEditing({ src: a, replaceIndex: i })}>Edit</button>
                    )}
                    <button className="text-ink-40 hover:text-danger" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        <DialogFooter>
          {rejecting ? (
            <>
              <Button variant="ghost" onClick={() => (rejectOnly ? onClose() : setRejecting(false))}>Cancel</Button>
              <Button variant="accent" className="text-white" disabled={!reason.trim() || uploading || pending} onClick={() => onReject(reason.trim(), attachments.map((a) => a.url))}>{rejectLabel}</Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="text-danger" disabled={pending} onClick={() => setRejecting(true)}>{rejectLabel}</Button>
              {approveLabel && <Button variant="accent" disabled={pending} onClick={onApprove}>{approveLabel}</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
      {editing && (
        <Suspense fallback={null}>
          <FileAnnotator src={editing.src} onSave={saveAnnotated} onCancel={() => setEditing(null)} />
        </Suspense>
      )}
    </Dialog>
  );
}

/* ---- mark complete (request the brand confirm completion by email) ---- */

/**
 * Info banner shown in the completion review when an agency completes an external
 * project: completing requests the brand confirm by email (the brand owns final
 * sign-off). Mirrors the Flutter mark_complete_dialog.dart banner.
 */
function CompletionEmailNotice() {
  return (
    <div className="flex gap-2 rounded-[var(--radius-sm)] border border-accent/30 bg-accent/10 p-3 text-sm text-ink-80">
      <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
      <p>
        The brand will receive an email with a unique confirmation link to complete the project.
        The link expires in 10 days. Once sent, you will no longer be able to complete this project manually.
      </p>
    </div>
  );
}

/* ---- manual completion (agency completes on the client's behalf) ---- */

function ManualCompletionDialog({ project, pending, onClose, onConfirm }: {
  project: HostProject;
  pending: boolean;
  onClose: () => void;
  onConfirm: (approvalMethod: string, approvedAt: Date) => void;
}) {
  const [method, setMethod] = useState('');
  const [at, setAt] = useState('');
  // datetime-local max = now (approval can only have happened in the past).
  const nowLocal = (() => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); })();
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Manual project completion</DialogTitle></DialogHeader>
        <DialogProjectInfo project={project} />
        <div className="rounded-[var(--radius-sm)] border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <p className="font-semibold">This action cannot be reverted</p>
          <p>The project is moved to completed and payments are released to contractors.</p>
        </div>
        <p className="text-sm text-ink-60">Confirm the date, time and method you received approval.</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mc-method">Confirmation method</Label>
          <Input id="mc-method" placeholder="e.g. Email, phone call, Slack message" value={method} onChange={(e) => setMethod(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mc-at">Date &amp; time received</Label>
          <input id="mc-at" type="datetime-local" max={nowLocal} className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm" value={at} onChange={(e) => setAt(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" className="text-white" disabled={!method.trim() || !at || pending} onClick={() => onConfirm(method.trim(), new Date(at))}>Confirm completion</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- allocate (staff / contractor) — shared with the detail page ---- */

export function AllocateForm({ options, loading, maxBudget, defaultBudget, defaultDuration, defaultAssigneeType, defaultAssigneeId, pending, onSubmit }: { options: any; loading?: boolean; maxBudget: number | null; defaultBudget?: number | string | null; defaultDuration?: number | string | null; defaultAssigneeType?: string | null; defaultAssigneeId?: string | null; pending?: boolean; onSubmit: (v: any) => void }) {
  const [tab, setTab] = useState<'staff' | 'contractor'>(defaultAssigneeType === 'staff' ? 'staff' : 'contractor');
  const [assigneeId, setAssigneeId] = useState('');
  // Pre-select the project's current assignee (e.g. a recurring cycle that kept
  // its contractor across the reset). The options list arrives asynchronously, so
  // seed once it lands — only if the assignee is still selectable (still connected
  // / still active staff) and the user hasn't already picked someone.
  const assigneeTouched = useRef(false);
  useEffect(() => {
    if (assigneeTouched.current || !defaultAssigneeId || !options) return;
    const t = defaultAssigneeType === 'staff' ? 'staff' : 'contractor';
    const list = (t === 'staff' ? options.staff : options.contractors) ?? [];
    if (!list.some((o: any) => o.id === defaultAssigneeId)) return;
    setTab(t);
    setAssigneeId(defaultAssigneeId);
  }, [options, defaultAssigneeId, defaultAssigneeType]);
  // Pre-fill the budget/duration from the project's defaults (set at fulfillment
  // from the service's task config), mirroring the Flutter allocate dialog.
  const [budget, setBudget] = useState(toNumberInput(defaultBudget));
  const [dur, setDur] = useState(toNumberInput(defaultDuration));
  const [note, setNote] = useState('');
  // The defaults arrive asynchronously (project detail query) after this form has
  // already mounted with empty props, so the initial useState seeding misses them.
  // Seed the fields once the data lands, unless the user has already edited them.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) return;
    setBudget(toNumberInput(defaultBudget));
    setDur(toNumberInput(defaultDuration));
  }, [defaultBudget, defaultDuration]);
  const list = (tab === 'staff' ? options?.staff : options?.contractors) ?? [];
  // The contractor budget can't exceed the agency's available margin
  // (mirrors the Flutter allocate dialog's max-budget guard).
  const overBudget = tab === 'contractor' && maxBudget != null && budget !== '' && Number(budget) > maxBudget;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Button size="sm" variant={tab === 'contractor' ? 'accent' : 'outline'} onClick={() => { assigneeTouched.current = true; setTab('contractor'); setAssigneeId(''); }}>Contractor</Button>
        <Button size="sm" variant={tab === 'staff' ? 'accent' : 'outline'} onClick={() => { assigneeTouched.current = true; setTab('staff'); setAssigneeId(''); }}>Staff</Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label>Assignee</Label>
        <AvatarSelect
          value={assigneeId}
          onChange={(id) => { assigneeTouched.current = true; setAssigneeId(id); }}
          placeholder="Select…"
          loading={loading}
          options={list.map((o: any) => ({ id: o.id, name: o.name, imageUrl: o.profileUrl }))}
        />
      </div>
      {tab === 'contractor' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Budget{maxBudget != null ? ` (max ${formatCurrency(maxBudget)})` : ''}</Label>
              <Input type="number" value={budget} onChange={(e) => { touched.current = true; setBudget(e.target.value); }} />
            </div>
            <div className="flex flex-col gap-1.5"><Label>Est. hours</Label><Input type="number" value={dur} onChange={(e) => { touched.current = true; setDur(e.target.value); }} /></div>
          </div>
          {overBudget && <p className="text-xs text-danger">Budget exceeds the available agency margin of {formatCurrency(maxBudget!)}.</p>}
          <div className="flex flex-col gap-1.5"><Label>Budget note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </>
      )}
      <Button variant="accent" disabled={!assigneeId || overBudget || pending} onClick={() => onSubmit({ assigneeType: tab, assigneeId, contractorBudget: budget || undefined, estimatedContractorDurationInHours: dur ? Number(dur) : undefined, contractorBudgetNote: note || undefined })}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? 'Allocating…' : 'Allocate & move to production'}</Button>
    </div>
  );
}

/* ---- client brief form — shared with the detail page ---- */

/**
 * Normalises a project's `customFieldResponses` into the shape the Info Hub
 * renderer needs. Entries arrive either as raw custom-field definitions (before
 * the brand has answered) or as `{ question, answer }` envelopes (after a prior
 * submit). Returns the SpotQuestion[], the current answers keyed by question id,
 * and the original definitions needed to rebuild the submit payload.
 */
function normalizeBriefFields(entries: any[]): {
  questions: SpotQuestion[];
  answers: Record<string, unknown>;
  defs: { id: string; def: any }[];
} {
  const questions: SpotQuestion[] = [];
  const answers: Record<string, unknown> = {};
  const defs: { id: string; def: any }[] = [];
  entries.forEach((entry, i) => {
    const def = briefFieldDef(entry);
    const q = toSpotQuestion(def, i);
    questions.push(q);
    const existing = readBriefAnswer(entry);
    if (existing !== undefined && existing !== null) answers[q.id] = existing;
    defs.push({ id: q.id, def });
  });
  return { questions, answers, defs };
}

export function ClientBriefForm({ project, onSubmit, pending }: { project: any; onSubmit: (responses: any[]) => void; pending: boolean }) {
  // Custom-field questions live on the project's service. Render each one with
  // the Info Hub field renderer so every configured type (selects, dates,
  // file/audio/image uploads, colour palettes, addresses, …) and its
  // validations are honoured — not just plain text.
  const entries = useMemo<any[]>(() => (project.customFieldResponses as any[]) ?? [], [project.customFieldResponses]);
  const { questions, answers: initial, defs } = useMemo(() => normalizeBriefFields(entries), [entries]);
  const [answers, setAnswers] = useState<Record<string, unknown>>(initial);
  useEffect(() => { setAnswers(initial); }, [initial]);

  // A required question with an empty answer blocks submission.
  const missingRequired = questions.some((q) => q.isRequired && spotAnswerIsEmpty(answers[q.id]));

  const submit = () => onSubmit(defs.map(({ id, def }) => ({ question: def, answer: { value: answers[id] ?? '' } })));

  return (
    <div className="flex flex-col gap-4">
      {questions.length === 0 ? (
        <p className="text-sm text-ink-60">Submit your brief to move this project forward.</p>
      ) : (
        <SpotComponentView
          component={{ id: project.id, templateName: 'Brief', answers, questionOrder: null }}
          questions={questions}
          editable
          answers={answers}
          onChange={(qid, v) => setAnswers((prev) => ({ ...prev, [qid]: v }))}
          hideTitle
        />
      )}
      <Button variant="accent" disabled={pending || missingRequired} onClick={submit}>Submit brief</Button>
    </div>
  );
}

/**
 * Read-only render of the brand's submitted client-brief responses, shown on the
 * project once it has left the clientBrief stage. Reuses the same Info Hub field
 * renderers so uploaded files, image carousels, colour palettes, addresses etc.
 * preview and open exactly as they do on a brand's SPOT profile. Renders nothing
 * until at least one question has been answered.
 */
// `bare` renders just the labelled responses (no Card) for embedding inside
// another card — e.g. the Brand Workspace; otherwise it renders as its own card.
export function ClientBriefResponses({ project, bare }: { project: any; bare?: boolean }) {
  const entries = useMemo<any[]>(() => (project.customFieldResponses as any[]) ?? [], [project.customFieldResponses]);
  const { questions, answers } = useMemo(() => normalizeBriefFields(entries), [entries]);
  const hasAnswers = questions.some((q) => !spotAnswerIsEmpty(answers[q.id]));
  if (!hasAnswers) return null;
  const body = (
    <SpotComponentView
      component={{ id: project.id, templateName: 'Brief', answers, questionOrder: null }}
      questions={questions}
      answers={answers}
      hideTitle
    />
  );
  if (bare) {
    return (
      <div>
        <Label>Brief responses</Label>
        <div className="mt-1">{body}</div>
      </div>
    );
  }
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>Client brief responses</CardTitle></CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
