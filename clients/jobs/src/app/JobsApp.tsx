import { type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Briefcase, LayoutGrid, LifeBuoy } from 'lucide-react';
import { signOut } from '@shared/auth/auth-context';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { ContextSelector } from '@shared/components/layout/context-selector/context-selector';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { Home } from '../pages/Home';
import { Support } from '../pages/Support';

/**
 * Authenticated Jobs shell: the shared AppShell side panel beside the routed main
 * area. Jobs is neither brand- nor user-level — it's multi-role, so instead of the
 * brand dropdown it renders the shared ContextSelector (brands AND agencies) in the
 * same slot under the header, mounted UNfiltered (no appPermissions) because every
 * identity may use Jobs.
 *
 * JobsApp owns the single unknown-route → main-app handoff (see
 * UnknownRouteRedirect), the ONLY way this frontend sends a user to the main
 * app, and only automatically on an unrecognised route.
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
  const toItems = (
    items: readonly { href: string; label: string; icon: typeof LayoutGrid; key: string }[],
  ) =>
    items.map((i) => ({
      key: i.key,
      label: i.label,
      icon: <i.icon className="h-[18px] w-[18px]" />,
      href: i.href,
      active: isActive(i.href),
    }));

  return (
    <AppShell
      appKey="jobs"
      panelClassName="psp-theme-accent"
      logo={
        <span className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/10 text-accent">
            <Briefcase className="h-3.5 w-3.5" />
          </span>
          <span className="text-base font-semibold text-ink-100">Jobs</span>
        </span>
      }
      // Multi-role: the shared context selector takes the brand dropdown's slot.
      // It handles its own collapsed (logo-only) trigger, so hand it the state.
      contextSlot={({ collapsed, expand, collapse }) => (
        <ContextSelector collapsed={collapsed} onExpand={expand} onCollapse={collapse} />
      )}
      groups={[{ label: 'Workspace', items: toItems(NAV) }]}
      tail={toItems(TAIL)}
      onSignOut={() => void handleSignOut()}
    >
      {children}
    </AppShell>
  );
}

export function JobsApp() {
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
