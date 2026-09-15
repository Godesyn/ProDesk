/**
 * Service-form validation — a 1:1 port of the validators baked into the Flutter
 * shared service-form widgets (`lib/src/shared/components/service_form/*`) and the
 * per-dialog contractor-budget validators
 * (`add_service_helpers.validateContractorBudget`,
 * `custom_service_form._validateBudget`).
 *
 * Each `validateX` returns a record of `{ field: errorMessage }` for the fields
 * that failed; an empty record means the section is valid. The dialogs run these
 * on submit (mirroring Flutter's `_formKey.currentState!.validate()`), store the
 * result in state, and pass the per-field strings down to the section components
 * for inline display.
 */
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { type DeliverableFrequency } from '@server/lib/deliverable-frequency';
import {
  required,
  positiveInteger,
  greaterThanOneInteger,
  positivePrice,
  priceGreaterThanOne,
  positivePercentage,
} from '../../lib/validators';
import { formatNumber, formatPrice } from '../../lib/utils';
import { type TaskState } from './task-section';

/* ── shared helpers ──────────────────────────────────────────────────────── */

/** True when any value in an error record is a non-empty string. */
export function hasErrors(errs: object): boolean {
  return Object.values(errs).some((v) => v != null && v !== '');
}

/** Flutter `num.clamp(0, 50)` for the max-% display — no trailing `.0` on whole numbers. */
const clampPct = (mp: number) => formatNumber(Math.min(50, Math.max(0, mp)), 1);

/** Thousands-separated, $-prefixed price (no trailing `.00`) — ports `double.asMaybePrice`. */
const asMaybePrice = (n: number): string => formatPrice(n);

/**
 * Remaining budget percentage after commissions (Flutter `_getMaxBudgetPercentage`
 * / `calcMaxBudgetPercentage`). `maxSales` is the largest per-staff sales
 * commission; the web forms don't collect sales commissions, so it defaults to 0.
 */
export function maxBudgetPercentage(production: string, briefing: string, approval: string, maxSales = 0): number {
  const p = Number(production) || 0;
  const b = Number(briefing) || 0;
  const a = Number(approval) || 0;
  return 50 - (p + b + a + maxSales);
}

/* ── pricing ─────────────────────────────────────────────────────────────── */

export interface PricingErrors {
  price?: string;
  upfrontFee?: string;
  recurringFee?: string;
  minimumTerm?: string;
}

/** Ports `ServicePricingSection`'s field validators. */
export function validatePricing(opts: {
  type: ServiceType;
  price: string;
  upfrontFee: string;
  recurringFee: string;
  minimumTerm?: string;
  /** Only `add_service` renders + validates the minimum-term field. */
  includeMinimumTerm?: boolean;
  /** `add_service` (boxed) labels the one-off field "One-time price"; others "Price". */
  boxed?: boolean;
}): PricingErrors {
  const errs: PricingErrors = {};
  if (isBillingCycleWeekly(opts.type)) {
    const u = positivePrice(opts.upfrontFee, 'Upfront fee');
    if (u) errs.upfrontFee = u;
    const r = priceGreaterThanOne(opts.recurringFee, 'Recurring fee');
    if (r) errs.recurringFee = r;
    if (opts.includeMinimumTerm) {
      const m = positiveInteger(opts.minimumTerm ?? '', 'Minimum subscription term');
      if (m) errs.minimumTerm = m;
    }
  } else {
    const p = priceGreaterThanOne(opts.price, opts.boxed ? 'One-time price' : 'Price');
    if (p) errs.price = p;
  }
  return errs;
}

/* ── delivery fees ───────────────────────────────────────────────────────── */

export interface DeliveryErrors {
  upfrontDeliveryFee?: string;
  recurringDeliveryFee?: string;
}

/** Ports `ServiceDeliveryFeeSection` — optional, but a value must be a positive integer. */
export function validateDeliveryFee(opts: {
  type: ServiceType;
  upfrontDeliveryFee: string;
  recurringDeliveryFee: string;
}): DeliveryErrors {
  const optionalFee = (v: string, name: string) => (v == null || v.trim() === '' ? null : positiveInteger(v, name));
  const errs: DeliveryErrors = {};
  if (isBillingCycleWeekly(opts.type)) {
    const u = optionalFee(opts.upfrontDeliveryFee, 'Upfront delivery fee');
    if (u) errs.upfrontDeliveryFee = u;
    const r = optionalFee(opts.recurringDeliveryFee, 'Recurring delivery fee');
    if (r) errs.recurringDeliveryFee = r;
  } else {
    const u = optionalFee(opts.upfrontDeliveryFee, 'Delivery fee');
    if (u) errs.upfrontDeliveryFee = u;
  }
  return errs;
}

/* ── commissions ─────────────────────────────────────────────────────────── */

export interface CommissionErrors {
  production?: string;
  briefing?: string;
  approval?: string;
}

/** Ports `ServiceCommissionsSection` — each field required, 0–100. */
export function validateCommissions(opts: { production: string; briefing: string; approval: string }): CommissionErrors {
  const errs: CommissionErrors = {};
  const p = positivePercentage(opts.production, 'Production commission');
  if (p) errs.production = p;
  const b = positivePercentage(opts.briefing, 'Briefing commission');
  if (b) errs.briefing = b;
  const a = positivePercentage(opts.approval, 'Approval commission');
  if (a) errs.approval = a;
  return errs;
}

/**
 * Commission cap (Flutter `add_service_actions` / `handleNewInternalPurchaseSubmit`):
 * prod + briefing + approval + max(sales) must be *below* the global agency
 * commission. Returns the toast message when the cap is reached/exceeded.
 */
export function commissionCapError(opts: {
  production: string;
  briefing: string;
  approval: string;
  maxSales?: number;
  agencyCommission: number;
}): string | null {
  const total =
    (Number(opts.production) || 0) + (Number(opts.briefing) || 0) + (Number(opts.approval) || 0) + (opts.maxSales ?? 0);
  if (total >= opts.agencyCommission) {
    return `Total commissions (${total}%) cannot reach or exceed agency commission (${opts.agencyCommission}%)`;
  }
  return null;
}

/* ── contractor budget ───────────────────────────────────────────────────── */

interface VariantDiff {
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

function minVariantDiff(variants: VariantDiff[], isRecurring: boolean, isBillingRecurring: boolean): number {
  if (!variants.length) return 0;
  const vals = variants.map((v) =>
    isRecurring
      ? v.recurringWeeklyDifference ?? 0
      : isBillingRecurring
        ? v.recurringUpfrontDifference ?? 0
        : v.oneOffUpfrontDifference ?? 0,
  );
  return Math.min(...vals);
}

/**
 * `add_service` contractor-budget validator (`validateContractorBudget`).
 * Percentage mode caps at the remaining commission budget; dollar mode caps at
 * `maxPercentage%` of the effective base price (base price + the smallest variant
 * price difference). Returns null when valid. Run AFTER `positivePrice`.
 */
export function serviceBudgetValidator(
  value: string,
  opts: {
    isPercentage: boolean;
    isRecurring: boolean;
    isBillingRecurring: boolean;
    price: string;
    upfrontFee: string;
    recurringFee: string;
    maxPercentage: number;
    variants: VariantDiff[];
  },
): string | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return 'Invalid Number';
  const { maxPercentage } = opts;
  if (opts.isPercentage) {
    if (n > maxPercentage) return `Max ${clampPct(maxPercentage)}%`;
  } else {
    const basePriceString = opts.isRecurring ? opts.recurringFee : opts.isBillingRecurring ? opts.upfrontFee : opts.price;
    const basePrice = Number(basePriceString) || 0;
    if (basePrice <= 0 && n > 0) return 'Set price first';
    const effectiveBasePrice = basePrice + minVariantDiff(opts.variants, opts.isRecurring, opts.isBillingRecurring);
    const maxAmount = (maxPercentage / 100) * effectiveBasePrice;
    if (n > maxAmount) return `Max ${maxAmount < 0 ? '$0' : asMaybePrice(maxAmount)} (${clampPct(maxPercentage)}%)`;
  }
  return null;
}

/**
 * `new_internal_purchase` / custom-service contractor-budget validator
 * (`custom_service_form._validateBudget`). Like {@link serviceBudgetValidator}
 * but without variants, and the dollar cap is skipped for non-billable projects.
 */
export function projectBudgetValidator(
  value: string,
  opts: {
    isPercentage: boolean;
    isRecurring: boolean;
    isBillingRecurring: boolean;
    isBillable: boolean;
    price: string;
    upfrontFee: string;
    recurringFee: string;
    maxPercentage: number;
  },
): string | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isNaN(n)) return 'Invalid Number';
  const { maxPercentage } = opts;
  if (opts.isPercentage) {
    if (n > maxPercentage) return `Max ${clampPct(maxPercentage)}%`;
  } else {
    if (!opts.isBillable) return null;
    const basePriceString = opts.isRecurring ? opts.recurringFee : opts.isBillingRecurring ? opts.upfrontFee : opts.price;
    const basePrice = Number(basePriceString) || 0;
    if (basePrice <= 0) return 'Set price first';
    const maxAmount = (maxPercentage / 100) * basePrice;
    if (n > maxAmount) return `Max ${maxAmount < 0 ? '0' : asMaybePrice(maxAmount)} (${clampPct(maxPercentage)}%)`;
  }
  return null;
}

/* ── tasks ───────────────────────────────────────────────────────────────── */

export interface TaskErrors {
  taskName?: string;
  projectDuration?: string;
  contractorBudget?: string;
  estimatedDuration?: string;
  repeatsEvery?: string;
  frequency?: string;
}

/**
 * Ports `ServiceTaskSection`'s field validators. `taskName` and `contractorBudget`
 * are always required; `projectDuration` / `estimatedDuration` are required only
 * when `boxed` (the `add_service` dialog), optional otherwise. The recurring block
 * additionally requires `repeatsEvery` (≥1) and a `frequency`.
 */
export function validateTask(opts: {
  state: TaskState;
  mode: 'upfront' | 'recurring';
  boxed: boolean;
  frequency?: DeliverableFrequency | '';
  /** Extra validator chained after `positivePrice` on the contractor budget. */
  budgetValidator?: (v: string) => string | null;
}): TaskErrors {
  const { state, mode, boxed } = opts;
  const errs: TaskErrors = {};

  const nameErr = required(state.taskName, 'Task Name');
  if (nameErr) errs.taskName = nameErr;

  if (!(!boxed && state.projectDuration.trim() === '')) {
    const e = positiveInteger(state.projectDuration, 'Duration');
    if (e) errs.projectDuration = e;
  }

  let budgetErr = positivePrice(state.contractorBudget, 'Contractor Budget');
  if (!budgetErr && opts.budgetValidator) budgetErr = opts.budgetValidator(state.contractorBudget);
  if (budgetErr) errs.contractorBudget = budgetErr;

  if (!(!boxed && state.estimatedDuration.trim() === '')) {
    const e = positivePrice(state.estimatedDuration, 'Contractor Duration');
    if (e) errs.estimatedDuration = e;
  }

  if (mode === 'recurring') {
    const r = greaterThanOneInteger(state.repeatsEvery, 'Duration');
    if (r) errs.repeatsEvery = r;
    if (opts.frequency == null || opts.frequency === '') errs.frequency = 'Frequency is required';
  }

  return errs;
}
