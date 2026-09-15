/**
 * Marketplace pricing math. Ports `BillingService` and the checkout subtotal
 * logic from `lib/src/features/infin8/presentation/checkout_screen.dart` and
 * `lib/src/shared/services/billing_service.dart`.
 *
 * Services split into:
 *  - one-off  → charged once (the `price` field)
 *  - recurring (weekly billing cycle) → an upfront/setup fee (`upfrontFee`)
 *    charged once, plus a recurring weekly fee (`recurringFee` ?? `price`).
 * Delivery fees (`upfrontDeliveryFee`, `recurringDeliveryFee`) are added on top.
 * Variants/add-ons carry per-line price *differences* folded into each bucket.
 */
import { isBillingCycleWeekly, type ServiceType } from '../../lib/service-type.js';
import { formatNumber } from '../../lib/num.js';

export interface ServiceVariant {
  id: string;
  options?: Record<string, string>;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

export interface SelectedAddon {
  id: string;
  name?: string;
  oneOffUpfrontDifference?: number;
  recurringUpfrontDifference?: number;
  recurringWeeklyDifference?: number;
}

/** Minimal service shape needed for pricing (subset of the services row). */
export interface PriceableService {
  type: string | null;
  price: string | number | null;
  upfrontFee: string | number | null;
  recurringFee: string | number | null;
  upfrontDeliveryFee: string | number | null;
  recurringDeliveryFee: string | number | null;
  variants?: unknown[] | null;
}

export interface CartLineInput {
  service: PriceableService;
  quantity: number;
  selectedVariantId?: string | null;
  selectedAddons?: SelectedAddon[];
}

export interface BillingSubtotals {
  /** One-off charges due today (incl. recurring setup/upfront + delivery). */
  oneOffSubtotal: number;
  /** Recurring upfront / setup fees (charged once, today). */
  recurringUpfrontTotal: number;
  /** Recurring weekly fees (the per-cycle subscription amount). */
  recurringWeeklyTotal: number;
}

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
const isWeekly = (s: PriceableService) => isBillingCycleWeekly(s.type as ServiceType | null);

/** Resolve a variant's price differences for a line. */
function variantDiff(service: PriceableService, variantId?: string | null) {
  if (!variantId) return { one: 0, recUp: 0, recWk: 0 };
  const v = ((service.variants ?? []) as ServiceVariant[]).find((x) => x.id === variantId);
  return {
    one: v?.oneOffUpfrontDifference ?? 0,
    recUp: v?.recurringUpfrontDifference ?? 0,
    recWk: v?.recurringWeeklyDifference ?? 0,
  };
}

/** Compute split subtotals across cart lines (mirrors checkout_screen.dart). */
export function computeSubtotals(lines: CartLineInput[]): BillingSubtotals {
  let oneOff = 0;
  let recUp = 0;
  let recWk = 0;
  for (const line of lines) {
    const qty = Math.max(1, line.quantity || 1);
    const s = line.service;
    const vd = variantDiff(s, line.selectedVariantId);
    let extraOne = vd.one;
    let extraRecUp = vd.recUp;
    let extraRecWk = vd.recWk;
    for (const a of line.selectedAddons ?? []) {
      extraOne += a.oneOffUpfrontDifference ?? 0;
      extraRecUp += a.recurringUpfrontDifference ?? 0;
      extraRecWk += a.recurringWeeklyDifference ?? 0;
    }

    if (isWeekly(s)) {
      recUp += (num(s.upfrontFee) + num(s.upfrontDeliveryFee) + extraRecUp) * qty;
      // recurringFee takes precedence over price for recurring items.
      const weekly = s.recurringFee != null ? num(s.recurringFee) : num(s.price);
      recWk += (weekly + num(s.recurringDeliveryFee) + extraRecWk) * qty;
    } else {
      oneOff += (num(s.price) + num(s.upfrontDeliveryFee) + extraOne) * qty;
    }
  }
  return { oneOffSubtotal: oneOff, recurringUpfrontTotal: recUp, recurringWeeklyTotal: recWk };
}

/**
 * Per-line total stored in the `purchase_items.lineTotal` column — the one-time
 * money actually collected at checkout for this line, and the cycle-1 commission
 * basis (`generatePayoutsForPurchase`). For a one-off that's the full price; for
 * a recurring item it's the setup/upfront fee ONLY.
 *
 * The recurring weekly is deliberately EXCLUDED: it's collected and
 * commission-split per cycle (the day-7+ `subscription_cycle` invoices →
 * `generateCyclePayouts`), so bundling the first week in here would both
 * double-count it in payouts and overstate the order-history line ($110 when
 * only $100 is charged today).
 */
export function computeLineTotal(line: CartLineInput): number {
  const qty = Math.max(1, line.quantity || 1);
  const s = line.service;
  const vd = variantDiff(s, line.selectedVariantId);
  let extraOne = vd.one;
  let extraRecUp = vd.recUp;
  for (const a of line.selectedAddons ?? []) {
    extraOne += a.oneOffUpfrontDifference ?? 0;
    extraRecUp += a.recurringUpfrontDifference ?? 0;
  }
  if (isWeekly(s)) {
    // Setup/upfront only — equals `recurring.upfront` from computeLineAmount and
    // the one-time line buildCheckoutLineItems charges today. The weekly is
    // billed (and split) on its own cycle.
    return (num(s.upfrontFee) + num(s.upfrontDeliveryFee) + extraRecUp) * qty;
  }
  return (num(s.price) + num(s.upfrontDeliveryFee) + extraOne) * qty;
}

/** Rich per-line amount snapshot (mirrors Flutter PurchaseItem.amount). Frozen
 * onto the purchase item + project so downstream (contractor budget, completion
 * email, per-item subscription weekly) has a real figure to read. */
export interface LineAmount {
  recurring: { upfront: number; weeklyAfter: number };
  oneOff: { upfront: number; weeklyAfter: number; numberOfWeeks: number };
  oneOffTotal: number;
}

function lineExtras(line: CartLineInput) {
  const vd = variantDiff(line.service, line.selectedVariantId);
  let one = vd.one;
  let recUp = vd.recUp;
  let recWk = vd.recWk;
  for (const a of line.selectedAddons ?? []) {
    one += a.oneOffUpfrontDifference ?? 0;
    recUp += a.recurringUpfrontDifference ?? 0;
    recWk += a.recurringWeeklyDifference ?? 0;
  }
  return { one, recUp, recWk };
}

const ceil2 = (n: number) => Math.ceil(n * 100) / 100;

/** A payment plan's instalment knobs — the minimal structural shape both the
 * marketplace `PaymentPlan` and the proposal's local plan type satisfy. */
type InstalmentPlan = { upfrontPercentage?: number; interestRate?: number; durationWeeks?: number };

/**
 * Split a one-off total into a deposit-due-today + weekly instalments under a
 * payment plan (flat interest on the balance). Returns the pay-in-full shape
 * (the whole total upfront, no instalments) when there is no plan. Shared by the
 * marketplace ({@link computeLineAmount}) and proposal per-item amount builders
 * so both produce the identical `oneOff` split the cloud function does.
 */
export function splitOneOffByPlan(
  oneOffTotal: number,
  plan?: InstalmentPlan | null,
): { upfront: number; weeklyAfter: number; numberOfWeeks: number } {
  const durationWeeks = plan?.durationWeeks ?? 0;
  if (!plan || durationWeeks <= 0) return { upfront: oneOffTotal, weeklyAfter: 0, numberOfWeeks: 0 };
  const interest = plan.interestRate ?? 0;
  const totalWithInterest = ceil2(oneOffTotal * (1 + interest / 100));
  const upfront = ceil2(totalWithInterest * ((plan.upfrontPercentage ?? 0) / 100));
  const instalment = ceil2((totalWithInterest - upfront) / durationWeeks);
  return { upfront, weeklyAfter: instalment, numberOfWeeks: durationWeeks };
}

/**
 * Per-line rich amount object (one-off vs recurring split), quantity-scaled.
 * 1:1 port of the cloud function's per-item amount (`billing_service.ts`
 * `computePayInFull`/`computePaymentPlan`, consumed by `stripe_service.ts`):
 *
 * - Recurring (weekly-billed) items IGNORE the payment plan — they always bill
 *   `recurring.upfront` (setup, today) + `recurring.weeklyAfter` (forever).
 * - One-off items under a payment plan split into `oneOff.upfront` (deposit,
 *   today) + `oneOff.weeklyAfter` × `numberOfWeeks` instalments. Without a plan
 *   the whole one-off is `oneOff.upfront`.
 *
 * `buildCheckoutLineItems` reads these fields to emit the matching Stripe lines,
 * so the instalment weekly line only exists when this populates it.
 */
export function computeLineAmount(line: CartLineInput, plan?: PaymentPlan | null): LineAmount {
  const qty = Math.max(1, line.quantity || 1);
  const s = line.service;
  const { one, recUp, recWk } = lineExtras(line);
  if (isWeekly(s)) {
    const weekly = s.recurringFee != null ? num(s.recurringFee) : num(s.price);
    return {
      recurring: {
        upfront: (num(s.upfrontFee) + num(s.upfrontDeliveryFee) + recUp) * qty,
        weeklyAfter: (weekly + num(s.recurringDeliveryFee) + recWk) * qty,
      },
      oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
      oneOffTotal: 0,
    };
  }
  const oneOffTotal = (num(s.price) + num(s.upfrontDeliveryFee) + one) * qty;
  return {
    recurring: { upfront: 0, weeklyAfter: 0 },
    oneOff: splitOneOffByPlan(oneOffTotal, plan),
    oneOffTotal,
  };
}

/** Per-line recurring weekly fee (the per-item Stripe subscription amount). */
export function computeLineWeekly(line: CartLineInput): number {
  return computeLineAmount(line).recurring.weeklyAfter;
}

export interface PaymentPlan {
  id?: string;
  name: string;
  upfrontPercentage: number;
  interestRate?: number;
  durationWeeks: number;
}

export interface PaymentPlanBreakdown {
  planLabel: string;
  /** Amount charged today (recurring upfront + one-off upfront portion). */
  upfront: number;
  /** Weekly amount during the instalment window. */
  weeklyDuring: number;
  /** Weekly amount after instalments end (recurring weekly only). */
  weeklyAfter: number;
  durationWeeks: number | null;
}

/** Pay-in-Full: whole one-off + recurring upfront due today, no instalments. */
export function computePayInFull(s: BillingSubtotals): PaymentPlanBreakdown {
  return {
    planLabel: 'Pay in Full',
    upfront: s.recurringUpfrontTotal + s.oneOffSubtotal,
    weeklyDuring: 0,
    weeklyAfter: s.recurringWeeklyTotal,
    durationWeeks: null,
  };
}

/** Instalment plan: flat interest on the one-off balance after the upfront %. */
export function computePaymentPlan(s: BillingSubtotals, plan: PaymentPlan): PaymentPlanBreakdown {
  const interest = plan.interestRate ?? 10;
  const totalWithInterest = s.oneOffSubtotal * (1 + interest / 100);
  const oneOffUpfront = totalWithInterest * (plan.upfrontPercentage / 100);
  const remaining = totalWithInterest - oneOffUpfront;
  const instalment = plan.durationWeeks > 0 ? remaining / plan.durationWeeks : 0;
  return {
    planLabel: `${plan.name} (${formatNumber(interest)}% flat)`,
    upfront: s.recurringUpfrontTotal + oneOffUpfront,
    weeklyDuring: s.recurringWeeklyTotal + instalment,
    weeklyAfter: s.recurringWeeklyTotal,
    durationWeeks: plan.durationWeeks,
  };
}
