/**
 * The copilot's redraw triage.
 *
 * A redraw is the expensive answer — it discards the mark the user chose — so
 * these cover the one thing that must not regress: only an explicit redraw
 * signal gets one. Everything else has to try the settings first.
 *
 * `completeOnce` is mocked rather than called; the point here is the routing
 * around the model, not the model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeOnce = vi.fn();
vi.mock('../ai/provider-config.js', () => ({ completeOnce: (...a: unknown[]) => completeOnce(...a) }));
vi.mock('../ai/client.js', () => ({ isAiEnabled: () => true }));

const { interpretInstruction } = await import('./inspector-command.js');
const { readInspector } = await import('./inspector.js');
const { createClaudeProvider } = await import('./providers/claude.js');
const { carryConfiguration } = await import('./generation.js');
import type { AiCallCtx } from './providers/claude.js';
import type { GeneratedConcept, LogoBrief, LogoSpec } from './types.js';

const BRIEF: LogoBrief = {
  businessName: 'Meridian',
  keywords: [],
  personality: { classicModern: 2, seriousPlayful: 2, minimalExpressive: 2, geometricOrganic: 2 },
  markType: 'geometric',
  monochromeFirst: true,
};

const SPEC: LogoSpec = {
  palette: [{ role: 'Primary', name: 'Forest', hex: '#2E9E58' }],
  fonts: { heading: "'Inter Tight', sans-serif", body: "'Inter Tight', sans-serif" },
  geometry: 'ridge',
  rationale: 'x',
  elements: ['mark', 'dot'],
};

const CTX = { db: {}, brandId: 'b1' } as unknown as AiCallCtx;
const CURRENT = readInspector(SPEC);
const ELEMENTS = SPEC.elements ?? [];

const run = (instruction: string) =>
  interpretInstruction(CTX, { instruction, current: CURRENT, elements: ELEMENTS });

beforeEach(() => completeOnce.mockReset());

describe('interpretInstruction — settings before redraw', () => {
  it('applies the model’s patch when it handles the instruction', async () => {
    completeOnce.mockResolvedValue(
      JSON.stringify({ handled: true, patch: { gap: 0.8 }, reply: 'Tightened the gap.' }),
    );
    const r = await run('tighten the gap');
    expect(r.handled).toBe(true);
    expect(r.patch.gap).toBe(0.8);
    expect(r.fallback).toBe(false);
  });

  it('lets an explicit redraw through — new artwork is genuinely wanted', async () => {
    completeOnce.mockResolvedValue(JSON.stringify({ handled: false, redraw: true }));
    expect((await run('make it a leaf instead')).handled).toBe(false);
  });

  it('does NOT redraw on a bare decline — the parser gets a second chance', async () => {
    completeOnce.mockResolvedValue(JSON.stringify({ handled: false }));
    const r = await run('make the mark bigger');
    expect(r.handled).toBe(true);
    expect(r.patch.scale).toBeGreaterThan(CURRENT.scale);
    expect(r.fallback).toBe(true);
  });

  it('rescues a handled reply whose patch was entirely invented', async () => {
    completeOnce.mockResolvedValue(
      JSON.stringify({ handled: true, patch: { cornerRadius: 4 }, reply: 'Rounded it.' }),
    );
    const r = await run('make it bolder');
    expect(r.handled).toBe(true);
    expect(r.patch.strokeWidth).toBeGreaterThan(0);
  });

  it('still redraws when neither the model nor the parser finds a setting', async () => {
    completeOnce.mockResolvedValue(JSON.stringify({ handled: false }));
    expect((await run('try it as a monogram')).handled).toBe(false);
  });

  it('falls back to the parser when the reply is not JSON at all', async () => {
    completeOnce.mockResolvedValue('Sorry, I would rather not.');
    const r = await run('a bit more clearspace');
    expect(r.handled).toBe(true);
    expect(r.patch.clearspace).toBeGreaterThan(CURRENT.clearspace);
  });
});

/*
  The other half of the routing: what the DRAWING engine does when the triage
  above sends it a settings change by mistake. It must refuse rather than draw,
  or the user loses the mark they chose to something a slider does.
*/
describe('claude adapter — iterate declines an inspector setting', () => {
  const CONCEPT: GeneratedConcept = {
    name: 'Ridge',
    kind: 'geometric',
    note: 'peak',
    svg: '<svg viewBox="0 0 100 100"><g id="mark"><path stroke="currentColor" stroke-width="7" d="M15 80 L50 20 L85 80"/></g></svg>',
    spec: SPEC,
  };

  const iterate = async (instruction: string) =>
    createClaudeProvider(CTX).iterate({ brief: BRIEF, current: CONCEPT, instruction });

  it('returns the refusal, not a redrawn mark', async () => {
    completeOnce.mockResolvedValue(
      JSON.stringify({ redraw: false, setting: 'stroke weight', reply: 'That is the stroke weight.' }),
    );
    const r = await iterate('make it bolder');
    expect('declined' in r).toBe(true);
    expect(r).toMatchObject({ declined: true, reason: 'That is the stroke weight.' });
  });

  it('falls back to naming the control when the refusal carries no sentence', async () => {
    completeOnce.mockResolvedValue(JSON.stringify({ redraw: false, setting: 'clearspace' }));
    expect(await iterate('give it more room')).toMatchObject({
      declined: true,
      reason: 'clearspace',
    });
  });

  it('still draws when the instruction genuinely needs new shapes', async () => {
    completeOnce.mockResolvedValue(
      JSON.stringify({
        redraw: true,
        name: 'Leaf',
        kind: 'geometric',
        note: 'a leaf',
        geometry: 'one stroke',
        rationale: 'organic',
        svg: '<svg viewBox="0 0 100 100"><g id="mark"><circle stroke="currentColor" stroke-width="7" cx="50" cy="50" r="30"/></g></svg>',
        palette: SPEC.palette,
        fonts: SPEC.fonts,
      }),
    );
    const r = await iterate('make it a leaf');
    expect('declined' in r).toBe(false);
    expect((r as GeneratedConcept).name).toBe('Leaf');
  });

  it('keeps the current mark when the model returns junk — never a broken SVG', async () => {
    completeOnce.mockResolvedValue('not json');
    expect(await iterate('make it a leaf')).toBe(CONCEPT);
  });
});

/*
  A redraw changes the drawing, not the configuration. This is the guarantee
  behind "I asked for a different logo and it changed my typeface too": the
  adapter mints a whole new spec every time, so without this merge the mark's
  face, colours and every slider quietly reset on each iteration.
*/
describe('carryConfiguration — a redraw does not reconfigure the mark', () => {
  const TUNED: GeneratedConcept = {
    name: 'Ridge',
    kind: 'geometric',
    note: 'peak',
    svg: '<svg viewBox="0 0 100 100"><g id="mark"><g id="dot"/></g></svg>',
    spec: {
      ...SPEC,
      fonts: { heading: "'Fraunces', serif", body: "'Fraunces', serif" },
      adjust: {
        scale: 1.4,
        strokeWidth: 9,
        gap: 0.6,
        clearspace: 2,
        hidden: ['dot'],
        wordmarkWeight: 600,
      },
    },
  };

  /** What an adapter hands back: new artwork, and a spec of its own invention. */
  const DRAWN: GeneratedConcept = {
    name: 'Leaf',
    kind: 'geometric',
    note: 'a leaf',
    svg: '<svg viewBox="0 0 100 100"><g id="mark"><g id="dot"/><g id="stem"/></g></svg>',
    spec: {
      palette: [{ role: 'Primary', name: 'Cobalt', hex: '#1D4ED8' }],
      fonts: { heading: "'Inter Tight', sans-serif", body: "'Inter Tight', sans-serif" },
      geometry: 'one continuous stroke',
      rationale: 'organic',
      elements: ['mark'],
    },
  };

  const merged = carryConfiguration(TUNED, DRAWN);

  it('takes the new artwork', () => {
    expect(merged.svg).toBe(DRAWN.svg);
    expect(merged.name).toBe('Leaf');
    expect(merged.spec.geometry).toBe('one continuous stroke');
  });

  it('keeps the typeface and the palette the brand already chose', () => {
    expect(merged.spec.fonts.heading).toBe("'Fraunces', serif");
    expect(merged.spec.palette).toEqual(TUNED.spec.palette);
  });

  it('keeps every inspector adjustment', () => {
    expect(merged.spec.adjust).toMatchObject({
      scale: 1.4,
      strokeWidth: 9,
      gap: 0.6,
      clearspace: 2,
      wordmarkWeight: 600,
    });
  });

  it('relists the hideable parts from the new drawing', () => {
    expect(merged.spec.elements).toEqual(['mark', 'dot', 'stem']);
    // 'dot' survived the redraw, so it stays hidden.
    expect(merged.spec.adjust?.hidden).toEqual(['dot']);
  });

  it('drops a hidden id the new drawing no longer has', () => {
    const gone = carryConfiguration(TUNED, {
      ...DRAWN,
      svg: '<svg viewBox="0 0 100 100"><g id="mark"/></svg>',
    });
    expect(gone.spec.adjust?.hidden).toEqual([]);
  });
});
