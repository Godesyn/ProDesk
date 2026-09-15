import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';

/**
 * One place that knows which cached queries each chat write can change.
 *
 * The write-side twin of realtime-inbox.ts / use-thread-stream.ts, which map the
 * same queries by TABLE for writes we did not make. Keeping both in one file each
 * is what stops "why didn't the list update?" from becoming a scavenger hunt.
 *
 * ─── pathFilter(), NEVER queryKey() ─────────────────────────────────────────
 * `trpc.x.y.queryKey()` builds `[['x','y'], { type: 'query' }]`, and React Query
 * matches filters by partial deep equality — so that key does NOT match an
 * INFINITE query, whose key carries `{ type: 'infinite' }` instead. The inbox,
 * the transcript and search are ALL infinite here, so a `queryKey()` invalidation
 * silently matches nothing and the screen simply never updates until a remount.
 * This bit the Links frontend first; its use-invalidate.ts carries the same
 * warning. `pathFilter()` keys on the path alone and matches both forms.
 */
type PathFilter = { queryKey: readonly unknown[] };

export function useChatInvalidate() {
  const qc = useQueryClient();
  const trpc = useTRPC();
  const drop = (...filters: PathFilter[]) => {
    for (const f of filters) void qc.invalidateQueries(f);
  };

  return {
    /**
     * A message was sent, edited or deleted. Prefer the cache writers in
     * cache.ts where the new state is computable locally — this is the fallback
     * for the cases where it isn't (an edit changing the thread preview, a send
     * that reorders the inbox).
     */
    afterMessageChange: () =>
      drop(
        trpc.chat.messages.pathFilter(),
        trpc.chat.inbox.pathFilter(),
        trpc.chat.threadMeta.pathFilter(),
        trpc.chat.totalUnread.pathFilter(),
        trpc.chat.searchMessages.pathFilter(),
        // The Media and Files tabs are their own paginated query over the same
        // messages, so a sent photo has to reach them too — otherwise the grid
        // is missing the picture you just sent until the sheet is reopened.
        trpc.chat.threadAttachments.pathFilter(),
      ),

    /** A thread was created, renamed, left, archived, pinned or muted. */
    afterThreadChange: () =>
      drop(
        trpc.chat.inbox.pathFilter(),
        trpc.chat.threadMeta.pathFilter(),
        trpc.chat.members.pathFilter(),
        trpc.chat.totalUnread.pathFilter(),
      ),

    /** Membership changed — the header count, the face tiles, the mention list. */
    afterMembersChange: () =>
      drop(trpc.chat.members.pathFilter(), trpc.chat.inbox.pathFilter()),

    /** markRead landed: the ticks other people see, and my own badges. */
    afterRead: () =>
      drop(
        trpc.chat.readState.pathFilter(),
        trpc.chat.inbox.pathFilter(),
        trpc.chat.threadMeta.pathFilter(),
        trpc.chat.totalUnread.pathFilter(),
      ),

    /** A reaction was toggled, by me or by a peer. */
    afterReaction: () => drop(trpc.chat.reactions.pathFilter()),

    /** A request was accepted or declined — it moves between two lists. */
    afterRequestChange: () =>
      drop(
        trpc.chat.listRequests.pathFilter(),
        trpc.chat.requestCount.pathFilter(),
        trpc.chat.inbox.pathFilter(),
        trpc.chat.totalUnread.pathFilter(),
      ),

    /** Blocked or unblocked someone. */
    afterBlockChange: () =>
      drop(trpc.chat.listBlocked.pathFilter(), trpc.chat.inbox.pathFilter()),
  };
}
