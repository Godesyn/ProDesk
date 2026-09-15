/** Client mirror of server/src/modules/billing/pricing.ts (live cart pricing). */
import type { CartLine, MarketplaceService, PaymentPlan, ServiceVariant, SelectedAddon } from './types';
import { isBillingCycleWeekly, type ServiceType } from '@server/lib/service-type';
import { formatNumber, formatPrice, roundChargeUp } from '../../lib/utils';

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));
export const isWeekly = (s: MarketplaceService) => isBillingCycleWeekly(s.type as ServiceType | null);

/**
 * Port of `num.asMaybePrice` (double_extension.dart): `$1,234` or `$1,234.50`.
 * Delegates to the canonical {@link formatPrice} so every price reads the same;
 * a null/blank input collapses to `$0` (matching the Flutter default), not `—`.
 */
export function asMaybePrice(value: string | number | null | undefined): string {
  return formatPrice(num(value));
}

/**
 * Canonical one-line price summary: an upfront amount and/or a weekly amount,
 * joined as `$100 + $10 per week`. A pure one-off reads `$100`; a pure weekly
 * reads `$10 per week`; nothing priced reads `$0`. Every per-entity summary
 * below funnels through this so the wording is identical everywhere.
 */
export function priceSummary(upfront: number, weekly: number): string {
  const parts: string[] = [];
  if (upfront > 0) parts.push(asMaybePrice(upfront));
  if (weekly > 0) parts.push(`${asMaybePrice(weekly)} per week`);
  return parts.length ? parts.join(' + ') : asMaybePrice(0);
}

/**
 * One-line price summary for a single service (ports `ServiceModel.pricingBreakdown`).
 * Recurring services bill their upfront fee once plus the weekly fee; one-off
 * services bill their price once.
 */
export function servicePriceSummary(s: MarketplaceService): string {
  if (isWeekly(s)) {
    const weekly = s.recurringFee != null ? num(s.recurringFee) : num(s.price);
    return priceSummary(roundChargeUp(num(s.upfrontFee)), roundChargeUp(weekly));
  }
  return priceSummary(roundChargeUp(num(s.price)), 0);
}

/**
 * One-line price summary for a package's included services
 * (ports `AppPackageCard._getPricingBreakdown`): every one-off price + recurring
 * upfront fee falls into the upfront total; recurring weekly fees sum into the
 * weekly total.
 */
export function packagePriceSummary(
  services: { service: MarketplaceService; quantity: number }[],
): string {
  let oneOff = 0;
  let recurringUpfront = 0;
  let recurringWeekly = 0;
  for (const { service, quantity } of services) {
    const qty = quantity > 0 ? quantity : 1;
    if (isWeekly(service)) {
      recurringUpfront += num(service.upfrontFee) * qty;
      recurringWeekly += (service.recurringFee != null ? num(service.recurringFee) : num(service.price)) * qty;
    } else {
      oneOff += num(service.price) * qty;
    }
  }
  return priceSummary(roundChargeUp(oneOff + recurringUpfront), roundChargeUp(recurringWeekly));
}

/** @deprecated Use {@link servicePriceSummary}. */
export const servicePricingBreakdown = servicePriceSummary;
/** @deprecated Use {@link packagePriceSummary}. */
export const packagePricingBreakdown = packagePriceSummary;

function variantDiff(service: MarketplaceService, variantId?: string) {
  if (!variantId) return { one: 0, recUp: 0, recWk: 0 };
  const v = ((service.variants ?? []) as ServiceVariant[]).find((x) => x.id === variantId);
  return {
    one: v?.oneOffUpfrontDifference ?? 0,
    recUp: v?.recurringUpfrontDifference ?? 0,
    recWk: v?.recurringWeeklyDifference ?? 0,
  };
}

export interface LinePrice {
  oneOff: number;
  recurringUpfront: number;
  recurringWeekly: number;
  /** Display unit price (per item, first-cycle for recurring). */
  unit: number;
}

/** Compute the price contribution of one configured line (qty applied). */
export function priceLine(line: {
  service: MarketplaceService;
  quantity: number;
  selectedVariantId?: string;
  selectedAddons?: SelectedAddon[];
}): LinePrice {
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
    const weekly = s.recurringFee != null ? num(s.recurringFee) : num(s.price);
    const recUp = roundChargeUp((num(s.upfrontFee) + num(s.upfrontDeliveryFee) + extraRecUp) * qty);
    const recWk = roundChargeUp((weekly + num(s.recurringDeliveryFee) + extraRecWk) * qty);
    return { oneOff: 0, recurringUpfront: recUp, recurringWeekly: recWk, unit: recUp / qty + recWk / qty };
  }
  const oneOff = roundChargeUp((num(s.price) + num(s.upfrontDeliveryFee) + extraOne) * qty);
  return { oneOff, recurringUpfront: 0, recurringWeekly: 0, unit: oneOff / qty };
}

export interface Subtotals {
  oneOffSubtotal: number;
  recurringUpfrontTotal: number;
  recurringWeeklyTotal: number;
}

export function computeSubtotals(lines: CartLine[]): Subtotals {
  let oneOff = 0;
  let recUp = 0;
  let recWk = 0;
  for (const l of lines) {
    const p = priceLine(l);
    oneOff += p.oneOff;
    recUp += p.recurringUpfront;
    recWk += p.recurringWeekly;
  }
  return {
    oneOffSubtotal: roundChargeUp(oneOff),
    recurringUpfrontTotal: roundChargeUp(recUp),
    recurringWeeklyTotal: roundChargeUp(recWk),
  };
}

export interface PlanBreakdown {
  planLabel: string;
  upfront: number;
  weeklyDuring: number;
  weeklyAfter: number;
  durationWeeks: number | null;
}

export function computePayInFull(s: Subtotals): PlanBreakdown {
  return {
    planLabel: 'Pay in Full',
    upfront: roundChargeUp(s.recurringUpfrontTotal + s.oneOffSubtotal),
    weeklyDuring: 0,
    weeklyAfter: roundChargeUp(s.recurringWeeklyTotal),
    durationWeeks: null,
  };
}

export function computePaymentPlan(s: Subtotals, plan: PaymentPlan): PlanBreakdown {
  const interest = plan.interestRate ?? 10;
  const totalWithInterest = s.oneOffSubtotal * (1 + interest / 100);
  const oneOffUpfront = totalWithInterest * (plan.upfrontPercentage / 100);
  const remaining = totalWithInterest - oneOffUpfront;
  const instalment = plan.durationWeeks > 0 ? remaining / plan.durationWeeks : 0;
  return {
    planLabel: `${plan.name} (${formatNumber(interest)}% flat)`,
    upfront: roundChargeUp(s.recurringUpfrontTotal + oneOffUpfront),
    weeklyDuring: roundChargeUp(s.recurringWeeklyTotal + instalment),
    weeklyAfter: roundChargeUp(s.recurringWeeklyTotal),
    durationWeeks: plan.durationWeeks,
  };
}
