import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { users, projects, payouts, payoutBreakdowns } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

// Neutralise BullMQ/ioredis (see fulfillment.integration.test.ts) and stub the
// external payout providers so dispatch never makes a real transfer.
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
vi.mock('./wise.js', () => ({ fundWiseViaStripe: vi.fn().mockResolvedValue(undefined) }));
// This file verifies the refundable (flag ON) completion gate — pin it so it's
// independent of the flag's current default.
vi.mock('../../lib/feature-flags.js', () => ({ IS_RECURRING_PROJECTS_REFUNDABLE: true }));

const { dispatchPayout, dispatchDuePayouts } = await import('./dispatch.js');

/**
 * Guards the completion gate: NO payout dispatches until the work that funds it
 * is complete — for every role and every service type (the rule that replaced
 * the old "weekly-billed items pay on schedule" escape). For a recurring
 * deliverable cycle, "complete" is per-cycle: a cycle-K cut releases once the
 * project advances past cycle K (cycleCount only advances out of `completed`).
 */
describe('dispatch — completion gate (nobody paid before the work completes)', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 86_400_000);
  const staff = randomUUID();
  const admin = randomUUID();

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      // Staff recipient with a linked Stripe account → its priority cut CAN pay
      // once eligible. The platform admin has NO payout account on purpose.
      { id: staff, email: 'staff@t', stripeAccountId: 'acct_x', activePayoutMethod: 'stripe' },
      { id: admin, email: 'admin@t', isSuperAdmin: true },
    ] as never);
  });
  afterAll(async () => { await close?.(); });

  it('holds a recurring PRIORITY cut until its funding cycle completes, then pays', async () => {
    const proj = randomUUID();
    const pay = randomUUID();
    await db.insert(projects).values({
      id: proj, serviceType: 'recurringService', status: 'production',
      cycleCount: 1, deliverableFrequency: 'weekly', repeatsEvery: 1, createdAt: PAST,
    } as never);
    await db.insert(payouts).values({
      id: pay, amount: '10.00', currency: 'AUD', beneficiaryId: staff, as: 'staff',
      status: 'pending', toPayAt: PAST,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj, commissionType: 'productionManagerCommission', week: 1, amount: '10.00',
    } as never);

    // Cycle 1 still in flight (status != completed) → held, even though billing is weekly.
    await dispatchPayout(pay, db);
    let row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('pending');
    expect(payViaStripe).not.toHaveBeenCalled();

    // Project advances to cycle 2 → cycle 1 proven complete → the cut releases.
    await db.update(projects).set({ cycleCount: 2 }).where(eq(projects.id, proj));
    await dispatchPayout(pay, db);
    row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('paid');
    expect(Number(row.paidAmount)).toBe(10);
    expect(payViaStripe).toHaveBeenCalledTimes(1);
  });

  it('holds the platform cut and settles it INTERNALLY on completion (no external transfer)', async () => {
    payViaStripe.mockClear();
    const proj = randomUUID();
    const pay = randomUUID();
    await db.insert(projects).values({
      id: proj, serviceType: 'oneOffService', status: 'production', cycleCount: 1, createdAt: PAST,
    } as never);
    await db.insert(payouts).values({
      id: pay, amount: '26.00', currency: 'AUD', beneficiaryId: admin, as: 'admin',
      status: 'pending', toPayAt: PAST,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj, commissionType: 'prodeskCommission', week: 1, amount: '26.00',
    } as never);

    // Not completed → held (the platform no longer keeps its cut up front).
    await dispatchPayout(pay, db);
    let row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('pending');

    // Completed → settled internally: marked paid with NO provider call, despite
    // the super-admin having no linked payout account.
    await db.update(projects).set({ status: 'completed' }).where(eq(projects.id, proj));
    await dispatchPayout(pay, db);
    row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('paid');
    expect(Number(row.paidAmount)).toBe(26);
    expect(row.completelyPaidAt).toBeInstanceOf(Date);
    expect(payViaStripe).not.toHaveBeenCalled();
  });

  it('holds a one-off cut until the project is completed', async () => {
    const proj = randomUUID();
    const pay = randomUUID();
    await db.insert(projects).values({
      id: proj, serviceType: 'oneOffService', status: 'revision', cycleCount: 1, createdAt: PAST,
    } as never);
    await db.insert(payouts).values({
      id: pay, amount: '40.00', currency: 'AUD', beneficiaryId: staff, as: 'staff',
      status: 'pending', toPayAt: PAST,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj, commissionType: 'agencyOwnerCommission', week: 1, amount: '40.00',
    } as never);

    await dispatchPayout(pay, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('pending');
  });
});

/**
 * Guards the cron's failed-payout retry: `failed` only ever means the provider
 * did NOT settle, so due failed payouts are revived to `pending` and rejoin the
 * dispatch pool — except wire payouts whose Stripe→Wise funding already moved
 * money, which must be reconciled manually.
 */
describe('dispatch cron — failed payouts are retried', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 86_400_000);
  const NOW = new Date();
  const staff = randomUUID();

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values({
      id: staff, email: 'retry-staff@t', stripeAccountId: 'acct_x', activePayoutMethod: 'stripe',
    } as never);
  });
  afterAll(async () => { await close?.(); });

  const seed = async (payout: Record<string, unknown>, breakdown: Record<string, unknown> = {}) => {
    const proj = randomUUID();
    const pay = randomUUID();
    await db.insert(projects).values({
      id: proj, serviceType: 'oneOffService', status: 'completed', cycleCount: 1, createdAt: PAST,
    } as never);
    await db.insert(payouts).values({
      id: pay, currency: 'AUD', beneficiaryId: staff, as: 'staff',
      status: 'failed', toPayAt: PAST, ...payout,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj, commissionType: 'agencyOwnerCommission', week: 1, ...breakdown,
    } as never);
    return pay;
  };

  it('revives a due failed payout and pays it in the same run', async () => {
    payViaStripe.mockClear();
    const pay = await seed({ amount: '15.00' }, { amount: '15.00' });

    const result = await dispatchDuePayouts(NOW, db);
    expect(result.retriedFailed).toBe(1);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('paid');
    expect(payViaStripe).toHaveBeenCalledTimes(1);
  });

  it('un-stamps breakdowns that no money backs, so the retry is not stuck at payable 0', async () => {
    // Wire stamps paid_at before funding; when funding failed with nothing
    // settled (paidAmount 0) the stamp is a lie. Recipient has no wire account
    // linked, so after revival the payout WAITS as pending (not failed).
    const pay = await seed(
      { amount: '20.00', method: 'wire' },
      { amount: '20.00', paidAt: PAST },
    );

    await dispatchDuePayouts(NOW, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('pending');
    const [bd] = await db.select().from(payoutBreakdowns).where(eq(payoutBreakdowns.payoutId, pay));
    expect(bd.paidAt).toBeNull();
  });

  it('keeps stamps of a partially-paid payout and only retries the remainder', async () => {
    payViaStripe.mockClear();
    const pay = await seed(
      { amount: '30.00', paidAmount: '10.00' },
      { amount: '10.00', paidAt: PAST },
    );
    const proj2 = randomUUID();
    await db.insert(projects).values({
      id: proj2, serviceType: 'oneOffService', status: 'completed', cycleCount: 1, createdAt: PAST,
    } as never);
    await db.insert(payoutBreakdowns).values({
      payoutId: pay, projectId: proj2, commissionType: 'agencyOwnerCommission', week: 1, amount: '20.00',
    } as never);

    await dispatchDuePayouts(NOW, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('paid');
    expect(Number(row.paidAmount)).toBe(30);
    // Only the unpaid $20 item was dispatched — the stamped $10 stayed settled.
    expect(payViaStripe).toHaveBeenCalledTimes(1);
    expect(payViaStripe.mock.calls[0][0]).toMatchObject({ amount: 20 });
  });

  it('does NOT revive a failed payout that has no breakdown items (can never dispatch)', async () => {
    const pay = randomUUID();
    await db.insert(payouts).values({
      id: pay, currency: 'AUD', beneficiaryId: staff, as: 'staff',
      status: 'failed', toPayAt: PAST, amount: '630.32',
    } as never);

    await dispatchDuePayouts(NOW, db);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('failed');
  });

  it('does NOT retry a wire payout whose Stripe→Wise funding already started', async () => {
    const pay = await seed(
      {
        amount: '25.00', method: 'wire',
        wiseFunding: { status: 'paying_out', grossAmount: 25 },
      },
      { amount: '25.00', paidAt: PAST },
    );

    const result = await dispatchDuePayouts(NOW, db);
    expect(result.retriedFailed).toBe(0);
    const row = (await db.select().from(payouts).where(eq(payouts.id, pay)))[0];
    expect(row.status).toBe('failed');
    const [bd] = await db.select().from(payoutBreakdowns).where(eq(payoutBreakdowns.payoutId, pay));
    expect(bd.paidAt).not.toBeNull();
  });
});
