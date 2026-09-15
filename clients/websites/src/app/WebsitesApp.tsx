import { useState, type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Globe, LayoutGrid, LifeBuoy } from 'lucide-react';
import { signOut } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { NewBrandDialog } from '@shared/components/layout/new-brand-dialog';
import { useWebsitesContext } from './use-context';
import { CreateBrandOnboarding } from './CreateBrandOnboarding';
import { Home } from '../pages/Home';
import { Support } from '../pages/Support';

/**
 * Authenticated Websites shell: the shared AppShell side panel beside the routed
 * main area. Brand-level — the panel's brand dropdown (below the header) lists the
 * user's brands and persists the active one via auth.switchContext, shared across
 * frontends. When the user has no brand at all, the main area shows the create-brand
 * onboarding instead of routes.
 */

const NAV = [{ href: '/', label: 'Home', icon: LayoutGrid, key: 'home' }] as const;

/* Support (and Billing, where a frontend has one) is pinned to the end of the
   panel on every frontend — shared AppShell `tail`. */
const TAIL = [
  { href: '/support', label: 'Support', icon: LifeBuoy, key: 'support' },
] as const;

/* The frontend's own brand switcher and nav-link helpers used to live here. Both
   are now the shared AppShell's — the dropdown sits under the header and stays
   clickable with a single brand, so "New brand" is always reachable. */

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const confirm = useConfirm();
  const { brands, activeBrand } = useWebsitesContext();
  const [newBrandOpen, setNewBrandOpen] = useState(false);

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
      appKey="websites"
      panelClassName="psp-theme-accent"
      logo={
        <span className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-accent/10 text-accent">
            <Globe className="h-3.5 w-3.5" />
          </span>
          <span className="text-base font-semibold text-ink-100">Websites</span>
        </span>
      }
      groups={[{ label: 'Workspace', items: toItems(NAV) }]}
      tail={toItems(TAIL)}
      brand={{
        brands,
        activeBrandId: activeBrand?.id ?? null,
        onCreateBrand: () => setNewBrandOpen(true),
      }}
      onSignOut={() => void handleSignOut()}
    >
      {children}
      <NewBrandDialog
        open={newBrandOpen}
        onOpenChange={setNewBrandOpen}
        blurb="Each brand is its own Websites workspace. You can refine it later in Settings."
      />
    </AppShell>
  );
}

export function WebsitesApp() {
  const { brandId } = useWebsitesContext();

  return (
    <Shell>
      {brandId ? (
        <Switch>
          <Route path="/" component={Home} />
          <Route path="/support" component={Support} />
          <Route path="/support/:id" component={Support} />
          <Route component={UnknownRouteRedirect} />
        </Switch>
      ) : (
        <CreateBrandOnboarding />
      )}
    </Shell>
  );
}
