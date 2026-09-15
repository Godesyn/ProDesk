import { useEffect, useRef, useState } from 'react';
import { useRoute } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Pencil, Upload, MessageSquare, History, Paperclip, MessageCircle, Wallet, X, Lock, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { useChatNav } from '../chat/chat-nav-context';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { TAG_COLOR_MAP } from '../../lib/tag-colors';
import { TagAssignmentPopover } from './tag-assignment-popover';
import { useProjectTagMutations } from './use-project-tags';
import { initialsOf } from '../../lib/utils';
import { formatCurrency, formatDate, toNumberInput } from '../../lib/utils';
import { reserveNewTab } from '../../lib/redirect';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';
import { cyclePrice as cardCyclePrice } from './cycle-price';
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { IS_RECURRING_PROJECTS_REFUNDABLE } from '@server/lib/feature-flags';
import { DeliverablesPanel, DeliverableRow, type Deliverable } from './deliverables-panel';
import { buildCycles, cadenceLabel, currentCycleOf, cycleOfRow, isCycleBased, pad2 } from './cycle-utils';
import { ClientBriefForm, ClientBriefResponses, WorkflowTransitionHost } from './workflow-transition-dialogs';
import { resolveDropAction, type ProjectStatus, type KanbanTransitionAction } from './transition-action';
import { ProjectSelections } from './project-selections';
import { uploadProjectFile } from './storage';
import { PayoutTile, type PayoutRow } from '../earnings/payout-tile';

const STATUS_LABEL: Record<string, string> = {
  clientBrief: 'Client Brief',
  upcoming: 'Future Phases',
  brief: 'Brief',
  allocate: 'Allocate',
  production: 'Production',
  internalApproval: 'Internal Approval',
  revision: 'Revision',
  clientApproval: 'Client Approval',
  completed: 'Completed',
};

const FREQ_UNIT: Record<string, string> = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

export function ProjectDetailPage() {
  const [, params] = useRoute('/project/:id');
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { workspace, agencyId, user } = useActiveContext();
  const { navigateToChat } = useChatNav();
  const { openFile } = useFileViewer();
  const confirm = useConfirm();
  const id = params?.id;

  const key = trpc.projects.byId.queryKey({ id: id! });
  const q = useQuery({ ...trpc.projects.byId.queryOptions({ id: id! }), enabled: !!id });
  const boardFacetsQuery = useQuery({ ...trpc.projects.boardFacets.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId });
  const invalidate = () => { qc.invalidateQueries({ queryKey: key }); if (agencyId) qc.invalidateQueries({ queryKey: trpc.projects.board.queryKey({ agencyId }) }); };
  // Optimistic tag create/rename/delete/assign — instant feedback instead of
  // waiting for the realtime round-trip.
  const tagMutations = useProjectTagMutations({ id: id ?? '', tags: q.data?.tags }, agencyId ?? '');

  const updateDetails = useMutation({ ...trpc.projects.updateDetails.mutationOptions(), onSuccess: () => { toast.success('Saved'); invalidate(); }, onError: (e) => toastError(e) });
  const addBriefDoc = useMutation({ ...trpc.projects.addBriefDocument.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const upsertCycleBrief = useMutation({ ...trpc.projects.upsertCycleBrief.mutationOptions(), onSuccess: () => { toast.success('Cycle brief saved'); invalidate(); }, onError: (e) => toastError(e) });
  const addBrandNote = useMutation({ ...trpc.projects.addBrandWorkspaceNote.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const payInternal = useMutation({
    ...trpc.projects.payInternalProject.mutationOptions(),
    onError: (e) => toastError(e),
  });
  
  const delivSnapshot = useRef<any>(null);
  const patchDeliverables = async (fn: (list: Deliverable[]) => Deliverable[]) => {
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<any>(key);
    delivSnapshot.current = prev;
    if (prev) qc.setQueryData(key, { ...prev, deliverables: fn(prev.deliverables ?? []) });
    return undefined;
  };
  const rollbackDeliverables = (e: { message: string }) => {
    if (delivSnapshot.current) qc.setQueryData(key, delivSnapshot.current);
    toastError(e);
  };
  const addDeliverable = useMutation({
    ...trpc.projects.addDeliverable.mutationOptions(),
    onMutate: (vars: any) => patchDeliverables((list) => [
      ...list,
      { id: `temp-${crypto.randomUUID()}`, type: vars.type ?? 'text', content: vars.content ?? null, fileName: vars.fileName ?? null, description: null, status: 'pending', rejectionReason: null },
    ]),
    onError: rollbackDeliverables,
    onSettled: invalidate,
  });
  const removeDeliverable = useMutation({ ...trpc.projects.removeDeliverable.mutationOptions(), onSuccess: invalidate });
  const reorderDeliverables = useMutation({
    ...trpc.projects.reorderDeliverables.mutationOptions(),
    onMutate: (vars: any) => patchDeliverables((list) => {
      const byId = new Map(list.map((d) => [d.id, d]));
      const ordered = vars.orderedIds.map((id: string) => byId.get(id)).filter(Boolean) as Deliverable[];
      const rest = list.filter((d) => !vars.orderedIds.includes(d.id));
      return [...ordered, ...rest];
    }),
    onError: rollbackDeliverables,
    onSettled: invalidate,
  });
  const setStatus = useMutation({ ...trpc.projects.setStatus.mutationOptions(), onSuccess: () => { toast.success('Updated'); invalidate(); }, onError: (e) => toastError(e) });
  const submitBrief = useMutation({ ...trpc.projects.submitBrief.mutationOptions(), onSuccess: () => { toast.success('Brief submitted'); invalidate(); }, onError: (e) => toastError(e) });
  const addNote = useMutation({ ...trpc.projects.addNote.mutationOptions(), onSuccess: invalidate, onError: (e) => toastError(e) });
  const softDelete = useMutation({ ...trpc.projects.softDelete.mutationOptions(), onSuccess: () => { toast.success('Project removed'); history.back(); }, onError: (e) => toastError(e) });
  const requestDelete = useMutation({ ...trpc.projects.requestSoftDeleteConfirmation.mutationOptions(), onSuccess: () => { toast.success('Sent to the brand to confirm'); invalidate(); }, onError: (e) => toastError(e) });
  const cancelSub = useMutation({ ...trpc.projects.cancelSubscription.mutationOptions(), onSuccess: () => { toast.success('Subscription cancellation scheduled'); invalidate(); }, onError: (e) => toastError(e) });
  const resumeSub = useMutation({ ...trpc.projects.resumeSubscription.mutationOptions(), onSuccess: () => { toast.success('Subscription resumed'); invalidate(); }, onError: (e) => toastError(e) });


  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!q.data) return <p className="text-ink-60">Project not found.</p>;

  const p = q.data;
  const availableTags = boardFacetsQuery.data?.tags || [];
  const amount = (p.amount ?? {}) as any;
  const isBrandUser = p.viewer.isBrandUser;
  const isAgency = p.viewer.isAgencyMember;
  // Assigned contractor (not an agency member or brand user): sees the agency-side
  // workspace but nothing brand-related except the brand name (project_brand_partition.dart
  // is never built for a contractor). The brand-only fields are also stripped server-side.
  const isContractor = p.viewer.isContractor;
  const allowed = new Set(p.allowedTransitions);
  // Brands only see the deliverables section once the work reaches them
  // (client-approval / completed); before that the whole section is hidden, not
  // just emptied. Internal revisions are never shown to a brand at all. Agency
  // members and contractors always see both. Mirrors the agency-deliverable
  // gating in project_agency_partition.dart.
  const showDeliverables = !isBrandUser || p.status === 'clientApproval' || p.status === 'completed';
  const showRevisions = !isBrandUser;

  // Top-right header amount uses the same source of truth as the Kanban card
  // (ProjectModel.cyclePrice), so the board and the detail screen never disagree.
  const cardPrice = cardCyclePrice(p);
  const cyclePrice = amount.recurring?.weeklyAfter ?? amount.cyclePrice;

  const nextCycleInfo = p.nextCycleAt
    ? `Next Cycle: ${formatDate(p.nextCycleAt)} (after ${p.repeatsEvery ?? 1} ${FREQ_UNIT[p.deliverableFrequency ?? ''] ?? 'cycle'}${(p.repeatsEvery ?? 1) > 1 ? 's' : ''})`
    : null;


  const action = inferAction();

  function inferAction() {
    if (!isAgency) return null;
    if (Number(amount.oneOffTotal ?? 0) > 0 && p.proposedRefundAmount != null) return <span className="text-sm font-semibold text-danger">Refund Requested</span>;
    if (!p.isInternal && Number(cyclePrice ?? 0) > 0 && p.cancelledAt) {
      // A scheduled cancellation (future date) is still reversible — offer Resume;
      // a cancellation that's already taken effect is terminal.
      const scheduled = new Date(p.cancelledAt).getTime() > Date.now();
      if (!scheduled) return <span className="text-sm font-semibold text-danger">Cancelled on {formatDate(p.cancelledAt)}</span>;
      const onResume = async () => {
        const ok = await confirm({
          title: 'Resume subscription?',
          description: `Billing will continue as normal and the scheduled cancellation on ${formatDate(p.cancelledAt)} will be cancelled.`,
          confirmLabel: 'Resume subscription',
          cancelLabel: 'Keep cancelling',
        });
        if (ok) resumeSub.mutate({ id: p.id });
      };
      return (
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-warn">Cancels {formatDate(p.cancelledAt)}</span>
          <Button size="sm" variant="outline" disabled={resumeSub.isPending} onClick={onResume}>Resume</Button>
        </div>
      );
    }
    if (p.softDeleteExpiry && new Date(p.softDeleteExpiry) > new Date()) return <span className="text-sm font-semibold text-danger">Cancellation requested</span>;
    const isSubscription = !p.isInternal && Number(cyclePrice ?? 0) > 0;
    // A completed project is terminal — no Delete affordance. (Subscriptions can
    // still be cancelled to stop future billing; that's not a deletion.)
    if (!isSubscription && p.status === 'completed') return null;
    const onDangerAction = async () => {
      if (isSubscription) {
        // Recurring (non-internal): scheduled cancellation, no refund.
        const ok = await confirm({
          title: 'Cancel subscription?',
          description: 'Billing stops at the end of the committed cycle (after the minimum term). Work in progress continues until complete, and no refunds are issued for payments already made.',
          confirmLabel: 'Cancel subscription',
          cancelLabel: 'Keep subscription',
          destructive: true,
        });
        if (ok) cancelSub.mutate({ id: p.id });
        return;
      }
      if (p.isInternal) {
        // Internal (agency-paid): the agency deletes immediately; refund goes back
        // to the agency. No brand to confirm with.
        const ok = await confirm({
          title: 'Delete project?',
          description: 'Remove this internal project? Any payment already made is refunded to your account. This cannot be undone.',
          confirmLabel: 'Delete',
          destructive: true,
        });
        if (ok) softDelete.mutate({ id: p.id });
        return;
      }
      // Non-internal: the brand must confirm before anything is deleted or refunded.
      const ok = await confirm({
        title: 'Request deletion?',
        description: 'The brand will be emailed a link to confirm the cancellation and refund. The project is only removed — and the refund issued — once they confirm.',
        confirmLabel: 'Send to brand',
        destructive: true,
      });
      if (ok) requestDelete.mutate({ id: p.id });
    };
    const pending = softDelete.isPending || cancelSub.isPending || requestDelete.isPending;
    // When recurring projects are non-refundable, a weekly-billed project can't be
    // deleted-with-refund — disable the refund-issuing delete (internal "Delete" /
    // "Request Deletion"). No-refund subscription *cancellation* stays available.
    const blockRefundDelete =
      !IS_RECURRING_PROJECTS_REFUNDABLE &&
      !isSubscription &&
      isBillingCycleWeekly(p.serviceType as ServiceType | null);
    return (
      <Button
        variant="outline"
        className="text-danger"
        disabled={pending || blockRefundDelete}
        title={blockRefundDelete ? 'Weekly-billed projects are non-refundable and cannot be deleted.' : undefined}
        onClick={onDangerAction}
      >
        {isSubscription ? 'Cancel Subscription' : p.isInternal ? 'Delete' : 'Request Deletion'}
      </Button>
    );
  }

  return (
    <div>
      <button onClick={() => history.back()} className="mb-4 flex items-center gap-1 text-sm text-ink-60 hover:text-ink-100"><ArrowLeft className="h-4 w-4" /> Back</button>
      <PageHeader
        title={p.title ?? p.taskTitle ?? p.serviceName ?? 'Untitled project'}
        description={[p.packageName, p.serviceName].filter(Boolean).join(' · ') || undefined}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {p.serviceType && <Badge variant="default">{p.serviceType}</Badge>}
            <Badge variant="outline">{STATUS_LABEL[p.status] ?? p.status}</Badge>
            {cardPrice > 0 && <span className="text-sm font-semibold text-ink-80">{formatCurrency(cardPrice)}</span>}
            {action}
          </div>
        }
      />
      <div className="-mt-2 mb-4 flex flex-wrap gap-2">
        {p.tags?.map((t: any) => (
          <div key={t.id} className="group inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium bg-white shadow-sm border-slate-200">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TAG_COLOR_MAP[t.color] || t.color }} />
            <span className="text-ink-80">{t.name}</span>
            {isAgency && (
              <button
                type="button"
                onClick={() => tagMutations.removeTag(t.id)}
                className="-mr-1 ml-0.5 rounded-full p-0.5 text-ink-40 hover:text-ink-80 hover:bg-slate-100 transition-colors"
                title={`Remove ${t.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        ))}
        {isAgency && (
          <TagAssignmentPopover project={p} agencyId={agencyId!} availableTags={availableTags} mutations={tagMutations} />
        )}
      </div>
      {nextCycleInfo && <p className="-mt-2 mb-4 text-sm text-ink-60">{nextCycleInfo}</p>}

      {/* Chat-launch chips: open the conversation with the brand, the agency, or
          the assigned person (brand_agency_chips.dart + project_assignee_chip.dart). */}
      <ChatChips
        project={p}
        activeAgencyId={agencyId ?? null}
        isAgencyWorkspace={workspace === 'agency'}
        onChat={navigateToChat}
        isContractor={isContractor}
      />

      {/* Variant + add-ons the brand selected — shown to everyone (brand, agency,
          contractor) so the production side knows the exact scope of work. */}
      <ProjectSelections options={p.selectedOptions as Record<string, string> | null} addons={p.selectedAddons as unknown[] | null} className="mb-5 -mt-1" />

      {/* Client-brief form for the brand when the project is in clientBrief. */}
      {p.status === 'clientBrief' && isBrandUser ? (
        <Card>
          <CardHeader><CardTitle>Complete your brief</CardTitle></CardHeader>
          <CardContent>
            <ClientBriefForm project={p} onSubmit={(responses) => submitBrief.mutate({ id: p.id, customFieldResponses: responses })} pending={submitBrief.isPending} />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Brand Workspace — the shared brand↔agency area: the brand's answered
              brief questions, shared documents, and a shared text thread. Visible
              to the brand and the agency; hidden from contractors. The document
              `source` is the audience, not the uploader — anything dropped here is
              brand-visible even when the agency uploads it on the brand's behalf. */}
          {p.brandId && !isContractor && (
            <BrandPartition
              project={p}
              documents={((p.briefDocuments as any[]) ?? []).filter((d) => d?.source === 'brand')}
              notes={(p.brandWorkspaceNotes as any[]) ?? []}
              isAgency={isAgency}
              canEdit={isBrandUser || isAgency}
              onUpload={async (file) => { const url = await uploadProjectFile(p.id, 'brief', file); addBriefDoc.mutate({ id: p.id, document: { url, fileName: file.name, source: 'brand' } }); }}
              onAddNote={(content) => addBrandNote.mutate({ id: p.id, content, source: isBrandUser ? 'brand' : 'agency' })}
              addNotePending={addBrandNote.isPending}
            />
          )}

          {/* Agency workspace — the description + agency brief documents + internal
              context/budget/duration. Visible to the agency and the assigned
              contractor; never shown to the brand (gated on !isBrandUser and
              stripped server-side). Agency-source deliverables the brand may see at
              client-approval/completed are surfaced in the Deliverables card. */}
          {!isBrandUser && (
            <AgencyPartition
              description={p.description}
              documents={((p.briefDocuments as any[]) ?? []).filter((d) => d?.source === 'agency')}
              isAgency={isAgency}
              briefContext={p.briefContext}
              contractorBudget={p.contractorBudget}
              contractorBudgetNote={p.contractorBudgetNote}
              duration={p.estimatedContractorDurationInHours}
              canEdit={p.viewer.isAgencyMember}
              onSave={(v) => updateDetails.mutate({ id: p.id, ...v })}
              onUpload={async (file) => { const url = await uploadProjectFile(p.id, 'brief', file); addBriefDoc.mutate({ id: p.id, document: { url, fileName: file.name, source: 'agency' } }); }}
            />
          )}
        </div>
      )}

      {/* Workflow actions */}
      {p.status !== 'clientBrief' && (
        <WorkflowActions
          project={p}
          allowed={allowed}
          agencyId={agencyId ?? null}
          workspace={workspace === 'agency' ? 'agency' : 'brand'}
          isBrandUser={isBrandUser}
          onSetStatus={(status) => setStatus.mutate({ id: p.id, status: status as never })}
          onPayInternal={() => {
            // Stripe checkout for the internal project opens in a new tab.
            const tab = reserveNewTab();
            payInternal.mutate(
              {
                id: p.id,
                successUrl: `${window.location.origin}/project/${p.id}?internal_paid=true`,
                cancelUrl: `${window.location.origin}/project/${p.id}`,
              },
              {
                onSuccess: (res) => {
                  if (res.url) tab.go(res.url);
                  else { tab.cancel(); toast.success('Internal project started'); invalidate(); }
                },
                onError: () => tab.cancel(),
              },
            );
          }}
          onChanged={invalidate}
          pending={setStatus.isPending || payInternal.isPending}
        />
      )}

      {/* Cycles — agency-side history + future-cycle pre-briefs for cycling
          projects (recurringService / recurringProductShips). Past cycles are
          read-only (brief snapshot, deliverables, revision feedback); future
          cycles let the agency pre-write the brief that activates on rollover. */}
      {isAgency && isCycleBased(p) && (
        <CyclesCard
          project={p}
          onSaveBrief={(v) => upsertCycleBrief.mutate({ id: p.id, ...v })}
          saving={upsertCycleBrief.isPending}
        />
      )}

      {/* Deliverables — hidden from the brand until client-approval/completed. */}
      {showDeliverables && (
        <Card className="mt-6">
          <CardHeader><CardTitle>Deliverables</CardTitle>{isAgency && <VisibilityNote>Visible to contractors. Shared with the brand once the project reaches client approval.</VisibilityNote>}</CardHeader>
          <CardContent>
            <DeliverablesPanel
              projectId={p.id}
              deliverables={p.deliverables as Deliverable[]}
              editable={isAgency || p.viewer.isAssignedPerson}
              onAdd={(input) => addDeliverable.mutate({ projectId: p.id, source: isBrandUser ? 'brand' : 'agency', ...input })}
              onRemove={(did) => removeDeliverable.mutate({ id: did })}
              onReorder={(orderedIds) => reorderDeliverables.mutate({ projectId: p.id, orderedIds })}
              pending={addDeliverable.isPending}
            />
          </CardContent>
        </Card>
      )}

      {/* Related payouts — agency-only. Contractors and the brand never see payout
          figures (the procedure denies them server-side too). */}
      {isAgency && <RelatedPayoutsCard projectId={p.id} viewerId={user?.id} viewerAgencyId={agencyId ?? undefined} />}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Revisions — never shown to a brand (internal review history). */}
        {showRevisions && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Revisions</CardTitle>{isAgency && <VisibilityNote>Internal — not visible to brands. Visible to contractors.</VisibilityNote>}</CardHeader>
          <CardContent className="flex flex-col gap-3">
            {(p.revisions as any[]).length === 0 && <p className="text-sm text-ink-40">No revisions.</p>}
            {(p.revisions as any[]).map((r) => (
              <div key={r.id} className="rounded-[var(--radius-sm)] bg-inset/60 p-3 text-sm">
                <div className="mb-1 flex items-center gap-2 text-xs font-medium text-ink-40">
                  <Badge variant={r.source === 'brand' ? 'danger' : 'warn'}>{r.source === 'brand' ? 'Client' : 'Internal'}</Badge>
                  {r.authorName} · {formatDate(r.createdAt)}
                </div>
                <p className="text-ink-80">{r.content || '—'}</p>
                {(r.attachmentUrls ?? []).map((u: string, i: number) => (
                  <button key={i} type="button" onClick={() => openFile({ url: u, title: `Attachment ${i + 1}` })} className="mt-1 flex items-center gap-1 text-xs text-accent hover:underline"><Paperclip className="h-3 w-3" /> Attachment {i + 1}</button>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>
        )}

        {/* Notes */}
        <NotesCard project={p} canAdd={isAgency || isBrandUser} showVisibilityNote={isAgency} source={isBrandUser ? 'brand' : 'agency'} onAdd={(content) => addNote.mutate({ projectId: p.id, content, source: isBrandUser ? 'brand' : 'agency' })} pending={addNote.isPending} />
      </div>
    </div>
  );
}

/* ---- chat-launch chips ---- */

function ChatChips({ project, activeAgencyId, isAgencyWorkspace, onChat, isContractor }: {
  project: any;
  activeAgencyId: string | null;
  isAgencyWorkspace: boolean;
  onChat: ReturnType<typeof useChatNav>['navigateToChat'];
  isContractor: boolean;
}) {
  if (!project.brandId) return null;

  // Agency viewing another agency's project → inter-agency thread (brand_agency_chips.dart:24-31).
  const goToInterAgency = isAgencyWorkspace && !!activeAgencyId && !!project.agencyId && activeAgencyId !== project.agencyId;

  const pill = 'inline-flex items-center gap-1.5 rounded-pill border border-[color:var(--color-border-default)] bg-card px-3 py-1.5 text-sm text-ink-80 transition-colors hover:bg-inset';

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      {project.brand && (
        // Contractors see the brand name for context but can't message the brand
        // directly — they communicate through the agency, so the chip is inert.
        isContractor ? (
          <span className={pill}>
            <Avatar className="h-5 w-5 rounded-[var(--radius-sm)]">
              {project.brand.logoUrl && <AvatarImage src={project.brand.logoUrl} className="object-cover" />}
              <AvatarFallback className="rounded-[var(--radius-sm)] text-[9px]">{initialsOf(project.brand.name)}</AvatarFallback>
            </Avatar>
            <span className="font-medium text-ink-100">{project.brand.name}</span>
          </span>
        ) : (
          <button
            className={pill}
            onClick={() => onChat({ brandId: project.brandId, agencyId: project.agencyId, target: 'brandThread', projectId: project.id, selfAgencyId: activeAgencyId })}
          >
            <Avatar className="h-5 w-5 rounded-[var(--radius-sm)]">
              {project.brand.logoUrl && <AvatarImage src={project.brand.logoUrl} className="object-cover" />}
              <AvatarFallback className="rounded-[var(--radius-sm)] text-[9px]">{initialsOf(project.brand.name)}</AvatarFallback>
            </Avatar>
            <span className="font-medium text-ink-100">{project.brand.name}</span>
            <MessageCircle className="h-3.5 w-3.5 text-ink-60" />
          </button>
        )
      )}
      {project.agency && (
        <button
          className={pill}
          onClick={() => onChat({ brandId: project.brandId, agencyId: project.agencyId, target: goToInterAgency ? 'interAgencyThread' : 'agencyThread', projectId: project.id, selfAgencyId: activeAgencyId })}
        >
          <Avatar className="h-5 w-5 rounded-[var(--radius-sm)]">
            {project.agency.logoUrl && <AvatarImage src={project.agency.logoUrl} className="object-cover" />}
            <AvatarFallback className="rounded-[var(--radius-sm)] text-[9px]">{initialsOf(project.agency.name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium text-ink-100">{project.agency.name}</span>
          <MessageCircle className="h-3.5 w-3.5 text-ink-60" />
        </button>
      )}
      {project.assignee && (
        <button
          className={pill}
          onClick={() => onChat({ brandId: project.brandId, agencyId: project.agencyId, target: 'personalThread', targetUserId: project.assignee.userId, projectId: project.id, selfAgencyId: activeAgencyId })}
        >
          <Avatar className="h-5 w-5">
            {project.assignee.avatar && <AvatarImage src={project.assignee.avatar} />}
            <AvatarFallback className="text-[9px]">{initialsOf(project.assignee.name)}</AvatarFallback>
          </Avatar>
          <span className="font-medium text-ink-100">{project.assignee.name}</span>
          <MessageCircle className="h-3.5 w-3.5 text-ink-60" />
        </button>
      )}
    </div>
  );
}

/* ---- visibility note ---- */

// Small muted caption under a section title, spelling out who can / can't see the
// section's contents. Visibility is enforced server-side (projects.byId); these
// notes just make the rule legible to whoever is looking at the section.
function VisibilityNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-normal text-ink-40">{children}</p>;
}

/* ---- partitions ---- */

// Brand Workspace — the shared brand↔agency surface. Both sides upload
// documents and post text entries (each visible to the other); the brand's
// answered brief questions also surface here. Contractors never see it.
function BrandPartition({ project, documents, notes, isAgency, canEdit, onUpload, onAddNote, addNotePending }: {
  project: any; documents: any[]; notes: any[]; isAgency: boolean; canEdit: boolean;
  onUpload: (file: File) => Promise<void>; onAddNote: (content: string) => void; addNotePending: boolean;
}) {
  const { openFile } = useFileViewer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const submit = () => { const t = text.trim(); if (t) { onAddNote(t); setText(''); } };
  return (
    <Card>
      <CardHeader><CardTitle>Brand Workspace</CardTitle>{isAgency && <VisibilityNote>Shared between the brand and agency. Not visible to contractors.</VisibilityNote>}</CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* The brand's answered brief questions (only renders when answered). */}
        <ClientBriefResponses project={project} bare />
        <div>
          <Label>Shared documents</Label>
          <div className="mt-1 flex flex-col gap-1">
            {documents.length === 0 && <p className="text-sm text-ink-40">No documents.</p>}
            {documents.map((d, i) => <button key={i} type="button" onClick={() => openFile({ url: d.url, title: d.fileName ?? `Document ${i + 1}` })} className="flex min-w-0 items-center gap-2 text-left text-sm text-accent hover:underline"><Paperclip className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 truncate">{d.fileName ?? `Document ${i + 1}`}</span></button>)}
          </div>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
              <Button size="sm" variant="outline" className="mt-2" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload document</Button>
            </>
          )}
        </div>
        <div>
          <Label>Messages</Label>
          <div className="mt-1 flex max-h-72 flex-col gap-2 overflow-y-auto">
            {notes.length === 0 && <p className="text-sm text-ink-40">No messages yet.</p>}
            {notes.map((n, i) => (
              <div key={n.id ?? i} className="rounded-[var(--radius-sm)] bg-inset/60 p-2.5 text-sm">
                <div className="mb-0.5 flex items-center gap-2 text-xs font-medium text-ink-40"><Badge variant={n.source === 'brand' ? 'accent' : 'muted'}>{n.source === 'brand' ? 'Brand' : 'Agency'}</Badge>{n.authorName}</div>
                <p className="whitespace-pre-wrap text-ink-80">{n.content}</p>
              </div>
            ))}
          </div>
          {canEdit && (
            <div className="mt-2 flex gap-2">
              <Input placeholder="Add a message…" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
              <Button variant="outline" disabled={!text.trim() || addNotePending} onClick={submit}>Send</Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Agency workspace — the description, agency-side brief documents, and internal
// context/budget/duration. Visible to the agency and the assigned contractor;
// never to the brand.
function AgencyPartition({ description, documents, isAgency, briefContext, contractorBudget, contractorBudgetNote, duration, canEdit, onSave, onUpload }: {
  description: string | null; documents: any[]; isAgency: boolean; briefContext: string | null; contractorBudget: string | null; contractorBudgetNote: string | null; duration: number | null; canEdit: boolean;
  onSave: (v: { description?: string; briefContext?: string; contractorBudget?: string; estimatedContractorDurationInHours?: number }) => void; onUpload: (file: File) => Promise<void>;
}) {
  const { openFile } = useFileViewer();
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(description ?? '');
  const [ctx, setCtx] = useState(briefContext ?? '');
  const [budget, setBudget] = useState(toNumberInput(contractorBudget));
  const [dur, setDur] = useState(toNumberInput(duration));
  const fileRef = useRef<HTMLInputElement>(null);
  const startEdit = () => { setDesc(description ?? ''); setCtx(briefContext ?? ''); setBudget(toNumberInput(contractorBudget)); setDur(toNumberInput(duration)); setEditing(true); };
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Agency workspace</CardTitle>
            {isAgency && <VisibilityNote>Visible to contractors only.</VisibilityNote>}
          </div>
          {canEdit && !editing && <Button size="icon" variant="ghost" onClick={startEdit}><Pencil className="h-4 w-4" /></Button>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {editing ? (
          <>
            <div className="flex flex-col gap-1.5"><Label>Description</Label><textarea className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2 text-sm" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
            <div className="flex flex-col gap-1.5"><Label>Brief context</Label><textarea className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2 text-sm" value={ctx} onChange={(e) => setCtx(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5"><Label>Contractor budget</Label><Input type="number" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
              <div className="flex flex-col gap-1.5"><Label>Est. duration (hrs)</Label><Input type="number" value={dur} onChange={(e) => setDur(e.target.value)} /></div>
            </div>
            <div className="flex gap-2"><Button size="sm" variant="accent" onClick={() => { onSave({ description: desc, briefContext: ctx, contractorBudget: budget || undefined, estimatedContractorDurationInHours: dur ? Number(dur) : undefined }); setEditing(false); }}>Save</Button><Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
          </>
        ) : (
          <>
            <div><Label>Description</Label><p className="mt-1 whitespace-pre-wrap text-sm text-ink-80">{description || '—'}</p></div>
            <div><Label>Brief context</Label><p className="mt-1 whitespace-pre-wrap text-sm text-ink-80">{briefContext || '—'}</p></div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><Label>Contractor budget</Label><p className="mt-1 text-ink-80">{contractorBudget ? formatCurrency(contractorBudget) : '—'}</p>{contractorBudgetNote && <p className="text-xs text-ink-40">{contractorBudgetNote}</p>}</div>
              <div><Label>Est. duration</Label><p className="mt-1 text-ink-80">{duration != null ? `${duration} hrs` : '—'}</p></div>
            </div>
          </>
        )}
        <div>
          <Label>Brief documents</Label>
          <div className="mt-1 flex flex-col gap-1">
            {documents.length === 0 && <p className="text-sm text-ink-40">No documents.</p>}
            {documents.map((d, i) => <button key={i} type="button" onClick={() => openFile({ url: d.url, title: d.fileName ?? `Document ${i + 1}` })} className="flex min-w-0 items-center gap-2 text-left text-sm text-accent hover:underline"><Paperclip className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 truncate">{d.fileName ?? `Document ${i + 1}`}</span></button>)}
          </div>
          {canEdit && (
            <>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
              <Button size="sm" variant="outline" className="mt-2" onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload brief document</Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ---- cycles (agency) ---- */

const isHeadlineDeliverable = (d: Deliverable) => d.type === 'text' && (d.content ?? '').startsWith('# ');
const shortDate = (v: string | Date | null | undefined) =>
  v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';

/**
 * Agency cycle rail + per-cycle panel. Completed cycles show their frozen
 * brief, deliverables, and revision feedback (read-only, downloadable); the
 * current cycle points back to the Agency workspace editor; future cycles take
 * a pre-brief (context + documents) that the recycle engine promotes onto the
 * project when the cycle opens.
 */
function CyclesCard({ project: p, onSaveBrief, saving }: {
  project: any;
  onSaveBrief: (v: { cycleNumber: number; briefContext?: string; briefDocuments?: unknown[] }) => void;
  saving: boolean;
}) {
  const current = currentCycleOf(p);
  const deliverables = (p.deliverables as Deliverable[]) ?? [];
  const cells = buildCycles(p, (p.cycles as any[]) ?? [], {
    extraCycles: deliverables.map((d) => cycleOfRow(d, current)),
  });
  const [selN, setSelN] = useState<number | null>(null);
  const sel = selN ?? current;
  const cell = cells.find((c) => c.n === sel);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  // Keep the current cycle (and one before) in view on first render.
  const railRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = railRef.current;
    if (!el || cells.length === 0) return;
    const idx = cells.findIndex((c) => c.state === 'current');
    const target = el.children[Math.max(0, idx - 1)] as HTMLElement | undefined;
    if (target) el.scrollLeft = target.offsetLeft - el.offsetLeft;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, cells.length]);

  if (cells.length === 0 || !cell) return null;

  const cycleDeliverables = deliverables.filter((d) => cycleOfRow(d, current) === cell.n);
  const cycleRevisions = ((p.revisions as any[]) ?? []).filter((r) => (r.cycle ?? 1) === cell.n && r.content);
  const briefDocs = (cell.briefDocuments as { url?: string; fileName?: string }[]) ?? [];
  const draft = drafts[cell.n] ?? cell.briefContext ?? '';
  const dirty = draft !== (cell.briefContext ?? '');

  const uploadPreBriefDoc = async (file: File) => {
    const url = await uploadProjectFile(p.id, 'brief', file);
    onSaveBrief({ cycleNumber: cell.n, briefDocuments: [...briefDocs, { url, fileName: file.name, source: 'agency' }] });
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-baseline gap-3">
          <CardTitle>Cycles</CardTitle>
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-40">Repeats {cadenceLabel(p.deliverableFrequency, p.repeatsEvery).toLowerCase()}</span>
          <span className="ml-auto text-xs text-ink-40">Brief future cycles ahead of time — they apply when the cycle opens.</span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div ref={railRef} className="flex scroll-smooth gap-0.5 overflow-x-auto rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-inset/60 p-0.5">
          {cells.map((c) => {
            const count = deliverables.filter((d) => cycleOfRow(d, current) === c.n && !isHeadlineDeliverable(d)).length;
            const sub = c.state === 'completed'
              ? `Completed ${c.completedAt ? shortDate(c.completedAt) : ''}`.trim()
              : c.state === 'current'
                ? (STATUS_LABEL[p.status] ?? p.status)
                : c.opensAt ? `Opens ${shortDate(c.opensAt)}` : 'Upcoming';
            const selected = c.n === sel;
            const briefed = c.state === 'upcoming' && !!(c.briefContext || (c.briefDocuments?.length ?? 0) > 0);
            return (
              <button
                key={c.n}
                type="button"
                onClick={() => setSelN(c.n)}
                className={
                  'flex min-w-[132px] flex-1 shrink-0 flex-col items-start gap-1.5 rounded-[calc(var(--radius-sm)-2px)] px-3.5 py-3 text-left transition-colors ' +
                  (selected ? 'bg-card shadow-sm ring-1 ring-[color:var(--color-border-hairline)]' : 'hover:bg-card/60')
                }
              >
                <span className="flex w-full items-center gap-1.5">
                  <span className={'font-mono text-[11px] tracking-wider ' + (selected ? 'font-semibold text-ink-100' : 'text-ink-40')}>{pad2(c.n)}</span>
                  {briefed && <Badge className="ml-auto" variant="muted">Briefed</Badge>}
                  {c.state === 'completed' && <Lock className={briefed ? 'h-3 w-3 text-ink-40' : 'ml-auto h-3 w-3 text-ink-40'} />}
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

        <div className="font-mono text-[11px] uppercase tracking-wider text-ink-40">Cycle {pad2(cell.n)} · {cell.label}</div>

        {cell.state === 'current' ? (
          <>
            <p className="text-sm text-ink-60">This is the live cycle — its brief, budget, and documents are edited in the Agency workspace above.</p>
            {p.briefContext && <div><Label>Brief context</Label><p className="mt-1 whitespace-pre-wrap text-sm text-ink-80">{p.briefContext}</p></div>}
          </>
        ) : cell.state === 'completed' ? (
          <>
            <div className="flex items-start gap-2.5 rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] p-3 text-sm text-ink-60">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-40" />
              <span>Cycle {pad2(cell.n)}{cell.completedAt ? ` completed ${shortDate(cell.completedAt)}` : ' completed'}. Completed cycles are locked — everything below is read only.</span>
            </div>
            <div>
              <Label>Brief context</Label>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-80">{cell.briefContext || '—'}</p>
            </div>
            {briefDocs.length > 0 && <CycleDocList docs={briefDocs} />}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>Brief context for this cycle</Label>
              <textarea
                className="min-h-20 w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card p-2 text-sm"
                placeholder="Write the brief the team should pick up when this cycle opens…"
                value={draft}
                onChange={(e) => setDrafts((d) => ({ ...d, [cell.n]: e.target.value }))}
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="accent" disabled={!dirty || saving} onClick={() => onSaveBrief({ cycleNumber: cell.n, briefContext: draft })}>
                  {saving ? 'Saving…' : 'Save cycle brief'}
                </Button>
                {cell.opensAt && <span className="text-xs text-ink-40">Applies automatically when the cycle opens{cell.opensAt ? ` on ${shortDate(cell.opensAt)}` : ''}.</span>}
              </div>
            </div>
            <div>
              <Label>Brief documents</Label>
              {briefDocs.length > 0 ? <CycleDocList docs={briefDocs} /> : <p className="mt-1 text-sm text-ink-40">No documents.</p>}
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPreBriefDoc(f); e.target.value = ''; }} />
              <Button size="sm" variant="outline" className="mt-2" disabled={saving} onClick={() => fileRef.current?.click()}><Upload className="h-4 w-4" /> Upload brief document</Button>
            </div>
          </>
        )}

        {cell.state !== 'current' && cycleDeliverables.length > 0 && (
          <div>
            <Label>Deliverables</Label>
            <div className="mt-1 flex flex-col gap-2">
              {cycleDeliverables.map((d) => (
                <DeliverableRow key={d.id} d={d} editable={false} pendingBadge={cell.state === 'upcoming' ? 'Staged' : undefined} />
              ))}
            </div>
          </div>
        )}

        {cell.state === 'completed' && cycleRevisions.length > 0 && (
          <div>
            <Label>Revision feedback</Label>
            <div className="mt-1 flex flex-col gap-2">
              {cycleRevisions.map((r: any) => (
                <div key={r.id} className="rounded-[var(--radius-sm)] bg-inset/60 p-3 text-sm">
                  <div className="mb-1 flex items-center gap-2 text-xs font-medium text-ink-40">
                    <Badge variant={r.source === 'brand' ? 'danger' : 'warn'}>{r.source === 'brand' ? 'Client' : 'Internal'}</Badge>
                    {r.authorName} · {formatDate(r.createdAt)}
                  </div>
                  <p className="text-ink-80">{r.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CycleDocList({ docs }: { docs: { url?: string; fileName?: string }[] }) {
  const { openFile } = useFileViewer();
  return (
    <div className="mt-1 flex flex-col gap-1">
      {docs.map((d, i) => (
        <button key={i} type="button" onClick={() => d.url && openFile({ url: d.url, title: d.fileName ?? `Document ${i + 1}` })} className="flex min-w-0 items-center gap-2 text-left text-sm text-accent hover:underline">
          <Paperclip className="h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 truncate">{d.fileName ?? `Document ${i + 1}`}</span>
        </button>
      ))}
    </div>
  );
}

/* ---- workflow actions ---- */

function WorkflowActions({ project, allowed, agencyId, workspace, isBrandUser, onPayInternal, onSetStatus, onChanged, pending }: {
  project: any; allowed: Set<string>;
  agencyId: string | null;
  workspace: 'agency' | 'brand';
  isBrandUser: boolean;
  onPayInternal: () => void;
  onSetStatus: (status: string) => void;
  onChanged: () => void;
  pending: boolean;
}) {
  const s = project.status as ProjectStatus;
  // The transition dialog currently open — the SAME WorkflowTransitionHost the
  // Kanban board opens, so a detail-screen button does exactly what dragging the
  // card to that column does.
  const [dialog, setDialog] = useState<KanbanTransitionAction | null>(null);

  // Mirror of the board's onDragEnd: resolve the (from → to) action, commit
  // direct transitions inline, and open the shared host for everything else.
  const go = (to: ProjectStatus) => {
    const action = resolveDropAction(s, to, { workspace, isInternal: !!project.isInternal });
    switch (action) {
      // Completion (directComplete/markComplete) falls through to the shared host,
      // which reviews the deliverables before completing.
      case 'startRevision': onSetStatus('production'); return;
      case 'moveToClientBrief': onSetStatus('clientBrief'); return;
      case 'forceStartUpcoming': onSetStatus('brief'); return;
      case 'invalid': toast.error('Invalid transition'); return;
      case 'completeClientBrief':
        // The agency-side completion is dialog-less (the brand fills the brief).
        if (workspace === 'agency') { onSetStatus(to); return; }
        break;
    }
    setDialog(action);
  };

  const buttons: React.ReactNode[] = [];
  // Upcoming: force-start to brief, or move directly to the brand client-brief
  // stage (forceStartUpcoming / moveToClientBrief in kanban_permission_service).
  if (s === 'upcoming') {
    if (allowed.has('brief')) buttons.push(<Button key="fs" variant="accent" disabled={pending} onClick={() => go('brief')}>Force start → Brief</Button>);
    if (allowed.has('clientBrief')) buttons.push(<Button key="mcb" variant="outline" disabled={pending} onClick={() => go('clientBrief')}>Move to client brief</Button>);
  }
  if (s === 'brief' && allowed.has('allocate')) buttons.push(<Button key="cb" variant="accent" disabled={pending} onClick={() => go('allocate')}>Complete brief → Allocate</Button>);
  if (s === 'allocate' && allowed.has('production')) buttons.push(<Button key="al" variant="accent" disabled={pending} onClick={() => go('production')}>Allocate people</Button>);
  if (s === 'allocate' && project.isInternal && project.productionAssigneeId && Number(project.contractorBudget ?? 0) > 0)
    buttons.push(<Button key="pay" variant="accent" disabled={pending} onClick={onPayInternal}>Pay &amp; start →</Button>);
  if (s === 'internalApproval') {
    if (allowed.has('clientApproval')) buttons.push(<Button key="ia" variant="accent" disabled={pending} onClick={() => go('clientApproval')}>Request client approval</Button>);
    if (allowed.has('revision')) buttons.push(<Button key="ir" variant="outline" className="text-danger" disabled={pending} onClick={() => go('revision')}>Request revision</Button>);
  }
  if (s === 'clientApproval') {
    if (allowed.has('completed')) {
      // resolveDropAction encodes the branch: brand/internal complete directly,
      // an agency on an external project requests completion (emails the brand).
      if (isBrandUser || project.isInternal) {
        buttons.push(<Button key="ca" variant="accent" disabled={pending} onClick={() => go('completed')}>Approve → Complete</Button>);
      } else {
        buttons.push(<Button key="ca" variant="accent" disabled={pending} onClick={() => go('completed')}>Send confirmation email to brand</Button>);
        // Manual completion has no Kanban-drag equivalent (detail-only override) —
        // open its dialog from the same shared host directly.
        buttons.push(<Button key="cm" variant="outline" disabled={pending} onClick={() => setDialog('manualClientApprove')}>Complete on client's behalf</Button>);
      }
    }
    if (allowed.has('internalApproval') || allowed.has('revision')) buttons.push(<Button key="cr" variant="outline" className="text-danger" disabled={pending} onClick={() => go(allowed.has('revision') ? 'revision' : 'internalApproval')}>Request revision</Button>);
  }

  if (buttons.length === 0) return null;

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4">{buttons}</div>
      <WorkflowTransitionHost
        project={project}
        action={dialog}
        agencyId={agencyId}
        onClose={() => setDialog(null)}
        onChanged={onChanged}
      />
    </>
  );
}

/* ---- notes ---- */

function NotesCard({ project, canAdd, showVisibilityNote, onAdd, pending }: { project: any; canAdd: boolean; showVisibilityNote?: boolean; source?: 'brand' | 'agency'; onAdd: (content: string) => void; pending: boolean }) {
  const [text, setText] = useState('');
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquare className="h-4 w-4" /> Notes</CardTitle>{showVisibilityNote && <VisibilityNote>Brand notes are visible to brands; agency notes are visible to contractors.</VisibilityNote>}</CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto">
          {(project.notes as any[]).length === 0 && <p className="text-sm text-ink-40">No notes yet.</p>}
          {(project.notes as any[]).map((n) => (
            <div key={n.id} className="rounded-[var(--radius-sm)] bg-inset/60 p-2.5 text-sm">
              <div className="mb-0.5 flex items-center gap-2 text-xs font-medium text-ink-40"><Badge variant={n.source === 'brand' ? 'accent' : 'muted'}>{n.source}</Badge>{n.authorName}</div>
              <p className="text-ink-80">{n.content}</p>
            </div>
          ))}
        </div>
        {canAdd && (
          <div className="flex gap-2">
            <Input placeholder="Add a note…" value={text} onChange={(e) => setText(e.target.value)} />
            <Button variant="outline" disabled={!text.trim() || pending} onClick={() => { onAdd(text.trim()); setText(''); }}>Send</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ---- related payouts (agency-only) ---- */

// Payouts whose breakdown references this project. The data is fetched from an
// agency-gated procedure (payouts.forProject), so this card is only rendered for
// agency members and the server denies contractors/brand users outright.
function RelatedPayoutsCard({ projectId, viewerId, viewerAgencyId }: { projectId: string; viewerId?: string; viewerAgencyId?: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.payouts.forProject.queryOptions({ projectId }));
  const list = (q.data ?? []) as PayoutRow[];
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wallet className="h-4 w-4" /> Related payouts</CardTitle>
        <VisibilityNote>Visible to the agency only. Not shown to contractors or the brand.</VisibilityNote>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {q.isLoading && <Skeleton className="h-20 w-full" />}
        {!q.isLoading && list.length === 0 && <p className="text-sm text-ink-40">No payouts linked to this project yet.</p>}
        {list.map((po) => (
          <PayoutTile
            key={po.id}
            payout={po}
            viewerId={viewerId}
            viewerAgencyId={viewerAgencyId}
            // Payee chip: the resolved user, or the receiving agency shaped like
            // a beneficiary (name + logo) — mirrors the earnings page mapping.
            beneficiary={
              po.beneficiaryUser ??
              (po.beneficiaryAgency
                ? { id: po.beneficiaryAgency.id, firstName: po.beneficiaryAgency.name, lastName: '', email: '', profileUrl: po.beneficiaryAgency.logoUrl ?? null }
                : undefined)
            }
          />
        ))}
      </CardContent>
    </Card>
  );
}

