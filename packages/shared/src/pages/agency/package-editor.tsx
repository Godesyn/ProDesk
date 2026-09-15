import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { SectionHeader, SettingsIntegrationsSection, ValuePropositionChips, MediaAssetsSection, type ServiceStaff } from '../../components/service-form';
import { BillingMiniCard, BillingRow } from '../proposals/ui';
import { computePayInFull, computeSubtotals, type BillingItem } from '../proposals/billing';
import { asMaybePrice } from '../marketplace/pricing';
import { measureImageAspectRatio } from '../marketplace/media';
import { toNumberInput } from '../../lib/utils';
import type { MarketplaceService } from '../marketplace/types';
import { Field } from './form-bits';
import { PackageServicesSection } from './package-services-section';
import { PackageMeetingConfigSection } from './package-meeting-config';
import { hydrateItem, inferAspectRatioFromVideoUrl, type PackageItem } from './package-shared';

const isValidUrl = (s: string): boolean => {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
};

/**
 * New/Edit Package dialog — a 1:1 port of the Flutter `AddPackageDialog`. Bundles
 * catalog services into a single offering: core details, value proposition,
 * media, a services-&-line-items catalog, settings/integrations (with the sales
 * meeting-staff editor), and a live billing summary sidebar. Reuses the shared
 * service-form sections + proposal billing math. Persists via
 * trpc.packages.create / update; archive on delete.
 */
export function PackageEditorDialog({ agencyId, initial, onDone }: { agencyId: string; initial?: any; onDone: () => void }) {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const isEdit = !!initial?.id;

  // Core / media / settings.
  const [name, setName] = useState<string>(initial?.name ?? '');
  const [description, setDescription] = useState<string>(initial?.description ?? '');
  const [imageUrl, setImageUrl] = useState<string>(initial?.imageUrl ?? '');
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(initial?.imageAspectRatio ?? null);
  const [videoUrl, setVideoUrl] = useState<string>(initial?.videoUrl ?? '');
  const [disciplines, setDisciplines] = useState<string[]>((initial?.disciplines ?? []) as string[]);
  const [allowBuyNow, setAllowBuyNow] = useState<boolean>(initial?.allowBuyNow ?? true);
  const [allowSalesProposal, setAllowSalesProposal] = useState<boolean>(initial?.allowSalesProposal ?? true);
  const [allowBookMeeting, setAllowBookMeeting] = useState<boolean>(initial?.allowBookMeeting ?? false);
  const [isActive, setIsActive] = useState<boolean>(initial?.isActive ?? true);

  // Staff (commission map keyed by userId, kept as strings for the inputs).
  const [assignedStaff, setAssignedStaff] = useState<ServiceStaff[]>((initial?.assignedStaff ?? []) as ServiceStaff[]);
  const [commissions, setCommissions] = useState<Record<string, string>>(() => {
    const src = (initial?.salesPersonCommissions ?? {}) as Record<string, number>;
    return Object.fromEntries(Object.entries(src).map(([k, v]) => [k, toNumberInput(v)]));
  });

  // Catalog services (full rows; powers the catalog + item hydration).
  const services = useQuery({
    ...trpc.services.list.queryOptions({ agencyId, limit: 500, offset: 0, includeInactive: true }),
    enabled: !!agencyId,
  });
  const serviceRows = (services.data?.items ?? []) as unknown as MarketplaceService[];

  // Agency members for the sales-meeting staff picker.
  const members = useQuery({ ...trpc.agencies.members.queryOptions({ agencyId }), enabled: !!agencyId });
  const memberList = (members.data ?? []).map((m) => ({ id: m.id, name: m.name, email: m.email, profileUrl: m.profileUrl, salesPersonCommission: m.salesPersonCommission }));

  // Included items — new-builder rows carry every field; legacy rows are
  // back-filled from the resolved services once the catalog loads.
  const initialItemsRaw = useMemo(() => (initial?.items ?? []) as any[], [initial]);
  const [items, setItems] = useState<PackageItem[]>(() =>
    initialItemsRaw.map((r, i) => hydrateItem(r, new Map(), i)).filter((x): x is PackageItem => !!x),
  );
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !isEdit || services.isLoading) return;
    const byId = new Map(serviceRows.map((s) => [s.id, s]));
    setItems(initialItemsRaw.map((r, i) => hydrateItem(r, byId, i)).filter((x): x is PackageItem => !!x));
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services.isLoading]);

  const [showErrors, setShowErrors] = useState(false);

  const create = useMutation({
    ...trpc.packages.create.mutationOptions(),
    onSuccess: () => { toast.success('Package created'); onDone(); },
    onError: (e) => toastError(e),
  });
  const update = useMutation({
    ...trpc.packages.update.mutationOptions(),
    onSuccess: () => { toast.success('Package updated'); onDone(); },
    onError: (e) => toastError(e),
  });
  const archive = useMutation({
    ...trpc.packages.archive.mutationOptions(),
    onSuccess: () => { toast.success('Package deleted successfully!'); onDone(); },
    onError: (e) => toastError(e),
  });
  const pending = create.isPending || update.isPending || archive.isPending;

  /* ── Item ops ──────────────────────────────────────────────────────────── */
  const addItem = (item: PackageItem) => setItems((prev) => [...prev, item]);
  const removeItem = (id: string) =>
    setItems((prev) => prev.filter((i) => i.id !== id).map((i, idx) => ({ ...i, sortOrder: idx })));
  const reorderItems = (orderedIds: string[]) =>
    setItems((prev) => {
      const map = new Map(prev.map((i) => [i.id, i]));
      return orderedIds.map((id, idx) => ({ ...map.get(id)!, sortOrder: idx }));
    });

  /* ── Staff ops ─────────────────────────────────────────────────────────── */
  const addStaff = (config: ServiceStaff) => {
    setAssignedStaff((prev) => [...prev, config]);
    const def = memberList.find((m) => m.id === config.userId)?.salesPersonCommission ?? 0;
    setCommissions((prev) => ({ ...prev, [config.userId]: prev[config.userId] ?? toNumberInput(def) }));
  };
  const editStaff = (index: number, config: ServiceStaff) =>
    setAssignedStaff((prev) => prev.map((s, i) => (i === index ? config : s)));
  const removeStaff = (index: number) =>
    setAssignedStaff((prev) => prev.filter((_, i) => i !== index));
  const setCommission = (userId: string, value: string) =>
    setCommissions((prev) => ({ ...prev, [userId]: value }));

  /* ── Billing summary ───────────────────────────────────────────────────── */
  const subtotals = useMemo(() => {
    const billing: BillingItem[] = items.map((i) => ({
      type: 'service',
      amount: i.amount,
      quantity: i.quantity,
      upfrontFee: i.upfrontFee ?? 0,
      isRecurring: i.isRecurring,
    }));
    return computeSubtotals(billing);
  }, [items]);

  /* ── Save / delete ─────────────────────────────────────────────────────── */
  function payload() {
    const validVideo = videoUrl.trim() && isValidUrl(videoUrl.trim()) ? videoUrl.trim() : undefined;
    const validImage = imageUrl.trim() && isValidUrl(imageUrl.trim()) ? imageUrl.trim() : undefined;
    // Mirror Flutter _submit: fall back to a video-derived aspect ratio when the
    // cover image hasn't supplied one.
    const aspect = imageAspectRatio ?? inferAspectRatioFromVideoUrl(videoUrl);
    return {
      name: name.trim(),
      description: description.trim() || undefined,
      imageUrl: validImage,
      imageAspectRatio: aspect ?? undefined,
      videoUrl: validVideo,
      disciplines,
      isActive,
      allowBuyNow,
      allowBookMeeting,
      allowSalesProposal,
      items: items as any,
      assignedStaff: assignedStaff.map((s) => ({
        userId: s.userId,
        name: s.name,
        workingDays: s.workingDays,
        startTime: s.startTime,
        endTime: s.endTime,
        timezone: s.timezone,
      })) as any,
      salesPersonCommissions: Object.fromEntries(
        assignedStaff.map((s) => [s.userId, Number(commissions[s.userId] ?? 0) || 0]),
      ),
    };
  }

  /** Per-staff commission validation — ports `AppValidator.positivePercentage`. */
  function commissionError(userId: string): string | null {
    const raw = (commissions[userId] ?? '').trim();
    if (!raw) return 'Commission is required';
    const c = Number(raw);
    if (Number.isNaN(c)) return 'Please enter a valid number';
    if (c < 0) return 'Please enter a positive number';
    if (c > 100) return 'Please enter a number less than 100';
    return null;
  }

  const hasFieldErrors =
    !name.trim() ||
    !description.trim() ||
    (allowBookMeeting && assignedStaff.some((s) => commissionError(s.userId)));

  function save() {
    setShowErrors(true);
    // Field-level validation (inline), mirrors Flutter Form.validate(): name +
    // description required, and (when Book Meeting is on, so the fields are
    // mounted) each staff commission must pass the positive-percentage check.
    if (hasFieldErrors) return;
    // Submit-time checks that toast in Flutter (add_package_dialog _submit), in order.
    if (items.length === 0) return void toast.warning('Add at least one component service to the package');
    if (allowBookMeeting && assignedStaff.length === 0)
      return void toast.error('Please assign at least one staff member for sales meetings');
    if (isEdit) update.mutate({ id: initial.id, ...payload() } as any);
    else create.mutate({ agencyId, ...payload() } as any);
  }

  async function del() {
    if (!isEdit) return;
    const ok = await confirm({
      title: 'Delete Package',
      description: 'Are you sure you want to delete this package? It will be hidden from the marketplace and any active offers.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    archive.mutate({ id: initial.id });
  }

  return (
    <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-[1400px] flex-col overflow-hidden p-0">
      <DialogHeader className="border-b border-[color:var(--color-border-hairline)] px-6 py-4">
        <DialogTitle>{isEdit ? 'Edit Package' : 'Create Package'}</DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ── LEFT: form ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-1 flex-col gap-8">
            <div className="grid grid-cols-1 gap-x-12 gap-y-8 md:grid-cols-2">
              <div>
                <SectionHeader title="Core Details" />
                <div className="flex flex-col gap-4">
                  <Field label="" error={showErrors && !name.trim() ? 'Package name is required' : null}>
                    <Input value={name} placeholder="e.g. Brand Launch Bundle" onChange={(e) => setName(e.target.value)} />
                  </Field>
                  <Field label="Description" error={showErrors && !description.trim() ? 'Description is required' : null}>
                    <textarea
                      className="min-h-[88px] rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40"
                      value={description}
                      placeholder="Describe what is included in this package..."
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </Field>
                </div>
              </div>
              <ValuePropositionChips benefits={disciplines} onChange={setDisciplines} />
            </div>

            <MediaAssetsSection
              pathPrefix={`packages/${agencyId}`}
              imageUrl={imageUrl}
              videoUrl={videoUrl}
              onImage={(url) => {
                setImageUrl(url);
                // Record the cover's aspect ratio so marketplace tiles size to it
                // (Flutter records imageAspectRatio at upload).
                void measureImageAspectRatio(url).then((ar) => setImageAspectRatio(ar));
              }}
              onRemoveImage={() => { setImageUrl(''); setImageAspectRatio(null); }}
              onVideoUrl={setVideoUrl}
            />

            <PackageServicesSection
              agencyId={agencyId}
              services={serviceRows}
              items={items}
              onAdd={addItem}
              onRemove={removeItem}
              onReorder={reorderItems}
            />

            <SettingsIntegrationsSection
              allowBuyNow={allowBuyNow}
              allowSalesProposal={allowSalesProposal}
              allowBookMeeting={allowBookMeeting}
              isActive={isActive}
              onAllowBuyNow={setAllowBuyNow}
              onAllowSalesProposal={setAllowSalesProposal}
              onAllowBookMeeting={setAllowBookMeeting}
              onIsActive={setIsActive}
              meetingConfig={
                <PackageMeetingConfigSection
                  members={memberList}
                  assignedStaff={assignedStaff}
                  commissions={commissions}
                  commissionError={showErrors ? commissionError : undefined}
                  onAddStaff={addStaff}
                  onEditStaff={editStaff}
                  onRemoveStaff={removeStaff}
                  onCommissionChange={setCommission}
                />
              }
            />
          </div>

          {/* ── RIGHT: billing summary ─────────────────────────────────── */}
          <div className="lg:w-[340px] lg:shrink-0">
            <PackageBillingSidebar
              oneOff={subtotals.oneOffSubtotal}
              recurringUpfront={subtotals.recurringUpfrontTotal}
              recurringWeekly={subtotals.recurringWeeklyTotal}
              itemCount={items.length}
            />
          </div>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-t border-[color:var(--color-border-hairline)] px-6 py-3">
        <div className="flex items-center gap-3">
          {isEdit && (
            <>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
                <span className={`h-2 w-2 rounded-full border border-ink-100 ${isActive ? 'bg-accent' : 'bg-ink-40'}`} />
                {isActive ? 'Active Package' : 'Inactive Package'}
              </span>
              <Button variant="danger" size="sm" onClick={del} disabled={pending}>Delete</Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showErrors && hasFieldErrors && <span className="text-xs text-danger">Please fix the highlighted fields.</span>}
          <Button variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
          <Button variant="accent" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Update Package' : 'Create Package'}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}

/**
 * Package billing summary — ports the `BillingSummarySection` the Flutter package
 * dialog renders (no payment plans, no agency-earnings card): overview, one-off
 * subtotal, recurring breakdown, and the Pay-in-Full total.
 */
function PackageBillingSidebar({
  oneOff,
  recurringUpfront,
  recurringWeekly,
  itemCount,
}: {
  oneOff: number;
  recurringUpfront: number;
  recurringWeekly: number;
  itemCount: number;
}) {
  const hasRecurring = recurringUpfront > 0 || recurringWeekly > 0;
  const breakdown = computePayInFull(oneOff, recurringUpfront, recurringWeekly);

  return (
    <div className="space-y-3">
      <h3 className="text-[15px] font-bold text-ink-100">Billing Summary</h3>

      <BillingMiniCard>
        <BillingRow label="Client" value="—" />
        <BillingRow label="Items" value={String(itemCount)} />
        <BillingRow label="Valid for" value="30 days" />
      </BillingMiniCard>

      <BillingMiniCard label="One-off items" dimmed={oneOff === 0}>
        <BillingRow label="Upfront" value={asMaybePrice(oneOff)} strong />
      </BillingMiniCard>

      {hasRecurring && (
        <BillingMiniCard label="Recurring">
          {recurringUpfront > 0 && <BillingRow label="Setup (once)" value={asMaybePrice(recurringUpfront)} />}
          {recurringWeekly > 0 && <BillingRow label="Weekly" value={asMaybePrice(recurringWeekly)} />}
        </BillingMiniCard>
      )}

      <div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-60">Payment Options</div>
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="accent">Pay in Full</Button>
        </div>
      </div>

      {itemCount > 0 && (
        <BillingMiniCard label={breakdown.planLabel}>
          <BillingRow label="Upfront" value={asMaybePrice(breakdown.upfront)} strong />
          {breakdown.weeklyAfter > 0 && <BillingRow label="Weekly after" value={asMaybePrice(breakdown.weeklyAfter)} />}
        </BillingMiniCard>
      )}
    </div>
  );
}
