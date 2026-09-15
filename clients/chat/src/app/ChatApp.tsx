import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import {
  Archive,
  Inbox as InboxIcon,
  LifeBuoy,
  Search,
  Settings2,
  User,
  UserPlus,
} from 'lucide-react';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { ChatMark } from '../components/primitives';
import { ChatProvider } from './ChatProvider';
import { useChatBadges } from './badges';
import { Inbox } from '../pages/Inbox';
import { Archived } from '../pages/Archived';
import { Thread } from '../pages/Thread';
import { Requests } from '../pages/Requests';

// Weight that no first paint needs. The messenger itself — inbox, room, list,
// composer — is eager, because it IS the app; everything reached by an explicit
// gesture is split out.
const SearchPage = lazy(() =>
  import('../pages/Search').then((m) => ({ default: m.SearchPage })),
);
const SettingsPage = lazy(() =>
  import('../pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const Support = lazy(() => import('../pages/Support').then((m) => ({ default: m.Support })));
const Account = lazy(() => import('../pages/Account').then((m) => ({ default: m.Account })));

/**
 * The authenticated Chat shell.
 *
 * The rail is narrow and starts collapsed (see main.tsx): a messenger's whole
 * navigation is four rows, and every pixel it does not take is a pixel of
 * conversation. Unlike Logo Studio and KEYMASTR the panel is NOT permanently
 * dark — it reads `--room` from `.cx-ui`, so it goes light in Day with the rest
 * of the app. A black slab down the side of a light room looks like two
 * applications stapled together.
 *
 * Route shape is master/detail: `/` is the inbox and `/t/:threadId` is the room.
 * On desktop the inbox renders both panes; below 900px they are two screens and
 * Back returns to the list. Each page decides that for itself from
 * `useChatMe().isMobile` rather than the router branching twice.
 */

/**
 * THE KEYBOARD PROBLEM, which is the difference between a web messenger and one
 * that feels like it belongs on the phone.
 *
 * `100dvh` is the LAYOUT viewport, and on iOS the software keyboard does not
 * change it. It slides over the page instead — so the composer, which is pinned
 * to the bottom of a full-height column, ends up underneath the keyboard you
 * opened in order to type into it. The transcript's last few messages go with
 * it. Android is better but not consistent, and neither is Safari across
 * versions.
 *
 * `visualViewport` is the part actually being shown, keyboard subtracted, and
 * it is the only measurement that answers the question. Publishing it as a
 * custom property rather than wiring it into a component keeps the layout in CSS
 * and means one listener for the whole app.
 *
 * `offsetTop` matters as much as the height: when the keyboard opens, iOS
 * scrolls the layout viewport rather than resizing it, which pushes the top of
 * the app off screen. Pulling that back to zero is what stops the header
 * disappearing every time someone taps the composer.
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    const apply = () => {
      cancelAnimationFrame(frame);
      // Coalesced: the keyboard animating in fires a burst of resize events, and
      // writing a custom property on each one relayouts the entire app per frame.
      frame = requestAnimationFrame(() => {
        root.style.setProperty('--cx-app-height', `${Math.round(vv.height)}px`);
        if (vv.offsetTop > 0 || window.scrollY > 0) window.scrollTo(0, 0);
      });
    };
    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      root.style.removeProperty('--cx-app-height');
    };
  }, []);
}

function Loading() {
  return (
    <div className="grid h-full place-items-center">
      <span className="spec">Loading…</span>
    </div>
  );
}

/**
 * A count on a rail row. Rendered only when there is something to count — a
 * permanent "0" beside Requests is a row that always looks like it needs
 * attention and therefore stops carrying any.
 */
function RailBadge({ count, tone }: { count: number; tone: 'live' | 'quiet' }) {
  if (count <= 0) return null;
  return (
    <span
      className="inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-1.5 text-[10.5px] font-bold tabular-nums"
      style={
        tone === 'live'
          ? { background: 'var(--live)', color: '#fff' }
          : { background: 'var(--room-3)', color: 'var(--voice-2)' }
      }
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const confirm = useConfirm();
  const { data: user } = useCurrentUser();
  const badges = useChatBadges();

  useVisualViewportHeight();

  /**
   * A file dropped anywhere OUTSIDE the conversation must do nothing.
   *
   * The browser's default for a dropped file is to navigate to it, which throws
   * the user out of the app and loses their drafts, their scroll position and
   * their realtime connection — for a mis-aimed drag. Now that dropping files
   * into a conversation is a real gesture people will use, near-misses are
   * guaranteed, so the whole document swallows what the room did not catch.
   * The room's own handler calls `preventDefault` first and stops there, so this
   * never interferes with a drop that landed.
   */
  useEffect(() => {
    const swallow = (e: DragEvent) => {
      if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return;
      e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  const handleSignOut = async () => {
    if (
      await confirm({
        title: 'Sign out?',
        description: 'You’ll need to log in again to get back in.',
        confirmLabel: 'Sign out',
        destructive: true,
      })
    )
      void signOut();
  };

  const isActive = (href: string) =>
    href === '/' ? location === '/' || location.startsWith('/t/') : location.startsWith(href);

  return (
    /* .cx-ui must wrap the PANEL too: .psp-theme-chat reads --room/--voice from it. */
    <div className="cx-ui">
      <AppShell
        appKey="chat"
        panelClassName="psp-ink psp-theme-chat"
        logo={
          <span className="flex items-center gap-2.5">
            <ChatMark className="h-[19px] w-[19px]" />
            <span className="text-[15px] font-semibold tracking-tight">Chat</span>
          </span>
        }
        groups={[
          {
            items: [
              // Search sits ABOVE the inbox, which reads oddly for a nav list and
              // is right for this app: the inbox is where you already are (`/` is
              // the app's root, reached by the logo and by every Back), so the row
              // that earns the top slot is the one you cannot get to any other way.
              {
                key: '/search',
                label: 'Search',
                icon: <Search className="h-[18px] w-[18px]" />,
                href: '/search',
                active: isActive('/search'),
              },
              {
                key: '/',
                label: 'Inbox',
                icon: <InboxIcon className="h-[18px] w-[18px]" />,
                href: '/',
                active: isActive('/'),
                badge: <RailBadge count={badges.unread} tone="live" />,
              },
              {
                key: '/requests',
                label: 'Requests',
                icon: <UserPlus className="h-[18px] w-[18px]" />,
                href: '/requests',
                active: isActive('/requests'),
                // Quiet, not pigment: a request is an invitation to decide, not an
                // obligation, and it must never compete with real unread messages.
                badge: <RailBadge count={badges.requests} tone="quiet" />,
              },
              {
                key: '/archived',
                label: 'Archived',
                icon: <Archive className="h-[18px] w-[18px]" />,
                href: '/archived',
                active: isActive('/archived'),
              },
            ],
          },
          {
            label: 'Account',
            items: [
              {
                key: '/settings',
                label: 'Settings',
                icon: <Settings2 className="h-[18px] w-[18px]" />,
                href: '/settings',
                active: isActive('/settings'),
              },
            ],
          },
        ]}
        tail={[
          {
            key: 'support',
            label: 'Support',
            icon: <LifeBuoy className="h-[18px] w-[18px]" />,
            href: '/support',
            active: isActive('/support'),
          },
        ]}
        // User-level: no brand dropdown. The identity row sits above the exit row.
        identity={{
          key: 'profile',
          label:
            [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
            user?.email ||
            'Profile',
          icon: <User className="h-[18px] w-[18px]" />,
          href: '/profile',
          active: isActive('/profile'),
        }}
        onSignOut={() => void handleSignOut()}
      >
        {/*
          100dvh + overflow-hidden, not min-h-screen. A messenger does not scroll
          as a page — the transcript and the thread list are their own scrollers,
          and a document-level scrollbar behind them breaks the bottom anchor and
          bounces the composer off the bottom of a phone.
        */}
        <div
          className="cx-ui flex flex-col overflow-hidden"
          // `--cx-app-height` is the VISUAL viewport (see
          // useVisualViewportHeight); 100dvh is the fallback for browsers
          // without the API, and the value it resolves to everywhere the
          // keyboard isn't open.
          style={{ height: 'var(--cx-app-height, 100dvh)', background: 'var(--room)' }}
        >
          {children}
        </div>
      </AppShell>
    </div>
  );
}

export function ChatApp() {
  return (
    <ChatProvider>
      <Shell>
        <Suspense fallback={<Loading />}>
          <Switch>
            <Route path="/" component={Inbox} />
            <Route path="/t/:threadId" component={Thread} />
            <Route path="/archived" component={Archived} />
            {/* The archive's own thread route — see pages/Archived.tsx. Opening
                one at /t/:id would drop the rail back to Inbox mid-task. */}
            <Route path="/archived/t/:threadId" component={Archived} />
            <Route path="/requests" component={Requests} />
            <Route path="/search" component={SearchPage} />
            <Route path="/settings" component={SettingsPage} />
            <Route path="/support" component={Support} />
            <Route path="/support/:id" component={Support} />
            <Route path="/profile" component={Account} />
            {/* Unmatched routes go to this frontend's own root — never a 404
                screen. Exactly one shared implementation, mounted LAST. */}
            <Route component={UnknownRouteRedirect} />
          </Switch>
        </Suspense>
      </Shell>
    </ChatProvider>
  );
}
