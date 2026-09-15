/**
 * New Project dialog — a 1:1 port of the Flutter `NewInternalPurchaseDialog`
 * flow (lib/src/features/kanban/.../new_internal_purchase_dialog.dart and its
 * `new_internal_purchase_dialog_components/*`).
 *
 * A two-step wizard:
 *   STEP 0  ProjectTypeSelection — billable vs non-billable.
 *   STEP 1  Billable      → brand picker + service form → create+send a proposal.
 *           Non-billable  → optional brand + viewable toggle + service form →
 *                           create an internal project (projects.createInternalProject).
 *
 * Reuses the shared service-form components (client/src/components/service-form/*)
 * and the agency form bits (client/src/pages/agency/form-bits.tsx).
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, ArrowLeft, CheckCircle2, Circle } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../../lib/trpc';
import { cn, toNumberInput } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Field, Select } from '../agency/form-bits';
import { BrandSelection, type PickedBrand } from './brand-selection';
import {
  PricingSection,
  DeliveryFeeSection,
  CommissionsSection,
  TaskSection,
  SectionHeader,
  MoneyInput,
  emptyTaskState,
  validatePricing,
  validateDeliveryFee,
  validateCommissions,
  validateTask,
  projectBudgetValidator,
  maxBudgetPercentage,
  commissionCapError,
  hasErrors,
  type TaskState,
  type PricingErrors,
  type DeliveryErrors,
  type CommissionErrors,
  type TaskErrors,
} from '../../components/service-form';
import {
  PURCHASE_SERVICE_TYPES,
  SERVICE_TYPE_DISPLAY_NAME,
  isBillingCycleWeekly,
  hasShipping,
  type ServiceType,
} from '@server/lib/service-type';
import { type DeliverableFrequency } from '@server/lib/deliverable-frequency';

/* ────────────────────────────────────────────────────────────────────────── */

interface ServiceVariant {
  id: string;
  options?: Record<string, string>;
}
interface ServiceOption {
  name: string;
  choices?: string[];
}
interface ServiceAddon {
  id: string;
  name: string;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}
type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  type: ServiceType | null;
  price: string | number | null;
  upfrontFee: string | number | null;
  recurringFee: string | number | null;
  upfrontDeliveryFee: string | number | null;
  recurringDeliveryFee: string | number | null;
  deliverableFrequency: string | null;
  repeatsEvery: number | null;
  upfrontProjectConfig: unknown;
  recurringProjectConfig: unknown;
  options?: unknown[] | null;
  variants?: unknown[] | null;
  addons?: unknown[] | null;
  isHeading?: boolean | null;
};

// Seed editable fields from stored values, dropping any trailing `.00` a DB
// `numeric` column round-trips (matches service-editor's `numStr`).
const numStr = (v: unknown) => toNumberInput(v as string | number | null | undefined);
const cfgBudget = (cfg: unknown) => {
  const b = (cfg as { contractorDefaultBudget?: number } | null)?.contractorDefaultBudget;
  return numStr(b);
};

/* ────────────────────────────────────────────────────────────────────────── */

/** Entry point: the "New Project" button + dialog. */
export function NewProjectDialog({ agencyId, onCreated, iconOnly, className }: { agencyId: string; onCreated: (id: string) => void; iconOnly?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Icon-only on mobile (square 40px button), full label on desktop unless iconOnly is true. */}
      <Button variant="accent" className={cn(className, iconOnly ? "w-10 px-0" : "max-md:w-10 max-md:px-0")} onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> <span className={cn(iconOnly ? "hidden" : "max-md:hidden")}>New Project</span>
      </Button>
      {open && <NewProjectWizard agencyId={agencyId} onCreated={onCreated} onClose={() => setOpen(false)} />}
    </Dialog>
  );
}

function NewProjectWizard({ agencyId, onCreated, onClose }: { agencyId: string; onCreated: (id: string) => void; onClose: () => void }) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();

  const [step, setStep] = useState<0 | 1>(0);
  const [isBillable, setIsBillable] = useState(false);

  // Brand state.
  const [brand, setBrand] = useState<PickedBrand | null>(null);
  const [isBrandInvolved, setIsBrandInvolved] = useState(true); // non-billable only
  const [viewableToBrand, setViewableToBrand] = useState(true); // non-billable only

  // Service form state.
  const [isCustom, setIsCustom] = useState(false);
  const [selectedService, setSelectedService] = useState<ServiceRow | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | undefined>(undefined);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [selectedAddons, setSelectedAddons] = useState<ServiceAddon[]>([]);

  // Custom-service fields.
  const [customName, setCustomName] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customType, setCustomType] = useState<ServiceType>('oneOffService');
  const [frequency, setFrequency] = useState<DeliverableFrequency | ''>('');
  const [upfrontTask, setUpfrontTask] = useState<TaskState>(emptyTaskState());
  // Recurring tasks seed `repeatsEvery` to "1" (Flutter ServiceFormControllers).
  const [recurringTask, setRecurringTask] = useState<TaskState>({ ...emptyTaskState(), repeatsEvery: '1' });

  // Pricing / delivery / commission inputs (billable; also budget overrides).
  const [price, setPrice] = useState('');
  const [upfrontFee, setUpfrontFee] = useState('');
  const [recurringFee, setRecurringFee] = useState('');
  const [minimumTerm, setMinimumTerm] = useState('');
  const [upfrontDeliveryFee, setUpfrontDeliveryFee] = useState('');
  const [recurringDeliveryFee, setRecurringDeliveryFee] = useState('');
  const [prodCommission, setProdCommission] = useState('');
  const [briefCommission, setBriefCommission] = useState('');
  const [approvalCommission, setApprovalCommission] = useState('');
  // Existing-service contractor budget overrides (non-billable).
  const [upfrontBudget, setUpfrontBudget] = useState('');
  const [recurringBudget, setRecurringBudget] = useState('');

  const [loading, setLoading] = useState(false);

  // The effective type drives recurring vs one-off layout.
  const effectiveType: ServiceType = isCustom ? customType : (selectedService?.type ?? 'oneOffService');
  const recurring = isBillingCycleWeekly(effectiveType);

  // ── Custom-service validation (ports CustomServiceForm). Only the custom path
  // runs field validation in Flutter; existing-service selection just requires a
  // service to be chosen. Errors surface inline after the first submit attempt.
  const [showErrors, setShowErrors] = useState(false);
  const customRecurring = isBillingCycleWeekly(customType);

  const commissionDefaults = useQuery({
    ...trpc.agencies.commissionDefaults.queryOptions({ agencyId }),
    enabled: !!agencyId,
  });
  // Seed commissions from the agency defaults once, when building a custom service.
  useEffect(() => {
    const cd = commissionDefaults.data;
    if (!cd || !isCustom) return;
    if (prodCommission || briefCommission || approvalCommission) return;
    setProdCommission(toNumberInput(cd.productionManagerCommission));
    setBriefCommission(toNumberInput(cd.briefingManagerCommission));
    setApprovalCommission(toNumberInput(cd.internalApprovalCommission));
  }, [commissionDefaults.data, isCustom, prodCommission, briefCommission, approvalCommission]);

  const customErrors = useMemo(() => {
    const budgetValidatorFor = (isRec: boolean, isPct: boolean) => (val: string) =>
      projectBudgetValidator(val, {
        isPercentage: isPct,
        isRecurring: isRec,
        isBillingRecurring: customRecurring,
        isBillable,
        price,
        upfrontFee,
        recurringFee,
        maxPercentage: maxBudgetPercentage(prodCommission, briefCommission, approvalCommission),
      });
    return {
      customName: !customName.trim() ? 'This field is required' : null,
      pricing: isBillable ? validatePricing({ type: customType, price, upfrontFee, recurringFee, boxed: false }) : {},
      delivery:
        isBillable && hasShipping(customType)
          ? validateDeliveryFee({ type: customType, upfrontDeliveryFee, recurringDeliveryFee })
          : {},
      commissions: isBillable ? validateCommissions({ production: prodCommission, briefing: briefCommission, approval: approvalCommission }) : {},
      upfrontTask: validateTask({ state: upfrontTask, mode: 'upfront', boxed: false, budgetValidator: budgetValidatorFor(false, upfrontTask.budgetIsPercentage) }),
      recurringTask: customRecurring
        ? validateTask({ state: recurringTask, mode: 'recurring', boxed: false, frequency, budgetValidator: budgetValidatorFor(true, recurringTask.budgetIsPercentage) })
        : {},
    };
  }, [customName, customType, customRecurring, isBillable, price, upfrontFee, recurringFee, upfrontDeliveryFee, recurringDeliveryFee, prodCommission, briefCommission, approvalCommission, upfrontTask, recurringTask, frequency]);

  const hasCustomFieldErrors =
    !!customErrors.customName ||
    hasErrors(customErrors.pricing) ||
    hasErrors(customErrors.delivery) ||
    hasErrors(customErrors.commissions) ||
    hasErrors(customErrors.upfrontTask) ||
    hasErrors(customErrors.recurringTask);

  /** Populate the pricing/budget controllers from a freshly-selected service (ports handleServiceSelected). */
  function applyServiceDefaults(s: ServiceRow) {
    if (isBillingCycleWeekly(s.type ?? 'oneOffService')) {
      setRecurringFee(numStr(s.recurringFee));
      setUpfrontFee(numStr(s.upfrontFee));
      setRecurringDeliveryFee(numStr(s.recurringDeliveryFee));
      setUpfrontDeliveryFee(numStr(s.upfrontDeliveryFee));
      setUpfrontBudget(cfgBudget(s.upfrontProjectConfig));
      setRecurringBudget(cfgBudget(s.recurringProjectConfig));
    } else {
      setPrice(numStr(s.price));
      setUpfrontDeliveryFee(numStr(s.upfrontDeliveryFee));
      setUpfrontBudget(cfgBudget(s.upfrontProjectConfig));
    }
  }

  const createProject = useMutation(trpc.projects.createInternalProject.mutationOptions());
  const createProposal = useMutation(trpc.proposals.create.mutationOptions());
  const addItem = useMutation(trpc.proposals.addItem.mutationOptions());
  const sendProposal = useMutation(trpc.proposals.send.mutationOptions());
  const createReferral = useMutation(trpc.brands.createReferral.mutationOptions());

  /** Resolve the brand to a persisted brandId (creating the referral if new). */
  async function resolveBrandId(emailRequired: boolean): Promise<string | undefined> {
    if (!brand) return undefined;
    if (brand.id) return brand.id;
    if (emailRequired && !brand.email) {
      throw new Error('Brand email is required');
    }
    const created = await createReferral.mutateAsync({ agencyId, businessName: brand.businessName, email: brand.email ?? undefined });
    return created.id;
  }

  async function submit() {
    if (loading) return;
    // Validation gating mirrors Flutter handleNewInternalPurchaseSubmit: the
    // custom-service form is field-validated (+ commission cap); existing-service
    // selection just needs a service. Then the brand requirement is checked.
    if (isCustom) {
      setShowErrors(true);
      if (hasCustomFieldErrors) return;
      const cap = commissionDefaults.data
        ? commissionCapError({
            production: prodCommission,
            briefing: briefCommission,
            approval: approvalCommission,
            agencyCommission: commissionDefaults.data.agencyCommission,
          })
        : null;
      if (cap) {
        toast.error(cap);
        return;
      }
    } else if (!selectedService) {
      toast.error('Please select a service');
      return;
    }
    if (isBillable) {
      if (!brand) {
        toast.error('Please select a brand');
        return;
      }
    } else if (isBrandInvolved && !brand) {
      toast.error('Please select a brand');
      return;
    }

    setLoading(true);
    try {
      if (isBillable) await submitBillable();
      else await submitComplimentary();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  /** Billable: build a single-item proposal and send it (ports submit_billable.dart). */
  async function submitBillable() {
    if (!isCustom && !selectedService) throw new Error('Select a service');
    if (isCustom && !customName.trim()) throw new Error('Service name is required');
    if (!brand) throw new Error('Select a client');

    const brandId = await resolveBrandId(true);
    if (!brandId) throw new Error('Select a client');

    const isRec = recurring;
    const amount = isRec ? Number(recurringFee) || 0 : Number(price) || 0;
    const upfront = isRec ? Number(upfrontFee) || 0 : undefined;
    const title = isCustom ? customName.trim() : selectedService!.name;
    const upfrontDel = upfrontDeliveryFee ? Number(upfrontDeliveryFee) : undefined;
    const recurringDel = isRec && recurringDeliveryFee ? Number(recurringDeliveryFee) : undefined;

    const proposal = await createProposal.mutateAsync({ agencyId, brandId, title });

    await addItem.mutateAsync({
      proposalId: proposal.id,
      type: isCustom ? 'custom' : 'service',
      serviceId: isCustom ? undefined : selectedService!.id,
      agencyId,
      description: isCustom ? (customDescription || customName).trim() : (selectedService!.description ?? selectedService!.name),
      amount,
      quantity: 1,
      upfrontFee: upfront,
      upfrontDeliveryFee: upfrontDel,
      recurringDeliveryFee: recurringDel,
      isRecurring: isRec,
      billingCycle: isRec ? 'Weekly' : undefined,
      serviceType: effectiveType,
      deliverableFrequency: isRec ? (isCustom ? (frequency || undefined) : (selectedService!.deliverableFrequency as DeliverableFrequency | undefined)) : undefined,
      repeatsEvery: isRec ? (isCustom ? (Number(recurringTask.repeatsEvery) || undefined) : (selectedService!.repeatsEvery ?? undefined)) : undefined,
      selectedVariantId: isCustom ? undefined : selectedVariantId,
      selectedOptions: isCustom ? undefined : selectedOptions,
      selectedAddons: isCustom ? undefined : (selectedAddons as unknown[]),
      commissions: isCustom
        ? {
            productionManager: Number(prodCommission) || 0,
            briefingManager: Number(briefCommission) || 0,
            internalApproval: Number(approvalCommission) || 0,
          }
        : undefined,
    });

    await sendProposal.mutateAsync({ id: proposal.id });
    toast.success('Proposal created and sent successfully');
    onClose();
    navigate(`/proposal/${proposal.id}`);
  }

  /** Non-billable: create the internal project (ports submit_complimentary.dart). */
  async function submitComplimentary() {
    if (!isCustom && !selectedService) throw new Error('Select a service');
    if (isCustom && !customName.trim()) throw new Error('Service name is required');

    let brandId: string | undefined;
    if (isBrandInvolved && brand) {
      // When viewable to the brand, email is required (the brand gets notified/invited).
      brandId = await resolveBrandId(viewableToBrand);
    }

    // Build configs. Existing-service: start from the service's config + apply
    // the contractor-budget override; custom: build from the task sections.
    const upfrontCfg = isCustom
      ? {
          taskName: upfrontTask.taskName.trim(),
          projectDurationDays: upfrontTask.projectDuration ? Number(upfrontTask.projectDuration) : undefined,
          contractorDefaultBudget: upfrontTask.contractorBudget ? Number(upfrontTask.contractorBudget) : undefined,
          estimatedContractorDurationInHours: upfrontTask.estimatedDuration ? Number(upfrontTask.estimatedDuration) : undefined,
        }
      : selectedService?.upfrontProjectConfig
        ? { ...(selectedService.upfrontProjectConfig as Record<string, unknown>), ...(upfrontBudget ? { contractorDefaultBudget: Number(upfrontBudget) } : {}) }
        : upfrontBudget
          ? { taskName: selectedService?.name ?? '', contractorDefaultBudget: Number(upfrontBudget) }
          : undefined;

    const recurringCfg = isCustom
      ? {
          taskName: recurringTask.taskName.trim(),
          projectDurationDays: recurringTask.projectDuration ? Number(recurringTask.projectDuration) : undefined,
          contractorDefaultBudget: recurringTask.contractorBudget ? Number(recurringTask.contractorBudget) : undefined,
          estimatedContractorDurationInHours: recurringTask.estimatedDuration ? Number(recurringTask.estimatedDuration) : undefined,
        }
      : selectedService?.recurringProjectConfig
        ? { ...(selectedService.recurringProjectConfig as Record<string, unknown>), ...(recurringBudget ? { contractorDefaultBudget: Number(recurringBudget) } : {}) }
        : recurringBudget
          ? { taskName: selectedService?.name ?? '', contractorDefaultBudget: Number(recurringBudget) }
          : undefined;

    const customService = isCustom
      ? {
          name: customName.trim(),
          description: customDescription.trim() || undefined,
          type: customType,
          upfrontProjectConfig: upfrontCfg,
          recurringProjectConfig: recurringCfg,
          deliverableFrequency: recurring ? (frequency || undefined) : undefined,
          repeatsEvery: recurring ? (Number(recurringTask.repeatsEvery) || undefined) : undefined,
        }
      : undefined;

    const project = await createProject.mutateAsync({
      agencyId,
      brandId,
      brandName: !brandId && isBrandInvolved ? brand?.businessName : undefined,
      viewableToBrand: isBrandInvolved ? viewableToBrand : undefined,
      serviceId: isCustom ? undefined : selectedService?.id,
      customService,
      // Existing-service path: the user can override the service's default
      // contractor budget in the dialog. `upfrontCfg`/`recurringCfg` already hold
      // the service config merged with that override — send them so the server
      // uses the edited budget instead of re-reading the service's default.
      upfrontProjectConfig: isCustom ? undefined : upfrontCfg,
      recurringProjectConfig: isCustom ? undefined : recurringCfg,
      options: isCustom ? undefined : (Object.keys(selectedOptions).length ? selectedOptions : undefined),
      addons: isCustom ? undefined : (selectedAddons.length ? (selectedAddons as unknown[]) : undefined),
      selectedVariantId: isCustom ? undefined : selectedVariantId,
    });

    toast.success('Project created successfully');
    onClose();
    onCreated(project.id);
  }

  return (
    <DialogContent className="max-h-[88vh] w-full max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{step === 0 ? 'Select Project Type' : 'New Project'}</DialogTitle>
      </DialogHeader>

      {step === 0 ? (
        <ProjectTypeSelection isBillable={isBillable} onChange={setIsBillable} />
      ) : isBillable ? (
        <div className="flex flex-col gap-6">
          <BrandSelection agencyId={agencyId} brand={brand} onChange={setBrand} emailRequired />
          <ServiceFormSection
            agencyId={agencyId}
            isBillable
            isCustom={isCustom}
            onCustomChange={setIsCustom}
            selectedService={selectedService}
            onSelectService={(s) => { setSelectedService(s); setSelectedVariantId(undefined); setSelectedOptions({}); setSelectedAddons([]); applyServiceDefaults(s); }}
            selectedVariantId={selectedVariantId}
            selectedOptions={selectedOptions}
            onOptionsChange={(opts, variantId) => { setSelectedOptions(opts); setSelectedVariantId(variantId); }}
            selectedAddons={selectedAddons}
            onAddonsChange={setSelectedAddons}
            customName={customName} onCustomName={setCustomName}
            customDescription={customDescription} onCustomDescription={setCustomDescription}
            customType={customType} onCustomType={setCustomType}
            frequency={frequency} onFrequency={setFrequency}
            upfrontTask={upfrontTask} onUpfrontTask={setUpfrontTask}
            recurringTask={recurringTask} onRecurringTask={setRecurringTask}
            price={price} onPrice={setPrice}
            upfrontFee={upfrontFee} onUpfrontFee={setUpfrontFee}
            recurringFee={recurringFee} onRecurringFee={setRecurringFee}
            minimumTerm={minimumTerm} onMinimumTerm={setMinimumTerm}
            upfrontDeliveryFee={upfrontDeliveryFee} onUpfrontDeliveryFee={setUpfrontDeliveryFee}
            recurringDeliveryFee={recurringDeliveryFee} onRecurringDeliveryFee={setRecurringDeliveryFee}
            prodCommission={prodCommission} onProdCommission={setProdCommission}
            briefCommission={briefCommission} onBriefCommission={setBriefCommission}
            approvalCommission={approvalCommission} onApprovalCommission={setApprovalCommission}
            upfrontBudget={upfrontBudget} onUpfrontBudget={setUpfrontBudget}
            recurringBudget={recurringBudget} onRecurringBudget={setRecurringBudget}
            showErrors={showErrors} errors={customErrors}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <CheckRow label="No client involved" checked={!isBrandInvolved} onChange={(v) => setIsBrandInvolved(!v)} />
            {isBrandInvolved && (
              <>
                <BrandSelection agencyId={agencyId} brand={brand} onChange={setBrand} emailRequired={viewableToBrand} />
                <CheckRow label="Viewable to brand" checked={viewableToBrand} onChange={setViewableToBrand} />
              </>
            )}
          </div>
          <ServiceFormSection
            agencyId={agencyId}
            isBillable={false}
            isCustom={isCustom}
            onCustomChange={setIsCustom}
            selectedService={selectedService}
            onSelectService={(s) => { setSelectedService(s); setSelectedVariantId(undefined); setSelectedOptions({}); setSelectedAddons([]); applyServiceDefaults(s); }}
            selectedVariantId={selectedVariantId}
            selectedOptions={selectedOptions}
            onOptionsChange={(opts, variantId) => { setSelectedOptions(opts); setSelectedVariantId(variantId); }}
            selectedAddons={selectedAddons}
            onAddonsChange={setSelectedAddons}
            customName={customName} onCustomName={setCustomName}
            customDescription={customDescription} onCustomDescription={setCustomDescription}
            customType={customType} onCustomType={setCustomType}
            frequency={frequency} onFrequency={setFrequency}
            upfrontTask={upfrontTask} onUpfrontTask={setUpfrontTask}
            recurringTask={recurringTask} onRecurringTask={setRecurringTask}
            price={price} onPrice={setPrice}
            upfrontFee={upfrontFee} onUpfrontFee={setUpfrontFee}
            recurringFee={recurringFee} onRecurringFee={setRecurringFee}
            minimumTerm={minimumTerm} onMinimumTerm={setMinimumTerm}
            upfrontDeliveryFee={upfrontDeliveryFee} onUpfrontDeliveryFee={setUpfrontDeliveryFee}
            recurringDeliveryFee={recurringDeliveryFee} onRecurringDeliveryFee={setRecurringDeliveryFee}
            prodCommission={prodCommission} onProdCommission={setProdCommission}
            briefCommission={briefCommission} onBriefCommission={setBriefCommission}
            approvalCommission={approvalCommission} onApprovalCommission={setApprovalCommission}
            upfrontBudget={upfrontBudget} onUpfrontBudget={setUpfrontBudget}
            recurringBudget={recurringBudget} onRecurringBudget={setRecurringBudget}
            showErrors={showErrors} errors={customErrors}
          />
        </div>
      )}

      {/* Footer */}
      {step === 0 ? (
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="accent" onClick={() => setStep(1)}>Next</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pt-2">
          {isBillable && (
            <p className="text-center text-sm text-ink-60">
              More than one products?{' '}
              <button type="button" className="text-accent underline-offset-4 hover:underline" onClick={() => { onClose(); navigate('/proposals'); }}>
                Go to proposals
              </button>
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="h-4 w-4" /> Back</Button>
            <Button variant="accent" disabled={loading} onClick={submit}>
              {loading ? 'Saving…' : isBillable ? 'Create & Send Proposal' : 'Create Project'}
            </Button>
          </div>
        </div>
      )}
    </DialogContent>
  );
}

/* ── Step 0 ──────────────────────────────────────────────────────────────── */

function ProjectTypeSelection({ isBillable, onChange }: { isBillable: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-base font-semibold text-ink-100">Is this a billable or complimentary project?</h3>
      <SelectionCard
        title="Billable project"
        subtitle="Create and send a single product proposal to a client"
        selected={isBillable}
        onClick={() => onChange(true)}
      />
      <SelectionCard
        title="Non-billable project"
        subtitle="Internal job without client billing"
        selected={!isBillable}
        onClick={() => onChange(false)}
      />
    </div>
  );
}

function SelectionCard({ title, subtitle, selected, onClick }: { title: string; subtitle: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-3 rounded-[var(--radius-sm)] border p-4 text-left transition-colors',
        selected ? 'border-ink-100 bg-ink-100 text-paper' : 'border-[color:var(--color-border-hairline)] bg-card hover:bg-inset',
      )}
    >
      {selected ? <CheckCircle2 className="h-[18px] w-[18px] shrink-0" /> : <Circle className="h-[18px] w-[18px] shrink-0 text-ink-40" />}
      <span className="flex flex-col">
        <span className={cn('text-sm font-bold', selected ? 'text-paper' : 'text-ink-100')}>{title}</span>
        <span className={cn('text-xs', selected ? 'text-paper/75' : 'text-ink-40')}>{subtitle}</span>
      </span>
    </button>
  );
}

/* ── Shared service-form section (ports ServiceFormSection) ──────────────────── */

interface ServiceFormSectionProps {
  agencyId: string;
  isBillable: boolean;
  isCustom: boolean;
  onCustomChange: (v: boolean) => void;
  selectedService: ServiceRow | null;
  onSelectService: (s: ServiceRow) => void;
  selectedVariantId?: string;
  selectedOptions: Record<string, string>;
  onOptionsChange: (opts: Record<string, string>, variantId?: string) => void;
  selectedAddons: ServiceAddon[];
  onAddonsChange: (a: ServiceAddon[]) => void;
  customName: string; onCustomName: (v: string) => void;
  customDescription: string; onCustomDescription: (v: string) => void;
  customType: ServiceType; onCustomType: (v: ServiceType) => void;
  frequency: DeliverableFrequency | ''; onFrequency: (v: DeliverableFrequency | '') => void;
  upfrontTask: TaskState; onUpfrontTask: (v: TaskState) => void;
  recurringTask: TaskState; onRecurringTask: (v: TaskState) => void;
  price: string; onPrice: (v: string) => void;
  upfrontFee: string; onUpfrontFee: (v: string) => void;
  recurringFee: string; onRecurringFee: (v: string) => void;
  minimumTerm: string; onMinimumTerm: (v: string) => void;
  upfrontDeliveryFee: string; onUpfrontDeliveryFee: (v: string) => void;
  recurringDeliveryFee: string; onRecurringDeliveryFee: (v: string) => void;
  prodCommission: string; onProdCommission: (v: string) => void;
  briefCommission: string; onBriefCommission: (v: string) => void;
  approvalCommission: string; onApprovalCommission: (v: string) => void;
  upfrontBudget: string; onUpfrontBudget: (v: string) => void;
  recurringBudget: string; onRecurringBudget: (v: string) => void;
  /** Show validation errors (after first submit attempt). */
  showErrors: boolean;
  errors: {
    customName: string | null;
    pricing: PricingErrors;
    delivery: DeliveryErrors;
    commissions: CommissionErrors;
    upfrontTask: TaskErrors;
    recurringTask: TaskErrors;
  };
}

function ServiceFormSection(p: ServiceFormSectionProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Two-choice toggle */}
      <div className="grid grid-cols-2 gap-2">
        <ToggleChoice label="Select Existing Service" active={!p.isCustom} onClick={() => p.onCustomChange(false)} />
        <ToggleChoice label="Make Custom Service" active={p.isCustom} onClick={() => p.onCustomChange(true)} />
      </div>
      <div className="border-t border-[color:var(--color-border-default)]" />
      {p.isCustom ? <CustomServiceForm {...p} /> : <ExistingServiceSelection {...p} />}
    </div>
  );
}

function ToggleChoice({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-accent bg-accent/10 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
      )}
    >
      {label}
    </button>
  );
}

/* ── Existing-service selection (ports ExistingServiceSelection + list item) ──── */

function ExistingServiceSelection(p: ServiceFormSectionProps) {
  const trpc = useTRPC();
  const list = useQuery(trpc.services.list.queryOptions({ agencyId: p.agencyId, limit: 100, offset: 0, includeInactive: false }));
  const services = useMemo(() => (list.data?.items ?? []).filter((s: ServiceRow) => !s.isHeading), [list.data]);

  if (list.isLoading) return <p className="text-sm text-ink-40">Loading services…</p>;
  if (!services.length) return <p className="text-sm text-ink-40">No services found.</p>;

  return (
    <div className="flex flex-col gap-2">
      {(services as ServiceRow[]).map((s) => {
        const selected = p.selectedService?.id === s.id;
        return (
          <div key={s.id} className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => p.onSelectService(s)}
              className={cn(
                'flex items-start gap-3 rounded-[var(--radius-sm)] border p-4 text-left transition-colors',
                selected ? 'border-accent bg-accent/5' : 'border-[color:var(--color-border-default)] hover:bg-inset',
              )}
            >
              {selected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-accent" /> : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-40" />}
              <span className="flex flex-col">
                <span className={cn('text-sm font-semibold', selected ? 'text-accent' : 'text-ink-100')}>{s.name}</span>
                {s.description && <span className="mt-1 line-clamp-2 text-[13px] text-ink-60">{s.description}</span>}
              </span>
            </button>

            {selected && (
              <>
                <OptionsAddonsConfig
                  service={s}
                  selectedOptions={p.selectedOptions}
                  selectedAddons={p.selectedAddons}
                  onOptionsChange={p.onOptionsChange}
                  onAddonsChange={p.onAddonsChange}
                />
                {p.isBillable ? (
                  <BoxPanel title="Pricing">
                    {isBillingCycleWeekly(s.type ?? 'oneOffService') ? (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <Field label="Upfront Fee"><MoneyInput value={p.upfrontFee} onChange={p.onUpfrontFee} /></Field>
                          <Field label="Recurring Fee"><MoneyInput value={p.recurringFee} onChange={p.onRecurringFee} suffix="weekly" /></Field>
                        </div>
                        {hasShipping(s.type ?? 'oneOffService') && (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Upfront Delivery Fee (Optional)"><MoneyInput value={p.upfrontDeliveryFee} onChange={p.onUpfrontDeliveryFee} /></Field>
                            <Field label="Recurring Delivery Fee (Optional)"><MoneyInput value={p.recurringDeliveryFee} onChange={p.onRecurringDeliveryFee} suffix="weekly" /></Field>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <Field label="Price"><MoneyInput value={p.price} onChange={p.onPrice} /></Field>
                        {hasShipping(s.type ?? 'oneOffService') && (
                          <div className="mt-3"><Field label="Delivery Fee (Optional)"><MoneyInput value={p.upfrontDeliveryFee} onChange={p.onUpfrontDeliveryFee} /></Field></div>
                        )}
                      </>
                    )}
                  </BoxPanel>
                ) : (
                  <BoxPanel title="Contractor Budget Override">
                    {isBillingCycleWeekly(s.type ?? 'oneOffService') ? (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <Field label="Upfront Contractor Budget"><MoneyInput value={p.upfrontBudget} onChange={p.onUpfrontBudget} /></Field>
                        <Field label="Recurring Contractor Budget"><MoneyInput value={p.recurringBudget} onChange={p.onRecurringBudget} suffix="weekly" /></Field>
                      </div>
                    ) : (
                      <Field label="Contractor Budget"><MoneyInput value={p.upfrontBudget} onChange={p.onUpfrontBudget} /></Field>
                    )}
                  </BoxPanel>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Inline options/add-ons configurator that computes selectedVariantId/options/addons. */
function OptionsAddonsConfig({
  service,
  selectedOptions,
  selectedAddons,
  onOptionsChange,
  onAddonsChange,
}: {
  service: ServiceRow;
  selectedOptions: Record<string, string>;
  selectedAddons: ServiceAddon[];
  onOptionsChange: (opts: Record<string, string>, variantId?: string) => void;
  onAddonsChange: (a: ServiceAddon[]) => void;
}) {
  const options = (service.options ?? []) as ServiceOption[];
  const variants = (service.variants ?? []) as ServiceVariant[];
  const addons = (service.addons ?? []) as ServiceAddon[];
  if (!options.length && !addons.length) return null;

  function pick(name: string, choice: string) {
    const next = { ...selectedOptions, [name]: choice };
    const variant = variants.find((v) => Object.entries(v.options ?? {}).every(([k, val]) => next[k] === val));
    onOptionsChange(next, variant?.id);
  }

  function toggleAddon(a: ServiceAddon) {
    const has = selectedAddons.some((x) => x.id === a.id);
    onAddonsChange(has ? selectedAddons.filter((x) => x.id !== a.id) : [...selectedAddons, a]);
  }

  return (
    <BoxPanel title="Configuration">
      {options.map((opt) => (
        <div key={opt.name} className="mb-3 flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-80">{opt.name}</span>
          <div className="flex flex-wrap gap-2">
            {(opt.choices ?? []).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => pick(opt.name, c)}
                className={cn(
                  'rounded-[var(--radius-pill)] border px-3 py-1 text-xs transition-colors',
                  selectedOptions[opt.name] === c ? 'border-transparent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      ))}
      {addons.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink-80">Add-ons</span>
          {addons.map((a) => (
            <label key={a.id} className="flex items-center gap-2 text-sm text-ink-80">
              <input type="checkbox" checked={selectedAddons.some((x) => x.id === a.id)} onChange={() => toggleAddon(a)} />
              {a.name}
            </label>
          ))}
        </div>
      )}
    </BoxPanel>
  );
}

/* ── Custom-service form (ports CustomServiceForm) ──────────────────────────── */

function CustomServiceForm(p: ServiceFormSectionProps) {
  const recurring = isBillingCycleWeekly(p.customType);
  const err = p.showErrors ? p.errors : null;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Service Name" error={err?.customName}>
        <Input value={p.customName} onChange={(e) => p.onCustomName(e.target.value)} placeholder="e.g. Brand Refresh" />
      </Field>
      <Field label="Description (Optional)">
        <textarea
          className="min-h-[72px] rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)]"
          value={p.customDescription}
          onChange={(e) => p.onCustomDescription(e.target.value)}
        />
      </Field>
      <Field label="Service Type">
        <Select value={p.customType} onChange={(v) => p.onCustomType(v as ServiceType)}>
          {PURCHASE_SERVICE_TYPES.map((t) => (
            <option key={t} value={t}>{SERVICE_TYPE_DISPLAY_NAME[t]}</option>
          ))}
        </Select>
      </Field>

      {p.isBillable && (
        <>
          <PricingSection
            type={p.customType}
            selectedFrequency={p.frequency}
            price={p.price}
            upfrontFee={p.upfrontFee}
            recurringFee={p.recurringFee}
            minimumTerm={p.minimumTerm}
            priceError={err?.pricing.price}
            upfrontFeeError={err?.pricing.upfrontFee}
            recurringFeeError={err?.pricing.recurringFee}
            onPrice={p.onPrice}
            onUpfrontFee={p.onUpfrontFee}
            onRecurringFee={p.onRecurringFee}
            onMinimumTerm={p.onMinimumTerm}
          />
          {hasShipping(p.customType) && (
            <DeliveryFeeSection
              type={p.customType}
              upfrontDeliveryFee={p.upfrontDeliveryFee}
              recurringDeliveryFee={p.recurringDeliveryFee}
              upfrontDeliveryFeeError={err?.delivery.upfrontDeliveryFee}
              recurringDeliveryFeeError={err?.delivery.recurringDeliveryFee}
              onUpfront={p.onUpfrontDeliveryFee}
              onRecurring={p.onRecurringDeliveryFee}
            />
          )}
          <CommissionsSection
            production={p.prodCommission}
            briefing={p.briefCommission}
            approval={p.approvalCommission}
            productionError={err?.commissions.production}
            briefingError={err?.commissions.briefing}
            approvalError={err?.commissions.approval}
            onProduction={p.onProdCommission}
            onBriefing={p.onBriefCommission}
            onApproval={p.onApprovalCommission}
          />
        </>
      )}

      <TaskSection mode="upfront" state={p.upfrontTask} onChange={p.onUpfrontTask} dollarOnly={!p.isBillable} errors={err?.upfrontTask} />
      {recurring && (
        <TaskSection
          mode="recurring"
          state={p.recurringTask}
          onChange={p.onRecurringTask}
          selectedFrequency={p.frequency}
          onFrequencyChange={p.onFrequency}
          dollarOnly={!p.isBillable}
          errors={err?.recurringTask}
        />
      )}
    </div>
  );
}

/* ── Small shared bits ──────────────────────────────────────────────────────── */

function BoxPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-default)] bg-card p-4">
      <SectionHeader title={title} />
      {children}
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink-100">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
