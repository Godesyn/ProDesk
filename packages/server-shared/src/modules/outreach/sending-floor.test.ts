/**
 * Reading Smartlead's numbers.
 *
 * `warmup_reputation` arrives as a percentage STRING — `"0%"` in the live
 * capture recorded in outreach-api-findings.md. A plain `Number()` on that is
 * NaN, which the floor maps to null, which the health strip renders as "No
 * warmup data yet" — so every warming mailbox reported as having never warmed.
 *
 * The bug hid behind a true statement: while nothing was warming, "no warmup
 * data yet" was correct, and it stayed correct-looking for exactly as long as it
 * took warmup to produce its first number. That is the kind of parse worth
 * pinning down in a test rather than trusting to a second reading of the docs.
 */
import { describe, it, expect } from 'vitest';
import { toNumber } from './sending-floor.js';

describe('toNumber', () => {
  it('reads the percentage strings Smartlead actually sends', () => {
    // The exact shape from the live account capture.
    expect(toNumber('0%')).toBe(0);
    expect(toNumber('98%')).toBe(98);
    expect(toNumber('87.5%')).toBe(87.5);
  });

  it('keeps Smartlead 0–100 scale rather than converting to a fraction', () => {
    // REPUTATION_OK and the domain average both compare against 0–100. Dividing
    // by 100 here would silently push every mailbox under every threshold.
    expect(toNumber('98%')).toBeGreaterThan(1);
  });

  it('still reads plain numbers and numeric strings', () => {
    expect(toNumber(98)).toBe(98);
    expect(toNumber('98')).toBe(98);
    expect(toNumber(' 98 ')).toBe(98);
  });

  it('returns null for genuinely absent data', () => {
    // The other half of the contract: eight of nine mailboxes had
    // `warmup_details: null` before warmup was configured, and "unknown" has to
    // stay distinguishable from zero — a reputation of 0 is a crisis, and no
    // reading at all is not.
    expect(toNumber(null)).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber('')).toBeNull();
    expect(toNumber('n/a')).toBeNull();
    expect(toNumber({})).toBeNull();
  });
});
