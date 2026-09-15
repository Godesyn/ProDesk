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

const { onRecurringProjectCompleted, reconcileDueProjects } = await import('./recurring-schedule.js');

/**
 * Freezing a recurring project is expressed as a null `next_cycle_at`. Every
 * cycle entry point already treats a missing boundary as "nothing scheduled",
 * so a frozen project that completes stays completed instead of re-opening at
 * `brief`. These pin that, since the freeze has no other enforcement.
 */
describe('recurring projects — a null nextCycleAt freezes the cycle', () => {
  let db: DB;
  let close: () => Promise<void>;
  const PAST = new Date(Date.now() - 30 * 86_400_000);
  const DUE = new Date(Date.now() - 86_400_000);

  async function completedRecurring(nextCycleAt: Date | null) {
    const id = randomUUID();
    await db.insert(projects).values({
      id, serviceType: 'recurringService', status: 'completed', isInternal: true,
      cycleCount: 1, deliverableFrequency: 'monthly', repeatsEvery: 1,
      createdAt: PAST, nextCycleAt,
    } as never);
    return (await db.select().from(projects).where(eq(projects.id, id)))[0];
  }

  const reload = async (id: string) =>
    (await db.select().from(projects).where(eq(projects.id, id)))[0];

  beforeAll(async () => { ({ db, close } = await makeTestDb()); });
  afterAll(async () => { await close?.(); });

  it('re-opens an unfrozen project at brief and advances the cycle', async () => {
    const p = await completedRecurring(DUE);
    await onRecurringProjectCompleted(p, new Date(), db);
    const after = await reload(p.id);
    expect(after.status).toBe('brief');
    expect(after.cycleCount).toBe(2);
  });

  it('leaves a frozen project completed on the same trigger', async () => {
    const p = await completedRecurring(null);
    await onRecurringProjectCompleted(p, new Date(), db);
    const after = await reload(p.id);
    expect(after.status).toBe('completed');
    expect(after.cycleCount).toBe(1);
    expect(after.nextCycleAt).toBeNull();
  });

  it('does not re-arm a cycle job for a frozen project', async () => {
    queueAdd.mockClear();
    const p = await completedRecurring(null);
    await onRecurringProjectCompleted(p, new Date(), db);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('is invisible to the daily reconcile backstop', async () => {
    const frozen = await completedRecurring(null);
    const { reset } = await reconcileDueProjects(new Date(), db);
    expect(reset).toBe(0);
    expect((await reload(frozen.id)).status).toBe('completed');
  });
});
