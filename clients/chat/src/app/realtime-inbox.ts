import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@shared/lib/supabase';
import { subscribeResilient } from '@shared/lib/resilient-channel';
import { createInvalidator } from '@shared/lib/coalesce';
import { useTRPC } from '@shared/lib/trpc';
import { notifyDesktop } from '../lib/notify';

/**
 * The per-user inbox channel — everything that happens OUTSIDE an open thread.
 *
 * Two sources, because neither covers the other:
 *
 *  - `postgres_changes` on `chat_thread_members` filtered to me. This is what
 *    carries an unread bump and an archive/pin/mute, since `chat.send` writes
 *    those rows and the table is in the realtime publication.
 *  - broadcasts on `inbox:<me>`. This is what carries the moment a thread FIRST
 *    appears: a stranger opening a DM produces rows in a thread I have never
 *    subscribed to, so there is nothing for a table subscription to have been
 *    watching. It also carries the Requests badge.
 *
 * Deliberately does NOT subscribe to `chat_messages`. Per-thread message
 * realtime belongs to the ref-counted `thread:<id>` channel in
 * `@shared/pages/chat/chat-channel`, and a second subscription to a topic
 * Supabase has already joined throws — the same reason the dashboard's app-wide
 * realtime registry excludes chat tables outright.
 */

/**
 * Coalescing window. A burst of member-row updates should cost one refetch.
 *
 * `FLUSH_MS` is the quiet period; `MAX_FLUSH_MS` is the ceiling, and it is the
 * half that was missing. A plain trailing debounce never fires at all while
 * events keep arriving, so a group where three people are talking would have
 * frozen the unread badge until the conversation stopped — the one moment it
 * most needs to be right. The ceiling forces the batch out on a schedule
 * regardless of what is still landing.
 *
 * Every query behind this flush is a list or a count, so half a second of lag is
 * invisible; five refetches a second of an infinite inbox (which refetches EVERY
 * loaded page) is not.
 */
const FLUSH_MS = 300;
const MAX_FLUSH_MS = 1_500;
/**
 * Quiet period between two "someone new wrote to you" announcements. Ten people
 * arriving in a minute is one interruption, not ten — the Requests badge carries
 * the count, so the announcement only has to get you to look at it.
 */
const ANNOUNCE_COOLDOWN_MS = 30_000;

export function useChatInboxRealtime(
  userId: string | null | undefined,
  /** Take the user to the Requests screen from the toast / desktop notification. */
  onOpenRequests?: () => void,
) {
  const qc = useQueryClient();
  const trpc = useTRPC();

  // Kept in a ref so the announce callback can read the LATEST navigate without
  // being a dependency of the effect — re-subscribing the channel on every render
  // would rebind postgres_changes and drop events.
  const openRequestsRef = useRef(onOpenRequests);
  openRequestsRef.current = onOpenRequests;

  useEffect(() => {
    // GATE ON userId, and do not treat this as a nicety.
    // `postgres_changes` bindings are authorised ONCE, at subscribe time. Joining
    // before the session resolves binds the channel as `anon`, RLS then discards
    // every event for the entire life of that channel, and the symptom is a list
    // that simply never updates live — with no error anywhere.
    if (!userId) return;

    // Deduped by query key and HELD WHILE THE TAB IS HIDDEN. A background tab
    // still holds these queries mounted, so react-query treats them as active
    // and refetches them the moment they are invalidated — at full burst rate,
    // for a window nobody is looking at. Everything held is flushed the instant
    // the tab comes back, and the channel's own catch-up covers a real gap.
    const refetches = createInvalidator((filter) => void qc.invalidateQueries(filter), {
      wait: FLUSH_MS,
      maxWait: MAX_FLUSH_MS,
      deferWhileHidden: true,
    });

    const FILTERS = [
      trpc.chat.inbox.pathFilter(),
      trpc.chat.threadMeta.pathFilter(),
      trpc.chat.totalUnread.pathFilter(),
      trpc.chat.requestCount.pathFilter(),
      trpc.chat.listRequests.pathFilter(),
    ];
    const schedule = () => {
      for (const f of FILTERS) refetches.push(f);
    };

    /**
     * A message request landed.
     *
     * Requests used to be silent by design — the screen's own copy said so — on
     * the reasoning that a stranger should not be able to interrupt you. The cost
     * of that was a queue nobody looked at, so a legitimate first message from
     * someone you had not met simply never got read. They now announce
     * themselves, but only ever as "someone wrote": no name, no words, no way for
     * a sender to put content in front of you before you have accepted them.
     */
    let lastAnnouncedAt = 0;
    const announceRequest = () => {
      const now = Date.now();
      if (now - lastAnnouncedAt < ANNOUNCE_COOLDOWN_MS) return;
      lastAnnouncedAt = now;
      toast('New message request', {
        description: 'Someone you haven’t spoken to before wrote to you.',
        action: { label: 'View', onClick: () => openRequestsRef.current?.() },
      });
      notifyDesktop('New message request', {
        body: 'Someone you haven’t spoken to before wrote to you.',
        tag: 'prodesk-chat-request',
        onClick: () => openRequestsRef.current?.(),
      });
    };

    const handle = subscribeResilient({
      // Passed so the wrapper serialises a rebuild behind the async
      // removeChannel of the same topic. Without it, a rebuild (or a remount, or
      // StrictMode's double-invoked effect) re-subscribes `inbox:<id>` while the
      // previous teardown is still in flight, which throws.
      topic: `inbox:${userId}`,
      build: () =>
        supabase
          // The topic MUST be `inbox:<userId>` — it is what lib/realtime.ts
          // #pingInbox posts to. A channel named anything else still receives the
          // postgres_changes below and silently drops every broadcast.
          .channel(`inbox:${userId}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'chat_thread_members',
              filter: `user_id=eq.${userId}`,
            },
            schedule,
          )
          // chat_threads is RLS-scoped to threads I'm a member of, so this
          // delivers preview/last-message changes without a filter of its own.
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'chat_threads' },
            schedule,
          )
          .on('broadcast', { event: 'thread_new' }, schedule)
          .on('broadcast', { event: 'request_new' }, () => {
            schedule();
            announceRequest();
          })
          .on('broadcast', { event: 'threads_changed' }, schedule),
      // Realtime has no replay, so a re-join after any gap means refetching
      // rather than assuming we saw everything.
      onCatchUp: schedule,
    });

    return () => {
      refetches.cancel();
      handle.dispose();
    };
    // trpc/qc are stable for the app's lifetime; re-subscribing on their identity
    // would tear down and rebuild the channel on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}
