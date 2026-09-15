/**
 * Continuations — suggested NEXT prompts shown in the Strategy starter-chip bar
 * after a reply. Generated in a COMPLETELY SEPARATE, single-shot Haiku call so
 * they never enter the real chat thread's context: sending "what should the
 * user ask next?" into the live conversation each turn would pollute the model's
 * window. This mirrors regenerate.ts — one stateless request, grounded on the
 * brand profile plus the last exchange, that returns plain suggestion strings.
 * "The last exchange" means the assistant's ENTIRE final turn — a tool-loop turn
 * persists up to 30 separate messages (narration rounds + the final answer), and
 * every one of them grounds the suggestions. Generated only once the turn has
 * actually landed back with the user (callers skip it while a settlement
 * follow-up is still armed — suggesting a next prompt mid-flow is noise).
 *
 * DELIBERATELY BOLD ONLY. These are not "obvious next step" prompts — a brand
 * owner doesn't need us to tell them to do the obvious thing. Instead each
 * suggestion should open a creative rabbit hole: an unexpected, bold angle the
 * user probably hasn't thought of themselves. Quality over quantity. We'd rather
 * surface a single genuinely provocative idea than four safe ones — if we keep
 * offering filler, people learn to ignore the chips entirely, and then they're
 * worthless. So it's completely fine to return just one suggestion (or none) as
 * long as what we do return is worth the click.
 *
 * Phrased as the USER would type them (first person, imperative), short, and
 * specific to this brand and where the conversation just landed.
 */
import { and, eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { brandKits, brands } from '../../db/schema.js';
import { completeOnce, resolveBrandFamily } from './provider-config.js';
import { buildProfileBlock } from './system-prompt.js';

type Brand = typeof brands.$inferSelect;

const MAX_SUGGESTIONS = 4;
// Chip-length guardrails: stated as a hard limit in the prompt to keep chips
// short, but NOT enforced in parseSuggestions. Dropping every over-long
// suggestion used to empty the whole list, and the caller keeps the previous
// chips on an empty result — so a batch of good-but-slightly-long ideas left
// the bar stuck on stale suggestions. We now keep whatever the model returns.
const MAX_SUGGESTION_WORDS = 8;
const MAX_SUGGESTION_CHARS = 60;

// One assistant turn can span up to 30 tool-loop rounds, each persisted as its
// own message — ALL of them ground the suggestions, not just the last one. The
// budget is a runaway guard only (~5k tokens of Haiku input); when a turn does
// exceed it, whole OLDEST rounds are dropped first — the final rounds carry the
// answer, the early ones are tool narration.
const ASSISTANT_TEXT_BUDGET_CHARS = 20_000;

/**
 * Join every round of the assistant's turn into one transcript, newest-biased:
 * rounds are kept whole, dropping from the front only once the budget is blown.
 */
function buildAssistantTranscript(texts: string[]): string {
  const rounds = texts.map((t) => t.trim()).filter(Boolean);
  const kept: string[] = [];
  let used = 0;
  for (let i = rounds.length - 1; i >= 0; i--) {
    // Always keep the newest round even if it alone busts the budget (clamped).
    const round = kept.length === 0 ? rounds[i].slice(0, ASSISTANT_TEXT_BUDGET_CHARS) : rounds[i];
    if (kept.length > 0 && used + round.length > ASSISTANT_TEXT_BUDGET_CHARS) {
      kept.unshift('[…earlier rounds of this reply omitted…]');
      break;
    }
    kept.unshift(round);
    used += round.length;
  }
  return kept.join('\n\n');
}

function parseSuggestions(text: string): string[] {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr: unknown;
  try {
    arr = JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      arr = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);
}

/**
 * Generate follow-up suggestions for a just-finished turn. Best-effort: returns
 * [] on any failure (the caller falls back to static starter prompts). Records
 * its own token spend under the 'continuations' source.
 */
export async function generateContinuations(opts: {
  db: DB;
  brand: Brand;
  threadId: string;
  lastUserText: string;
  /** Every message the assistant persisted this turn, oldest-first — all of them
   *  ground the suggestions, not just the final one. */
  assistantTexts: string[];
  userId?: string | null;
  client?: string | null;
  signal?: AbortSignal;
}): Promise<string[]> {
  const { db, brand, lastUserText, assistantTexts } = opts;
  const assistantTranscript = buildAssistantTranscript(assistantTexts);
  if (!assistantTranscript) return [];

  // The DEFAULT kit is the brand kit (a brand also holds one kit per signature department).
  const [kit] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brand.id), eq(brandKits.isDefault, true)))
    .limit(1);
  const profile = buildProfileBlock(brand, kit ?? null);

  const system =
    'You are the idea engine behind a "creative rabbit holes" feature in a brand-strategy chat. After ' +
    'the AI strategist replies, you propose what the brand owner could explore NEXT — but ONLY bold, ' +
    'lateral moves they almost certainly have not considered themselves. Suggestions render as clickable ' +
    'chips, written in the FIRST PERSON exactly as the user would type them to the strategist.\n\n' +
    '<what_counts_as_bold>\n' +
    'A worthy suggestion is a creative leap grounded in THIS brand and where the conversation just ' +
    'landed. Moves that qualify:\n' +
    '- A contrarian bet: do the opposite of the category default\n' +
    '- An unexpected collaboration, audience, or channel nobody in this niche uses\n' +
    '- Reframing what is actually being sold: the byproduct, the ritual, the community — not the thing\n' +
    '- Borrowing a playbook from a completely unrelated industry\n' +
    '- Turning a weakness or constraint just discussed into the hook itself\n' +
    '- A weird, cheap-to-try experiment that nobody in the space tries\n' +
    '</what_counts_as_bold>\n\n' +
    '<never_suggest>\n' +
    '- The obvious next step ("Draft the email", "Make a content calendar", "Who are my competitors?")\n' +
    '- Generic marketing advice that fits any brand ("Post more on TikTok", "Run a giveaway", "Improve my SEO")\n' +
    '- A restatement or drill-down of what the strategist just said\n' +
    '- Anything the user would clearly think of on their own\n' +
    '</never_suggest>\n\n' +
    '<quality_bar>\n' +
    'Work in two passes. First, privately brainstorm 6-8 candidates across different moves above. Then ' +
    'keep ONLY the candidates that pass every test:\n' +
    '1. Surprise — would the brand owner think "huh, I never considered that"?\n' +
    '2. Specificity — does it hinge on something concrete about THIS brand and topic? If it could be ' +
    'pasted into another brand\'s chat unchanged, it fails.\n' +
    '3. Worth the click — would exploring it genuinely open a new direction, not a dead end?\n' +
    'Discard everything else. One brilliant chip beats four safe ones — users learn to ignore chips ' +
    'that waste their time, and then the feature is dead. Returning a single suggestion is normal; ' +
    'returning [] because nothing clears the bar is a valid, good answer.\n' +
    '</quality_bar>\n\n' +
    '<format>\n' +
    `- Return ONLY a JSON array of 0 to ${MAX_SUGGESTIONS} strings. No prose, no markdown, no keys.\n` +
    `- Each string is a chip: HARD LIMIT ${MAX_SUGGESTION_WORDS} words / ${MAX_SUGGESTION_CHARS} characters. Shorter is better. ` +
    'First person, phrased as a request or question the user would send. Cut articles and filler ' +
    'words before cutting the idea; if it still does not fit, it is not chip material — drop it.\n' +
    '</format>\n\n' +
    '<examples>\n' +
    'Illustrative only — a candle brand that just discussed slow retail sales:\n' +
    'BAD (obvious or generic; never return these): "Run a holiday discount", "Post more on Instagram", ' +
    '"Draft a marketing plan"\n' +
    'BAD (right idea, too long for a chip): "What if we partnered with boutique hotels to scent their ' +
    'lobbies and rooms with our candles?"\n' +
    'GOOD (bold, specific, chip-length): "What if hotels scented rooms with us?", "Sell burned-out ' +
    'jars as planters", "Pitch a candle for candle-haters"\n' +
    '</examples>\n' +
    (profile ? `\n${profile}\n` : '');

  const user =
    (lastUserText.trim() ? `The user just said:\n"""${lastUserText.trim()}"""\n\n` : '') +
    `The strategist's reply to them (may span several messages around tool work; the last one is the final answer):\n"""${assistantTranscript}"""\n\n` +
    'Brainstorm privately, filter against the quality bar, and return the JSON array only — just the ' +
    'suggestions that survive (0 to ' + MAX_SUGGESTIONS + '). Keep every chip short. One brilliant ' +
    'rabbit hole beats several safe ideas.';

  try {
    const raw = await completeOnce({
      db,
      source: 'continuations',
      system,
      prompt: user,
      maxTokens: 300,
      family: await resolveBrandFamily(db, brand.id),
    // Strategy is the one place the model is a TENANT choice — the brand picked
    // this family, so the per-feature override must not quietly replace it.
    ignoreFeatureModel: true,
      brandId: brand.id,
      threadId: opts.threadId,
      userId: opts.userId ?? null,
      client: opts.client ?? null,
      signal: opts.signal,
    });
    const parsed = parseSuggestions(raw);
    console.error('[ai][cont] raw', JSON.stringify(raw), '=> parsed', parsed.length);
    return parsed;
  } catch (e) {
    console.error('[ai] continuations failed', (e as Error).message);
    return [];
  }
}
