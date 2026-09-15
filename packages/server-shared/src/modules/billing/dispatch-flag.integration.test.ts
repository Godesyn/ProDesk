import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, projects, payouts, payoutBreakdowns } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({ add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) });
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(), chatDigestQueue: queue(),
    kanbanQueue: queue(), proposalQueue: queue(), pendingPurchasesQueue: queue(), queues: [],
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) }, connection: {},
  };
});
const payViaStripe = vi.fn().mockResolvedValue('txn_test');
vi.mock('./payout-providers.js', () => ({
  payViaStripe: (...a: unknown[]) => payViaStripe(...a),
  payViaPaypal: vi.fn().mockResolvedValue('txn_pp'),
}));
vi.mock('./wise.js', () => ({ fundWiseViaStripe: vi.fn().mockResolvedValue(undefined) }));
// Flag OFF: weekly-billed projects are non-refundable.
vi.mock('../../lib/feature-flags.js', () => ({ IS_RECURRING_PROJECTS_REFUNDABLE: false }));

const { dispatchPayout } = await import('./dispatch.js');

/**
 * IS_RECURRING_PROJECTS_REFUNDABLE = false: on a weekly-billed project the
 * external non-priority cuts dispatch EARLY (no claw-back risk), while priority
 * cuts stay completion-gated.
 */
describe('dispatch — IS_RECURRING_PROJECTS_REFUNDABLE = false', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 86_400_000);
  const affiliate = randomUUID();
  const owner = randomUUID();

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: affiliate, email: 'aff@t', stripeAccountId: 'acct_aff', activePayoutMethod: 'stripe' },
      { id: owner, email: 'own@t', stripeAccountId: 'acct_own', activePayoutMethod: 'stripe' },
    ] as never);
  });
  afterAll(async () => { await close?.(); });

  const weeklyProject = async (status = 'production') => {
    const id = randomUUID();
    await db.insert(projects).values({
      id, serviceType: 'recurringService', status, cycleCount: 1,
      deliverableFrequency: 'weekly', repeatsEvery: 1, createdAt: PAST,
    } as never);
    return id;
  };
  const payout = async (beneficiaryId: string, commissionType: string, projectId: string, amount = '14.00') => {
    const pay = randomUUID();
    await db.insert(payouts).values({ id: pay, amount, currency: 'AUD', beneficiaryId, as: 'contractor', status: 'pending', toPayAt: PAST } as never);
    await db.insert(payoutBreakdowns).values({ payoutId: pay, projectId, commissionType, week: 1, amount } as never);
    return pay;
  };

  it('dispatches a NON-priority cut early on an incomplete weekly project', async () => {
    payViaStripe.mockClear();
    const proj = await weeklyProject('production'); // NOT completed
    const pay = await payout(affiliate, 'affiliateCommission', proj);
    await dispatchPayout(pay, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('paid');
    expect(payViaStripe).toHaveBeenCalledTimes(1);
  });

  it('still HOLDS a priority cut on the same incomplete weekly project', async () => {
    payViaStripe.mockClear();
    const proj = await weeklyProject('production'); // NOT completed
    const pay = await payout(owner, 'agencyOwnerCommission', proj, '40.00');
    await dispatchPayout(pay, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('pending');
    expect(payViaStripe).not.toHaveBeenCalled();
  });
});
