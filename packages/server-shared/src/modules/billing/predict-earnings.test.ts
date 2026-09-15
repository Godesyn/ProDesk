import { describe, it, expect } from 'vitest';
import { reimbursementGrossForItem, REIMBURSEMENT_CYCLE, type PurchaseItemRow } from './fulfillment.js';
import { recurringContractorBudget } from '../projects/recurring-schedule.js';
import { predictContractorCycles } from './predict-earnings.js';

const planItem = (upfront: number, weeklyAfter: number, numberOfWeeks: number) =>
  ({ amount: { oneOff: { upfront, weeklyAfter, numberOfWeeks } } } as unknown as PurchaseItemRow);

describe('reimbursementGrossForItem (payment-plan non-priority spread)', () => {
  const upfront = 100;
  const weekly = 10;
  const n = 14;
  const item = planItem(upfront, weekly, n);

  it('pays nothing before the reimbursement cycle', () => {
    for (let c = 1; c < REIMBURSEMENT_CYCLE; c++) expect(reimbursementGrossForItem(item, c)).toBe(0);
  });

  it('clears the backlog (upfront + installments so far) on the reimbursement cycle', () => {
    expect(reimbursementGrossForItem(item, REIMBURSEMENT_CYCLE)).toBe(upfront + (REIMBURSEMENT_CYCLE - 1) * weekly);
  });

  it('pays one installment per later cycle, through plan end (n+1), then nothing', () => {
    expect(reimbursementGrossForItem(item, 6)).toBe(weekly);
    expect(reimbursementGrossForItem(item, n + 1)).toBe(weekly);
    expect(reimbursementGrossForItem(item, n + 2)).toBe(0);
  });

  it('is TOTAL-PRESERVING: the spread sums to the full one-off total (upfront + n*weekly)', () => {
    let sum = 0;
    for (let c = REIMBURSEMENT_CYCLE; c <= n + 1; c++) sum += reimbursementGrossForItem(item, c);
    expect(sum).toBe(upfront + n * weekly);
  });

  it('is inert when there are no installments', () => {
    expect(reimbursementGrossForItem(planItem(100, 0, 0), 5)).toBe(0);
  });
});

describe('recurringContractorBudget', () => {
  it('takes a percentage of the weekly recurring fee when configured', () => {
    expect(recurringContractorBudget({ contractorDefaultBudgetInPercentage: 10 }, { recurring: { weeklyAfter: 200 } })).toBe(20);
  });
  it('falls back to the flat amount', () => {
    expect(recurringContractorBudget({ contractorDefaultBudget: 20 }, {})).toBe(20);
  });
  it('is null when neither is set', () => {
    expect(recurringContractorBudget({}, {})).toBeNull();
  });
});

describe('predictContractorCycles (Track A — deliverable cycle)', () => {
  const baseProject = {
    id: 'p1',
    serviceType: 'recurringService',
    productionAssigneeId: 'contractor-1',
    recurringProjectConfig: { contractorDefaultBudget: 20 },
    amount: { recurring: { weeklyAfter: 100 } },
    deliverableFrequency: 'monthly',
    repeatsEvery: 1,
    nextCycleAt: new Date('2026-07-01T00:00:00Z'),
    cycleCount: 1,
    agencyId: 'a1',
    purchaseId: 'pur1',
    brandId: 'b1',
    serviceName: 'Monthly SEO',
    title: null,
    packageName: null,
  };
  const now = new Date('2026-06-19T00:00:00Z');

  it('forecasts 6 monthly cycles of the recurring budget for the current assignee', () => {
    const rows = predictContractorCycles(baseProject as never, now);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.as === 'contractor')).toBe(true);
    expect(rows.every((r) => r.beneficiaryId === 'contractor-1')).toBe(true);
    expect(rows.every((r) => r.amount === '20.00')).toBe(true);
    // Monthly cadence starting at nextCycleAt.
    expect(rows[0].toPayAt?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(rows[1].toPayAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(rows[5].toPayAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    // Cycle/week numbering continues from the project's current cycle.
    expect(rows[0].breakdown[0].week).toBe(2);
  });

  it('predicts nothing when the project has no current assignee (reset on completion)', () => {
    expect(predictContractorCycles({ ...baseProject, productionAssigneeId: null } as never, now)).toEqual([]);
  });

  it('predicts nothing for a non-recurring (no deliverable cycle) project', () => {
    expect(predictContractorCycles({ ...baseProject, serviceType: 'oneOffService' } as never, now)).toEqual([]);
  });

  it('predicts nothing for a frozen project — completed with no armed boundary', () => {
    const frozen = { ...baseProject, status: 'completed', nextCycleAt: null };
    expect(predictContractorCycles(frozen as never, now)).toEqual([]);
  });

  it('still forecasts a mid-flight project that has no boundary yet', () => {
    const unscheduled = { ...baseProject, status: 'production', nextCycleAt: null };
    expect(predictContractorCycles(unscheduled as never, now).length).toBeGreaterThan(0);
  });
});
