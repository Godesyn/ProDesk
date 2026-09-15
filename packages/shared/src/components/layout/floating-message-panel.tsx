import { Suspense, lazy, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { supabase } from '../../lib/supabase';
import { subscribeResilient } from '../../lib/resilient-channel';
import { createCoalescer } from '../../lib/coalesce';
import { useCurrentUser } from '../../auth/auth-context';
import { useChatNav } from '../../pages/chat/chat-nav-context';

// Lazy so chat.tsx (heavy: message panel, AI chat, markdown) splits into its own
// chunk and only loads when the dock is first opened. The app's /chat route also
// imports it dynamically; keeping BOTH dynamic is what lets Rollup split it (a
// single static import anywhere would pull it into the main bundle). The launcher
// FAB + unread badge below render without it.
const ChatPage = lazy(() =>
  import('../../pages/chat').then((m) => ({ default: m.ChatPage })),
);

/**
 * Floating chat launcher + docked panel. Ports `FloatingMessagePanel`
 * (floating_message_panel.dart): a bottom-right FAB with a live unread badge
 * that, on desktop, opens a docked chat panel and, on small screens, routes to
 * the full-screen `/chat` page. Mounted once in `MainLayout`.
 */
export function FloatingMessagePanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const [location, navigate] = useLocation();
  // Open state is shared so external chat-launch chips (project chips, the
  // clients/agencies "Chat" buttons) can pop the docked panel open too.
  const { open, setOpen } = useChatNav();

  const totalUnreadQ = useQuery({ ...trpc.chat.totalUnread.queryOptions(), enabled: !!me?.id });
  const unread = totalUnreadQ.data?.total ?? 0;

  // Keep the badge live even while the panel is closed: any change to one of the
  // user's membership rows (new message → unread bump, or read → reset) refetches.
  useEffect(() => {
    if (!me?.id) return;
    // Coalesced, and held while the tab is hidden. Every message in every thread
    // bumps one of this user's membership rows, so an un-batched handler
    // refetched the badge once per arriving message — a count that is allowed to
    // be half a second late, fetched thirty times a second.
    const badge = createCoalescer<null>(
      () => void qc.invalidateQueries({ queryKey: trpc.chat.totalUnread.queryKey() }),
      { wait: 400, maxWait: 2_000, deferWhileHidden: true },
    );
    const invalidateUnread = () => badge.push(null);
    // Resilient subscription: revives the badge feed after sleep/offline drops
    // and refetches the count on re-join (events during the gap aren't replayed).
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic: `fab-unread:${me.id}`,
      build: () => supabase
        .channel(`fab-unread:${me.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_members', filter: `user_id=eq.${me.id}` }, invalidateUnread),
      onCatchUp: invalidateUnread,
    });
    return () => {
      badge.cancel();
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Don't double up on the dedicated /chat page, and require a signed-in user.
  if (!me?.id || location === '/chat') return null;

  const launch = () => {
    const small = window.innerWidth < 768 || window.innerHeight < 600;
    if (small) navigate('/chat');
    else setOpen(true);
  };

  return (
    <>
      {/* Launcher FAB */}
      {!open && (
        <button
          onClick={launch}
          aria-label="Open messages"
          className="fixed bottom-4 right-4 z-40 inline-flex h-12 w-12 items-center justify-center rounded-[var(--radius-md)] border-[1.5px] border-ink-100 bg-accent text-ink-100 shadow-lg transition-transform hover:scale-105 md:bottom-6 md:right-6 md:h-14 md:w-14"
        >
          <MessageCircle className="h-6 w-6" />
          {unread > 0 && (
            <span className="absolute -right-1.5 -top-1.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full border border-ink-100 bg-danger px-1 font-mono text-[10px] font-bold leading-none text-paper">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      )}

      {/* Docked panel (desktop) */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="fixed bottom-4 right-4 z-50 flex h-[min(720px,calc(100vh-2rem))] w-[min(900px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card shadow-2xl">
            <Suspense fallback={<div className="grid flex-1 place-items-center text-sm text-ink-40">Loading messages…</div>}>
              <ChatPage embedded onClose={() => setOpen(false)} />
            </Suspense>
          </div>
        </>
      )}
    </>
  );
}
