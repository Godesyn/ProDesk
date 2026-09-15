import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  users, agencies, brands, services, globalSettings, purchases, purchaseItems,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

// Silence the BullMQ/ioredis layer (importing the fulfillment chain constructs an
// ioredis client that would otherwise spam ECONNREFUSED with no Redis present).
vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({ add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) });
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(), chatDigestQueue: queue(),
    kanbanQueue: queue(), proposalQueue: queue(), pendingPurchasesQueue: queue(),
    queues: [], redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') }, connection: {},
  };
});

const { computePayoutSplit, reimbursementGrossForItem, REIMBURSEMENT_CYCLE } = await import('./fulfillment.js');

/**
 * Payment-plan reimbursement must NEVER OVERPAY (docs/commissions.md §2a): the
 * agency keeps its exact priority base (no interest); the non-priority trio
 * (sales / affiliate / Prodesk) absorbs ALL the interest. Over the plan the trio
 * receives `collected − priorityBase`, MINUS a few cents of per-cycle rounding —
 * every payout is floored to whole cents (PAYOUT down), so the platform may retain
 * a tiny remainder but can never disburse more than it collected (leak ≥ 0). The
 * priority base is subtracted once on the backlog-clearing cycle (cycle 5).
 *
 * Scenario: a different-agency (sales) proposal, buyer referred by an affiliate,
 * one $100 one-off on a 12-week plan: deposit $26.25 + $6.57×12 = $105.09 collected
 * (5% interest). Priority base = 50% × $100 = $50 → trio pool = $55.09.
 */
describe('payment-plan reimbursement is zero-leak', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(), affiliate: randomUUID(),
    prodOwner: randomUUID(), salesOwner: randomUUID(), brandOwner: randomUUID(),
    prodAgency: randomUUID(), salesAgency: randomUUID(), brand: randomUUID(),
    service: randomUUID(), purchase: randomUUID(), item: randomUUID(), project: randomUUID(),
  };
  const UPFRONT = 26.25, WEEKLY = 6.57, N = 12;
  const COLLECTED = UPFRONT + WEEKLY * N; // 105.09
  const PRIORITY_BASE = 0.5 * 100; // agencyRate × bare lineTotal

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'a@t', isSuperAdmin: true },
      { id: id.affiliate, email: 'aff@t' },
      { id: id.prodOwner, email: 'p@t' },
      { id: id.salesOwner, email: 's@t' },
      // Buyer referred by the affiliate user (referral lives on the brand OWNER).
      { id: id.brandOwner, email: 'b@t', referredByUserId: id.affiliate },
    ]);
    await db.insert(agencies).values([
      { id: id.prodAgency, ownerId: id.prodOwner, businessName: 'Producer' },
      { id: id.salesAgency, ownerId: id.salesOwner, businessName: 'Seller' },
    ]);
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Brand' });
    await db.insert(services).values({ id: id.service, agencyId: id.prodAgency, name: 'One-off', type: 'oneOffService' });
    await db.insert(globalSettings).values({ id: 1, agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13' });
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, type: 'proposal', status: 'completed',
      proposalSentByAgencyId: id.salesAgency, proposalSentById: id.salesOwner,
      selectedPaymentPlan: { durationWeeks: N, upfrontPercentage: 25, interestRate: 5 },
      totalAmount: UPFRONT.toFixed(2),
    });
    await db.insert(purchaseItems).values({
      id: id.item, purchaseId: id.purchase, serviceId: id.service, agencyId: id.prodAgency,
      serviceName: 'One-off', serviceType: 'oneOffService', lineTotal: '100.00', projectId: id.project,
      amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 100 },
    });
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('routes the priority base to the agency and ALL interest to the trio, with no leak', async () => {
    let trioTotal = 0;
    let week5Trio = 0;
    const byRole: Record<string, number> = {};
    for (let w = REIMBURSEMENT_CYCLE; w <= N + 1; w++) {
      const gross = reimbursementGrossForItem(
        { amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N } } } as never,
        w,
      );
      const res = await computePayoutSplit(
        id.purchase,
        { recurringOnly: false, week: w, tier: 'nonPriority', reimbursement: true, grossOf: () => gross },
        db,
      );
      const cycleTrio = res!.computedPayouts.reduce((s, cp) => s + cp.total, 0);
      if (w === REIMBURSEMENT_CYCLE) week5Trio = cycleTrio;
      trioTotal += cycleTrio;
      for (const cp of res!.computedPayouts) for (const r of cp.rows) byRole[r.commissionType] = (byRole[r.commissionType] ?? 0) + r.amount;
    }

    const g5 = reimbursementGrossForItem({ amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N } } } as never, REIMBURSEMENT_CYCLE);

    // Cycle 5: backlog ($52.53) minus the fixed priority base ($50) ≈ $2.53 to the trio.
    // Every role payout is now floored to whole cents (CHARGE up / PAYOUT down —
    // docs/commissions.md §2), so the trio gets AT MOST that and a few cents less.
    expect(week5Trio).toBeLessThanOrEqual(g5 - PRIORITY_BASE + 1e-9);
    expect(week5Trio).toBeGreaterThan(g5 - PRIORITY_BASE - 0.05);

    // Whole-plan trio total ≈ collected − priority base. Because each cut is floored
    // every cycle, the trio receives at most collected−base and a little less (here
    // ~$0.18 of cent-rounding stays with the platform). The safety invariant is
    // one-directional: we NEVER disburse more than we collected (leak ≥ 0).
    const leak = COLLECTED - PRIORITY_BASE - trioTotal;
    expect(leak).toBeGreaterThanOrEqual(0); // never overpay — the whole point of payout-down rounding
    expect(leak).toBeLessThan(0.35); // …and the underspend is only per-cycle cent rounding

    // The trio splits the pool by their share of the 50% non-priority rate — each
    // floored, so at most its ideal share and at most a few cents under across cycles.
    expect(byRole.agencySalesCommission).toBeLessThanOrEqual((COLLECTED - PRIORITY_BASE) * (30 / 50) + 1e-9); // ≤ ~33.05
    expect(byRole.agencySalesCommission).toBeGreaterThan((COLLECTED - PRIORITY_BASE) * (30 / 50) - 0.15);
    expect(byRole.affiliateCommission).toBeLessThanOrEqual((COLLECTED - PRIORITY_BASE) * (7 / 50) + 1e-9); // ≤ ~7.71
    expect(byRole.affiliateCommission).toBeGreaterThan((COLLECTED - PRIORITY_BASE) * (7 / 50) - 0.15);
    expect(byRole.prodeskCommission).toBeLessThanOrEqual((COLLECTED - PRIORITY_BASE) * (13 / 50) + 0.001); // ≤ ~14.32
    expect(byRole.prodeskCommission).toBeGreaterThan((COLLECTED - PRIORITY_BASE) * (13 / 50) - 0.15);
  });
});

/**
 * Small-deposit edge (docs/commissions.md §2a, carry-forward base): when the cycle-5
 * backlog is BELOW the agency's priority base, the base must be absorbed across the
 * following cycles — the trio gets $0 until the running collected total overtakes the
 * base, then its share. The total trio must STILL be `collected − base` (no overpay).
 *
 * Scenario: $100 one-off, 10% deposit, 12 weeks, 0% interest → upfront $10 + $7.50×12.
 * Backlog at cycle 5 = $10 + 4×$7.50 = $40 < $50 priority base. The pre-fix code
 * clamped cycle 5 to $0 and then paid full installments, OVERPAYING the trio to $60.
 */
describe('payment-plan reimbursement absorbs the priority base on a small deposit (no overpay)', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(), affiliate: randomUUID(), prodOwner: randomUUID(),
    salesOwner: randomUUID(), brandOwner: randomUUID(), prodAgency: randomUUID(),
    salesAgency: randomUUID(), brand: randomUUID(), service: randomUUID(),
    purchase: randomUUID(), item: randomUUID(), project: randomUUID(),
  };
  const UPFRONT = 10, WEEKLY = 7.5, N = 12;
  const COLLECTED = UPFRONT + WEEKLY * N; // 100
  const PRIORITY_BASE = 0.5 * 100; // 50

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'a@t', isSuperAdmin: true },
      { id: id.affiliate, email: 'aff@t' }, { id: id.prodOwner, email: 'p@t' },
      { id: id.salesOwner, email: 's@t' }, { id: id.brandOwner, email: 'b@t', referredByUserId: id.affiliate },
    ]);
    await db.insert(agencies).values([
      { id: id.prodAgency, ownerId: id.prodOwner, businessName: 'Producer' },
      { id: id.salesAgency, ownerId: id.salesOwner, businessName: 'Seller' },
    ]);
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Brand' });
    await db.insert(services).values({ id: id.service, agencyId: id.prodAgency, name: 'One-off', type: 'oneOffService' });
    await db.insert(globalSettings).values({ id: 1, agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13' });
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, type: 'proposal', status: 'completed',
      proposalSentByAgencyId: id.salesAgency, proposalSentById: id.salesOwner,
      selectedPaymentPlan: { durationWeeks: N, upfrontPercentage: 10, interestRate: 0 },
      totalAmount: UPFRONT.toFixed(2),
    });
    await db.insert(purchaseItems).values({
      id: id.item, purchaseId: id.purchase, serviceId: id.service, agencyId: id.prodAgency,
      serviceName: 'One-off', serviceType: 'oneOffService', lineTotal: '100.00', projectId: id.project,
      amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 100 },
    });
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('clamps early cycles to $0 while absorbing the base, then pays the trio exactly collected − base', async () => {
    const poolByCycle: Record<number, number> = {};
    let trioTotal = 0;
    for (let w = REIMBURSEMENT_CYCLE; w <= N + 1; w++) {
      const gross = reimbursementGrossForItem({ amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N } } } as never, w);
      const res = await computePayoutSplit(
        id.purchase,
        { recurringOnly: false, week: w, tier: 'nonPriority', reimbursement: true, grossOf: () => gross },
        db,
      );
      const cycleTrio = res!.computedPayouts.reduce((s, cp) => s + cp.total, 0);
      poolByCycle[w] = cycleTrio;
      trioTotal += cycleTrio;
    }

    // Backlog ($40) < base ($50): cycles 5 and 6 absorb the base → $0 to the trio.
    expect(poolByCycle[5]).toBe(0);
    expect(poolByCycle[6]).toBe(0);
    // Once collected overtakes the base (cycle 7: $55 > $50), the trio starts earning.
    expect(poolByCycle[7]).toBeGreaterThan(0);

    // Crucially: total is still collected − base — the base is fully absorbed, never
    // clamped-and-forgotten, so the trio is NOT overpaid (the pre-fix bug paid ~$60).
    expect(trioTotal).toBeCloseTo(COLLECTED - PRIORITY_BASE, 1); // $50, not $60
  });
});
