import { describe, it, expect } from 'vitest';
import { nextFriday, payoutFriday } from './fulfillment.js';

describe('nextFriday (payout window)', () => {
  it('always returns a future Friday at 23:59', () => {
    const f = nextFriday(new Date('2026-06-08T10:00:00Z')); // a Monday
    expect(f.getDay()).toBe(5); // Friday
    expect(f.getHours()).toBe(23);
    expect(f.getMinutes()).toBe(59);
    expect(f.getTime()).toBeGreaterThan(new Date('2026-06-08T10:00:00Z').getTime());
  });

  it('rolls to the following Friday when called on a Friday', () => {
    const friday = new Date('2026-06-12T10:00:00Z');
    const next = nextFriday(friday);
    expect(next.getDay()).toBe(5);
    expect(next.getTime()).toBeGreaterThan(friday.getTime());
  });
});

describe('payoutFriday (14-day refund-buffer for every tier)', () => {
  const DAY = 86_400_000;
  const BNE = 10 * 60 * 60 * 1000; // UTC+10
  // Returns the Brisbane wall-clock view of a UTC instant.
  const bne = (d: Date) => new Date(d.getTime() + BNE);
  const from = new Date('2026-06-08T10:00:00Z'); // a Monday

  it('lands every tier on 00:00 Brisbane on a Friday', () => {
    for (const tier of ['priority', 'nonPriority', 'subscription'] as const) {
      const w = bne(payoutFriday(tier, from));
      expect(w.getUTCDay()).toBe(5); // Friday in Brisbane
      expect(w.getUTCHours()).toBe(0);
      expect(w.getUTCMinutes()).toBe(0);
    }
  });

  it('EVERY tier waits the 14-day refund window — non-priority is NOT paid sooner', () => {
    const priority = payoutFriday('priority', from);
    const nonPriority = payoutFriday('nonPriority', from);
    const subscription = payoutFriday('subscription', from);
    // All identical now: no external payout (incl. affiliate / sales agency) settles
    // before the brand's refund window closes.
    expect(nonPriority.getTime()).toBe(priority.getTime());
    expect(subscription.getTime()).toBe(priority.getTime());
    // +14d (Mon 22nd) then to the next Friday (26th): 13–21 days out.
    expect(priority.getTime()).toBeGreaterThanOrEqual(from.getTime() + 13 * DAY);
    expect(priority.getTime()).toBeLessThanOrEqual(from.getTime() + 21 * DAY);
  });
});
