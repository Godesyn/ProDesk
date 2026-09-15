import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { joinThreadChannel, sendThreadBroadcast } from '@shared/pages/chat/chat-channel';
import { createCoalescer, createInvalidator } from '@shared/lib/coalesce';
import { useTRPC } from '@shared/lib/trpc';
import { applyMessageEvents, type CachedMessage, type MessageEvent } from './cache';
import { noteTyping } from '../stores/typing';
import { announceMessage } from '../lib/a11y';

/**
 * One open thread's live wire.
 *
 * Everything arriving on `thread:<id>` is mapped onto the react-query cache here,
 * so no component below this hook has to know that realtime exists.
 *
 * The channel itself is owned by `@shared/pages/chat/chat-channel`, which is
 * ref-counted per topic with a deferred teardown. That is not an implementation
 * detail to route around: Supabase reuses a channel by topic and `.on()` on an
 * already-joined channel THROWS, so calling `supabase.channel('thread:…')`
 * anywhere else in this app would blank the view the first time two things
 * subscribe at once.
 *
 * ─── EVERYTHING HERE IS BATCHED, and that is the point of the file ──────────
 *
 * Realtime delivers one socket frame at a time and the obvious handler does its
 * work once per frame. Under the load this app is actually for — a group where
 * several people are talking, a paste of a dozen lines, a channel re-joining
 * after a gap and delivering the backlog at once — that shape fails twice over:
 *
 *   • every INSERT invalidated the INBOX, and an invalidated active infinite
 *     query refetches EVERY loaded page. Thirty messages was up to a hundred
 *     inbox requests, each one a multi-join decoration query, fired at a server
 *     that was already busy writing the messages that caused them;
 *   • every INSERT was its own cache write, hence its own React commit, and
 *     socket frames land in separate tasks so React cannot batch across them.
 *     Thirty commits of a list that re-sorts, re-groups and re-measures on each
 *     one, while the transcript was also trying to follow the conversation down.
 *
 * So: cache changes go through ONE ordered queue flushed on a short timer (a
 * batch of thirty costs one commit), and every refetch goes through a coalescer
 * that dedupes by query key. See @shared/lib/coalesce.
 */

/** How often we tell peers we're typing. Their side expires after 4s. */
const TYPING_PING_MS = 2_500;

/**
 * Cache-write batching window.
 *
 * Short enough to be indistinguishable from instant (a message still appears in
 * the same frame a human would notice), long enough that a burst arriving over a
 * few hundred milliseconds collapses into a handful of commits rather than one
 * per message. NOT deferred while hidden: the cache must be correct the moment
 * the user looks back at the tab.
 */
const WRITE_WAIT_MS = 40;
const WRITE_MAX_WAIT_MS = 200;

/**
 * Refetch coalescing. Much lazier than the cache write, because these are
 * network calls whose result is a number in a badge or a preview line — being
 * half a second behind a burst is invisible, and being thirty requests ahead of
 * it is an outage.
 */
const REFETCH_WAIT_MS = 400;
const REFETCH_MAX_WAIT_MS = 2_000;

type Options = {
  threadId: string | null;
  meId: string | null;
  /**
   * The LIVE transcript's cache key, handed in by the room rather than rebuilt
   * here — and that distinction is load-bearing.
   *
   * tRPC keys an infinite query on its whole input minus the cursor, so
   * `infiniteQueryKey({ threadId })` is NOT the key of
   * `infiniteQueryOptions({ threadId, limit: 30 })`. `setQueryData` matches keys
   * exactly, so a hand-built key writes into an entry nothing renders — silently,
   * because the writers bail on a cache with no pages. Every live message
   * was being dropped on the floor and only reappeared when something unrelated
   * refetched. Take the key from the options object; never reconstruct it.
   */
  messagesKey: readonly unknown[];
  /**
   * Called once per BATCH with the messages that were genuinely new and from
   * someone else — never with the echo of your own send, and never with a
   * message the cache already held. Batched deliberately: the room turns this
   * into a scroll and a mark-read, and thirty of each is thirty scroll
   * animations fighting each other.
   */
  onIncoming?: (messages: CachedMessage[]) => void;
  /** Called when another member's read pointer moved (the beads on the spine). */
  onPeerRead?: (userId: string) => void;
  /**
   * Whether the reader is at the live edge RIGHT NOW. Read at flush time, not at
   * subscribe time. Only when it is true may the cache drop the oldest pages to
   * stay bounded — trimming under someone reading history would pull the ground
   * out from under them.
   */
  isAtLiveEdge?: () => boolean;
  /**
   * The live window dropped its oldest pages. The transcript must remount:
   * Virtuoso's `firstItemIndex` may only ever DECREASE, so shrinking the list
   * from the front on a live instance corrupts its index map (repeated rows,
   * skipped rows, a scroll that lands nowhere).
   */
  onWindowTrimmed?: () => void;
};

/** Map a raw snake_case `chat_messages` realtime row onto the cached shape. */
function mapRow(row: Record<string, unknown>): CachedMessage {
  const s = (k: string) => (row[k] == null ? null : String(row[k]));
  // The drizzle field is `timestamp` but the column is `created_at`, so realtime
  // rows carry the snake_case name. Normalise, and never let a bad value render
  // as Invalid Date.
  const rawTs = row.created_at ?? row.timestamp;
  const parsed = rawTs != null ? new Date(String(rawTs)) : null;
  const timestamp =
    parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    senderId: s('sender_id'),
    senderName: s('sender_name'),
    senderAvatar: s('sender_avatar'),
    // Carried so a realtime row is indistinguishable from a fetched one. Any
    // column the row renderer reads and this mapper drops is a field that
    // "appears on refresh" — the failure mode is invisible in dev, where the
    // refetch is instant. See the chat_messages ↔ MessageRow mirror.
    senderRole: s('sender_role'),
    senderBusinessName: s('sender_business_name'),
    projectId: s('project_id'),
    content: s('content'),
    type: (s('type') as string) ?? 'text',
    fileUrl: s('file_url'),
    fileName: s('file_name'),
    fileSize: row.file_size == null ? null : Number(row.file_size),
    thumbnailUrl: s('thumbnail_url'),
    replyToId: s('reply_to_id'),
    // Stamped at INSERT and never updated, so the realtime echo is the only
    // place it has to be read — a forwarded message shows its marker the moment
    // it lands, not on the next refetch.
    isForwarded: Boolean(row.is_forwarded),
    editedAt: s('edited_at'),
    deletedAt: s('deleted_at'),
    timestamp,
  };
}

export function useThreadStream({
  threadId,
  meId,
  messagesKey,
  onIncoming,
  onPeerRead,
  isAtLiveEdge,
  onWindowTrimmed,
}: Options) {
  const qc = useQueryClient();
  const trpc = useTRPC();

  // Callbacks live in refs so a parent re-render never tears down the channel —
  // resubscribing on every render would thrash the shared ref count and, worse,
  // race the 3s deferred teardown.
  const incomingRef = useRef(onIncoming);
  incomingRef.current = onIncoming;
  const peerReadRef = useRef(onPeerRead);
  peerReadRef.current = onPeerRead;
  const atEdgeRef = useRef(isAtLiveEdge);
  atEdgeRef.current = isAtLiveEdge;
  const trimmedRef = useRef(onWindowTrimmed);
  trimmedRef.current = onWindowTrimmed;
  // Same reason as the callbacks: the key is a fresh array identity every render,
  // and depending on it would rebuild the channel constantly.
  const keyRef = useRef(messagesKey);
  keyRef.current = messagesKey;

  useEffect(() => {
    if (!threadId) return;
    const messagesKey = keyRef.current;

    /**
     * Refetches. Deduped by query key and held while the tab is hidden — a
     * background tab still holds mounted (therefore "active") queries, so
     * without this it refetches at full burst rate for a screen nobody is
     * looking at. The resilient channel's catch-up covers anything missed.
     */
    const refetches = createInvalidator((filter) => void qc.invalidateQueries(filter), {
      wait: REFETCH_WAIT_MS,
      maxWait: REFETCH_MAX_WAIT_MS,
      deferWhileHidden: true,
    });

    /**
     * Cache writes. One ordered queue for inserts, updates and deletes together:
     * an INSERT and the UPDATE that edits it can arrive in the same burst, and
     * applying all inserts before all updates would resurrect the pre-edit text.
     */
    const writes = createCoalescer<MessageEvent>(
      (events) => {
        const { inserted, trimmed } = applyMessageEvents(qc, messagesKey, events, {
          trim: atEdgeRef.current?.() ?? false,
        });
        if (trimmed) trimmedRef.current?.();
        // Only messages that were genuinely NEW and from someone else. The echo
        // of my own send is deduped away above and must not ring any bell.
        const fromOthers = inserted.filter((m) => m.senderId && m.senderId !== meId);
        if (fromOthers.length > 0) {
          incomingRef.current?.(fromOthers);
          // The announcer throttles itself to one utterance every couple of
          // seconds; announce the NEWEST of the batch, which is the one a person
          // arriving at the conversation would want read out.
          const speakable = [...fromOthers].reverse().find((m) => m.type === 'text' && m.content);
          if (speakable) {
            announceMessage(speakable.senderName ?? 'Someone', speakable.content ?? '');
          }
          // The preview and ordering in the inbox move with every message — but
          // once per burst, not once per message.
          refetches.push(trpc.chat.inbox.pathFilter());
        }
      },
      { wait: WRITE_WAIT_MS, maxWait: WRITE_MAX_WAIT_MS },
    );

    const unsubscribe = joinThreadChannel(threadId, {
      onInsert: (row) => writes.push({ kind: 'insert', message: mapRow(row) }),
      onUpdate: (row) => writes.push({ kind: 'update', patch: mapRow(row) }),
      onDelete: (old) => {
        const id = old?.id;
        if (id) writes.push({ kind: 'delete', id: String(id) });
      },
      onPeerRead: (userId) => {
        // The bead move is local state and cheap, so it stays immediate; the
        // refetch behind it is what gets coalesced. In a group of ten, one burst
        // means ten people each marking read and broadcasting it — that used to
        // be ten refetches of the read pointers per burst, per member.
        peerReadRef.current?.(userId);
        refetches.push(trpc.chat.readState.pathFilter());
      },
      onTyping: (userId, name) => {
        if (userId !== meId) noteTyping(threadId, userId, name);
      },
      onReaction: () => refetches.push(trpc.chat.reactions.pathFilter()),
      onThreadChanged: () => refetches.push(trpc.chat.inbox.pathFilter()),
      onMembersChanged: () => refetches.push(trpc.chat.members.pathFilter()),
      // Realtime has no replay. After any gap the loaded window may be missing
      // messages entirely, so refetch rather than assume. Coalesced like the
      // rest: a flapping connection re-joins repeatedly, and each re-join would
      // otherwise refetch the whole transcript.
      onResync: () => {
        refetches.push({ queryKey: messagesKey });
        refetches.push(trpc.chat.readState.pathFilter());
        refetches.push(trpc.chat.reactions.pathFilter());
      },
    });

    return () => {
      // Flush pending cache writes before letting go — messages that arrived in
      // the last few milliseconds are already in the cache's future, and
      // dropping them would leave a hole that only a refetch could fill. The
      // refetch queue is simply cancelled: this thread is closing, and the room
      // that opens next refetches on mount anyway.
      writes.flush();
      writes.cancel();
      refetches.cancel();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId, meId]);
}

/**
 * Tell peers you are typing, at most once every few seconds.
 *
 * Client-to-client on the shared thread topic — there is no server procedure and
 * there should not be one. Typing is worth nothing the moment it is stale, so
 * paying for a round trip and a database write would buy latency and nothing else.
 */
export function useTypingPing(threadId: string | null, meId: string | null, meName: string) {
  const lastRef = useRef(0);
  return () => {
    if (!threadId || !meId) return;
    const now = Date.now();
    if (now - lastRef.current < TYPING_PING_MS) return;
    lastRef.current = now;
    sendThreadBroadcast(threadId, 'typing', { userId: meId, name: meName });
  };
}

/** Tell peers your read pointer moved, so their beads slide without a refetch. */
export function broadcastRead(threadId: string, meId: string): void {
  sendThreadBroadcast(threadId, 'read', { userId: meId });
}
