import { describe, expect, it } from 'vitest';
import {
  PARKING_DURATION_DAYS,
  PARKING_DURATION_MS,
  getLinkDeletionDate,
  getLinkDaysRemaining,
} from './cleanup.js';

describe('shortLinks parking & cleanup calculations', () => {
  it('calculates parking duration constants accurately', () => {
    expect(PARKING_DURATION_DAYS).toBe(30);
    expect(PARKING_DURATION_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('computes correct deletion date 30 days after disabledAt', () => {
    const disabledAt = new Date('2026-07-01T12:00:00Z');
    const deleteDate = getLinkDeletionDate(disabledAt);
    expect(deleteDate.toISOString()).toBe('2026-07-31T12:00:00.000Z');
  });

  it('falls back to createdAt when disabledAt is null', () => {
    const createdAt = new Date('2026-06-01T00:00:00Z');
    const deleteDate = getLinkDeletionDate(null, createdAt);
    expect(deleteDate.toISOString()).toBe('2026-07-01T00:00:00.000Z');
  });

  it('calculates remaining days accurately', () => {
    const now = Date.now();
    // Disabled 10 days ago -> 20 days remaining
    const disabledAt = new Date(now - 10 * 24 * 60 * 60 * 1000);
    const daysRemaining = getLinkDaysRemaining(disabledAt);
    expect(daysRemaining).toBe(20);
  });

  it('returns 0 remaining days when link parking duration has expired', () => {
    const now = Date.now();
    // Disabled 35 days ago -> expired (0 days left)
    const disabledAt = new Date(now - 35 * 24 * 60 * 60 * 1000);
    const daysRemaining = getLinkDaysRemaining(disabledAt);
    expect(daysRemaining).toBe(0);
  });
});
