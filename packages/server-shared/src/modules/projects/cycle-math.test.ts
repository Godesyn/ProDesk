import { describe, it, expect } from 'vitest';
import {
  cycleStart,
  weeklyPaymentsBefore,
  cycleOfPayment,
  refundableCyclePoolCount,
  cancellationCycleIndex,
  scheduledCancellationDate,
  isDeliverableCycleComplete,
  type CycleSpec,
} from './cycle-math.js';

const DAY = 86_400_000;
const ANCHOR = new Date('2026-01-05T00:00:00.000Z'); // a Monday
const dayOffset = (d: Date) => Math.round((d.getTime() - ANCHOR.getTime()) / DAY);

/** 4-week deliverable cycle, weekly billing. */
const weekly4 = (over: Partial<CycleSpec> = {}): CycleSpec => ({
  type: 'recurringService',
  deliverableFrequency: 'weekly',
  repeatsEvery: 4,
  anchor: ANCHOR,
  ...over,
});

describe('cycleStart', () => {
  it('cycle 1 is the anchor; later cycles advance repeatsEvery weeks', () => {
    expect(dayOffset(cycleStart(1, weekly4()))).toBe(0);
    expect(dayOffset(cycleStart(2, weekly4()))).toBe(28);
    expect(dayOffset(cycleStart(3, weekly4()))).toBe(56);
  });
});

describe('weeklyPaymentsBefore', () => {
  it('counts weekly payments strictly before a date (boundary payment excluded)', () => {
    expect(weeklyPaymentsBefore(ANCHOR, ANCHOR)).toBe(0);
    expect(weeklyPaymentsBefore(ANCHOR, new Date(ANCHOR.getTime() + 7 * DAY))).toBe(1);
    expect(weeklyPaymentsBefore(ANCHOR, new Date(ANCHOR.getTime() + 28 * DAY))).toBe(4);
    expect(weeklyPaymentsBefore(ANCHOR, new Date(ANCHOR.getTime() + 56 * DAY))).toBe(8);
  });
});

describe('cycleOfPayment (4-week cycle)', () => {
  it('maps payment number → cycle, boundary payment opens the new cycle', () => {
    expect(cycleOfPayment(4, weekly4())).toBe(1); // day 21, still cycle 1
    expect(cycleOfPayment(5, weekly4())).toBe(2); // day 28 = boundary → cycle 2
    expect(cycleOfPayment(8, weekly4())).toBe(2);
    expect(cycleOfPayment(9, weekly4())).toBe(3); // day 56 = boundary → cycle 3
  });
});

describe('refundableCyclePoolCount (§5)', () => {
  it('counts only payments within the current cycle ($20/wk examples)', () => {
    // delete on the 6th payment, in cycle 2 → payments 5 & 6 unearned
    expect(refundableCyclePoolCount({ ...weekly4(), cycleCount: 2, paymentCount: 6 })).toBe(2);
    // delete on the 8th payment, still cycle 2 → 5,6,7,8
    expect(refundableCyclePoolCount({ ...weekly4(), cycleCount: 2, paymentCount: 8 })).toBe(4);
    // delete on the 10th payment, cycle 3 → 9,10 (cycles 1 & 2 locked)
    expect(refundableCyclePoolCount({ ...weekly4(), cycleCount: 3, paymentCount: 10 })).toBe(2);
  });

  it('includes the upfront in cycle 1', () => {
    expect(refundableCyclePoolCount({ ...weekly4(), cycleCount: 1, paymentCount: 3 })).toBe(3);
  });
});

describe('scheduledCancellationDate / cancellationCycleIndex (§3)', () => {
  it('minimum term governs: repeatsEvery 4, minTerm 2 → stop after the 8th payment (9th not charged)', () => {
    const spec = { ...weekly4(), minTerm: 2, paymentCount: 1 };
    expect(cancellationCycleIndex(spec)).toBe(3);
    expect(dayOffset(scheduledCancellationDate(spec))).toBe(56); // payment 9 date — suppressed
  });

  it('weekly cycle, minTerm 3 → 3 charged, 4th not (minTerm × repeatsEvery = 3 payments)', () => {
    const spec = { ...weekly4({ repeatsEvery: 1 }), minTerm: 3, paymentCount: 1 };
    expect(dayOffset(scheduledCancellationDate(spec))).toBe(21); // payment 4 date — suppressed
  });

  it('tie-break: cancel after the 3rd payment (mid cycle 1) → complete cycle 1, 5th not charged', () => {
    const spec = { ...weekly4(), minTerm: 0, paymentCount: 3 };
    expect(dayOffset(scheduledCancellationDate(spec))).toBe(28); // payment 5 date
  });

  it('tie-break: cancel once the 4th (last of cycle 1) landed → cycle 2 locked, 9th not charged', () => {
    const spec = { ...weekly4(), minTerm: 0, paymentCount: 4 };
    expect(dayOffset(scheduledCancellationDate(spec))).toBe(56); // payment 9 date
  });
});

describe('isDeliverableCycleComplete (§6 completion gate)', () => {
  it('holds a cycle until the project advances past it, or it completes as the terminal cycle', () => {
    // breakdown for cycle 2:
    expect(isDeliverableCycleComplete(2, { cycleCount: 3, status: 'brief' })).toBe(true); // moved on
    expect(isDeliverableCycleComplete(2, { cycleCount: 2, status: 'completed' })).toBe(true); // terminal, done
    expect(isDeliverableCycleComplete(2, { cycleCount: 2, status: 'production' })).toBe(false); // in flight
    expect(isDeliverableCycleComplete(2, { cycleCount: 1, status: 'completed' })).toBe(false); // not reached
  });
});

describe('calendar-month cycle (payments counted by calendar period)', () => {
  it('a January cycle holds the ~5 weekly payments before the Feb boundary', () => {
    const monthly: CycleSpec = {
      type: 'recurringService',
      deliverableFrequency: 'monthly',
      repeatsEvery: 1,
      anchor: ANCHOR,
    };
    // cycle 2 starts ~1 calendar month out; Jan has 5 Mondays from the 5th
    expect(weeklyPaymentsBefore(ANCHOR, cycleStart(2, monthly))).toBe(5);
  });
});
