import { useSyncExternalStore } from 'react';

/**
 * Per-thread store for the AI assistant's *ephemeral* streaming state — the live
 * reply ("thinking") and the in-flight request handle.
 *
 * Why this exists: the brand AI thread is mounted by two hosts — the docked
 * strategist rail (suite/chat.tsx) and the full Growth strategy screen
 * (suite/strategy.tsx). Only one is mounted at a time (mounting two MessagePanels
 * on one thread double-subscribes the Supabase channel and throws), so switching
 * between them unmounts one MessagePanel and mounts the other. If this state lived
 * in the component it would be lost on every switch — the stream's UI would vanish
 * mid-answer. Holding it here, keyed by threadId, lets it survive the
 * unmount/remount: the running stream keeps writing here (it is never aborted on
 * unmount) and whichever host is mounted reads the same state.
 *
 * Confirm-action cards are NOT held here: they render inline under their own AI
 * message (from that message's pendingActions + actionOutcomes in the shared
 * react-query cache), which likewise survives the remount and, being persisted,
 * survives a reload too.
 */
export interface AiThreadState {
  streaming: boolean;
  streamingText: string;
}

const EMPTY: AiThreadState = { streaming: false, streamingText: '' };

const states = new Map<string, AiThreadState>();
const listeners = new Map<string, Set<() => void>>();
// Abort handles are non-reactive (no re-render needed) so they live outside state.
const aborts = new Map<string, AbortController | null>();

function emit(threadId: string): void {
  listeners.get(threadId)?.forEach((l) => l());
}

export function getAiThread(threadId: string): AiThreadState {
  return states.get(threadId) ?? EMPTY;
}

export function patchAiThread(threadId: string, patch: Partial<AiThreadState>): void {
  states.set(threadId, { ...(states.get(threadId) ?? EMPTY), ...patch });
  emit(threadId);
}

/** Append a streamed token to the live reply without clobbering concurrent writes. */
export function appendAiDelta(threadId: string, delta: string): void {
  const prev = states.get(threadId) ?? EMPTY;
  states.set(threadId, { ...prev, streamingText: prev.streamingText + delta });
  emit(threadId);
}

export function getAiAbort(threadId: string): AbortController | null {
  return aborts.get(threadId) ?? null;
}

export function setAiAbort(threadId: string, ac: AbortController | null): void {
  aborts.set(threadId, ac);
}

/** Reactive read of a thread's AI state. Re-renders the caller on any change. */
export function useAiThread(threadId: string): AiThreadState {
  return useSyncExternalStore(
    (cb) => {
      let set = listeners.get(threadId);
      if (!set) {
        set = new Set();
        listeners.set(threadId, set);
      }
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) listeners.delete(threadId);
      };
    },
    () => states.get(threadId) ?? EMPTY,
    () => EMPTY,
  );
}
