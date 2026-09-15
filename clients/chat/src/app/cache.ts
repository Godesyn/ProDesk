import type { QueryClient, QueryKey } from '@tanstack/react-query';

/**
 * Pure writers over the `chat.messages` infinite cache.
 *
 * Realtime patches the cache DIRECTLY rather than invalidating it. An incoming
 * message must not cost a network round trip — a messenger that refetches thirty
 * messages every time someone says "ok" feels laggy at exactly the moment it
 * should feel instant, and it flashes a loading state over content the user is
 * reading.
 *
 * Three invariants below are load-bearing and each one is a real bug that is very
 * hard to see afterwards. They are ported from the shared MessagePanel, which
 * earned them the hard way; what is NOT ported is the 3,700-line component around
 * them.
 */

/** The shape `chat.messages` returns per page. Structural, so no import cycle. */
export type CachedMessage = {
  id: string;
  threadId: string;
  senderId: string | null;
  senderName: string | null;
  senderAvatar: string | null;
  content: string | null;
  type: string;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  thumbnailUrl: string | null;
  replyToId: string | null;
  isForwarded: boolean;
  editedAt: Date | string | null;
  deletedAt: Date | string | null;
  timestamp: string;
  [key: string]: unknown;
};

type Page = { items: CachedMessage[]; nextCursor: unknown };
type Infinite = { pages: Page[]; pageParams: unknown[] };

/**
 * Insert a newly-arrived message.
 *
 * Pages are NEWEST-FIRST (the query walks backwards through history), so the
 * newest message belongs at the head of `pages[0]`.
 */
export function appendMessage(qc: QueryClient, key: QueryKey, message: CachedMessage): void {
  qc.setQueryData<Infinite>(key, (old) => {
    // INVARIANT 1 — bail when nothing is cached.
    // Writing a lone page here would produce a `pages` array with no matching
    // `pageParams`, which react-query treats as corrupt: the next fetch throws or
    // silently drops history. If the thread isn't loaded, the mount fetch will
    // pick this message up anyway.
    if (!old?.pages?.length) return old;

    // INVARIANT 2 — dedupe by id.
    // The sender receives this message TWICE: once as the mutation result, once
    // as the realtime echo of their own insert. `chat.send` accepts a
    // client-generated uuid precisely so both carry the same id — keep passing it.
    if (old.pages.some((p) => p.items.some((i) => i.id === message.id))) return old;

    const pages = old.pages.slice();
    pages[0] = { ...pages[0], items: [message, ...pages[0].items] };
    // INVARIANT 3 — never touch pageParams. An append changes no cursor.
    return { ...old, pages };
  });
}

/**
 * Merge a realtime UPDATE into a cached message.
 *
 * COALESCING, not overwriting, and that is not a style preference. Postgres
 * logical decoding omits unchanged TOASTed columns from an UPDATE payload, so an
 * update that touched only `edited_at` arrives with `content: null`. An unguarded
 * `{...old, ...patch}` would blank a message the user is currently reading, and it
 * would stay blank until the next full refetch.
 */
export function mergeMessageUpdate(
  qc: QueryClient,
  key: QueryKey,
  patch: Partial<CachedMessage> & { id: string },
): void {
  qc.setQueryData<Infinite>(key, (old) => {
    if (!old?.pages?.length) return old;
    let touched = false;
    const pages = old.pages.map((p) => {
      if (!p.items.some((i) => i.id === patch.id)) return p;
      touched = true;
      return {
        ...p,
        items: p.items.map((i) => (i.id === patch.id ? mergeInto(i, patch) : i)),
      };
    });
    return touched ? { ...old, pages } : old;
  });
}

/**
 * Remove a message.
 *
 * Only reachable from the realtime DELETE binding, which CANNOT be filtered to a
 * thread — the default replica identity ships only the primary key, so there is
 * no thread_id to filter on. Every open thread therefore receives every delete,
 * and this is a deliberate no-op for ids it does not hold.
 *
 * (The messenger's own delete is soft, so in practice this fires only for
 * administrative cleanups.)
 */
export function removeMessage(qc: QueryClient, key: QueryKey, messageId: string): void {
  qc.setQueryData<Infinite>(key, (old) => {
    if (!old?.pages?.length) return old;
    if (!old.pages.some((p) => p.items.some((i) => i.id === messageId))) return old;
    return {
      ...old,
      pages: old.pages.map((p) => ({ ...p, items: p.items.filter((i) => i.id !== messageId) })),
    };
  });
}

/* ── Batched application ──────────────────────────────────────────────────── */

/**
 * One realtime change to the transcript, in arrival order.
 *
 * The three kinds share a queue rather than getting one each, and that is not
 * tidiness: an INSERT and the UPDATE that edits it can land in the same burst,
 * and applying all inserts then all updates would resurrect the pre-edit text.
 * Order is the correctness property, so there is exactly one queue.
 */
export type MessageEvent =
  | { kind: 'insert'; message: CachedMessage }
  | { kind: 'update'; patch: Partial<CachedMessage> & { id: string } }
  | { kind: 'delete'; id: string };

/**
 * How many messages the LIVE window is allowed to hold before the oldest pages
 * are dropped.
 *
 * A room left open in a busy conversation grows without limit — realtime appends
 * and nothing ever removes — and every arriving message then re-sorts and
 * re-groups the whole accumulated list. At a few hundred that is free; at ten
 * thousand (an afternoon in a group chat, or one automated sender) the browser
 * is spending more time on history nobody is looking at than on the message that
 * just arrived. High enough that ordinary use never reaches it.
 */
export const MAX_LIVE_MESSAGES = 500;

/**
 * Apply a batch of realtime changes in ONE cache write.
 *
 * Per-event writes cost one React commit each, and socket frames arrive in
 * separate tasks so React cannot batch them itself: thirty messages meant thirty
 * commits of a list that re-sorts and re-measures on every one, while the
 * transcript was also trying to follow the conversation down. That is what "the
 * UI breaks when a lot arrives at once" looks like from the inside.
 *
 * Returns the messages that were ACTUALLY inserted — not the ones we were asked
 * to insert. A message already in the cache (the echo of our own send, a
 * duplicate delivery after a re-join) must not ring the "new message" bell, mark
 * the thread read, or move the reader.
 *
 * `trim` is opt-in per call because dropping older pages is only safe when the
 * reader is at the live edge; see `MAX_LIVE_MESSAGES`. It returns whether
 * anything was dropped so the caller can remount its virtualiser — Virtuoso's
 * `firstItemIndex` may only ever decrease, so silently shrinking the list from
 * the front corrupts its index map.
 */
export function applyMessageEvents(
  qc: QueryClient,
  key: QueryKey,
  events: MessageEvent[],
  options?: { trim?: boolean },
): { inserted: CachedMessage[]; trimmed: boolean } {
  const inserted: CachedMessage[] = [];
  let trimmed = false;
  if (events.length === 0) return { inserted, trimmed };

  qc.setQueryData<Infinite>(key, (old) => {
    // INVARIANT 1 — bail when nothing is cached (see appendMessage).
    if (!old?.pages?.length) return old;

    // Work on a flat copy of every page's items, then reassemble. Assembling
    // once is what makes a batch cost the same as a single event.
    let pages = old.pages.map((p) => ({ ...p, items: p.items.slice() }));
    const index = new Set<string>();
    for (const p of pages) for (const i of p.items) index.add(i.id);
    let dirty = false;

    for (const event of events) {
      if (event.kind === 'insert') {
        // INVARIANT 2 — dedupe by id. The sender receives their own message
        // twice (mutation result + realtime echo) and both carry the same
        // client-generated uuid, by design.
        if (index.has(event.message.id)) continue;
        index.add(event.message.id);
        inserted.push(event.message);
        pages[0].items.unshift(event.message);
        dirty = true;
        continue;
      }
      if (event.kind === 'delete') {
        if (!index.has(event.id)) continue;
        index.delete(event.id);
        for (const p of pages) {
          const at = p.items.findIndex((i) => i.id === event.id);
          if (at >= 0) p.items.splice(at, 1);
        }
        dirty = true;
        continue;
      }
      if (!index.has(event.patch.id)) continue;
      for (const p of pages) {
        const at = p.items.findIndex((i) => i.id === event.patch.id);
        if (at < 0) continue;
        p.items[at] = mergeInto(p.items[at], event.patch);
        dirty = true;
      }
    }

    if (options?.trim) {
      let total = 0;
      for (const p of pages) total += p.items.length;
      if (total > MAX_LIVE_MESSAGES) {
        // Drop TRAILING pages — the oldest history — never the newest. The
        // remaining last page keeps its own `nextCursor` (it is what fetched the
        // page we just dropped), so "load older" still works and picks up exactly
        // where the cache now ends. pageParams must be sliced in lockstep or
        // react-query's next fetch reads a param that belongs to a page that is
        // no longer there.
        let keep = pages.length;
        while (keep > 1 && total > MAX_LIVE_MESSAGES) {
          keep -= 1;
          total -= pages[keep].items.length;
        }
        if (keep < pages.length) {
          pages = pages.slice(0, keep);
          trimmed = true;
          dirty = true;
          return { pages, pageParams: old.pageParams.slice(0, keep) };
        }
      }
    }

    // INVARIANT 3 — never touch pageParams for an append/patch/removal.
    return dirty ? { ...old, pages } : old;
  });

  return { inserted, trimmed };
}

/**
 * Coalesce a patch onto a cached message.
 *
 * Postgres logical decoding omits unchanged TOASTed columns from an UPDATE, so
 * an update that touched only `edited_at` arrives with `content: null`. An
 * unguarded spread would blank a message the user is reading. See
 * `mergeMessageUpdate`, which this shares its rule with.
 */
function mergeInto(
  current: CachedMessage,
  patch: Partial<CachedMessage> & { id: string },
): CachedMessage {
  const next: CachedMessage = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    // A soft delete DOES legitimately null content — it is the only write that
    // means it, and it announces itself with deletedAt.
    if (v === null && k !== 'deletedAt' && k !== 'deletedBy' && !patch.deletedAt) continue;
    (next as Record<string, unknown>)[k] = v;
  }
  return next;
}

/**
 * Trim a thread's cache to its newest page and mark it stale.
 *
 * Called when a thread is opened. While a thread is unmounted nothing is
 * subscribed to it, so realtime appends nothing and the cached pages drift
 * arbitrarily far behind. Keeping page zero preserves instant paint (the user
 * sees the conversation immediately) while the refetch fills the gap.
 */
export function trimToNewestPage(qc: QueryClient, key: QueryKey): void {
  qc.setQueryData<Infinite>(key, (old) => {
    if (!old?.pages?.length || old.pages.length === 1) return old;
    return { pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) };
  });
}
