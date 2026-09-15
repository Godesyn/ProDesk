/**
 * Conversational brief intake — the "Conversation" mode of DESIGN.md 01.
 *
 * The guided brief is a form; this is the same brief gathered by TALKING. One
 * model call per user turn returns both the next thing to say and its current
 * best structured brief, so the right rail can fill in live and the user can jump
 * to Generate the moment the studio has enough to work with.
 *
 * The extracted brief is always merged over a complete default, so a partial
 * conversation can never produce an invalid brief.
 */
import { completeOnce } from '../ai/provider-config.js';
import { isAiEnabled } from '../ai/client.js';
import type { AiCallCtx } from './providers/claude.js';
import type { LogoBrief } from './types.js';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationResult {
  /** What the studio says next (a question, or a confirmation). */
  reply: string;
  /** Best-effort structured brief so far — always complete and valid. */
  brief: LogoBrief;
  /** True once the studio has enough to generate good concepts. */
  ready: boolean;
  /** True when we answered without a model (no AI configured here). */
  fallback: boolean;
}

const SYSTEM = `You are the intake designer at a brand-identity studio, gathering a logo brief by conversation.

Your job each turn:
1. Reply like a warm, efficient designer — ONE short paragraph, at most ONE question. Never bullet lists. Never mention JSON or that you are an AI.
2. Extract everything you can infer so far into a structured brief.

Ask about, in rough priority order: what the business actually does, who it is for, the feeling it should give, whether they want a symbol / monogram / wordmark, and anything they love or hate. Infer freely rather than interrogating — if someone says "calm skincare for new mums" you already know it is soft, organic, minimal.

Set "ready" true once you know the business name and roughly what it does and how it should feel. Do not drag the conversation out; three or four exchanges is plenty.

Personality dials are integers 0-4:
- classicModern: 0 very classic, 4 very modern
- seriousPlayful: 0 very serious, 4 very playful
- minimalExpressive: 0 stripped-back, 4 highly expressive
- geometricOrganic: 0 strictly geometric, 4 freely organic

Return ONLY this JSON, no prose around it:
{"reply":"<your next message>","ready":<true|false>,"brief":{"businessName":"<name or empty>","tagline":"<one plain sentence or empty>","industry":"<short or empty>","keywords":["<3-6 evocative words>"],"personality":{"classicModern":<0-4>,"seriousPlayful":<0-4>,"minimalExpressive":<0-4>,"geometricOrganic":<0-4>},"markType":"monogram|geometric|combination|wordmark|surprise","monochromeFirst":true,"initials":"<1-3 letters or empty>","notes":"<anything else worth remembering>"}}`;

/** A neutral, always-valid brief the model's partial output is merged over. */
export function blankBrief(businessName: string): LogoBrief {
  return {
    businessName,
    keywords: [],
    personality: {
      classicModern: 2,
      seriousPlayful: 2,
      minimalExpressive: 2,
      geometricOrganic: 2,
    },
    markType: 'surprise',
    monochromeFirst: true,
  };
}

function clampDial(v: unknown, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(4, Math.max(0, n)) : fallback;
}

const MARK_TYPES = ['monogram', 'geometric', 'combination', 'wordmark', 'surprise'] as const;

/** Merge whatever the model returned over a valid default. */
export function mergeBrief(raw: unknown, base: LogoBrief): LogoBrief {
  const r = (raw ?? {}) as Record<string, unknown>;
  const p = (r.personality ?? {}) as Record<string, unknown>;
  const markType = String(r.markType ?? '') as LogoBrief['markType'];
  const keywords = Array.isArray(r.keywords)
    ? r.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 12)
    : base.keywords;
  const str = (v: unknown, max: number): string | undefined => {
    const s = String(v ?? '').trim();
    return s ? s.slice(0, max) : undefined;
  };
  return {
    businessName: str(r.businessName, 80) ?? base.businessName,
    tagline: str(r.tagline, 160) ?? base.tagline,
    industry: str(r.industry, 80) ?? base.industry,
    keywords,
    personality: {
      classicModern: clampDial(p.classicModern, base.personality.classicModern),
      seriousPlayful: clampDial(p.seriousPlayful, base.personality.seriousPlayful),
      minimalExpressive: clampDial(p.minimalExpressive, base.personality.minimalExpressive),
      geometricOrganic: clampDial(p.geometricOrganic, base.personality.geometricOrganic),
    },
    markType: MARK_TYPES.includes(markType) ? markType : base.markType,
    monochromeFirst: typeof r.monochromeFirst === 'boolean' ? r.monochromeFirst : base.monochromeFirst,
    initials: str(r.initials, 4) ?? base.initials,
    notes: str(r.notes, 2000) ?? base.notes,
  };
}

function parseJSON<T>(text: string, fallback: T): T {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Advance the conversation one turn. `turns` is the transcript so far, ending with
 * the user's latest message.
 */
export async function extractBriefFromConversation(
  ctx: AiCallCtx,
  args: { turns: ChatTurn[]; brandName: string; current?: LogoBrief | null },
): Promise<ConversationResult> {
  const base = args.current ?? blankBrief(args.brandName);
  const lastUser = [...args.turns].reverse().find((t) => t.role === 'user')?.content ?? '';

  if (!isAiEnabled()) {
    // Without a model we still make progress: keep the transcript as notes so the
    // deterministic engine has something to work with, and let the user proceed.
    return {
      reply:
        'Noted. Conversational intake needs the AI engine, which is off in this environment — ' +
        'your notes are saved, so switch to the guided brief to set the dials and generate.',
      brief: { ...base, notes: [base.notes, lastUser].filter(Boolean).join('\n') || undefined },
      ready: Boolean(base.businessName),
      fallback: true,
    };
  }

  const transcript = args.turns
    .slice(-12)
    .map((t) => `${t.role === 'user' ? 'Client' : 'You'}: ${t.content}`)
    .join('\n');

  try {
    const text = await completeOnce({
      db: ctx.db,
      source: 'logo_brief',
      system: SYSTEM,
      prompt:
        `The brand is called "${args.brandName}".\n` +
        `Brief so far: ${JSON.stringify(base)}\n\n` +
        `Conversation:\n${transcript}`,
      maxTokens: 900,
      brandId: ctx.brandId,
      userId: ctx.userId ?? null,
      client: ctx.client ?? null,
    });
    const raw = parseJSON<{ reply?: string; ready?: boolean; brief?: unknown }>(text, {});
    const brief = mergeBrief(raw.brief, base);
    return {
      reply: String(raw.reply ?? '').trim() || 'Tell me a little more about the brand.',
      brief,
      ready: raw.ready === true && Boolean(brief.businessName),
      fallback: false,
    };
  } catch {
    return {
      reply:
        'I did not quite catch that — could you tell me again what the business does and the feeling you want?',
      brief: base,
      ready: Boolean(base.businessName),
      fallback: true,
    };
  }
}
