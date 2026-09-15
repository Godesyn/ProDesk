/**
 * `/compact` for an AI thread — the counterpart to `/clear`. Where `/clear`
 * throws the conversation away, `/compact` COMPRESSES it: a single-shot Haiku
 * call summarises everything currently in the model's window, that summary is
 * stored on the thread and the context-reset boundary is moved to now, so future
 * turns replay only new messages plus the summary (injected as a leading turn by
 * memory.ts). The model keeps the gist while the raw transcript stops being
 * replayed every turn.
 *
 * Like continuations.ts this runs OUT OF BAND — a stateless request that never
 * enters the live thread — and records its own spend under the 'compaction'
 * source. It returns null only when there's genuinely nothing to compact (empty
 * window and no prior summary); a model/API failure throws so the caller can
 * refuse to move the reset boundary (moving it without a summary would silently
 * lose context — the one thing compaction must never do).
 */
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { chatMessages, chatThreads } from '../../db/schema.js';
import { providerBundle, resolveDefaultFamily } from './provider-config.js';
import type { ProviderFamily } from './providers/types.js';
import { recordAiUsage } from './usage.js';

/**
 * Auto-compaction policy. A turn triggers automatic compaction once its prompt
 * grows past this many tokens (the full assembled prompt — system + replayed
 * history + current turn, cached portion included), provided there's a
 * meaningful amount of history to actually fold up. Well below the model's
 * context limit: the point is to keep long threads fast and cheap and to stop
 * the replay window growing without bound, not to rescue a near-overflow. After
 * a compaction the boundary moves and the next turn's prompt drops right back
 * down, so this doesn't re-fire every turn. Tune here.
 */
export const AUTO_COMPACT_PROMPT_TOKENS = 60_000;
const AUTO_COMPACT_MIN_HISTORY = 30;

const AUTO_COMPACT_DIVIDER =
  'Conversation automatically compacted — earlier messages are summarised from here to keep your strategist fast and focused.';

/** Safety cap on how many messages we pull to summarise (well above HISTORY_CAP). */
const MAX_MESSAGES = 1000;
/** Newest-biased transcript budget (~25k tokens of Haiku input). Oldest turns are
 *  dropped first if a thread somehow blows past it. */
const TRANSCRIPT_BUDGET_CHARS = 100_000;
/** Summary output cap — enough for a rich recap, small enough to stay cheap. */
const SUMMARY_MAX_TOKENS = 1500;

/**
 * Join the windowed messages into one newest-biased transcript: whole turns are
 * kept, dropping from the front only once the budget is blown.
 */
function buildTranscript(lines: string[]): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = kept.length === 0 ? lines[i].slice(0, TRANSCRIPT_BUDGET_CHARS) : lines[i];
    if (kept.length > 0 && used + line.length > TRANSCRIPT_BUDGET_CHARS) {
      kept.unshift('[…earlier messages omitted…]');
      break;
    }
    kept.unshift(line);
    used += line.length;
  }
  return kept.join('\n\n');
}

/**
 * Summarise a thread's current context window. `priorSummary` (the thread's
 * existing summary from an earlier `/compact`) is folded in so successive
 * compactions never lose earlier ground. Returns the new summary, or null when
 * there is nothing to summarise (fresh/empty window and no prior summary).
 */
export async function summarizeThread(opts: {
  db: DB;
  threadId: string;
  /** Provider family to summarise with. Defaults to the global default family
   *  when omitted (the manual /compact path). */
  family?: ProviderFamily;
  /** Current reset boundary — only messages after it are in the model's window. */
  contextResetAt: Date | null;
  priorSummary: string | null;
  brandId?: string | null;
  userId?: string | null;
  client?: string | null;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { db, threadId, contextResetAt, priorSummary } = opts;

  const rows = await db
    .select({
      content: chatMessages.content,
      isAi: chatMessages.isAi,
      type: chatMessages.type,
      fileName: chatMessages.fileName,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.threadId, threadId),
        ne(chatMessages.type, 'system'),
        contextResetAt ? gt(chatMessages.timestamp, contextResetAt) : undefined,
      ),
    )
    .orderBy(asc(chatMessages.timestamp), asc(chatMessages.id))
    .limit(MAX_MESSAGES);

  const lines = rows
    .map((r) => {
      let text = r.content ?? '';
      if (!text && r.fileName) text = `[attachment: ${r.fileName}]`;
      else if (r.fileName && r.type !== 'text') text = `${text}\n[attachment: ${r.fileName}]`;
      text = text.trim();
      if (!text) return '';
      return `${r.isAi ? 'Assistant' : 'User'}: ${text}`;
    })
    .filter(Boolean);

  // Nothing new since the last reset and no earlier summary → nothing to compact.
  if (lines.length === 0 && !priorSummary?.trim()) return null;

  const transcript = buildTranscript(lines);

  const system =
    'You compress a brand-strategy conversation so the assistant can keep working with a smaller context. ' +
    'Produce a faithful, information-dense recap written as notes to the assistant itself (third person, ' +
    'no greeting, no "here is a summary"). Preserve everything needed to continue seamlessly and drop the ' +
    'rest.\n\n' +
    'Capture, using clear Markdown headings/bullets:\n' +
    "- The brand and the user's goals as they've emerged.\n" +
    '- Key facts, decisions, numbers, names and preferences established.\n' +
    '- Any drafts, plans or artifacts produced (keep the substance, not the full text).\n' +
    '- Open questions, unfinished tasks and agreed next steps.\n' +
    '- Anything the user asked the assistant to remember or always do.\n\n' +
    'Rules: never invent detail that was not in the conversation; keep specifics (exact figures, names, ' +
    'wording choices) rather than vague paraphrase; be concise but complete. Output ONLY the recap.';

  const user =
    (priorSummary?.trim()
      ? `Summary of the conversation SO FAR (from an earlier compaction — fold this in):\n"""${priorSummary.trim()}"""\n\n`
      : '') +
    (transcript
      ? `The conversation to compact${priorSummary?.trim() ? ' (this continues after the summary above)' : ''}:\n"""${transcript}"""`
      : 'There are no new messages since the earlier summary — just return that summary, tightened.');

  const family = opts.family ?? (await resolveDefaultFamily(db));
  if (!family) throw new Error('No AI provider family is enabled.');
  const bundle = providerBundle(family);
  const model = bundle.model;
  const res = await bundle.provider.complete({
    modelId: model,
    maxTokens: SUMMARY_MAX_TOKENS,
    system,
    messages: [{ role: 'user', content: user }],
    signal: opts.signal,
  });
  await recordAiUsage({
    db,
    source: 'compaction',
    model,
    usage: res.usage,
    brandId: opts.brandId ?? null,
    threadId,
    userId: opts.userId ?? null,
    client: opts.client ?? null,
  });

  const summary = res.text.trim();
  // Model returned nothing usable — fall back to the prior summary rather than
  // dropping context. (Truly empty with no prior summary was handled above.)
  return summary || priorSummary?.trim() || null;
}

/**
 * Commit a compaction: drop a system divider into the thread, then move the
 * context boundary to it and store the summary. The divider's own timestamp is
 * the new boundary, so from the next turn on the model replays only messages
 * after it, plus the summary (injected by buildMessages). Shared by the manual
 * `/compact` command and the automatic path. Returns the divider row.
 */
export async function applyCompaction(opts: {
  db: DB;
  threadId: string;
  summary: string;
  dividerText: string;
}): Promise<typeof chatMessages.$inferSelect> {
  const { db, threadId, summary, dividerText } = opts;
  const [marker] = await db
    .insert(chatMessages)
    .values({
      threadId,
      senderId: null,
      isAi: false,
      senderName: 'System',
      content: dividerText,
      type: 'system',
    })
    .returning();
  await db
    .update(chatThreads)
    .set({ aiContextResetAt: marker.timestamp, aiContextSummary: summary })
    .where(eq(chatThreads.id, threadId));
  return marker;
}

/**
 * Automatic compaction, fired fire-and-forget after a turn lands (see chat.ts).
 * No-ops unless the turn's prompt crossed AUTO_COMPACT_PROMPT_TOKENS and there's
 * enough history to be worth folding. Summarises and commits exactly like the
 * manual command; the divider reaches clients over the normal chat realtime
 * channel, so no extra broadcast is needed. Best-effort — never throws to its
 * caller. Returns true if it compacted.
 */
export async function autoCompactThread(opts: {
  db: DB;
  thread: { id: string; aiContextResetAt: Date | null; aiContextSummary: string | null };
  /** The turn's peak assembled-prompt size, in tokens. */
  promptTokens: number;
  /** How many history messages were in the model's window this turn. */
  historyCount: number;
  /** Provider family to summarise with (same family as the turn that triggered it). */
  family: ProviderFamily;
  brandId?: string | null;
  userId?: string | null;
  client?: string | null;
}): Promise<boolean> {
  const { db, thread, promptTokens, historyCount } = opts;
  if (promptTokens < AUTO_COMPACT_PROMPT_TOKENS) return false;
  if (historyCount < AUTO_COMPACT_MIN_HISTORY) return false;
  try {
    const summary = await summarizeThread({
      db,
      threadId: thread.id,
      family: opts.family,
      contextResetAt: thread.aiContextResetAt,
      priorSummary: thread.aiContextSummary,
      brandId: opts.brandId ?? null,
      userId: opts.userId ?? null,
      client: opts.client ?? null,
    });
    if (!summary) return false;
    await applyCompaction({ db, threadId: thread.id, summary, dividerText: AUTO_COMPACT_DIVIDER });
    return true;
  } catch (e) {
    console.error('[ai] auto-compaction failed', (e as Error).message);
    return false;
  }
}
