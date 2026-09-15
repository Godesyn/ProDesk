import type { NormalizedUsage } from './providers/types.js';
import { lookupModel } from './providers/registry.js';

/**
 * Costed usage for one (or an accumulated set of) LLM response(s). Field names
 * match the `ai_usage` columns so recordAiUsage can write them straight through.
 */
export interface ComputedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

/**
 * Price a provider-normalised usage object for a concrete model id. Per-1M token
 * rates come from the model spec; cache and web-search economics differ by family
 * (Anthropic caches read at 0.1× / write at 1.25×; Gemini implicit caching reads
 * at ~0.25× with no write surcharge) and come from the family spec. Unknown model
 * ids price at zero cost (still recording token counts) rather than throwing —
 * spend logging must never break a reply.
 */
export function priceUsage(modelId: string, u: NormalizedUsage): ComputedUsage {
  const found = lookupModel(modelId);
  const perM = 1_000_000;
  let costUsd = 0;
  if (found) {
    const { model, family } = found;
    costUsd =
      (u.inputTokens * model.input) / perM +
      (u.outputTokens * model.output) / perM +
      (u.cacheReadTokens * model.input * family.cacheReadMult) / perM +
      (u.cacheWriteTokens * model.input * family.cacheWriteMult) / perM +
      u.webSearchRequests * family.webSearchUsd;
  }
  return {
    inputTokens: u.inputTokens,
    outputTokens: u.outputTokens,
    cacheReadTokens: u.cacheReadTokens,
    cacheCreationTokens: u.cacheWriteTokens,
    // 6dp matches the numeric(12,6) column.
    costUsd: Math.round(costUsd * 1e6) / 1e6,
  };
}

/** Accumulate usage across a multi-round turn (e.g. the chat tool-call loop). */
export function emptyUsage(): ComputedUsage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
}

export function addUsage(a: ComputedUsage, b: ComputedUsage): ComputedUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheCreationTokens: a.cacheCreationTokens + b.cacheCreationTokens,
    costUsd: Math.round((a.costUsd + b.costUsd) * 1e6) / 1e6,
  };
}

/** Convenience: price a single response and fold it into a running total. */
export function priceInto(total: ComputedUsage, modelId: string, u: NormalizedUsage): ComputedUsage {
  return addUsage(total, priceUsage(modelId, u));
}
