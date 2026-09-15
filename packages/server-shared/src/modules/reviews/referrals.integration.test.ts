import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';

// Stripe stub: users are seeded WITH stripeCustomerId, so settlement goes
// straight to the balance-credit call we assert on.
const { createBalanceTransaction } = vi.hoisted(() => ({
  createBalanceTransaction: vi.fn().mockResolvedValue({}),
}));
vi.mock('../stripe/client.js', () => ({
  stripe: { customers: { createBalanceTransaction } },
}));

import {
  users,
  featureSubscriptionPrices,
  featureSubscriptionProducts,
  featureSubscriptionTiers,
  reviewReferralCodes,
  reviewReferralRedemptions,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';
import { settleReviewsReferralOnActivation } from './referrals.js';

/**
 * Referral settlement ("give a month, get a month"). The redemption is claimed
 * with an optimistic lock, months_earned counts CREDITED months only, and both
 * sides receive exactly one Stripe balance credit — including across the retried
 * webhook deliveries this idempotency exists for.
 */
describe('reviews referral settlement', () => {
  let db: DB;
  let close: () => Promise<void>;

  const id = {
    owner: randomUUID(), // shares the code
    redeemer: randomUUID(), // redeemed it; activation settles
    bystander: randomUUID(), // never redeemed anything
    codeRow: randomUUID(),
    redemption: randomUUID(),
    product: randomUUID(),
    tier: randomUUID(),
    price: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.owner, email: 'owner@t', stripeCustomerId: 'cus_owner' },
      { id: id.redeemer, email: 'redeemer@t', stripeCustomerId: 'cus_redeemer' },
      { id: id.bystander, email: 'bystander@t', stripeCustomerId: 'cus_bystander' },
    ]);
    // The reviews offer: $59/month.
    await db.insert(featureSubscriptionProducts).values({
      id: id.product, name: 'Reviews', slug: 'reviews',
      featureKey: 'reviews', featureKeys: ['reviews'],
    });
    await db.insert(featureSubscriptionTiers).values({ id: id.tier, productId: id.product, name: 'Standard' });
    await db.insert(featureSubscriptionPrices).values({
      id: id.price, tierId: id.tier, interval: 'month', amount: '59.00', currency: 'AUD',
    });
    await db.insert(reviewReferralCodes).values({
      id: id.codeRow, ownerUserId: id.owner, code: 'FRIEND01',
    });
    await db.insert(reviewReferralRedemptions).values({
      id: id.redemption, code: 'FRIEND01', redeemedByUserId: id.redeemer,
    });
  }, 30_000);

  afterAll(async () => {
    await close();
  });

  it('is a no-op for a user with no pending redemption', async () => {
    await settleReviewsReferralOnActivation(db, id.bystander);
    expect(createBalanceTransaction).not.toHaveBeenCalled();
  });

  it('settles a pending redemption: stamps it, bumps months_earned, credits both sides', async () => {
    await settleReviewsReferralOnActivation(db, id.redeemer);

    const [redemption] = await db
      .select()
      .from(reviewReferralRedemptions)
      .where(eq(reviewReferralRedemptions.id, id.redemption));
    expect(redemption.creditedAt).not.toBeNull();
    expect(Number(redemption.creditAmount)).toBe(59);
    expect(redemption.creditCurrency).toBe('AUD');

    const [code] = await db
      .select()
      .from(reviewReferralCodes)
      .where(eq(reviewReferralCodes.id, id.codeRow));
    expect(code.monthsEarned).toBe(1);

    // One month of credit ($59 → -5900 cents) for the code owner AND the redeemer.
    expect(createBalanceTransaction).toHaveBeenCalledTimes(2);
    const credited = createBalanceTransaction.mock.calls.map((c) => c[0]).sort();
    expect(credited).toEqual(['cus_owner', 'cus_redeemer']);
    for (const [, body] of createBalanceTransaction.mock.calls) {
      expect(body.amount).toBe(-5900);
      expect(body.currency).toBe('aud');
    }
  });

  it('is idempotent: a retried activation never double-credits', async () => {
    createBalanceTransaction.mockClear();
    await settleReviewsReferralOnActivation(db, id.redeemer);
    expect(createBalanceTransaction).not.toHaveBeenCalled();

    const [code] = await db
      .select()
      .from(reviewReferralCodes)
      .where(eq(reviewReferralCodes.id, id.codeRow));
    expect(code.monthsEarned).toBe(1);
  });
});
