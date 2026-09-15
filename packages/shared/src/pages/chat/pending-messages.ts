import { useCallback, useEffect, useState } from 'react';

/**
 * An outgoing message that hasn't been confirmed by the server yet. Rendered
 * optimistically in the thread the instant the user presses send, then removed
 * once the real row lands (or flipped to `failed` so it can be retried/deleted).
 * Persisted per-thread in sessionStorage so failed sends survive a refresh.
 */
export interface PendingMessage {
  /** Client-generated temp id (never collides with server uuids). */
  id: string;
  threadId: string;
  content: string | null;
  type: 'text' | 'image' | 'video' | 'document';
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  thumbnailUrl: string | null;
  projectId: string | null;
  /** The message this one answers, so a retry still quotes the right thing. */
  replyToId?: string | null;
  senderRole?: string;
  senderBusinessName?: string;
  /** `sending` shows a faded spinner; `failed` shows the red retry/delete card. */
  status: 'sending' | 'failed';
  /** Client timestamp, used for ordering + the meta time label. */
  timestamp: string;
  error?: string;
}

const STORAGE_PREFIX = 'prodesk.chat.pending.';
const keyFor = (threadId: string) => `${STORAGE_PREFIX}${threadId}`;

function loadPending(threadId: string): PendingMessage[] {
  try {
    const raw = sessionStorage.getItem(keyFor(threadId));
    if (!raw) return [];
    const list = JSON.parse(raw) as PendingMessage[];
    // Anything still "sending" when the tab closed never finished its request —
    // surface it as failed so the user can retry or discard it.
    return list.map((p) => (p.status === 'sending' ? { ...p, status: 'failed', error: p.error ?? 'Interrupted' } : p));
  } catch {
    return [];
  }
}

/**
 * Per-thread store of optimistic outgoing messages, mirrored into sessionStorage
 * so failed sends reload when the thread is reopened/refreshed.
 */
export function usePendingMessages(threadId: string) {
  const [pending, setPending] = useState<PendingMessage[]>(() => loadPending(threadId));

  // Reload when switching threads.
  useEffect(() => {
    setPending(loadPending(threadId));
  }, [threadId]);

  // Persist on every change (drop the key entirely when empty).
  useEffect(() => {
    try {
      if (pending.length) sessionStorage.setItem(keyFor(threadId), JSON.stringify(pending));
      else sessionStorage.removeItem(keyFor(threadId));
    } catch {
      // sessionStorage may be unavailable (private mode / quota) — non-fatal.
    }
  }, [threadId, pending]);

  const add = useCallback((p: PendingMessage) => setPending((prev) => [...prev, p]), []);
  const update = useCallback(
    (id: string, patch: Partial<PendingMessage>) => setPending((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    [],
  );
  const remove = useCallback((id: string) => setPending((prev) => prev.filter((p) => p.id !== id)), []);

  return { pending, add, update, remove };
}
