/**
 * AI review-copy generation for the public capture flow. Remaps the Manus
 * export's Forge `invokeLLM` onto our Anthropic client (modules/ai). One-shot,
 * non-streaming: the customer picks win-tags, we write a short, human review.
 */
import type { DB } from '../../db/index.js';
import { isAiEnabled } from '../ai/client.js';
import { completeOnce } from '../ai/provider-config.js';

export function buildReviewPrompt(params: {
  businessName: string;
  industry: string;
  selectedTags: string[];
}): string {
  const tagList = params.selectedTags.join(', ') || '(none provided)';
  return `You are writing a short, authentic customer review for a business.

Business name: ${params.businessName}
Industry: ${params.industry}
What the customer said went well: ${tagList}

Write a review that:
- Reads as if the customer wrote it themselves on their phone
- Is 40 to 80 words
- Mentions the business name once naturally
- Weaves in at least two of the things the customer said went well as specific proof points
- Sounds human, warm, and genuine — not like a template
- Avoids clichés like "highly recommend", "exceeded expectations", "game changer", "couldn't be happier"
- Does NOT use em dashes
- Varies sentence structure so it doesn't feel formulaic

Return ONLY the review text. No preamble, no quotation marks, no explanation.`;
}

/** Generate a polished public review. Throws if AI is disabled or returns empty. */
export async function generateReviewText(params: {
  businessName: string;
  industry: string;
  selectedTags: string[];
  /** For spend tracking — the review-capture flow is public (no user). */
  db?: DB;
  brandId?: string | null;
  client?: string | null;
}): Promise<string> {
  if (!isAiEnabled()) {
    throw new Error('Review generation is unavailable right now.');
  }
  const raw = (
    await completeOnce({
      db: params.db,
      source: 'review_generate',
      prompt: buildReviewPrompt(params),
      maxTokens: 400,
      brandId: params.brandId ?? null,
      client: params.client ?? null,
    })
  ).trim();
  const text = raw
    .replace(/^['"`\s]+|['"`\s]+$/g, '')
    .replace(/[—–]/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) throw new Error('Review generation returned empty.');
  return text;
}
