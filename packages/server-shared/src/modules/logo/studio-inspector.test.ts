import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADJUST,
  applyMarkAdjust,
  layoutLockup,
  lockupFrame,
  toneColor,
  type LockupSlot,
  type MarkAdjust,
  type WordmarkOutline,
} from './layout.js';
import { inkBounds } from './bbox.js';
import { buildLockup, buildLockupSvg, measureWordmark, normalizeMarkSvg } from './svg.js';
import {
  applyInspector,
  describeChanges,
  diffInspector,
  firstUndone,
  formatChanges,
  lastApplied,
  markEdit,
  newEdit,
  parseInstruction,
  pushEdit,
  readInspector,
  reapplyEdit,
  revertEdit,
} from './inspector.js';
import type { LogoSpec } from './types.js';

const SPEC: LogoSpec = {
  palette: [
    { role: 'Primary', name: 'Forest', hex: '#2E9E58' },
    { role: 'Ink', name: 'Graphite', hex: '#0E0E0C' },
    { role: 'Background', name: 'Paper', hex: '#FFFFFF' },
  ],
  fonts: { heading: "'Inter Tight', sans-serif", body: "'Inter Tight', sans-serif" },
  geometry: 'ridge',
  rationale: 'x',
  elements: ['mark', 'dot'],
};

const MARK = normalizeMarkSvg(
  '<svg viewBox="0 0 100 100"><g id="mark">' +
    '<path stroke="currentColor" stroke-width="7" d="M15 80 L50 20 L85 80"/>' +
    '<g id="dot"><circle stroke="currentColor" stroke-width="7" cx="50" cy="80" r="6"/></g>' +
    '</g></svg>',
);

const viewBoxOfSvg = (svg: string): [number, number] => {
  const p = svg.match(/viewBox="([^"]+)"/)?.[1].split(/\s+/).map(Number) ?? [];
  return [p[2] ?? 0, p[3] ?? 0];
};

const OUTLINE = measureWordmark('Meridian', SPEC) as WordmarkOutline;

const compose = (slot: LockupSlot, adjust: Partial<MarkAdjust> = {}) =>
  layoutLockup({
    mark: MARK,
    outline: OUTLINE,
    slot,
    adjust: { ...DEFAULT_ADJUST, ...adjust },
    palette: SPEC.palette,
  });

describe('the mark can never exceed its own boundary', () => {
  /**
   * The editor's boundary is the lockup's box plus its clearspace. That only
   * holds if the box itself always contains the artwork — the reported bug was a
   * scaled-up mark spilling out of a frame that had been assumed square.
   */
  it.each([0.4, 0.75, 1, 1.4, 2])('keeps the ink inside the viewBox at scale %s', (scale) => {
    for (const slot of ['primary', 'stacked', 'mark', 'wordmark'] as LockupSlot[]) {
      const { svg, width, height } = compose(slot, { scale });
      const box = inkBounds(svg);
      expect(box, `${slot} @ ${scale} is measurable`).not.toBeNull();
      expect(box!.minX).toBeGreaterThanOrEqual(-0.01);
      expect(box!.minY).toBeGreaterThanOrEqual(-0.01);
      expect(box!.maxX).toBeLessThanOrEqual(width + 0.01);
      expect(box!.maxY).toBeLessThanOrEqual(height + 0.01);
    }
  });

  it('grows the lockup box in step with the mark, rather than overflowing it', () => {
    const small = compose('primary', { scale: 0.5 });
    const big = compose('primary', { scale: 1.8 });
    expect(big.height).toBeGreaterThan(small.height);
    expect(big.width).toBeGreaterThan(small.width);
  });
});

describe('lockupFrame — the editor boundary', () => {
  it('is square for the mark but not for a lockup carrying a wordmark', () => {
    const mark = compose('mark');
    const markFrame = lockupFrame(mark, DEFAULT_ADJUST);
    expect(markFrame.width).toBeCloseTo(markFrame.height, 5);

    const primary = compose('primary');
    const frame = lockupFrame(primary, DEFAULT_ADJUST);
    // A horizontal lockup is wide; forcing it square is what cropped the guide.
    expect(frame.width / frame.height).toBeGreaterThan(1.5);
  });

  it('goes tall for the stacked lockup, and portrait when the name is short', () => {
    // Same mark, same wordmark — stacking trades width for height.
    const wide = lockupFrame(compose('primary'), DEFAULT_ADJUST);
    const tall = lockupFrame(compose('stacked'), DEFAULT_ADJUST);
    expect(tall.height).toBeGreaterThan(wide.height);
    expect(tall.width).toBeLessThan(wide.width);

    // A long name still out-measures the mark, so only a short one is portrait.
    const short = lockupFrame(
      layoutLockup({
        mark: MARK,
        outline: measureWordmark('Ki', SPEC),
        slot: 'stacked',
        adjust: DEFAULT_ADJUST,
        palette: SPEC.palette,
      }),
      DEFAULT_ADJUST,
    );
    expect(short.height).toBeGreaterThan(short.width);
  });

  it('always contains the lockup, and grows with clearspace', () => {
    const layout = compose('primary');
    const tight = lockupFrame(layout, { ...DEFAULT_ADJUST, clearspace: 0.25 });
    const loose = lockupFrame(layout, { ...DEFAULT_ADJUST, clearspace: 3 });
    expect(tight.width).toBeGreaterThanOrEqual(layout.width);
    expect(loose.width).toBeGreaterThan(tight.width);
    expect(loose.height).toBeGreaterThan(tight.height);
    expect(loose.pad).toBeCloseTo(layout.capUnit * 3, 5);
  });
});

describe('the wordmark gap is a real control', () => {
  it('narrows the horizontal lockup as the gap closes', () => {
    const wide = compose('primary', { gap: 2 });
    const tight = compose('primary', { gap: 0 });
    expect(tight.width).toBeLessThan(wide.width);
    // Only the gap moved, so the height (mark + type band) is untouched.
    expect(tight.height).toBeCloseTo(wide.height, 5);
  });

  it('closes the space under the mark in the stacked lockup', () => {
    expect(compose('stacked', { gap: 0 }).height).toBeLessThan(
      compose('stacked', { gap: 2 }).height,
    );
  });

  it('defaults to the designed spacing for specs written before it existed', () => {
    const legacy = buildLockupSvg({
      mark: MARK,
      wordmark: 'Meridian',
      // A pre-gap spec: no `gap` key at all.
      spec: { ...SPEC, adjust: { scale: 1, strokeWidth: null, clearspace: 1, hidden: [] } },
      slot: 'primary',
    });
    expect(viewBoxOfSvg(legacy)[0]).toBeCloseTo(compose('primary', { gap: 1 }).width, 1);
  });
});

describe('every lockup owns its colour contract', () => {
  it('keeps primary, stacked and mono in ink so colour stays a decision', () => {
    for (const slot of ['primary', 'stacked', 'mono'] as LockupSlot[]) {
      expect(toneColor(slot, SPEC.palette)).toEqual({ ink: '#0E0E0C', ground: null });
    }
  });

  it('reverses white out of ink', () => {
    expect(toneColor('reversed', SPEC.palette)).toEqual({ ink: '#FFFFFF', ground: '#0E0E0C' });
  });

  it('paints the coloured lockup in the brand colour, uncommitted', () => {
    // `committed` is deliberately not passed: this slot exists to show colour.
    expect(toneColor('color', SPEC.palette).ink).toBe('#2E9E58');
    expect(compose('color').svg).toContain('color:#2E9E58');
  });

  it('knocks the coloured-reversed lockup out of the brand colour, legibly', () => {
    const tone = toneColor('colorReversed', SPEC.palette);
    expect(tone.ground).toBe('#2E9E58');
    // Forest is dark, so the mark has to read in paper-white on top of it.
    expect(tone.ink).toBe('#FFFFFF');
    expect(compose('colorReversed').svg).toContain('fill="#2E9E58"');
  });

  it('picks ink over paper on a light brand colour', () => {
    const light = [{ role: 'Primary', name: 'Butter', hex: '#F7E9A0' }];
    expect(toneColor('colorReversed', light).ink).toBe('#0E0E0C');
  });
});

describe('buildLockup — the server seam matches the pure composer', () => {
  it('returns the same markup and the geometry the editor frames with', () => {
    const built = buildLockup({ mark: MARK, wordmark: 'Meridian', spec: SPEC, slot: 'primary' });
    const pure = compose('primary');
    expect(built.svg).toBe(pure.svg);
    expect(built.width).toBeCloseTo(pure.width, 6);
    expect(built.capUnit).toBeCloseTo(pure.capUnit, 6);
  });
});

/* ── the inspector ───────────────────────────────────────────────────────── */

/*
  The weight control is one slider for the whole mark, and it works by stripping
  every per-element width so the group's inherited one governs. Anything it fails
  to strip is a part that stops following the slider — which is what "the dot the
  copilot added doesn't change with the stroke weight" looks like.
*/
describe('applyMarkAdjust — the global weight beats every local one', () => {
  const heavier = { ...DEFAULT_ADJUST, strokeWidth: 12 };

  it('strips a stroke-width attribute', () => {
    const out = applyMarkAdjust(
      '<svg viewBox="0 0 100 100"><g id="mark"><circle stroke-width="3" r="6"/></g></svg>',
      heavier,
    );
    expect(out).not.toMatch(/stroke-width/i);
  });

  it('strips stroke-width out of a style attribute, which outranks the attribute', () => {
    const out = applyMarkAdjust(
      '<svg viewBox="0 0 100 100"><g id="mark">' +
        '<circle style="stroke-width:3;stroke-linecap:round" r="6"/></g></svg>',
      heavier,
    );
    expect(out).not.toMatch(/stroke-width/i);
    // The rest of the declaration is not collateral.
    expect(out).toContain('stroke-linecap:round');
  });

  it('drops a style attribute that held nothing else', () => {
    const out = applyMarkAdjust(
      '<svg viewBox="0 0 100 100"><g id="mark"><circle style="stroke-width:3" r="6"/></g></svg>',
      heavier,
    );
    expect(out).not.toMatch(/style=/i);
  });

  it('leaves an unrelated attribute ending in "style" alone', () => {
    const out = applyMarkAdjust(
      '<svg viewBox="0 0 100 100"><g id="mark"><text font-style="italic">x</text></g></svg>',
      heavier,
    );
    expect(out).toContain('font-style="italic"');
  });

  it('leaves local widths in place when the control is "as drawn"', () => {
    const svg = '<svg viewBox="0 0 100 100"><g id="mark"><circle stroke-width="3" r="6"/></g></svg>';
    expect(applyMarkAdjust(svg, DEFAULT_ADJUST)).toBe(svg);
  });
});

describe('inspector settings', () => {
  it('reads a spec into named settings and writes them back', () => {
    const before = readInspector(SPEC);
    expect(before).toMatchObject({ scale: 1, strokeWidth: null, gap: 1, clearspace: 1 });
    expect(before.typeface).toBe('inter-tight');
    expect(before.color).toBe('#2E9E58');

    const spec = applyInspector(SPEC, { scale: 1.2, typeface: 'instrument-serif', color: '#123456' });
    const after = readInspector(spec);
    expect(after.scale).toBe(1.2);
    expect(after.typeface).toBe('instrument-serif');
    expect(after.color).toBe('#123456');
    // Writing the colour updates the palette's Primary, not a parallel field.
    expect(spec.palette.find((c) => c.role === 'Primary')?.hex).toBe('#123456');
  });

  it('clamps rather than rejects, so a wild model patch still lands usefully', () => {
    const s = readInspector(applyInspector(SPEC, { scale: 40, gap: -5, clearspace: 99 }));
    expect(s.scale).toBe(2);
    expect(s.gap).toBe(0);
    expect(s.clearspace).toBe(3);
  });

  it('ignores values it does not recognise', () => {
    const s = readInspector(
      applyInspector(SPEC, {
        color: 'rebeccapurple' as string,
        typeface: 'comic-sans' as never,
      }),
    );
    expect(s.color).toBe('#2E9E58');
    expect(s.typeface).toBe('inter-tight');
  });
});

describe('the change journal is what makes undo possible', () => {
  const before = readInspector(SPEC);
  const afterSpec = applyInspector(SPEC, { scale: 1.2 });
  const after = readInspector(afterSpec);

  it('reports every field that moved, with its before AND after', () => {
    const changes = diffInspector(before, after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ field: 'scale', label: 'Mark scale', from: 1, to: 1.2 });
    expect(describeChanges(changes)).toBe('Mark scale 100% → 120%');
  });

  it('renders the before/after for the client and the copilot to quote', () => {
    const [c] = formatChanges(diffInspector(before, after));
    expect(c.fromText).toBe('100%');
    expect(c.toText).toBe('120%');
  });

  it('reports nothing when nothing moved', () => {
    expect(diffInspector(before, before)).toEqual([]);
  });

  it('undo restores the previous value, redo puts it back', () => {
    const edit = newEdit(diffInspector(before, after), 'user');
    const reverted = readInspector(revertEdit(afterSpec, edit));
    expect(reverted.scale).toBe(1);
    expect(readInspector(reapplyEdit(revertEdit(afterSpec, edit), edit)).scale).toBe(1.2);
  });

  it('walks the journal in order', () => {
    const a = newEdit([{ field: 'scale', label: 'Mark scale', from: 1, to: 1.2 }], 'user');
    const b = newEdit([{ field: 'gap', label: 'Gap', from: 1, to: 0.5 }], 'agent');
    const journal = [a, b];
    expect(lastApplied(journal)?.id).toBe(b.id);
    expect(firstUndone(journal)).toBeNull();

    const stepped = markEdit(journal, b.id, true);
    expect(lastApplied(stepped)?.id).toBe(a.id);
    expect(firstUndone(stepped)?.id).toBe(b.id);
  });
});

describe('pushEdit', () => {
  const at = (ms: number) => new Date(1_700_000_000_000 + ms);
  const scaleEdit = (from: number, to: number, ms: number, source: 'user' | 'agent' = 'user') =>
    newEdit([{ field: 'scale', label: 'Mark scale', from, to }], source, at(ms));

  it('merges repeated nudges of one control into a single undo step', () => {
    let journal = pushEdit([], scaleEdit(1, 1.05, 0));
    journal = pushEdit(journal, scaleEdit(1.05, 1.1, 1_000));
    journal = pushEdit(journal, scaleEdit(1.1, 1.2, 2_000));
    expect(journal).toHaveLength(1);
    // One undo returns to where the drag started, not one hair back.
    expect(journal[0].changes[0]).toMatchObject({ from: 1, to: 1.2 });
    expect(journal[0].label).toBe('Mark scale 100% → 120%');
  });

  it('drops a merge that lands back on its own starting value', () => {
    let journal = pushEdit([], scaleEdit(1, 1.3, 0));
    journal = pushEdit(journal, scaleEdit(1.3, 1, 500));
    expect(journal).toEqual([]);
  });

  it('keeps separate entries once the window has passed', () => {
    let journal = pushEdit([], scaleEdit(1, 1.1, 0));
    journal = pushEdit(journal, scaleEdit(1.1, 1.2, 60_000));
    expect(journal).toHaveLength(2);
  });

  it('never merges the user’s edit into the agent’s', () => {
    let journal = pushEdit([], scaleEdit(1, 1.1, 0, 'agent'));
    journal = pushEdit(journal, scaleEdit(1.1, 1.2, 500, 'user'));
    expect(journal).toHaveLength(2);
  });

  it('drops undone entries, so redo cannot resurrect an overwritten value', () => {
    const first = scaleEdit(1, 1.5, 0);
    const journal = pushEdit(markEdit([first], first.id, true), scaleEdit(1, 1.2, 90_000));
    expect(journal).toHaveLength(1);
    expect(journal[0].changes[0].to).toBe(1.2);
  });
});

describe('parseInstruction — the copilot still answers with AI switched off', () => {
  const current = readInspector(SPEC);

  it('tightens the gap', () => {
    const r = parseInstruction('tighten the gap a bit', current, SPEC.elements);
    expect(r.handled).toBe(true);
    expect(r.patch.gap).toBeLessThan(1);
    expect(r.fallback).toBe(true);
  });

  it('scales the mark up, proportionally to how much was asked for', () => {
    const some = parseInstruction('make the mark bigger', current, SPEC.elements);
    const lots = parseInstruction('make the mark a lot bigger', current, SPEC.elements);
    expect(some.patch.scale).toBeGreaterThan(1);
    expect(lots.patch.scale).toBeGreaterThan(some.patch.scale!);
  });

  it('reads a typeface request', () => {
    expect(parseInstruction('set it in the serif', current, SPEC.elements).patch.typeface).toBe(
      'instrument-serif',
    );
    // "sans-serif" must not be mistaken for the serif.
    expect(parseInstruction('use a sans-serif', current, SPEC.elements).patch.typeface).toBe(
      'inter-tight',
    );
  });

  it('takes a bolder stroke off the as-drawn baseline', () => {
    const r = parseInstruction('make it bolder', current, SPEC.elements);
    expect(r.patch.strokeWidth).toBeGreaterThan(6);
  });

  it('hides a named element, and only a real one', () => {
    expect(parseInstruction('hide the dot', current, SPEC.elements).patch.hidden).toEqual(['dot']);
    expect(parseInstruction('hide the sparkle', current, SPEC.elements).handled).toBe(false);
  });

  it('declines anything that is really a redraw, so the engine gets it', () => {
    expect(parseInstruction('try it as a monogram', current, SPEC.elements).handled).toBe(false);
    expect(parseInstruction('make it feel more premium', current, SPEC.elements).handled).toBe(
      false,
    );
  });

  /*
    The word matching is greedy on purpose, which is exactly what makes it
    dangerous here: every one of these sentences contains a control word, and
    every one of them is asking for a different mark. Claiming the control word
    would leave the artwork the user wanted replaced still on screen.
  */
  it('does not claim a control word out of a sentence asking for new artwork', () => {
    for (const instruction of [
      'redraw it with thicker, hand-drawn lines',
      'start over with something less busy',
      'turn it into a mountain, a bit bolder',
      'give me a different mark, tighter this time',
      'show me another direction with more space',
    ]) {
      expect(parseInstruction(instruction, current, SPEC.elements).handled).toBe(false);
    }
  });

  it('still answers settings phrased with "instead", which is not a redraw', () => {
    expect(parseInstruction('use the serif instead', current, SPEC.elements).patch.typeface).toBe(
      'instrument-serif',
    );
  });
});
