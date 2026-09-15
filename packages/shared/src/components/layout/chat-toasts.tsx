import { useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { subscribeResilient } from '../../lib/resilient-channel';
import { createCoalescer } from '../../lib/coalesce';
import { playMessageSound } from '../../lib/notification-sound';
import { useCurrentUser } from '../../auth/auth-context';
import { useChatNav } from '../../pages/chat/chat-nav-context';

/**
 * Global in-app new-message snackbars. While the app is open, any incoming chat
 * message (from someone other than me, in a thread I'm not currently viewing)
 * pops a sonner toast — the web equivalent of Flutter's online→snackbar branch
 * (on_chat_message_created.ts). Mounted once in MainLayout, inside ChatNavProvider.
 *
 * Delivery is scoped by the chat_messages RLS policy (chat_messages_member), so a
 * single unfiltered INSERT subscription only ever surfaces messages in threads
 * the user belongs to.
 *
 * ONE TOAST PER CONVERSATION, and one chime per burst. This used to pop a toast
 * and play the chime per arriving row, so a group where three people were
 * talking buried the screen under a stack of snackbars and played the two-note
 * ding over itself until it was a drone. A notification is meant to make you
 * look; thirty of them make you close the app. Arrivals are batched, collapsed
 * per thread (sonner replaces a toast that reuses its id), and the newest
 * message of each conversation is the one shown — with a count when it stands
 * for several.
 */

/** Batching window for arrivals — long enough to gather a real burst. */
const TOAST_BATCH_MS = 400;
const TOAST_BATCH_MAX_MS = 1_500;
/** No conversation may re-announce itself more often than this. */
const PER_THREAD_COOLDOWN_MS = 4_000;

type Incoming = { threadId: string; senderName: string; preview: string };

export function ChatToasts() {
  const { data: me } = useCurrentUser();
  const { open, activeThreadId, setOpen } = useChatNav();
  const [location, navigate] = useLocation();

  // Latest view state, read inside the (resubscribe-free) realtime handler so we
  // can suppress a toast for the thread the user is actively looking at.
  const viewRef = useRef({ open, activeThreadId, location });
  viewRef.current = { open, activeThreadId, location };
  const openRef = useRef(setOpen);
  openRef.current = setOpen;
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    const myId = me?.id;
    if (!myId) return;

    /** When each conversation last announced itself. */
    const lastAnnounced = new Map<string, number>();

    const announce = createCoalescer<Incoming>(
      (batch) => {
        // Group by conversation: five messages in one thread is ONE event to a
        // person, and the newest of them is the one worth showing.
        const byThread = new Map<string, { newest: Incoming; count: number }>();
        for (const m of batch) {
          const seen = byThread.get(m.threadId);
          if (seen) {
            seen.newest = m;
            seen.count += 1;
          } else {
            byThread.set(m.threadId, { newest: m, count: 1 });
          }
        }

        const now = Date.now();
        let announcedAny = false;
        for (const [threadId, { newest, count }] of byThread) {
          const last = lastAnnounced.get(threadId) ?? 0;
          if (now - last < PER_THREAD_COOLDOWN_MS) continue;
          lastAnnounced.set(threadId, now);
          announcedAny = true;
          toast(newest.senderName, {
            // Reusing the id makes sonner REPLACE this conversation's snackbar
            // rather than stack another one under it.
            id: `chat-msg-${threadId}`,
            description:
              count > 1 ? `${newest.preview} · ${count} new messages` : newest.preview,
            action: {
              label: 'Open',
              onClick: () => {
                const small = window.innerWidth < 768 || window.innerHeight < 600;
                if (small) navRef.current('/chat');
                else openRef.current(true);
              },
            },
          });
        }
        // One chime for the batch, however many conversations it spans — the
        // sound says "something arrived", and saying it eight times at once is
        // just noise.
        if (announcedAny) playMessageSound();
      },
      { wait: TOAST_BATCH_MS, maxWait: TOAST_BATCH_MAX_MS, deferWhileHidden: false },
    );

    // Resilient subscription so the toast feed survives sleep/offline drops. No
    // catch-up on re-join: a toast for a message that arrived while the tab was
    // hidden would be stale noise — the unread badge / thread list carry that.
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic: 'chat-toasts',
      onCatchUp: () => {},
      build: () => supabase
      .channel('chat-toasts')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        ({ new: row }) => {
          const r = row as Record<string, unknown>;
          const senderId = r.sender_id == null ? '' : String(r.sender_id);
          if (!senderId || senderId === myId) return; // never toast my own messages
          const threadId = r.thread_id == null ? '' : String(r.thread_id);

          // Skip if I'm already looking at this thread (docked panel or /chat page).
          const v = viewRef.current;
          const viewing = (v.open || v.location === '/chat') && v.activeThreadId === threadId;
          if (viewing) return;

          const senderName = r.sender_name ? String(r.sender_name) : 'New message';
          const type = r.type ? String(r.type) : 'text';
          const content = r.content ? String(r.content) : '';
          const preview =
            type === 'image' ? '📷 Photo'
            : type === 'video' ? '🎬 Video'
            : type === 'document' ? '📎 Attachment'
            : content || 'Sent a message';

          announce.push({ threadId, senderName, preview });
        },
      ),
    });
    return () => {
      // Cancelled, not flushed: a snackbar for a screen that is being torn down
      // has nothing to announce to.
      announce.cancel();
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  return null;
}
