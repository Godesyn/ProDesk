import { describe, it, expect } from 'vitest';
import {
  resolveInitialStatus,
  projectNextCycleAt,
  isPaymentMadeOnTimeForCycle,
  projectsPerItem,
} from './fulfillment-core.js';

describe('resolveInitialStatus', () => {
  it('digital products are born completed (delivered by email)', () => {
    expect(resolveInitialStatus({ serviceType: 'digitalProduct', hasCustomFields: true })).toBe('completed');
  });
  it('custom-field services go to clientBrief (buyer answers first)', () => {
    expect(resolveInitialStatus({ serviceType: 'oneOffService', hasCustomFields: true })).toBe('clientBrief');
  });
  it('a delayed phase starts upcoming', () => {
    expect(resolveInitialStatus({ serviceType: 'recurringService', hasCustomFields: false, isDelayedPhase: true })).toBe('upcoming');
  });
  it('otherwise it starts in brief (NOT upcoming — the bug we fixed)', () => {
    expect(resolveInitialStatus({ serviceType: 'oneOffService', hasCustomFields: false })).toBe('brief');
  });
  it('custom fields win over a delayed phase', () => {
    expect(resolveInitialStatus({ serviceType: 'recurringService', hasCustomFields: true, isDelayedPhase: true })).toBe('clientBrief');
  });
});

describe('projectNextCycleAt', () => {
  const from = new Date('2026-01-01T00:00:00.000Z');
  it('returns null for non-deliverable-cycling types', () => {
    expect(projectNextCycleAt({ type: 'subscription', deliverableFrequency: 'weekly', from })).toBeNull();
    expect(projectNextCycleAt({ type: 'oneOffService', deliverableFrequency: 'weekly', from })).toBeNull();
  });
  it('weekly advances 7 days × repeatsEvery, anchored to `from` (no drift)', () => {
    const r = projectNextCycleAt({ type: 'recurringService', deliverableFrequency: 'weekly', repeatsEvery: 5, from })!;
    expect(r.getTime() - from.getTime()).toBe(35 * 24 * 60 * 60 * 1000);
  });
  it('monthly advances calendar months', () => {
    const r = projectNextCycleAt({ type: 'recurringProductShips', deliverableFrequency: 'monthly', repeatsEvery: 2, from })!;
    expect(r.getUTCMonth()).toBe(2); // Jan(0) + 2 = Mar(2)
  });
  it('defaults missing repeatsEvery to 1', () => {
    const r = projectNextCycleAt({ type: 'recurringService', deliverableFrequency: 'weekly', from })!;
    expect(r.getTime() - from.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('isPaymentMadeOnTimeForCycle', () => {
  const createdAt = new Date('2026-01-01T00:00:00.000Z');
  const opts = { type: 'recurringService' as const, createdAt, deliverableFrequency: 'weekly' as const, repeatsEvery: 1 };
  it('cycle 2 is covered once 1 weekly payment has landed', () => {
    // cycle 2 target date = createdAt + 1 week; paidTill = createdAt + paymentCount*7d.
    expect(isPaymentMadeOnTimeForCycle(2, 2, opts)).toBe(true); // paidTill = +14d > +7d
    expect(isPaymentMadeOnTimeForCycle(1, 2, opts)).toBe(false); // paidTill = +7d, not < +7d
  });
  it('a multi-week deliverable cycle needs more weekly payments before it re-opens', () => {
    const fiveWeekly = { ...opts, repeatsEvery: 5 };
    // cycle 2 target = +5 weeks (35d). Needs paymentCount*7 > 35 → >=6 payments.
    expect(isPaymentMadeOnTimeForCycle(5, 2, fiveWeekly)).toBe(false); // paidTill=35d, not <35d
    expect(isPaymentMadeOnTimeForCycle(6, 2, fiveWeekly)).toBe(true); // paidTill=42d > 35d
  });
});

describe('projectsPerItem', () => {
  it('proposals always spawn exactly one project per item', () => {
    expect(projectsPerItem('proposal', 5)).toBe(1);
  });
  it('marketplace + internal spawn one project per unit of quantity', () => {
    expect(projectsPerItem('marketplace', 3)).toBe(3);
    expect(projectsPerItem('internal', 2)).toBe(2);
    expect(projectsPerItem('marketplace', null)).toBe(1);
  });
});
