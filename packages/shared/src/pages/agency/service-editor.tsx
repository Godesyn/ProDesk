import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Field, Select, FormSection } from './form-bits';
import { measureImageAspectRatio } from '../marketplace/media';
import { toNumberInput } from '../../lib/utils';
import {
  SERVICE_TYPES,
  ADD_SERVICE_TYPES,
  SERVICE_TYPE_DISPLAY_NAME,
  isBillingCycleWeekly,
  hasDeliverableCycle,
  hasShipping,
  isDigital,
  type ServiceType,
} from '@server/lib/service-type';
import { type DeliverableFrequency } from '@server/lib/deliverable-frequency';
import {
  PricingSection,
  DeliveryFeeSection,
  CommissionsSection,
  TaskSection,
  ValuePropositionChips,
  ClassificationSelect,
  CustomFieldBuilder,
  VariantsEditor,
  AddonsEditor,
  MediaAssetsSection,
  SettingsIntegrationsSection,
  DigitalFileAssetSection,
  emptyTaskState,
  validatePricing,
  validateDeliveryFee,
  validateCommissions,
  validateTask,
  serviceBudgetValidator,
  maxBudgetPercentage,
  commissionCapError,
  hasErrors,
  type TaskState,
  type ServiceOption,
  type ServiceVariant,
  type ServiceAddon,
  type ServiceStaff,
  type CustomField,
  type ServiceProjectConfig,
} from '../../components/service-form';

/* ── Draft model ──────────────────────────────────────────────────────────── */

export interface ServiceDraft {
  id?: string;
  name: string;
  description: string;
  type: ServiceType;
  // Pricing.
  price: string;
  upfrontFee: string;
  recurringFee: string;
  minimumTerm: string;
  // Delivery.
  upfrontDeliveryFee: string;
  recurringDeliveryFee: string;
  // Value proposition (Flutter reuses `disciplines`).
  disciplines: string[];
  // Classification.
  stage: string;
  subStage: string;
  // Media.
  imageUrl: string;
  imageAspectRatio: number | null;
  videoUrl: string;
  // Digital product.
  digitalProductFileUrl: string;
  digitalProductFileName: string;
  // Rich collections.
  options: ServiceOption[];
  variants: ServiceVariant[];
  addons: ServiceAddon[];
  customFields: CustomField[];
  assignedStaff: ServiceStaff[];
  // Tasks.
  selectedFrequency: DeliverableFrequency | '';
  upfrontTask: TaskState;
  recurringTask: TaskState;
  // Commissions.
  productionManagerCommission: string;
  briefingManagerCommission: string;
  internalApprovalCommission: string;
  // Flags.
  isActive: boolean;
  allowBuyNow: boolean;
  allowBookMeeting: boolean;
  allowSalesProposal: boolean;
}

export function emptyDraft(): ServiceDraft {
  return {
    name: '', description: '', type: 'oneOffService',
    price: '', upfrontFee: '', recurringFee: '', minimumTerm: '0',
    upfrontDeliveryFee: '', recurringDeliveryFee: '',
    disciplines: [], stage: '', subStage: '',
    imageUrl: '', imageAspectRatio: null, videoUrl: '',
    digitalProductFileUrl: '', digitalProductFileName: '',
    options: [], variants: [], addons: [], customFields: [], assignedStaff: [],
    selectedFrequency: '', upfrontTask: emptyTaskState(), recurringTask: { ...emptyTaskState(), repeatsEvery: '1' },
    productionManagerCommission: '', briefingManagerCommission: '', internalApprovalCommission: '',
    isActive: true, allowBuyNow: true, allowBookMeeting: false, allowSalesProposal: true,
  };
}

const numStr = (v: unknown) => toNumberInput(v as string | number | null | undefined);

function taskFromConfig(c: any): TaskState {
  const t = emptyTaskState();
  if (!c) return t;
  const isPct = c.contractorDefaultBudgetInPercentage != null;
  return {
    taskName: c.taskName ?? '',
    projectDuration: numStr(c.projectDurationDays),
    contractorBudget: numStr(isPct ? c.contractorDefaultBudgetInPercentage : c.contractorDefaultBudget),
    budgetIsPercentage: isPct,
    estimatedDuration: numStr(c.estimatedContractorDurationInHours),
    repeatsEvery: '',
  };
}

/** Map a stored service row into an editable draft. */
export function draftFromService(s: any): ServiceDraft {
  // Migrate the legacy 4-value type into a canonical ServiceType if needed.
  const rawType = s.type as string;
  const type: ServiceType = (SERVICE_TYPES as readonly string[]).includes(rawType)
    ? (rawType as ServiceType)
    : rawType === 'recurring'
      ? 'recurringService'
      : rawType === 'digital'
        ? 'digitalProduct'
        : 'oneOffService';

  const recurringTask = taskFromConfig(s.recurringProjectConfig);
  recurringTask.repeatsEvery = numStr(s.repeatsEvery) || '1';

  return {
    ...emptyDraft(),
    id: s.id,
    name: s.name ?? '',
    description: s.description ?? '',
    type,
    price: numStr(s.price),
    upfrontFee: numStr(s.upfrontFee),
    recurringFee: numStr(s.recurringFee),
    minimumTerm: numStr(s.recurringProjectConfig?.minimumTermBeforeCancellation) || '0',
    upfrontDeliveryFee: numStr(s.upfrontDeliveryFee),
    recurringDeliveryFee: numStr(s.recurringDeliveryFee),
    disciplines: s.disciplines ?? [],
    stage: s.stage ?? '',
    subStage: s.subStage ?? '',
    imageUrl: s.imageUrl ?? '',
    imageAspectRatio: s.imageAspectRatio ?? null,
    videoUrl: s.videoUrl ?? '',
    digitalProductFileUrl: s.digitalProductFileUrl ?? '',
    digitalProductFileName: s.digitalProductFileName ?? '',
    options: (s.options ?? []) as ServiceOption[],
    variants: (s.variants ?? []) as ServiceVariant[],
    addons: (s.addons ?? []) as ServiceAddon[],
    customFields: (s.customFields ?? []) as CustomField[],
    assignedStaff: (s.assignedStaff ?? []) as ServiceStaff[],
    selectedFrequency: (s.deliverableFrequency ?? '') as DeliverableFrequency | '',
    upfrontTask: taskFromConfig(s.upfrontProjectConfig),
    recurringTask,
    productionManagerCommission: numStr(s.productionManagerCommission),
    briefingManagerCommission: numStr(s.briefingManagerCommission),
    internalApprovalCommission: numStr(s.internalApprovalCommission),
    isActive: s.isActive ?? true,
    allowBuyNow: s.allowBuyNow ?? true,
    allowBookMeeting: s.allowBookMeeting ?? false,
    allowSalesProposal: s.allowSalesProposal ?? true,
  };
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const numOrUndef = (s: string) => (s.trim() === '' ? undefined : Number(s));
const numOrZero = (s: string) => (s.trim() === '' ? 0 : Number(s));

function buildProjectConfig(t: TaskState, minimumTerm?: string): ServiceProjectConfig {
  const cfg: ServiceProjectConfig = {
    taskName: t.taskName.trim() || undefined,
    projectDurationDays: t.projectDuration.trim() ? Number(t.projectDuration) : undefined,
    estimatedContractorDurationInHours: t.estimatedDuration.trim() ? Number(t.estimatedDuration) : undefined,
  };
  if (t.contractorBudget.trim()) {
    if (t.budgetIsPercentage) cfg.contractorDefaultBudgetInPercentage = Number(t.contractorBudget);
    else cfg.contractorDefaultBudget = Number(t.contractorBudget);
  }
  if (minimumTerm != null && minimumTerm.trim()) cfg.minimumTermBeforeCancellation = Number(minimumTerm);
  return cfg;
}

/**
 * Brand-variant task derivation: the (hidden) upfront/recurring task name mirrors
 * the service name and the contractor budget is pinned to $0 — brands don't set a
 * contractor budget when publishing through their derived agency.
 */
function brandTask(t: TaskState, serviceName: string): TaskState {
  return { ...t, taskName: serviceName.trim(), contractorBudget: '0', budgetIsPercentage: false };
}

const isValidVideoUrl = (url: string): boolean => {
  try {
    new URL(url);
  } catch {
    return false;
  }
  return /youtube\.com|youtu\.be|firebasestorage\.googleapis\.com|supabase/.test(url);
};

/* ── Dialog ───────────────────────────────────────────────────────────────── */

/**
 * New/Edit Service dialog — a 1:1 port of the Flutter `add_service_dialog` flow.
 * Two-column layout (stacked on narrow); see the service-form/* components for
 * each section. Persists via trpc.services.create / update; archive on delete.
 */
/**
 * Dialog variant:
 *   'agency' — the full agency catalog editor (all sections).
 *   'brand'  — the trimmed editor a brand uses to publish a service through its
 *              derived "shadow" agency (dashboard Products & Services → Services).
 *              Only Cover image + Core details + Pricing + Delivery (shipped
 *              types) + Classification show;
 *              Settings/Integrations are forced off (no Buy Now / Book Meeting /
 *              cross-agency selling / marketplace visibility), the upfront +
 *              recurring task names mirror the service name with a $0 contractor
 *              budget, and commissions are taken from the agency defaults.
 */
export type ServiceEditorVariant = 'agency' | 'brand';

export function ServiceEditorDialog({ agencyId, initial, onDone, variant = 'agency' }: { agencyId: string; initial?: ServiceDraft; onDone: () => void; variant?: ServiceEditorVariant }) {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const brand = variant === 'brand';
  const [d, setD] = useState<ServiceDraft>(() => {
    const base = initial ?? emptyDraft();
    // Brand-published services never expose the storefront/integration toggles;
    // pin them off up front so the (hidden) Settings section can't leak a default.
    return brand
      ? { ...base, isActive: false, allowBuyNow: false, allowBookMeeting: false, allowSalesProposal: false }
      : base;
  });
  const isEdit = !!d.id;

  // Owner + active staff for the meeting/staff picker. The brand variant hides the
  // staff picker entirely (and a brand owner isn't agency staff), so skip the call.
  const members = useQuery({ ...trpc.agencies.members.queryOptions({ agencyId }), enabled: !!agencyId && !brand });

  // Agency commission defaults + global cap (mirrors Flutter
  // ServiceFormControllers.from(agency:) seed + the commission-cap check).
  const commissionDefaults = useQuery({ ...trpc.agencies.commissionDefaults.queryOptions({ agencyId }), enabled: !!agencyId });

  const create = useMutation({
    ...trpc.services.create.mutationOptions(),
    onSuccess: () => { toast.success('Service created successfully!'); onDone(); },
    onError: (e) => toastError(e),
  });
  const update = useMutation({
    ...trpc.services.update.mutationOptions(),
    onSuccess: () => { toast.success('Service updated successfully!'); onDone(); },
    onError: (e) => toastError(e),
  });
  const archive = useMutation({
    ...trpc.services.archive.mutationOptions(),
    onSuccess: () => { toast.success('Service deleted successfully!'); onDone(); },
    onError: (e) => toastError(e),
  });
  const pending = create.isPending || update.isPending || archive.isPending;

  function set<K extends keyof ServiceDraft>(k: K, v: ServiceDraft[K]) {
    setD((p) => ({ ...p, [k]: v }));
  }

  const recurringBilling = isBillingCycleWeekly(d.type);
  const digital = isDigital(d.type);
  const basePrice = numOrZero(d.price);
  const baseUpfrontFee = numOrZero(d.upfrontFee);
  const baseRecurringFee = numOrZero(d.recurringFee);

  // Seed commissions from the agency defaults for a new service (Flutter
  // ServiceFormControllers.from(agency:)). Only when not editing and untouched.
  useEffect(() => {
    if (isEdit) return;
    const cd = commissionDefaults.data;
    if (!cd) return;
    setD((p) =>
      p.productionManagerCommission || p.briefingManagerCommission || p.internalApprovalCommission
        ? p
        : {
            ...p,
            productionManagerCommission: toNumberInput(cd.productionManagerCommission),
            briefingManagerCommission: toNumberInput(cd.briefingManagerCommission),
            internalApprovalCommission: toNumberInput(cd.internalApprovalCommission),
          },
    );
  }, [commissionDefaults.data, isEdit]);

  // Errors are computed live but only surfaced after the first submit attempt
  // (mirrors Flutter's Form.validate() gating). Field errors render inline; the
  // remaining submit-time checks (media/digital/staff/cap/price-floor) toast.
  const [showErrors, setShowErrors] = useState(false);
  const videoError = useMemo(
    () => (d.videoUrl.trim() && !isValidVideoUrl(d.videoUrl.trim()) ? 'Must be a valid YouTube URL' : null),
    [d.videoUrl],
  );

  /** Per-field validation, ported 1:1 from the Flutter add_service form (boxed). */
  const v = useMemo(() => {
    const budgetValidatorFor = (isRecurring: boolean, isPercentage: boolean) => (val: string) =>
      serviceBudgetValidator(val, {
        isPercentage,
        isRecurring,
        isBillingRecurring: recurringBilling,
        price: d.price,
        upfrontFee: d.upfrontFee,
        recurringFee: d.recurringFee,
        maxPercentage: maxBudgetPercentage(d.productionManagerCommission, d.briefingManagerCommission, d.internalApprovalCommission),
        variants: d.variants,
      });
    return {
      name: !d.name.trim() ? 'Service name is required' : null,
      description: !d.description.trim() ? 'Description is required' : null,
      subStage: !d.subStage ? 'Sub Stage is required' : null,
      pricing: validatePricing({
        type: d.type,
        price: d.price,
        upfrontFee: d.upfrontFee,
        recurringFee: d.recurringFee,
        minimumTerm: d.minimumTerm,
        includeMinimumTerm: true,
        boxed: true,
      }),
      delivery: hasShipping(d.type)
        ? validateDeliveryFee({ type: d.type, upfrontDeliveryFee: d.upfrontDeliveryFee, recurringDeliveryFee: d.recurringDeliveryFee })
        : {},
      // Commissions and project tasks are hidden in the brand variant (commissions
      // come from the agency defaults; task names/budgets are derived in payload()),
      // so there's nothing for the user to fix — skip their validation.
      commissions: brand || digital
        ? {}
        : validateCommissions({
            production: d.productionManagerCommission,
            briefing: d.briefingManagerCommission,
            approval: d.internalApprovalCommission,
          }),
      upfrontTask: brand || digital
        ? {}
        : validateTask({
            state: d.upfrontTask,
            mode: 'upfront',
            boxed: true,
            budgetValidator: budgetValidatorFor(false, d.upfrontTask.budgetIsPercentage),
          }),
      recurringTask: !brand && hasDeliverableCycle(d.type)
        ? validateTask({
            state: d.recurringTask,
            mode: 'recurring',
            boxed: true,
            frequency: d.selectedFrequency,
            budgetValidator: budgetValidatorFor(true, d.recurringTask.budgetIsPercentage),
          })
        : {},
    };
  }, [d, digital, recurringBilling, brand]);

  const hasFieldErrors =
    !!v.name ||
    !!v.description ||
    !!v.subStage ||
    !!videoError ||
    hasErrors(v.pricing) ||
    hasErrors(v.delivery) ||
    hasErrors(v.commissions) ||
    hasErrors(v.upfrontTask) ||
    hasErrors(v.recurringTask);

  /**
   * Combined variant/addon price-floor check (Flutter add_service_actions):
   * the base price plus the smallest variant difference and any negative add-on
   * differences must clear the per-type floor.
   */
  function variantAddonFloorError(): string | null {
    const priceNum = numOrZero(d.price);
    const upfrontNum = numOrZero(d.upfrontFee);
    const recurringNum = numOrZero(d.recurringFee);
    const minDiff = (sel: (x: ServiceVariant) => number) => (d.variants.length ? Math.min(...d.variants.map(sel)) : 0);
    const negAddon = (sel: (x: ServiceAddon) => number) =>
      d.addons.filter((a) => sel(a) < 0).reduce((s, a) => s + sel(a), 0);
    if (!recurringBilling) {
      if (priceNum + minDiff((x) => x.oneOffUpfrontDifference) + negAddon((x) => x.oneOffUpfrontDifference) < 1) {
        return 'Total price including variants and addons must be at least 1.';
      }
    } else {
      if (upfrontNum + minDiff((x) => x.recurringUpfrontDifference) + negAddon((x) => x.recurringUpfrontDifference) < 0) {
        return 'Total upfront including variants and addons cannot be negative.';
      }
      if (recurringNum + minDiff((x) => x.recurringWeeklyDifference) + negAddon((x) => x.recurringWeeklyDifference) < 1) {
        return 'Total recurring price including variants and addons must be at least 1.';
      }
    }
    return null;
  }

  function payload() {
    return {
      name: d.name.trim(),
      description: d.description.trim(),
      type: d.type,
      price: recurringBilling ? undefined : numOrUndef(d.price),
      upfrontFee: recurringBilling ? numOrUndef(d.upfrontFee) : undefined,
      recurringFee: recurringBilling ? numOrUndef(d.recurringFee) : undefined,
      upfrontDeliveryFee: hasShipping(d.type) ? numOrUndef(d.upfrontDeliveryFee) : undefined,
      recurringDeliveryFee: hasShipping(d.type) && recurringBilling ? numOrUndef(d.recurringDeliveryFee) : undefined,
      deliverableFrequency: hasDeliverableCycle(d.type) && d.selectedFrequency ? d.selectedFrequency : undefined,
      repeatsEvery: hasDeliverableCycle(d.type) && d.recurringTask.repeatsEvery.trim() ? Number(d.recurringTask.repeatsEvery) : undefined,
      disciplines: d.disciplines,
      imageUrl: d.imageUrl || undefined,
      imageAspectRatio: d.imageUrl && d.imageAspectRatio ? d.imageAspectRatio : undefined,
      videoUrl: d.videoUrl.trim() || undefined,
      stage: d.stage || undefined,
      subStage: d.subStage || undefined,
      digitalProductFileUrl: digital ? d.digitalProductFileUrl || undefined : undefined,
      digitalProductFileName: digital ? d.digitalProductFileName || undefined : undefined,
      options: d.options,
      variants: d.variants,
      addons: d.addons,
      customFields: digital ? [] : d.customFields,
      assignedStaff: d.assignedStaff,
      upfrontProjectConfig: digital ? undefined : buildProjectConfig(brand ? brandTask(d.upfrontTask, d.name) : d.upfrontTask),
      recurringProjectConfig: hasDeliverableCycle(d.type)
        ? buildProjectConfig(brand ? brandTask(d.recurringTask, d.name) : d.recurringTask, d.minimumTerm)
        : recurringBilling
          ? buildProjectConfig(emptyTaskState(), d.minimumTerm)
          : undefined,
      productionManagerCommission: digital ? undefined : numOrUndef(d.productionManagerCommission),
      briefingManagerCommission: digital ? undefined : numOrUndef(d.briefingManagerCommission),
      internalApprovalCommission: digital ? undefined : numOrUndef(d.internalApprovalCommission),
      // Brand-published services keep the storefront/integration toggles off.
      isActive: brand ? false : d.isActive,
      allowBuyNow: brand ? false : d.allowBuyNow,
      allowBookMeeting: brand ? false : d.allowBookMeeting,
      allowSalesProposal: brand ? false : d.allowSalesProposal,
    };
  }

  function save() {
    setShowErrors(true);
    // Field-level validation (inline). Mirrors Flutter Form.validate().
    if (hasFieldErrors) return;
    // Submit-time checks that toast in Flutter (add_service_actions), in order.
    if (!d.imageUrl && !d.videoUrl.trim()) return void toast.error('Please upload an image or a video for the service');
    if (digital && !d.digitalProductFileUrl) return void toast.error('Please upload the digital product file');
    if (d.allowBookMeeting && d.assignedStaff.length === 0)
      return void toast.error('Please assign at least one staff member for sales meetings');
    const cap = commissionDefaults.data
      ? commissionCapError({
          production: d.productionManagerCommission,
          briefing: d.briefingManagerCommission,
          approval: d.internalApprovalCommission,
          agencyCommission: commissionDefaults.data.agencyCommission,
        })
      : null;
    if (cap) return void toast.error(cap);
    const floor = variantAddonFloorError();
    if (floor) return void toast.error(floor);

    if (d.id) update.mutate({ id: d.id, ...payload() } as any);
    else create.mutate({ agencyId, ...payload() } as any);
  }

  async function del() {
    if (!d.id) return;
    const ok = await confirm({
      title: 'Delete service',
      description: 'Are you sure you want to delete this service? It will be hidden from the marketplace and any active offers.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    archive.mutate({ id: d.id });
  }

  const memberList = members.data ?? [];

  return (
    <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-[1400px] flex-col overflow-hidden p-0">
      <DialogHeader className="border-b border-[color:var(--color-border-hairline)] px-6 py-4">
        <DialogTitle>{isEdit ? 'Edit Service' : 'Add New Service'}</DialogTitle>
      </DialogHeader>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 gap-x-12 gap-y-8 lg:grid-cols-2">
          {/* ── LEFT COLUMN ─────────────────────────────────────────────── */}
          <div className="flex flex-col gap-8">
            <FormSection title="Core Details">
              <Field label="" hint="e.g. Branding & Logo Design" error={showErrors ? v.name : null}>
                <Input value={d.name} placeholder="e.g. Branding & Logo Design" onChange={(e) => set('name', e.target.value)} />
              </Field>
              <Field label="Description" error={showErrors ? v.description : null}>
                <textarea
                  className="min-h-[88px] rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40"
                  value={d.description}
                  placeholder="Describe what is included in this service..."
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
              <Field label="Service Type">
                <Select value={d.type} onChange={(v) => set('type', v as ServiceType)}>
                  {/* Digital products need a file uploader, which the brand variant
                      hides — so don't offer digital types there (avoids a dead-end). */}
                  {ADD_SERVICE_TYPES.filter((t) => !brand || !isDigital(t)).map((t) => (
                    <option key={t} value={t}>{SERVICE_TYPE_DISPLAY_NAME[t]}</option>
                  ))}
                </Select>
              </Field>
            </FormSection>

            <PricingSection
              type={d.type}
              selectedFrequency={d.selectedFrequency}
              price={d.price}
              upfrontFee={d.upfrontFee}
              recurringFee={d.recurringFee}
              minimumTerm={d.minimumTerm}
              priceError={showErrors ? v.pricing.price : null}
              upfrontFeeError={showErrors ? v.pricing.upfrontFee : null}
              recurringFeeError={showErrors ? v.pricing.recurringFee : null}
              minimumTermError={showErrors ? v.pricing.minimumTerm : null}
              onPrice={(val) => set('price', val)}
              onUpfrontFee={(val) => set('upfrontFee', val)}
              onRecurringFee={(val) => set('recurringFee', val)}
              onMinimumTerm={(val) => set('minimumTerm', val)}
            />

            {hasShipping(d.type) && (
              <DeliveryFeeSection
                type={d.type}
                upfrontDeliveryFee={d.upfrontDeliveryFee}
                recurringDeliveryFee={d.recurringDeliveryFee}
                upfrontDeliveryFeeError={showErrors ? v.delivery.upfrontDeliveryFee : null}
                recurringDeliveryFeeError={showErrors ? v.delivery.recurringDeliveryFee : null}
                onUpfront={(val) => set('upfrontDeliveryFee', val)}
                onRecurring={(val) => set('recurringDeliveryFee', val)}
              />
            )}

            {!brand && <ValuePropositionChips benefits={d.disciplines} onChange={(v) => set('disciplines', v)} />}

            <ClassificationSelect
              subStage={d.subStage}
              onChange={(subStage, stage) => setD((p) => ({ ...p, subStage, stage }))}
              error={showErrors ? v.subStage : null}
            />

            {!brand && !digital && (
              <>
                <VariantsEditor
                  options={d.options}
                  variants={d.variants}
                  onOptions={(o) => set('options', o)}
                  onVariants={(v) => set('variants', v)}
                  isBillingRecurring={recurringBilling}
                  basePrice={basePrice}
                  baseUpfrontFee={baseUpfrontFee}
                  baseRecurringFee={baseRecurringFee}
                />
                <AddonsEditor addons={d.addons} onChange={(a) => set('addons', a)} isBillingRecurring={recurringBilling} />
                <CustomFieldBuilder fields={d.customFields} onChange={(c) => set('customFields', c)} />
              </>
            )}
          </div>

          {/* ── RIGHT COLUMN ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-8">
            <MediaAssetsSection
              pathPrefix={`services/${agencyId}`}
              imageUrl={d.imageUrl}
              videoUrl={d.videoUrl}
              videoError={videoError}
              onImage={(url) => {
                set('imageUrl', url);
                // Measure the cover's aspect ratio so marketplace tiles size to
                // it (Flutter records imageAspectRatio at upload).
                void measureImageAspectRatio(url).then((ar) => set('imageAspectRatio', ar));
              }}
              onRemoveImage={() => { set('imageUrl', ''); set('imageAspectRatio', null); }}
              onVideoUrl={(url) => set('videoUrl', url)}
            />

            {/* Project Settings (commissions, tasks, digital asset, integrations)
                are hidden in the brand variant — only the cover image above shows. */}
            {!brand && (
            <div className="flex flex-col gap-6">
              <h3 className="text-base font-semibold text-ink-100">Project Settings</h3>

              {!digital && (
                <>
                  <CommissionsSection
                    production={d.productionManagerCommission}
                    briefing={d.briefingManagerCommission}
                    approval={d.internalApprovalCommission}
                    productionError={showErrors ? v.commissions.production : null}
                    briefingError={showErrors ? v.commissions.briefing : null}
                    approvalError={showErrors ? v.commissions.approval : null}
                    onProduction={(val) => set('productionManagerCommission', val)}
                    onBriefing={(val) => set('briefingManagerCommission', val)}
                    onApproval={(val) => set('internalApprovalCommission', val)}
                    baseline={commissionDefaults.data
                      ? {
                          production: commissionDefaults.data.productionManagerCommission,
                          briefing: commissionDefaults.data.briefingManagerCommission,
                          approval: commissionDefaults.data.internalApprovalCommission,
                        }
                      : undefined}
                  />
                  <TaskSection mode="upfront" state={d.upfrontTask} onChange={(t) => set('upfrontTask', t)} errors={showErrors ? v.upfrontTask : undefined} />
                </>
              )}

              {hasDeliverableCycle(d.type) && (
                <TaskSection
                  mode="recurring"
                  state={d.recurringTask}
                  onChange={(t) => set('recurringTask', t)}
                  selectedFrequency={d.selectedFrequency}
                  onFrequencyChange={(val) => set('selectedFrequency', val)}
                  errors={showErrors ? v.recurringTask : undefined}
                />
              )}

              {digital && (
                <DigitalFileAssetSection
                  pathPrefix={`services/${agencyId}/digital-products`}
                  fileName={d.digitalProductFileName}
                  onUploaded={(url, name) => setD((p) => ({ ...p, digitalProductFileUrl: url, digitalProductFileName: name }))}
                />
              )}

              <SettingsIntegrationsSection
                allowBuyNow={d.allowBuyNow}
                allowSalesProposal={d.allowSalesProposal}
                allowBookMeeting={d.allowBookMeeting}
                isActive={d.isActive}
                onAllowBuyNow={(v) => set('allowBuyNow', v)}
                onAllowSalesProposal={(v) => set('allowSalesProposal', v)}
                onAllowBookMeeting={(v) => set('allowBookMeeting', v)}
                onIsActive={(v) => set('isActive', v)}
                members={memberList}
                assignedStaff={d.assignedStaff}
                onAssignedStaff={(s) => set('assignedStaff', s)}
              />
            </div>
            )}
          </div>
        </div>
      </div>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 border-t border-[color:var(--color-border-hairline)] px-6 py-3">
        <div className="flex items-center gap-3">
          {isEdit && (
            <>
              <span className="inline-flex items-center gap-2 text-sm font-semibold text-ink-100">
                <span className={`h-2 w-2 rounded-full border border-ink-100 ${d.isActive ? 'bg-accent' : 'bg-ink-40'}`} />
                {d.isActive ? 'Active Service' : 'Inactive Service'}
              </span>
              <Button variant="danger" size="sm" onClick={del} disabled={pending}>Delete</Button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showErrors && hasFieldErrors && <span className="text-xs text-danger">Please fix the highlighted fields.</span>}
          <Button variant="outline" onClick={onDone} disabled={pending}>Cancel</Button>
          <Button variant="accent" onClick={save} disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Update Service' : 'Create Service'}
          </Button>
        </div>
      </div>
    </DialogContent>
  );
}
