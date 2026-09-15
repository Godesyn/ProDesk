/**
 * Price shown on the Kanban card + summed in the column header for the project's
 * current billing cycle — a 1:1 port of ProjectModel.cyclePrice
 * (project_model.dart) and the canonical source of truth for "what does this
 * project cost this cycle". Internal projects bill the contractor budget;
 * otherwise the first cycle is the upfront total (one-off + recurring upfront)
 * and later cycles fall back to the recurring weekly amount. PurchaseAmount
 * sub-fields all default to 0, matching the Freezed model defaults.
 *
 * Used by both the Kanban board card and the project detail header so they can
 * never disagree.
 */
import { formatPrice } from '../../lib/utils';

export interface CyclePriceProject {
  isInternal?: boolean | null;
  contractorBudget?: string | null;
  amount?: unknown;
  cycleCount?: number | null;
}

export function cyclePrice(project: CyclePriceProject): number {
  if (project.isInternal && project.contractorBudget != null) {
    return Number(project.contractorBudget) || 0;
  }
  const a = (project.amount ?? {}) as any;
  const recurring = a.recurring ?? {};
  const oneOff = a.oneOff ?? {};
  const cycleCount = project.cycleCount ?? 0;
  if (cycleCount <= 1) {
    return Number(a.oneOffTotal ?? 0) + Number(recurring.upfront ?? 0);
  }
  if (cycleCount <= Number(oneOff.numberOfWeeks ?? 0)) {
    return Number(oneOff.weeklyAfter ?? 0) + Number(recurring.weeklyAfter ?? 0);
  }
  return Number(recurring.weeklyAfter ?? 0);
}

/**
 * One-line price summary for a project — the canonical "what this project costs
 * this cycle" amount, formatted as money (`$1,234`, no trailing `.00`). Projects
 * bill per cycle rather than as an upfront + weekly split, so this reuses
 * {@link cyclePrice} instead of the `$100 + $10 per week` shape used for
 * services/packages/proposals.
 */
export function projectPriceSummary(project: CyclePriceProject): string {
  return formatPrice(cyclePrice(project));
}
