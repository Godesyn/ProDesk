import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Field, Select } from '../agency/form-bits';
import { toNumberInput } from '../../lib/utils';
import {
  SectionHeader,
  PricingSection,
  DeliveryFeeSection,
  CommissionsSection,
  TaskSection,
  emptyTaskState,
  validatePricing,
  validateDeliveryFee,
  validateCommissions,
  validateTask,
  hasErrors,
  type TaskState,
  type ServiceProjectConfig,
} from '../../components/service-form';
import {
  PURCHASE_SERVICE_TYPES,
  SERVICE_TYPE_DISPLAY_NAME,
  isBillingCycleWeekly,
  hasShipping,
  type ServiceType,
} from '@server/lib/service-type';
import { type DeliverableFrequency } from '@server/lib/deliverable-frequency';
import { Textarea } from './ui';

/**
 * Payload emitted by the custom-item dialog — a ProposalItem-shaped object
 * (mirrors Flutter `create_custom_item_dialog.dart`'s `ProposalItem`).
 */
export interface CustomItemPayload {
  type: 'custom';
  serviceName: string;
  description: string;
  serviceType: ServiceType;
  isRecurring: boolean;
  billingCycle?: string;
  amount: number;
  upfrontFee?: number;
  quantity: number;
  deliverableFrequency?: DeliverableFrequency;
  repeatsEvery?: number;
  upfrontProjectConfig?: ServiceProjectConfig;
  recurringProjectConfig?: ServiceProjectConfig;
  upfrontDeliveryFee?: number;
  recurringDeliveryFee?: number;
  productionManagerCommission: number;
  briefingManagerCommission: number;
  internalApprovalCommission: number;
}

const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

/** Build a ServiceProjectConfig from a TaskState (ports `buildUpfrontConfig`/`buildRecurringConfig`). */
function buildConfig(state: TaskState): ServiceProjectConfig {
  const budget = num(state.contractorBudget);
  return {
    taskName: state.taskName.trim() || undefined,
    projectDurationDays: num(state.projectDuration),
    contractorDefaultBudget: state.budgetIsPercentage ? undefined : budget,
    contractorDefaultBudgetInPercentage: state.budgetIsPercentage ? budget : undefined,
    estimatedContractorDurationInHours: num(state.estimatedDuration),
  };
}

/**
 * "Create Custom Item" dialog — 1:1 parity with the Flutter
 * `CreateCustomItemDialog`. Sections in order: Base Details, Pricing, Delivery
 * Settings (shipping only), Commissions, Upfront Project Task, and (weekly only)
 * Recurring Project Task. Emits a ProposalItem-shaped `CustomItemPayload`.
 */
/** Recurring tasks seed `repeatsEvery` to "1" (Flutter ServiceFormControllers). */
const recurringTaskState = (): TaskState => ({ ...emptyTaskState(), repeatsEvery: '1' });

export function CustomItemDialog({
  open,
  onOpenChange,
  onSubmit,
  agencyId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (p: CustomItemPayload) => void;
  /** Used to seed commission defaults (mirrors Flutter ServiceFormControllers.from(agency:)). */
  agencyId?: string;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ServiceType>('oneOffService');

  // Pricing
  const [price, setPrice] = useState('');
  const [upfrontFee, setUpfrontFee] = useState('');
  const [recurringFee, setRecurringFee] = useState('');
  const [minimumTerm, setMinimumTerm] = useState('');

  // Delivery
  const [upfrontDeliveryFee, setUpfrontDeliveryFee] = useState('');
  const [recurringDeliveryFee, setRecurringDeliveryFee] = useState('');

  // Commissions
  const [production, setProduction] = useState('');
  const [briefing, setBriefing] = useState('');
  const [approval, setApproval] = useState('');

  // Tasks
  const [upfrontTask, setUpfrontTask] = useState<TaskState>(emptyTaskState());
  const [recurringTask, setRecurringTask] = useState<TaskState>(recurringTaskState());
  const [frequency, setFrequency] = useState<DeliverableFrequency | ''>('');

  const [showErrors, setShowErrors] = useState(false);

  const isRecurring = isBillingCycleWeekly(type);

  // Seed commissions from the agency defaults (Flutter seeds these so the
  // required commission validators pass without manual entry).
  const commissionDefaults = useQuery({ ...trpc.agencies.commissionDefaults.queryOptions({ agencyId: agencyId! }), enabled: !!agencyId && open });
  useEffect(() => {
    const cd = commissionDefaults.data;
    if (!cd) return;
    if (production || briefing || approval) return;
    setProduction(toNumberInput(cd.productionManagerCommission));
    setBriefing(toNumberInput(cd.briefingManagerCommission));
    setApproval(toNumberInput(cd.internalApprovalCommission));
  }, [commissionDefaults.data, production, briefing, approval]);

  // Per-field validation — ports the create_custom_item form (boxed = false, no
  // contractor-budget max validator).
  const v = useMemo(
    () => ({
      name: !name.trim() ? 'This field is required' : null,
      pricing: validatePricing({ type, price, upfrontFee, recurringFee, boxed: false }),
      delivery: hasShipping(type) ? validateDeliveryFee({ type, upfrontDeliveryFee, recurringDeliveryFee }) : {},
      commissions: validateCommissions({ production, briefing, approval }),
      upfrontTask: validateTask({ state: upfrontTask, mode: 'upfront', boxed: false }),
      recurringTask: isRecurring
        ? validateTask({ state: recurringTask, mode: 'recurring', boxed: false, frequency })
        : {},
    }),
    [name, type, price, upfrontFee, recurringFee, upfrontDeliveryFee, recurringDeliveryFee, production, briefing, approval, upfrontTask, recurringTask, frequency, isRecurring],
  );

  const hasFieldErrors =
    !!v.name ||
    hasErrors(v.pricing) ||
    hasErrors(v.delivery) ||
    hasErrors(v.commissions) ||
    hasErrors(v.upfrontTask) ||
    hasErrors(v.recurringTask);

  const reset = () => {
    setName(''); setDescription(''); setType('oneOffService');
    setPrice(''); setUpfrontFee(''); setRecurringFee(''); setMinimumTerm('');
    setUpfrontDeliveryFee(''); setRecurringDeliveryFee('');
    setProduction(''); setBriefing(''); setApproval('');
    setUpfrontTask(emptyTaskState()); setRecurringTask(recurringTaskState()); setFrequency('');
    setShowErrors(false);
  };

  const submit = () => {
    setShowErrors(true);
    if (hasFieldErrors) return;
    onSubmit({
      type: 'custom',
      serviceName: name.trim(),
      description: description.trim(),
      serviceType: type,
      isRecurring,
      billingCycle: isRecurring ? 'Weekly' : undefined,
      amount: isRecurring ? num(recurringFee) ?? 0 : num(price) ?? 0,
      upfrontFee: isRecurring ? num(upfrontFee) : undefined,
      quantity: 1,
      deliverableFrequency: isRecurring ? (frequency || undefined) : undefined,
      repeatsEvery: isRecurring ? num(recurringTask.repeatsEvery) : undefined,
      upfrontProjectConfig: buildConfig(upfrontTask),
      recurringProjectConfig: buildConfig(recurringTask),
      upfrontDeliveryFee: num(upfrontDeliveryFee),
      recurringDeliveryFee: num(recurringDeliveryFee),
      productionManagerCommission: num(production) ?? 0,
      briefingManagerCommission: num(briefing) ?? 0,
      internalApprovalCommission: num(approval) ?? 0,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      {/* Flex column capped at the viewport: only the body scrolls, so the
          header and the footer action stay pinned and visible (no nested
          double-scroll that could push "Create Custom Item" off-screen on a
          phone). twMerge lets these override the base grid/overflow. */}
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0"><DialogTitle>Create Custom Item</DialogTitle></DialogHeader>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
          {/* Base Details */}
          <div className="space-y-4">
            <SectionHeader title="Base Details" />
            <Field label="Item Name" error={showErrors ? v.name : null}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Item Name" />
            </Field>
            <Field label="Description (Optional)">
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <Field label="Service Type">
              <Select value={type} onChange={(v) => setType(v as ServiceType)}>
                {PURCHASE_SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>{SERVICE_TYPE_DISPLAY_NAME[t]}</option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Pricing */}
          <PricingSection
            type={type}
            selectedFrequency={frequency}
            price={price}
            upfrontFee={upfrontFee}
            recurringFee={recurringFee}
            minimumTerm={minimumTerm}
            priceError={showErrors ? v.pricing.price : null}
            upfrontFeeError={showErrors ? v.pricing.upfrontFee : null}
            recurringFeeError={showErrors ? v.pricing.recurringFee : null}
            onPrice={setPrice}
            onUpfrontFee={setUpfrontFee}
            onRecurringFee={setRecurringFee}
            onMinimumTerm={setMinimumTerm}
          />

          {/* Delivery Settings — shipping types only */}
          {hasShipping(type) && (
            <DeliveryFeeSection
              type={type}
              upfrontDeliveryFee={upfrontDeliveryFee}
              recurringDeliveryFee={recurringDeliveryFee}
              upfrontDeliveryFeeError={showErrors ? v.delivery.upfrontDeliveryFee : null}
              recurringDeliveryFeeError={showErrors ? v.delivery.recurringDeliveryFee : null}
              onUpfront={setUpfrontDeliveryFee}
              onRecurring={setRecurringDeliveryFee}
            />
          )}

          {/* Commissions */}
          <CommissionsSection
            production={production}
            briefing={briefing}
            approval={approval}
            productionError={showErrors ? v.commissions.production : null}
            briefingError={showErrors ? v.commissions.briefing : null}
            approvalError={showErrors ? v.commissions.approval : null}
            onProduction={setProduction}
            onBriefing={setBriefing}
            onApproval={setApproval}
            baseline={commissionDefaults.data
              ? {
                  production: commissionDefaults.data.productionManagerCommission,
                  briefing: commissionDefaults.data.briefingManagerCommission,
                  approval: commissionDefaults.data.internalApprovalCommission,
                }
              : undefined}
          />

          {/* Upfront Project Task */}
          <TaskSection mode="upfront" state={upfrontTask} onChange={setUpfrontTask} errors={showErrors ? v.upfrontTask : undefined} />

          {/* Recurring Project Task — weekly billing only */}
          {isRecurring && (
            <TaskSection
              mode="recurring"
              state={recurringTask}
              onChange={setRecurringTask}
              selectedFrequency={frequency}
              onFrequencyChange={setFrequency}
              errors={showErrors ? v.recurringTask : undefined}
            />
          )}
        </div>
        <DialogFooter className="shrink-0">
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false); }}>Cancel</Button>
          <Button variant="accent" onClick={submit}>Create Custom Item</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
