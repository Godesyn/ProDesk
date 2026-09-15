/**
 * Shared project-creation primitives — the single source of truth for how a
 * purchase item becomes a project. Every creation path (marketplace purchase,
 * proposal accept→pay, internal purchase/proposal) MUST go through
 * {@link buildProjectValues} so the project freezes the same commission /
 * config / cycle / deadline snapshot that Flutter's `purchase_fulfillment.ts`
 * and `on_*_written.ts` triggers wrote. Ports:
 *   • getProjectNextCycleAt            (purchase.model.ts)
 *   • initial-status decision          (purchase_fulfillment.ts)
 *   • per-project field freeze         (purchase_fulfillment.ts)
 *
 * Pure & dependency-light: no DB access here — callers pass the rows they've
 * loaded. Returns Drizzle insert values for the `projects` table.
 */
import type { projects, purchaseItems, purchases, agencies } from '../../db/schema.js';
import {
  hasDeliverableCycle,
  isDigital,
  type ServiceType,
} from '../../lib/service-type.js';
import {
  frequencyDays,
  type DeliverableFrequency,
} from '../../lib/deliverable-frequency.js';

type ProjectInsert = typeof projects.$inferInsert;
type PurchaseRow = typeof purchases.$inferSelect;
type PurchaseItemRow = typeof purchaseItems.$inferSelect;
type AgencyRow = typeof agencies.$inferSelect;

/** Subset of a `ServiceProjectConfig` we read when freezing a project. */
export interface ProjectConfigSnapshot {
  taskName?: string | null;
  projectDurationDays?: number | null;
  estimatedContractorDurationInHours?: number | null;
  contractorDefaultBudget?: number | null;
  contractorDefaultBudgetInPercentage?: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next deliverable-cycle date — 1:1 with Flutter `getProjectNextCycleAt`.
 * Anchored to `from` (the PREVIOUS cycle boundary), NOT `now`, so a recurring
 * schedule never drifts. Returns null for service types that don't cycle a
 * deliverable (subscription bills weekly but its project does not re-cycle).
 *
 * `repeatsEvery` is the count of frequency units per cycle, so "every 5 weeks"
 * = { frequency: 'weekly', repeatsEvery: 5 } and "fortnightly"/"quarterly" are
 * expressed as repeatsEvery 2 (weekly) / 3 (monthly) — there is no separate
 * fortnightly/quarterly value (Flutter `DeliverableFrequencyType`).
 */
export function projectNextCycleAt(opts: {
  type: ServiceType | null | undefined;
  deliverableFrequency: DeliverableFrequency | null | undefined;
  repeatsEvery?: number | null;
  from: Date;
}): Date | null {
  if (!hasDeliverableCycle(opts.type) || !opts.deliverableFrequency) return null;
  const every = opts.repeatsEvery && opts.repeatsEvery > 0 ? opts.repeatsEvery : 1;
  const next = new Date(opts.from);
  switch (opts.deliverableFrequency) {
    case 'daily':
      next.setDate(next.getDate() + every);
      break;
    case 'weekly':
      next.setDate(next.getDate() + 7 * every);
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + every);
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + every);
      break;
    default:
      // Unknown unit → treat as days (matches Flutter's default branch).
      next.setDate(next.getDate() + every);
      break;
  }
  return next;
}

export type InitialStatus = NonNullable<ProjectInsert['status']>;

/**
 * The project's first kanban status — ports the decision in
 * `purchase_fulfillment.ts`:
 *   • digital product            → `completed` (delivered by email, never enters the board)
 *   • delayed phase (recurring)  → `upcoming`  (starts when its phase begins)
 *   • has custom-field questions → `clientBrief` (buyer answers the brief first)
 *   • otherwise                  → `brief`     (agency prepares the brief)
 */
export function resolveInitialStatus(opts: {
  serviceType: ServiceType | null | undefined;
  hasCustomFields: boolean;
  isDelayedPhase?: boolean;
}): InitialStatus {
  if (isDigital(opts.serviceType)) return 'completed';
  if (opts.hasCustomFields) return 'clientBrief';
  if (opts.isDelayedPhase) return 'upcoming';
  return 'brief';
}

const cfg = (v: unknown): ProjectConfigSnapshot =>
  (v ?? {}) as ProjectConfigSnapshot;

/**
 * Resolve the frozen contractor budget for a project's FIRST cycle
 * (percentage → amount). Initial creation always uses the upfront config;
 * subsequent re-cycles apply the recurring config in recurring-schedule.ts.
 * Recurring is only a fallback here for services that define no upfront budget.
 */
function resolveContractorBudget(
  item: PurchaseItemRow,
  amount: Record<string, unknown> | null,
): number {
  const recurring = cfg(item.recurringProjectConfig);
  const upfront = cfg(item.upfrontProjectConfig);
  const inPercent =
    upfront.contractorDefaultBudgetInPercentage ??
    recurring.contractorDefaultBudgetInPercentage;
  const inAmount =
    upfront.contractorDefaultBudget ?? recurring.contractorDefaultBudget;
  if (inPercent) {
    const a = (amount ?? {}) as {
      recurring?: { upfront?: number };
      oneOffTotal?: number;
    };
    const base = (a.recurring?.upfront ?? 0) + (a.oneOffTotal ?? 0);
    return (base * inPercent) / 100;
  }
  return inAmount ?? 0;
}

/**
 * Build the Drizzle insert values for ONE project spawned from a purchase item.
 * This is the field-freeze: everything Flutter snapshots onto the project at
 * creation lives here, so no creation path can silently drop commission rates,
 * the payment plan, cycle schedule, deadline, contractor budget, configs, or
 * tags ever again.
 *
 * `now` is the project's createdAt (callers stagger it per item for stable
 * ordering). `isDelayedPhase` + `phaseStartDelayDays` come from the proposal
 * phase; `serviceHasCustomFields` from the source service.
 */
export function buildProjectValues(args: {
  purchase: PurchaseRow;
  item: PurchaseItemRow;
  agency: AgencyRow;
  source: 'marketplace' | 'proposal' | 'internal';
  serviceHasCustomFields: boolean;
  phaseStartDelayDays?: number | null;
  now: Date;
}): ProjectInsert {
  const { purchase, item, agency, source, now } = args;
  const serviceType = item.serviceType as ServiceType | null;
  const digital = isDigital(serviceType);
  const isDelayedPhase =
    !!args.phaseStartDelayDays && args.phaseStartDelayDays > 0;
  const hasCustomFields = args.serviceHasCustomFields;

  const status = resolveInitialStatus({
    serviceType,
    hasCustomFields,
    isDelayedPhase: source === 'proposal' && isDelayedPhase,
  });

  // nextCycleAt: a delayed phase starts when its phase begins; a recurring
  // (deliverable-cycling) project anchors its first re-cycle to the cycle
  // length from now. Everything else has no next cycle.
  const nextCycleAt =
    source === 'proposal' && isDelayedPhase
      ? new Date(now.getTime() + (args.phaseStartDelayDays ?? 0) * DAY_MS)
      : projectNextCycleAt({
          type: serviceType,
          deliverableFrequency: item.deliverableFrequency as DeliverableFrequency | null,
          repeatsEvery: item.repeatsEvery,
          from: now,
        });

  const upfront = cfg(item.upfrontProjectConfig);
  const amount = (item.amount ?? null) as Record<string, unknown> | null;

  // Sales-person commission: zero when the proposal was sent by the fulfilling
  // agency itself; otherwise the per-staff rate captured on the item.
  const sentBy = purchase.proposalSentById ?? '';
  const sentBySelf =
    source === 'proposal'
      ? purchase.proposalSentById === agency.ownerId
      : purchase.proposalSentByAgencyId === agency.id;
  const itemCommissions = (item.commissions ?? {}) as Record<string, number>;
  // Sales-person rates: marketplace freezes them on the item; proposals carry
  // them on the agency (keyed by the proposal sender). Item wins when present.
  const salesPersonCommissions = {
    ...((agency.salesPersonCommissions ?? {}) as Record<string, number>),
    ...((item.salesPersonCommissions ?? {}) as Record<string, number>),
  };

  const deadline =
    upfront.projectDurationDays && upfront.projectDurationDays > 0
      ? new Date(now.getTime() + upfront.projectDurationDays * DAY_MS)
      : null;

  const contractorBudget = resolveContractorBudget(item, amount);

  const tags: string[] = [
    ...(serviceType ? [serviceType] : []),
    source === 'proposal' ? 'proposal-purchase' : source === 'internal' ? 'internal-purchase' : 'marketplace-purchase',
    ...(item.phaseId ? ['phased-project'] : []),
    ...(isDelayedPhase ? ['delayed-start'] : []),
    ...(digital ? ['Digital Product'] : []),
  ];

  return {
    purchaseId: purchase.id,
    purchaseItemId: item.id,
    stripeSubscriptionItemId: item.stripeSubscriptionItemId ?? null,
    brandId: purchase.brandId,
    agencyId: item.agencyId,
    serviceId: item.serviceId,
    serviceName: item.serviceName,
    serviceType: item.serviceType,
    packageId: item.packageId,
    proposalSentById: source === 'proposal' ? (purchase.proposalSentById ?? null) : purchase.proposalSentById ?? null,
    proposalSentByAgencyId: purchase.proposalSentByAgencyId ?? null,
    title: item.serviceName ?? item.description ?? 'Project',
    description: item.description,
    amount: item.amount,
    status,
    isInternal: purchase.isInternal,
    viewableToBrand: !item.isExcludedByBrand,
    approvedAt: digital ? now : undefined,
    // ── Frozen snapshot ──
    commissions: {
      agencyCommission: Number(purchase.agencyCommission ?? 0),
      affiliateCommission: Number(purchase.affiliateCommission ?? 0),
      salesAgencyCommission: Number(purchase.salesAgencyCommission ?? 0),
      prodeskCommission: Number(purchase.prodeskCommission ?? 0),
      salesPersonCommission: sentBySelf ? 0 : (salesPersonCommissions[sentBy] ?? 0),
      productionManagerCommission: itemCommissions.productionManagerCommission ?? 0,
      briefingManagerCommission: itemCommissions.briefingManagerCommission ?? 0,
      internalApprovalCommission: itemCommissions.internalApprovalCommission ?? 0,
    },
    selectedPaymentPlan: purchase.selectedPaymentPlan ?? null,
    upfrontProjectConfig: item.upfrontProjectConfig,
    recurringProjectConfig: item.recurringProjectConfig,
    upfrontDeliveryFee: item.upfrontDeliveryFee,
    recurringDeliveryFee: item.recurringDeliveryFee,
    deliverableFrequency: item.deliverableFrequency,
    repeatsEvery: item.repeatsEvery,
    cycleCount: 1,
    nextCycleAt,
    deadline,
    taskTitle: upfront.taskName ?? null,
    estimatedContractorDurationInHours: upfront.estimatedContractorDurationInHours ?? null,
    contractorBudget: contractorBudget ? contractorBudget.toFixed(2) : null,
    selectedVariantId: item.selectedVariantId,
    selectedOptions: item.selectedOptions,
    selectedAddons: item.selectedAddons,
    tags,
    createdAt: now,
    updatedAt: now,
  };
}

/** How many projects a single purchase item spawns. Marketplace & internal
 * loop over quantity (one project per unit, Flutter parity); proposal items
 * always spawn exactly one project regardless of quantity. */
export function projectsPerItem(
  source: 'marketplace' | 'proposal' | 'internal',
  quantity: number | null | undefined,
): number {
  if (source === 'proposal') return 1;
  return Math.max(1, quantity ?? 1);
}

/**
 * Has every weekly payment due up to (and including) `cycleCount` actually been
 * collected? 1:1 with Flutter `PayoutHelperService.isPaymentMadeOnTimeForCycle`.
 *
 * Billing is ALWAYS weekly, but the deliverable cycle can be any length. A
 * completed recurring project must only re-open once the next cycle it's about
 * to enter has been paid for. `paidTill` = createdAt + paymentCount·7d; the
 * project's target cycle date = createdAt advanced by (cycleCount-1) cycles.
 * Eligible when that cycle date falls within what's been paid.
 */
export function isPaymentMadeOnTimeForCycle(
  paymentCount: number,
  cycleCount: number,
  opts: {
    type: ServiceType | null | undefined;
    createdAt: Date;
    deliverableFrequency: DeliverableFrequency | null | undefined;
    repeatsEvery?: number | null;
  },
): boolean {
  const paidTill = opts.createdAt.getTime() + paymentCount * 7 * DAY_MS;
  const cycleDate = projectNextCycleAt({
    type: opts.type,
    deliverableFrequency: opts.deliverableFrequency,
    repeatsEvery: (opts.repeatsEvery ?? 1) * (cycleCount - 1),
    from: opts.createdAt,
  });
  if (cycleDate == null) return false;
  return cycleDate.getTime() < paidTill;
}

/** Days in one deliverable-frequency unit (re-export for schedulers). */
export { frequencyDays };
