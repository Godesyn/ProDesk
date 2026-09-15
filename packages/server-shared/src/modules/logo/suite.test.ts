import { describe, it, expect } from 'vitest';
import { buildLogoSuite, SUITE_FILE_COUNT, SUITE_FORMS, assetStem } from './suite.js';
import { buildLockupSvg, normalizeMarkSvg } from './svg.js';
import { primaryHexOf } from './layout.js';
import type { LogoSpec } from './types.js';

const MARK = normalizeMarkSvg(
  '<svg viewBox="0 0 100 100"><g id="mark">' +
    '<circle cx="50" cy="50" r="30" stroke="currentColor" stroke-width="6"/>' +
    '<path d="M30 50 L70 50" stroke="currentColor"/>' +
    '</g></svg>',
);

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

const suite = () => buildLogoSuite({ mark: MARK, wordmark: 'Meridian', spec: SPEC });

describe('buildLogoSuite — the delivered matrix', () => {
  it('is six forms in two colourways, with unique keys', () => {
    const assets = suite();
    expect(assets).toHaveLength(SUITE_FILE_COUNT);
    expect(SUITE_FILE_COUNT).toBe(12);
    expect(new Set(assets.map((a) => a.key)).size).toBe(12);
    expect(assets.filter((a) => a.colourway === 'ink')).toHaveLength(SUITE_FORMS.length);
    expect(assets.filter((a) => a.colourway === 'colour')).toHaveLength(SUITE_FORMS.length);
  });

  /**
   * The defect the matrix exists to fix: the old six-slot list showed `primary`
   * and `mono`, which compose to byte-identical artwork whenever colour isn't
   * committed — so a "suite" of six was really five files and a duplicate.
   */
  it('has no duplicate artwork — unlike the slot list it replaced', () => {
    const assets = suite();
    expect(new Set(assets.map((a) => a.svg)).size).toBe(12);

    const primary = buildLockupSvg({ mark: MARK, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    const mono = buildLockupSvg({ mark: MARK, wordmark: 'Meridian', spec: SPEC, slot: 'mono' });
    expect(mono).toBe(primary);
  });

  it('paints the colour half in the brand primary and the ink half in ink', () => {
    const assets = suite();
    const primaryHex = primaryHexOf(SPEC.palette);
    const flat = (colourway: string) =>
      assets.filter((a) => a.colourway === colourway && !a.plate);

    for (const a of flat('colour')) expect(a.svg).toContain(`color:${primaryHex}`);
    for (const a of flat('ink')) expect(a.svg).toContain('color:#0E0E0C');
  });

  it('plates only the reversed forms, and knocks them out of the right ground', () => {
    const assets = suite();
    const plated = assets.filter((a) => a.plate);
    expect(plated.map((a) => a.key).sort()).toEqual([
      'reversed-colour',
      'reversed-ink',
      'reversed-stacked-colour',
      'reversed-stacked-ink',
    ]);

    // The plate is declared AND drawn: a viewer frames the tile with `plate`, and
    // the file itself carries the ground rect so it survives on any surface.
    for (const a of plated) expect(a.svg).toContain(`fill="${a.plate}"`);
    expect(assets.find((a) => a.key === 'reversed-ink')!.plate).toBe('#0E0E0C');
    expect(assets.find((a) => a.key === 'reversed-colour')!.plate).toBe(
      primaryHexOf(SPEC.palette),
    );
  });

  it('composes each form against its own geometry', () => {
    const assets = suite();
    const ratio = (key: string) => {
      const [, , w, h] = assets
        .find((a) => a.key === key)!
        .svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!
        .slice(1)
        .map(Number);
      return w / h;
    };
    // Wide horizontal, near-square mark, and the stacked form taller than the
    // horizontal one — the three shapes a real sheet has to show.
    expect(ratio('primary-ink')).toBeGreaterThan(2);
    expect(ratio('mark-ink')).toBeCloseTo(1, 5);
    expect(ratio('stacked-ink')).toBeLessThan(ratio('primary-ink'));
    // The reversed forms are the same geometry as their positive counterparts.
    expect(ratio('reversed-ink')).toBeCloseTo(ratio('primary-ink'), 5);
    expect(ratio('reversed-stacked-ink')).toBeCloseTo(ratio('stacked-ink'), 5);
  });

  it('names every file safely and distinctly', () => {
    expect(assetStem('Acme Coffee Co.')).toBe('acme-coffee-co');
    expect(assetStem('  ')).toBe('logo');
    expect(assetStem('')).toBe('logo');
    const names = suite().map((a) => `${assetStem('Acme Coffee')}-${a.key}`);
    expect(new Set(names).size).toBe(12);
    for (const n of names) expect(n).toMatch(/^[a-z0-9-]+$/);
  });
});
