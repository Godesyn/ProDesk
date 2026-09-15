import { useSyncExternalStore } from 'react';

/**
 * Composer drafts, per thread.
 *
 * A module store rather than context, and that is the whole point: a keystroke in
 * the composer must re-render the textarea and nothing else. Put drafts in a
 * provider and every message in view re-renders on every character, which is how
 * a chat UI ends up feeling heavy at exactly the moment it should feel weightless.
 *
 * Persisted to `localStorage`, NOT sessionStorage. Half a message you were writing
 * has to survive closing the tab and coming back tomorrow — that is different
 * from the outgoing retry queue (pending-messages.ts), which is correctly
 * ephemeral because a queued send should not resurrect a week later.
 */

const KEY = (threadId: string) => `prodesk.chat.draft.${threadId}`;
const WRITE_DEBOUNCE_MS = 300;

const drafts = new Map<string, string>();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((fn) => fn());
}

function persist(threadId: string, value: string) {
  const existing = timers.get(threadId);
  if (existing) clearTimeout(existing);
  timers.set(
    threadId,
    setTimeout(() => {
      timers.delete(threadId);
      try {
        if (value) localStorage.setItem(KEY(threadId), value);
        else localStorage.removeItem(KEY(threadId));
      } catch {
        /* private mode / quota — the in-memory draft still works this session */
      }
    }, WRITE_DEBOUNCE_MS),
  );
}

/** The draft for a thread, hydrating from storage on first read. */
export function readDraft(threadId: string): string {
  const cached = drafts.get(threadId);
  if (cached !== undefined) return cached;
  let stored = '';
  try {
    stored = localStorage.getItem(KEY(threadId)) ?? '';
  } catch {
    /* ignore */
  }
  drafts.set(threadId, stored);
  return stored;
}

export function setDraft(threadId: string, value: string): void {
  if (drafts.get(threadId) === value) return;
  drafts.set(threadId, value);
  persist(threadId, value);
  emit();
}

export function clearDraft(threadId: string): void {
  setDraft(threadId, '');
}

/** Subscribe to draft changes — used by the inbox to show `Draft: …` on a row. */
export function useDraft(threadId: string | null): string {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (threadId ? readDraft(threadId) : ''),
    () => '',
  );
}

/** Wipe every draft — sign-out, so the next person on the device sees nothing. */
export function clearAllDrafts(): void {
  for (const threadId of drafts.keys()) {
    try {
      localStorage.removeItem(KEY(threadId));
    } catch {
      /* ignore */
    }
  }
  drafts.clear();
  emit();
}
