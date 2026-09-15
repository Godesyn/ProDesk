import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADJUST,
  buildLockupSvg,
  extractElementIds,
  isValidMarkSvg,
  markContent,
  normalizeMarkSvg,
  orderedPalette,
  resolveAdjust,
  sanitizeSvg,
} from './svg.js';
import { inkBounds } from './bbox.js';
import { cleanWordmark } from './outline.js';
import { snapTypeface } from './typefaces.js';
import { buildGuidelines } from './guidelines.js';
import { fallbackConcepts, fallbackIterate } from './fallback.js';
import { briefSentence, personalityWords } from './prompts.js';
import type { LogoBrief, LogoSpec } from './types.js';

const BRIEF: LogoBrief = {
  businessName: 'Meridian',
  keywords: ['guidance', 'ascent'],
  personality: { classicModern: 3, seriousPlayful: 1, minimalExpressive: 1, geometricOrganic: 1 },
  markType: 'geometric',
  monochromeFirst: true,
};

const SPEC: LogoSpec = {
  palette: [
    { role: 'Primary', name: 'Forest', hex: '#2E9E58' },
    { role: 'Ink', name: 'Graphite', hex: '#0E0E0C' },
    { role: 'Background', name: 'Paper', hex: '#FFFFFF' },
  ],
  fonts: { heading: "'Inter Tight', sans-serif", body: "'Inter Tight', sans-serif" },
  geometry: 'ridge',
  rationale: 'x',
  elements: ['mark'],
};

describe('sanitizeSvg — security hardening', () => {
  it('strips <script> and inline event handlers', () => {
    const dirty =
      '<svg viewBox="0 0 100 100"><script>alert(1)</script><path d="M0 0 L10 10" onload="evil()"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script/i);
    expect(clean).not.toMatch(/onload/i);
    expect(clean).toContain('<path');
  });

  it('removes external hrefs and <image>/<use> but keeps fragment refs', () => {
    const dirty =
      '<svg viewBox="0 0 100 100"><image href="http://evil/x.png"/><use xlink:href="#a"/><path href="#frag" d="M0 0"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/<image/i);
    expect(clean).not.toMatch(/<use/i);
    expect(clean).not.toMatch(/http:\/\/evil/);
    expect(clean).toContain('href="#frag"');
  });

  it('extracts the <svg> out of surrounding prose / code fences', () => {
    const wrapped = 'Here you go:\n```svg\n<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="10"/></svg>\n```';
    expect(sanitizeSvg(wrapped)).toMatch(/^<svg/);
  });

  it('returns empty for non-svg or oversized input', () => {
    expect(sanitizeSvg('not an svg')).toBe('');
    expect(sanitizeSvg('<svg>' + 'x'.repeat(70_000) + '</svg>')).toBe('');
  });
});

describe('normalizeMarkSvg', () => {
  it('wraps bare artwork in a <g id="mark"> and forces a square viewBox', () => {
    const out = normalizeMarkSvg('<svg viewBox="0 0 200 200"><path d="M0 0 L10 10"/></svg>');
    expect(out).toContain('id="mark"');
    expect(out).toMatch(/viewBox="0 0 200 200"/);
    expect(isValidMarkSvg(out)).toBe(true);
    expect(extractElementIds(out)).toContain('mark');
  });

  it('rejects artwork-less svg', () => {
    expect(normalizeMarkSvg('<svg viewBox="0 0 100 100"></svg>')).toBe('');
  });
});

/*
  The engine annotates what it draws, and those notes are the only record of what
  a path means — so they survive into storage. They must not survive into a file
  the brand ships, and they must never be a way to smuggle markup past the
  regex readers in this module.
*/
describe('mark comments — kept for the editor, defused, dropped on the way out', () => {
  const annotated =
    '<svg viewBox="0 0 100 100"><g id="mark">' +
    '<!-- ridge: the ascending stroke -->' +
    '<path stroke="currentColor" stroke-width="7" d="M15 80 L50 20 L85 80"/>' +
    '</g></svg>';

  it('keeps the note on the stored mark', () => {
    expect(normalizeMarkSvg(annotated)).toContain('<!-- ridge: the ascending stroke -->');
  });

  it('strips tags out of a comment, so one can never close a group early', () => {
    const hostile = '<svg viewBox="0 0 100 100"><g id="mark"><!-- </g><g id="ghost"> --><path d="M0 0 L1 1"/></g></svg>';
    const clean = sanitizeSvg(hostile);
    expect(clean).not.toMatch(/<!--[^>]*</);
    expect(extractElementIds(clean)).not.toContain('ghost');
    // The marker itself survives — it is only its contents that are neutered.
    expect(clean).toMatch(/<!--[^<>]*-->/);
  });

  it('does not let a comment shelter a script from the strippers', () => {
    const clean = sanitizeSvg(
      '<svg viewBox="0 0 100 100"><g id="mark"><!-- <script>alert(1)</script> --><path d="M0 0 L1 1"/></g></svg>',
    );
    expect(clean).not.toMatch(/alert\(1\)/);
  });

  it('drops every note from a composed lockup', () => {
    const svg = buildLockupSvg({
      mark: normalizeMarkSvg(annotated),
      wordmark: 'Meridian',
      spec: SPEC,
      slot: 'primary',
    });
    expect(svg).not.toContain('<!--');
    expect(svg).not.toContain('ridge');
  });
});

const viewBoxOfSvg = (svg: string): [number, number] => {
  const parts = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number) ?? [];
  return [parts[2] ?? 0, parts[3] ?? 0];
};

describe('buildLockupSvg — compositional lockups', () => {
  const mark = normalizeMarkSvg('<svg viewBox="0 0 100 100"><g id="mark"><path stroke="currentColor" d="M10 10 L90 90"/></g></svg>');

  it('mark lockup keeps just the symbol, in a square', () => {
    const svg = buildLockupSvg({ mark, wordmark: 'Meridian', spec: SPEC, slot: 'mark' });
    expect(svg).toMatch(/^<svg/);
    expect(svg).not.toContain('Meridian');
    const [w, h] = viewBoxOfSvg(svg);
    expect(w).toBe(h);
  });

  it('sets the wordmark as OUTLINES, never a font-dependent <text> node', () => {
    // A live <text> node renders with whatever font the renderer happens to have.
    // The server has no webfonts, so exports silently changed typeface — outlines
    // make the geometry the source of truth and keep preview == download.
    const svg = buildLockupSvg({ mark, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    expect(svg).not.toMatch(/<text/);
    expect(svg).not.toMatch(/font-family/);
    expect(svg).toMatch(/<path transform="translate\([^"]+\) scale\(/);
    expect(svg).toContain('currentColor');
  });

  it('escapes nothing into text but still renders punctuation-heavy names', () => {
    const svg = buildLockupSvg({ mark, wordmark: 'A & B', spec: SPEC, slot: 'primary' });
    expect(svg).not.toContain('&amp;'); // no text node to escape any more
    expect(svg).toMatch(/<path transform=/);
  });

  it('grows the viewBox with the wordmark instead of clipping long names', () => {
    const [shortW] = viewBoxOfSvg(buildLockupSvg({ mark, wordmark: 'Ki', spec: SPEC, slot: 'primary' }));
    const [longW] = viewBoxOfSvg(
      buildLockupSvg({ mark, wordmark: 'Harbourvine Provisions Co', spec: SPEC, slot: 'primary' }),
    );
    expect(longW).toBeGreaterThan(shortW * 2);
  });

  it('falls back to a mark-only box when there is no wordmark', () => {
    const svg = buildLockupSvg({ mark, wordmark: '', spec: SPEC, slot: 'primary' });
    const [w, h] = viewBoxOfSvg(svg);
    expect(w).toBe(h);
  });

  it('reversed lockup paints a dark ground and white ink', () => {
    const svg = buildLockupSvg({ mark, wordmark: 'X', spec: SPEC, slot: 'reversed' });
    expect(svg).toContain('#0E0E0C');
    expect(svg).toContain('color:#FFFFFF');
  });

  it('committed primary uses the palette primary as ink', () => {
    const svg = buildLockupSvg({ mark, wordmark: 'X', spec: SPEC, slot: 'primary', committed: true });
    expect(svg).toContain('#2E9E58');
  });

  it('markContent takes the mark group whole, tag included', () => {
    // The group's own tag carries transform/display state that bbox.ts measures —
    // dropping it made the drawn mark disagree with the measured one.
    expect(markContent(mark)).toMatch(/^<g\b[^>]*id="mark"/);
    expect(markContent(mark)).toContain('<path');
    expect(markContent(mark)).not.toContain('<svg');
    expect(markContent(mark).endsWith('</g>')).toBe(true);
  });

  it('snaps a serif suggestion to the shipped serif face', () => {
    expect(snapTypeface('Playfair Display, Georgia, serif')).toBe('instrument-serif');
    expect(snapTypeface('system-ui, sans-serif')).toBe('inter-tight');
    expect(snapTypeface('IBM Plex Mono')).toBe('jetbrains-mono');
  });
});

describe('geometry adjustments — the editor sliders are real edits', () => {
  const mark = normalizeMarkSvg(
    '<svg viewBox="0 0 100 100"><g id="mark">' +
      '<path stroke="currentColor" stroke-width="7" d="M10 10 L90 90"/>' +
      '<g id="dot"><circle stroke="currentColor" stroke-width="7" cx="80" cy="20" r="5"/></g>' +
      '</g></svg>',
  );

  it('resolveAdjust supplies a no-op default and clamps nonsense', () => {
    expect(resolveAdjust(null)).toEqual(DEFAULT_ADJUST);
    const wild = resolveAdjust({ scale: 99, strokeWidth: -5, clearspace: 0, hidden: ['a'] });
    expect(wild.scale).toBeLessThanOrEqual(2);
    expect(wild.strokeWidth).toBeGreaterThanOrEqual(0.5);
    expect(wild.clearspace).toBeGreaterThanOrEqual(0.25);
    expect(wild.hidden).toEqual(['a']);
  });

  it('hiding an element hides it in the composed lockup (so also in exports)', () => {
    const spec: LogoSpec = { ...SPEC, adjust: { ...DEFAULT_ADJUST, hidden: ['dot'] } };
    const svg = buildLockupSvg({ mark, wordmark: 'M', spec, slot: 'mark' });
    expect(svg).toMatch(/id="dot"[^>]*display="none"/);
  });

  it('refuses to hide the root group — that is an empty logo, not an edit', () => {
    const spec: LogoSpec = { ...SPEC, adjust: { ...DEFAULT_ADJUST, hidden: ['mark'] } };
    const svg = buildLockupSvg({ mark, wordmark: 'M', spec, slot: 'mark' });
    expect(svg).not.toMatch(/display="none"/);
    expect(svg).toContain('<path');
  });

  it('a stroke override replaces per-element widths rather than losing to them', () => {
    const spec: LogoSpec = { ...SPEC, adjust: { ...DEFAULT_ADJUST, strokeWidth: 3 } };
    const svg = buildLockupSvg({ mark, wordmark: 'M', spec, slot: 'mark' });
    expect(svg).not.toMatch(/<path[^>]*stroke-width="7"/);
    expect(svg).toMatch(/<g transform="[^"]*"\s*stroke-width="3"/);
  });

  it('scaling the mark shrinks the lockup box with it', () => {
    const big = buildLockupSvg({ mark, wordmark: 'M', spec: SPEC, slot: 'mark' });
    const small = buildLockupSvg({
      mark,
      wordmark: 'M',
      spec: { ...SPEC, adjust: { ...DEFAULT_ADJUST, scale: 0.5 } },
      slot: 'primary',
    });
    expect(viewBoxOfSvg(small)[1]).toBeLessThan(viewBoxOfSvg(big)[1]);
  });
});

describe('the mark square is centred on its ink — the favicon case', () => {
  const square = (body: string) =>
    buildLockupSvg({
      mark: normalizeMarkSvg(`<svg viewBox="0 0 100 100">${body}</svg>`),
      wordmark: 'X',
      spec: SPEC,
      slot: 'mark',
    });

  /** Assert the ink actually drawn sits dead centre of the emitted square. */
  const expectCentred = (svg: string) => {
    const [w, h] = viewBoxOfSvg(svg);
    expect(w).toBe(h);
    const box = inkBounds(svg);
    expect(box).not.toBeNull();
    expect(box!.minX).toBeCloseTo(w - box!.maxX, 1);
    expect(box!.minY).toBeCloseTo(h - box!.maxY, 1);
    // …and inside the box, with breathing room rather than flush to an edge.
    expect(box!.minX).toBeGreaterThan(0);
    expect(box!.minY).toBeGreaterThan(0);
  };

  it('centres artwork that sits off-centre in its own viewBox', () => {
    expectCentred(square('<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g>'));
  });

  it('centres a mark whose group carries its own transform', () => {
    // Regression: the transform was measured but not drawn, so the mark landed
    // outside its square entirely — at 16px, an empty or half-clipped favicon.
    expectCentred(
      square(
        '<g id="mark" transform="translate(30 0)"><circle stroke="currentColor" cx="20" cy="50" r="15"/></g>',
      ),
    );
  });

  it('ignores ink outside the mark group, which is never drawn', () => {
    expectCentred(
      square(
        '<circle stroke="currentColor" cx="90" cy="90" r="6"/>' +
          '<g id="mark"><circle stroke="currentColor" cx="30" cy="30" r="10"/></g>',
      ),
    );
  });

  it('still measures a mark that declares paint in <defs>', () => {
    // Regression: a gradient/clipPath definition failed the WHOLE measurement, so
    // the square fell back to the viewBox and inherited the artwork's offset.
    expectCentred(
      square(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
          '<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g>',
      ),
    );
  });

  // The colour-free square the raster exports bake their own ink into is covered
  // at the layout layer — see layout-centring.test.ts.
});

describe('inkBounds — what the artwork actually occupies', () => {
  it('measures shapes, not the viewBox', () => {
    const box = inkBounds('<svg viewBox="0 0 100 100"><circle cx="50" cy="40" r="20"/></svg>');
    expect(box).not.toBeNull();
    expect(box!.minX).toBe(30);
    expect(box!.minY).toBe(20);
    expect(box!.maxY).toBe(60);
    expect(box!.height).toBe(40);
  });

  it('adds half the stroke width — a hairline draws outside its path', () => {
    const box = inkBounds(
      '<svg viewBox="0 0 100 100"><path stroke="currentColor" stroke-width="8" d="M20 20 L80 20"/></svg>',
    );
    expect(box!.minX).toBe(16);
    expect(box!.minY).toBe(16);
    expect(box!.maxY).toBe(24);
  });

  it('honours group transforms and skips hidden groups', () => {
    const box = inkBounds(
      '<svg viewBox="0 0 100 100">' +
        '<g transform="translate(10 10)"><rect x="0" y="0" width="20" height="20"/></g>' +
        '<g display="none"><rect x="90" y="90" width="10" height="10"/></g>' +
        '</svg>',
    );
    expect(box).toEqual(expect.objectContaining({ minX: 10, minY: 10, maxX: 30, maxY: 30 }));
  });

  it('flattens curves rather than trusting control points', () => {
    // The control point sits at y=0, but the curve itself never rises above y=25.
    const box = inkBounds('<svg viewBox="0 0 100 100"><path d="M0 50 Q50 0 100 50"/></svg>');
    expect(box!.minY).toBeGreaterThan(20);
    expect(box!.maxY).toBe(50);
  });

  it('skips definition subtrees instead of failing over them', () => {
    const box = inkBounds(
      '<svg viewBox="0 0 100 100">' +
        '<defs><clipPath id="c"><rect x="0" y="0" width="99" height="99"/></clipPath></defs>' +
        '<rect x="20" y="20" width="20" height="20"/>' +
        '</svg>',
    );
    expect(box).toEqual(expect.objectContaining({ minX: 20, minY: 20, maxX: 40, maxY: 40 }));
  });

  it('returns null for geometry it cannot measure, so callers can fall back', () => {
    expect(inkBounds('<svg viewBox="0 0 100 100"><text x="0" y="0">A</text></svg>')).toBeNull();
    expect(inkBounds('<svg viewBox="0 0 100 100"><path d="M0 0 Z50 X"/></svg>')).toBeNull();
    expect(inkBounds('<svg viewBox="0 0 100 100"></svg>')).toBeNull();
  });
});

describe('lockup alignment — mark and wordmark share one centre line', () => {
  /** The baseline y of the wordmark path (its translate's second argument). */
  const baselineOf = (svg: string): number =>
    Number(/<path transform="translate\(([-\d.]+) ([-\d.]+)\)/.exec(svg)![2]);
  /** The mark group's translate. */
  const markTranslateOf = (svg: string): [number, number] => {
    const m = /<g transform="translate\(([-\d.]+) ([-\d.]+)\)/.exec(svg)!;
    return [Number(m[1]), Number(m[2])];
  };
  const heightOf = (svg: string) => viewBoxOfSvg(svg)[1];

  // Ink that sits in the TOP half of the box: box-centred type would sit far too
  // low against it. Same artwork, shifted down, must mirror exactly.
  const high = normalizeMarkSvg(
    '<svg viewBox="0 0 100 100"><g id="mark"><rect x="20" y="10" width="60" height="30" fill="currentColor"/></g></svg>',
  );
  const low = normalizeMarkSvg(
    '<svg viewBox="0 0 100 100"><g id="mark"><rect x="20" y="60" width="60" height="30" fill="currentColor"/></g></svg>',
  );

  it('centres the cap band on the mark ink, wherever it sits in the box', () => {
    const a = buildLockupSvg({ mark: high, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    const b = buildLockupSvg({ mark: low, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    // Identical ink, identical lockup — the offset inside the box must not leak.
    expect(heightOf(a)).toBe(heightOf(b));
    expect(baselineOf(a)).toBe(baselineOf(b));

    // And the type's cap band is centred on the ink, not on the mark's box.
    const [, markY] = markTranslateOf(a);
    const inkTop = markY + 10; // the rect's own y, drawn at scale 1
    const inkCentre = inkTop + 30 / 2;
    const capBandCentre = baselineOf(a) - 33.4 / 2; // Inter Tight cap ≈ 0.727em at 46
    expect(Math.abs(capBandCentre - inkCentre)).toBeLessThan(1.5);
  });

  it('frames the lockup on the artwork, not on its padding', () => {
    const svg = buildLockupSvg({ mark: high, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    // Ink is 30 units tall, so the lockup is ~30 + padding — not the 100 box.
    expect(heightOf(svg)).toBeLessThan(60);
  });

  it('keeps descender tails inside the box', () => {
    const svg = buildLockupSvg({ mark: high, wordmark: 'Jaguar', spec: SPEC, slot: 'wordmark' });
    const [, h] = viewBoxOfSvg(svg);
    expect(h - baselineOf(svg)).toBeGreaterThan(8);
  });

  it('falls back to the mark box when the artwork cannot be measured', () => {
    // A <text> node inside the mark defeats measurement; the lockup must still
    // build (loose framing) rather than throw or collapse.
    const withText = normalizeMarkSvg(
      '<svg viewBox="0 0 100 100"><g id="mark"><text x="10" y="60" font-size="40">M</text>' +
        '<circle cx="50" cy="50" r="40" stroke="currentColor"/></g></svg>',
    );
    const svg = buildLockupSvg({ mark: withText, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    expect(heightOf(svg)).toBe(116); // 100 mark box + 2 × 8 padding
  });
});

describe('cleanWordmark — pasted brand names', () => {
  it('drops invisibles but keeps word boundaries', () => {
    // A tab must become a space, not vanish and weld the words together.
    expect(cleanWordmark('North\tStar')).toBe('North Star');
    expect(cleanWordmark('  Meridian  ')).toBe('Meridian');
  });
});

describe('guidelines', () => {
  it('reports the mark\'s own clearspace and a full rule set', () => {
    const g = buildGuidelines({ ...SPEC, adjust: { ...DEFAULT_ADJUST, clearspace: 1.5 } });
    expect(g.clearspace).toBe('1.5x');
    expect(g.rules.some((r) => r.do)).toBe(true);
    expect(g.rules.some((r) => !r.do)).toBe(true);
    expect(g.minSizes[0].px).toBe(16);
  });
});

describe('orderedPalette', () => {
  it('maps roles to the suite token order with fallbacks', () => {
    const p = orderedPalette(SPEC.palette);
    expect(p.primary).toBe('#2E9E58');
    expect(p.ink).toBe('#0E0E0C');
    expect(p.background).toBe('#FFFFFF');
    expect(p.rule).toMatch(/^#/);
  });
});

describe('fallback generator', () => {
  it('produces the requested count of valid, on-contract concepts', () => {
    const concepts = fallbackConcepts(BRIEF, 6);
    expect(concepts).toHaveLength(6);
    for (const c of concepts) {
      expect(isValidMarkSvg(c.svg)).toBe(true);
      expect(c.svg).toContain('id="mark"');
      expect(c.spec.palette.length).toBeGreaterThanOrEqual(3);
      expect(c.name.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic for the same brand + index', () => {
    const a = fallbackConcepts(BRIEF, 3);
    const b = fallbackConcepts(BRIEF, 3);
    expect(a.map((c) => c.svg)).toEqual(b.map((c) => c.svg));
  });

  it('offset produces different concepts (for "six more")', () => {
    const first = fallbackConcepts(BRIEF, 3, 0);
    const more = fallbackConcepts(BRIEF, 3, 3);
    expect(first.map((c) => c.name)).not.toEqual(more.map((c) => c.name));
  });

  it('iterate returns a valid variant', () => {
    const next = fallbackIterate(BRIEF, 0);
    expect(isValidMarkSvg(next.svg)).toBe(true);
  });
});

describe('prompts', () => {
  it('personalityWords maps dials to poles', () => {
    const words = personalityWords(BRIEF);
    expect(words[0]).toBe('modern'); // classicModern = 3 → right pole
    expect(words[1]).toBe('serious'); // seriousPlayful = 1 → left pole
    expect(words).toHaveLength(4);
  });

  it('briefSentence reads naturally', () => {
    const s = briefSentence(BRIEF);
    expect(s).toContain('Meridian');
    expect(s).toContain('geometric');
    expect(s).toContain('monochrome');
  });
});
