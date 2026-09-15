import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, payouts } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(),
    chatDigestQueue: queue(), kanbanQueue: queue(), proposalQueue: queue(),
    pendingPurchasesQueue: queue(), queues: [],
    redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) },
    connection: {},
  };
});

// Deliberately NOT mocking ./wise.js. The sibling `stopped-payout` suite mocks
// it, which left the hourly leg-2 retry cron the one scheduled payout job never
// exercised against a `stopped` row. This runs the real selector.
const { retryFundedWiseLeg2 } = await import('./wise.js');

/**
 * There are exactly two scheduled payout jobs (jobs/worker.ts): the weekly
 * `payout-weekly` cron running `dispatchDuePayouts`, covered by the sibling
 * suite, and this hourly `wise-leg2-retry-hourly` running `retryFundedWiseLeg2`.
 *
 * This is the nastiest one to get wrong, because it deliberately picks up
 * `failed` payouts to re-send them. A stopped payout must be invisible to it
 * even when it carries the funded Wise state the sweep looks for.
 */
describe('payouts — the hourly Wise leg-2 retry cron never re-attempts a stopped payout', () => {
  let db: DB;
  let close: () => Promise<void>;
  const who = randomUUID();
  const funded = { status: 'funded', wiseTransferId: 'wt_test', stripePayoutId: 'po_test' };

  /** A payout carrying exactly the funded state the sweep selects on. */
  async function payout(status: 'stopped' | 'failed') {
    const id = randomUUID();
    await db.insert(payouts).values({
      id, amount: '430.00', currency: 'AUD', beneficiaryId: who,
      as: 'contractor', status, wiseFunding: funded, method: 'wire',
    } as never);
    return id;
  }

  const reload = async (id: string) => (await db.select().from(payouts).where(eq(payouts.id, id)))[0];

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([{ id: who, email: 'c@t', activePayoutMethod: 'wire' }] as never);
  });
  afterAll(async () => { await close?.(); });

  it('does not even consider a stopped payout that looks fully retry-eligible', async () => {
    const stopped = await payout('stopped');
    const result = await retryFundedWiseLeg2(db);
    expect(result.considered).toBe(0);
    expect((await reload(stopped)).status).toBe('stopped');
  });

  it('still considers an identical failed payout, so the selector is live', async () => {
    const stopped = await payout('stopped');
    const failed = await payout('failed');
    const result = await retryFundedWiseLeg2(db);
    // Only the `failed` row is picked up. The send itself is allowed to fail
    // (no Wise credentials in a test), which the sweep swallows per row.
    expect(result.considered).toBe(1);
    expect((await reload(failed)).id).toBe(failed);
    expect((await reload(stopped)).status).toBe('stopped');
  });
});
