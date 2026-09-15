import { and, asc, eq } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { aiPlanItems, brandKits, brandNotes, brands, chatMessages, chatThreadMembers, chatThreads } from '../../db/schema.js';
import { tryJoinBrandAiThread } from '../chat/threads.js';
import { buildSystemPrompt, buildSkillsSection } from './system-prompt.js';
import { isBetaUser } from '../feature-subscriptions/entitlements.js';
import { buildMessages, type AttachmentInput, type TurnMessage } from './memory.js';
import { buildTools, type PendingAction } from './tools.js';
import { enabledSkillTools, skillsPromptBlock } from './skills/index.js';
import { autoCompactThread } from './compaction.js';
import { addUsage, emptyUsage, priceUsage } from './pricing.js';
import { recordAiUsage } from './usage.js';
import { getDisabledFamilies, providerBundle } from './provider-config.js';
import { availableFamilies, resolveFamily } from './providers/registry.js';
import type { NeutralBlock, ProviderFamily } from './providers/types.js';

type Brand = typeof brands.$inferSelect;
type Thread = typeof chatThreads.$inferSelect;

const MAX_TOOL_ITERS = 30;
/**
 * Per-round output cap. Generous on purpose: Sonnet 5 runs ADAPTIVE THINKING by
 * default when `thinking` is omitted, and thinking tokens count against
 * max_tokens — a tight cap makes complex turns spend the budget thinking and
 * truncate the visible reply mid-sentence. Streaming, so no HTTP-timeout risk.
 */
const MAX_TOKENS = 32000;

/**
 * Card kinds that only surface TEXT for the user to copy/send manually — they
 * have no confirmable outcome, so settling them isn't worth an automatic
 * follow-up turn. Every other card kind is confirm-then-execute and auto-arms
 * the settlement follow-up (see where dedupedActions is persisted below).
 */
const DRAFT_ONLY_KINDS = new Set<string>(['agency_message', 'proposal_reply', 'marketplace_inquiry']);

/** Injected before the FINAL allowed tool round so the turn ends with a wrap-up, not mid-work. */
const WRAP_UP_NOTE =
  'SYSTEM: You have reached the tool-step limit for this reply — no further tools can run this turn. Stop working and wrap up for the user now: state plainly what you completed, what remains unfinished, and invite them to say "continue" if they want you to pick it back up. Do not claim anything happened that did not, and do not say a card is shown unless one truly was.';

function previewOf(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 120 ? t.slice(0, 117) + '…' : t || 'AI reply';
}

/**
 * Persist the brand's user turn into the AI thread: the text message plus one
 * message per attachment. Notification-exempt — we update the thread preview but
 * deliberately do NOT bump other members' unread counts or schedule digests.
 * Returns the ids so they can be excluded from the model's history window.
 */
export async function persistUserTurn(opts: {
  db: DB;
  thread: Thread;
  user: { id: string; firstName?: string | null; lastName?: string | null; email: string; profileUrl?: string | null };
  content: string;
  attachments: AttachmentInput[];
  senderBusinessName?: string | null;
  /** Optional client-generated id so optimistic UI dedupes against the realtime echo. */
  messageId?: string;
}): Promise<{ userMessageId: string; excludeIds: string[] }> {
  const { db, thread, user, content, attachments } = opts;
  const senderName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || user.email;
  const excludeIds: string[] = [];

  const [textMsg] = await db
    .insert(chatMessages)
    .values({
      ...(opts.messageId ? { id: opts.messageId } : {}),
      threadId: thread.id,
      senderId: user.id,
      senderName,
      senderAvatar: user.profileUrl,
      senderRole: 'brand',
      senderBusinessName: opts.senderBusinessName ?? null,
      content: content || null,
      type: 'text',
    })
    .returning();
  excludeIds.push(textMsg.id);

  for (const a of attachments) {
    const [m] = await db
      .insert(chatMessages)
      .values({
        threadId: thread.id,
        senderId: user.id,
        senderName,
        senderAvatar: user.profileUrl,
        senderRole: 'brand',
        content: null,
        type: a.kind === 'image' ? 'image' : 'document',
        fileUrl: a.url,
        fileName: a.name,
        thumbnailUrl: a.kind === 'image' ? a.url : null,
      })
      .returning();
    excludeIds.push(m.id);
  }

  const preview = content?.trim() || (attachments[0] ? `📎 ${attachments[0].name}` : 'Message');
  await db.update(chatThreads).set({ lastMessage: preview, lastMessageAt: new Date() }).where(eq(chatThreads.id, thread.id));
  return { userMessageId: textMsg.id, excludeIds };
}

export interface StreamResult {
  /** The final (last) AI message id — what pending actions attach to. */
  messageId: string;
  /** Every AI message persisted this turn, oldest-first. */
  messageIds: string[];
  /** The concrete model id that produced the reply (any provider family). */
  model: string;
  pendingActions: PendingAction[];
  /** True when this turn armed the settlement follow-up — the assistant will be
   *  re-invoked once the user settles the cards, so the turn has NOT landed back
   *  with the user yet (e.g. continuations should wait for the chain to end). */
  followupArmed: boolean;
}

/** A completed AI sub-message, surfaced to the client as its own chat bubble. */
export interface AiMessageEvent {
  messageId: string;
  content: string;
  timestamp: string;
}

/**
 * Run one AI reply: build memory, route the model, stream the tool-call loop,
 * and log token/cost usage. Context stays bounded by the history window in
 * buildMessages (HISTORY_CAP) plus the user's `/clear` command.
 * `onDelta` streams text chunks as they arrive. Each ROUND of model text (the
 * narration before a tool call, and the final answer) is persisted as its own
 * chat message and announced via `onMessage`, so a turn that thinks out loud
 * around tool calls renders as separate bubbles rather than one merged blob.
 */
export async function streamAiReply(opts: {
  db: DB;
  thread: Thread;
  brand: Brand;
  user: { id: string };
  client: string | null;
  content: string;
  attachments: AttachmentInput[];
  excludeIds: string[];
  onDelta: (text: string) => void;
  onMessage: (m: AiMessageEvent) => void;
  signal?: AbortSignal;
}): Promise<StreamResult> {
  const { db, thread, brand, user, content, attachments, excludeIds, onDelta, onMessage, signal } = opts;

  // Standing brand context (Context tab), this brand's AI skill opt-outs, and its
  // chosen provider family — all read in one go. `disabledSkills` decides which
  // skill playbooks go into the system prompt and which skill-gated tools (e.g.
  // web_search) are offered.
  const [note] = await db
    .select({
      context: brandNotes.context,
      disabledSkills: brandNotes.disabledSkills,
      selectedAiProvider: brandNotes.selectedAiProvider,
    })
    .from(brandNotes)
    .where(eq(brandNotes.brandId, brand.id))
    .limit(1);
  const disabledSkills = note?.disabledSkills ?? [];
  const skillTools = enabledSkillTools(disabledSkills);

  // Resolve the provider family for this turn: the brand's saved choice, gated by
  // the super-admin exclusion set (registry.resolveFamily). Falls back to the
  // first available family when the choice is unset/disabled. The caller already
  // gated on isAiEnabled(), so at least one family is configured.
  const disabledFamilies = await getDisabledFamilies(db);
  const family: ProviderFamily =
    resolveFamily({ disabled: disabledFamilies, brandChoice: note?.selectedAiProvider ?? null }) ??
    availableFamilies()[0];
  const bundle = providerBundle(family);

  // The thread's live to-do plan, fed back to the model each turn so it stays in
  // sync with the read-only panel the user watches (rather than forgetting it and
  // rebuilding a checklist in chat — the plan tool calls aren't replayed in history).
  const planItems = await db
    .select({ title: aiPlanItems.title, description: aiPlanItems.description, status: aiPlanItems.status })
    .from(aiPlanItems)
    .where(eq(aiPlanItems.threadId, thread.id))
    .orderBy(asc(aiPlanItems.position), asc(aiPlanItems.createdAt));

  const { messages, historyCount } = await buildMessages({
    db,
    threadId: thread.id,
    excludeIds,
    currentText: content,
    attachments,
    contextResetAt: thread.aiContextResetAt,
    standingContext: note?.context ?? null,
    planItems,
    compactionSummary: thread.aiContextSummary,
  });

  const model = bundle.model;

  // `skillTools` gates both the hosted web_search capability (below) and any
  // skill-locked registry tool (e.g. request_user_location from the Location skill).
  // `userId` is what the messenger tools scope every read to — a DM belongs to a
  // person, not to a brand, so passing the brand alone would leave them with no
  // safe scope at all (see tools/messenger.ts).
  const tools = buildTools({ db, brandId: brand.id, userId: user.id, threadId: thread.id, skillTools });
  // The brand kit (tagline, voice, signature defaults) is injected straight into
  // the system prompt so the assistant knows it WITHOUT a tool call. Plain read —
  // no lazy provisioning on a chat request (null = kit not opened yet).
  // A brand holds one kit per signature department; the DEFAULT one is the brand
  // kit proper (see modules/signatures/billing.ts).
  const [brandKit] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brand.id), eq(brandKits.isDefault, true)))
    .limit(1);
  // Beta access is OWNER-scoped — it's the owner's flag that actually waives
  // every charge (userHasFeature short-circuits on the owner). Stable per brand,
  // so it doesn't break prompt caching. A non-beta owner's assistant is told beta
  // access doesn't exist; a beta owner's assistant quotes prices but notes the waiver.
  const ownerIsBeta = brand.ownerId ? await isBetaUser(db, brand.ownerId) : false;
  // Two system blocks, each its own cache breakpoint. Block 1 is stable per
  // brand (role, rules, profile, brand kit, billing notice); block 2 is the
  // enabled-skills section, which the owner toggles at runtime. Splitting them
  // means a skill toggle only invalidates block 2 onward — the larger static
  // block 1 still gets a cache read. Block 2 is omitted when no skill is on.
  // System prompt as ordered cacheable segments (the provider decides how to
  // cache/join them): block 1 is stable per brand; block 2 is the enabled-skills
  // section the owner toggles at runtime. Splitting them lets a skill toggle
  // invalidate only the smaller second segment on providers with prefix caching.
  const skillsSection = buildSkillsSection(skillsPromptBlock(disabledSkills));
  const system: string[] = [
    buildSystemPrompt(brand, brandKit ?? null, ownerIsBeta),
    ...(skillsSection ? [skillsSection] : []),
  ];

  const convo: TurnMessage[] = [...messages];
  let total = emptyUsage();
  // Largest assembled-prompt size seen this turn (input + cache read + cache
  // creation). The final round carries the most history, so this ~= the turn's
  // context size — the signal auto-compaction triggers on once it lands.
  let peakPromptTokens = 0;
  let refused = false;
  const messageIds: string[] = [];

  // Persist one round of AI text as its own chat message and announce it so the
  // client renders it as a distinct bubble. No-op for empty/whitespace rounds
  // (e.g. a round that only calls tools without narrating).
  const flushRound = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text) return;
    const [m] = await db
      .insert(chatMessages)
      .values({ threadId: thread.id, senderId: null, isAi: true, senderName: 'AI', content: text, type: 'text' })
      .returning();
    messageIds.push(m.id);
    onMessage({ messageId: m.id, content: text, timestamp: m.timestamp.toISOString() });
    await db.update(chatThreads).set({ lastMessage: previewOf(text), lastMessageAt: m.timestamp }).where(eq(chatThreads.id, thread.id));
  };

  let wrapUpInjected = false;
  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    let roundText = '';
    // Last allowed round: force a text wrap-up instead of letting the turn die
    // mid-work — no more tools may run, and the model is told to close out
    // honestly (what's done, what's left, "say continue to resume").
    const finalIter = iter === MAX_TOOL_ITERS - 1;
    if (finalIter && iter > 0 && !wrapUpInjected) {
      wrapUpInjected = true;
      convo.push({ role: 'user', content: [{ type: 'text', text: WRAP_UP_NOTE }] });
    }

    // web_search is unlocked by the Competitor Research skill — offer it only when
    // an enabled skill provides it. Deferred tool-loading (Anthropic tool search)
    // and the concrete hosted web-search wiring live inside the provider; chat.ts
    // just passes the neutral tool list + the webSearch intent.
    const stream = bundle.provider.stream({
      modelId: model,
      maxTokens: MAX_TOKENS,
      system,
      tools: tools.toolDefs,
      webSearch: skillTools.has('web_search'),
      messages: convo,
      toolChoiceNone: finalIter,
      signal,
    });
    stream.onText((delta) => {
      roundText += delta;
      onDelta(delta);
    });

    let result;
    try {
      result = await stream.final();
    } catch (err) {
      // Client hit "stop" (or the connection dropped) — keep whatever streamed.
      if (signal?.aborted || (err as Error)?.name === 'AbortError') {
        await flushRound(roundText);
        break;
      }
      throw err;
    }

    const roundUsage = priceUsage(model, result.usage);
    total = addUsage(total, roundUsage);
    const roundPrompt = roundUsage.inputTokens + roundUsage.cacheReadTokens + roundUsage.cacheCreationTokens;
    if (roundPrompt > peakPromptTokens) peakPromptTokens = roundPrompt;

    // Preserve the full assistant content (text + tool_use + any provider-native
    // blocks) so the next round replays it verbatim.
    convo.push({ role: 'assistant', content: result.assistantContent });

    if (result.stopReason === 'refusal') {
      refused = true;
      break;
    }

    // A hosted server-tool loop (e.g. Anthropic tool search) can pause the turn.
    // Persist any narration and re-send — the provider resumes where it left off.
    if (result.stopReason === 'pause') {
      await flushRound(roundText);
      continue;
    }

    // Turn ended without a tool call — persist the final answer as its own bubble.
    if (result.stopReason !== 'tool_use') {
      await flushRound(roundText);
      break;
    }

    // Persist this round's narration (the text before a tool call) as its own bubble.
    await flushRound(roundText);

    // Execute every tool call from this round concurrently (the model may fan out
    // several parallel calls) and return ALL results in one user message —
    // splitting them across messages trains the model to stop parallelising. A
    // thrown tool error is isolated to its own tool_result (isError) so one
    // failing read never kills the whole reply.
    if (result.toolUses.length === 0) break;
    const results: NeutralBlock[] = await Promise.all(
      result.toolUses.map(async (tu): Promise<NeutralBlock> => {
        try {
          const out = await tools.runTool(tu.name, tu.input ?? {}, tu.id);
          return { type: 'tool_result', toolUseId: tu.id, toolName: tu.name, content: JSON.stringify(out) };
        } catch (err) {
          console.error(`[ai] tool ${tu.name} failed`, (err as Error).message);
          return {
            type: 'tool_result',
            toolUseId: tu.id,
            toolName: tu.name,
            content: JSON.stringify({ error: 'The tool failed unexpectedly. Tell the user this part could not be completed — do not retry the same call.' }),
            isError: true,
          };
        }
      }),
    );
    convo.push({ role: 'user', content: results });
  }

  // Fallbacks: a refusal (or any turn) that produced no text still needs a reply.
  if (refused && messageIds.length === 0) {
    await flushRound("I'm sorry, I can't help with that request. Is there something else about other services provided that I can help with?");
  }
  if (messageIds.length === 0) {
    await flushRound('Sorry — I ran into an issue generating a reply. Please try again.');
  }
  const lastMessageId = messageIds[messageIds.length - 1];

  // Drop exact-duplicate cards (same kind + same target payload) a model may have
  // proposed by calling the same confirm tool twice in one turn — the user should
  // see one card per distinct change, never two identical ones. toolUseId differs
  // per call, so compare on kind + payload only.
  const dedupedActions: PendingAction[] = [];
  const seenActions = new Set<string>();
  for (const a of tools.pendingActions) {
    const key = `${a.kind}:${JSON.stringify(a.payload)}`;
    if (seenActions.has(key)) continue;
    seenActions.add(key);
    dedupedActions.push(a);
  }

  // Arm the settlement follow-up whenever the turn shows a card the model is
  // driving TOWARD an outcome (anything other than a pure copy/paste draft).
  // The model is supposed to opt in with request_settlement_followup, but it
  // routinely forgets — and a forgotten opt-in silently strands a multi-step
  // setup: the user settles the card and nothing happens. Auto-arming closes
  // that gap; the follow-up turn itself decides whether real work remains
  // (continue) or not (a brief acknowledgement, then stop — see
  // runSettlementFollowup's prompt), so the chain self-terminates and this is
  // safe to default on. Pure drafts (agency_message / proposal_reply /
  // marketplace_inquiry) have no outcome worth reacting to, so we don't arm on
  // those unless the model explicitly asked. `ask_user` already sets the flag.
  const hasActionableCard = dedupedActions.some((a) => !DRAFT_ONLY_KINDS.has(a.kind));
  const followupArmed =
    !!lastMessageId && dedupedActions.length > 0 && (tools.flags.settlementFollowup || hasActionableCard);

  // Persist any confirm-action cards onto the turn's final message so the card
  // survives a reload (and is shared across the brand team) — the client re-renders
  // it from history until the action is confirmed/dismissed. Best-effort.
  if (lastMessageId && dedupedActions.length) {
    await db
      .update(chatMessages)
      .set({
        pendingActions: dedupedActions,
        awaitSettlementFollowup: followupArmed,
      })
      .where(eq(chatMessages.id, lastMessageId))
      .catch((e) => console.error('[ai] persist pending actions failed', (e as Error).message));
  }

  // Spend tracking (best-effort — never block the reply on logging failure). One
  // row per turn, keyed to the final message; `total` is accumulated across the
  // whole tool-call loop.
  await recordAiUsage({
    db,
    source: 'chat',
    model,
    computed: total,
    brandId: brand.id,
    threadId: thread.id,
    messageId: lastMessageId,
    userId: user.id,
    client: opts.client,
  });

  // Automatic compaction: once a thread's context grows past the threshold, fold
  // the older messages into a running summary and move the boundary — so the next
  // turn starts lean instead of replaying an ever-growing history. Fire-and-forget
  // and decoupled from the SSE lifecycle (like continuations): a closed stream
  // must not abort it, and it must never delay this reply or its cards. Skipped
  // while a settlement follow-up is armed — the turn isn't really over yet, so we
  // let the chain finish (and compact then) rather than reset context mid-flow.
  // The divider it drops reaches clients over the normal chat realtime channel.
  if (lastMessageId && !refused && !followupArmed) {
    void autoCompactThread({
      db,
      thread: { id: thread.id, aiContextResetAt: thread.aiContextResetAt, aiContextSummary: thread.aiContextSummary },
      promptTokens: peakPromptTokens,
      historyCount,
      family,
      brandId: brand.id,
      userId: user.id,
      client: opts.client,
    });
  }

  return { messageId: lastMessageId, messageIds, model, pendingActions: dedupedActions, followupArmed };
}

/**
 * Resolve an AI thread the user is allowed to use, or null.
 *
 * Access is granted by the brand roster, NOT by the chat_thread_members snapshot
 * taken when the thread was created: a brand owner or active brand staff member
 * who has no member row (staff added outside the invite flow, ownership
 * transfer, seeded data) is admitted and the missing rows are backfilled, so the
 * thread also becomes readable through the normal chat procedures.
 */
export async function loadAiThreadForUser(
  db: DB,
  threadId: string,
  userId: string,
): Promise<{ thread: Thread; brand: Brand } | null> {
  const thread = (await db.select().from(chatThreads).where(eq(chatThreads.id, threadId)).limit(1))[0];
  if (!thread || thread.type !== 'ai' || !thread.brandId) return null;
  const brand = (await db.select().from(brands).where(eq(brands.id, thread.brandId)).limit(1))[0];
  if (!brand) return null;

  const member = (
    await db
      .select({ threadId: chatThreadMembers.threadId })
      .from(chatThreadMembers)
      .where(and(eq(chatThreadMembers.threadId, threadId), eq(chatThreadMembers.userId, userId)))
      .limit(1)
  )[0];
  if (!member && !(await tryJoinBrandAiThread(userId, threadId, db))) return null;
  return { thread, brand };
}
