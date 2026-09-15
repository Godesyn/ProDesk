/**
 * payment-model-calc.ts
 * Pure, side-effect-free functions for calculating payment totals, installment
 * schedules, and subscription pricing across the Payments (EziQuotes) tool.
 * Ported near-verbatim from the Manus export's shared/paymentModelCalc.ts.
 *
 * Used by:
 *  - the proposal builder / public proposal frontends (clients/payments)
 *  - installments + payments routers
 *  - PDF receipts, email templates, admin stats, client portal
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentModel = 'one_off' | 'subscription' | 'payment_plan' | 'dual_option';

export type BillingCycle = 'weekly' | 'fortnightly' | 'monthly' | 'quarterly' | 'annually';

export interface LineItem {
  /** Display name */
  name: string;
  /** Unit price in cents */
  unitPriceCents: number;
  /** Quantity (default 1) */
  qty?: number;
  /** Optional discount percentage 0–100 */
  discountPct?: number;
}

export interface PaymentConfig {
  /** Number of installments (payment_plan) */
  installments?: number;
  /** Billing cycle (subscription or payment_plan) */
  billingCycle?: BillingCycle;
  /** Setup fee in cents (subscription) */
  setupFeeCents?: number;
  /** Trial period in days (subscription) */
  trialDays?: number;
}

export interface PaymentSummary {
  /** Sum of all line-item subtotals before tax/fees (cents) */
  subtotalCents: number;
  /** Tax amount in cents */
  taxCents: number;
  /** Total including tax (cents) */
  totalCents: number;
  /** Platform fee in cents (rate applied on ex-GST subtotal) */
  platformFeeCents: number;
  /** Amount the merchant receives after platform fee (cents) */
  merchantNetCents: number;
}

export interface InstallmentSummary extends PaymentSummary {
  /** Number of installments */
  count: number;
  /** Amount per installment (cents) — last installment may differ by remainder */
  perInstallmentCents: number;
  /** Remainder added to the last installment (cents) */
  remainderCents: number;
  /** Human-readable label e.g. "3 × $1,000 / month" */
  label: string;
}

export interface SubscriptionSummary extends PaymentSummary {
  /** Recurring amount per billing cycle (cents) */
  recurringCents: number;
  /** Setup fee (cents) — 0 if none */
  setupFeeCents: number;
  /** Trial period in days — 0 if none */
  trialDays: number;
  /** Human-readable label e.g. "$500 / month" */
  label: string;
}

// ---------------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------------

/** @deprecated Use calcPlatformFeeOnSubtotal with a live rate instead. */
const PLATFORM_FEE_RATE = 0.01; // legacy fallback — do not use in new code

/**
 * Calculate the subtotal for a single line item (after per-item discount).
 */
export function lineItemSubtotal(item: LineItem): number {
  const qty = item.qty ?? 1;
  const gross = item.unitPriceCents * qty;
  const discount = item.discountPct ? gross * (item.discountPct / 100) : 0;
  return Math.round(gross - discount);
}

/**
 * Sum all line items into a subtotal (cents).
 */
export function calcSubtotal(items: LineItem[]): number {
  return items.reduce((acc, item) => acc + lineItemSubtotal(item), 0);
}

/**
 * Calculate tax amount given a subtotal and a tax rate (e.g. 0.1 for 10% GST).
 */
export function calcTax(subtotalCents: number, taxRate: number): number {
  return Math.round(subtotalCents * taxRate);
}

/**
 * @deprecated Use calcPlatformFeeOnSubtotal instead.
 * Kept for backward compatibility only — computes fee on total (incorrect for GST scenarios).
 */
export function calcPlatformFee(amountCents: number): number {
  return Math.round(amountCents * PLATFORM_FEE_RATE);
}

/**
 * Calculate the platform fee on the ex-GST subtotal.
 * This is the correct calculation per the EziQuotes fee model:
 * the platform fee is charged on the vendor's revenue, not on the tax amount.
 *
 * @param subtotalCents  The ex-GST subtotal in cents
 * @param ratePercent    The tier rate as a percentage (e.g. 1.7 for 1.7%)
 */
export function calcPlatformFeeOnSubtotal(
  subtotalCents: number,
  ratePercent: number,
): number {
  return Math.round(subtotalCents * (ratePercent / 100));
}

/**
 * Build a full PaymentSummary from line items and a tax rate.
 *
 * Platform fee is calculated on the ex-GST subtotal (not the GST-inclusive total).
 * This matches the EziQuotes fee model: the platform fee is on vendor revenue, not tax.
 *
 * @param items           Line items
 * @param taxRate         Tax rate 0–1 (e.g. 0.1 for 10% GST). Default 0.
 * @param feeRatePercent  Platform fee rate as a percentage (e.g. 1.7 for 1.7%).
 *                        REQUIRED — there is no default. Callers MUST pass the live
 *                        tier rate from getLiveTierRates() or an explicit 0 when
 *                        computing a split on an already-stored total.
 *                        Omitting this argument throws a RangeError.
 */
export function calcPaymentSummary(
  items: LineItem[],
  taxRate = 0,
  feeRatePercent?: number,
): PaymentSummary {
  if (feeRatePercent === undefined || feeRatePercent === null) {
    throw new RangeError(
      'calcPaymentSummary: feeRatePercent is required. ' +
      'Pass the live tier rate from getLiveTierRates() (e.g. 1.7 for Grow). ' +
      'If you are splitting an already-stored total, pass 0 explicitly. ' +
      'There is no safe default — a missing rate is a billing error.',
    );
  }
  const subtotalCents = calcSubtotal(items);
  const taxCents = calcTax(subtotalCents, taxRate);
  const totalCents = subtotalCents + taxCents;
  // Fee is on subtotal (ex-GST) — NOT on the GST-inclusive total
  const platformFeeCents = calcPlatformFeeOnSubtotal(subtotalCents, feeRatePercent);
  return {
    subtotalCents,
    taxCents,
    totalCents,
    platformFeeCents,
    merchantNetCents: totalCents - platformFeeCents,
  };
}

// ---------------------------------------------------------------------------
// One-off payment
// ---------------------------------------------------------------------------

/**
 * Calculate summary for a one-off payment.
 *
 * @param items          Line items
 * @param taxRate        Tax rate 0–1 (e.g. 0.1 for 10% GST). Default 0.
 * @param feeRatePercent Platform fee rate as a percentage. REQUIRED — see calcPaymentSummary.
 */
export function calcOneOff(items: LineItem[], taxRate = 0, feeRatePercent?: number): PaymentSummary {
  if (feeRatePercent === undefined) {
    throw new RangeError(
      'calcOneOff: feeRatePercent is required. Pass the live tier rate (e.g. 1.7 for Grow).',
    );
  }
  return calcPaymentSummary(items, taxRate, feeRatePercent);
}

// ---------------------------------------------------------------------------
// Installment / payment plan
// ---------------------------------------------------------------------------

const BILLING_CYCLE_LABELS: Record<BillingCycle, string> = {
  weekly: 'week',
  fortnightly: 'fortnight',
  monthly: 'month',
  quarterly: 'quarter',
  annually: 'year',
};

/**
 * Calculate installment schedule summary.
 *
 * @param items       Line items
 * @param config      Payment config (installments count + billing cycle)
 * @param taxRate     Tax rate 0–1 (default 0)
 */
export function calcInstallments(
  items: LineItem[],
  config: PaymentConfig,
  taxRate = 0,
  feeRatePercent = 0,
): InstallmentSummary {
  // feeRatePercent defaults to 0 because calcInstallments is typically called
  // to split an already-stored totalCents (fee was applied at send time).
  // Pass the live tier rate explicitly if computing a fresh installment schedule.
  const base = calcPaymentSummary(items, taxRate, feeRatePercent);
  const count = config.installments ?? 3;
  const cycle = config.billingCycle ?? 'monthly';
  const perInstallmentCents = Math.floor(base.totalCents / count);
  const remainderCents = base.totalCents - perInstallmentCents * count;

  const cycleLabel = BILLING_CYCLE_LABELS[cycle] ?? cycle;
  const amountFormatted = formatCents(perInstallmentCents);
  const label = `${count} × ${amountFormatted} / ${cycleLabel}`;

  return {
    ...base,
    count,
    perInstallmentCents,
    remainderCents,
    label,
  };
}

// ---------------------------------------------------------------------------
// Subscription
// ---------------------------------------------------------------------------

/**
 * Calculate subscription summary.
 *
 * @param items       Line items (recurring charge per cycle)
 * @param config      Payment config (billingCycle, setupFeeCents, trialDays)
 * @param taxRate     Tax rate 0–1 (default 0)
 */
export function calcSubscription(
  items: LineItem[],
  config: PaymentConfig,
  taxRate = 0,
  feeRatePercent = 0,
): SubscriptionSummary {
  // feeRatePercent defaults to 0 because calcSubscription is typically called
  // to summarise an already-stored recurring amount (fee was applied at send time).
  // Pass the live tier rate explicitly if computing a fresh subscription summary.
  const base = calcPaymentSummary(items, taxRate, feeRatePercent);
  const cycle = config.billingCycle ?? 'monthly';
  const setupFeeCents = config.setupFeeCents ?? 0;
  const trialDays = config.trialDays ?? 0;

  const cycleLabel = BILLING_CYCLE_LABELS[cycle] ?? cycle;
  const amountFormatted = formatCents(base.totalCents);
  const label = `${amountFormatted} / ${cycleLabel}${setupFeeCents ? ` + ${formatCents(setupFeeCents)} setup` : ''}`;

  return {
    ...base,
    recurringCents: base.totalCents,
    setupFeeCents,
    trialDays,
    label,
  };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format cents as a currency string (default AUD, no symbol).
 * e.g. 150000 → "$1,500"
 */
export function formatCents(
  cents: number,
  currency = 'AUD',
  locale = 'en-AU',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Format cents as a plain number string without currency symbol.
 * e.g. 150000 → "1,500.00"
 */
export function formatCentsPlain(cents: number, locale = 'en-AU'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/**
 * Parse a display string like "$1,500" or "1500.00" back to cents.
 * Returns NaN if unparseable.
 */
export function parseCents(value: string): number {
  const cleaned = value.replace(/[^0-9.]/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return NaN;
  return Math.round(parsed * 100);
}

// ---------------------------------------------------------------------------
// Dual Option
// ---------------------------------------------------------------------------

export interface DualOptionSummary {
  /** Total value of the work (cents) */
  totalCents: number;
  /** Upfront discounted price (cents) — what payer pays if they choose upfront */
  upfrontCents: number;
  /** Discount amount in cents (totalCents - upfrontCents) */
  discountCents: number;
  /** Deposit amount for the payment plan path (cents) */
  depositCents: number;
  /** Remaining balance after deposit (cents) */
  remainingCents: number;
  /** Number of installments on the plan path (including deposit as first) */
  installments: number;
  /** Amount per installment on the plan path (cents, excluding deposit) */
  installmentCents: number;
  /** Platform fee on the upfront path (cents) */
  upfrontPlatformFeeCents: number;
  /** Platform fee on the deposit (cents) */
  depositPlatformFeeCents: number;
  /** Platform fee per installment (cents) */
  installmentPlatformFeeCents: number;
}

/**
 * Calculate dual_option payment summary.
 * @param totalCents - Total value of the work in cents (ex-GST subtotal for fee calculation)
 * @param discountPct - Upfront discount percentage (0–100)
 * @param depositPct - Deposit percentage for plan path (0 = equal installments)
 * @param installments - Total number of installments on plan path (min 2)
 * @param feeRatePercent - Platform fee rate (required, no default)
 */
export function calcDualOption(
  totalCents: number,
  discountPct: number,
  depositPct: number,
  installments: number,
  feeRatePercent: number,
): DualOptionSummary {
  if (feeRatePercent === undefined || feeRatePercent === null) {
    throw new RangeError('feeRatePercent is required — no default fallback');
  }
  const safeInstallments = Math.max(2, Math.round(installments));
  const upfrontCents = Math.round(totalCents * (1 - discountPct / 100));
  const discountCents = totalCents - upfrontCents;
  const depositCents = depositPct > 0
    ? Math.round(totalCents * depositPct / 100)
    : Math.round(totalCents / safeInstallments);
  const remainingCents = totalCents - depositCents;
  // Distribute remaining evenly across (installments - 1) post-deposit payments
  const postDepositCount = safeInstallments - 1;
  const installmentCents = postDepositCount > 0
    ? Math.round(remainingCents / postDepositCount)
    : remainingCents;
  // Platform fees
  const upfrontPlatformFeeCents = Math.round(upfrontCents * feeRatePercent / 100);
  const depositPlatformFeeCents = Math.round(depositCents * feeRatePercent / 100);
  const installmentPlatformFeeCents = Math.round(installmentCents * feeRatePercent / 100);
  return {
    totalCents,
    upfrontCents,
    discountCents,
    depositCents,
    remainingCents,
    installments: safeInstallments,
    installmentCents,
    upfrontPlatformFeeCents,
    depositPlatformFeeCents,
    installmentPlatformFeeCents,
  };
}

export function paymentModelLabel(model: PaymentModel): string {
  switch (model) {
    case 'one_off':
      return 'One-off Payment';
    case 'subscription':
      return 'Subscription';
    case 'payment_plan':
      return 'Payment Plan';
    case 'dual_option':
      return 'Dual Option (Upfront or Plan)';
    default:
      return model;
  }
}

// ---------------------------------------------------------------------------
// Proposal display string (model-aware, for SMS/email builders)
// ---------------------------------------------------------------------------

/**
 * Minimal proposal shape needed for getDisplayString.
 * Matches the DB row shape from the paymentProposals table.
 */
export interface ProposalForDisplay {
  paymentModel: string;
  totalCents: number;
  currency?: string;
  paymentConfig?: {
    installments?: number;
    billingCycle?: BillingCycle;
    setupFeeCents?: number;
  } | null;
}

/**
 * Returns a model-appropriate, human-readable payment summary string.
 *
 * Examples:
 *   one_off:      "$12,000 one-off"
 *   subscription: "$1,000/month" or "$500/week + $200 setup"
 *   payment_plan: "$3,600 deposit, then $2,800/month for 3 months"
 *
 * SMS and email builders MUST call this instead of formatting cents at call sites.
 */
export function getDisplayString(
  proposal: ProposalForDisplay,
  locale = 'en-AU',
): string {
  const { paymentModel, totalCents, currency = 'AUD', paymentConfig } = proposal;
  const fmt = (c: number) => formatCents(c, currency, locale);

  if (paymentModel === 'one_off') {
    return `${fmt(totalCents)} one-off`;
  }

  if (paymentModel === 'subscription') {
    const cycle = (paymentConfig?.billingCycle ?? 'monthly') as BillingCycle;
    const cycleLabel = BILLING_CYCLE_LABELS[cycle] ?? cycle;
    const setup = paymentConfig?.setupFeeCents ?? 0;
    const base = `${fmt(totalCents)}/${cycleLabel}`;
    return setup > 0 ? `${base} + ${fmt(setup)} setup` : base;
  }

  if (paymentModel === 'payment_plan' || paymentModel === 'pay_plan') {
    const count = paymentConfig?.installments ?? 3;
    const cycle = (paymentConfig?.billingCycle ?? 'monthly') as BillingCycle;
    const cycleLabel = BILLING_CYCLE_LABELS[cycle] ?? cycle;
    const setup = paymentConfig?.setupFeeCents ?? 0;
    // Remaining after deposit
    const remaining = totalCents - setup;
    const perInstallment = Math.floor(remaining / count);
    if (setup > 0) {
      return `${fmt(setup)} deposit, then ${fmt(perInstallment)}/${cycleLabel} for ${count} months`;
    }
    return `${fmt(perInstallment)}/${cycleLabel} for ${count} months`;
  }

  // Fallback
  return fmt(totalCents);
}
