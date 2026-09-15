/**
 * High-level generation orchestration. Owns provider selection, the graceful
 * fallback to the deterministic engine (no AI key / unusable output), and the
 * derived operations (brand-system + uniqueness) built on the one-shot helper.
 * Callers (routers/logo.ts, the AI iterate tool) go through here, never the
 * adapter directly.
 */
import { completeOnce } from '../ai/provider-config.js';
import { isAiEnabled } from '../ai/client.js';
import { SYSTEM_DERIVE_SYSTEM, briefSentence, personalityWords } from './prompts.js';
import { fallbackConcepts, fallbackIterate } from './fallback.js';
import { createClaudeProvider, type AiCallCtx } from './providers/claude.js';
import { resolveAdjust } from './layout.js';
import { extractElementIds, orderedPalette } from './svg.js';
import type { GeneratedConcept, LogoBrief, LogoColor, LogoProvider } from './types.js';

/** Which adapter backs generation. Only `claude` is implemented today. */
export type LogoProviderName = 'claude' | 'recraft';

export function getLogoProvider(name: LogoProviderName, ctx: AiCallCtx): LogoProvider {
  switch (name) {
    case 'claude':
    default:
      return createClaudeProvider(ctx);
  }
}

/** Tolerant JSON parse (mirrors the adapter's). */
function parseJSON<T>(text: string, fallback: T): T {
  try {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return JSON.parse(m ? m[0] : text) as T;
  } catch {
    return fallback;
  }
}

export interface GenerateResult {
  concepts: GeneratedConcept[];
  provider: string;
  /** True when we fell back to the deterministic engine (no AI / bad output). */
  fallback: boolean;
}

/**
 * Generate `count` concepts. Tries the configured provider; tops up from — or
 * falls back entirely to — the deterministic engine so the studio always returns
 * a full, valid contact sheet.
 */
export async function generateConcepts(
  ctx: AiCallCtx,
  brief: LogoBrief,
  count: number,
  opts: {
    offset?: number;
    avoid?: string[];
    provider?: LogoProviderName;
    styleLock?: { descriptors: string[]; palette?: LogoColor[] } | null;
  } = {},
): Promise<GenerateResult> {
  const offset = opts.offset ?? 0;
  if (!isAiEnabled()) {
    return { concepts: fallbackConcepts(brief, count, offset), provider: 'fallback', fallback: true };
  }
  try {
    const provider = getLogoProvider(opts.provider ?? 'claude', ctx);
    const generated = await provider.generateConcepts({
      brief,
      count,
      avoid: opts.avoid,
      styleLock: opts.styleLock ?? null,
    });
    if (generated.length >= count) {
      return { concepts: generated.slice(0, count), provider: provider.name, fallback: false };
    }
    // Partial success — top up with deterministic concepts so the sheet is full.
    const top = fallbackConcepts(brief, count - generated.length, offset + generated.length);
    return {
      concepts: [...generated, ...top],
      provider: provider.name,
      fallback: generated.length === 0,
    };
  } catch {
    return { concepts: fallbackConcepts(brief, count, offset), provider: 'fallback', fallback: true };
  }
}

/**
 * Merge freshly drawn artwork into the mark the user has been tuning.
 *
 * A redraw changes the DRAWING; it must not change the configuration. The
 * typeface, the committed palette, and every inspector adjustment — scale,
 * stroke weight, gap, clearspace, wordmark weight, hidden elements — belong to
 * the version on screen, not to the engine. Left alone, an adapter re-emits its
 * own `fonts` and `palette` on every iteration and carries no `adjust` at all,
 * so asking for a different MARK silently returns a different TYPEFACE, a
 * different colour, and every slider back at its default. Only the geometry,
 * the description, and the element ids come from the new drawing.
 *
 * Provider-agnostic on purpose: this is the studio's guarantee, not one
 * adapter's good behaviour, so a future vector-gen adapter inherits it too.
 */
export function carryConfiguration(
  current: GeneratedConcept,
  drawn: GeneratedConcept,
): GeneratedConcept {
  const elements = extractElementIds(drawn.svg);
  const adjust = resolveAdjust(current.spec.adjust);
  return {
    ...drawn,
    spec: {
      ...current.spec,
      geometry: drawn.spec.geometry || current.spec.geometry,
      rationale: drawn.spec.rationale || current.spec.rationale,
      elements,
      // A hidden id the new artwork doesn't contain is a control the inspector
      // would still list with nothing behind it.
      adjust: { ...adjust, hidden: adjust.hidden.filter((id) => elements.includes(id)) },
    },
  };
}

export type IterateResult =
  | { declined: false; concept: GeneratedConcept; provider: string; fallback: boolean }
  /** The instruction was an inspector setting — no version was drawn. */
  | { declined: true; reason: string };

/**
 * Refine one mark with a plain-language instruction.
 *
 * The engine is allowed to refuse: an instruction that only moves an inspector
 * control (size, weight, spacing, typeface, colour, hiding an element) comes
 * back as `declined` rather than as a new version, because redrawing would cost
 * the user the mark they chose to fix something a slider already does. Callers
 * must handle that — see routers/logo.ts `studio.command`, which hands a
 * declined instruction to the deterministic settings parser instead.
 */
export async function iterateConcept(
  ctx: AiCallCtx,
  brief: LogoBrief,
  current: GeneratedConcept,
  instruction: string,
  currentIndex = 0,
): Promise<IterateResult> {
  const deterministic = (): IterateResult => ({
    declined: false,
    concept: carryConfiguration(current, fallbackIterate(brief, currentIndex)),
    provider: 'fallback',
    fallback: true,
  });
  if (!isAiEnabled()) return deterministic();
  try {
    const provider = getLogoProvider('claude', ctx);
    const outcome = await provider.iterate({ brief, current, instruction });
    if ('declined' in outcome) return { declined: true, reason: outcome.reason };
    return {
      declined: false,
      concept: carryConfiguration(current, outcome),
      provider: provider.name,
      fallback: false,
    };
  } catch {
    return deterministic();
  }
}

export interface DerivedSystem {
  palette: LogoColor[];
  fonts: { heading: string; body: string; mono: string };
  rationale: string;
}

/**
 * Derive a full brand colour system + type hierarchy from a chosen mark. Used to
 * seed `brands.colors` / `brands.typography` (the suite-inheritance moat). Falls
 * back to the mark's own palette when AI is unavailable.
 */
export async function deriveBrandSystem(
  ctx: AiCallCtx,
  brief: LogoBrief,
  concept: GeneratedConcept,
): Promise<DerivedSystem> {
  const base = orderedPalette(concept.spec.palette);
  const fallback: DerivedSystem = {
    palette: [
      { role: 'Primary', name: 'Primary', hex: base.primary },
      { role: 'Accent', name: 'Accent', hex: base.accent },
      { role: 'Ink', name: 'Ink', hex: base.ink },
      { role: 'Background', name: 'Background', hex: base.background },
      { role: 'Rule', name: 'Rule', hex: base.rule },
    ],
    fonts: {
      heading: concept.spec.fonts.heading,
      body: concept.spec.fonts.body,
      mono: concept.spec.fonts.mono ?? "'JetBrains Mono', ui-monospace, monospace",
    },
    rationale: `Derived from the ${concept.name} mark.`,
  };
  if (!isAiEnabled()) return fallback;
  try {
    const text = await completeOnce({
      db: ctx.db,
      source: 'logo_system',
      system: SYSTEM_DERIVE_SYSTEM,
      prompt:
        `Brand: ${brief.businessName} — ${personalityWords(brief).join(', ')}.\n` +
        `Chosen mark: ${concept.name} (${concept.spec.geometry}).\n` +
        `Mark palette: ${concept.spec.palette.map((c) => `${c.role} ${c.hex}`).join(', ')}.`,
      maxTokens: 700,
      brandId: ctx.brandId,
      userId: ctx.userId ?? null,
      client: ctx.client ?? null,
    });
    const raw = parseJSON<Partial<DerivedSystem>>(text, {});
    const palette = Array.isArray(raw.palette) && raw.palette.length >= 3 ? raw.palette : fallback.palette;
    return {
      palette,
      fonts: {
        heading: raw.fonts?.heading || fallback.fonts.heading,
        body: raw.fonts?.body || fallback.fonts.body,
        mono: raw.fonts?.mono || fallback.fonts.mono,
      },
      rationale: raw.rationale || fallback.rationale,
    };
  } catch {
    return fallback;
  }
}

/**
 * Score how distinctive a mark is (0–100). A cheap heuristic on the SVG's
 * structural complexity + palette, refined by the model when available. Answers
 * the market's #1 complaint (sameness) openly. Deterministic without AI.
 */
export async function scoreUniqueness(
  ctx: AiCallCtx,
  brief: LogoBrief,
  concept: GeneratedConcept,
): Promise<number> {
  const heuristic = heuristicUniqueness(concept);
  if (!isAiEnabled()) return heuristic;
  try {
    const text = await completeOnce({
      db: ctx.db,
      source: 'logo_uniqueness',
      system:
        'You judge logo distinctiveness for a brand-identity studio. Given a mark description, ' +
        'rate 0–100 how far it sits from generic, commonly-seen marks in its category (higher = more original). ' +
        'Return ONLY JSON: {"score":<int 0-100>}.',
      prompt:
        `Industry: ${brief.industry ?? 'general'}. Mark: ${concept.name} — ${concept.spec.geometry}. ` +
        `Kind: ${concept.kind}.`,
      maxTokens: 60,
      brandId: ctx.brandId,
      userId: ctx.userId ?? null,
      client: ctx.client ?? null,
    });
    const raw = parseJSON<{ score?: number }>(text, {});
    const score = Math.round(Number(raw.score));
    if (Number.isFinite(score) && score >= 0 && score <= 100) return score;
    return heuristic;
  } catch {
    return heuristic;
  }
}

/** Structural-complexity heuristic → 62–96. More distinct construction scores higher. */
export function heuristicUniqueness(concept: GeneratedConcept): number {
  const paths = (concept.svg.match(/<path\b/gi) ?? []).length;
  const shapes = (concept.svg.match(/<(circle|rect|polygon|polyline|ellipse|line)\b/gi) ?? []).length;
  const complexity = Math.min(10, paths * 2 + shapes);
  const kindBonus = concept.kind === 'combination' ? 6 : concept.kind === 'geometric' ? 4 : 2;
  return Math.max(62, Math.min(96, 66 + complexity * 2 + kindBonus));
}

export { briefSentence };
