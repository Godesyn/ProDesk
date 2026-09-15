/**
 * Stripe Connect ownership registry (read-only).
 *
 * The platform runs TWO independent Stripe Connect integrations that share one
 * Stripe account and one webhook endpoint:
 *   • payments (EziQuotes) — Standard-OAuth accounts for INBOUND charges,
 *     stored on `payment_accounts.stripeConnectAccountId`.
 *   • agency payouts        — Express accounts for OUTBOUND payouts,
 *     stored on `agencies.stripeAccountId`.
 *
 * A single connected-account id must belong to EXACTLY ONE of these registries.
 * This module answers "who owns this account id?" without mutating anything, and
 * `assertConnectDisjoint` logs a hard error if an id ever appears in both — a
 * misconfiguration that would let the two webhook handlers fight over an event.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { agencies, paymentAccounts } from '../../db/schema.js';

export type ConnectOwner = 'payments' | 'agency-payout' | 'both' | 'none';

export interface ConnectOwnership {
  owner: ConnectOwner;
  /** payment_accounts.id when the id is a payments Standard account. */
  paymentAccountId: string | null;
  /** agencies.id when the id is an agency Express payout account. */
  agencyId: string | null;
}

/** Read-only lookup: which subsystem(s) own a Stripe connected-account id. */
export async function lookupConnectOwner(stripeAccountId: string): Promise<ConnectOwnership> {
  const [pay] = await db
    .select({ id: paymentAccounts.id })
    .from(paymentAccounts)
    .where(eq(paymentAccounts.stripeConnectAccountId, stripeAccountId))
    .limit(1);
  const [agency] = await db
    .select({ id: agencies.id })
    .from(agencies)
    .where(eq(agencies.stripeAccountId, stripeAccountId))
    .limit(1);
  const inPayments = !!pay;
  const inAgency = !!agency;
  const owner: ConnectOwner =
    inPayments && inAgency ? 'both' : inPayments ? 'payments' : inAgency ? 'agency-payout' : 'none';
  return { owner, paymentAccountId: pay?.id ?? null, agencyId: agency?.id ?? null };
}

/**
 * Guardrail for the shared Stripe webhook: assert a connected-account id does
 * not belong to BOTH registries. Returns the resolved ownership so callers can
 * route/inspect. Never throws (a webhook must still ACK) — it logs an error so
 * the misconfiguration is loud in the logs.
 */
export async function assertConnectDisjoint(stripeAccountId: string): Promise<ConnectOwnership> {
  const ownership = await lookupConnectOwner(stripeAccountId);
  if (ownership.owner === 'both') {
    console.error(
      `[stripe/connect-registry] DISJOINTNESS VIOLATION: connected account ${stripeAccountId} is registered as BOTH a payments Standard account (payment_accounts=${ownership.paymentAccountId}) and an agency Express payout account (agencies=${ownership.agencyId}). The inbound-charge and outbound-payout webhook handlers will conflict over its events.`,
    );
  }
  return ownership;
}
