import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import {
  purchases,
  purchaseItems,
  projects,
  projectDeliverables,
  proposals,
  services,
  agencies,
  brands,
  users,
  globalSettings,
  payouts,
  payoutBreakdowns,
  invoices,
  invoiceItems,
} from '../../db/schema.js';
import { enqueueEmail } from '../../lib/notify.js';
import { partyColumns, type InvoicePartyRef } from './invoice-parties.js';
import { roundPayoutDown, roundChargeUp } from '../../lib/num.js';
import {
  buildProjectValues,
  projectsPerItem,
} from '../projects/fulfillment-core.js';
import {
  scheduleProjectCycle,
  runProjectCycle,
} from '../projects/recurring-schedule.js';
import {
  getSuperAdminIds,
  onProposalStatusChanged,
} from '../../routers/tasks.js';
import { generateInvoiceNumber } from '../../routers/proposals.js';
import { connectBrandToAgency } from '../connections/connect.js';
import {
  isBillingCycleWeekly,
  isDigital,
  hasDeliverableCycle,
  SERVICE_TYPES,
  type ServiceType,
} from '../../lib/service-type.js';
/** Service types whose project re-cycles a deliverable (Flutter hasDeliverableCycle). */
const DELIVERABLE_CYCLE_TYPES = SERVICE_TYPES.filter((t) =>
  hasDeliverableCycle(t),
);

/** Next Friday 23:59 (the payout cron window), in server local time. */
export function nextFriday(from = new Date()): Date {
  const d = new Date(from);
  const days = (5 - d.getDay() + 7) % 7 || 7; // upcoming Friday (never today)
  d.setDate(d.getDate() + days);
  d.setHours(23, 59, 0, 0);
  return d;
}

/** Brisbane is UTC+10 year-round (no DST). */
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

/**
 * Payout date (Brisbane-anchored): the first Friday on/after (now + 14 days), for
 * EVERY tier — priority, subscription AND non-priority.
 *
 * The 14-day wait is the brand's REFUND WINDOW: no payout — including the
 * non-priority affiliate / sales-agency cuts — may be dispatched before it closes,
 * or an external transfer would go out that we couldn't cleanly claw back if the
 * brand asked for a full refund. (This intentionally DIVERGES from the Flutter
 * payout_helper, which paid non-priority on the upcoming Friday; the refund-safety
 * rule is the newer, authoritative behaviour — see docs/commissions.md §2.)
 *
 * Computed at 00:00 Brisbane and returned as the equivalent UTC instant. The Friday
 * payout cron (Fri 23:59) then settles everything whose toPayAt has passed.
 */
export function payoutFriday(
  _tier: 'priority' | 'nonPriority' | 'subscription',
  from = new Date(),
): Date {
  // Every tier waits the 14-day refund buffer (see above); the tier argument is
  // retained for call-site intent and future flexibility but no longer changes the
  // base date — hence `_tier`.
  const addDays = 14;
  // Shift into Brisbane wall-clock so the UTC getters/setters read Brisbane time.
  const b = new Date(
    from.getTime() + BRISBANE_OFFSET_MS + addDays * 86_400_000,
  );
  const delta = (5 - b.getUTCDay() + 7) % 7; // days until Friday (0 = already Friday)
  b.setUTCDate(b.getUTCDate() + delta);
  b.setUTCHours(0, 0, 0, 0); // 00:00 Brisbane
  return new Date(b.getTime() - BRISBANE_OFFSET_MS);
}

type PayoutAs = 'admin' | 'owner' | 'staff' | 'contractor' | 'agency';
type PayoutTier = 'priority' | 'nonPriority';
interface SplitRow {
  amount: number;
  commissionType: string;
  role: string;
  /** Priority (owner + work designees) pays +14d; non-priority (platform/affiliate/sales) pays the upcoming Friday. */
  tier: PayoutTier;
  projectId: string | null;
  agencyId: string;
  serviceName: string | null;
  /** Proposal phase start offset (days). A delayed phase's initial payout is dated from its phase start, not fulfilment. */
  startDelayDays: number | null;
}
/**
 * One resolved beneficiary of a split run — EITHER a user (staff / affiliate /
 * contractor / super-admin) OR an agency (the agency itself receives the money in
 * its own bank account). `agencyId` here is the SOURCE/owning agency (context),
 * distinct from `beneficiaryAgencyId` which is the agency actually being paid.
 */
interface Beneficiary {
  kind: 'user' | 'agency';
  userId: string | null;
  beneficiaryAgencyId: string | null;
  roles: Set<string>;
  agencyId: string;
  /** The project this beneficiary bucket is scoped to (one payout per project). */
  projectId: string | null;
  /** Phase start offset (days) of this bucket's item — anchors a delayed phase's payout date. */
  startDelayDays: number | null;
  rows: SplitRow[];
}

/**
 * One beneficiary's resolved payout for a single split run — the pure result of
 * the commission split, before any DB write. `computePayoutSplit` returns these;
 * `runPayoutSplit` persists them and the future-earnings predictor maps them into
 * forecast rows (so the forecast can never drift from the live money math).
 */
export interface ComputedPayout {
  /** Set when the beneficiary is a USER; null when the beneficiary is an agency. */
  beneficiaryId: string | null;
  /** Set when the AGENCY itself receives this payout (its own bank account); else null. */
  beneficiaryAgencyId: string | null;
  as: PayoutAs;
  /** The source/owning agency of the services (context), NOT necessarily the payee. */
  agencyId: string;
  /**
   * The single project this payout is for. Payouts are split PER PROJECT (not
   * merged across a multi-project purchase) so each completed project dispatches
   * its share independently — a stuck sibling project can never hold up an
   * already-completed one (see docs/commissions.md §7 + dispatch.eligibleBreakdowns).
   * Null only for rows with no resolvable project (defensive).
   */
  projectId: string | null;
  total: number;
  status: 'paid' | 'upcoming';
  toPayAt: Date;
  rows: SplitRow[];
}

/** A from→to invoice the split produces (mirrors invoices_calculator.ts). */
interface InvoiceDraft {
  cycle: number;
  commissionType: string | null;

  fromParty: InvoicePartyRef;
  toParty: InvoicePartyRef;
  total: number;
  projectId: string | null;
  serviceName: string | null;
  selectedOptions: Record<string, string>;
  selectedAddons: unknown[];
  packageName: string | null;
  /** Beneficiary user whose payout this invoice is settled by, when applicable. */
  payoutBeneficiaryId: string | null;
}

/**
 * Generate payouts for a fulfilled purchase using the full per-role commission
 * split — ports payout_helper.ts (`getCommissions` + create{Priority,NonPriority}
 * Payouts + groupAndFormatPayouts) and oneoff_payout_calculator.getAllPayoutsByProject.
 *
 * Each item's gross (lineTotal = the one-time money collected at checkout: the
 * one-off price + recurring setup/upfront, NOT the recurring weekly) is split by:
 *   • global rates (global_settings): prodesk / agency / affiliate / sales %
 *   • service-level manager %s: production / briefing / internalApproval
 *   • agency salesperson % (only for proposal-sent purchases, sender ≠ agency)
 * The exact per-scenario routing (self-sent vs different-agency proposal vs
 * marketplace, and where the affiliate/sales cuts go or fall back to prodesk) is
 * defined in docs/commissions.md — that document is the single source of truth.
 * Prodesk takes the remainder after every other role. Each role resolves to a
 * beneficiary (designee staff → owner fallback; affiliate → referring user; sales →
 * sender / referred-by agency owner; prodesk → super admin) and breakdowns are
 * grouped into one payout per beneficiary. `as` = admin / owner / staff / contractor.
 *
 * Scope note: this generates the upfront payout at fulfillment, split over the
 * one-time money collected today (lineTotal = one-off + recurring setup). Every
 * recurring weekly payout — INCLUDING the first weekly (the day-7 `subscription_cycle`
 * invoice after the checkout trial) — and the payment-plan 5th-payment reimbursement
 * are driven by the subscription path (generateCyclePayouts), so the weekly is never
 * folded into lineTotal here. Payout dates now match Flutter
 * (payout_helper): priority/subscription settle +14d, non-priority the upcoming
 * Friday, anchored to 00:00 Brisbane — see `payoutFriday`.
 */
async function generatePayoutsForPurchase(purchaseId: string, db = defaultDb) {
  // Idempotency: never double-generate the initial payouts for a purchase.
  const existing = await db
    .select({ id: payouts.id })
    .from(payouts)
    .where(eq(payouts.purchaseId, purchaseId))
    .limit(1);
  if (existing.length) return;
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1)
  )[0];
  // Payment-plan one-offs defer the platform/affiliate/sales cut to the
  // reimbursement cycle (oneoff_payout_calculator); everything else pays in full.
  const tier = purchase?.selectedPaymentPlan ? 'priority' : 'all';
  await runPayoutSplit(
    purchaseId,
    {
      recurringOnly: false,
      week: 1,
      tier,
      grossOf: (it) => Number(it.lineTotal) || 0,
      // Delayed proposal phases settle from their phase start, not fulfilment.
      anchorToPhaseStart: true,
    },
    db,
  );
}

/** The first renewal cycle on which a payment-plan one-off begins releasing its deferred non-priority cut. */
export const REIMBURSEMENT_CYCLE = 5;

/**
 * The gross basis for the non-priority (platform/affiliate/sales) reimbursement
 * on a given payment-plan installment cycle. Spreads the deferred cut across the
 * installments instead of one cycle-5 lump (Flutter parity): cycle 5 reimburses
 * the backlog collected so far (upfront + installments through cycle 5), and each
 * later cycle reimburses that week's installment. The sum over cycles
 * [5 .. numberOfWeeks+1] equals the full one-off total, so the TOTAL non-priority
 * paid is identical to the old single-lump — only the timing is spread. Payment
 * plans cannot be cancelled (see projects.cancelSubscription guard), so every
 * reimbursement cycle is guaranteed to fire and the total is always realised.
 */
export function reimbursementGrossForItem(
  item: PurchaseItemRow,
  cycle: number,
): number {
  const oneOff = (
    item.amount as {
      oneOff?: {
        upfront?: number;
        weeklyAfter?: number;
        numberOfWeeks?: number;
      };
    } | null
  )?.oneOff;
  if (!oneOff) return 0;
  const weekly = Number(oneOff.weeklyAfter) || 0;
  const upfront = Number(oneOff.upfront) || 0;
  const n = Number(oneOff.numberOfWeeks) || 0;
  if (weekly <= 0 || n <= 0) return 0;
  if (cycle < REIMBURSEMENT_CYCLE) return 0;
  // Cycle 5 clears the backlog: the upfront + the installments collected through
  // cycle 5 (cycles 2..5 = REIMBURSEMENT_CYCLE-1 installments).
  if (cycle === REIMBURSEMENT_CYCLE)
    return upfront + (REIMBURSEMENT_CYCLE - 1) * weekly;
  if (cycle <= n + 1) return weekly;
  return 0;
}

/**
 * The one-off money COLLECTED so far that the non-priority trio is reimbursed from,
 * as of (and including) `cycle`. Zero before {@link REIMBURSEMENT_CYCLE} (the trio
 * is paid nothing in cycles 2..4 — their basis only opens at the backlog-clearing
 * cycle 5); from cycle 5 on it is the upfront plus every installment collected
 * through `cycle` (capped at the plan length). Used to subtract the agency's fixed
 * priority base from the trio's CUMULATIVE pool, so the base is absorbed over as
 * many cycles as it takes — see the `opts.reimbursement` branch of computePayoutSplit.
 */
export function reimbursementCollectedThrough(
  item: PurchaseItemRow,
  cycle: number,
): number {
  const oneOff = (
    item.amount as {
      oneOff?: {
        upfront?: number;
        weeklyAfter?: number;
        numberOfWeeks?: number;
      };
    } | null
  )?.oneOff;
  if (!oneOff) return 0;
  const weekly = Number(oneOff.weeklyAfter) || 0;
  const upfront = Number(oneOff.upfront) || 0;
  const n = Number(oneOff.numberOfWeeks) || 0;
  if (weekly <= 0 || n <= 0) return 0;
  if (cycle < REIMBURSEMENT_CYCLE) return 0;
  const installments = Math.min(cycle - 1, n);
  return upfront + installments * weekly;
}

/** Reimbursement cycle: release this installment's share of the deferred non-priority cut for a payment-plan one-off. */
export async function generateReimbursementPayouts(
  purchaseId: string,
  week: number,
  db = defaultDb,
) {
  await runPayoutSplit(
    purchaseId,
    {
      recurringOnly: false,
      week,
      tier: 'nonPriority',
      grossOf: (it) => reimbursementGrossForItem(it, week),
      reimbursement: true,
    },
    db,
  );
}

/**
 * Generate the per-role commission-split payouts for ONE recurring billing cycle
 * (cycles 2+). Called from advanceRecurringCycle on each subscription renewal —
 * the gross is each recurring item's weekly fee. Ports subscription_payout_calculator.
 */
export async function generateCyclePayouts(
  purchaseId: string,
  week: number,
  db = defaultDb,
) {
  await runPayoutSplit(
    purchaseId,
    {
      recurringOnly: true,
      week,
      grossOf: (it) => {
        const amt = it.amount as {
          recurring?: { weeklyAfter?: number };
          oneOff?: { weeklyAfter?: number };
        } | null;
        return (
          Number(
            amt?.recurring?.weeklyAfter ??
              amt?.oneOff?.weeklyAfter ??
              it.lineTotal,
          ) || 0
        );
      },
    },
    db,
  );
}

export type PurchaseItemRow = typeof purchaseItems.$inferSelect;

export interface PayoutSplitOpts {
  recurringOnly: boolean;
  week: number;
  grossOf: (item: PurchaseItemRow) => number;
  tier?: 'all' | 'priority' | 'nonPriority';
  /** Forecasting only: skip items whose project was cancelled/soft-deleted. */
  excludeCancelledProjects?: boolean;
  /**
   * Payment-plan reimbursement run: the non-priority trio absorbs ALL the plan
   * interest. The trio pool = collected − fixed priority base (subtracted once, on
   * REIMBURSEMENT_CYCLE), divided by non-priority rate share. See docs/commissions.md §2a.
   */
  reimbursement?: boolean;
  /**
   * Initial fulfilment run only: anchor each payout's date to its PROPOSAL PHASE
   * START (fulfilment + `item.startDelayDays`) before adding the 14-day refund
   * buffer — a delayed phase's work (and its refund window) only begins then. Off
   * for recurring/reimbursement cycles, which already fire after the phase started.
   */
  anchorToPhaseStart?: boolean;
}

export interface PayoutSplitResult {
  computedPayouts: ComputedPayout[];
  invoiceDrafts: InvoiceDraft[];
  brand: typeof brands.$inferSelect | null;
  brandId: string | null;
}

/**
 * Pure (no-write) commission split for ONE cycle: loads the purchase + entities,
 * runs the full per-role split (docs/commissions.md), and returns the resolved
 * per-beneficiary payouts + invoice drafts WITHOUT touching the DB. Shared by the
 * live writer (`runPayoutSplit`) and the future-earnings predictor — single
 * source of truth for the money math, so a forecast can never diverge from a real
 * payout. To change what gets PAID, change this; to change what gets WRITTEN,
 * change `runPayoutSplit`.
 */
export async function computePayoutSplit(
  purchaseId: string,
  opts: PayoutSplitOpts,
  db = defaultDb,
): Promise<PayoutSplitResult | null> {
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1)
  )[0];
  if (!purchase) return null;
  // Internal purchases carry no client revenue and zero commissions — they must
  // never generate payouts or commission-split invoices. In production these lived
  // in a separate `internal_purchase_history` collection the payout calculators
  // never read; after the collapse into one `purchases` table that exclusion has to
  // be explicit. This is the single chokepoint for every payout writer
  // (generatePayoutsForPurchase / generateCyclePayouts / generateReimbursementPayouts
  // via runPayoutSplit) and the future-earnings predictor (Track B), so guarding here
  // covers them all.
  if (purchase.isInternal) return null;

  const settings = (
    await db
      .select()
      .from(globalSettings)
      .where(eq(globalSettings.id, 1))
      .limit(1)
  )[0];
  const pct = (v: string | number | null | undefined) =>
    v ? Number(v) / 100 : 0;
  // Note: the prodesk (platform) cut is the remainder after every other role is
  // paid — mirrors oneoff_payout_calculator.getAllPayoutsByProject — so the global
  // prodesk rate is not applied directly here.
  //
  // Use the rates FROZEN onto the purchase at checkout, falling back to the live
  // global_settings only when a purchase predates the freeze. If the platform's
  // global rates change mid-plan, a recurring cycle / payment-plan reimbursement
  // must still split on the rates the buyer actually transacted under — otherwise
  // the reimbursement priority base (agencyRate × lineTotal) would no longer match
  // what was paid out at fulfilment, and the trio's interest math would drift.
  const agencyRate = pct(
    purchase.agencyCommission ?? settings?.agencyCommission,
  );
  const affiliateRate = pct(
    purchase.affiliateCommission ?? settings?.affiliateCommission,
  );
  const salesAgencyRate = pct(
    purchase.salesAgencyCommission ?? settings?.salesAgencyCommission,
  );

  const brand = purchase.brandId
    ? (
        await db
          .select()
          .from(brands)
          .where(eq(brands.id, purchase.brandId))
          .limit(1)
      )[0]
    : null;
  // Referral attribution (see docs/commissions.md): a referral is ALWAYS held on
  // the BRAND OWNER's user, never on the brand. The affiliate is the user who
  // referred the buyer to the platform (`referredByUserId`); the referred-by agency
  // (`referredByAgencyId`, set from the signup `?ref=`/subdomain) earns the sales
  // cut on a marketplace buy.
  const brandOwner = brand?.ownerId
    ? (
        await db
          .select()
          .from(users)
          .where(eq(users.id, brand.ownerId))
          .limit(1)
      )[0]
    : null;
  const affiliateUserId = brandOwner?.referredByUserId ?? null;
  const referredByAgency = brandOwner?.referredByAgencyId
    ? (
        await db
          .select()
          .from(agencies)
          .where(eq(agencies.id, brandOwner.referredByAgencyId))
          .limit(1)
      )[0]
    : null;
  const proposalSentByAgency = purchase.proposalSentByAgencyId
    ? (
        await db
          .select()
          .from(agencies)
          .where(eq(agencies.id, purchase.proposalSentByAgencyId))
          .limit(1)
      )[0]
    : null;
  const proposalSentById = purchase.proposalSentById ?? null;
  const superAdminId = (await getSuperAdminIds(db))[0] ?? null;

  let items = (
    await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, purchaseId))
  )
    .filter(
      (it) =>
        it.agencyId &&
        !(it.headingText && !it.serviceId) &&
        !it.isExcludedByBrand,
    )
    .filter(
      (it) =>
        !opts.recurringOnly ||
        it.isRecurring ||
        isBillingCycleWeekly(it.serviceType as ServiceType | null) ||
        !!it.deliverableFrequency,
    );
  // Forecasting only: drop items whose project is soft-deleted or whose cancel is
  // ALREADY EFFECTIVE (cancelledAt in the past) so the predictor never projects a
  // stopped subscription. A FUTURE cancelledAt is the committed tail (scheduled
  // cancel, spec §3) — it keeps billing until then, so it is kept here and the
  // predictor clamps its horizon to cancelledAt (spec §9.11). (Live writers leave
  // this opt off entirely.)
  if (opts.excludeCancelledProjects) {
    const projIds = items.map((i) => i.projectId).filter(Boolean) as string[];
    if (projIds.length) {
      const cancelled = await db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            inArray(projects.id, projIds),
            sql`((${projects.cancelledAt} is not null and ${projects.cancelledAt} <= now()) or ${projects.deletedAt} is not null)`,
          ),
        );
      const cancelledIds = new Set(cancelled.map((p) => p.id));
      if (cancelledIds.size)
        items = items.filter(
          (it) => !it.projectId || !cancelledIds.has(it.projectId),
        );
    }
  }
  const svcIds = [
    ...new Set(items.map((i) => i.serviceId).filter(Boolean)),
  ] as string[];
  const svcRows = svcIds.length
    ? await db.select().from(services).where(inArray(services.id, svcIds))
    : [];
  const svcMap = new Map(svcRows.map((s) => [s.id, s]));
  const agencyCache = new Map<string, typeof agencies.$inferSelect>();
  const getAgency = async (id: string) => {
    if (agencyCache.has(id)) return agencyCache.get(id)!;
    const a = (
      await db.select().from(agencies).where(eq(agencies.id, id)).limit(1)
    )[0];
    if (a) agencyCache.set(id, a);
    return a;
  };

  // Beneficiaries are keyed `user:<id>` or `agency:<id>` so a USER payout and an
  // AGENCY payout never collide, and the producing-agency cut and a different
  // sales-agency cut land in separate payouts.
  const byBeneficiary = new Map<string, Beneficiary>();
  const add = (
    userId: string | null | undefined,
    as: PayoutAs,
    row: SplitRow,
  ) => {
    if (!userId || row.amount <= 0) return;
    // Per-project key: a user's cuts for project A and project B become two
    // separate payouts so they dispatch on each project's own completion.
    const key = `user:${userId}:${row.projectId ?? 'none'}`;
    const b = byBeneficiary.get(key) ?? {
      kind: 'user' as const,
      userId,
      beneficiaryAgencyId: null,
      roles: new Set<string>(),
      agencyId: row.agencyId,
      projectId: row.projectId,
      startDelayDays: row.startDelayDays,
      rows: [],
    };
    b.roles.add(as);
    b.rows.push(row);
    byBeneficiary.set(key, b);
  };
  // Pay an AGENCY directly (its own bank account) — used for the agency-owner cut,
  // any designee commission redirected to the bank account, and the agency-sales
  // cut earned by a sales/referred-by agency.
  const addAgency = (
    beneficiaryAgencyId: string | null | undefined,
    row: SplitRow,
  ) => {
    if (!beneficiaryAgencyId || row.amount <= 0) return;
    const key = `agency:${beneficiaryAgencyId}:${row.projectId ?? 'none'}`;
    const b = byBeneficiary.get(key) ?? {
      kind: 'agency' as const,
      userId: null,
      beneficiaryAgencyId,
      roles: new Set<string>(),
      agencyId: row.agencyId,
      projectId: row.projectId,
      startDelayDays: row.startDelayDays,
      rows: [],
    };
    b.roles.add('agency');
    b.rows.push(row);
    byBeneficiary.set(key, b);
  };

  const invoiceDrafts: InvoiceDraft[] = [];

  for (const item of items) {
    const gross = opts.grossOf(item);
    if (gross <= 0) continue;
    const agency = await getAgency(item.agencyId!);
    if (!agency) continue;
    const svc = item.serviceId ? svcMap.get(item.serviceId) : null;

    const productionPct = pct(
      svc?.productionManagerCommission ?? agency.productionManagerCommission,
    );
    const briefingPct = pct(
      svc?.briefingManagerCommission ?? agency.briefingManagerCommission,
    );
    const approvalPct = pct(
      svc?.internalApprovalCommission ?? agency.internalApprovalCommission,
    );
    const salesPersonPct =
      proposalSentById && proposalSentByAgency?.id !== agency.id
        ? pct(
            (agency.salesPersonCommissions ?? {})[proposalSentById] as
              | number
              | undefined,
          )
        : 0;

    // ── Scenario routing (single source of truth: docs/commissions.md) ──────
    // AFFILIATE: the user who referred the buyer to the platform
    // (`referredByUserId`), paid directly. Never the fulfilling agency itself, and
    // dropped on a self-sent proposal. No recipient → folds into prodesk (remainder).
    const affiliateBeneficiaryId = affiliateUserId ?? null;
    const affiliateIsContractor = !!affiliateUserId;

    // Sold via a *different* agency's proposal → that sender agency earns the sales cut.
    const hasSalesAgency =
      !!proposalSentByAgency && proposalSentByAgency.ownerId !== agency.ownerId;
    // SELF-SENT proposal (Scenario 2): the producing agency is also the proposal
    // sender, so the buyer pays no third-party sales cut and no affiliate cut — the
    // agency keeps BOTH (nets 100% − prodesk by default), and the affiliate is
    // dropped even when the buyer was referred. Different-agency proposals and
    // marketplace buys are unaffected.
    const isSelfSentProposal =
      (!!purchase.proposalSentByAgencyId || !!proposalSentById) &&
      !hasSalesAgency;
    // MARKETPLACE buy (no proposal): the sales cut goes to the buyer's referred-by
    // agency when present, else falls back to prodesk (the remainder). The referral
    // lives on the brand OWNER's user, never the brand.
    const isMarketplace = !purchase.proposalSentByAgencyId && !proposalSentById;
    // The AGENCY (entity) that earns the agency-sales cut — it receives the money
    // in its own bank account, so the payout's beneficiary is this agency, not its
    // owner. null → no eligible sales agency (cut folds into prodesk).
    const salesBeneficiaryAgencyId = hasSalesAgency
      ? proposalSentByAgency!.id
      : isMarketplace &&
          referredByAgency &&
          referredByAgency.ownerId !== agency.ownerId
        ? referredByAgency.id
        : null;

    const hasAffiliate =
      !!affiliateBeneficiaryId &&
      affiliateBeneficiaryId !== agency.ownerId &&
      !isSelfSentProposal;

    // The freed sales + affiliate cuts fold into the producing agency's owner share
    // in a self-sent proposal; otherwise the owner keeps only the base agency rate.
    const keptSalesAgencyRate = isSelfSentProposal ? salesAgencyRate : 0;
    const keptAffiliateRate = isSelfSentProposal ? affiliateRate : 0;
    const ownerPct = Math.max(
      0,
      agencyRate +
        keptSalesAgencyRate +
        keptAffiliateRate -
        salesPersonPct -
        productionPct -
        briefingPct -
        approvalPct,
    );

    const ownerAmt = gross * ownerPct;
    const salesPersonAmt = gross * salesPersonPct;
    const productionAmt = gross * productionPct;
    const briefingAmt = gross * briefingPct;
    const approvalAmt = gross * approvalPct;

    let affiliateAmt: number;
    let salesAgencyAmt: number;
    let prodeskAmt: number;
    if (opts.reimbursement) {
      // ── Payment-plan reimbursement (docs/commissions.md §2a) ──────────────
      // The PRIORITY (agency) share was paid in full at fulfilment, on the bare
      // principal, with no interest. The non-priority trio (sales / affiliate /
      // Prodesk) waited until the reimbursement cycle and in return absorbs ALL
      // the plan interest. So the trio's pool is the gross collected this cycle
      // MINUS the fixed priority base — and that base is subtracted ONCE, on the
      // backlog-clearing cycle (REIMBURSEMENT_CYCLE): e.g. $52.53 backlog − $50
      // priority = $2.53 to the trio at cycle 5, then every later installment
      // flows to the trio in full. The pool is divided among the trio by each
      // role's share of the non-priority rate (1 − agencyRate), so nothing leaks.
      const nonPriorityRate = Math.max(0, 1 - agencyRate); // sales + affiliate + prodesk
      // Carry-forward priority base: the trio's CUMULATIVE pool through this cycle is
      // max(0, collected-so-far − priority base); this cycle's pool is the increment
      // over the previous cycle. Subtracting the base from the running cumulative
      // (rather than all-at-once at cycle 5) keeps the common case identical — when
      // the cycle-5 backlog already exceeds the base, cycle 5 still pays the full
      // backlog-minus-base and every later cycle pays its whole installment — but a
      // SMALL-DEPOSIT plan whose cycle-5 backlog is below the base now absorbs the
      // remainder across the following cycles instead of clamping to $0 and then
      // OVERPAYING the trio. Total trio = collected − base either way (no leak/overpay).
      const priorityBase = agencyRate * (Number(item.lineTotal) || 0);
      const throughNow = reimbursementCollectedThrough(item, opts.week);
      const throughPrev = reimbursementCollectedThrough(item, opts.week - 1);
      const pool =
        nonPriorityRate > 0
          ? Math.max(0, throughNow - priorityBase) -
            Math.max(0, throughPrev - priorityBase)
          : 0;
      affiliateAmt =
        hasAffiliate && nonPriorityRate > 0
          ? (pool * affiliateRate) / nonPriorityRate
          : 0;
      salesAgencyAmt =
        salesBeneficiaryAgencyId && nonPriorityRate > 0
          ? (pool * salesAgencyRate) / nonPriorityRate
          : 0;
      prodeskAmt = Math.max(0, pool - affiliateAmt - salesAgencyAmt);
    } else {
      affiliateAmt = hasAffiliate ? gross * affiliateRate : 0;
      salesAgencyAmt = salesBeneficiaryAgencyId ? gross * salesAgencyRate : 0;
      prodeskAmt = Math.max(
        0,
        gross -
          affiliateAmt -
          salesAgencyAmt -
          ownerAmt -
          salesPersonAmt -
          productionAmt -
          briefingAmt -
          approvalAmt,
      );
    }

    const meta = {
      agencyId: agency.id,
      projectId: item.projectId ?? null,
      serviceName: item.serviceName ?? null,
      startDelayDays: item.startDelayDays ?? null,
    };
    const row = (
      amount: number,
      commissionType: string,
      role: string,
      tier: PayoutTier,
    ): SplitRow => ({
      // PAYOUT → round DOWN to whole cents (never disburse more than collected).
      amount: roundPayoutDown(amount),
      commissionType,
      role,
      tier,
      ...meta,
    });

    // Commission-redirect flags route a designee commission to the agency
    // bank account (the owner) instead of the staff designee. When set, the
    // commission falls back to the owner regardless of the designee id —
    // mirrors WorkflowSettingsForm's redirectXxxCommissionToBankAccount.
    const productionDesignee = agency.redirectProductionCommissionToBankAccount
      ? null
      : (agency.allocationDesigneeId ?? null);
    const briefingDesignee = agency.redirectBriefingCommissionToBankAccount
      ? null
      : (agency.briefingDesigneeId ?? null);
    const approvalDesignee =
      agency.redirectInternalApprovalCommissionToBankAccount
        ? null
        : (agency.approvalDesigneeId ?? null);
    const salesPersonId = agency.redirectSalesPersonCommissionToBankAccount
      ? null
      : proposalSentById;

    // Payment-plan deferral: NON-PRIORITY (platform / affiliate / sales-agency) is
    // held back until the reimbursement cycle; PRIORITY (owner + designees) pays
    // out as work happens. `tier` selects which set this run emits.
    //
    // …BUT the deferral applies ONLY to one-off items. A RECURRING item's setup
    // fee (its `recurring.upfront`, carried as `lineTotal`) is collected in full at
    // checkout and is never on the payment plan, so it must ALWAYS split in full —
    // matching the Flutter subscription calculator, which splits the recurring
    // upfront across every role at subscription cycle 1 and never defers it
    // (billing_service.getAmountByProjectAndCycle: cycle ≤ 1 → recurring.upfront).
    // Without this, a payment-plan purchase that also has a recurring item would
    // defer the recurring setup's non-priority cut to the reimbursement cycle — but
    // reimbursement only ever revisits one-off items, so that cut is ORPHANED
    // (collected from the brand, owed on the invoice, paid to nobody).
    const itemIsRecurring =
      item.isRecurring ||
      isBillingCycleWeekly(item.serviceType as ServiceType | null);
    const tier = itemIsRecurring ? 'all' : (opts.tier ?? 'all');
    if (tier !== 'priority') {
      add(
        superAdminId,
        'admin',
        row(prodeskAmt, 'prodeskCommission', 'admin', 'nonPriority'),
      );
      if (hasAffiliate)
        add(
          affiliateBeneficiaryId!,
          affiliateIsContractor ? 'contractor' : 'owner',
          row(
            affiliateAmt,
            'affiliateCommission',
            affiliateIsContractor ? 'contractor' : 'owner',
            'nonPriority',
          ),
        );
      // Agency-sales cut → the SALES agency's own bank account (the agency entity,
      // not its owner). The payout's source `agencyId` stays the producing agency.
      if (salesBeneficiaryAgencyId)
        addAgency(
          salesBeneficiaryAgencyId,
          row(salesAgencyAmt, 'agencySalesCommission', 'agency', 'nonPriority'),
        );
    }
    if (tier !== 'nonPriority') {
      // Agency-owner cut → the producing agency's own bank account.
      addAgency(
        agency.id,
        row(ownerAmt, 'agencyOwnerCommission', 'agency', 'priority'),
      );
      // Each designee cut → that staff member's own account, OR the agency bank
      // account when there is no designee / the commission is redirected.
      if (salesPersonId)
        add(
          salesPersonId,
          'staff',
          row(salesPersonAmt, 'salesPersonCommission', 'staff', 'priority'),
        );
      else
        addAgency(
          agency.id,
          row(salesPersonAmt, 'salesPersonCommission', 'agency', 'priority'),
        );
      if (productionDesignee)
        add(
          productionDesignee,
          'staff',
          row(
            productionAmt,
            'productionManagerCommission',
            'staff',
            'priority',
          ),
        );
      else
        addAgency(
          agency.id,
          row(
            productionAmt,
            'productionManagerCommission',
            'agency',
            'priority',
          ),
        );
      if (briefingDesignee)
        add(
          briefingDesignee,
          'staff',
          row(briefingAmt, 'briefingManagerCommission', 'staff', 'priority'),
        );
      else
        addAgency(
          agency.id,
          row(briefingAmt, 'briefingManagerCommission', 'agency', 'priority'),
        );
      if (approvalDesignee)
        add(
          approvalDesignee,
          'staff',
          row(approvalAmt, 'internalApprovalCommission', 'staff', 'priority'),
        );
      else
        addAgency(
          agency.id,
          row(approvalAmt, 'internalApprovalCommission', 'agency', 'priority'),
        );
    }

    // ── Invoices (docs/invoices.md — the "collector" model) ─────────────────
    // The COLLECTOR is whoever bills the brand and holds the cash, and every
    // other party then settles against it: a DISTINCT sales agency (the proposal
    // sender, or the buyer's referred-by agency) when one exists — i.e. exactly
    // `salesBeneficiaryAgencyId` — otherwise Prodesk (self-sent proposal, or a
    // plain marketplace buy with no referrer). The collector keeps its own cut by
    // simply not being invoiced for it.
    const collectorAgencyId = salesBeneficiaryAgencyId; // null → Prodesk collects
    const collectorParty: InvoicePartyRef = collectorAgencyId
      ? { isProdesk: false, agencyId: collectorAgencyId }
      : { isProdesk: true };
    const itemOptions = (item.selectedOptions ?? {}) as Record<string, string>;
    const itemAddons = (item.selectedAddons ?? []) as unknown[];
    const inv = (
      total: number,
      fromParty: InvoicePartyRef,
      toParty: InvoicePartyRef,
      commissionType: string | null,
      payoutBeneficiaryId: string | null = null,
      // 'charge' (brand→prodesk, what we collect) rounds UP; 'payout' (every
      // commission obligation, what we disburse) rounds DOWN — so each invoice
      // mirrors the directional rounding of the money it records.
      kind: 'charge' | 'payout' = 'payout',
    ): void => {
      const rounded =
        kind === 'charge' ? roundChargeUp(total) : roundPayoutDown(total);
      if (rounded <= 0) return;
      invoiceDrafts.push({
        cycle: opts.week,
        commissionType,
        fromParty,
        toParty,
        total: rounded,
        projectId: item.projectId ?? null,
        serviceName: item.serviceName ?? null,
        selectedOptions: itemOptions,
        selectedAddons: itemAddons,
        packageName: null,
        payoutBeneficiaryId,
      });
    };

    // Which invoice legs this run may emit — mirrors the per-run payout gating so
    // each commission document is written EXACTLY ONCE over the lifecycle (ports
    // the Flutter calculator, where priority commissions are zeroed on cycles ≥5
    // so their invoices never regenerate):
    //   • reimbursement run = releasing the deferred non-priority commission only.
    //     The brand was already invoiced for this item at fulfilment, and the
    //     priority (agency-retained / designee) commissions were invoiced then too,
    //     so this run emits NEITHER — only the non-priority sales/affiliate legs.
    //   • payment-plan fulfilment (tier 'priority') defers the non-priority legs to
    //     the reimbursement cycle, so it must NOT emit them yet (or they'd duplicate).
    // Without this gating, a payment-plan purchase re-emitted the brand→prodesk and
    // agency-retained/designee invoices on every reimbursement cycle (5..n+1) and
    // emitted the sales/affiliate legs at BOTH fulfilment and reimbursement.
    const emitBrandInvoice = !opts.reimbursement;
    const emitPriorityInvoices = tier !== 'nonPriority';
    const emitNonPriorityInvoices = tier !== 'priority';

    // 1. Collector → brand: the full gross the brand was charged, PAID (the cash
    //    was already collected at checkout). Emitted once, at fulfilment (and per
    //    recurring cycle); never re-emitted on a reimbursement cycle, which only
    //    releases the already-charged item's deferred commission. No payout (it is
    //    a collection, not a disbursement), so its 'paid' status is intrinsic.
    if (emitBrandInvoice)
      inv(
        gross,
        collectorParty,
        { isProdesk: false, brandId: purchase.brandId },
        null,
        null,
        'charge',
      );

    // 2. Producing agency → collector: the agency-retained portion (owner + staff
    //    commissions combined), UNPAID. ALWAYS emitted with the priority cut —
    //    when the collector is a sales agency the agency bills it, otherwise it
    //    bills Prodesk. Links to the agency-owner payout (paid to the agency entity).
    if (emitPriorityInvoices) {
      const agencyRetained =
        ownerAmt + salesPersonAmt + productionAmt + briefingAmt + approvalAmt;
      inv(
        agencyRetained,
        { isProdesk: false, agencyId: agency.id },
        collectorParty,
        'agencyOwnerCommission',
        agency.id,
      );
    }

    // 3. Each staff designee → the production agency: UNPAID, only when the
    //    commission is actually paid to a distinct staff member (not redirected
    //    to / owned by the agency owner). Priority commissions — emitted with the
    //    priority payout (fulfilment / recurring cycle), never on a reimbursement cycle.
    if (
      emitPriorityInvoices &&
      briefingDesignee &&
      briefingDesignee !== agency.ownerId
    )
      inv(
        briefingAmt,
        { isProdesk: false, userId: briefingDesignee },
        { isProdesk: false, agencyId: agency.id },
        'briefingManagerCommission',
        briefingDesignee,
      );
    if (
      emitPriorityInvoices &&
      approvalDesignee &&
      approvalDesignee !== agency.ownerId
    )
      inv(
        approvalAmt,
        { isProdesk: false, userId: approvalDesignee },
        { isProdesk: false, agencyId: agency.id },
        'internalApprovalCommission',
        approvalDesignee,
      );
    if (
      emitPriorityInvoices &&
      productionDesignee &&
      productionDesignee !== agency.ownerId
    )
      inv(
        productionAmt,
        { isProdesk: false, userId: productionDesignee },
        { isProdesk: false, agencyId: agency.id },
        'productionManagerCommission',
        productionDesignee,
      );
    if (
      emitPriorityInvoices &&
      salesPersonId &&
      salesPersonId !== agency.ownerId
    )
      inv(
        salesPersonAmt,
        { isProdesk: false, userId: salesPersonId },
        { isProdesk: false, agencyId: agency.id },
        'salesPersonCommission',
        salesPersonId,
      );

    // 4. Non-priority legs (UNPAID):
    //    • Prodesk ↔ collector reconciliation — ONLY when a sales agency is the
    //      collector. Prodesk invoices the collector for Prodesk's own cut PLUS the
    //      affiliate's cut (Prodesk is the one who then pays the affiliate). The
    //      sales agency keeps its OWN sales cut by not being invoiced for it. When
    //      Prodesk is the collector it already holds the cash, so no such invoice.
    //      Links to the Prodesk (platform) commission payout (super-admin).
    if (emitNonPriorityInvoices && collectorAgencyId)
      inv(
        prodeskAmt + affiliateAmt,
        { isProdesk: true },
        { isProdesk: false, agencyId: collectorAgencyId },
        'prodeskCommission',
        superAdminId,
      );
    //    • Affiliate → Prodesk for the affiliate cut. Links to the affiliate payout.
    if (emitNonPriorityInvoices && hasAffiliate)
      inv(
        affiliateAmt,
        { isProdesk: false, userId: affiliateBeneficiaryId! },
        { isProdesk: true },
        'affiliateCommission',
        affiliateBeneficiaryId!,
      );
  }

  // Payout date per beneficiary (ports payout_helper groupAndFormatPayouts dates):
  // recurring/subscription cycles and priority roles settle +14d; non-priority
  // (platform/affiliate/sales) settles on the upcoming Friday. Anchored to one
  // `now` so a single run's dates are consistent.
  const now = new Date();
  const computedPayouts: ComputedPayout[] = [];
  for (const [, b] of byBeneficiary) {
    const total = round2(b.rows.reduce((s, r) => s + r.amount, 0));
    if (total <= 0) continue;
    const as: PayoutAs =
      b.kind === 'agency'
        ? 'agency'
        : b.userId === superAdminId
          ? 'admin'
          : b.roles.has('owner')
            ? 'owner'
            : 'staff';
    const isPriority = b.rows.some((r) => r.tier === 'priority');
    // A delayed proposal phase's INITIAL payout is dated from its phase start
    // (fulfilment + startDelayDays), not fulfilment itself — the phase's work and
    // its refund window only begin then. payoutFriday then adds the 14-day buffer.
    // Recurring/reimbursement cycles leave this off (they fire post-phase-start).
    const anchor =
      opts.anchorToPhaseStart && b.startDelayDays
        ? new Date(now.getTime() + b.startDelayDays * 86_400_000)
        : now;
    const toPayAt = payoutFriday(
      opts.recurringOnly
        ? 'subscription'
        : isPriority
          ? 'priority'
          : 'nonPriority',
      anchor,
    );
    computedPayouts.push({
      beneficiaryId: b.userId,
      beneficiaryAgencyId: b.beneficiaryAgencyId,
      as,
      agencyId: b.agencyId,
      projectId: b.projectId,
      total,
      status: 'upcoming', // no payout settles until its work completes (incl. the platform's own cut, retained internally in dispatchPayout)
      toPayAt,
      rows: b.rows.filter((r) => r.amount > 0),
    });
  }

  return { computedPayouts, invoiceDrafts, brand, brandId: purchase.brandId };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Single chokepoint for CREATING payout rows. A zero- or negative-amount payout
 * is meaningless (nothing to dispatch) and only clutters earnings/dispatch, so it
 * must never be persisted. Every `payouts` INSERT in the codebase goes through
 * here — returns the created row, or `null` when the amount is non-positive (the
 * caller must then skip its breakdown/invoice for that beneficiary).
 *
 * Scope: INSERT only. Owner payouts may legitimately be UPDATED down to exactly
 * $0.00 by a contractor-fee deduction (applyContractorFee) and re-credited later
 * on reversal (reverseContractorFee), so the row must survive at $0 — hence this
 * guard lives in code at the insert sites, not as a DB `CHECK amount > 0`.
 */
export async function insertPayout(
  db: typeof defaultDb,
  values: typeof payouts.$inferInsert,
): Promise<typeof payouts.$inferSelect | null> {
  if (!(Number(values.amount) > 0)) {
    console.warn('[payout] skipped zero/invalid-amount payout', {
      amount: values.amount,
      beneficiaryId: values.beneficiaryId,
      purchaseId: values.purchaseId,
      as: values.as,
    });
    return null;
  }
  const [row] = await db.insert(payouts).values(values).returning();
  return row;
}

/**
 * Core split shared by the initial-fulfillment payout and each recurring cycle.
 * Computes the split (`computePayoutSplit`) then PERSISTS it: one payout +
 * breakdowns per beneficiary, plus the commission invoice documents. Unpaid
 * commission invoices are linked to the payout that settles them so a provider
 * webhook can flip the invoice to `received` (see dispatch.markPayoutReceived).
 */
async function runPayoutSplit(
  purchaseId: string,
  opts: PayoutSplitOpts,
  db = defaultDb,
) {
  const res = await computePayoutSplit(purchaseId, opts, db);
  if (!res) return;
  const { computedPayouts, invoiceDrafts, brand, brandId } = res;

  // Keyed by `${beneficiary id}:${projectId}` — links a commission invoice to the
  // payout that settles it (so the invoice's status is DERIVED from that payout —
  // see docs/invoices.md §7). Payouts are per-project, so a beneficiary can have
  // several payouts in one run (one per project); the project discriminator routes
  // each invoice to its own payout. The beneficiary is EITHER a user (staff /
  // affiliate / super-admin) OR an agency (the agency-owner cut, paid to the agency
  // entity) — a payout has exactly one, so keying by the raw id is unambiguous.
  const payoutByBeneficiary = new Map<string, string>();
  for (const cp of computedPayouts) {
    const payout = await insertPayout(db, {
      amount: cp.total.toFixed(2),
      currency: 'AUD',
      beneficiaryId: cp.beneficiaryId,
      beneficiaryAgencyId: cp.beneficiaryAgencyId,
      agencyId: cp.agencyId,
      purchaseId,
      status: cp.status,
      as: cp.as,
      sourceBrandName: brand?.businessName,
      toPayAt: cp.toPayAt,
    });
    if (!payout) continue;
    const beneficiaryKey = cp.beneficiaryId ?? cp.beneficiaryAgencyId;
    if (beneficiaryKey)
      payoutByBeneficiary.set(
        `${beneficiaryKey}:${cp.projectId ?? 'none'}`,
        payout.id,
      );
    await db.insert(payoutBreakdowns).values(
      cp.rows.map((r) => ({
        payoutId: payout.id,
        purchaseId,
        projectId: r.projectId,
        brandId,
        description: r.commissionType,
        commissionType: r.commissionType,
        role: r.role,
        sourceServiceName: r.serviceName,
        amount: r.amount.toFixed(2),
        metadata: {
          brandName: brand?.businessName ?? null,
          serviceName: r.serviceName,
          week: opts.week,
        },
      })),
    );
  }

  for (const d of invoiceDrafts) {
    const payoutId = d.payoutBeneficiaryId
      ? (payoutByBeneficiary.get(
          `${d.payoutBeneficiaryId}:${d.projectId ?? 'none'}`,
        ) ?? null)
      : null;
    const [invoice] = await db
      .insert(invoices)
      .values({
        purchaseId,
        payoutId,
        cycle: d.cycle,
        commissionType: d.commissionType,
        ...partyColumns(d.fromParty, 'from'),
        ...partyColumns(d.toParty, 'to'),
        total: d.total.toFixed(2),
      })
      .returning();
    await db.insert(invoiceItems).values({
      invoiceId: invoice.id,
      name: d.serviceName ?? 'Service',
      qty: 1,
      totalPrice: d.total.toFixed(2),
      packageName: d.packageName,
      selectedOptions: d.selectedOptions,
      selectedAddons: d.selectedAddons,
    });
  }
}

/**
 * Fulfil a paid purchase: mark it paid, spawn a project per non-heading line
 * item, and generate agency payouts. Idempotent — re-running on an already-
 * fulfilled purchase is a no-op. Ports handle_payment_success.ts.
 */
export async function fulfillPurchase(purchaseId: string, db = defaultDb) {
  // Use an atomic update to claim this purchase and prevent concurrent fulfillment
  // (e.g. from rapid webhook retries) from spawning duplicate projects.
  const [purchase] = await db
    .update(purchases)
    .set({ status: 'processing' })
    .where(
      and(
        eq(purchases.id, purchaseId),
        notInArray(purchases.status, ['processing', 'completed']),
      ),
    )
    .returning();

  if (!purchase) {
    // If not updated, it either doesn't exist, or is already processing/completed
    // by another concurrent request. Fetch it to return the current state.
    const [existing] = await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1);

    if (!existing) throw new Error('Purchase not found');
    return existing;
  }

  // Idempotency: if projects already exist for this purchase, don't re-spawn.
  const existingProjects = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.purchaseId, purchaseId))
    .limit(1);
  if (existingProjects.length) return purchase;

  const items = await db
    .select()
    .from(purchaseItems)
    .where(eq(purchaseItems.purchaseId, purchaseId))
    .orderBy(purchaseItems.sortOrder);

  // Pre-load source services to copy their custom-field briefs onto each project.
  // A service carrying custom fields lands in `clientBrief` so the buyer is
  // routed to the post-checkout brief stepper; otherwise it starts `upcoming`.
  const svcIds = [
    ...new Set(items.map((i) => i.serviceId).filter(Boolean)),
  ] as string[];
  const svcRows = svcIds.length
    ? await db.select().from(services).where(inArray(services.id, svcIds))
    : [];
  const svcById = new Map(svcRows.map((s) => [s.id, s]));

  // Agencies needed by buildProjectValues (salesperson resolution + owner).
  const agencyIds = [
    ...new Set(items.map((i) => i.agencyId).filter(Boolean)),
  ] as string[];
  const agencyRows = agencyIds.length
    ? await db.select().from(agencies).where(inArray(agencies.id, agencyIds))
    : [];
  const agencyById = new Map(agencyRows.map((a) => [a.id, a]));

  const source = purchase.type === 'proposal' ? 'proposal' : 'marketplace';
  let projectIndex = 0;
  const nowMs = Date.now();
  for (const item of items) {
    if (item.headingText && !item.serviceId) continue; // skip heading rows
    if (item.isExcludedByBrand) continue; // brand removed this line
    const agency = item.agencyId ? agencyById.get(item.agencyId) : null;
    if (!agency) continue;
    const svc = item.serviceId ? svcById.get(item.serviceId) : null;
    const serviceHasCustomFields =
      ((svc?.customFields as unknown[] | null) ?? []).length > 0;
    const isDigitalProduct = isDigital(item.serviceType as ServiceType | null);

    // Quantity → one project per unit (marketplace); proposals spawn exactly one.
    const count = projectsPerItem(source, item.quantity);
    let firstProjectId: string | null = null;
    for (let q = 0; q < count; q++) {
      const customTime = new Date(nowMs + projectIndex * 1000);
      projectIndex++;
      const values = buildProjectValues({
        purchase,
        item,
        agency,
        source,
        serviceHasCustomFields,
        phaseStartDelayDays: item.startDelayDays,
        now: customTime,
      });
      // Carry the buyer's brief answers (frozen onto the project at fulfillment).
      values.customFieldResponses =
        (svc?.customFields as unknown[] | null) ?? [];
      const [project] = await db.insert(projects).values(values).returning();
      firstProjectId ??= project.id;

      // Maintain the agency's amortised project count (on_project_written).
      await db
        .update(agencies)
        .set({
          ammortizedProjectCount: sql`coalesce(${agencies.ammortizedProjectCount}, 0) + 1`,
        })
        .where(eq(agencies.id, agency.id));

      if (isDigitalProduct) {
        // Auto-deliver: attach the file as an approved deliverable + email it.
        const fileUrl =
          item.digitalProductFileUrl ?? svc?.digitalProductFileUrl;
        if (fileUrl)
          await db.insert(projectDeliverables).values({
            projectId: project.id,
            type: 'document',
            content: fileUrl,
            fileName:
              item.digitalProductFileName ??
              svc?.digitalProductFileName ??
              'Digital Product',
            description: 'Automatically delivered digital product',
            status: 'approved',
            source: 'agency',
            cycle: 1,
          });
        if (fileUrl || item.serviceId)
          await enqueueEmail('digital-product', { projectId: project.id });
      } else if (project.status === 'upcoming' && project.nextCycleAt) {
        // Delayed phase → activate exactly at its phase start (no global sweep).
        await scheduleProjectCycle(project.id, project.nextCycleAt);
      }
    }
    if (firstProjectId)
      await db
        .update(purchaseItems)
        .set({ projectId: firstProjectId })
        .where(eq(purchaseItems.id, item.id));
  }

  // Formally connect the brand to every agency it just transacted with — each
  // service's owning agency PLUS the proposal's sales agency (the agency that
  // sent the proposal). Provisions each agency's default Info Hub sections.
  // Idempotent and best-effort: a failure here must not fail fulfilment.
  if (purchase.brandId) {
    const connectAgencyIds = new Set<string>(agencyIds);
    if (purchase.proposalSentByAgencyId)
      connectAgencyIds.add(purchase.proposalSentByAgencyId);
    for (const aId of connectAgencyIds) {
      await connectBrandToAgency(purchase.brandId, aId, db).catch((e) =>
        console.error(
          '[fulfillPurchase] connectBrandToAgency failed',
          aId,
          (e as Error).message,
        ),
      );
    }
  }

  const [updated] = await db
    .update(purchases)
    .set({
      status: 'completed',
      paidAt: purchase.paidAt ?? new Date(),
      completedAt: new Date(),
      paymentReceived: purchase.totalAmount,
    })
    .where(eq(purchases.id, purchaseId))
    .returning();
  await generatePayoutsForPurchase(purchaseId, db);
  // A proposal is "accepted" the moment its purchase is paid — there is no
  // separate paid status. Flip it here so all payment paths (dev immediate
  // fulfilment + the Stripe webhook) record acceptance consistently.
  if (purchase.proposalId)
    await markProposalAcceptedOnPayment(purchase.proposalId, db);
  return updated;
}

/**
 * Mark a proposal `accepted` once its purchase has been paid. Idempotent (skips
 * proposals that are already accepted or internal), stamps the invoice number
 * and payment timestamps, and fires the acceptance email + agency task.
 */
async function markProposalAcceptedOnPayment(
  proposalId: string,
  db = defaultDb,
): Promise<void> {
  const proposal = (
    await db
      .select()
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1)
  )[0];
  if (
    !proposal ||
    proposal.status === 'accepted' ||
    proposal.status === 'internal'
  )
    return;

  const invoiceNumber =
    proposal.invoiceNumber ??
    (await generateInvoiceNumber(db, proposal.agencyId));
  const now = new Date();
  await db
    .update(proposals)
    .set({
      status: 'accepted',
      paidAt: now,
      decidedAt: proposal.decidedAt ?? now,
      invoiceNumber,
      updatedAt: now,
    })
    .where(eq(proposals.id, proposalId));

  await enqueueEmail('proposal-accepted', { proposalId });
  try {
    const brand = proposal.brandId
      ? (
          await db
            .select()
            .from(brands)
            .where(eq(brands.id, proposal.brandId))
            .limit(1)
        )[0]
      : null;
    const agency = proposal.agencyId
      ? (
          await db
            .select()
            .from(agencies)
            .where(eq(agencies.id, proposal.agencyId))
            .limit(1)
        )[0]
      : null;
    await onProposalStatusChanged(
      {
        proposalId,
        status: 'accepted',
        brandOwnerId: brand?.ownerId ?? null,
        agencySenderId: proposal.proposalSentById ?? agency?.ownerId ?? null,
        brandName: brand?.businessName ?? null,
        agencyName: agency?.businessName ?? null,
        organizationId: proposal.brandId ?? null,
      },
      db,
    );
  } catch {
    /* task generation is best-effort */
  }
}

/**
 * Advance a recurring purchase by one billing cycle: record the payment and
 * re-open its recurring projects for the next cycle. Called from the Stripe
 * `invoice.payment_succeeded` webhook (subscription renewals).
 */
export async function advanceRecurringCycle(
  purchaseId: string,
  db = defaultDb,
) {
  const purchase = (
    await db
      .select()
      .from(purchases)
      .where(eq(purchases.id, purchaseId))
      .limit(1)
  )[0];
  if (!purchase) return null;
  const cycle = (purchase.paymentCount ?? 0) + 1;

  await db
    .update(purchases)
    .set({
      paymentCount: cycle,
      paymentReceived: sql`${purchases.paymentReceived} + ${purchase.totalAmount}`,
      paidAt: new Date(),
    })
    .where(eq(purchases.id, purchaseId));

  // Payment state is now recorded. The PROJECT transition is owned by the
  // recurring-schedule engine (single source of truth — no double-advance race,
  // no drift, and un-started delayed phases are skipped). A payment landing may
  // unblock a completed project that was waiting on `isPaymentMadeOnTimeForCycle`,
  // so nudge any due+completed recurring project now; in-progress ones re-arm on
  // their own completion, and `upcoming` (un-started phase) projects are ignored.
  const now = new Date();
  const recurring = await db
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.purchaseId, purchaseId),
        inArray(projects.serviceType, DELIVERABLE_CYCLE_TYPES),
      ),
    );
  for (const p of recurring) {
    if (
      p.status === 'completed' &&
      p.nextCycleAt &&
      p.nextCycleAt.getTime() <= now.getTime()
    ) {
      await runProjectCycle(p.id, now, db);
    }
  }

  // Generate this weekly cycle's commission-split payouts. Gated at the webhook
  // to `subscription_cycle` invoices, so this runs for every weekly charge —
  // including the first one (7 days after checkout, once the trial ends). Only
  // the one-time upfront money was paid at fulfillment (lineTotal excludes the
  // weekly), so there's no overlap with this per-cycle split.
  await generateCyclePayouts(purchaseId, cycle, db);
  // Payment-plan one-offs release their deferred platform/affiliate/sales cut
  // spread across the installment cycles (Flutter parity): cycle 5 clears the
  // backlog, each later cycle reimburses that installment. `reimbursementGrossForItem`
  // returns 0 once past the plan end, so this self-bounds without needing the
  // plan length here.
  if (purchase.selectedPaymentPlan && cycle >= REIMBURSEMENT_CYCLE) {
    await generateReimbursementPayouts(purchaseId, cycle, db);
  }
  return { advanced: recurring.length, cycle };
}
