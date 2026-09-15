/**
 * Reviews (Verdiict) referrals — "give a month, get a month". Every user holds a
 * shareable code (review_referral_codes); a brand owner may redeem someone else's
 * code exactly once (review_referral_redemptions, unique per redeemer). The free
 * months SETTLE when the redeemer's reviews feature subscription activates (or
 * immediately at redeem time if they were already subscribed): both the code
 * owner and the redeemer receive one month of the current reviews price as a
 * Stripe customer-balance credit, which Stripe nets against their next invoice
 * automatically — no coupon lifecycle, no extra webhook events.
 *
 * Settlement claims the redemption row with an optimistic lock (credited_at IS
 * NULL) so Stripe webhook retries and concurrent activations can never
 * double-credit. `months_earned` on the owner's code increments at settlement
 * (i.e. it counts real, credited months — not raw redemptions).
 */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { reviewReferralCodes, reviewReferralRedemptions } from '../../db/schema.js';
import { stripe } from '../stripe/client.js';
import { withEnvTag } from '../stripe/env-tag.js';
import { ensureStripeCustomerForUser } from '../feature-subscriptions/stripe.js';
import { chargeCents } from '../../lib/num.js';
import { getReviewsOffer } from './billing.js';

type Db = typeof defaultDb;

/**
 * Settle the subscriber's pending referral redemption, if any. Called from every
 * reviews-subscription activation path (Stripe webhook + the no-Stripe dev
 * fallback) and from `referrals.redeem` when the redeemer is already subscribed.
 * Idempotent and safe to call unconditionally. Never throws — a referral credit
 * must not fail the activation that triggered it.
 */
export async function settleReviewsReferralOnActivation(
  db: Db,
  subscriberUserId: string,
): Promise<void> {
  try {
    const [redemption] = await db
      .select()
      .from(reviewReferralRedemptions)
      .where(
        and(
          eq(reviewReferralRedemptions.redeemedByUserId, subscriberUserId),
          isNull(reviewReferralRedemptions.creditedAt),
        ),
      )
      .limit(1);
    if (!redemption) return;

    const [code] = await db
      .select()
      .from(reviewReferralCodes)
      .where(eq(reviewReferralCodes.code, redemption.code))
      .limit(1);
    if (!code) return; // code owner deleted — nothing to credit

    // One month at the CURRENT reviews price. No configured offer → leave the
    // redemption pending; it settles on a later activation once pricing exists.
    const offer = await getReviewsOffer(db);
    const amount = offer?.unitAmount;
    if (amount == null || amount <= 0) return;
    const currency = offer?.currency ?? 'AUD';

    // Claim the redemption FIRST (optimistic lock). A concurrent settle — e.g. a
    // retried webhook delivery — loses the update and returns here, so the Stripe
    // credits below are issued at most once per redemption.
    const claimed = await db
      .update(reviewReferralRedemptions)
      .set({
        creditedAt: new Date(),
        creditAmount: String(amount),
        creditCurrency: currency,
      })
      .where(
        and(
          eq(reviewReferralRedemptions.id, redemption.id),
          isNull(reviewReferralRedemptions.creditedAt),
        ),
      )
      .returning({ id: reviewReferralRedemptions.id });
    if (claimed.length === 0) return;

    await db
      .update(reviewReferralCodes)
      .set({ monthsEarned: sql`${reviewReferralCodes.monthsEarned} + 1` })
      .where(eq(reviewReferralCodes.id, code.id));

    // Both sides get one month of credit. Without Stripe (dev) the DB settlement
    // above is the whole story, which keeps the flow testable end-to-end.
    if (!stripe) return;
    for (const userId of [code.ownerUserId, subscriberUserId]) {
      try {
        const customerId = await ensureStripeCustomerForUser(db, userId);
        await stripe.customers.createBalanceTransaction(customerId, {
          amount: -chargeCents(amount),
          currency: currency.toLowerCase(),
          description: 'Verdiict referral — one month free',
          metadata: withEnvTag({
            kind: 'reviews_referral_credit',
            redemptionId: redemption.id,
            userId,
          }),
        });
      } catch (err) {
        // The claim already happened; surface loudly so support can credit by hand.
        console.error(
          `[reviews] referral credit FAILED for user ${userId} (redemption ${redemption.id}) — apply manually:`,
          (err as Error).message,
        );
      }
    }
  } catch (err) {
    console.error('[reviews] referral settlement error', (err as Error).message);
  }
}
