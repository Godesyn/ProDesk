import { describe, it, expect } from 'vitest';
import { hasPermission } from './permissions.js';

describe('hasPermission', () => {
  it('matches an explicit permission', () => {
    expect(hasPermission(['catalog', 'proposals'], 'catalog')).toBe(true);
    expect(hasPermission(['catalog'], 'proposals')).toBe(false);
  });

  it('grants each granular chat permission only when explicitly present', () => {
    expect(hasPermission(['chatWithBrands'], 'chatWithBrands')).toBe(true);
    expect(hasPermission(['chatWithStaffs'], 'chatWithBrands')).toBe(false);
    // The removed legacy "chat" permission no longer stands in for the granular set.
    expect(hasPermission(['chat'], 'chatWithBrands')).toBe(false);
  });
});
