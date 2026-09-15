import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { projects } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

const queueAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({
    add: (...a: unknown[]) => queueAdd(...a),
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
vi.mock('../../routers/tasks.js', () => ({ onProjectStatusChanged: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../billing/subscription.js', () => ({
  addSubscriptionItemForProject: vi.fn().mockResolvedValue(undefined),
  cancelProjectSubscription: vi.fn().mockResolvedValue({ deferItemRemoval: false }),
  resumeProjectSubscription: vi.fn().mockResolvedValue(undefined),
}));

const { runProjectCycle } = await import('./recurring-schedule.js');

/**
 * Cancelling a recurring project is enforced ENTIRELY through Stripe. The only
 * thing `scheduleProjectCancellation` does is drop the subscription item, and
 * the cycle then stalls because `runProjectCycle`'s payment gate stops seeing
 * paid cycles. Nothing in the cycle engine reads `projects.cancelledAt`.
 *
 * That enforcement does not exist for an INTERNAL project. It has no Stripe
 * subscription, so the payment gate is skipped outright (`gated` is false), and
 * cancellation leaves nothing behind that can stop it. These pin the gap so a
 * fix has something to flip.
 */
describe('cancellation does not stop an internal recurring project', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 30 * 86_400_000);
  const DUE = new Date(Date.now() - 86_400_000);
  const CANCELLED = new Date(Date.now() - 7 * 86_400_000);

  async function internalRecurring(cancelledAt: Date | null) {
    const id = randomUUID();
    await db.insert(projects).values({
      id, serviceType: 'recurringService', status: 'completed', isInternal: true,
      cycleCount: 1, deliverableFrequency: 'monthly', repeatsEvery: 1,
      createdAt: PAST, nextCycleAt: DUE, cancelledAt,
    } as never);
    return id;
  }

  const reload = async (id: string) => (await db.select().from(projects).where(eq(projects.id, id)))[0];

  beforeAll(async () => { ({ db, close } = await makeTestDb()); });
  afterAll(async () => { await close?.(); });

  it('re-opens a due internal project whose cancellation took effect a week ago', async () => {
    const id = await internalRecurring(CANCELLED);
    const result = await runProjectCycle(id, new Date(), db);
    const after = await reload(id);
    expect(result.acted).toBe(true);
    expect(after.status).toBe('brief');
    expect(after.cycleCount).toBe(2);
    // The cancellation date is still stamped. It simply carries no weight.
    expect(after.cancelledAt).not.toBeNull();
  });

  it('behaves identically to a project that was never cancelled', async () => {
    const id = await internalRecurring(null);
    await runProjectCycle(id, new Date(), db);
    expect((await reload(id)).status).toBe('brief');
  });

  it('is stopped by a null cycle boundary, which is what the freeze uses instead', async () => {
    const id = await internalRecurring(CANCELLED);
    await db.update(projects).set({ nextCycleAt: null }).where(eq(projects.id, id));
    const result = await runProjectCycle(id, new Date(), db);
    expect(result.acted).toBe(false);
    expect(result.reason).toBe('not-due');
    expect((await reload(id)).status).toBe('completed');
  });
});
