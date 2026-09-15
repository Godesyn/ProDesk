import { supabase } from '../../lib/supabase';
import { subscribeResilient, type ResilientChannel } from '../../lib/resilient-channel';

/**
 * Per-thread shared Supabase realtime channel, ref-counted with deferred teardown.
 *
 * Why this exists: the same thread can be mounted by two MessagePanel hosts (the
 * docked strategist rail and the full Growth strategy screen). Supabase reuses a
 * channel by topic, and calling `.on()` on an already-joined channel throws — so
 * each panel can't own its own `thread:<id>` channel. Worse, switching between the
 * two hosts unmounts one panel and mounts the other in the same React commit: a
 * naive per-panel channel does `removeChannel(old)` then `channel(new).subscribe()`
 * on the SAME topic, and because removeChannel is async the new subscribe races the
 * teardown and throws (blanking the view — no thinking, no reply).
 *
 * This manager keeps ONE channel per topic for as long as any panel is subscribed.
 * On the last unsubscribe it defers teardown briefly; if another panel subscribes
 * within that window (the switch), it cancels the teardown and reuses the live
 * channel — no remove/re-create, no race. All handlers are registered once at
 * creation and fan out to every current subscriber, so per-panel callbacks (which
 * close over their own query cache / scroll refs) all still run.
 *
 * The shared topic is also required for cross-user broadcasts: typing + read
 * receipts only reach peers when everyone is on the same `thread:<id>` topic.
 */
export interface ThreadChannelHandlers {
  onInsert?: (row: Record<string, unknown>) => void;
  /** A message row changed after insert (pending-action cards written, a card
   *  settled/edited by a teammate, a thumbs rating, a follow-up flag). The INSERT
   *  echo can't carry these later writes, so patch them into the cached row. */
  onUpdate?: (row: Record<string, unknown>) => void;
  /** A message row was deleted — drop it from the cache. `old` carries only the
   *  primary key under the default replica identity. */
  onDelete?: (old: Record<string, unknown>) => void;
  onPeerRead?: (userId: string) => void;
  onTyping?: (userId: string, name: string) => void;
  /** A headless AI turn (settlement follow-up) finished server-side — safe to
   *  drop the "thinking" spinner. Per-round INSERTs must not clear it: the turn
   *  may still be running tools between bubbles. */
  onAiDone?: () => void;
  /** The thread's continuation suggestions changed (a new turn or headless
   *  follow-up refreshed them) — refetch the persisted list. Data-less. */
  onContinuations?: () => void;
  /** The thread's AI to-do plan changed (assistant wrote/updated/cleared it, or
   *  `/clear` disposed it) — refetch the plan. Data-less. */
  onPlanChanged?: () => void;
  /** A reaction was added or removed somewhere in this thread (consumer
   *  messenger). Data-less: the client refetches the thread's reaction set, which
   *  is small and lets one handler cover add, remove and a peer's toggle. */
  onReaction?: () => void;
  /** The thread was renamed, re-photographed, or an admin changed (consumer
   *  messenger). None of those is a chat_messages write, so nothing else would
   *  tell an open room to refresh its header. */
  onThreadChanged?: () => void;
  /** Someone joined, left, or was removed (consumer messenger). */
  onMembersChanged?: () => void;
  /** The channel re-joined after a drop — realtime has no replay, so refetch the
   *  loaded window to pick up whatever landed while the channel was down. */
  onResync?: () => void;
}

interface Entry {
  handle: ResilientChannel;
  subs: Set<ThreadChannelHandlers>;
  removalTimer: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<string, Entry>();

/** How long to keep a channel alive after its last subscriber leaves, so an
 *  immediate re-subscribe (the dock↔full-screen switch) reuses it. */
const TEARDOWN_DELAY_MS = 3000;

/** Subscribe to a thread's realtime channel. Returns an unsubscribe function. */
export function joinThreadChannel(threadId: string, handlers: ThreadChannelHandlers): () => void {
  let entry = entries.get(threadId);
  if (entry) {
    // Reuse the still-joined channel; cancel any pending teardown from the panel
    // that just left (the switch).
    if (entry.removalTimer) {
      clearTimeout(entry.removalTimer);
      entry.removalTimer = null;
    }
  } else {
    const subs = new Set<ThreadChannelHandlers>();
    // Resilient subscription (resilient-channel.ts): revives the channel after
    // sleep/offline/token-expiry drops and fans a resync out to every panel so
    // messages that arrived during the gap (no replay in realtime) get refetched.
    const handle = subscribeResilient({
      // Passed explicitly so the wrapper can serialise a rebuild behind the
      // async removeChannel of the topic it is replacing — re-subscribing a
      // topic whose teardown is still in flight throws and blanks the view.
      topic: `thread:${threadId}`,
      build: () =>
        supabase
          .channel(`thread:${threadId}`, { config: { broadcast: { self: false } } })
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
            ({ new: row }) => {
              subs.forEach((h) => h.onInsert?.(row as Record<string, unknown>));
            },
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'chat_messages', filter: `thread_id=eq.${threadId}` },
            ({ new: row }) => {
              subs.forEach((h) => h.onUpdate?.(row as Record<string, unknown>));
            },
          )
          .on(
            'postgres_changes',
            // Filtered, which is only possible because `chat_messages` is set to
            // FULL replica identity (servers/backend/sql/rls.sql) — the delete
            // payload therefore carries every column, including thread_id, and
            // Realtime can evaluate the filter against it. Unfiltered, EVERY
            // open room in EVERY tab received EVERY delete across every thread
            // the user belongs to, and each one walked that room's whole cache
            // looking for an id it would never hold.
            //
            // The messenger's own delete is SOFT (an UPDATE), so this binding
            // only ever fires for administrative hard deletes.
            {
              event: 'DELETE',
              schema: 'public',
              table: 'chat_messages',
              filter: `thread_id=eq.${threadId}`,
            },
            ({ old: row }) => {
              subs.forEach((h) => h.onDelete?.(row as Record<string, unknown>));
            },
          )
          .on(
            'postgres_changes',
            // Reactions carry a denormalised thread_id precisely so this filter
            // can exist — without it every browser would receive every reaction
            // on the platform. `*` covers insert (react) and delete (un-react);
            // the un-react is also why the table needs FULL replica identity, or
            // the DELETE payload has no thread_id for RLS to evaluate.
            { event: '*', schema: 'public', table: 'chat_message_reactions', filter: `thread_id=eq.${threadId}` },
            () => {
              subs.forEach((h) => h.onReaction?.());
            },
          )
          .on('broadcast', { event: 'thread_changed' }, () => {
            subs.forEach((h) => h.onThreadChanged?.());
          })
          .on('broadcast', { event: 'members_changed' }, () => {
            subs.forEach((h) => h.onMembersChanged?.());
          })
          .on('broadcast', { event: 'read' }, ({ payload }) => {
            const { userId } = (payload ?? {}) as { userId?: string };
            if (userId) subs.forEach((h) => h.onPeerRead?.(userId));
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const { userId, name } = (payload ?? {}) as { userId?: string; name?: string };
            if (userId) subs.forEach((h) => h.onTyping?.(userId, name || 'Someone'));
          })
          .on('broadcast', { event: 'ai_done' }, () => {
            subs.forEach((h) => h.onAiDone?.());
          })
          .on('broadcast', { event: 'continuations' }, () => {
            subs.forEach((h) => h.onContinuations?.());
          })
          .on('broadcast', { event: 'plan_changed' }, () => {
            subs.forEach((h) => h.onPlanChanged?.());
          }),
      onCatchUp: () => subs.forEach((h) => h.onResync?.()),
    });
    entry = { handle, subs, removalTimer: null };
    entries.set(threadId, entry);
  }

  const e = entry;
  e.subs.add(handlers);

  return () => {
    e.subs.delete(handlers);
    if (e.subs.size === 0 && !e.removalTimer) {
      e.removalTimer = setTimeout(() => {
        // Only tear down if still empty AND this is still the live entry (a later
        // re-subscribe would have replaced/kept it and cleared this timer).
        if (e.subs.size === 0 && entries.get(threadId) === e) {
          e.handle.dispose();
          entries.delete(threadId);
        }
      }, TEARDOWN_DELAY_MS);
    }
  };
}

/** Send a broadcast on a thread's channel (no-op if no one is subscribed). */
export function sendThreadBroadcast(
  threadId: string,
  event: string,
  payload: Record<string, unknown>,
): void {
  void entries.get(threadId)?.handle.getChannel()?.send({ type: 'broadcast', event, payload });
}
