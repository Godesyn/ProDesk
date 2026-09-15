import { and, desc, eq, gt, ne } from 'drizzle-orm';
import type { DB } from '../../db/index.js';
import { chatMessages } from '../../db/schema.js';
import type { NeutralBlock, NeutralMessage } from './providers/types.js';

/** One conversation message in the provider-neutral shape (see providers/types). */
export type TurnMessage = NeutralMessage;

export interface AttachmentInput {
  url: string;
  name: string;
  kind: 'image' | 'document' | 'text';
  mediaType?: string;
}

// How many recent thread messages we feed the model. This window (plus the
// user's `/clear` command) is what bounds context on long threads — history is
// replayed as compact text, so 200 messages stays comfortably inside the
// model's context window.
const HISTORY_CAP = 200;
const TEXT_ATTACHMENT_MAX_CHARS = 50_000;
const PDF_ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
const IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** Hard cap on fetching one attachment — a hung URL must not stall the reply. */
const ATTACHMENT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Build the Anthropic `messages` array for one AI turn: prior thread history
 * (most recent HISTORY_CAP, oldest-first) followed by the current user turn with
 * its attachment content blocks. `excludeIds` are the messages we just persisted
 * for this turn (so we don't double-count them in history). `contextResetAt`, when
 * set (by the user's `/clear` command), restricts history to messages strictly
 * after that instant — the model has no memory of the conversation before it.
 */
/** Friendly labels for confirm-card kinds, for the outcome note fed back to the model. */
const CARD_LABELS: Record<string, string> = {
  agency_connection: 'Connect with agency',
  agency_message: 'Message to agency (draft)',
  proposal_reply: 'Proposal reply (draft)',
  marketplace_inquiry: 'Marketplace inquiry (draft)',
  create_task: 'Create task',
  update_profile: 'Update brand profile',
  invite_staff_member: 'Invite team member',
  set_brand_policy: 'Add/edit company policy',
  send_review_request: 'Send review request',
  create_short_link: 'Create short link',
  toggle_short_link: 'Activate/deactivate short link',
  update_short_link: 'Edit short link',
  create_service: 'Create service',
  update_directory_listing: 'Update directory listing',
  create_review_location: 'Create review location',
  update_review_location: 'Update review location',
  update_review_platform: 'Set review-platform link',
  update_review_win_tags: 'Replace win-tags',
  create_link_campaign: 'Create link campaign',
  update_link_campaign: 'Edit link campaign',
  add_campaign_window: 'Schedule campaign window',
  remove_campaign_window: 'Remove campaign window',
  update_qr_style: 'Restyle QR code',
  save_embed_style: 'Restyle review embed',
  save_embed_collection: 'Save embed collection',
  add_signature_members: 'Add signature members',
  update_signature_member: 'Edit signature member',
  update_signature_settings: 'Update signature settings',
  create_signature_campaign: 'Create signature campaign',
  create_support_ticket: 'Create support ticket',
  create_brand: 'Create new brand',
  ask_user: 'Question form',
  request_user_location: 'Share location',
};

/** One-line summary of a values map (proposed changes or the user's final edits). */
function summarizeValues(v: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, val] of Object.entries(v)) {
    if (val == null || val === '') continue;
    let s = Array.isArray(val) ? val.join(', ') : typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (s.length > 120) s = `${s.slice(0, 117)}…`;
    parts.push(`${k}=${s}`);
    if (parts.length >= 8) break;
  }
  return parts.join('; ');
}

type PendingCard = { kind: string; toolUseId: string; payload: Record<string, unknown> };

/** One item of the AI-owned to-do plan, as fed back to the model each turn. */
export type PlanSnapshotItem = { title: string; description: string; status: string };

const PLAN_STATUS_MARK: Record<string, string> = {
  done: '✅ done',
  in_progress: '⏳ in progress',
  pending: '⬜ pending',
};

/**
 * Render the current to-do plan as a bracketed awareness note injected into every
 * turn. WITHOUT this the model never sees the plan it wrote on a past turn — the
 * plan tool calls/results live only inside the turn that made them and are never
 * replayed from history — so it forgets the plan exists and rebuilds a fresh
 * checklist in chat each time. Feeding the live plan back makes it TICK and EDIT
 * the existing plan (by position) instead of restarting.
 */
export function describePlan(items: PlanSnapshotItem[]): string {
  if (!items.length) return '';
  const lines = items.map((it, i) => {
    const mark = PLAN_STATUS_MARK[it.status] ?? it.status;
    const detail = it.description?.trim() ? ` — ${it.description.trim().replace(/\s+/g, ' ').slice(0, 200)}` : '';
    return `${i + 1}. [${mark}] ${it.title}${detail}`;
  });
  return [
    "[Your current to-do plan (this is what the user sees live in their To-Do panel — they do NOT see this note; it's here so you stay in sync with it):",
    ...lines,
    'This is the SINGLE source of truth for the plan. As you work, keep it current with update_plan_item (tick a step in_progress then done, or edit its title/description by position) — do NOT rebuild it with set_plan unless the task fundamentally changed, and do NOT restate this checklist or your progress in your chat reply; the panel already shows it.]',
  ].join('\n');
}

/**
 * Build the bracketed note that tells the model what became of the confirm cards
 * it proposed on a past turn: confirmed (with the FINAL applied values, so it sees
 * the user's edits), dismissed, or ignored (shown but never acted on).
 */
function describeCardOutcomes(
  cards: PendingCard[],
  outcomes: Record<string, 'confirmed' | 'rejected'>,
  edits: Record<string, Record<string, unknown>>,
): string {
  const lines = cards.map((c) => {
    const label = CARD_LABELS[c.kind] ?? c.kind;
    const outcome = outcomes[c.toolUseId];
    // ask_user is a question form, not a write action — phrase its outcome as the
    // user's ANSWERS so the model can act on them, not as a change that was applied.
    if (c.kind === 'ask_user') {
      if (outcome === 'confirmed') {
        const answers = summarizeValues(edits[c.toolUseId] ?? {});
        return answers
          ? `- "${label}": the user ANSWERED — ${answers}. Use these answers to continue; treat them as the user's own input.`
          : `- "${label}": the user submitted the form but left every field blank — treat it as no answer given.`;
      }
      if (outcome === 'rejected') {
        return `- "${label}": the user DISMISSED the question without answering — don't re-ask the same form; proceed without it or ask differently only if it still matters.`;
      }
      return `- "${label}": still shown to the user, who has not answered yet.`;
    }
    // request_user_location, like ask_user, writes nothing — its "edits" carry the
    // shared coords/place. Phrase the outcome as the user's own locale so the model
    // can act on it, never as a change that was applied.
    if (c.kind === 'request_user_location') {
      if (outcome === 'confirmed') {
        const e = edits[c.toolUseId] ?? {};
        // A browser share resolves city/region/country; a manual Places search
        // carries a formatted `address`. Prefer whichever is present.
        const place = e.address ? String(e.address) : [e.city, e.region, e.country].filter(Boolean).join(', ');
        const hasCoords = e.latitude != null && e.longitude != null;
        const coords = hasCoords ? ` (approx. ${e.latitude}, ${e.longitude})` : '';
        if (place) {
          return `- "${label}": the user SHARED their location — ${place}${coords}. Treat this as their current, approximate locale and their own input.`;
        }
        if (hasCoords) {
          return `- "${label}": the user SHARED their coordinates${coords} (no place name resolved). Treat this as their approximate locale.`;
        }
        return `- "${label}": the user allowed location but nothing usable came back — treat it as not shared.`;
      }
      if (outcome === 'rejected') {
        return `- "${label}": the user DECLINED to share their location — don't re-surface the card; continue without it, or ask them to type their city only if it still matters.`;
      }
      return `- "${label}": still shown to the user, who has not shared their location yet.`;
    }
    if (outcome === 'confirmed') {
      // Prefer the user's final edited values; fall back to the proposed changes/payload.
      const final = edits[c.toolUseId] ?? (c.payload.changes as Record<string, unknown> | undefined) ?? c.payload;
      const summary = summarizeValues(final);
      return `- "${label}": CONFIRMED and applied${summary ? ` with ${summary}` : ''}.`;
    }
    if (outcome === 'rejected') {
      return `- "${label}": DISMISSED by the user — do not silently re-propose it; ask first if it still seems relevant.`;
    }
    return `- "${label}": IGNORED — shown to the user, who moved on without confirming or dismissing it.`;
  });
  if (!lines.length) return '';
  return [
    '[Outcome of the confirm card(s) you proposed here (for your awareness — the user does not see this note):',
    ...lines,
    'Take these outcomes into account: acknowledge confirmed changes (and any edits the user made), and never claim something was applied unless it says CONFIRMED.]',
  ].join('\n');
}

export async function buildMessages(opts: {
  db: DB;
  threadId: string;
  excludeIds: string[];
  currentText: string;
  attachments: AttachmentInput[];
  contextResetAt?: Date | null;
  /** Standing brand context the owner set (Context tab) — always prepended as a
   *  leading user turn, so it survives `/clear` and the HISTORY_CAP window and is
   *  treated as the user's own words. */
  standingContext?: string | null;
  /** The thread's current AI-owned to-do plan (ai_plan_items), oldest-first. Fed
   *  back to the model each turn so it stays synced with the panel the user sees. */
  planItems?: PlanSnapshotItem[];
  /** Running summary of the conversation from the user's `/compact` command. Like
   *  standingContext it's a leading user turn that survives the reset boundary, so
   *  the model keeps the gist of the messages that dropped out of the window. */
  compactionSummary?: string | null;
}): Promise<{ messages: TurnMessage[]; historyCount: number }> {
  const { db, threadId, excludeIds, currentText, attachments, contextResetAt, standingContext, planItems, compactionSummary } = opts;

  const rows = await db
    .select({
      id: chatMessages.id,
      content: chatMessages.content,
      isAi: chatMessages.isAi,
      type: chatMessages.type,
      fileName: chatMessages.fileName,
      pendingActions: chatMessages.pendingActions,
      actionOutcomes: chatMessages.actionOutcomes,
      actionEdits: chatMessages.actionEdits,
    })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.threadId, threadId),
        ne(chatMessages.type, 'system'),
        contextResetAt ? gt(chatMessages.timestamp, contextResetAt) : undefined,
      ),
    )
    .orderBy(desc(chatMessages.timestamp), desc(chatMessages.id))
    .limit(HISTORY_CAP + excludeIds.length);

  const exclude = new Set(excludeIds);
  const history: TurnMessage[] = rows
    .filter((r) => !exclude.has(r.id))
    .reverse() // oldest-first
    .map((r) => {
      const role: TurnMessage['role'] = r.isAi ? 'assistant' : 'user';
      let text = r.content ?? '';
      if (!text && r.fileName) text = `[attachment: ${r.fileName}]`;
      else if (r.fileName && r.type !== 'text') text = `${text}\n[attachment: ${r.fileName}]`;
      // Surface the fate of any confirm cards this assistant turn proposed. History
      // is text-only, so without this the model never learns whether the user
      // confirmed, dismissed, edited, or ignored a card it showed. Any card still
      // without an outcome here is necessarily older than the current turn → the
      // user moved on without acting on it ("ignored").
      if (r.isAi && r.pendingActions?.length) {
        const note = describeCardOutcomes(r.pendingActions, r.actionOutcomes ?? {}, r.actionEdits ?? {});
        if (note) text = `${text ? `${text}\n\n` : ''}${note}`;
      }
      return { role, content: text || '(no content)' };
    });

  // The API requires the first message to be from the user. Drop any leading
  // assistant turns left at the front after windowing.
  while (history.length && history[0].role === 'assistant') history.shift();

  const attachmentBlocks = await buildAttachmentBlocks(attachments);
  // The live plan is injected as a leading block on the current turn (not a stable
  // preamble): it changes turn to turn, so it can't live in the cached prefix, and
  // it must reflect the latest state on every reply. Bracketed as awareness so the
  // model never echoes it as if the user typed it.
  const planNote = planItems?.length ? describePlan(planItems) : '';
  const currentBlocks: NeutralBlock[] = [
    ...attachmentBlocks,
    ...(planNote ? [{ type: 'text' as const, text: planNote }] : []),
    { type: 'text', text: currentText || '(see attachment)' },
  ];

  // Standing context is a stable leading USER turn placed before all history, so
  // it's always present regardless of `/clear` or the history window, and reads
  // as the user's own words (their lean over a system-prompt injection). It stays
  // byte-identical across turns, so the prompt-cache prefix still holds.
  const preamble: TurnMessage[] = [];
  if (standingContext?.trim()) {
    preamble.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'Standing context I want you to keep in mind for our whole conversation ' +
            '(it always applies unless I say otherwise):\n\n' +
            standingContext.trim(),
        },
      ],
    });
  }
  // The `/compact` recap follows the standing context: earlier messages were
  // summarised out of the window, so this stands in for them. Bracketed as a
  // recap the assistant should treat as established fact, not something the user
  // just typed. Stable between compactions, so the prompt-cache prefix still holds.
  if (compactionSummary?.trim()) {
    preamble.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            '[Recap of our conversation so far, from earlier messages that are no longer shown in full. ' +
            'Treat it as established context and carry on from here — do not repeat it back to me:]\n\n' +
            compactionSummary.trim(),
        },
      ],
    });
  }

  const messages: TurnMessage[] = [...preamble, ...history, { role: 'user', content: currentBlocks }];

  return { messages, historyCount: history.length };
}

/**
 * Fetch + normalise attachments into provider-neutral blocks. Images and
 * documents are inlined as base64 (not a URL) because not every provider can
 * fetch an arbitrary URL server-side; each provider then renders them natively.
 */
async function buildAttachmentBlocks(attachments: AttachmentInput[]): Promise<NeutralBlock[]> {
  const blocks: NeutralBlock[] = [];
  for (const a of attachments) {
    try {
      if (a.kind === 'image') {
        const res = await fetch(a.url, { signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > IMAGE_ATTACHMENT_MAX_BYTES) {
          blocks.push({ type: 'text', text: `[Image "${a.name}" is too large to include.]` });
          continue;
        }
        const mediaType = a.mediaType || res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
        blocks.push({ type: 'image', mediaType, dataBase64: buf.toString('base64') });
      } else if (a.kind === 'document') {
        const res = await fetch(a.url, { signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > PDF_ATTACHMENT_MAX_BYTES) {
          blocks.push({ type: 'text', text: `[Attachment "${a.name}" is too large to read in full.]` });
          continue;
        }
        blocks.push({
          type: 'document',
          name: a.name,
          mediaType: a.mediaType || 'application/pdf',
          dataBase64: buf.toString('base64'),
        });
      } else {
        const res = await fetch(a.url, { signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS) });
        if (!res.ok) throw new Error(`fetch ${res.status}`);
        let text = await res.text();
        if (text.length > TEXT_ATTACHMENT_MAX_CHARS) {
          text = text.slice(0, TEXT_ATTACHMENT_MAX_CHARS) + '\n…[truncated]';
        }
        blocks.push({ type: 'text', text: `Attached file "${a.name}":\n\n${text}` });
      }
    } catch (err) {
      blocks.push({ type: 'text', text: `[Could not read attachment "${a.name}": ${(err as Error).message}]` });
    }
  }
  return blocks;
}
