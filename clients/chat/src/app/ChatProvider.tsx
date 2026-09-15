import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { usePresenceHeartbeat } from '@shared/hooks/use-presence-heartbeat';
import { useTRPC } from '@shared/lib/trpc';
import { watchSystemGround } from '../lib/ground';
import { useChatInboxRealtime } from './realtime-inbox';
import { useChatInvalidate } from './use-invalidate';

/**
 * The app's ONE React context — and it is deliberately tiny.
 *
 * It holds four values that ~every component reads and that essentially never
 * change (who I am, and whether this is a phone), and it mounts the two things
 * that must exist exactly once (the presence heartbeat, the system-ground
 * watcher).
 *
 * What it must NEVER hold: the active thread (that's the URL), composer drafts
 * or typing state (module stores — a keystroke there would re-render the shell
 * and every message in view), or the message cache (react-query). A provider
 * that owns all of those is how a chat UI becomes a 3,700-line monolith by
 * proxy, which is exactly the shared MessagePanel this frontend exists to not be.
 */

type ChatMe = {
  /** The signed-in user's id. Null only while auth is still resolving. */
  meId: string | null;
  meName: string;
  meAvatar: string | null;
  /** True below the breakpoint where list and room stop sharing the screen. */
  isMobile: boolean;
};

const ChatCtx = createContext<ChatMe>({
  meId: null,
  meName: '',
  meAvatar: null,
  isMobile: false,
});

/** The single breakpoint in the app: below this, list and room are one stack. */
export const MOBILE_QUERY = '(max-width: 899px)';

/**
 * Make sure the personal notes thread exists, once per signed-in session.
 *
 * The messenger never provisioned anything: `you` threads were created on signup
 * by the workspace's `ensurePlatformAdminThread`, so anyone whose account predates
 * that hook — or who was provisioned by a path that skipped it — opened this app
 * with no notes conversation and no gesture anywhere that could make one. There is
 * no "New note" button to add, either: a notes thread is not something you should
 * have to create, so the app creates it.
 *
 * Cheap and quiet by design. The mutation is two indexed reads when the thread is
 * already there (the overwhelming case), the inbox is re-fetched ONLY on the boot
 * that actually created something, and a failure is swallowed — a messenger that
 * refuses to open because a notes row could not be written would be trading a
 * missing convenience for a broken app.
 */
function useEnsureNotesThread(userId: string | undefined) {
  const trpc = useTRPC();
  const invalidate = useChatInvalidate();
  const ensure = useMutation(trpc.chat.ensureNotes.mutationOptions());
  // Per USER, not per mount: a remount (Fast Refresh, a route change that
  // remounts the provider) must not re-fire it, but signing in as someone else
  // must.
  const doneFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || doneFor.current === userId) return;
    doneFor.current = userId;
    ensure.mutate(undefined, {
      onSuccess: (result) => {
        if (result.created) invalidate.afterThreadChange();
      },
      // Deliberately silent: nothing the user did caused this and there is
      // nothing for them to do about it.
      onError: () => {},
    });
    // `ensure` and `invalidate` are rebuilt every render; the ref is what makes
    // this run once, so depending on them would only cause churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => {
    try {
      return window.matchMedia(MOBILE_QUERY).matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia(MOBILE_QUERY);
    } catch {
      return;
    }
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return mobile;
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { data: user } = useCurrentUser();
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();

  // The server suppresses chat-digest emails for users whose heartbeat is fresh.
  // A messenger that emails you about a message you are actively looking at is
  // the fastest way to get its notifications muted, so this is not optional here.
  usePresenceHeartbeat(!!user?.id);

  // The inbox's live wire — mounted exactly once, here. Gated on the user id
  // inside the hook, because a channel joined before the session resolves binds
  // as `anon` and silently receives nothing for its whole life.
  useChatInboxRealtime(user?.id, () => navigate('/requests'));

  // Everyone gets a personal notes conversation, without asking for one.
  useEnsureNotesThread(user?.id);

  // While the ground preference is `system`, follow the OS (macOS flips at dusk).
  useEffect(() => watchSystemGround(), []);

  const value = useMemo<ChatMe>(
    () => ({
      meId: user?.id ?? null,
      meName:
        [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
        user?.email ||
        'You',
      meAvatar: user?.profileUrl ?? null,
      isMobile,
    }),
    [user?.id, user?.firstName, user?.lastName, user?.email, user?.profileUrl, isMobile],
  );

  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export function useChatMe(): ChatMe {
  return useContext(ChatCtx);
}
