import { useEffect, useMemo, useRef, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Copy, FileText, Layers, Plus, Send, Trash2, Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { Button } from '../../components/ui/button';
import { UploadButton } from '../../components/upload-button';
import { StorageBucket } from '../../lib/storage-buckets';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { toNumberInput } from '../../lib/utils';
import { Label } from '../../components/ui/label';
import { Skeleton } from '../../components/ui/skeleton';
import { AvatarSelect } from '../../components/ui/avatar-select';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '../../components/ui/dialog';
import { BrandSelection, type PickedBrand } from '../projects/brand-selection';
import { ServiceDetailDialog } from '../marketplace/service-detail-dialog';
import { isWeekly } from '../marketplace/pricing';
import { configuredPriceFor } from '../agency/package-shared';
import type { MarketplaceService, ServiceAddon, ServiceOption, SelectedAddon } from '../marketplace/types';
import { CatalogPanel, type AddServicePayload } from './catalog-panel';
import { CustomItemDialog, type CustomItemPayload } from './custom-item-dialog';
import { BillingSidebar } from './billing-sidebar';
import { computeSubtotals, type BillingItem } from './billing';
import { Textarea } from './ui';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { PhasesEditor, type Phase, type Item } from './phases-editor';
/** Fields the optimistic addItem update reads (a loose superset-compatible view of the mutation input). */
type AddItemVars = {
  id?: string; proposalId: string; phaseId?: string | null; type?: 'service' | 'heading' | 'custom';
  description?: string | null; headingText?: string | null; amount?: number; quantity?: number;
  upfrontFee?: number | null; isRecurring?: boolean; isOptional?: boolean;
  serviceId?: string | null; packageId?: string | null; agencyId?: string | null;
};

/** 3-pane proposal builder: catalog | phases+items | documents+billing. */
export function ProposalBuilderPage() {
  const [, params] = useRoute('/proposal/:id/edit');
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { agencyId } = useActiveContext();
  const id = params?.id;

  const key = trpc.proposals.byId.queryKey({ id: id! });
  const q = useQuery({ ...trpc.proposals.byId.queryOptions({ id: id! }), enabled: !!id });

  // Debounced reconcile. Each edit settles into its own refetch; during a burst
  // (e.g. add a service then immediately tweak its qty/amount/optional) an early
  // refetch can transiently overwrite a later still-queued optimistic edit. We
  // coalesce them so the server is re-read once the burst settles.
  const invalidateTimer = useRef<ReturnType<typeof setTimeout>>();
  const invalidate = () => {
    clearTimeout(invalidateTimer.current);
    invalidateTimer.current = setTimeout(() => { void qc.invalidateQueries({ queryKey: key }); }, 350);
  };
  useEffect(() => () => clearTimeout(invalidateTimer.current), []);

  // Serialize the *network* side of edits into a single FIFO chain. The optimistic
  // cache updates still apply instantly (snappy UI); only the server round-trips
  // are ordered. This guarantees a freshly-added item/phase INSERT commits before
  // any edit/remove that references it — otherwise an update could reach the server
  // before the row exists and 404 with "item doesn't exist".
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(fn, fn);
    chain.current = run.then(() => {}, () => {});
    return run;
  };
  const serialized = <O extends { mutationFn?: (...a: never[]) => Promise<unknown> }>(opts: O): O => {
    const fn = opts.mutationFn;
    return fn ? { ...opts, mutationFn: ((...a: never[]) => enqueue(() => fn(...a))) as O['mutationFn'] } : opts;
  };

  // Optimistic cache helpers. Every edit mutates the byId cache immediately so
  // the UI updates without waiting for a server round-trip + refetch (the source
  // of the lag), rolling back on error and reconciling on settle.
  type Data = NonNullable<typeof q.data>;
  const merge = <T,>(base: T, patch: Record<string, unknown>) => ({ ...base, ...patch }) as T;
  // Snapshot is held in a closure (not returned as mutation context) so onMutate
  // stays void — keeping the context type compatible with tRPC's mutationOptions.
  const optimistic = <V = Record<string, unknown>,>(updater: (d: Data, v: V) => Data) => {
    let snapshot: Data | undefined;
    return {
      onMutate: async (v: V) => {
        await qc.cancelQueries({ queryKey: key });
        snapshot = qc.getQueryData<Data>(key);
        if (snapshot) qc.setQueryData<Data>(key, updater(snapshot, v));
        return undefined;
      },
      onError: (e: { message: string }) => {
        if (snapshot) qc.setQueryData<Data>(key, snapshot);
        toastError(e);
      },
      onSettled: () => invalidate(),
    };
  };

  const clients = useQuery({ ...trpc.connections.agencyClients.queryOptions({ agencyId: agencyId!, limit: 100, offset: 0 }), enabled: !!agencyId });

  const [customOpen, setCustomOpen] = useState(false);
  // A service with options / add-ons being configured before it's added — opens
  // the shared detail dialog so the buyer's exact configuration (and price) is
  // captured first (mirrors the Flutter ProposalCatalogPanel + the package editor).
  const [configTarget, setConfigTarget] = useState<{ service: MarketplaceService; agencyId?: string } | null>(null);

  const addItem = useMutation({
    ...serialized(trpc.proposals.addItem.mutationOptions()),
    ...optimistic((d, v: AddItemVars) => {
      const sorted = [...d.phases].sort((a, b) => a.sortOrder - b.sortOrder);
      const fallbackPhase = sorted[sorted.length - 1]?.id ?? null;
      const newItem = {
        // Reuse the client-supplied id so the optimistic row matches the DB row the
        // server will create — keeps follow-up edits valid before the refetch lands.
        id: v.id ?? crypto.randomUUID(),
        proposalId: v.proposalId,
        phaseId: v.phaseId ?? fallbackPhase,
        type: v.type ?? 'service',
        description: v.description ?? null,
        headingText: v.headingText ?? null,
        amount: toNumberInput(v.amount ?? 0),
        quantity: v.quantity ?? 1,
        upfrontFee: v.upfrontFee != null ? toNumberInput(v.upfrontFee) : null,
        isRecurring: v.isRecurring ?? false,
        isOptional: v.isOptional ?? false,
        serviceId: v.serviceId ?? null,
        packageId: v.packageId ?? null,
        packageName: null,
        agencyId: v.agencyId ?? null,
        sortOrder: d.items.length,
      } as unknown as Data['items'][number];
      return { ...d, items: [...d.items, newItem] };
    }),
  });
  // addPackage stays a refetch: the resolved package items aren't known client-side.
  const addPackage = useMutation({ ...serialized(trpc.proposals.addPackage.mutationOptions()), onSuccess: invalidate, onError: (e) => toastError(e) });
  const updateItem = useMutation({
    ...serialized(trpc.proposals.updateItem.mutationOptions()),
    ...optimistic((d, v: { id: string } & Record<string, unknown>) => {
      const { id: itemId, ...rest } = v;
      return { ...d, items: d.items.map((it) => (it.id === itemId ? merge(it, rest) : it)) };
    }),
  });
  const removeItem = useMutation({
    ...serialized(trpc.proposals.removeItem.mutationOptions()),
    ...optimistic((d, v: { id: string }) => ({ ...d, items: d.items.filter((it) => it.id !== v.id) })),
  });
  const addPhase = useMutation({
    ...serialized(trpc.proposals.addPhase.mutationOptions()),
    ...optimistic((d, v: { id?: string; proposalId: string; name?: string; startDelayDays?: number }) => {
      const newPhase = {
        id: v.id ?? crypto.randomUUID(),
        proposalId: v.proposalId,
        name: v.name ?? `Phase ${d.phases.length + 1}`,
        sortOrder: d.phases.length,
        startDelayDays: v.startDelayDays ?? 14,
      } as unknown as Data['phases'][number];
      return { ...d, phases: [...d.phases, newPhase] };
    }),
  });
  const updatePhase = useMutation({
    ...serialized(trpc.proposals.updatePhase.mutationOptions()),
    ...optimistic((d, v: { id: string } & Record<string, unknown>) => {
      const { id: phaseId, ...rest } = v;
      return { ...d, phases: d.phases.map((ph) => (ph.id === phaseId ? merge(ph, rest) : ph)) };
    }),
  });
  const removePhase = useMutation({
    ...serialized(trpc.proposals.removePhase.mutationOptions()),
    // Mirror the server: items in the removed phase fall to the first remaining phase.
    ...optimistic((d, v: { id: string }) => {
      const remaining = d.phases.filter((ph) => ph.id !== v.id).sort((a, b) => a.sortOrder - b.sortOrder);
      const firstId = remaining[0]?.id ?? null;
      return {
        ...d,
        phases: d.phases.filter((ph) => ph.id !== v.id),
        items: d.items.map((it) => (it.phaseId === v.id ? { ...it, phaseId: firstId } : it)),
      };
    }),
  });
  const reorder = useMutation({
    ...serialized(trpc.proposals.reorder.mutationOptions()),
    ...optimistic((d, v: { phases: { id: string; sortOrder: number }[]; items: { id: string; phaseId: string | null; sortOrder: number }[] }) => {
      const phaseOrder = new Map(v.phases.map((ph) => [ph.id, ph.sortOrder]));
      const itemOrder = new Map(v.items.map((it) => [it.id, it]));
      return {
        ...d,
        phases: d.phases.map((ph) => (phaseOrder.has(ph.id) ? { ...ph, sortOrder: phaseOrder.get(ph.id)! } : ph)),
        items: d.items.map((it) => {
          const o = itemOrder.get(it.id);
          return o ? { ...it, phaseId: o.phaseId, sortOrder: o.sortOrder } : it;
        }),
      };
    }),
  });
  const update = useMutation({
    ...trpc.proposals.update.mutationOptions(),
    ...optimistic((d, v: { id: string } & Record<string, unknown>) => {
      const { id: _id, ...rest } = v;
      return merge(d, rest);
    }),
  });
  const addDoc = useMutation({
    ...trpc.proposals.addDocument.mutationOptions(),
    ...optimistic((d, v: { proposalId: string; url: string; fileName?: string }) => ({
      ...d,
      documents: [...d.documents, { id: crypto.randomUUID(), proposalId: v.proposalId, url: v.url, fileName: v.fileName ?? null } as unknown as Data['documents'][number]],
    })),
  });
  const removeDoc = useMutation({
    ...trpc.proposals.removeDocument.mutationOptions(),
    ...optimistic((d, v: { id: string }) => ({ ...d, documents: d.documents.filter((doc) => doc.id !== v.id) })),
  });
  const send = useMutation({ ...trpc.proposals.send.mutationOptions(), onSuccess: () => { toast.success('Proposal sent'); navigate('/proposals'); }, onError: (e) => toastError(e) });
  const submitInternal = useMutation({ ...trpc.proposals.submitInternal.mutationOptions(), onSuccess: () => { toast.success('Projects created'); navigate('/projects'); }, onError: (e) => toastError(e) });
  const duplicate = useMutation({ ...trpc.proposals.duplicate.mutationOptions(), onSuccess: (copy) => { toast.success('Duplicated'); navigate(`/proposal/${copy.id}/edit`); }, onError: (e) => toastError(e) });
  const del = useMutation({ ...trpc.proposals.delete.mutationOptions(), onSuccess: () => { toast.success('Draft deleted'); navigate('/proposals'); }, onError: (e) => toastError(e) });
  const setPlan = useMutation({
    ...trpc.proposals.setPaymentPlan.mutationOptions(),
    ...optimistic((d, v: { id: string; selectedPaymentPlan: unknown }) => merge(d, { selectedPaymentPlan: v.selectedPaymentPlan })),
  });
  const createReferral = useMutation(trpc.brands.createReferral.mutationOptions());

  // Resolve a picked brand (existing or freshly-created referral) to a brandId
  // and persist it on the proposal — lets you add a brand new client inline,
  // mirroring the New Project / internal-purchase flow.
  const handlePickBrand = async (b: PickedBrand | null) => {
    if (!b || !agencyId) return;
    try {
      const brandId = b.id ?? (await createReferral.mutateAsync({ agencyId, businessName: b.businessName, email: b.email ?? undefined })).id;
      update.mutate({ id: id!, brandId });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Any in-flight edit (or background refetch) drives the top syncing bar.
  const syncing =
    q.isFetching ||
    [addItem, addPackage, updateItem, removeItem, addPhase, updatePhase, removePhase, reorder, update, addDoc, removeDoc, setPlan].some((m) => m.isPending);

  const phases = useMemo(() => ((q.data?.phases ?? []) as Phase[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [q.data]);
  const items = useMemo(() => ((q.data?.items ?? []) as Item[]).slice().sort((a, b) => a.sortOrder - b.sortOrder), [q.data]);
  const addedServiceIds = useMemo(() => new Set(items.map((i) => i.serviceId).filter(Boolean) as string[]), [items]);

  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-8 w-64" /><Skeleton className="h-96 w-full" /></div>;
  if (!q.data) return <p className="text-ink-60">Proposal not found.</p>;
  const p = q.data;
  const billable = (p as { isBillable?: boolean }).isBillable ?? true;
  // Sales/inter-agency mode: a sales agency builds a proposal spanning services
  // from multiple agencies. Items carry their source agency; only the sales
  // agency's own items are price-editable.
  const salesMode = !!(p as { createdBySalesAgencyId?: string | null }).createdBySalesAgencyId;
  const ownAgencyId = p.agencyId;

  const lastPhaseId = phases[phases.length - 1]?.id;

  const handleAddService = (s: AddServicePayload) => {
    // Services with options / add-ons must be configured first: open the detail
    // dialog and add once the buyer confirms a configuration (Flutter parity).
    const svc = s.service;
    const hasConfig =
      ((svc.options as ServiceOption[] | null)?.length ?? 0) > 0 ||
      ((svc.addons as ServiceAddon[] | null)?.length ?? 0) > 0;
    if (hasConfig) {
      setConfigTarget({ service: svc, agencyId: s.agencyId });
      return;
    }
    addItem.mutate({ id: crypto.randomUUID(), proposalId: p.id, type: 'service', serviceId: s.serviceId, agencyId: (salesMode ? s.agencyId : agencyId) ?? agencyId ?? undefined, description: s.description, amount: s.amount, isRecurring: s.isRecurring, billingCycle: s.billingCycle, upfrontFee: s.upfrontFee, serviceType: s.serviceType, phaseId: lastPhaseId });
  };

  // Add a configured service (resolved variant / options / add-ons + price) once
  // the detail dialog confirms — ports the Flutter onSelectConfiguration callback.
  const handleConfirmConfig = (config: {
    selectedVariantId?: string;
    selectedOptions: Record<string, string>;
    selectedAddons: SelectedAddon[];
  }) => {
    if (!configTarget) return;
    const svc = configTarget.service;
    const { price, upfront } = configuredPriceFor(svc, config.selectedVariantId, config.selectedAddons);
    const recurring = isWeekly(svc);
    addItem.mutate({
      id: crypto.randomUUID(),
      proposalId: p.id,
      type: 'service',
      serviceId: svc.id,
      agencyId: (salesMode ? configTarget.agencyId : agencyId) ?? agencyId ?? undefined,
      description: svc.description ?? svc.name,
      amount: price,
      isRecurring: recurring,
      billingCycle: recurring ? 'Weekly' : undefined,
      upfrontFee: upfront,
      serviceType: (svc.type ?? undefined) as AddServicePayload['serviceType'],
      selectedVariantId: config.selectedVariantId,
      selectedOptions: config.selectedOptions,
      selectedAddons: config.selectedAddons,
      phaseId: lastPhaseId,
    });
    setConfigTarget(null);
  };

  const handleAddCustom = (c: CustomItemPayload) =>
    addItem.mutate({
      id: crypto.randomUUID(),
      proposalId: p.id,
      type: 'custom',
      description: c.serviceName || c.description,
      amount: c.amount,
      quantity: c.quantity,
      isRecurring: c.isRecurring,
      billingCycle: c.billingCycle,
      upfrontFee: c.upfrontFee,
      serviceType: c.serviceType,
      deliverableFrequency: c.deliverableFrequency,
      repeatsEvery: c.repeatsEvery,
      upfrontDeliveryFee: c.upfrontDeliveryFee,
      recurringDeliveryFee: c.recurringDeliveryFee,
      upfrontProjectConfig: c.upfrontProjectConfig,
      recurringProjectConfig: c.recurringProjectConfig,
      commissions: {
        productionManager: c.productionManagerCommission,
        briefingManager: c.briefingManagerCommission,
        internalApproval: c.internalApprovalCommission,
      },
      phaseId: lastPhaseId,
    });

  const handleAddHeading = (phaseId: string) =>
    addItem.mutate({ id: crypto.randomUUID(), proposalId: p.id, type: 'heading', headingText: 'Section Heading', amount: 0, phaseId });

  // Drag-and-drop reorder: the editor hands back the full flat ordering with each
  // item's (possibly reassigned) phaseId; phase order is unchanged.
  const handleReorder = (ordered: { id: string; phaseId: string; sortOrder: number }[]) =>
    reorder.mutate({
      proposalId: p.id,
      phases: phases.map((ph, i) => ({ id: ph.id, sortOrder: i })),
      items: ordered,
    });

  const subtotals = computeSubtotals(items as BillingItem[]);
  const nonHeadingCount = items.filter((i) => i.type !== 'heading').length;

  const billingSection = (
    <BillingSidebar
      brandName={(p.brandSnapshot as { name?: string } | null)?.name ?? clients.data?.items.find((c) => c.id === p.brandId)?.businessName ?? null}
      itemCount={nonHeadingCount}
      validityDays={p.validityDays}
      subtotals={subtotals}
      items={items as BillingItem[]}
      phases={phases}
      sellingOwnServices={!salesMode}
      salesMode={salesMode}
      ownAgencyId={ownAgencyId}
      isBrandView={false}
      initialPlan={p.selectedPaymentPlan as Parameters<typeof BillingSidebar>[0]['initialPlan']}
      onPlanChange={(plan) => setPlan.mutate({ id: p.id, selectedPaymentPlan: plan })}
    />
  );

  return (
    <div>
      {/* Syncing bar — fixed to the top of the viewport while edits/refetches are in flight. */}
      <div
        className={`fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-accent/15 transition-opacity duration-200 ${syncing ? 'opacity-100' : 'opacity-0'}`}
        role="progressbar"
        aria-label="Syncing changes"
        aria-hidden={!syncing}
      >
        {syncing && <div className="pd-progress-bar" />}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <button onClick={() => navigate('/proposals')} className="flex items-center gap-1 text-sm text-ink-60 hover:text-ink-100">
          <ArrowLeft className="h-4 w-4" /> Proposals
        </button>
        <div className="flex flex-wrap items-center gap-2">
          {/* Billable vs non-billable: non-billable submits create projects
              internally instead of sending to a client (Flutter isBillable toggle). */}
          <div className="flex items-center overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] text-xs">
            <button
              className={`px-2.5 py-1.5 ${billable ? 'bg-accent text-white' : 'text-ink-60 hover:text-ink-100'}`}
              onClick={() => { if (!billable) update.mutate({ id: p.id, isBillable: true }); }}
            >Billable</button>
            <button
              className={`px-2.5 py-1.5 ${!billable ? 'bg-accent text-white' : 'text-ink-60 hover:text-ink-100'}`}
              onClick={() => { if (billable) update.mutate({ id: p.id, isBillable: false }); }}
            >Non-billable</button>
          </div>
          <Button variant="ghost" onClick={() => duplicate.mutate({ id: p.id })}><Copy className="h-4 w-4" /> Duplicate</Button>
          {p.status === 'draft' && <Button variant="ghost" onClick={async () => { if (await confirm({ title: 'Delete draft', description: 'Delete this draft? This cannot be undone.', confirmLabel: 'Delete draft', destructive: true })) del.mutate({ id: p.id }); }}><Trash2 className="h-4 w-4 text-danger" /> Delete draft</Button>}
          {billable ? (
            <Button variant="accent" disabled={send.isPending || !p.brandId || nonHeadingCount === 0} onClick={() => send.mutate({ id: p.id })}><Send className="h-4 w-4" /> Send</Button>
          ) : (
            <Button variant="accent" disabled={submitInternal.isPending || nonHeadingCount === 0} onClick={async () => { if (await confirm({ title: 'Create projects internally', description: 'Create projects internally for this non-billable proposal? No proposal will be sent to a client.', confirmLabel: 'Create projects' })) submitInternal.mutate({ id: p.id }); }}><Send className="h-4 w-4" /> Create projects</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_320px]">
        {/* Left: catalog */}
        <div className="min-w-0 lg:border-r lg:border-[color:var(--color-border-hairline)] lg:pr-4">
          {agencyId && (
            <CatalogPanel
              agencyId={agencyId}
              salesMode={salesMode}
              addedServiceIds={addedServiceIds}
              onAddService={handleAddService}
              onAddPackage={(packageId) => addPackage.mutate({ proposalId: p.id, packageId, phaseId: lastPhaseId })}
              onAddCustom={() => setCustomOpen(true)}
            />
          )}
        </div>

        {/* Middle: client details + phases & items + terms */}
        <div className="min-w-0 space-y-6">
          {p.status === 'changeRequested' && p.changeRequestNote && (
            <div className="rounded-[var(--radius-sm)] border border-warn/35 bg-warn/10 p-3 text-sm text-ink-80">
              <div className="mb-1 font-semibold text-warn">Changes requested by client</div>
              {p.changeRequestNote}
            </div>
          )}

          <ClientDetailsSection proposal={p} clients={(clients.data?.items ?? []) as Client[]} agencyId={agencyId ?? undefined} emailRequired={billable} onSave={(v) => update.mutate({ id: p.id, ...v })} onPickBrand={handlePickBrand} />

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4" /> Services & Line Items</CardTitle>
              <Button size="sm" variant="outline" onClick={() => addPhase.mutate({ id: crypto.randomUUID(), proposalId: p.id })}><Plus className="h-4 w-4" /> Phase</Button>
            </CardHeader>
            <CardContent>
              <PhasesEditor
                phases={phases}
                items={items}
                salesMode={salesMode}
                ownAgencyId={ownAgencyId}
                onRenamePhase={(phaseId, name) => updatePhase.mutate({ id: phaseId, name })}
                onRemovePhase={(phaseId) => removePhase.mutate({ id: phaseId })}
                onSetStartDelay={(phaseId, startDelayDays) => updatePhase.mutate({ id: phaseId, startDelayDays })}
                onAddHeading={(phaseId) => handleAddHeading(phaseId)}
                onUpdateItem={(itemId, v) => updateItem.mutate({ id: itemId, ...v })}
                onRemoveItem={(itemId) => removeItem.mutate({ id: itemId })}
                onReorder={handleReorder}
              />
            </CardContent>
          </Card>

          <TermsSection proposal={p} onSave={(v) => update.mutate({ id: p.id, ...v })} />
        </div>

        {/* Right: documents + billing */}
        <div className="min-w-0 space-y-6 lg:border-l lg:border-[color:var(--color-border-hairline)] lg:pl-4">
          <DocumentsSection
            documents={(p.documents ?? []) as Doc[]}
            onAdd={(url, fileName) => addDoc.mutate({ proposalId: p.id, url, fileName })}
            onRemove={(docId) => removeDoc.mutate({ id: docId })}
          />
          {billingSection}
        </div>
      </div>

      <CustomItemDialog open={customOpen} onOpenChange={setCustomOpen} onSubmit={handleAddCustom} agencyId={agencyId ?? undefined} />

      {/* Configuration dialog for services with options / add-ons. */}
      {configTarget && (
        <ServiceDetailDialog
          service={configTarget.service}
          open
          onOpenChange={(o) => !o && setConfigTarget(null)}
          purchasable={false}
          onSelectConfiguration={({ selectedVariantId, selectedOptions, selectedAddons }) =>
            handleConfirmConfig({ selectedVariantId, selectedOptions, selectedAddons })
          }
        />
      )}
    </div>
  );
}

type Client = { id: string; businessName: string; email?: string | null; logoUrl?: string | null };
type Doc = { id: string; url: string; fileName: string | null };

function ClientDetailsSection({ proposal, clients, agencyId, emailRequired, onSave, onPickBrand }: {
  proposal: { id: string; brandId: string | null; title: string | null; description: string | null; validityDays: number | null; brandSnapshot?: { name?: string } | null };
  clients: Client[]; agencyId?: string; emailRequired?: boolean;
  onSave: (v: Record<string, unknown>) => void; onPickBrand: (b: PickedBrand | null) => void;
}) {
  const [title, setTitle] = useState(proposal.title ?? '');
  const [description, setDescription] = useState(proposal.description ?? '');
  const [validityDays, setValidityDays] = useState(String(proposal.validityDays ?? 30));

  // Reflect the proposal's current brand into the picker; updates flow back
  // through onPickBrand (which resolves/creates the brand and persists brandId).
  const currentBrand = useMemo<PickedBrand | null>(() => {
    if (!proposal.brandId) return null;
    const c = clients.find((x) => x.id === proposal.brandId);
    return { id: proposal.brandId, businessName: c?.businessName ?? proposal.brandSnapshot?.name ?? 'Selected client', email: c?.email ?? null };
  }, [proposal.brandId, proposal.brandSnapshot, clients]);
  const [picked, setPicked] = useState<PickedBrand | null>(currentBrand);
  useEffect(() => setPicked(currentBrand), [currentBrand]);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Client & Details</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <Label>Client</Label>
          {agencyId ? (
            <BrandSelection agencyId={agencyId} brand={picked} emailRequired={!!emailRequired} onChange={(b) => { setPicked(b); if (b) onPickBrand(b); }} />
          ) : (
            <AvatarSelect
              value={proposal.brandId ?? ''}
              onChange={(id) => onSave({ brandId: id || undefined })}
              placeholder="Select a client…"
              square
              options={clients.map((c) => ({ id: c.id, name: c.businessName, imageUrl: c.logoUrl }))}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => onSave({ title })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} onBlur={() => onSave({ description })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Valid for (days)</Label>
          <Input type="number" value={validityDays} onChange={(e) => setValidityDays(e.target.value)} onBlur={() => onSave({ validityDays: Number(validityDays) || 30 })} />
        </div>
      </CardContent>
    </Card>
  );
}

function TermsSection({ proposal, onSave }: { proposal: { termsAndConditions: string | null; clientNotes: string | null }; onSave: (v: Record<string, unknown>) => void }) {
  const [terms, setTerms] = useState(proposal.termsAndConditions ?? '');
  const [notes, setNotes] = useState(proposal.clientNotes ?? '');
  return (
    <Card>
      <CardHeader><CardTitle>Terms & Notes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col gap-1.5">
          <Label>Terms & Conditions</Label>
          <Textarea className="min-h-[160px]" value={terms} onChange={(e) => setTerms(e.target.value)} onBlur={() => onSave({ termsAndConditions: terms })} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Notes for client</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => onSave({ clientNotes: notes })} />
        </div>
      </CardContent>
    </Card>
  );
}

function DocumentsSection({ documents, onAdd, onRemove }: { documents: Doc[]; onAdd: (url: string, fileName?: string) => void; onRemove: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const reset = () => { setUrl(''); setFileName(''); };
  // Commit with the typed name (falling back to none → server keeps the URL),
  // so the buyer's chosen attachment name is what's saved & displayed.
  const commit = () => {
    if (!url) return;
    onAdd(url, fileName.trim() || undefined);
    reset();
    setOpen(false);
  };
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Upload className="h-4 w-4" /> Attachments</CardTitle>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Plus className="h-4 w-4" /></Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {documents.length === 0 && <p className="text-sm text-ink-40">No attachments.</p>}
        {documents.map((d) => (
          <div key={d.id} className="flex items-center gap-2 rounded-[var(--radius-sm)] bg-inset/40 px-2.5 py-1.5 text-sm">
            <FileText className="h-4 w-4 text-ink-40" />
            <a href={d.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-ink-80 hover:text-ink-100">{d.fileName ?? d.url}</a>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => onRemove(d.id)}><Trash2 className="h-3.5 w-3.5 text-danger" /></Button>
          </div>
        ))}
      </CardContent>
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add attachment</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {/* Upload stages the file (and pre-fills the name) rather than adding it
                outright, so the buyer can rename it before committing — the typed
                name, not the raw upload name, is what gets saved. */}
            <UploadButton
              bucket={StorageBucket.Uploads}
              pathPrefix="proposals/documents"
              label="Upload a file"
              onUploaded={(u, name) => { setUrl(u); setFileName((prev) => prev || name); }}
            />
            <div className="text-center text-xs text-ink-40">or paste a URL</div>
            <div className="flex flex-col gap-1.5"><Label>File URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
            <div className="flex flex-col gap-1.5"><Label>File name</Label><Input value={fileName} onChange={(e) => setFileName(e.target.value)} placeholder="proposal.pdf" /></div>
          </div>
          <DialogFooter>
            <Button variant="accent" disabled={!url} onClick={commit}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
