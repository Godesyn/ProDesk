/**
 * Single choke-point for recording LLM spend across every provider family. Every
 * place that calls an LLM should call `recordAiUsage` with the (normalised) usage
 * from the response so cost lands in `ai_usage` and shows up in the super-admin
 * AI-spend report.
 *
 * Recording is best-effort: a logging failure must never break the AI feature
 * that produced the reply, so all inserts swallow-and-log.
 */
import type { DB } from '../../db/index.js';
import { aiUsage } from '../../db/schema.js';
import { priceUsage, type ComputedUsage } from './pricing.js';
import type { NormalizedUsage } from './providers/types.js';

/**
 * The AI feature that spent the tokens. Stored in `ai_usage.source` so cost can
 * be attributed per-feature, not just per-brand. Add a member here whenever a
 * new LLM call site is introduced.
 */
export type AiUsageSource =
  | 'chat' // main brand AI-assistant streaming turn
  | 'card_regenerate' // action-card "Regenerate" rewrite
  | 'review_generate' // public review-capture copy
  | 'proposal_draft' // EziQuotes: draft proposal from a prompt
  | 'proposal_rewrite' // EziQuotes: inline tone rewrite
  | 'proposal_suggest' // EziQuotes: improvement suggestions on save
  | 'proposal_score' // EziQuotes: proposal quality score
  | 'proposal_win_loss' // EziQuotes: win/loss analysis
  | 'pricing_benchmark' // EziQuotes: competitor price benchmark
  | 'upsell_recommendations' // EziQuotes: upsell/add-on suggestions
  | 'block_copy' // EziQuotes: proposal block copy suggestions
  | 'sequence_rewrite' // EziQuotes: follow-up touchpoint rewrite
  | 'continuations' // Strategy: out-of-band next-prompt suggestions after a reply
  | 'compaction' // AI thread: `/compact` conversation summary
  | 'logo_brief' // Logo Studio: conversational brief → structured brief spec
  | 'logo_concept' // Logo Studio: brief → N editable SVG logo concepts
  | 'logo_iterate' // Logo Studio: conversational edit of an existing mark
  | 'logo_variants' // Logo Studio: derive lockup variants (reversed/mono/stacked)
  | 'logo_system' // Logo Studio: derive palette + type system from a chosen mark
  | 'logo_inspector' // Logo Studio: plain-language instruction → inspector settings
  | 'logo_uniqueness' // Logo Studio: distinctiveness/uniqueness scoring
  | 'outreach_classify' // Outreach: classify an inbound cold-email reply
  | 'outreach_draft' // Outreach: draft a response for human approval
  | 'outreach_personalise'; // Outreach: extract one concrete detail from a prospect's site

const EMPTY_USAGE: NormalizedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearchRequests: 0,
};

interface RecordOpts {
  db: DB;
  source: AiUsageSource;
  /** Concrete model id the spend is attributed to (any provider family). */
  model: string;
  /** Provider-normalised usage for a single response. Ignored if `computed` is set. */
  usage?: NormalizedUsage | null;
  /** Pre-accumulated usage (e.g. the chat tool-loop total across many responses). */
  computed?: ComputedUsage;
  brandId?: string | null;
  threadId?: string | null;
  messageId?: string | null;
  userId?: string | null;
  client?: string | null;
}

/** Compute cost and insert one `ai_usage` row. Never throws. */
export async function recordAiUsage(opts: RecordOpts): Promise<void> {
  const computed = opts.computed ?? priceUsage(opts.model, opts.usage ?? EMPTY_USAGE);
  await opts.db
    .insert(aiUsage)
    .values({
      brandId: opts.brandId ?? null,
      threadId: opts.threadId ?? null,
      messageId: opts.messageId ?? null,
      userId: opts.userId ?? null,
      client: opts.client ?? null,
      source: opts.source,
      model: opts.model,
      inputTokens: computed.inputTokens,
      outputTokens: computed.outputTokens,
      cacheReadTokens: computed.cacheReadTokens,
      cacheCreationTokens: computed.cacheCreationTokens,
      costUsd: String(computed.costUsd),
    })
    .catch((e) =>
      console.error(`[ai] usage log failed (${opts.source})`, (e as Error).message),
    );
}
