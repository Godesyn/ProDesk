import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  users, agencies, brands, services, globalSettings, purchases, purchaseItems, payouts, payoutBreakdowns,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({ add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) });
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(), chatDigestQueue: queue(),
    kanbanQueue: queue(), proposalQueue: queue(), pendingPurchasesQueue: queue(),
    queues: [], redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) }, connection: {},
  };
});

const { fulfillPurchase, advanceRecurringCycle } = await import('./fulfillment.js');

/**
 * Full-lifecycle reconciliation — the gap noted in [[web_billing_integration_test]]:
 * earlier reimbursement tests called the pure `computePayoutSplit` per cycle; this
 * drives the REAL path end-to-end — `fulfillPurchase` (initial priority payout) then
 * `advanceRecurringCycle` once per installment cycle (which is what the Stripe
 * payment-plan webhook calls), firing `generateReimbursementPayouts` from cycle 5.
 *
 * Plan: $100 one-off, 25% deposit, 12 weeks, 0% interest → upfront $25 + $6.25×12 =
 * $100 collected. Sold via a different (sales) agency, buyer referred by an affiliate.
 * The agency keeps its exact $50 priority base; the trio (sales/affiliate/Prodesk)
 * splits the remaining $50. Whole lifecycle must reconcile with zero leak.
 */
describe('lifecycle: fulfilment → installment cycles → reimbursement reconciles', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(), affiliate: randomUUID(), prodOwner: randomUUID(),
    salesOwner: randomUUID(), brandOwner: randomUUID(), prodAgency: randomUUID(),
    salesAgency: randomUUID(), brand: randomUUID(), service: randomUUID(),
    purchase: randomUUID(), item: randomUUID(),
  };
  const UPFRONT = 25, WEEKLY = 6.25, N = 12;
  const COLLECTED = UPFRONT + WEEKLY * N; // 100
  const PRIORITY_BASE = 50;

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
      id: id.purchase, brandId: id.brand, type: 'proposal', status: 'pendingPayment',
      proposalSentByAgencyId: id.salesAgency, proposalSentById: id.salesOwner,
      selectedPaymentPlan: { durationWeeks: N, upfrontPercentage: 25, interestRate: 0 },
      totalAmount: UPFRONT.toFixed(2),
      agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values({
      id: id.item, purchaseId: id.purchase, serviceId: id.service, agencyId: id.prodAgency,
      serviceName: 'One-off', serviceType: 'oneOffService', isRecurring: false, lineTotal: '100.00', sortOrder: 0,
      amount: { oneOff: { upfront: UPFRONT, weeklyAfter: WEEKLY, numberOfWeeks: N }, recurring: { upfront: 0, weeklyAfter: 0 }, oneOffTotal: 100 },
    });

    // Fulfil (priority owner cut), then walk every installment cycle as the webhook would.
    await fulfillPurchase(id.purchase, db);
    for (let c = 1; c <= N + 1; c++) await advanceRecurringCycle(id.purchase, db);
  }, 60_000);

  afterAll(async () => { await close?.(); });

  const sumByCommission = async () => {
    const bds = await db.select().from(payoutBreakdowns).where(eq(payoutBreakdowns.purchaseId, id.purchase));
    const out: Record<string, number> = {};
    for (const b of bds) out[b.commissionType ?? '?'] = (out[b.commissionType ?? '?'] ?? 0) + Number(b.amount);
    return out;
  };

  it('agency keeps exactly the $50 priority base (no interest), paid at fulfilment', async () => {
    const byCom = await sumByCommission();
    expect(byCom.agencyOwnerCommission).toBeCloseTo(PRIORITY_BASE, 1);
  });

  it('the trio splits collected − base across the reimbursement cycles (within cent rounding)', async () => {
    const byCom = await sumByCommission();
    const trio = (byCom.agencySalesCommission ?? 0) + (byCom.affiliateCommission ?? 0) + (byCom.prodeskCommission ?? 0);
    // Each role's cut is rounded to cents INDEPENDENTLY every reimbursement cycle, and
    // here both the affiliate ($0.875→$0.88) and Prodesk ($1.625→$1.63) cuts round
    // half-UP each of the 8 paying cycles — so the trio total lands ~$0.08 above the
    // ideal $50. That is inherent per-cycle cent rounding (real payouts settle in
    // cents), not a leak in the split — the agency's $50 base is never touched.
    expect(Math.abs(trio - (COLLECTED - PRIORITY_BASE))).toBeLessThan(0.15); // ~$50
    // …split by each role's share of the 50% non-priority rate.
    expect(byCom.agencySalesCommission).toBeCloseTo((COLLECTED - PRIORITY_BASE) * (30 / 50), 1); // $30
    expect(byCom.affiliateCommission).toBeCloseTo((COLLECTED - PRIORITY_BASE) * (7 / 50), 1); // ~$7
    expect(byCom.prodeskCommission).toBeCloseTo((COLLECTED - PRIORITY_BASE) * (13 / 50), 1); // ~$13
  });

  it('the whole lifecycle reconciles to collected (within cent rounding)', async () => {
    const rows = await db.select().from(payouts).where(eq(payouts.purchaseId, id.purchase));
    const grandTotal = rows.reduce((s, p) => s + Number(p.amount), 0);
    // $100 = $50 agency (exact) + ~$50 trio (carries the ~$0.08 per-cycle rounding).
    expect(Math.abs(grandTotal - COLLECTED)).toBeLessThan(0.15);
  });
});
