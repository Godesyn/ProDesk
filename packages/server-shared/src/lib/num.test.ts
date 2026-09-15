import { describe, it, expect } from 'vitest';
import {
  toMoney,
  toPct,
  roundChargeUp,
  roundPayoutDown,
  chargeCents,
  payoutCents,
} from './num.js';

describe('toMoney', () => {
  it('formats numbers to 2dp strings and passes through null/undefined', () => {
    expect(toMoney(10)).toBe('10.00');
    expect(toMoney(10.005)).toBe('10.01');
    expect(toMoney(null)).toBeUndefined();
    expect(toMoney(undefined)).toBeUndefined();
  });
});

describe('toPct', () => {
  it('stringifies numbers', () => {
    expect(toPct(7.5)).toBe('7.5');
    expect(toPct(null)).toBeUndefined();
  });
});

describe('directional money rounding', () => {
  it('roundChargeUp rounds a fractional cent UP, leaves whole cents alone', () => {
    expect(roundChargeUp(10.001)).toBe(10.01);
    expect(roundChargeUp(10.0049)).toBe(10.01);
    expect(roundChargeUp(10.01)).toBe(10.01);
    expect(roundChargeUp(10)).toBe(10);
    expect(roundChargeUp(0)).toBe(0);
  });

  it('roundPayoutDown rounds a fractional cent DOWN, leaves whole cents alone', () => {
    expect(roundPayoutDown(10.009)).toBe(10);
    expect(roundPayoutDown(10.019)).toBe(10.01);
    expect(roundPayoutDown(10.01)).toBe(10.01);
    expect(roundPayoutDown(10)).toBe(10);
  });

  it('chargeCents / payoutCents return whole-cent integers in the right direction', () => {
    expect(chargeCents(10.001)).toBe(1001);
    expect(payoutCents(10.009)).toBe(1000);
    expect(chargeCents(10)).toBe(1000);
    expect(payoutCents(10)).toBe(1000);
  });

  it('is float-artifact safe (105.07 * 100 = 10506.999999…)', () => {
    // Without the toFixed(6) normalisation, ceil(105.07*100) would wrongly give
    // 10507 cents flagged as a fractional cent. It must stay an exact $105.07.
    expect(roundChargeUp(105.07)).toBe(105.07);
    expect(roundPayoutDown(105.07)).toBe(105.07);
    expect(chargeCents(105.07)).toBe(10507);
    expect(payoutCents(105.07)).toBe(10507);
  });

  it('charge-up ≥ payout-down for any value (the never-overspend invariant)', () => {
    for (const v of [0, 1, 9.999, 33.337, 7.715, 14.323, 100 / 3]) {
      expect(roundChargeUp(v)).toBeGreaterThanOrEqual(roundPayoutDown(v));
    }
  });
});
