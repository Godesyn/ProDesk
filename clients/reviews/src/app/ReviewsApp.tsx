/* Verdiict app shell — wouter routing on top of the shared AppShell side panel.
 * Mirrors clients/links' LinksApp: brand-scoped, owns the single unknown-route →
 * main-app handoff, and reacts to the ?sub=success return from Stripe checkout.
 * The panel itself (layout, suite row, brand dropdown, collapse, Support/
 * Billing tail, sign out) is @shared/components/layout/app-side-panel; Verdiict
 * supplies only its palette, via .psp-theme-verdiict in styles/verdiict.css — on top
 * of the shared `psp-ink` dark-rail contract, which is what makes its dropdown match
 * SIGKITT's and every other black panel's. */
import { useEffect, useState } from 'react';
import { Redirect, Route, Switch, useLocation, useRoute } from 'wouter';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { useReviewsContext } from './use-context';
import { useTRPC } from '@shared/lib/trpc';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import {
  LayoutGrid,
  Send,
  Code2,
  Sparkles,
  Globe,
  Users,
  CreditCard,
  LifeBuoy,
  Trash2,
} from 'lucide-react';
import { ToastProvider, useToast } from './toast';
import { ConfirmProvider, useConfirm } from './confirm';
import { Modal } from './components';
import {
  CreateBrandFlow,
  CreateBrandOnboarding,
} from './CreateBrandOnboarding';
import { VerdiictLogo } from './VerdiictLogo';
import type { Page, RouteParams } from './lib';
import { LocationsHome } from './pages/LocationsHome';
import { LocationSettings } from './pages/LocationSettings';
import { ReviewsLog } from './pages/ReviewsLog';
import { ReviewRequests } from './pages/ReviewRequests';
import { EmbedHome } from './pages/EmbedHome';
import { EmbedDetail } from './pages/EmbedDetail';
import { CollectionDetail } from './pages/CollectionDetail';
import { Progress } from './pages/Progress';
import { DirectoryProfile } from './pages/DirectoryProfile';
import { Team } from './pages/Team';
import { Billing } from './pages/Billing';
import { Trash } from './pages/Trash';
import { Support } from './pages/Support';

type NavItem = [key: Page, icon: typeof LayoutGrid, label: string];
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Capture',
    items: [
      ['locations', LayoutGrid, 'Locations'],
      ['requests', Send, 'Review requests'],
      ['embed', Code2, 'Embeds'],
    ],
  },
  { label: 'Measure', items: [['progress', Sparkles, 'Progress']] },
  {
    label: 'Account',
    items: [
      ['directory', Globe, 'Directory profile'],
      ['team', Users, 'Team'],
      ['trash', Trash2, 'Trash'],
    ],
  },
];

/* Support + Billing are pinned to the end of the panel on every frontend (shared
   AppShell `tail`), so they're deliberately NOT in the groups above. */
const TAIL_NAV: NavItem[] = [
  ['support', LifeBuoy, 'Support'],
  ['billing', CreditCard, 'Billing'],
];

function pathFor(page: Page, params: RouteParams = {}): string {
  switch (page) {
    case 'locations':
      return '/';
    case 'location':
      return `/l/${params.id}`;
    case 'reviewsLog':
      return `/l/${params.id}/reviews`;
    case 'requests':
      return '/requests';
    case 'embed':
      return '/embed';
    case 'embedDetail':
      return `/embed/${params.id}`;
    case 'collection':
      return `/collections/${params.id}`;
    case 'progress':
      return '/progress';
    case 'directory':
      return '/directory-profile';
    // Team is a native Verdiict page rendered inside this shell (not the shared
    // main-app screen) — see the /team route below. Invoices aren't a top-level
    // page; they live under Billing.
    case 'team':
      return '/team';
    case 'billing':
      return '/billing';
    case 'trash':
      return '/trash';
    case 'support':
      return '/support';
  }
}

function activeNavFor(loc: string): Page {
  if (loc === '/' || loc.startsWith('/l/')) return 'locations';
  if (loc.startsWith('/requests')) return 'requests';
  if (loc.startsWith('/embed') || loc.startsWith('/collections'))
    return 'embed';
  if (loc.startsWith('/progress')) return 'progress';
  if (loc.startsWith('/directory-profile')) return 'directory';
  if (loc.startsWith('/team') || loc.startsWith('/staff')) return 'team';
  if (loc.startsWith('/billing')) return 'billing';
  if (loc.startsWith('/trash')) return 'trash';
  if (loc.startsWith('/support')) return 'support';
  return 'locations';
}

function Shell() {
  const { data: user } = useCurrentUser();
  const { brandId, activeBrand, brands } = useReviewsContext();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [location, navigate] = useLocation();
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
  // The Prodesk Suite row lives at the top of the shared AppShell panel, which
  // owns the cross-app handoff. UnknownRouteRedirect below still targets the MAIN
  // app and only ever fires automatically.
  const [, locParams] = useRoute('/l/:id');
  const [, logParams] = useRoute('/l/:id/reviews');
  const [, embedParams] = useRoute('/embed/:id');
  const [, colParams] = useRoute('/collections/:id');
  const [showNewBrand, setShowNewBrand] = useState(false);

  // Write access mirrors the server gate (assertBrandAccess …, 'reviews'): the
  // brand owner always edits; staff need the `reviews` permission. Viewer-only
  // staff (`reviewsViewer`) get a read-only UI so they never see a control the
  // server would reject. Same pattern as clients/links' useCanEditLinks.
  const permissions: string[] = user?.permissions ?? [];
  const canEdit =
    user?.role === 'brandOwner' || permissions.includes('reviews');
  // Sending review requests is allowed for read-only viewers too — they can invite
  // customers to leave a review without gaining edit rights (mirrors the server's
  // requireLocationSend gate).
  const canSendRequests = canEdit || permissions.includes('reviewsViewer');
  const roleLabel =
    user?.role === 'brandOwner'
      ? 'Owner'
      : permissions.includes('reviews')
        ? 'Editor'
        : permissions.includes('reviewsViewer')
          ? 'Viewer'
          : null;

  const go = (page: Page, params: RouteParams = {}) => {
    // Every workspace page (including Team + Invoices) routes within this shell;
    // only /profile is still mounted by App.tsx (user-scoped). AppShell closes its
    // own mobile drawer on navigation, so there's no menu state to clear here.
    navigate(pathFor(page, params));
  };

  const { data: entitlement } = useQuery({
    ...trpc.reviews.entitlement.queryOptions({ brandId: brandId as string }),
    enabled: !!brandId,
  });

  // Return from Stripe checkout (?sub=success|cancel).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('sub');
    if (!sub) return;
    if (sub === 'success') {
      toast('Subscription active. Your review pages are live.');
      qc.invalidateQueries({ queryKey: trpc.reviews.entitlement.queryKey() });
    } else if (sub === 'cancel') {
      toast('Checkout cancelled.');
    }
    params.delete('sub');
    const qs = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? '?' + qs : ''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // No brand for the context selector (e.g. an agency-only user, or a brand user
  // whose brand was removed) → initiate the create-brand onboarding instead of
  // dead-ending. Same two-step flow as signup; creating a brand scopes the app to
  // it and drops into the workspace.
  if (!brandId) {
    return <CreateBrandOnboarding />;
  }

  const pageProps = (params: RouteParams = {}) => ({
    brandId,
    entitlement,
    canEdit,
    canSendRequests,
    go,
    params,
  });
  const activeNav = activeNavFor(location);

  const toItems = (items: NavItem[]) =>
    items.map(([key, Icon, label]) => ({
      key,
      label,
      icon: <Icon size={17} />,
      active: activeNav === key,
      onClick: () => go(key),
    }));

  return (
    <AppShell
      appKey="reviews"
      panelClassName="psp-ink psp-theme-verdiict"
      mainClassName="vmain"
      logo={<VerdiictLogo color="currentColor" height={20} />}
      groups={NAV_GROUPS.map((g) => ({
        label: g.label,
        items: toItems(g.items),
      }))}
      tail={toItems(TAIL_NAV)}
      brand={{
        brands,
        activeBrandId: activeBrand?.id ?? null,
        roleLabel,
        onSwitched: () => go('locations'),
        onCreateBrand: () => setShowNewBrand(true),
      }}
      onSignOut={() => void handleSignOut()}
    >
      <Switch>
        <Route path="/">{() => <LocationsHome {...pageProps()} />}</Route>
        <Route path="/l/:id/reviews">
          {() => <ReviewsLog {...pageProps({ id: logParams?.id })} />}
        </Route>
        {/* Legacy path used by already-sent bad-review alert emails. */}
        <Route path="/reviews/:id/log">
          {(p) => <Redirect to={`/l/${p.id}/reviews`} replace />}
        </Route>
        <Route path="/l/:id">
          {() => <LocationSettings {...pageProps({ id: locParams?.id })} />}
        </Route>
        <Route path="/requests">
          {() => <ReviewRequests {...pageProps()} />}
        </Route>
        <Route path="/embed">{() => <EmbedHome {...pageProps()} />}</Route>
        <Route path="/embed/:id">
          {() => <EmbedDetail {...pageProps({ id: embedParams?.id })} />}
        </Route>
        <Route path="/collections/:id">
          {() => <CollectionDetail {...pageProps({ id: colParams?.id })} />}
        </Route>
        <Route path="/progress">{() => <Progress {...pageProps()} />}</Route>
        <Route path="/directory-profile">
          {() => <DirectoryProfile {...pageProps()} />}
        </Route>
        <Route path="/team">{() => <Team {...pageProps()} />}</Route>
        {/* Support is a native Verdiict screen; the shared page mount was removed
              from App.tsx. Both routes render the same component (it reads the URL). */}
        <Route path="/support">{() => <Support />}</Route>
        <Route path="/support/:id">{() => <Support />}</Route>
        {/* Old deep links (emails, saved links) pointed at the shared /staff. */}
        <Route path="/staff">{() => <Redirect to="/team" replace />}</Route>
        {/* Invoices moved into Billing; keep old /invoices links working. */}
        <Route path="/invoices">
          {() => <Redirect to="/billing" replace />}
        </Route>
        <Route path="/billing">{() => <Billing {...pageProps()} />}</Route>
        <Route path="/trash">{() => <Trash {...pageProps()} />}</Route>
        <Route component={UnknownRouteRedirect} />
      </Switch>

      {showNewBrand && (
        <Modal
          title="Add a brand"
          onClose={() => setShowNewBrand(false)}
          width={560}
        >
          {/* Same two-step create-brand flow as signup. brands.create sets the
              new brand as the selected context server-side, so once queries
              refresh the app is already scoped to it — just close and land on
              Locations. */}
          <CreateBrandFlow
            onComplete={() => {
              setShowNewBrand(false);
              go('locations');
            }}
            onCancel={() => setShowNewBrand(false)}
          />
        </Modal>
      )}
    </AppShell>
  );
}

/* The brand switcher (with its own avatar) AND the sidebar plan/beta badge used to
   live here.
   • The switcher is now the shared AppShell's brand slot (below the header, always
     clickable so "New brand" is reachable even with one brand).
   • The badge was removed deliberately: plan, price and subscribe state belong on
     the Billing page, which carries all of it. */

export function ReviewsApp() {
  return (
    <div className="verdiict" data-tool="reviews">
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </div>
  );
}
