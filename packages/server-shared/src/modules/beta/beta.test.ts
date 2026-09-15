/**
 * Pure-logic tests for the beta programme.
 *
 * These cover the arithmetic the whole feature hangs on — deadline computation,
 * the countdown a member is shown, and the reminder windows — because a
 * fencepost error here either charges someone early or never warns them at all.
 * The DB-touching paths (usage probes, report, activation) are exercised by the
 * integration suite against a real schema.
 */
import { describe, it, expect } from 'vitest';
import {
  addDays,
  BETA_MILESTONES,
  betaDeadline,
  daysUntil,
  milestoneWindow,
  normalizeBetaCode,
} from './dates.js';

const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso);

describe('normalizeBetaCode', () => {
  it('lowercases and trims so URL casing never splits a cohort', () => {
    expect(normalizeBetaCode('  V1 ')).toBe('v1');
    expect(normalizeBetaCode('Launch-2026')).toBe('launch-2026');
  });
});

describe('betaDeadline', () => {
  it('counts the duration from the member’s own signup, not a fixed date', () => {
    const early = betaDeadline(90, at('2026-08-01T00:00:00Z'));
    const late = betaDeadline(90, at('2026-09-01T00:00:00Z'));
    expect(early.toISOString()).toBe('2026-10-30T00:00:00.000Z');
    expect(late.toISOString()).toBe('2026-11-30T00:00:00.000Z');
    // Joining a month later ends a month later — the point of per-signup durations.
    expect(late.getTime() - early.getTime()).toBe(31 * DAY);
  });

  it('keeps the time of day, so a deadline is exactly N×24h after signup', () => {
    const d = betaDeadline(7, at('2026-08-01T13:45:00Z'));
    expect(d.toISOString()).toBe('2026-08-08T13:45:00.000Z');
  });
});

describe('daysUntil (the number shown to the member)', () => {
  const now = at('2026-08-01T12:00:00Z');

  it('rounds UP, so a partial final day still reads as a day left', () => {
    // 6 hours to go must not be shown as "0 days left" — the member still has
    // access, and telling them otherwise reads as already cut off.
    expect(daysUntil(at('2026-08-01T18:00:00Z'), now)).toBe(1);
  });

  it('counts whole days for a future deadline', () => {
    expect(daysUntil(at('2026-08-08T12:00:00Z'), now)).toBe(7);
    expect(daysUntil(at('2026-08-04T12:00:00Z'), now)).toBe(3);
  });

  it('never goes negative once the deadline has passed', () => {
    expect(daysUntil(at('2026-07-25T12:00:00Z'), now)).toBe(0);
  });
});

describe('extension base date (the later of now / current deadline)', () => {
  // This mirrors the rule in extensions.ts: counting from a stale deadline would
  // hand a lapsed member an extension that is itself already expired.
  const extendFrom = (previousEndsAt: Date | null, now: Date, days: number) => {
    const lapsed = previousEndsAt == null || previousEndsAt.getTime() <= now.getTime();
    return addDays(lapsed ? now : previousEndsAt, days);
  };

  it('adds to a live deadline, so no free days are lost', () => {
    const now = at('2026-08-01T00:00:00Z');
    const result = extendFrom(at('2026-08-20T00:00:00Z'), now, 30);
    expect(result.toISOString()).toBe('2026-09-19T00:00:00.000Z');
  });

  it('counts from NOW for a member who already lapsed', () => {
    const now = at('2026-08-01T00:00:00Z');
    // Their beta ended a month ago; +7 days must mean 7 usable days from today,
    // not 7 days from a date already in the past.
    const result = extendFrom(at('2026-07-01T00:00:00Z'), now, 7);
    expect(result.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it('always yields a future deadline whatever the input', () => {
    const now = at('2026-08-01T00:00:00Z');
    for (const previous of [
      null,
      at('2020-01-01T00:00:00Z'),
      at('2026-08-01T00:00:00Z'),
      at('2027-01-01T00:00:00Z'),
    ]) {
      expect(extendFrom(previous, now, 1).getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('reminder windows', () => {
  const now = at('2026-08-01T08:00:00Z');

  it('are half-open day buckets ending on the milestone', () => {
    const w = milestoneWindow(7, now);
    expect(w.after.toISOString()).toBe('2026-08-07T08:00:00.000Z');
    expect(w.atOrBefore.toISOString()).toBe('2026-08-08T08:00:00.000Z');
  });

  it('agree with the countdown the member sees', () => {
    // Anything inside the day_7 bucket must read "7 days left" in-app, or the
    // email and the UI would contradict each other.
    const w = milestoneWindow(7, now);
    const justInside = new Date(w.after.getTime() + 60_000);
    expect(daysUntil(justInside, now)).toBe(7);
    expect(daysUntil(w.atOrBefore, now)).toBe(7);
  });

  it('treats day_0 as the next 24 hours, never a window in the past', () => {
    const w = milestoneWindow(0, now);
    // The naive formula would give (now-1d, now], so nobody still inside their
    // beta would ever be caught by the day-of sweep.
    expect(w.after.getTime()).toBe(now.getTime());
    expect(w.atOrBefore.toISOString()).toBe('2026-08-02T08:00:00.000Z');
  });

  it('do not overlap, so one daily run sends at most one notice per member', () => {
    const windows = BETA_MILESTONES.map((m) => milestoneWindow(m.leadDays, now));
    for (let i = 0; i < windows.length; i += 1) {
      for (let j = i + 1; j < windows.length; j += 1) {
        const a = windows[i];
        const b = windows[j];
        const overlaps =
          a.after.getTime() < b.atOrBefore.getTime() &&
          b.after.getTime() < a.atOrBefore.getTime();
        expect(overlaps).toBe(false);
      }
    }
  });

  it('assign a deadline to exactly one milestone', () => {
    // A deadline 7 days out belongs to day_7 and nothing else.
    const deadline = at('2026-08-08T08:00:00Z');
    const matching = BETA_MILESTONES.filter((m) => {
      const w = milestoneWindow(m.leadDays, now);
      return (
        deadline.getTime() > w.after.getTime() &&
        deadline.getTime() <= w.atOrBefore.getTime()
      );
    });
    expect(matching.map((m) => m.kind)).toEqual(['day_7']);
  });

  it('catches a beta ending later today as day_0, and only day_0', () => {
    const endsTonight = at('2026-08-01T23:00:00Z');
    const matching = BETA_MILESTONES.filter((m) => {
      const w = milestoneWindow(m.leadDays, now);
      return (
        endsTonight.getTime() > w.after.getTime() &&
        endsTonight.getTime() <= w.atOrBefore.getTime()
      );
    });
    expect(matching.map((m) => m.kind)).toEqual(['day_0']);
  });
});
