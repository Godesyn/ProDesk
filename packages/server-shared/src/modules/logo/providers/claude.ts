/**
 * The default generation provider: Claude-native SVG via the shared one-shot
 * helper (`completeOnce`). Outputs editable vectors + spec, records spend, and is
 * addressed only through the `LogoProvider` interface — a vector-gen API (Recraft
 * V4, an image model) can be added as a sibling adapter with no call-site change.
 */
import { completeOnce } from '../../ai/provider-config.js';
import type { AiUsageSource } from '../../ai/usage.js';
import type { DB } from '../../../db/index.js';
import type { NeutralMessage } from '../../ai/providers/types.js';
import {
  CONCEPT_SYSTEM,
  ITERATE_SYSTEM,
  conceptUserPrompt,
  iterateUserPrompt,
} from '../prompts.js';
import { extractElementIds, isValidMarkSvg, normalizeMarkSvg } from '../svg.js';
import type {
  GeneratedConcept,
  IterateOutcome,
  LogoColor,
  LogoProvider,
  MarkKind,
} from '../types.js';

export interface AiCallCtx {
  db: DB;
  brandId: string;
  userId?: string | null;
  client?: string | null;
}

/** Tolerant JSON extraction — pull the first {...} / [...] block from the reply. */
function parseJSON<T>(text: string, fallback: T): T {
  try {
    const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    return JSON.parse(m ? m[0] : text) as T;
  } catch {
    return fallback;
  }
}

const KINDS = new Set<MarkKind>(['monogram', 'geometric', 'combination', 'wordmark']);
function coerceKind(k: unknown, fallback: MarkKind): MarkKind {
  return typeof k === 'string' && KINDS.has(k as MarkKind) ? (k as MarkKind) : fallback;
}

interface RawConcept {
  name?: string;
  kind?: string;
  note?: string;
  geometry?: string;
  rationale?: string;
  svg?: string;
  palette?: LogoColor[];
  fonts?: { heading?: string; body?: string; mono?: string };
}

/** Map one raw model concept → a validated GeneratedConcept, or null if unusable. */
function toConcept(raw: RawConcept, fallbackKind: MarkKind): GeneratedConcept | null {
  const svg = normalizeMarkSvg(String(raw?.svg ?? ''));
  if (!svg || !isValidMarkSvg(svg)) return null;
  const palette: LogoColor[] = Array.isArray(raw.palette) && raw.palette.length
    ? raw.palette
        .filter((c) => c && typeof c.hex === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.hex))
        .map((c) => ({ role: String(c.role ?? 'Colour'), name: String(c.name ?? c.hex), hex: c.hex }))
    : [];
  return {
    name: String(raw.name ?? 'Untitled mark').slice(0, 40),
    kind: coerceKind(raw.kind, fallbackKind),
    note: String(raw.note ?? '').slice(0, 120),
    svg,
    spec: {
      palette,
      fonts: {
        heading: raw.fonts?.heading || "'Inter Tight', system-ui, sans-serif",
        body: raw.fonts?.body || "'Inter Tight', system-ui, sans-serif",
        mono: raw.fonts?.mono,
      },
      geometry: String(raw.geometry ?? '').slice(0, 240),
      rationale: String(raw.rationale ?? '').slice(0, 240),
      // Read off the drawing rather than assumed: these are the ids the
      // inspector offers as hideable, so a mark whose parts were never listed
      // is a mark whose parts cannot be turned off.
      elements: extractElementIds(svg),
    },
  };
}

export function createClaudeProvider(ctx: AiCallCtx): LogoProvider {
  const call = (source: AiUsageSource, system: string, prompt: string | NeutralMessage[], maxTokens: number) =>
    completeOnce({
      db: ctx.db,
      source,
      system,
      prompt,
      maxTokens,
      brandId: ctx.brandId,
      userId: ctx.userId ?? null,
      client: ctx.client ?? null,
    });

  return {
    name: 'claude',

    async generateConcepts({ brief, count, avoid, styleLock }) {
      const kindFallback: MarkKind = brief.markType === 'surprise' ? 'geometric' : brief.markType;
      const text = await call(
        'logo_concept',
        CONCEPT_SYSTEM,
        conceptUserPrompt(brief, count, avoid, styleLock),
        // SVGs are token-heavy; budget generously per concept.
        Math.min(8000, 1400 * count),
      );
      const parsed = parseJSON<{ concepts?: RawConcept[] }>(text, {});
      const raw = Array.isArray(parsed.concepts) ? parsed.concepts : [];
      return raw
        .map((c) => toConcept(c, kindFallback))
        .filter((c): c is GeneratedConcept => c !== null);
    },

    async iterate({ brief, current, instruction }): Promise<IterateOutcome> {
      const text = await call(
        'logo_iterate',
        ITERATE_SYSTEM,
        iterateUserPrompt(brief, current.svg, instruction, current.spec.elements ?? []),
        3000,
      );
      const raw = parseJSON<RawConcept & { redraw?: boolean; setting?: string; reply?: string }>(
        text,
        {},
      );
      // The instruction was an inspector setting, not artwork. Say so rather
      // than drawing a copy of the mark with the change baked in — the caller
      // routes it back to the settings path, where it is one undoable edit.
      if (raw.redraw === false) {
        const said = String(raw.reply || raw.setting || '').trim();
        return {
          declined: true,
          reason: (said || 'That is an inspector setting, not a change to the artwork.').slice(
            0,
            200,
          ),
        };
      }
      const next = toConcept(raw, current.kind);
      // Model failed the contract — keep the current mark rather than a broken one.
      return next ?? current;
    },
  };
}
