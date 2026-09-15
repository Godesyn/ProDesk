import { type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { LayoutGrid, LifeBuoy, Palette, User } from 'lucide-react';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { Home } from '../pages/Home';
import { Support } from '../pages/Support';

/**
 * Authenticated Design shell: the shared AppShell side panel beside the routed
 * main area. Design is USER-LEVEL — there's no brand switcher, so the panel has no
 * top dropdown and instead carries a plain Profile row above the exit row; the
 * experience fans across every brand the user can access (see pages/Home).
 *
 * DesignApp owns the single unknown-route → main-app handoff (with loop guard).
 */

const NAV = [{ href: '/', label: 'Home', icon: LayoutGrid, key: 'home' }] as const;

/* Support (and Billing, where a frontend has one) is pinned to the end of the
   panel on every frontend — shared AppShell `tail`. */
const TAIL = [
  { href: '/support', label: 'Support', icon: LifeBuoy, key: 'support' },
] as const;

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const confirm = useConfirm();
  const { data: user } = useCurrentUser();

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
    href === '/' ? location === '/' : location.startsWith(href);
  const toItems = (items: readonly { href: string; label: string; icon: typeof LayoutGrid; key: string }[]) =>
    items.map((i) => ({
      key: i.key,
      label: i.label,
      icon: <i.icon className="h-[18px] w-[18px]" />,
      href: i.href,
      active: isActive(i.href),
    }));

  return (
    <AppShell
      appKey="design"
      panelClassName="psp-theme-accent"
      logo={
        <span className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/10 text-accent">
            <Palette className="h-3.5 w-3.5" />
          </span>
          <span className="text-base font-semibold text-ink-100">Design</span>
        </span>
      }
      groups={[{ label: 'Workspace', items: toItems(NAV) }]}
      tail={toItems(TAIL)}
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
      {children}
    </AppShell>
  );
}

export function DesignApp() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/support" component={Support} />
        <Route path="/support/:id" component={Support} />
        <Route component={UnknownRouteRedirect} />
      </Switch>
    </Shell>
  );
}
