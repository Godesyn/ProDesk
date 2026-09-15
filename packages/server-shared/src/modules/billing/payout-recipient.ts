import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { payouts, users, agencies } from '../../db/schema.js';

/** The payout-account fields shared by users and agencies (the dispatch target). */
export interface PayoutRecipient {
  stripeAccountId: string | null;
  payoutMethods: Record<string, unknown> | null;
  activePayoutMethod: 'stripe' | 'paypal' | 'wire' | null;
}

/**
 * Resolve where a payout's money is actually sent. A USER beneficiary pays their
 * own connected account. An AGENCY beneficiary (the agency receives the money in
 * its own bank account) pays the agency's own connected account — and ONLY that.
 * If the agency has not linked a payout account, this returns null and the payout
 * is left pending until it does (there is NO fall-back to the agency owner; see
 * docs/commissions.md §7).
 */
export async function resolvePayoutRecipient(
  payout: typeof payouts.$inferSelect,
  db: typeof defaultDb,
): Promise<PayoutRecipient | null> {
  if (payout.beneficiaryAgencyId) {
    const agency = (
      await db.select().from(agencies).where(eq(agencies.id, payout.beneficiaryAgencyId)).limit(1)
    )[0];
    if (agency && (agency.bankAccountLinked || agency.stripeAccountId)) {
      return {
        stripeAccountId: agency.stripeAccountId,
        payoutMethods: agency.payoutMethods,
        activePayoutMethod: agency.activePayoutMethod,
      };
    }
    return null; // agency hasn't linked its own payout account → not payable yet
  }
  if (!payout.beneficiaryId) return null;
  return (await db.select().from(users).where(eq(users.id, payout.beneficiaryId)).limit(1))[0] ?? null;
}
