/**
 * fee-calc.ts
 * Single source of truth for the Payments (EziQuotes) platform fee calculations.
 *
 * Every Stripe call, every dashboard read, every email reads its fee from here.
 * No duplication anywhere else in the codebase.
 *
 * Tier rates are loaded from the payment_plan_tiers DB table (CMS-driven).
 * Fallback defaults (safety net if the table is empty): Send 1%, Close 1.7%,
 * Recover 5%. The DB is the live source of truth and may differ (e.g.
 * promotional rates).
 *
 * Ported from the export's server/lib/feeCalc.ts. The plan-tiers cache
 * (loadTiersFromDb/invalidateTiersCache) lived in routers/pricing.ts there; it
 * is inlined here so the fee logic has no dependency on a router module — the
 * ported pricing router should import it from this file.
 */

import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { paymentAccounts, paymentPlanTiers, proposals } from '../../db/schema.js';

// ---------------------------------------------------------------------------
// Constants — CMS-driven via payment_plan_tiers table
// ---------------------------------------------------------------------------

// Safety fallback rates — used only if payment_plan_tiers is empty/unreadable.
// These are the canonical public-facing rates. The live DB values may differ
// (e.g. promotional rates during early growth). The DB is always the source of truth.
const TIER_RATE_DEFAULTS: Record<string, number> = {
  send: 1.0,
  close: 1.7,
  recover: 5.0,
};

// Synchronous export for legacy callers — always returns fallback defaults.
// Async callers should use getLiveTierRates() for CMS-accurate values.
export const TIER_RATES: Record<string, number> = TIER_RATE_DEFAULTS;

// ---------------------------------------------------------------------------
// Plan tiers cache (60s TTL, invalidated on admin save)
// ---------------------------------------------------------------------------
export interface PlanTierRow {
  key: string;
  name: string;
  pct: string;
  status: string;
  tagline: string | null;
  blurb: string | null;
  label: string | null;
}

let _tiersCache: PlanTierRow[] | null = null;
let _tiersCacheAt = 0;
const TIERS_TTL_MS = 60_000;

export function invalidateTiersCache() {
  _tiersCache = null;
  _tiersCacheAt = 0;
}

export async function loadTiersFromDb(): Promise<PlanTierRow[]> {
  const now = Date.now();
  if (_tiersCache && now - _tiersCacheAt < TIERS_TTL_MS) return _tiersCache;
  const rows = await db.select().from(paymentPlanTiers).orderBy(asc(paymentPlanTiers.sortOrder));
  _tiersCache = rows.map((r) => ({
    key: r.key,
    name: r.name,
    pct: String(r.pct),
    status: r.status,
    tagline: r.tagline ?? null,
    blurb: r.blurb ?? null,
    label: r.label ?? null,
  }));
  _tiersCacheAt = now;
  return _tiersCache;
}

// Async helper: loads live rates from the payment_plan_tiers cache (60s TTL)
export async function getLiveTierRates(): Promise<Record<string, number>> {
  try {
    const tiers = await loadTiersFromDb();
    if (!tiers.length) return TIER_RATE_DEFAULTS;
    return Object.fromEntries(tiers.map((t) => [t.key, parseFloat(t.pct)]));
  } catch {
    return TIER_RATE_DEFAULTS;
  }
}

export type Tier = 'send' | 'close' | 'recover';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FeeResolution {
  ratePercent: number;
  tier: Tier;
  reason: 'standard' | 'admin_override' | 'recover_commitment';
}

export interface ChargeResolution {
  ratePercent: number;
  applicationFeeCents: number;
}

export interface TierInfo {
  tier: Tier;
  ratePercent: number;
  isOverride: boolean;
}

// ---------------------------------------------------------------------------
// Core resolution functions
// ---------------------------------------------------------------------------

/**
 * Resolve the fee rate for a NEW proposal being created.
 * Call this at proposal creation to determine what fee to bake into
 * paymentProposals.appliedFeePercentage.
 *
 * Resolution order:
 *  1. Admin override (feePercentageOverride) — beats everything
 *  2. Recover lifecycle commitment — if this proposal is in the committed list
 *  3. Standard tier rate
 */
export async function resolveFeeForProposal(
  brandId: string,
  proposalContext?: { proposalId?: string },
): Promise<FeeResolution> {
  const [account] = await db
    .select()
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, brandId))
    .limit(1);

  if (!account) {
    // Fallback to Close rate if account not found
    return { ratePercent: 1.7, tier: 'close', reason: 'standard' };
  }

  // 1. Admin override takes absolute precedence
  if (account.feePercentageOverride !== null && account.feePercentageOverride !== undefined) {
    const overrideRate = parseFloat(String(account.feePercentageOverride));
    if (!isNaN(overrideRate)) {
      return {
        ratePercent: overrideRate,
        tier: (account.tier as Tier) ?? 'close',
        reason: 'admin_override',
      };
    }
  }

  // 2. Check if this proposal is in the Recover committed list
  if (proposalContext?.proposalId) {
    const committedIds = (account.recoverCommittedProposalIds as string[]) ?? [];
    if (committedIds.includes(proposalContext.proposalId)) {
      return {
        ratePercent: 5.0,
        tier: 'recover',
        reason: 'recover_commitment',
      };
    }
  }

  // 3. Standard tier rate — use live CMS rates
  const tier = (account.tier as Tier) ?? 'close';
  const liveRates = await getLiveTierRates();
  const ratePercent = liveRates[tier] ?? TIER_RATE_DEFAULTS[tier] ?? 1.7;
  return { ratePercent, tier, reason: 'standard' };
}

/**
 * Resolve the fee for an existing charge (Stripe PaymentIntent / Subscription).
 * Reads the immutable appliedFeePercentage from the proposal record.
 * This is what gets passed to Stripe as application_fee_amount / application_fee_percent.
 *
 * @param proposalId  The proposal being charged
 * @param chargeCents The amount being charged in cents (for one-off / installment)
 */
export async function resolveFeeForCharge(
  proposalId: string,
  chargeCents: number,
): Promise<ChargeResolution> {
  const [proposal] = await db
    .select({ appliedFeePercentage: proposals.appliedFeePercentage })
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.kind, 'payer')))
    .limit(1);

  // If no applied rate set yet (legacy proposals), fall back to account tier
  let ratePercent = 1.7; // Close default
  if (proposal?.appliedFeePercentage !== null && proposal?.appliedFeePercentage !== undefined) {
    ratePercent = parseFloat(String(proposal.appliedFeePercentage));
  }

  const applicationFeeCents = Math.floor(chargeCents * (ratePercent / 100));
  return { ratePercent, applicationFeeCents };
}

/**
 * Get the current tier info for a brand's payment account.
 * Used for dashboard reads and UI display.
 */
export async function getTierForAccount(brandId: string): Promise<TierInfo> {
  const [account] = await db
    .select({
      tier: paymentAccounts.tier,
      feePercentageOverride: paymentAccounts.feePercentageOverride,
    })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.brandId, brandId))
    .limit(1);

  if (!account) {
    return { tier: 'close', ratePercent: 1.7, isOverride: false };
  }

  const isOverride =
    account.feePercentageOverride !== null &&
    account.feePercentageOverride !== undefined;

  const tier = (account.tier as Tier) ?? 'close';
  const liveRates = await getLiveTierRates();
  const ratePercent = isOverride
    ? parseFloat(String(account.feePercentageOverride))
    : (liveRates[tier] ?? TIER_RATE_DEFAULTS[tier] ?? 1.7);

  return { tier, ratePercent, isOverride };
}

// ---------------------------------------------------------------------------
// Recover lifecycle commitment math
// ---------------------------------------------------------------------------

/**
 * When a customer upgrades to Recover, lock all currently active proposals
 * (subscriptions and payment plans with remaining installments) at the Recover rate.
 *
 * Returns the list of proposal IDs that were locked and the total committed value.
 */
export async function applyRecoverLifecycleCommitment(
  brandId: string,
): Promise<{ lockedProposalIds: string[]; committedPlanCount: number; committedPlanValueCents: number }> {
  // Find all active subscription/payment_plan proposals for this brand
  const activeProposals = await db
    .select({
      id: proposals.id,
      paymentModel: proposals.paymentModel,
      totalCents: proposals.totalCents,
      status: proposals.status,
    })
    .from(proposals)
    .where(and(eq(proposals.brandId, brandId), eq(proposals.kind, 'payer')));

  const qualifying = activeProposals.filter((p) => {
    const isActiveStatus = ['active', 'accepted', 'paid'].includes(p.status);
    const isRecurring =
      p.paymentModel === 'subscription' ||
      p.paymentModel === 'payment_plan' ||
      p.paymentModel === 'pay_plan';
    return isActiveStatus && isRecurring;
  });

  const lockedProposalIds = qualifying.map((p) => p.id);
  const committedPlanValueCents = qualifying.reduce(
    (sum, p) => sum + (p.totalCents ?? 0),
    0,
  );

  // Lock each qualifying proposal at the Recover rate
  if (lockedProposalIds.length > 0) {
    for (const proposalId of lockedProposalIds) {
      await db
        .update(proposals)
        .set({
          appliedFeePercentage: '5.00',
          appliedTier: 'recover',
          rateLockReason: 'recover_commitment',
        })
        .where(and(eq(proposals.id, proposalId), eq(proposals.kind, 'payer')));
    }
    // Persist the committed proposal IDs on the account so resolveFeeForProposal
    // can honour the commitment even after a future downgrade.
    await db
      .update(paymentAccounts)
      .set({ recoverCommittedProposalIds: lockedProposalIds })
      .where(eq(paymentAccounts.brandId, brandId));
  }

  return {
    lockedProposalIds,
    committedPlanCount: qualifying.length,
    committedPlanValueCents,
  };
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB — safe to use in tests)
// ---------------------------------------------------------------------------

/**
 * Calculate the application fee in cents for a given charge amount and rate.
 * Pure function — no DB access.
 */
export function calcApplicationFeeCents(
  chargeCents: number,
  ratePercent: number,
): number {
  return Math.floor(chargeCents * (ratePercent / 100));
}

/**
 * Get the standard rate for a tier without DB access.
 */
export function standardRateForTier(tier: Tier): number {
  return TIER_RATES[tier] ?? 1.7;
}

/**
 * Calculate the derived application_fee_percent to pass to Stripe.
 *
 * Stripe charges the GST-inclusive total. Our platform fee is on subtotal (ex-GST).
 * To deduct the correct dollar amount, we derive a percentage of the total that
 * equals (platformFeeRate × subtotal).
 *
 * Formula: application_fee_percent = (platformFeeRate × subtotalCents) / totalCents
 *
 * Example: $1,000 subtotal + $100 GST = $1,100 total, 1.7% Close rate:
 *   platform fee target = 1.7% × $1,000 = $17.00
 *   application_fee_percent = 17 / 1100 = 1.5455%
 *
 * Edge case: if totalCents === 0 or subtotalCents > totalCents, returns 0.
 *
 * @param platformFeeRatePercent  The tier rate (e.g. 1.7 for 1.7%)
 * @param subtotalCents           The ex-GST subtotal in cents
 * @param totalCents              The GST-inclusive total in cents
 * @returns                       The derived percentage (e.g. 1.5455), to 4dp
 */
export function calcDerivedApplicationFeePercent(
  platformFeeRatePercent: number,
  subtotalCents: number,
  totalCents: number,
): number {
  if (totalCents <= 0 || subtotalCents <= 0) return 0;
  if (subtotalCents > totalCents) return platformFeeRatePercent; // no GST case
  const derived = (platformFeeRatePercent * subtotalCents) / totalCents;
  return Math.round(derived * 10000) / 10000; // 4dp
}
