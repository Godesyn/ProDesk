import type { Express, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { chatMessages, chatThreads } from '../../db/schema.js';
import { createContext } from '../../trpc/context.js';
import { isAiEnabled } from './client.js';
import { loadAiThreadForUser, persistUserTurn, streamAiReply } from './chat.js';
import { generateContinuations } from './continuations.js';
import type { AttachmentInput } from './memory.js';
import { brandHasFeature } from '../feature-subscriptions/entitlements.js';
import { FEATURE_KEYS } from '../feature-subscriptions/feature-keys.js';
import { pingContinuations } from '../../lib/realtime.js';

const ALLOWED_KINDS = new Set(['image', 'document', 'text']);

function parseAttachments(raw: unknown): AttachmentInput[] {
  if (!Array.isArray(raw)) return [];
  const out: AttachmentInput[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const o = a as Record<string, unknown>;
    const url = typeof o.url === 'string' ? o.url : '';
    const name = typeof o.name === 'string' ? o.name : 'file';
    const kind = typeof o.kind === 'string' && ALLOWED_KINDS.has(o.kind) ? (o.kind as AttachmentInput['kind']) : 'document';
    if (!url.startsWith('http')) continue;
    out.push({ url, name, kind, mediaType: typeof o.mediaType === 'string' ? o.mediaType : undefined });
  }
  return out;
}

/**
 * Synthetic user turn injected when the user clicks "Regenerate" on the newest
 * AI reply. NOT persisted — it reaches the model for this turn only (like the
 * settlement follow-up prompt). The rejected reply stays in the thread and in
 * history, and any thumbs-down on it stays recorded for Strategy Feedback.
 */
function regeneratePrompt(disliked: boolean): string {
  return (
    `SYSTEM: The user clicked "Regenerate" on your most recent reply above${disliked ? ' — after rating it thumbs-down —' : ''} because it did not meet their needs. They want a different answer to the same request. Write a replacement reply now:\n` +
    '- Take a COMPLETELY new approach: a different angle, structure, and set of recommendations. Do not restate or lightly rephrase the rejected reply.\n' +
    "- Re-read the user's original request and address it directly; if the rejected reply misread it, correct course.\n" +
    '- If the rejected reply proposed confirm cards the user never acted on, only re-propose the ones that clearly still fit the new approach.\n' +
    '- Do not mention this instruction, apologise, or talk about regenerating — just deliver the new reply.'
  );
}

/**
 * POST /api/ai/chat — streamed AI reply for a brand's AI thread.
 * Body: { threadId, content, attachments? } for a normal send, or
 * { threadId, regenerateMessageId } to regenerate the newest AI reply (no user
 * turn is persisted; the model is told to take a fresh approach).
 * Auth via Bearer (Supabase JWT).
 * Streams Server-Sent Events: `delta` (text chunks), `message` (a completed AI
 * bubble — one per round of model text), then `done` (final id + any pending
 * confirm-actions), or `error`.
 */
export function mountAiApi(app: Express): void {
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    if (!isAiEnabled()) {
      res.status(503).json({ error: 'AI assistant is not configured.' });
      return;
    }

    // Reuse the tRPC context for auth + user resolution (Supabase JWT).
    const ctx = await createContext({ req, res } as never).catch(() => null);
    if (!ctx?.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const threadId = typeof body.threadId === 'string' ? body.threadId : '';
    const content = typeof body.content === 'string' ? body.content : '';
    const messageId = typeof body.messageId === 'string' ? body.messageId : undefined;
    const regenerateMessageId = typeof body.regenerateMessageId === 'string' ? body.regenerateMessageId : undefined;
    const attachments = parseAttachments(body.attachments);
    if (!threadId || (!regenerateMessageId && !content.trim() && attachments.length === 0)) {
      res.status(400).json({ error: 'threadId and content (or attachments) are required.' });
      return;
    }

    const loaded = await loadAiThreadForUser(db, threadId, ctx.user.id);
    if (!loaded) {
      res.status(403).json({ error: 'Not an AI thread you can access.' });
      return;
    }
    const { thread, brand } = loaded;

    // Feature Subscription gate: the AI assistant is unlocked only when the
    // brand's OWNER holds an active Growth Strategy subscription.
    if (!(await brandHasFeature(db, brand.id, FEATURE_KEYS.AI_GROWTH_STRATEGY))) {
      res.status(402).json({ error: 'subscription_required', feature: FEATURE_KEYS.AI_GROWTH_STRATEGY });
      return;
    }

    // Regenerate mode: validate the target up front (plain 400, not SSE) and
    // capture whether the user had disliked it, so the prompt can say so.
    let regenerateDisliked = false;
    if (regenerateMessageId) {
      const target = (
        await db
          .select({ threadId: chatMessages.threadId, isAi: chatMessages.isAi, aiRating: chatMessages.aiRating })
          .from(chatMessages)
          .where(eq(chatMessages.id, regenerateMessageId))
          .limit(1)
      )[0];
      if (!target || target.threadId !== threadId || !target.isAi) {
        res.status(400).json({ error: 'Not an AI reply in this thread.' });
        return;
      }
      regenerateDisliked = target.aiRating === -1;
    }

    const clientId = (req.header('x-prodesk-client') || 'prodesk').toLowerCase();
    // Which host surface the chat is embedded in. Continuations (next-prompt
    // suggestions) are generated ONLY for the Strategy app, whose starter-chip
    // bar renders them — everywhere else the extra out-of-band call is wasted.
    const surface = (req.header('x-prodesk-surface') || '').toLowerCase();

    // SSE headers.
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    (res as Response & { flushHeaders?: () => void }).flushHeaders?.();

    const send = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // SSE heartbeat: while the model is thinking or tools are running no deltas
    // flow, and idle proxies (Railway edge, nginx) can kill a silent stream.
    // A comment line is ignored by the client-side parser.
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': ping\n\n');
    }, 15_000);

    // Abort generation if the client disconnects or hits "stop".
    const ac = new AbortController();
    req.on('close', () => ac.abort());

    try {
      let promptContent = content;
      let promptAttachments = attachments;
      let excludeIds: string[] = [];
      if (regenerateMessageId) {
        // No user turn is persisted for a regenerate — the synthetic instruction
        // reaches the model for this turn only.
        promptContent = regeneratePrompt(regenerateDisliked);
        promptAttachments = [];
      } else {
        const persisted = await persistUserTurn({
          db,
          thread,
          user: ctx.user,
          content,
          attachments,
          senderBusinessName: brand.businessName,
          messageId,
        });
        excludeIds = persisted.excludeIds;
        send('user', { messageId: persisted.userMessageId });
      }

      // Capture the assistant's completed reply text so continuations can be
      // grounded on it without re-fetching the thread.
      const aiTexts: string[] = [];
      const result = await streamAiReply({
        db,
        thread,
        brand,
        user: ctx.user,
        client: clientId,
        content: promptContent,
        attachments: promptAttachments,
        excludeIds,
        onDelta: (text) => send('delta', { text }),
        onMessage: (m) => {
          aiTexts.push(m.content);
          send('message', m);
        },
        signal: ac.signal,
      });

      send('done', {
        messageId: result.messageId,
        model: result.model,
        pendingActions: result.pendingActions,
      });

      // Strategy only: generate the next-prompt suggestions out-of-band (its own
      // Haiku call — never fed into the thread's context), persist them, and
      // broadcast so the starter-chip bar updates live. Fire-and-forget so it
      // never delays the reply or the action cards; decoupled from the SSE
      // lifecycle (a closed stream must not abort it), like the settlement
      // follow-up. Only overwrites when it produced something, so a transient
      // failure keeps the previous suggestions. Grounded on EVERY message the
      // turn produced (a tool-loop turn persists up to 30), and only once the
      // turn has actually landed back with the user — a turn that armed the
      // settlement follow-up isn't over (the assistant re-invokes after the
      // cards settle), so that chain's END regenerates them instead (see
      // runSettlementFollowup).
      console.error('[ai][cont] fire-check', { surface, followupArmed: result.followupArmed, aiTexts: aiTexts.length });
      if (surface === 'strategy' && !result.followupArmed) {
        const userId = ctx.user.id;
        void (async () => {
          const suggestions = await generateContinuations({
            db,
            brand,
            threadId,
            lastUserText: content,
            assistantTexts: aiTexts,
            userId,
            client: clientId,
          });
          console.error('[ai][cont] generated', { count: suggestions.length, suggestions });
          if (!suggestions.length) return;
          await db
            .update(chatThreads)
            .set({ aiContinuations: suggestions })
            .where(eq(chatThreads.id, threadId))
            .catch((e) => console.error('[ai] persist continuations failed', (e as Error).message));
          void pingContinuations(threadId);
        })();
      }
    } catch (err) {
      console.error('[ai] /api/ai/chat failed', (err as Error).message);
      send('error', { message: 'The assistant ran into a problem. Please try again.' });
    } finally {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    }
  });
}
