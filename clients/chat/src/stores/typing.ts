import { useSyncExternalStore } from 'react';

/**
 * Who is typing, per thread.
 *
 * A module store because this arrives at broadcast rate — several events a second
 * while someone writes a sentence. In the react-query cache it would be constant
 * invalidation noise; in a context it would re-render the entire tree three times
 * a second for a 16px dot.
 *
 * Entries expire on a timer rather than on a "stopped typing" signal, because
 * there isn't one that can be trusted: the peer may close the tab, lose the
 * network, or simply walk away mid-word.
 */

const EXPIRY_MS = 4_000;

type Entry = { name: string; until: number };

const byThread = new Map<string, Map<string, Entry>>();
const listeners = new Set<() => void>();
/** Cached snapshots so useSyncExternalStore sees a stable reference between
 *  changes — returning a fresh array every read makes React loop forever. */
const snapshots = new Map<string, string[]>();
let sweeper: ReturnType<typeof setInterval> | null = null;

const EMPTY: string[] = [];

function emit() {
  listeners.forEach((fn) => fn());
}

function rebuild(threadId: string) {
  const now = Date.now();
  const map = byThread.get(threadId);
  const live = map ? [...map.entries()].filter(([, e]) => e.until > now).map(([id]) => id) : [];
  const prev = snapshots.get(threadId);
  // Only publish a new array identity when the SET actually changed.
  if (prev && prev.length === live.length && prev.every((id, i) => id === live[i])) return false;
  snapshots.set(threadId, live.length ? live : EMPTY);
  return true;
}

function ensureSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    let changed = false;
    const now = Date.now();
    for (const [threadId, map] of byThread) {
      for (const [userId, entry] of map) if (entry.until <= now) map.delete(userId);
      if (map.size === 0) byThread.delete(threadId);
      if (rebuild(threadId)) changed = true;
    }
    if (byThread.size === 0 && sweeper) {
      clearInterval(sweeper);
      sweeper = null;
    }
    if (changed) emit();
  }, 1_000);
}

/** A peer sent a `typing` broadcast. */
export function noteTyping(threadId: string, userId: string, name: string): void {
  const map = byThread.get(threadId) ?? new Map<string, Entry>();
  map.set(userId, { name, until: Date.now() + EXPIRY_MS });
  byThread.set(threadId, map);
  ensureSweeper();
  if (rebuild(threadId)) emit();
}

export function clearTyping(threadId: string, userId: string): void {
  const map = byThread.get(threadId);
  if (!map?.delete(userId)) return;
  if (rebuild(threadId)) emit();
}

/** User ids currently typing in a thread. Stable identity between changes. */
export function useTypingIds(threadId: string | null): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (threadId ? snapshots.get(threadId) ?? EMPTY : EMPTY),
    () => EMPTY,
  );
}

/** The display name last seen with a typing event, for the inbox row. */
export function typingName(threadId: string, userId: string): string | null {
  return byThread.get(threadId)?.get(userId)?.name ?? null;
}
