/**
 * The two seams where Logo Studio hands work to something else: the brand kit
 * (push-to-suite) and a public share link. Both broke the same way — one side
 * naming a thing differently from the side that reads it — so both are pinned
 * here rather than left to integration.
 */
import { describe, expect, it } from 'vitest';
import {
  composeLockup,
  matchSlot,
  slotUrlFrom,
  ALL_SLOTS,
  DEFAULT_ADJUST,
  SLOT_ALIASES,
} from './layout.js';
import { bakeColor } from './raster.js';
import {
  brandSlug,
  shareLinkPath,
  shareTokenFor,
  shareTokenFromPath,
  SHARE_TOKEN_RE,
} from './share-link.js';

describe('logoSlots vocabulary — the push-to-suite ↔ Brand Kit seam', () => {
  it('covers every slot the engine can build', () => {
    for (const slot of ALL_SLOTS) {
      expect(SLOT_ALIASES[slot]?.[0]).toBe(slot);
    }
  });

  it('resolves the engine keys push-to-suite writes', () => {
    expect(matchSlot('reversed')).toBe('reversed');
    expect(matchSlot('mark')).toBe('mark');
    expect(matchSlot('stacked')).toBe('stacked');
    expect(matchSlot('wordmark')).toBe('wordmark');
  });

  it("resolves the dashboard's display names, case-insensitively", () => {
    expect(matchSlot('Mark / favicon')).toBe('mark');
    expect(matchSlot('Lockup, stacked')).toBe('stacked');
    expect(matchSlot('Lockup, horizontal')).toBe('primary');
    expect(matchSlot('  REVERSED ')).toBe('reversed');
  });

  it('never claims a slot for an unknown name', () => {
    expect(matchSlot('Sticker sheet')).toBeNull();
    expect(matchSlot('')).toBeNull();
  });

  it('reads a kit written by either side', () => {
    const pushed = [
      { slot: 'mark', url: 'https://cdn/mark.png' },
      { slot: 'reversed', url: 'https://cdn/reversed.svg' },
    ];
    expect(slotUrlFrom(pushed, 'mark')).toBe('https://cdn/mark.png');
    expect(slotUrlFrom(pushed, 'reversed')).toBe('https://cdn/reversed.svg');

    const handUploaded = [{ slot: 'Mark / favicon', url: 'https://cdn/old.png' }];
    expect(slotUrlFrom(handUploaded, 'mark')).toBe('https://cdn/old.png');
  });

  it('prefers the canonical entry when both vocabularies are present', () => {
    // A brand that hand-uploaded first and pushed later must see the push.
    const mixed = [
      { slot: 'Mark / favicon', url: 'https://cdn/old.png' },
      { slot: 'mark', url: 'https://cdn/pushed.png' },
    ];
    expect(slotUrlFrom(mixed, 'mark')).toBe('https://cdn/pushed.png');
  });

  it('ignores entries with no url', () => {
    expect(slotUrlFrom([{ slot: 'mark', url: null }], 'mark')).toBeNull();
    expect(slotUrlFrom(null, 'mark')).toBeNull();
  });
});

describe('the reversed lockup pushed to the suite', () => {
  const mark =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" role="img">' +
    '<g id="mark"><circle stroke="currentColor" stroke-width="4" cx="50" cy="50" r="30"/></g></svg>';
  const compose = (ground: string | null | undefined) =>
    composeLockup({
      mark,
      outline: null,
      slot: 'reversed',
      adjust: DEFAULT_ADJUST,
      palette: [{ role: 'Primary', name: 'Forest', hex: '#2E9E58' }],
      ink: '#FFFFFF',
      ground,
    });

  it('still plates itself when nobody overrides the ground', () => {
    // The guidelines sheet depends on this: reversed is SHOWN on its dark ground.
    expect(compose(undefined)).toContain('fill="#0E0E0C"');
  });

  it('drops the plate entirely when the ground is overridden to null', () => {
    const svg = compose(null);
    expect(svg).not.toMatch(/<rect\b/);
    expect(svg).toContain('style="color:#FFFFFF"');
  });

  it('is white ink on nothing — bakeColor adds no ground of its own', () => {
    // What the PNG upload actually rasterises.
    const baked = bakeColor(compose(null), '#FFFFFF', null);
    expect(baked).not.toMatch(/<rect\b/);
    expect(baked).not.toContain('currentColor');
    expect(baked).toContain('#FFFFFF');
    // Nothing dark survived from the slot's own contract.
    expect(baked).not.toContain('#0E0E0C');
  });
});

describe('share link slugs', () => {
  it('reduces a brand name to words', () => {
    expect(brandSlug('Acme Coffee Co.')).toBe('acme-coffee-co');
    expect(brandSlug('iKeep')).toBe('ikeep');
    expect(brandSlug('  Blue   Ridge  ')).toBe('blue-ridge');
  });

  it('keeps accented names readable rather than dropping them', () => {
    expect(brandSlug('Café Crème')).toBe('cafe-creme');
  });

  it('always yields something linkable', () => {
    expect(brandSlug('')).toBe('brand');
    expect(brandSlug('***')).toBe('brand');
  });

  it('truncates on a word boundary, never mid-word', () => {
    const slug = brandSlug('The Extraordinarily Long Legal Trading Name Limited Partnership');
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith('-')).toBe(false);
    // Whole words only — no half-word left at the cut.
    for (const word of slug.split('-')) {
      expect('the extraordinarily long legal trading name limited partnership').toContain(word);
    }
  });

  it('round-trips: mint → URL path → parse back to the same token', () => {
    const token = shareTokenFor(brandSlug('Acme Coffee Co.'), 2);
    expect(token).toBe('acme-coffee-co/v2');
    expect(shareLinkPath(token)).toBe('/share/acme-coffee-co/v2');
    const [, , brand, version] = shareLinkPath(token).split('/');
    expect(shareTokenFromPath(brand, version)).toBe(token);
  });

  it('serves legacy hex tokens from the old path', () => {
    const legacy = 'a3f19c02b8d74e5610fa9c3d27e8b451';
    expect(shareLinkPath(legacy)).toBe(`/g/${legacy}`);
    expect(legacy).toMatch(SHARE_TOKEN_RE);
  });

  it('produces tokens the public procedure accepts, whatever the name', () => {
    for (const name of ['Acme Coffee Co.', 'iKeep', 'Café Crème', '', '9 Lives', '***']) {
      expect(shareTokenFor(brandSlug(name), 3)).toMatch(SHARE_TOKEN_RE);
    }
  });

  it('rejects path segments that are not a link', () => {
    expect(shareTokenFromPath('acme', 'notaversion')).toBeNull();
    expect(shareTokenFromPath('-acme', 'v1')).toBeNull();
    expect(shareTokenFromPath('acme/../secret', 'v1')).toBeNull();
  });
});
