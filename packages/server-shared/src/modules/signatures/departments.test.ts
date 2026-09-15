/**
 * Pure-logic tests for the signature-department copy.
 *
 * "Copy from" exists because the signature design form is long: nobody fills one
 * in twice. That makes a copy which quietly drops fields worse than no copy at
 * all — the user gets a department that looks almost right and has to find the
 * differences by eye. The first cut of this shipped with an INCLUDE list and
 * dropped the template, colours and logos on cross-brand copies.
 *
 * So the contract under test is deliberately stated against the live schema:
 * every column on `brand_kits` is copied unless it is explicitly excluded. Add a
 * column and these tests keep it honest without anyone remembering to.
 */
import { describe, it, expect } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { brandKits } from '../../db/schema.js';
import type { CombinedBrandKit } from './brand-kit-view.js';
import {
  cloneDepartmentDesign,
  DEPARTMENT_COPY_EXCLUDED,
  FALLBACK_DEPARTMENT_SLUG,
  mintDepartmentSlug,
  slugify,
} from './departments.js';

type BrandKitRow = typeof brandKits.$inferSelect;

/** A source department with every column populated distinctly. */
function sourceRow(overrides: Partial<BrandKitRow> = {}): BrandKitRow {
  const row: Record<string, unknown> = {};
  for (const key of Object.keys(getTableColumns(brandKits))) {
    row[key] = `src-${key}`;
  }
  return {
    ...row,
    id: 'kit-1',
    brandId: 'brand-1',
    createdByUserId: 'user-1',
    createdAt: new Date('2020-01-01'),
    updatedAt: new Date('2020-01-01'),
    isDefault: true,
    sortOrder: 0,
    logoWidth: 180,
    kitVersion: 3,
    ...overrides,
  } as BrandKitRow;
}

describe('cloneDepartmentDesign', () => {
  it('copies every brand_kits column that is not explicitly excluded', () => {
    const source = sourceRow();
    const copy = cloneDepartmentDesign(source, null);

    const expected = Object.keys(getTableColumns(brandKits)).filter(
      (c) => !DEPARTMENT_COPY_EXCLUDED.has(c),
    );
    // Both directions: nothing missing, and nothing invented.
    expect(Object.keys(copy).sort()).toEqual(expected.sort());
    for (const key of expected) {
      expect(copy[key]).toEqual((source as Record<string, unknown>)[key]);
    }
  });

  it('carries the fields a user checks first', () => {
    // These are the ones a wrong copy is noticed by: the layout, the palette and
    // the logos. Named explicitly so a regression points at the symptom.
    const source = sourceRow({
      defaultTemplate: 'minimal',
      barColor: '#123456',
      primaryColor: '#abcdef',
      logoUrl: 'https://cdn/logo.png',
      disclaimer: 'Confidential.',
    });
    const copy = cloneDepartmentDesign(source, null);

    expect(copy.defaultTemplate).toBe('minimal');
    expect(copy.barColor).toBe('#123456');
    expect(copy.primaryColor).toBe('#abcdef');
    expect(copy.logoUrl).toBe('https://cdn/logo.png');
    expect(copy.disclaimer).toBe('Confidential.');
  });

  it('never carries the row identity, placement or the icon cache', () => {
    const copy = cloneDepartmentDesign(sourceRow(), null);
    for (const key of DEPARTMENT_COPY_EXCLUDED) {
      expect(copy).not.toHaveProperty(key);
    }
  });

  it('keeps NULL overrides NULL within a brand, so the copy keeps inheriting', () => {
    // A same-brand duplicate that was tracking its brand's palette must keep
    // tracking it — materialising here would freeze it at today's colours.
    const source = sourceRow({ primaryColor: null, logoUrl: null });
    const copy = cloneDepartmentDesign(source, null);

    expect(copy.primaryColor).toBeNull();
    expect(copy.logoUrl).toBeNull();
  });

  it('materialises inherited values on a cross-brand copy', () => {
    // The source stores NULL because it inherits from ITS brand. Copying the raw
    // NULL would re-inherit the DESTINATION brand's identity instead, so the copy
    // would come out in the wrong colours — the one thing the user was avoiding.
    const source = sourceRow({
      primaryColor: null,
      secondaryColor: null,
      fontFamily: null,
      logoUrl: null,
      website: null,
      address: null,
    });
    const resolved = {
      website: 'https://source.example',
      address: '1 Source St',
      logoUrl: 'https://cdn/source-logo.png',
      logoKey: 'logos/source.png',
      primaryColor: '#004400',
      secondaryColor: '#111111',
      fontFamily: 'Georgia, serif',
    } as unknown as CombinedBrandKit;

    const copy = cloneDepartmentDesign(source, resolved);

    expect(copy.primaryColor).toBe('#004400');
    expect(copy.secondaryColor).toBe('#111111');
    expect(copy.fontFamily).toBe('Georgia, serif');
    expect(copy.logoUrl).toBe('https://cdn/source-logo.png');
    expect(copy.website).toBe('https://source.example');
    expect(copy.address).toBe('1 Source St');
    // Everything outside the inherited set still comes from the row itself.
    expect(copy.defaultTemplate).toBe(source.defaultTemplate);
  });
});

describe('department share slugs', () => {
  it('slugifies the way the SQL backfill does', () => {
    // These must agree with migration 0089's regexp_replace, or a department
    // created in the app and one created by the backfill get different URLs.
    expect(slugify('Sales')).toBe('sales');
    expect(slugify('S A L E S !')).toBe('s-a-l-e-s');
    expect(slugify('  Gold Coast  ')).toBe('gold-coast');
    expect(slugify('Café')).toBe('cafe');
    expect(slugify('!!!')).toBe('');
  });

  it('falls back when a name slugifies to nothing', () => {
    expect(mintDepartmentSlug('!!!', [])).toBe(FALLBACK_DEPARTMENT_SLUG);
    expect(mintDepartmentSlug('', [])).toBe(FALLBACK_DEPARTMENT_SLUG);
  });

  it('suffixes on collision, matching the backfill', () => {
    expect(mintDepartmentSlug('Sales', ['main'])).toBe('sales');
    expect(mintDepartmentSlug('Sales', ['main', 'sales'])).toBe('sales-2');
    expect(mintDepartmentSlug('Sales', ['main', 'sales', 'sales-2'])).toBe('sales-3');
  });

  it('compares case-insensitively, like the unique index', () => {
    // The index is on (brand_id, lower(slug)), so 'SALES' is taken.
    expect(mintDepartmentSlug('Sales', ['SALES'])).toBe('sales-2');
  });

  it('is unaffected by another brand using the same slug', () => {
    // `taken` is scoped to one brand by the caller; nothing here is global.
    expect(mintDepartmentSlug('Sales', [])).toBe('sales');
  });
});
