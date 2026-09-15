import { describe, it, expect } from 'vitest';
import { page, paginationInput } from './pagination.js';

describe('page envelope', () => {
  it('computes hasMore correctly', () => {
    const p = page([1, 2, 3], 10, { limit: 3, offset: 0 });
    expect(p).toEqual({ items: [1, 2, 3], total: 10, limit: 3, offset: 0, hasMore: true });
  });
  it('hasMore is false on the last page', () => {
    expect(page([9, 10], 10, { limit: 3, offset: 8 }).hasMore).toBe(false);
  });
});

describe('paginationInput defaults', () => {
  it('applies defaults and clamps', () => {
    expect(paginationInput.parse({})).toMatchObject({ limit: 20, offset: 0 });
    expect(() => paginationInput.parse({ limit: 1000 })).toThrow();
  });
});
