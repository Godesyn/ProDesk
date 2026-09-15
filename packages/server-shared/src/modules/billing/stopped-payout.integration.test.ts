import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, projects, payouts, payoutBreakdowns } from '../../db/schema.js';
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
const payViaStripe = vi.fn().mockResolvedValue('txn_test');
vi.mock('./payout-providers.js', () => ({
  payViaStripe: (...a: unknown[]) => payViaStripe(...a),
  payViaPaypal: vi.fn().mockResolvedValue('txn_pp'),
}));
vi.mock('./wise.js', () => ({
  fundWiseViaStripe: vi.fn().mockResolvedValue(undefined),
  retryFundedWiseLeg2: vi.fn().mockResolvedValue({ considered: 0, sent: 0 }),
}));
vi.mock('../../lib/feature-flags.js', () => ({ IS_RECURRING_PROJECTS_REFUNDABLE: false }));

const { dispatchPayout, dispatchDuePayouts, dispatchAllPayoutsNow, dispatchProjectPayoutsNow } =
  await import('./dispatch.js');

/**
 * `stopped` is the terminal state for a payout deliberately taken out of
 * circulation. The guarantee under test is that NO dispatch path can move it,
 * including the internal-project completion path that ignores `toPayAt`
 * entirely, and that the weekly cron never revives it the way it revives
 * `failed`.
 */
describe('payouts — stopped is terminal', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 86_400_000);
  const FUTURE = new Date(Date.now() + 30 * 86_400_000);
  const contractor = randomUUID();

  /** An internal recurring project whose terminal cycle has just completed. */
  async function completedInternalCycle(status: 'pending' | 'stopped', toPayAt: Date) {
    const proj = randomUUID();
    const pay = randomUUID();
    await db.insert(projects).values({
      id: proj, serviceType: 'recurringService', status: 'completed', isInternal: true,
      cycleCount: 1, deliverableFrequency: 'monthly', repeatsEvery: 1, createdAt: PAST,
    } as never);
    await db.insert(payouts).values({
      id: pay, amount: '430.00', currency: 'AUD', beneficiaryId: contractor,
      as: 'contractor', status, toPayAt,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj, commissionType: 'contractorCommission', week: 1, amount: '430.00',
    } as never);
    return { proj, pay };
  }

  const statusOf = async (id: string) =>
    (await db.select().from(payouts).where(eq(payouts.id, id)))[0].status;

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: contractor, email: 'contractor@t', stripeAccountId: 'acct_c', activePayoutMethod: 'stripe' },
    ] as never);
  });
  afterAll(async () => { await close?.(); });

  it('pays a completed terminal cycle when the payout is still pending', async () => {
    payViaStripe.mockClear();
    const { pay } = await completedInternalCycle('pending', PAST);
    await dispatchPayout(pay, db);
    expect(await statusOf(pay)).toBe('paid');
    expect(payViaStripe).toHaveBeenCalledTimes(1);
  });

  it('refuses the same dispatch once the payout is stopped', async () => {
    payViaStripe.mockClear();
    const { pay } = await completedInternalCycle('stopped', PAST);
    await dispatchPayout(pay, db);
    expect(await statusOf(pay)).toBe('stopped');
    expect(payViaStripe).not.toHaveBeenCalled();
  });

  it('is never revived or dispatched by the weekly cron', async () => {
    payViaStripe.mockClear();
    const { pay } = await completedInternalCycle('stopped', PAST);
    const result = await dispatchDuePayouts(new Date(), db);
    expect(await statusOf(pay)).toBe('stopped');
    expect(result.retriedFailed).toBe(0);
    expect(payViaStripe).not.toHaveBeenCalled();
  });

  it('is not pulled forward by the admin force-all button', async () => {
    payViaStripe.mockClear();
    const { pay } = await completedInternalCycle('stopped', FUTURE);
    await dispatchAllPayoutsNow(new Date(), db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('stopped');
    expect(row.toPayAt?.getTime()).toBe(FUTURE.getTime());
    expect(payViaStripe).not.toHaveBeenCalled();
  });

  it('is skipped by the internal-project completion path, which ignores toPayAt', async () => {
    payViaStripe.mockClear();
    const { proj, pay } = await completedInternalCycle('stopped', FUTURE);
    const { dispatched } = await dispatchProjectPayoutsNow(proj, db);
    expect(dispatched).toBe(0);
    expect(await statusOf(pay)).toBe('stopped');
    expect(payViaStripe).not.toHaveBeenCalled();
  });
});
