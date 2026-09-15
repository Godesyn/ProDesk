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
  invoices,
  invoiceItems,
} from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { makeTestDb } from '../../test/db.js';

// Neutralise the BullMQ/ioredis layer. `jobs/queues.ts` builds its ioredis client
// with `maxRetriesPerRequest: null`, so a stray `queue.add` with no Redis would
// QUEUE FOREVER (never rejects) and hang the test — and fulfillment's best-effort
// `.catch()` can't rescue a promise that never settles. Stubbing the module makes
// every enqueue resolve instantly, so the DB-only money math is what's exercised.
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
    emailQueue: queue(),
    payoutQueue: queue(),
    videoQueue: queue(),
    chatDigestQueue: queue(),
    kanbanQueue: queue(),
    proposalQueue: queue(),
    pendingPurchasesQueue: queue(),
    queues: [],
    redis,
    connection: {},
  };
});

// Import AFTER the mock is registered (vi.mock is hoisted, but keep it explicit).
const { fulfillPurchase, generateReimbursementPayouts } =
  await import('./fulfillment.js');

/**
 * End-to-end fulfilment integration test — the prodesk-web equivalent of the
 * Flutter/functions `test/test_modules/one_off_one_item_test.ts`. It seeds a real
 * (PGlite) database, runs a paid marketplace purchase through `fulfillPurchase`,
 * and asserts the WHOLE downstream fan-out: the spawned project, the per-role
 * commission split (payouts + breakdowns), and the generated invoices.
 *
 * The numbers are the Flutter/functions stack's contract, taken straight from
 * `docs/commissions.md` (the single source of truth). This test exists to catch
 * any drift of prodesk-web away from that stack's money math.
 *
 * Scenario — Scenario 1 (Marketplace, no proposal, no referral) from the doc, with
 * the producing agency's 50% further carved among its three designees:
 *
 *   gross (lineTotal)               = $100
 *   agency 50% → owner net          = 100·(0.50 − 0.02 − 0.03 − 0.05) = $40  → agency itself
 *     production designee  2%       = $2   → allocation designee (staff)
 *     briefing  designee   3%       = $3   → briefing designee (staff)
 *     approval  designee   5%       = $5   → approval designee (staff)
 *   prodesk = remainder             = 100 − 40 − 2 − 3 − 5 = $50  (= base 13 + freed sales 30 + freed affiliate 7)
 *
 * With no referred-by agency and no proposal, the 30% sales and 7% affiliate cuts
 * have no recipient and fold into Prodesk's remainder (doc §4 Scenario 1 fallback).
 */
describe('fulfillPurchase — marketplace one-off, full commission split (Flutter parity)', () => {
  let db: DB;
  let close: () => Promise<void>;

  // Seeded ids, resolved in beforeAll.
  const id = {
    superAdmin: randomUUID(),
    agencyOwner: randomUUID(),
    brandOwner: randomUUID(),
    productionStaff: randomUUID(),
    briefingStaff: randomUUID(),
    approvalStaff: randomUUID(),
    agency: randomUUID(),
    brand: randomUUID(),
    service: randomUUID(),
    purchase: randomUUID(),
    item: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());

    await db.insert(users).values([
      { id: id.superAdmin, email: 'admin@prodesk.test', isSuperAdmin: true },
      { id: id.agencyOwner, email: 'agency-owner@test' },
      { id: id.brandOwner, email: 'brand-owner@test' },
      { id: id.productionStaff, email: 'production@test' },
      { id: id.briefingStaff, email: 'briefing@test' },
      { id: id.approvalStaff, email: 'approval@test' },
    ]);

    await db.insert(agencies).values({
      id: id.agency,
      ownerId: id.agencyOwner,
      businessName: 'Acme Agency',
      // Production-manager commission is routed to the ALLOCATION designee.
      allocationDesigneeId: id.productionStaff,
      briefingDesigneeId: id.briefingStaff,
      approvalDesigneeId: id.approvalStaff,
    });

    await db.insert(brands).values({
      id: id.brand,
      ownerId: id.brandOwner,
      businessName: 'Globex Brand',
    });

    // Service-level manager commissions win over agency-level (computePayoutSplit).
    await db.insert(services).values({
      id: id.service,
      agencyId: id.agency,
      name: 'Logo Design',
      type: 'oneOffService',
      productionManagerCommission: '2',
      briefingManagerCommission: '3',
      internalApprovalCommission: '5',
    });

    // Global platform rates (percentages; the split reads these, never hard-codes).
    await db.insert(globalSettings).values({
      id: 1,
      agencyCommission: '50',
      salesAgencyCommission: '30',
      affiliateCommission: '7',
      prodeskCommission: '13',
    });

    await db.insert(purchases).values({
      id: id.purchase,
      brandId: id.brand,
      userId: id.brandOwner,
      type: 'marketplace',
      status: 'pendingPayment',
      totalAmount: '100.00',
      // Frozen rate snapshot (carried onto the spawned project's `commissions`).
      agencyCommission: '50',
      salesAgencyCommission: '30',
      affiliateCommission: '7',
      prodeskCommission: '13',
      amount: { oneOffSubtotal: 100, dueToday: 100, weekly: 0 },
    });

    await db.insert(purchaseItems).values({
      id: id.item,
      purchaseId: id.purchase,
      serviceId: id.service,
      agencyId: id.agency,
      serviceName: 'Logo Design',
      serviceType: 'oneOffService',
      // gross basis for the upfront split.
      lineTotal: '100.00',
      quantity: 1,
      isRecurring: false,
      // Frozen at checkout from the service (mirrors purchasesRouter.checkoutServices)
      // — the spawned project's commission snapshot reads THIS, while the payout
      // split reads the live service row; in production they are kept equal.
      commissions: {
        productionManagerCommission: 2,
        briefingManagerCommission: 3,
        internalApprovalCommission: 5,
      },
      amount: {
        oneOff: { upfront: 100, weeklyAfter: 0, numberOfWeeks: 0 },
        recurring: { upfront: 0, weeklyAfter: 0 },
        oneOffTotal: 100,
      },
      sortOrder: 0,
    });

    await fulfillPurchase(id.purchase, db);
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  it('marks the purchase completed and records payment', async () => {
    const purchase = (
      await db.select().from(purchases).where(eq(purchases.id, id.purchase))
    )[0];
    expect(purchase.status).toBe('completed');
    expect(Number(purchase.paymentReceived)).toBe(100);
    expect(purchase.completedAt).toBeInstanceOf(Date);
    expect(purchase.paidAt).toBeInstanceOf(Date);
  });

  it('spawns exactly one project with the frozen commission/config snapshot', async () => {
    const rows = await db
      .select()
      .from(projects)
      .where(eq(projects.purchaseId, id.purchase));
    expect(rows).toHaveLength(1);
    const project = rows[0];

    // One-off non-digital service with no custom fields starts in `brief`.
    expect(project.status).toBe('brief');
    expect(project.cycleCount).toBe(1);
    expect(project.agencyId).toBe(id.agency);
    expect(project.brandId).toBe(id.brand);
    expect(project.serviceName).toBe('Logo Design');
    expect(project.nextCycleAt).toBeNull(); // one-off has no deliverable cycle

    // Frozen rate snapshot (buildProjectValues).
    expect(project.commissions).toMatchObject({
      agencyCommission: 50,
      affiliateCommission: 7,
      salesAgencyCommission: 30,
      prodeskCommission: 13,
      productionManagerCommission: 2,
      briefingManagerCommission: 3,
      internalApprovalCommission: 5,
      salesPersonCommission: 0,
    });
    expect((project.amount as { oneOffTotal?: number }).oneOffTotal).toBe(100);

    // The item is back-linked to the project it spawned.
    const item = (
      await db.select().from(purchaseItems).where(eq(purchaseItems.id, id.item))
    )[0];
    expect(item.projectId).toBe(project.id);
  });

  it('generates the five per-role payouts, summing to the gross', async () => {
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, id.purchase));
    expect(rows).toHaveLength(5);

    const total = rows.reduce((s, p) => s + Number(p.amount), 0);
    expect(total).toBe(100);

    // Agency owner cut → the producing AGENCY itself (its own bank account).
    const agencyPayout = rows.find((p) => p.beneficiaryAgencyId === id.agency);
    expect(agencyPayout).toBeDefined();
    expect(agencyPayout!.beneficiaryId).toBeNull();
    expect(agencyPayout!.as).toBe('agency');
    expect(Number(agencyPayout!.amount)).toBe(40);
    expect(agencyPayout!.status).toBe('upcoming');

    // Each designee cut → that staff member's own account, `as: 'staff'`.
    const staffAmount = (userId: string) => {
      const p = rows.find((r) => r.beneficiaryId === userId);
      expect(p, `payout for ${userId}`).toBeDefined();
      expect(p!.as).toBe('staff');
      expect(p!.status).toBe('upcoming');
      return Number(p!.amount);
    };
    expect(staffAmount(id.productionStaff)).toBe(2);
    expect(staffAmount(id.briefingStaff)).toBe(3);
    expect(staffAmount(id.approvalStaff)).toBe(5);

    // Prodesk remainder → the super-admin. Created `upcoming` like every other
    // cut now: no payout (not even the platform's own) is recognised until its
    // work completes — it's then settled internally in dispatchPayout.
    const adminPayout = rows.find((p) => p.beneficiaryId === id.superAdmin);
    expect(adminPayout).toBeDefined();
    expect(adminPayout!.as).toBe('admin');
    expect(Number(adminPayout!.amount)).toBe(50);
    expect(adminPayout!.status).toBe('upcoming');
  });

  it('settles every payout after the 14-day refund window — non-priority NOT sooner', async () => {
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, id.purchase));
    const agencyPayout = rows.find((p) => p.beneficiaryAgencyId === id.agency)!;
    const adminPayout = rows.find((p) => p.beneficiaryId === id.superAdmin)!;

    // Non-priority (prodesk) no longer settles sooner — it shares the priority date
    // so no external payout goes out before the brand could request a full refund.
    expect(adminPayout.toPayAt!.getTime()).toBe(
      agencyPayout.toPayAt!.getTime(),
    );

    // Both land on a Friday 00:00 Brisbane (UTC+10), ~2 weeks out (refund buffer).
    const BNE = 10 * 60 * 60 * 1000;
    for (const p of [agencyPayout, adminPayout]) {
      const wall = new Date(p.toPayAt!.getTime() + BNE);
      expect(wall.getUTCDay()).toBe(5);
      expect(wall.getUTCHours()).toBe(0);
      const out = p.toPayAt!.getTime() - new Date(p.createdAt).getTime();
      expect(out).toBeGreaterThanOrEqual(13 * 86_400_000);
      expect(out).toBeLessThanOrEqual(21 * 86_400_000);
    }
  });

  it('records the agency owner breakdown line', async () => {
    const agencyPayout = (
      await db
        .select()
        .from(payouts)
        .where(
          and(
            eq(payouts.purchaseId, id.purchase),
            eq(payouts.beneficiaryAgencyId, id.agency),
          ),
        )
    )[0];
    const breakdowns = await db
      .select()
      .from(payoutBreakdowns)
      .where(eq(payoutBreakdowns.payoutId, agencyPayout.id));
    expect(breakdowns).toHaveLength(1);
    expect(breakdowns[0].commissionType).toBe('agencyOwnerCommission');
    expect(Number(breakdowns[0].amount)).toBe(40);
  });

  it('generates the brand charge, agency-retained, and per-designee commission invoices', async () => {
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseId, id.purchase));
    // Marketplace buy → Prodesk is the collector. 1 brand charge + 1 agency-retained
    // (prod agency → Prodesk) + 3 designee→agency invoices (no sales/affiliate legs).
    expect(rows).toHaveLength(5);

    // Brand charge: Prodesk (collector) → brand, the full gross, no payout (status
    // derived as 'paid' at read time since payoutId is null).
    const brandInvoice = rows.find((i) => i.toBrandId === id.brand);
    expect(brandInvoice).toBeDefined();
    expect(brandInvoice!.commissionType).toBeNull();
    expect(Number(brandInvoice!.total)).toBe(100);
    expect(brandInvoice!.fromIsProdesk).toBe(true);

    // Agency-retained: producing agency → collector (Prodesk here), owner + staff = 50,
    // linked to the agency-owner payout (so its status derives from that payout).
    const agencyInvoice = rows.find(
      (i) => i.commissionType === 'agencyOwnerCommission',
    );
    expect(agencyInvoice).toBeDefined();
    expect(Number(agencyInvoice!.total)).toBe(50);
    expect(agencyInvoice!.fromAgencyId).toBe(id.agency);
    expect(agencyInvoice!.toIsProdesk).toBe(true);
    expect(agencyInvoice!.payoutId).not.toBeNull();

    // Designee → agency invoices, one per designee.
    const designeeInvoice = (
      commissionType: string,
      userId: string,
      amount: number,
    ) => {
      const inv = rows.find((i) => i.commissionType === commissionType);
      expect(inv, commissionType).toBeDefined();
      expect(Number(inv!.total)).toBe(amount);
      expect(inv!.fromUserId).toBe(userId);
      expect(inv!.toAgencyId).toBe(id.agency);
    };
    designeeInvoice('productionManagerCommission', id.productionStaff, 2);
    designeeInvoice('briefingManagerCommission', id.briefingStaff, 3);
    designeeInvoice('internalApprovalCommission', id.approvalStaff, 5);

    // Every invoice carries exactly one line item with a matching total.
    for (const inv of rows) {
      const items = await db
        .select()
        .from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, inv.id));
      expect(items).toHaveLength(1);
      expect(Number(items[0].totalPrice)).toBe(Number(inv.total));
    }
  });

  it('is idempotent — re-running fulfilment spawns no extra projects or payouts', async () => {
    await fulfillPurchase(id.purchase, db);
    const projectRows = await db
      .select()
      .from(projects)
      .where(eq(projects.purchaseId, id.purchase));
    const payoutRows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, id.purchase));
    expect(projectRows).toHaveLength(1);
    expect(payoutRows).toHaveLength(5);
  });
});

/**
 * Per-project payout model: a purchase spanning TWO projects must split into one
 * payout PER project (not one merged payout), so each project's share dispatches
 * independently on its own completion. See docs/commissions.md §7.
 */
describe('fulfillPurchase — multi-project purchase splits payouts per project', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(),
    agencyOwner: randomUUID(),
    brandOwner: randomUUID(),
    agency: randomUUID(),
    brand: randomUUID(),
    serviceA: randomUUID(),
    serviceB: randomUUID(),
    purchase: randomUUID(),
    itemA: randomUUID(),
    itemB: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'admin@t', isSuperAdmin: true },
      { id: id.agencyOwner, email: 'ao@t' },
      { id: id.brandOwner, email: 'bo@t' },
    ]);
    await db
      .insert(agencies)
      .values({ id: id.agency, ownerId: id.agencyOwner, businessName: 'Acme' });
    await db
      .insert(brands)
      .values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Globex' });
    await db.insert(services).values([
      {
        id: id.serviceA,
        agencyId: id.agency,
        name: 'Service A',
        type: 'oneOffService',
      },
      {
        id: id.serviceB,
        agencyId: id.agency,
        name: 'Service B',
        type: 'oneOffService',
      },
    ]);
    await db
      .insert(globalSettings)
      .values({
        id: 1,
        agencyCommission: '50',
        salesAgencyCommission: '30',
        affiliateCommission: '7',
        prodeskCommission: '13',
      });
    await db.insert(purchases).values({
      id: id.purchase,
      brandId: id.brand,
      userId: id.brandOwner,
      type: 'marketplace',
      status: 'pendingPayment',
      totalAmount: '300.00',
      agencyCommission: '50',
      salesAgencyCommission: '30',
      affiliateCommission: '7',
      prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values([
      {
        id: id.itemA,
        purchaseId: id.purchase,
        serviceId: id.serviceA,
        agencyId: id.agency,
        serviceName: 'Service A',
        serviceType: 'oneOffService',
        lineTotal: '100.00',
        quantity: 1,
        sortOrder: 0,
        amount: {
          oneOff: { upfront: 100, weeklyAfter: 0, numberOfWeeks: 0 },
          recurring: { upfront: 0, weeklyAfter: 0 },
          oneOffTotal: 100,
        },
      },
      {
        id: id.itemB,
        purchaseId: id.purchase,
        serviceId: id.serviceB,
        agencyId: id.agency,
        serviceName: 'Service B',
        serviceType: 'oneOffService',
        lineTotal: '200.00',
        quantity: 1,
        sortOrder: 1,
        amount: {
          oneOff: { upfront: 200, weeklyAfter: 0, numberOfWeeks: 0 },
          recurring: { upfront: 0, weeklyAfter: 0 },
          oneOffTotal: 200,
        },
      },
    ]);
    await fulfillPurchase(id.purchase, db);
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  it('creates ONE agency payout per project (not a merged $150)', async () => {
    const proj = await db
      .select()
      .from(projects)
      .where(eq(projects.purchaseId, id.purchase));
    expect(proj).toHaveLength(2);
    const byName = new Map(proj.map((p) => [p.serviceName, p.id]));

    const agencyPayouts = await db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.purchaseId, id.purchase),
          eq(payouts.beneficiaryAgencyId, id.agency),
        ),
      );
    // Two separate agency payouts — one per project — never a single merged one.
    expect(agencyPayouts).toHaveLength(2);
    expect(
      agencyPayouts.map((p) => Number(p.amount)).sort((a, b) => a - b),
    ).toEqual([50, 100]);

    // Each agency payout's breakdown is tagged to exactly one (distinct) project.
    const projectOf = new Map<number, string | null>();
    for (const p of agencyPayouts) {
      const bds = await db
        .select()
        .from(payoutBreakdowns)
        .where(eq(payoutBreakdowns.payoutId, p.id));
      expect(bds).toHaveLength(1);
      projectOf.set(Number(p.amount), bds[0].projectId);
    }
    expect(projectOf.get(50)).toBe(byName.get('Service A')); // 50% of $100
    expect(projectOf.get(100)).toBe(byName.get('Service B')); // 50% of $200
  });

  it('also splits the prodesk (admin) payout per project', async () => {
    const adminPayouts = await db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.purchaseId, id.purchase),
          eq(payouts.beneficiaryId, id.superAdmin),
        ),
      );
    expect(adminPayouts).toHaveLength(2);
    expect(
      adminPayouts.map((p) => Number(p.amount)).sort((a, b) => a - b),
    ).toEqual([50, 100]);
  });
});

/**
 * Payment-plan deferral applies ONLY to one-off items. A RECURRING item's setup
 * fee is collected in full at checkout and splits in full at fulfilment (Flutter
 * subscription-calculator parity) — its non-priority cut must NOT be deferred (and
 * thereby orphaned, since reimbursement only revisits one-off items). Mirrors the
 * real proposal: $100 one-off on a 12-week plan + $200 recurring setup, sold via a
 * different (sales) agency, buyer referred by an affiliate.
 */
describe('fulfillPurchase — payment plan defers ONLY the one-off; recurring setup splits in full', () => {
  let db: DB;
  let close: () => Promise<void>;
  const id = {
    superAdmin: randomUUID(),
    affiliate: randomUUID(),
    prodOwner: randomUUID(),
    salesOwner: randomUUID(),
    brandOwner: randomUUID(),
    prodAgency: randomUUID(),
    salesAgency: randomUUID(),
    brand: randomUUID(),
    oneOffSvc: randomUUID(),
    recurSvc: randomUUID(),
    purchase: randomUUID(),
    oneOffItem: randomUUID(),
    recurItem: randomUUID(),
  };

  beforeAll(async () => {
    ({ db, close } = await makeTestDb());
    await db.insert(users).values([
      { id: id.superAdmin, email: 'a@t', isSuperAdmin: true },
      { id: id.affiliate, email: 'aff@t' },
      { id: id.prodOwner, email: 'p@t' },
      { id: id.salesOwner, email: 's@t' },
      { id: id.brandOwner, email: 'b@t', referredByUserId: id.affiliate },
    ]);
    await db.insert(agencies).values([
      { id: id.prodAgency, ownerId: id.prodOwner, businessName: 'Producer' },
      { id: id.salesAgency, ownerId: id.salesOwner, businessName: 'Seller' },
    ]);
    await db
      .insert(brands)
      .values({ id: id.brand, ownerId: id.brandOwner, businessName: 'Brand' });
    await db.insert(services).values([
      {
        id: id.oneOffSvc,
        agencyId: id.prodAgency,
        name: 'One-off',
        type: 'oneOffService',
      },
      {
        id: id.recurSvc,
        agencyId: id.prodAgency,
        name: 'Retainer',
        type: 'recurringService',
      },
    ]);
    await db
      .insert(globalSettings)
      .values({
        id: 1,
        agencyCommission: '50',
        salesAgencyCommission: '30',
        affiliateCommission: '7',
        prodeskCommission: '13',
      });
    await db.insert(purchases).values({
      id: id.purchase,
      brandId: id.brand,
      type: 'proposal',
      status: 'pendingPayment',
      proposalSentByAgencyId: id.salesAgency,
      proposalSentById: id.salesOwner,
      selectedPaymentPlan: {
        durationWeeks: 12,
        upfrontPercentage: 25,
        interestRate: 5,
      },
      totalAmount: '226.25',
      agencyCommission: '50',
      salesAgencyCommission: '30',
      affiliateCommission: '7',
      prodeskCommission: '13',
    });
    await db.insert(purchaseItems).values([
      {
        id: id.oneOffItem,
        purchaseId: id.purchase,
        serviceId: id.oneOffSvc,
        agencyId: id.prodAgency,
        serviceName: 'One-off',
        serviceType: 'oneOffService',
        isRecurring: false,
        lineTotal: '100.00',
        sortOrder: 0,
        amount: {
          oneOff: { upfront: 26.25, weeklyAfter: 6.57, numberOfWeeks: 12 },
          recurring: { upfront: 0, weeklyAfter: 0 },
          oneOffTotal: 100,
        },
      },
      {
        id: id.recurItem,
        purchaseId: id.purchase,
        serviceId: id.recurSvc,
        agencyId: id.prodAgency,
        serviceName: 'Retainer',
        serviceType: 'recurringService',
        isRecurring: true,
        lineTotal: '200.00',
        sortOrder: 1,
        startDelayDays: 14,
        amount: {
          oneOff: { upfront: 0, weeklyAfter: 0, numberOfWeeks: 0 },
          recurring: { upfront: 200, weeklyAfter: 33 },
          oneOffTotal: 0,
        },
      },
    ]);
    await fulfillPurchase(id.purchase, db);
  }, 30_000);

  afterAll(async () => {
    await close?.();
  });

  // Map each payout to its project via the first breakdown's projectId.
  async function payoutsByProject() {
    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, id.purchase));
    const proj = await db
      .select()
      .from(projects)
      .where(eq(projects.purchaseId, id.purchase));
    const projType = new Map(proj.map((p) => [p.id, p.serviceType]));
    const out: Record<
      string,
      { as: string; commissionType: string | null; amount: number }[]
    > = { oneOffService: [], recurringService: [] };
    for (const p of rows) {
      const bd = (
        await db
          .select()
          .from(payoutBreakdowns)
          .where(eq(payoutBreakdowns.payoutId, p.id))
      )[0];
      const t = bd?.projectId ? projType.get(bd.projectId) : undefined;
      if (t)
        out[t].push({
          as: p.as!,
          commissionType: bd.commissionType,
          amount: Number(p.amount),
        });
    }
    return out;
  }

  it('splits the $200 recurring setup IN FULL at fulfilment (priority + non-priority), no orphan', async () => {
    const { recurringService } = await payoutsByProject();
    const total = recurringService.reduce((s, r) => s + r.amount, 0);
    expect(total).toBe(200); // owner 100 + sales 60 + affiliate 14 + prodesk 26

    const byType = Object.fromEntries(
      recurringService.map((r) => [r.commissionType, r.amount]),
    );
    expect(byType.agencyOwnerCommission).toBe(100);
    expect(byType.agencySalesCommission).toBe(60);
    expect(byType.affiliateCommission).toBe(14);
    expect(byType.prodeskCommission).toBe(26);
  });

  it('defers the one-off non-priority — only the agency owner priority cut pays at fulfilment', async () => {
    const { oneOffService } = await payoutsByProject();
    // Just the $50 owner cut now; sales/affiliate/prodesk wait for the reimbursement cycle.
    expect(oneOffService).toHaveLength(1);
    expect(oneOffService[0].commissionType).toBe('agencyOwnerCommission');
    expect(oneOffService[0].amount).toBe(50);
  });

  it('dates the delayed phase-2 payouts from the phase start (+14d) — phase 1 settles ~14d earlier', async () => {
    const proj = await db
      .select()
      .from(projects)
      .where(eq(projects.purchaseId, id.purchase));
    const recurProjId = proj.find(
      (p) => p.serviceType === 'recurringService',
    )!.id;
    const oneOffProjId = proj.find(
      (p) => p.serviceType === 'oneOffService',
    )!.id;

    const rows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.purchaseId, id.purchase));
    const dateFor = async (projectId: string) => {
      for (const p of rows) {
        const bd = (
          await db
            .select()
            .from(payoutBreakdowns)
            .where(eq(payoutBreakdowns.payoutId, p.id))
        )[0];
        if (bd?.projectId === projectId) return p.toPayAt!.getTime();
      }
      throw new Error('no payout for project');
    };
    const recurDate = await dateFor(recurProjId);
    const oneOffDate = await dateFor(oneOffProjId);

    // Phase 2 (delayed 14d) settles ~2 weeks after phase 1 (no delay): both carry
    // the same 14-day refund buffer, but phase 2's clock starts at its phase start.
    const gapDays = (recurDate - oneOffDate) / 86_400_000;
    expect(gapDays).toBeGreaterThanOrEqual(7);
    expect(gapDays).toBeLessThanOrEqual(21);
  });

  // ── Invoice gating (docs/commissions.md §2c) ──────────────────────────────
  // Each commission document must be written EXACTLY ONCE over the lifecycle.
  // The one-off is on a payment plan, so its non-priority (sales/affiliate) legs
  // are DEFERRED to the reimbursement cycle and must NOT appear at fulfilment;
  // the recurring setup is paid in full, so its legs DO appear at fulfilment.
  it('defers the one-off non-priority invoices at fulfilment (recurring setup invoices in full)', async () => {
    const rows = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseId, id.purchase));
    const at = (ct: string | null, cycle: number) =>
      rows.filter((i) => i.commissionType === ct && i.cycle === cycle);

    // Sold via a different sales agency → the SALES AGENCY is the collector.
    // Brand charge (sales agency → brand) at fulfilment (cycle 1): one per project.
    expect(at(null, 1)).toHaveLength(2);
    // Agency-retained (prod agency → sales agency) priority invoices: one per project.
    expect(at('agencyOwnerCommission', 1)).toHaveLength(2);
    // Non-priority legs at fulfilment: ONLY the recurring setup's (the one-off's are deferred).
    // The 30% sales cut is NOT invoiced — the sales agency keeps it by being the collector.
    expect(at('agencySalesCommission', 1)).toHaveLength(0);
    // Instead Prodesk invoices the collector for its own cut + the affiliate's (the
    // Prodesk↔collector reconciliation): 13% + 7% = $40 of the $200 recurring setup.
    expect(at('prodeskCommission', 1)).toHaveLength(1);
    expect(at('affiliateCommission', 1)).toHaveLength(1);
    expect(Number(at('prodeskCommission', 1)[0].total)).toBe(40); // (13% + 7%) of $200
    expect(Number(at('affiliateCommission', 1)[0].total)).toBe(14); // 7% of $200 recurring setup
  });

  it('reimbursement cycle emits ONLY the deferred one-off sales/affiliate legs — never re-invoices brand or priority', async () => {
    const before = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseId, id.purchase));
    await generateReimbursementPayouts(id.purchase, 5, db);
    const after = await db
      .select()
      .from(invoices)
      .where(eq(invoices.purchaseId, id.purchase));

    const cycle5 = after.filter(
      (i) => i.cycle === 5 && !before.some((b) => b.id === i.id),
    );
    // The reimbursement cycle releases the one-off's deferred non-priority legs:
    // the Prodesk↔collector reconciliation and the affiliate leg (NOT a sales-cut
    // invoice — the sales agency keeps its cut as the collector).
    const byType = (ct: string | null) =>
      cycle5.filter((i) => i.commissionType === ct);
    expect(byType('agencySalesCommission')).toHaveLength(0);
    expect(byType('prodeskCommission')).toHaveLength(1);
    expect(byType('affiliateCommission')).toHaveLength(1);
    // …and emits NOTHING priority-side or brand-side (those were invoiced at fulfilment).
    expect(byType(null)).toHaveLength(0); // no duplicate brand charge invoice
    expect(byType('agencyOwnerCommission')).toHaveLength(0); // no duplicate agency-retained invoice
    expect(byType('briefingManagerCommission')).toHaveLength(0);
    expect(byType('productionManagerCommission')).toHaveLength(0);
    expect(byType('internalApprovalCommission')).toHaveLength(0);
  });
});
