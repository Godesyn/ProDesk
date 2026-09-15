/**
 * The copilot's inspector controller — plain language in, an inspector patch out.
 *
 * Kept apart from inspector.ts (the pure settings model) for a practical reason:
 * the AI provider registry validates the whole environment the moment it is
 * imported, so anything that pulls it in can only run inside a configured server.
 * The settings model, the change journal, and the deterministic parser have no
 * such dependency and are used from tests — and their diff/undo logic is the part
 * worth exercising — so the one call that talks to a model lives here instead.
 */
import { completeOnce } from '../ai/provider-config.js';
import { isAiEnabled } from '../ai/client.js';
import {
  NOTHING_INTERPRETED,
  parseInstruction,
  sanitizeSettingsPatch,
  type InspectorSettings,
  type InterpretResult,
} from './inspector.js';
import { WORDMARK_WEIGHTS } from './layout.js';
import { TYPEFACES, TYPEFACE_KEYS } from './typefaces.js';
import type { AiCallCtx } from './providers/claude.js';

/**
 * The shipped faces, listed for the prompt straight off the registry — adding a
 * typeface must not require remembering to retype it here, or the model would go
 * on offering only the three it was told about.
 */
const TYPEFACE_LIST = TYPEFACE_KEYS.map(
  (k) => `${k} (${TYPEFACES[k].label}, ${TYPEFACES[k].category})`,
).join(', ');

const INSPECTOR_SYSTEM = `You are the inspector controller inside a professional identity-design studio. The user speaks in plain language; you turn it into a patch on the CURRENT mark's inspector settings.

Adjusting the settings is the default and nearly always the right answer: it refines the mark the user already chose, instantly and reversibly. Redrawing DISCARDS that artwork and generates a new one, so it is the exception.

Ask for a redraw ONLY when satisfying the request means drawing shapes that are not there now: a different subject ("make it a leaf instead"), a different kind of mark ("try it as a monogram", "just the wordmark"), rearranged geometry ("put the initials in a circle"), or an outright "redraw it" / "show me something else".

When a sentence asks for new shapes AND moves a control ("make it a leaf, and a bit bolder"), it is a redraw — send the whole thing there. Taking only the settings half applies the adjustment the user mentioned in passing and silently drops the change they actually asked for.

Everything else is settings — INCLUDING vague aesthetic requests. Map the feeling onto the nearest controls rather than refusing:
- "cleaner", "more minimal", "give it room" → more clearspace, lighter strokeWidth, hide a decorative element
- "bolder", "stronger", "more confident" → heavier strokeWidth, larger scale
- "friendlier", "softer", "warmer" → lighter strokeWidth, a serif face, a warmer colour
- "more compact", "tighter" → lower gap, less clearspace
When in doubt, ADJUST. A small change the user can undo in one press beats throwing their mark away.

The settings and their ranges:
- scale        0.2–2      mark size relative to the wordmark (1 = as drawn)
- strokeWidth  0.5–24, or null for "as drawn" — global stroke weight in mark units
- gap          0–2.5      multiplier on the space between mark and wordmark (1 = as designed)
- clearspace   0.25–3     keep-clear zone in cap heights
- hidden       array of element ids to hide (only ids from the list you are given; never "mark")
- typeface     one of: ${TYPEFACE_LIST}
- wordmarkWeight  ${WORDMARK_WEIGHTS.join('/')}, or null for the face's own — the weight the WORDMARK is cut at
- color        #RRGGBB    the mark's primary colour — resolve colour names yourself ("forest green" → #2E7D4F)

Rules:
- Return ONLY the fields you are actually changing. Absolute values, not deltas.
- Interpret vague amounts proportionally from the current values: "a bit" ≈ 10%, "much"/"a lot" ≈ 30%, otherwise ≈ 15%.
- "Tighter"/"closer together" LOWERS gap. "Bolder"/"heavier" RAISES strokeWidth.
- strokeWidth is the SYMBOL's line weight; wordmarkWeight is the TYPE's. "Bolder" alone means the symbol; only reach for wordmarkWeight when the sentence is about the wordmark, the type, or the lettering. A named cut ("semibold", "black") is an absolute weight.
- Clamp to the ranges above.
- reply: one short sentence, past tense, naming what you changed. No preamble.

Return ONLY valid JSON — a settings change:
{"handled":true,"patch":{...},"reply":"..."}
or, for a genuine redraw and nothing else:
{"handled":false,"redraw":true}`;

/**
 * Turn a plain-language instruction into an inspector patch.
 *
 * Returns `handled: false` when the request is really about redrawing the mark,
 * which is the caller's signal to hand it to the generation engine instead.
 *
 * A decline is EXPENSIVE — it discards the mark the user chose and draws a new
 * one — so it has to be earned. Only an explicit `redraw: true` goes straight
 * through; every other way the model can fail to produce a patch (declining
 * without saying why, inventing fields that sanitize away, returning junk)
 * falls to the deterministic parser first. If plain word-matching can find a
 * real setting in the sentence, that is the answer, and the artwork survives.
 */
export async function interpretInstruction(
  ctx: AiCallCtx,
  args: { instruction: string; current: InspectorSettings; elements: string[] },
): Promise<InterpretResult> {
  const { instruction, current, elements } = args;
  if (!instruction.trim()) return NOTHING_INTERPRETED;
  if (!isAiEnabled()) return parseInstruction(instruction, current, elements);

  try {
    const text = await completeOnce({
      db: ctx.db,
      source: 'logo_inspector',
      system: INSPECTOR_SYSTEM,
      prompt:
        `Current settings: ${JSON.stringify(current)}\n` +
        `Hideable element ids: ${elements.filter((e) => e !== 'mark').join(', ') || '(none)'}\n` +
        `Instruction: ${instruction}`,
      maxTokens: 400,
      brandId: ctx.brandId,
      userId: ctx.userId ?? null,
      client: ctx.client ?? null,
    });
    const raw = parseJson<{
      handled?: boolean;
      redraw?: boolean;
      patch?: Record<string, unknown>;
      reply?: string;
    }>(text);

    if (raw?.handled) {
      const patch = sanitizeSettingsPatch(raw.patch ?? {}, elements);
      if (Object.keys(patch).length)
        return { handled: true, patch, reply: String(raw.reply ?? '').trim(), fallback: false };
    }
    // The model asked for new artwork outright — that is the one case worth a
    // redraw, so don't let the parser hijack "make it a leaf" into a nudge.
    if (raw?.redraw === true) return NOTHING_INTERPRETED;
    // Anything else: try the words themselves before spending a generation.
    return parseInstruction(instruction, current, elements);
  } catch {
    // The model is the nicer path, not the only one — fall back to the parser so
    // the controls still answer plain language when AI is off or the call fails.
    return parseInstruction(instruction, current, elements);
  }
}

function parseJson<T>(text: string): T | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text) as T;
  } catch {
    return null;
  }
}
