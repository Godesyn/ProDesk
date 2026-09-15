/**
 * The square-mark (favicon / avatar / app-icon) centring guarantee, tested at the
 * layout layer — deliberately importing NOTHING but layout.ts + bbox.ts.
 *
 * WHY its own file: composition is what the favicon geometry hangs off, and every
 * way it drifted off-centre in practice traced back to the layout measuring one
 * thing and drawing another. Pinning it here keeps the guarantee attached to the
 * dependency-free module that both the server and the canvas call, rather than to
 * whichever wrapper happens to be in front of it.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ADJUST, composeLockup } from './layout.js';
import { inkBounds } from './bbox.js';

const PALETTE = [{ role: 'Primary', name: 'Forest', hex: '#2E9E58' }];

const square = (body: string, ink?: string | null) =>
  composeLockup({
    mark:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
      `stroke-linecap="round" stroke-linejoin="round" role="img">${body}</svg>`,
    outline: null,
    slot: 'mark',
    adjust: DEFAULT_ADJUST,
    palette: PALETTE,
    ink,
  });

const expectCentred = (svg: string) => {
  const parts = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number) ?? [];
  const [w, h] = [parts[2], parts[3]];
  expect(w).toBe(h);
  const box = inkBounds(svg);
  expect(box).not.toBeNull();
  expect(box!.minX).toBeCloseTo(w - box!.maxX, 1);
  expect(box!.minY).toBeCloseTo(h - box!.maxY, 1);
  expect(box!.minX).toBeGreaterThan(0);
  expect(box!.minY).toBeGreaterThan(0);
};

describe('layout.ts — the ported centring guarantee', () => {
  it('centres off-centre artwork', () => {
    expectCentred(square('<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g>'));
  });

  it('centres a mark group carrying its own transform', () => {
    expectCentred(
      square('<g id="mark" transform="translate(30 0)"><circle stroke="currentColor" cx="20" cy="50" r="15"/></g>'),
    );
  });

  it('ignores ink outside the mark group', () => {
    expectCentred(
      square(
        '<circle stroke="currentColor" cx="90" cy="90" r="6"/>' +
          '<g id="mark"><circle stroke="currentColor" cx="30" cy="30" r="10"/></g>',
      ),
    );
  });

  it('measures a mark that declares paint in <defs>', () => {
    expectCentred(
      square(
        '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
          '<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g>',
      ),
    );
  });

  it('ink: null declares no colour, for the raster exports to bake', () => {
    const svg = square('<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g>', null);
    expect(svg).not.toMatch(/style="color:/);
    expect(svg).toContain('currentColor');
    expectCentred(svg);
  });

  /**
   * The favicon/avatar defect this guarantee is really about: a ring drawn with
   * arcs measured far looser than it draws, so the square framed padding instead
   * of artwork — the mark sat left of centre and small inside it. Asserted
   * against the geometry (r=30 about (50,50), so a 60-unit ring) rather than
   * against another `inkBounds` call, which would agree with itself either way.
   */
  it('frames a ring drawn with arcs on the ring, not on its radii', () => {
    const svg = square(
      '<g id="mark"><path stroke="currentColor" stroke-width="4" ' +
        'd="M 20 50 A 30 30 0 1 0 80 50 A 30 30 0 1 0 20 50"/></g>',
    );
    expectCentred(svg);
    // 60 of ring + 4 of stroke + the 8-unit pad on each side.
    const side = Number(svg.match(/viewBox="0 0 ([\d.]+)/)?.[1]);
    expect(side).toBeCloseTo(80, 1);
  });

  it('refuses to hide the root group', () => {
    const svg = composeLockup({
      mark:
        '<svg viewBox="0 0 100 100" fill="none" role="img">' +
        '<g id="mark"><circle stroke="currentColor" cx="50" cy="25" r="12"/></g></svg>',
      outline: null,
      slot: 'mark',
      adjust: { ...DEFAULT_ADJUST, hidden: ['mark'] },
      palette: PALETTE,
    });
    expect(svg).not.toMatch(/display="none"/);
    expectCentred(svg);
  });
});
