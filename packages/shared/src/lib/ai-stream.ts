import { apiUrl } from './trpc';
import { supabase } from './supabase';
import { PRODESK_CLIENT } from './client-id';

export interface AiAttachment {
  url: string;
  name: string;
  kind: 'image' | 'document' | 'text';
  mediaType?: string;
}

export interface AiPendingAction {
  kind:
    | 'agency_message' | 'proposal_reply' | 'marketplace_inquiry' | 'agency_connection' | 'create_task' | 'update_profile'
    | 'invite_staff_member' | 'set_brand_policy'
    | 'send_review_request' | 'create_short_link' | 'toggle_short_link' | 'create_service'
    | 'update_directory_listing' | 'create_review_location' | 'update_review_location' | 'update_review_platform'
    | 'update_review_win_tags'
    | 'create_link_campaign' | 'update_link_campaign'
    | 'add_campaign_window' | 'remove_campaign_window'
    | 'update_short_link' | 'update_qr_style' | 'save_embed_style' | 'save_embed_collection'
    | 'add_signature_members' | 'update_signature_member' | 'update_signature_settings' | 'create_signature_campaign'
    | 'create_support_ticket' | 'create_brand'
    // Chat (the messenger). Executed here, as the signed-in person, through the
    // ordinary chat procedures — the assistant writes nothing server-side. See
    // server-shared modules/ai/tools/messenger.ts.
    | 'send_chat_message' | 'create_chat_group' | 'update_chat_members' | 'rename_chat_group'
    | 'invite_to_chat' | 'answer_chat_request' | 'update_chat_conversation'
    | 'ask_user' | 'request_user_location';
  toolUseId: string;
  payload: Record<string, unknown>;
}

/**
 * Billing context a PAID action carries in `payload.billing` (mirror of the
 * server's ActionBilling) so the confirm card can disclose the charge and the
 * card it will go to before the user commits.
 */
export interface AiActionBilling {
  summary: string;
  monthlyDelta: number | null;
  currency: string;
  cardBrand: string | null;
  cardLast4: string | null;
  requiresCheckout: boolean;
}

export interface AiStreamHandlers {
  onUser?: (messageId: string) => void;
  onDelta: (text: string) => void;
  /** A completed AI bubble (one per round of model text). Fires before `onDone`. */
  onMessage?: (data: { messageId: string; content: string; timestamp: string }) => void;
  onDone: (data: { messageId: string; model: string; pendingActions: AiPendingAction[] }) => void;
  onError: (message: string) => void;
}

interface SseEvent {
  event: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

function parseSse(chunk: string): SseEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * POST to the AI streaming endpoint and dispatch its Server-Sent Events to the
 * provided handlers. Resolves when the stream ends (or aborts).
 */
export async function streamAiChat(
  params: {
    threadId: string;
    /** Client-generated uuid for the persisted user message (normal sends). */
    messageId?: string;
    content?: string;
    attachments?: AiAttachment[];
    /** AI message to regenerate — no user turn is sent or persisted. */
    regenerateMessageId?: string;
    /** Host surface the chat is embedded in (e.g. 'strategy'). Gates server-side
     *  extras like continuation suggestions. */
    surface?: string;
    signal?: AbortSignal;
  },
  handlers: AiStreamHandlers,
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let res: Response;
  try {
    res = await fetch(`${apiUrl}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-prodesk-client': PRODESK_CLIENT,
        ...(params.surface ? { 'x-prodesk-surface': params.surface } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        threadId: params.threadId,
        messageId: params.messageId,
        content: params.content ?? '',
        attachments: params.attachments ?? [],
        regenerateMessageId: params.regenerateMessageId,
      }),
      signal: params.signal,
    });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') handlers.onError((err as Error).message);
    return;
  }

  if (!res.ok || !res.body) {
    let msg = 'The assistant request failed.';
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) msg = j.error;
    } catch {
      /* non-JSON error body */
    }
    handlers.onError(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev = parseSse(chunk);
        if (!ev) continue;
        if (ev.event === 'user') handlers.onUser?.(ev.data.messageId);
        else if (ev.event === 'delta') handlers.onDelta(String(ev.data.text ?? ''));
        else if (ev.event === 'message') handlers.onMessage?.(ev.data);
        else if (ev.event === 'done') handlers.onDone(ev.data);
        else if (ev.event === 'error') handlers.onError(String(ev.data.message ?? 'Error'));
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') handlers.onError((err as Error).message);
  }
}
