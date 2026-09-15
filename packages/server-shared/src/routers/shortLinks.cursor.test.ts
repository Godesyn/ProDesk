import { describe, expect, it } from 'vitest';
import { encodeCursor, decodeCursor } from './shortLinks.js';

/** Keyset cursor round-trip used by shortLinks.list pagination. */
describe('shortLinks keyset cursor', () => {
  it('round-trips (createdAt, id) through base64url', () => {
    const createdAt = new Date('2026-06-29T03:21:45.123Z');
    const id = '11111111-2222-3333-4444-555555555555';
    const cur = decodeCursor(encodeCursor(createdAt, id));
    expect(cur).toEqual({ createdAt: createdAt.toISOString(), id });
  });

  it('returns null for an absent cursor', () => {
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for a malformed cursor instead of throwing', () => {
    expect(decodeCursor('not-a-valid-cursor')).toBeNull();
    // base64url of a string with no "|" separator
    expect(decodeCursor(Buffer.from('nopipe', 'utf8').toString('base64url'))).toBeNull();
  });
});
