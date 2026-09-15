import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import {
  users, agencies, brands, services, globalSettings,
  purchases, purchaseItems, projects,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

vi.mock('../../jobs/queues.js', () => {
  const queue = () => ({ add: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) });
  return {
    emailQueue: queue(), payoutQueue: queue(), videoQueue: queue(), chatDigestQueue: queue(),
    kanbanQueue: queue(), proposalQueue: queue(), pendingPurchasesQueue: queue(),
    queues: [], redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK') }, connection: {},
  };
});

const { predictForViewer } = await import('./predict-earnings.js');

/**
 * Regression guard: a SALES agency (the proposal sender, which produces none of
 * the work) must still see its future agency-sales earnings. The forecast used to
 * gather candidate projects by the producing `projects.agencyId`, so a sales /
 * referred-by agency — paid via `beneficiaryAgencyId` on ANOTHER agency's
 * projects — got an empty forecast. See predict-earnings.ts `predictForViewer`.
 */
describe('predictForViewer — sales agency sees its cross-agency future earnings', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(),
    prodOwner: randomUUID(), salesOwner: randomUUID(), brandOwner: randomUUID(),
    prodAgency: randomUUID(), salesAgency: randomUUID(), brand: randomUUID(),
    service: randomUUID(), purchase: randomUUID(), item: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'a@t', isSuperAdmin: true },
      { id: id.prodOwner, email: 'p@t' },
      { id: id.salesOwner, email: 's@t' },
      { id: id.brandOwner, email: 'b@t' },
    ]);
    await db.insert(agencies).values([
      { id: id.prodAgency, ownerId: id.prodOwner, businessName: 'Producer' },
      { id: id.salesAgency, ownerId: id.salesOwner, businessName: 'Seller' },
    ]);
    await db.insert(brands).values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Brand' });
    await db.insert(services).values({ id: id.service, agencyId: id.prodAgency, name: 'Retainer', type: 'recurringService' });
    await db.insert(globalSettings).values({ id: 1, agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13' });

    // A paid proposal SENT BY the sales agency for a service the PRODUCING agency owns.
    await db.insert(purchases).values({
      id: id.purchase, brandId: id.brand, type: 'proposal', status: 'completed',
      totalAmount: '200.00', proposalSentByAgencyId: id.salesAgency, proposalSentById: id.salesOwner,
      agencyCommission: '50', salesAgencyCommission: '30', affiliateCommission: '7', prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values({
      id: id.item, purchaseId: id.purchase, serviceId: id.service, agencyId: id.prodAgency,
      serviceName: 'Retainer', serviceType: 'recurringService', isRecurring: true, lineTotal: '0.00',
      amount: { oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 }, recurring: { upfront: 0, weeklyAfter: 100 }, oneOffTotal: 0 },
    });
    // An active recurring project owned by the producing agency (drives the weekly forecast).
    await db.insert(projects).values({
      purchaseId: id.purchase, purchaseItemId: id.item, brandId: id.brand, agencyId: id.prodAgency,
      serviceId: id.service, serviceName: 'Retainer', serviceType: 'recurringService', status: 'production',
      amount: { recurring: { weeklyAfter: 100 } }, cycleCount: 1,
    });
  }, 30_000);

  afterAll(async () => { await close?.(); });

  it('produces agency-sales forecast rows for the sender agency (was empty before the fix)', async () => {
    const rows = await predictForViewer(db, {
      mode: 'agency', agencyId: id.salesAgency, viewerId: id.salesOwner, viewerFilter: 'owner',
    });
    expect(rows.length).toBeGreaterThan(0);
    // Every row is the sales agency's own bank-account payout.
    expect(rows.every((r) => r.as === 'agency' && r.beneficiaryAgencyId === id.salesAgency)).toBe(true);
    // 30% of the $100 weekly recurring fee.
    expect(rows.every((r) => Number(r.amount) === 30)).toBe(true);
    expect(rows.every((r) => r.breakdown[0].commissionType === 'agencySalesCommission')).toBe(true);
  });

  it('does not leak the sales cut into the producing agency owner view', async () => {
    const rows = await predictForViewer(db, {
      mode: 'agency', agencyId: id.prodAgency, viewerId: id.prodOwner, viewerFilter: 'owner',
    });
    // Producer sees its own 50% owner cut, never the sales agency's beneficiary rows.
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.beneficiaryAgencyId === id.prodAgency)).toBe(true);
    expect(rows.every((r) => Number(r.amount) === 50)).toBe(true);
  });
});
