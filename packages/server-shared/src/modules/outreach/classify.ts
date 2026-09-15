import type { DB } from '../../db/index.js';
import { completeOnce } from '../ai/provider-config.js';
import type { OutreachClassification } from '../../db/schema.js';

/**
 * Reply classification.
 *
 * Runs through the shared AI provider abstraction, which means it inherits the
 * family the super-admin has enabled and — importantly — records spend against
 * an outreach-specific source, so this feature's cost is attributable rather
 * than buried in the assistant's bill.
 *
 * §7 says the prompt is deliberately left to iterate on. What is built here is
 * the SEAM: a strict output contract, a conservative parser, and a default that
 * fails toward human review rather than toward action.
 */

export const CLASSIFICATIONS = ['yes', 'question', 'not_now', 'never', 'other'] as const;

export interface ClassificationResult {
  classification: OutreachClassification;
  reasoning: string;
  /** 0–1. Low confidence still queues for a human; it never blocks the pipeline. */
  confidence: number;
}

/**
 * Language that means "stop emailing me" regardless of what a model thinks.
 *
 * Checked BEFORE the model runs. Unsubscribe intent is the one case where being
 * slow or clever is worse than being blunt: §9 makes suppression instant and
 * automatic, and a model round-trip is both a delay and a failure point on the
 * one path that must never fail.
 */
const HARD_STOP = [
  'unsubscribe',
  'remove me',
  'take me off',
  'opt out',
  'opt-out',
  'stop emailing',
  'stop contacting',
  'do not contact',
  "don't contact",
  'do not email',
  "don't email",
  'no longer wish to receive',
];

/** True when the reply is unambiguously a request to stop. */
export function isHardStop(body: string): boolean {
  const text = body.toLowerCase();
  return HARD_STOP.some((p) => text.includes(p));
}

const SYSTEM = `You classify replies to a cold outreach email offering a free business listing.

Return ONE JSON object and nothing else:
{"classification":"yes|question|not_now|never|other","reasoning":"<one short sentence>","confidence":<0-1>}

Definitions:
- "yes": they accept, want it, or ask you to proceed.
- "question": interested but asking something before committing.
- "not_now": open in principle but not at the moment ("check back in Q3").
- "never": they want no further contact, are hostile, or are unsubscribing.
- "other": auto-replies, out-of-office, bounces, wrong person, or anything unclear.

Rules:
- Judge only the reply. Never infer enthusiasm that isn't written.
- An out-of-office is "other", never "not_now".
- If you are unsure between two, pick the more cautious one and lower confidence.`;

function parse(raw: string): ClassificationResult | null {
  // Models sometimes wrap JSON in prose or a code fence; take the first object.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const o = JSON.parse(match[0]) as Record<string, unknown>;
    const c = String(o.classification ?? '').toLowerCase();
    if (!(CLASSIFICATIONS as readonly string[]).includes(c)) return null;
    const confidence = Number(o.confidence);
    return {
      classification: c as OutreachClassification,
      reasoning: typeof o.reasoning === 'string' ? o.reasoning.slice(0, 500) : '',
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.5,
    };
  } catch {
    return null;
  }
}

/**
 * Classify one reply.
 *
 * Never throws. Every failure path — no provider configured, a malformed
 * response, an API error — resolves to `other` with zero confidence, which puts
 * the reply in front of a human. The cost of a wrong `other` is one extra
 * glance; the cost of a wrong `yes` or `never` is an email nobody approved.
 */
export async function classifyReply(opts: {
  db: DB;
  body: string;
  subject?: string | null;
  businessName?: string | null;
}): Promise<ClassificationResult> {
  const body = (opts.body ?? '').trim();
  if (!body) {
    return { classification: 'other', reasoning: 'Empty reply body.', confidence: 0 };
  }

  if (isHardStop(body)) {
    return {
      classification: 'never',
      reasoning: 'Reply contains an explicit unsubscribe or do-not-contact request.',
      confidence: 1,
    };
  }

  const prompt = [
    opts.businessName ? `Business: ${opts.businessName}` : null,
    opts.subject ? `Subject: ${opts.subject}` : null,
    'Reply:',
    // Long forwarded threads add cost without adding signal — the decision is
    // almost always in the first paragraph.
    body.slice(0, 4000),
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await completeOnce({
      db: opts.db,
      source: 'outreach_classify',
      system: SYSTEM,
      prompt,
      maxTokens: 300,
      // Which model runs this is set on the AI Models screen. It defaults to the
      // cheapest option: sorting a one-line reply into five buckets is
      // high-volume and needs no flagship judgement — the strict output contract
      // and the conservative parser above are what keep quality up, not size.
    });
    return (
      parse(raw) ?? {
        classification: 'other',
        reasoning: 'Could not read the classifier response.',
        confidence: 0,
      }
    );
  } catch (e) {
    console.error('[outreach] classify failed', (e as Error).message);
    return {
      classification: 'other',
      reasoning: 'Classifier unavailable.',
      confidence: 0,
    };
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Reply drafting
 * ────────────────────────────────────────────────────────────────────────── */

const DRAFT_SYSTEM = `You draft a short reply on behalf of a small agency that offered a free business listing.

Voice: plain, warm, direct. Australian English. No exclamation marks, no marketing language, no "I hope this finds you well".
Length: 2-4 sentences. Never invent facts, prices, or commitments.
Write only the body. No subject line, no signature, no placeholders in square brackets.`;

/**
 * Draft a reply for a human to approve.
 *
 * Only ever a DRAFT — §2 requires human approval on every outgoing reply, so
 * this deliberately has no path to sending. An empty string comes back on
 * failure, which the queue renders as "write this one yourself" rather than
 * blocking the item.
 */
export async function draftReply(opts: {
  db: DB;
  classification: OutreachClassification;
  replyBody: string;
  businessName?: string | null;
  /** Included verbatim when present, so the model builds the ask around it. */
  accountLinkHint?: string | null;
}): Promise<string> {
  const intent =
    opts.classification === 'yes'
      ? 'They said yes. Confirm warmly, and tell them their account link is below and takes a minute to set up.'
      : 'They asked a question. Answer it briefly and directly, then offer to set them up.';

  try {
    return (
      await completeOnce({
        db: opts.db,
        source: 'outreach_draft',
        system: DRAFT_SYSTEM,
        prompt: [
          opts.businessName ? `Business: ${opts.businessName}` : null,
          `Their reply: ${opts.replyBody.slice(0, 2000)}`,
          `What to write: ${intent}`,
          opts.accountLinkHint ? 'Their account link will be appended after your text.' : null,
        ]
          .filter(Boolean)
          .join('\n'),
        maxTokens: 400,
        // Defaults to the cheapest model on the AI Models screen: a human reads
        // and approves every one of these, so the draft only has to be a good
        // starting point. Raise it there if approval rates say otherwise.
      })
    ).trim();
  } catch (e) {
    console.error('[outreach] draftReply failed', (e as Error).message);
    return '';
  }
}
