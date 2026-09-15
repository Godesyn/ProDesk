/**
 * Every shipped typeface, exercised against its real binary.
 *
 * WHY: a face is three things that have to agree — a row in `TYPEFACES`, a `.ttf`
 * on disk, and a family loaded in the client. Only the first is type-checked. A
 * missing file, a "font" that is actually a subsetted Google kit blob (which is
 * what the CSS2 API hands back, and what fontkit refuses), or a weight outside
 * the face's own axis all fail at OUTLINE time — i.e. in an export, for a user.
 * Opening each face here turns that into a test failure.
 */
import { describe, expect, it } from 'vitest';
import { TYPEFACES, TYPEFACE_KEYS, getTypeface, snapTypeface } from './typefaces.js';
import { outlineText } from './outline.js';

const SAMPLE = 'Meridian Co';

describe('shipped typefaces', () => {
  it('ships more than a token set', () => {
    // The point of the registry is choice; a regression that silently drops
    // faces back to the original three should fail loudly.
    expect(TYPEFACE_KEYS.length).toBeGreaterThanOrEqual(11);
  });

  it('covers every genre the picker groups by', () => {
    const cats = new Set(TYPEFACE_KEYS.map((k) => TYPEFACES[k].category));
    expect([...cats].sort()).toEqual(['mono', 'sans', 'serif']);
  });

  it.each(TYPEFACE_KEYS)('%s opens and outlines real glyph data', (key) => {
    const out = outlineText(SAMPLE, { typeface: key });
    expect(out.d.length).toBeGreaterThan(100); // real path data, not an empty run
    expect(out.advance).toBeGreaterThan(0);
    expect(out.unitsPerEm).toBeGreaterThan(0);
    // A cap height of zero means the face reported nothing usable and every
    // lockup built from it would centre the wordmark on a false line.
    expect(out.capHeight).toBeGreaterThan(0);
    expect(out.capHeight).toBeLessThan(out.unitsPerEm);
  });

  it.each(TYPEFACE_KEYS)('%s declares its own key', (key) => {
    expect(TYPEFACES[key].key).toBe(key);
    expect(getTypeface(key)).toBe(TYPEFACES[key]);
  });

  it('instances a weight beyond a face\'s axis without breaking it', () => {
    // Space Grotesk's wght axis stops at 700 but display type asks for heavy.
    const heavy = outlineText(SAMPLE, { typeface: 'space-grotesk', weight: 900 });
    expect(heavy.d.length).toBeGreaterThan(100);
    // …and below the floor, too (Source Serif 4 starts at 200).
    const light = outlineText(SAMPLE, { typeface: 'source-serif', weight: 50 });
    expect(light.d.length).toBeGreaterThan(100);
  });
});

describe('snapTypeface across the widened set', () => {
  it.each(TYPEFACE_KEYS)('round-trips %s through its own CSS stack', (key) => {
    expect(snapTypeface(TYPEFACES[key].cssFamily)).toBe(key);
  });

  it('prefers the more specific family name', () => {
    // "Inter Tight" contains "Inter"; the longer label has to win.
    expect(snapTypeface("'Inter Tight', system-ui, sans-serif")).toBe('inter-tight');
    expect(snapTypeface("'Inter', system-ui, sans-serif")).toBe('inter');
    // "IBM Plex Mono" is not IBM Plex Sans.
    expect(snapTypeface('IBM Plex Mono')).toBe('jetbrains-mono');
  });

  it('falls back by genre for a family we do not ship', () => {
    expect(snapTypeface('Playfair Display, Georgia, serif')).toBe('instrument-serif');
    expect(snapTypeface('Helvetica Neue, system-ui, sans-serif')).toBe('inter-tight');
    expect(snapTypeface('Courier New, monospace')).toBe('jetbrains-mono');
    expect(snapTypeface('')).toBe('inter-tight');
  });

  it('accepts a bare key, which is what fresh specs persist', () => {
    expect(snapTypeface('fraunces')).toBe('fraunces');
    expect(snapTypeface('dm-sans')).toBe('dm-sans');
  });
});
