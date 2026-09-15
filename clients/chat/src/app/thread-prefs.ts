import { useCallback } from 'react';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { useChatInvalidate } from './use-invalidate';

/**
 * Pin, mute, archive and mark-unread — applied to the screen FIRST, and to the
 * server after.
 *
 * Every one of these used to wait for a round trip and then an invalidation
 * before anything moved: you clicked Mute, nothing happened, and about 400ms
 * later the row changed. That reads as a broken button, and the usual reaction is
 * to click it again — which on a toggle undoes the thing you just did.
 *
 * So each action patches the cached inbox pages and the open room's `threadMeta`
 * synchronously, fires the mutation, and rolls the patch back if the server
 * refuses. The invalidation still runs on settle, because only the server can
 * re-sort the list (a pin moves a row between two arrays, an archive moves it
 * between two queries) — but by then the user has already seen the state they
 * asked for.
 *
 * The one rule worth stating: `section` is DERIVED here exactly as the server
 * derives it (routers/chat/consumer.ts#decorateThreads). If those two drift, a
 * muted thread stays under "Unread" for one paint and then jumps, which looks
 * worse than not being optimistic at all.
 */

type InboxItem = {
  id: string;
  unreadCount: number;
  isPinned: boolean;
  isMuted: boolean;
  mutedUntil: string | Date | null;
  isArchived: boolean;
  section: 'unread' | 'read';
  /** Sort key for re-inserting an unpinned row in the right place. */
  lastMessageAt: string | Date | null;
};

type InboxPage = { pinned: InboxItem[]; items: InboxItem[]; nextCursor: unknown };
type InboxInfinite = { pages: InboxPage[]; pageParams: unknown[] };

/** The server's rule, restated. Keep in step with `decorateThreads`. */
function withSection<T extends InboxItem>(item: T): T {
  // `as T` because spreading a wider row and narrowing `section` is not something
  // TS can prove preserves T — it does at runtime, which is the whole point of
  // patching the real cached object rather than rebuilding one.
  return { ...item, section: item.unreadCount > 0 && !item.isMuted ? 'unread' : 'read' } as T;
}

/**
 * Snapshot every cached inbox + threadMeta query, so a failed mutation can put
 * the screen back exactly as it was. Cheap: these are two small caches, and the
 * snapshot is discarded the moment the mutation succeeds.
 */
function snapshot(qc: QueryClient, filters: { queryKey: readonly unknown[] }[]): () => void {
  const saved = filters.flatMap((f) => qc.getQueriesData({ queryKey: f.queryKey }));
  return () => {
    for (const [key, data] of saved) qc.setQueryData(key, data);
  };
}

export function useThreadPrefs() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const invalidate = useChatInvalidate();

  const inboxFilter = trpc.chat.inbox.pathFilter();
  const metaFilter = trpc.chat.threadMeta.pathFilter();

  /** Apply a patch to one thread wherever it is cached. Returns an undo. */
  const patchThread = useCallback(
    (threadId: string, patch: Partial<InboxItem>) => {
      const undo = snapshot(qc, [inboxFilter, metaFilter]);
      const apply = (item: InboxItem) =>
        item.id === threadId ? withSection({ ...item, ...patch }) : item;

      qc.setQueriesData<InboxInfinite>({ queryKey: inboxFilter.queryKey }, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            pinned: (p.pinned ?? []).map(apply),
            items: (p.items ?? []).map(apply),
          })),
        };
      });
      qc.setQueriesData<InboxItem | null>({ queryKey: metaFilter.queryKey }, (old) =>
        old && old.id === threadId ? withSection({ ...old, ...patch }) : old,
      );
      return undo;
    },
    // The tRPC proxy and the query client are stable for the app's lifetime;
    // depending on the freshly-built filter objects would rebuild this each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc],
  );

  /**
   * Pin and unpin — a MOVE between two arrays, not a flag flip.
   *
   * The server serves pinned threads as their own `pinned` array on page one and
   * excludes them from the flowing list, so flipping `isPinned` in place leaves
   * the row sitting under the "Pinned" header wearing an Unpin label until the
   * refetch lands. It looks like the click did nothing. The row has to physically
   * leave one array and arrive in the other:
   *
   *   pin   → out of `items`, onto the FRONT of `pinned` (server orders by
   *           `pinned_at desc`, and this pin is the newest)
   *   unpin → out of `pinned`, back into `items` at its recency position, which
   *           is where the server's `sortAt desc` will put it anyway
   */
  const movePin = useCallback(
    (threadId: string, pinned: boolean) => {
      const undo = snapshot(qc, [inboxFilter, metaFilter]);

      qc.setQueriesData<InboxInfinite>({ queryKey: inboxFilter.queryKey }, (old) => {
        if (!old?.pages?.length) return old;
        const found =
          old.pages.flatMap((p) => [...(p.pinned ?? []), ...(p.items ?? [])]).find((i) => i.id === threadId);
        if (!found) return old;
        const moved = withSection({ ...found, isPinned: pinned });

        // Strip it from wherever it currently is, in every loaded page.
        const pages = old.pages.map((p) => ({
          ...p,
          pinned: (p.pinned ?? []).filter((i) => i.id !== threadId),
          items: (p.items ?? []).filter((i) => i.id !== threadId),
        }));

        // …and re-seat it on page one, which is the only page that carries the
        // `pinned` array and the only one whose recency range can be reasoned
        // about locally.
        const first = pages[0];
        if (!first) return { ...old, pages };
        const at = (i: InboxItem) => new Date(i.lastMessageAt ?? 0).getTime();
        pages[0] = pinned
          ? { ...first, pinned: [moved, ...first.pinned] }
          : {
              ...first,
              items: [...first.items, moved].sort((a, b) => at(b) - at(a)),
            };
        return { ...old, pages };
      });

      qc.setQueriesData<InboxItem | null>({ queryKey: metaFilter.queryKey }, (old) =>
        old && old.id === threadId ? { ...old, isPinned: pinned } : old,
      );
      return undo;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc],
  );

  /**
   * Drop a thread out of every loaded inbox page. Archiving and unarchiving both
   * move a row between two DIFFERENT queries (filter 'all' ↔ filter 'archived'),
   * so there is nothing to patch in place — it has to leave the list it is in and
   * arrive in the other one on the settle refetch.
   */
  const dropThread = useCallback(
    (threadId: string) => {
      const undo = snapshot(qc, [inboxFilter]);
      qc.setQueriesData<InboxInfinite>({ queryKey: inboxFilter.queryKey }, (old) => {
        if (!old?.pages?.length) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            pinned: (p.pinned ?? []).filter((i) => i.id !== threadId),
            items: (p.items ?? []).filter((i) => i.id !== threadId),
          })),
        };
      });
      return undo;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [qc],
  );

  /**
   * Two things about the shape below are load-bearing, and both cost a
   * type-error each to learn:
   *
   *  1. Options go INSIDE `mutationOptions({…})`, never spread around it. The
   *     tRPC proxy types its own `onSuccess` against an `undefined` onMutate
   *     result, so `{ ...mutationOptions(), onMutate }` fails on every one of
   *     these. Passing them in lets the proxy infer the context type.
   *  2. `onMutate` is `async`. The return position is `Promise<TContext> |
   *     TContext`, which TypeScript cannot infer from — a sync return silently
   *     pins TContext to `undefined` and every rollback stops compiling.
   *
   * And `onError` is `(error, variables, context)` — the undo is the THIRD
   * argument, not the second.
   */
  const rollback = (e: unknown, _vars: unknown, ctx: { undo: () => void } | undefined) => {
    ctx?.undo();
    toastError(e);
  };

  const setPinned = useMutation(
    trpc.chat.setPinned.mutationOptions({
      onMutate: async ({ threadId, pinned }) => ({ undo: movePin(threadId, pinned) }),
      onError: rollback,
      onSettled: () => invalidate.afterThreadChange(),
    }),
  );

  const setMuted = useMutation(
    trpc.chat.setMuted.mutationOptions({
      onMutate: async ({ threadId, until }) => ({
        undo: patchThread(threadId, { isMuted: !!until, mutedUntil: until ?? null }),
      }),
      onError: rollback,
      onSettled: () => invalidate.afterThreadChange(),
    }),
  );

  const setArchived = useMutation(
    trpc.chat.setArchived.mutationOptions({
      onMutate: async ({ threadId }) => ({ undo: dropThread(threadId) }),
      onError: rollback,
      onSettled: () => invalidate.afterThreadChange(),
    }),
  );

  const markRead = useMutation(
    trpc.chat.markRead.mutationOptions({
      onMutate: async ({ threadId }) => ({ undo: patchThread(threadId, { unreadCount: 0 }) }),
      onError: rollback,
      onSettled: () => invalidate.afterRead(),
    }),
  );

  const markUnread = useMutation(
    trpc.chat.markUnread.mutationOptions({
      // unreadCount 1, not the real count: the server sets exactly 1 too (it has
      // thrown the read pointer away, so there is no truer number to show).
      onMutate: async ({ threadId }) => ({ undo: patchThread(threadId, { unreadCount: 1 }) }),
      onError: rollback,
      onSettled: () => invalidate.afterRead(),
    }),
  );

  return {
    togglePin: (item: { id: string; isPinned: boolean }) =>
      setPinned.mutate({ threadId: item.id, pinned: !item.isPinned }),

    /** `until` null unmutes. Anything else is an instant — see @shared/pages/chat/mute. */
    mute: (threadId: string, until: Date | null) => setMuted.mutate({ threadId, until }),

    archive: (threadId: string, archived: boolean, opts?: { onDone?: () => void }) =>
      setArchived.mutate(
        { threadId, archived },
        {
          onSuccess: () => {
            toast.success(archived ? 'Archived' : 'Moved back to your inbox');
            opts?.onDone?.();
          },
        },
      ),

    markUnread: (threadId: string, opts?: { onDone?: () => void }) =>
      markUnread.mutate({ threadId }, { onSuccess: () => opts?.onDone?.() }),

    markRead: (threadId: string) => markRead.mutate({ threadId }),
  };
}
