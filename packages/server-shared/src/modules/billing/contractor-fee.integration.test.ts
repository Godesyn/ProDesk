import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  users,
  agencies,
  brands,
  services,
  globalSettings,
  purchases,
  purchaseItems,
  projects,
  payouts,
  payoutBreakdowns,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';
import { cycleOfPayment } from '../projects/cycle-math.js';

// Same ioredis/BullMQ neutralisation as fulfillment.integration.test.ts — without
// it a stray queue.add (built with maxRetriesPerRequest: null) would hang forever.
vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  });
  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(),
    chatDigestQueue: queue(), kanbanQueue: queue(), proposalQueue: queue(),
    pendingPurchasesQueue: queue(), queues: [], redis, connection: {},
  };
});

const { fulfillPurchase } = await import('./fulfillment.js');
const { applyContractorFee, reverseContractorFee, contractorBudgetCeiling, agencyPayoutsForProject } =
  await import('../../routers/projects.js');

/**
 * Guards the per-project contractor-fee plumbing. Payouts are split PER PROJECT
 * (docs/commissions.md §7), and the contractor budget is DEDUCTED from the agency
 * owner's payout — so the deduction must hit the payout of the project the
 * contractor was allocated to, and never a sibling project's payout in the same
 * purchase. `agencyPayoutsForProject` resolves that payout via the breakdown's
 * projectId; this exercises it against a real two-project purchase. This is the
 * financial-correctness test for the join/dedup that earlier had only typecheck
 * coverage.
 */
describe('contractor fee — per-project deduction isolation', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(), agencyOwner: randomUUID(), brandOwner: randomUUID(),
    contractor: randomUUID(), agency: randomUUID(), brand: randomUUID(),
    serviceA: randomUUID(), serviceB: randomUUID(),
    purchase: randomUUID(), itemA: randomUUID(), itemB: randomUUID(),
  };
  let projA: typeof projects.$inferSelect;
  let projB: typeof projects.$inferSelect;

  // The agency-owner payout amount currently recorded for a project.
  const agencyAmount = async (project: typeof projects.$inferSelect) => {
    const rows = await agencyPayoutsForProject(db, project);
    return rows.reduce((s, r) => s + Number(r.amount), 0);
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'admin@t', isSuperAdmin: true },
      { id: id.agencyOwner, email: 'ao@t' },
      { id: id.brandOwner, email: 'bo@t' },
      { id: id.contractor, email: 'contractor@t' },
    ]);
    // No designees / service-level commissions → agency owner keeps the full 50%.
    await db.insert(agencies).values({ id: id.agency, ownerId: id.agencyOwner, businessName: 'Acme' });
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Globex' });
    await db.insert(services).values([
      { id: id.serviceA, agencyId: id.agency, name: 'Service A', type: 'oneOffService' },
      { id: id.serviceB, agencyId: id.agency, name: 'Service B', type: 'oneOffService' },
    ]);
    await db.insert(globalSettings).values({ id: 1, agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13' });
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, userId: id.brandOwner, type: 'marketplace', status: 'pendingPayment',
      totalAmount: '300.00', agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values([
      { id: id.itemA, purchaseId: id.purchase, serviceId: id.serviceA, agencyId: id.agency, serviceName: 'Service A', serviceType: 'oneOffService', lineTotal: '100.00', quantity: 1, sortOrder: 0,
        amount: { oneOff: { upfront: 100, weeklyAfter: 0, numberOfWeeks: 0 }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 100 } },
      { id: id.itemB, purchaseId: id.purchase, serviceId: id.serviceB, agencyId: id.agency, serviceName: 'Service B', serviceType: 'oneOffService', lineTotal: '200.00', quantity: 1, sortOrder: 1,
        amount: { oneOff: { upfront: 200, weeklyAfter: 0, numberOfWeeks: 0 }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 200 } },
    ]);
    await fulfillPurchase(id.purchase, db);

    const proj = await db.select().from(projects).where(eq(projects.purchaseId, id.purchase));
    projA = proj.find((p) => p.serviceName === 'Service A')!;
    projB = proj.find((p) => p.serviceName === 'Service B')!;
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('baseline: each project carries its own agency-owner payout (50%)', async () => {
    expect(await agencyAmount(projA)).toBe(50); // 50% of $100
    expect(await agencyAmount(projB)).toBe(100); // 50% of $200
    // The ceiling matches the project's own agency payout, never the sibling's.
    expect(await contractorBudgetCeiling({ db }, projA)).toBe(50);
    expect(await contractorBudgetCeiling({ db }, projB)).toBe(100);
  });

  it('applyContractorFee deducts ONLY from the allocated project (B), not its sibling (A)', async () => {
    await db.update(projects).set({ productionAssigneeId: id.contractor, assigneeType: 'contractor', contractorBudget: '40.00' }).where(eq(projects.id, projB.id));
    projB = (await db.select().from(projects).where(eq(projects.id, projB.id)))[0];
    await applyContractorFee({ db }, projB);

    // Project B's agency payout drops by the $40 fee; project A is untouched.
    expect(await agencyAmount(projB)).toBe(60);
    expect(await agencyAmount(projA)).toBe(50);

    // A contractor payout for $40 is created, scoped to project B.
    const contractorPayouts = await db.select().from(payouts).where(and(eq(payouts.purchaseId, id.purchase), eq(payouts.beneficiaryId, id.contractor)));
    expect(contractorPayouts).toHaveLength(1);
    expect(contractorPayouts[0].as).toBe('contractor');
    expect(Number(contractorPayouts[0].amount)).toBe(40);
    const crBd = await db.select().from(payoutBreakdowns).where(eq(payoutBreakdowns.payoutId, contractorPayouts[0].id));
    expect(crBd.every((b) => b.projectId === projB.id)).toBe(true);

    // The deduction breakdown is tagged to project B (so it can be reversed precisely).
    const bBreakdowns = await db.select().from(payoutBreakdowns).where(and(eq(payoutBreakdowns.projectId, projB.id), eq(payoutBreakdowns.commissionType, 'agencyNet')));
    expect(bBreakdowns).toHaveLength(1);
    expect(Number(bBreakdowns[0].amount)).toBe(-40);
  });

  it('is idempotent — re-applying does not deduct twice', async () => {
    await applyContractorFee({ db }, projB);
    expect(await agencyAmount(projB)).toBe(60); // unchanged
    const contractorPayouts = await db.select().from(payouts).where(and(eq(payouts.purchaseId, id.purchase), eq(payouts.beneficiaryId, id.contractor)));
    expect(contractorPayouts).toHaveLength(1);
  });

  it('reverseContractorFee re-credits ONLY project B; project A stays untouched', async () => {
    await reverseContractorFee({ db }, projB);
    expect(await agencyAmount(projB)).toBe(100); // $40 refunded
    expect(await agencyAmount(projA)).toBe(50); // never moved

    const contractorPayouts = await db.select().from(payouts).where(and(eq(payouts.purchaseId, id.purchase), eq(payouts.beneficiaryId, id.contractor)));
    expect(contractorPayouts[0].status).toBe('failed');
  });
});

/**
 * Edge case: the contractor budget consumes the agency owner's ENTIRE net for the
 * project. applyContractorFee deletes the now-$0 owner payout (a meaningless
 * payable); reverseContractorFee must recreate it when the project is cancelled.
 */
describe('contractor fee — full-consumption delete then recreate', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(), agencyOwner: randomUUID(), brandOwner: randomUUID(),
    contractor: randomUUID(), agency: randomUUID(), brand: randomUUID(),
    service: randomUUID(), purchase: randomUUID(), item: randomUUID(),
  };
  let project: typeof projects.$inferSelect;

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'admin@t', isSuperAdmin: true },
      { id: id.agencyOwner, email: 'ao@t' }, { id: id.brandOwner, email: 'bo@t' },
      { id: id.contractor, email: 'c@t' },
    ]);
    await db.insert(agencies).values({ id: id.agency, ownerId: id.agencyOwner, businessName: 'Acme' });
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Globex' });
    await db.insert(services).values({ id: id.service, agencyId: id.agency, name: 'Solo', type: 'oneOffService' });
    await db.insert(globalSettings).values({ id: 1, agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13' });
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, userId: id.brandOwner, type: 'marketplace', status: 'pendingPayment',
      totalAmount: '100.00', agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values({
      id: id.item, purchaseId: id.purchase, serviceId: id.service, agencyId: id.agency, serviceName: 'Solo', serviceType: 'oneOffService', lineTotal: '100.00', quantity: 1, sortOrder: 0,
      amount: { oneOff: { upfront: 100, weeklyAfter: 0, numberOfWeeks: 0 }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 100 },
    });
    await fulfillPurchase(id.purchase, db);
    project = (await db.select().from(projects).where(eq(projects.purchaseId, id.purchase)))[0];
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('deletes the $0 owner payout when the fee consumes the whole net, and creates the contractor payout', async () => {
    await db.update(projects).set({ productionAssigneeId: id.contractor, assigneeType: 'contractor', contractorBudget: '50.00' }).where(eq(projects.id, project.id));
    project = (await db.select().from(projects).where(eq(projects.id, project.id)))[0];
    await applyContractorFee({ db }, project);

    // Owner payout gone (no $0 payable left), so the ceiling no longer caps here.
    const agencyRows = await agencyPayoutsForProject(db, project);
    expect(agencyRows).toHaveLength(0);
    expect(await contractorBudgetCeiling({ db }, project)).toBeNull();

    const contractorPayout = (await db.select().from(payouts).where(eq(payouts.beneficiaryId, id.contractor)))[0];
    expect(Number(contractorPayout.amount)).toBe(50);
  });

  it('recreates the agency payout on reversal so the refunded budget is paid back', async () => {
    await reverseContractorFee({ db }, project);
    const agencyRows = await agencyPayoutsForProject(db, project);
    expect(agencyRows).toHaveLength(1);
    expect(Number(agencyRows[0].amount)).toBe(50);
    expect(agencyRows[0].beneficiaryAgencyId).toBe(id.agency);
  });
});

/**
 * Recurring deliverable cycle: the contractor fee must be booked PER CYCLE. The
 * idempotency guard is scoped by the cycle's weekly-payment number (`week`), and
 * that same `week` is what dispatch.eligibleBreakdowns feeds to cycleOfPayment to
 * decide when the fee releases. So a project re-allocated for its NEXT cycle must
 * (a) book a fresh contractor payout — not be silently blocked by the prior
 * cycle's row — and (b) carry a `week` that gates dispatch on the NEW cycle's
 * completion, never on an earlier cycle's. Regression test for the bug where a
 * cycle-2 contractor payout was either blocked outright or dispatched early.
 */
describe('contractor fee — per-cycle on a recurring project', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    agencyOwner: randomUUID(), brandOwner: randomUUID(), contractor: randomUUID(),
    agency: randomUUID(), brand: randomUUID(), purchase: randomUUID(), project: randomUUID(),
  };
  // Fixed anchor so cycle maths are deterministic (no Date.now()).
  const anchor = new Date('2026-01-01T00:00:00.000Z');
  const spec = { type: 'recurringService' as const, deliverableFrequency: 'monthly' as const, repeatsEvery: null, anchor };

  const contractorPayouts = () =>
    db.select().from(payouts).where(and(eq(payouts.purchaseId, id.purchase), eq(payouts.beneficiaryId, id.contractor)));

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.agencyOwner, email: 'ao@t' }, { id: id.brandOwner, email: 'bo@t' }, { id: id.contractor, email: 'c@t' },
    ]);
    await db.insert(agencies).values({ id: id.agency, ownerId: id.agencyOwner, businessName: 'Acme' });
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Globex' });
    // Internal purchase → applyContractorFee skips the agency-owner deduction and
    // simply books the contractor payout (mirrors the real internal-project flow).
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, userId: id.brandOwner, type: 'marketplace', status: 'paid', isInternal: true, totalAmount: '0.00',
    });
    await db.insert(projects).values({
      id: id.project, purchaseId: id.purchase, brandId: id.brand, agencyId: id.agency,
      serviceName: 'Monthly retainer', serviceType: 'recurringService', deliverableFrequency: 'monthly', repeatsEvery: null,
      isInternal: true, status: 'production', createdAt: anchor, cycleCount: 1,
      productionAssigneeId: id.contractor, assigneeType: 'contractor', contractorBudget: '630.00',
    });
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('cycle 1: books a contractor payout whose week gates on cycle 1', async () => {
    const project = (await db.select().from(projects).where(eq(projects.id, id.project)))[0];
    await applyContractorFee({ db }, project);
    const pos = await contractorPayouts();
    expect(pos).toHaveLength(1);
    const bd = (await db.select().from(payoutBreakdowns).where(eq(payoutBreakdowns.payoutId, pos[0].id)))[0];
    expect(cycleOfPayment(bd.week ?? 1, spec)).toBe(1);
  });

  it('is idempotent within the same cycle — re-applying books nothing new', async () => {
    const project = (await db.select().from(projects).where(eq(projects.id, id.project)))[0];
    await applyContractorFee({ db }, project);
    expect(await contractorPayouts()).toHaveLength(1);
  });

  it('cycle 2: re-allocation books a SECOND payout, gated on cycle 2 (neither blocked nor early)', async () => {
    // The recurring engine advances the project to its next cycle and re-allocates.
    await db.update(projects)
      .set({ cycleCount: 2, productionAssigneeId: id.contractor, assigneeType: 'contractor', contractorBudget: '630.00' })
      .where(eq(projects.id, id.project));
    const project = (await db.select().from(projects).where(eq(projects.id, id.project)))[0];
    await applyContractorFee({ db }, project);

    // Cycle-2 payout was NOT blocked by the cycle-1 row.
    expect(await contractorPayouts()).toHaveLength(2);

    // The two fees carry distinct weeks mapping to cycle 1 and cycle 2 — so each
    // releases only when its own cycle completes.
    const bds = await db.select().from(payoutBreakdowns)
      .where(and(eq(payoutBreakdowns.projectId, id.project), eq(payoutBreakdowns.commissionType, 'contractorCommission')));
    expect(bds).toHaveLength(2);
    const cycles = bds.map((b) => cycleOfPayment(b.week ?? 1, spec)).sort();
    expect(cycles).toEqual([1, 2]);
  });
});
