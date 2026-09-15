/* Adeyy app shell — URL routing (wouter), billing banner + checkout, on top of the
 * shared AppShell side panel. Ported from the Manus export's App.jsx, rewired to
 * our auth/tenancy/tRPC and real browser routing so links deep-link and the back
 * button works. The panel itself (layout, brand dropdown, collapse, Support/Billing
 * tail, sign out) is @shared/components/layout/app-side-panel; Adeyy supplies only
 * its palette — the light card rail — via .psp-theme-adeyy in styles/adeyy.css. */
import { useEffect, useState } from 'react';
import { Route, Switch, useLocation, useRoute } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { signOut } from '@shared/auth/auth-context';
import { useLinksContext } from './use-context';
import { useTRPC } from '@shared/lib/trpc';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { Icon, Modal } from './components';
import { CreateBrandOnboarding } from './CreateBrandOnboarding';
import { ToastProvider, useToast } from './toast';
import { ConfirmProvider, useConfirm } from './confirm';
import { useCanEditLinks } from './use-can-edit';
import { useLinksInvalidate } from './use-invalidate';
import type { Page, RouteParams } from './types';
import { LinksHome } from './pages/LinksHome';
import { CreateLink } from './pages/CreateLink';
import { LinkDetail } from './pages/LinkDetail';
import { Campaigns } from './pages/Campaigns';
import { CreateCampaign } from './pages/CreateCampaign';
import { CampaignDetail } from './pages/CampaignDetail';
import { Analytics } from './pages/Analytics';
import { BulkCreate } from './pages/BulkCreate';
import { Billing } from './pages/Billing';
import { Settings } from './pages/Settings';
import { Support } from './pages/Support';

type NavItem = [key: Page, icon: string, label: string];
type NavGroup = { label: string | null; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Shorten',
    items: [
      ['links', 'link', 'Links'],
      ['bulk', 'upload', 'Bulk create'],
      // A campaign is a scheduled short link — same table, its own screen.
      ['campaigns', 'calendar', 'Campaigns'],
    ],
  },
  { label: 'Measure', items: [['analytics', 'chart', 'Analytics']] },
  { label: 'Account', items: [['settings', 'settings', 'Settings']] },
];

/* Support + Billing are pinned to the end of the panel on every frontend (shared
   AppShell `tail`), so they're deliberately NOT in the groups above. */
const TAIL_NAV: NavItem[] = [
  ['support', 'help', 'Support'],
  ['billing', 'card', 'Billing'],
];

/** Map a logical page (+params) to its URL path. */
function pathFor(page: Page, params: RouteParams = {}): string {
  switch (page) {
    case 'links':
      return '/';
    case 'create':
      return '/new';
    case 'detail':
      return `/l/${params.linkId}`;
    case 'campaigns':
      return '/campaigns';
    case 'campaignNew':
      return '/campaigns/new';
    case 'campaignDetail':
      return `/campaigns/${params.campaignId}`;
    case 'analytics':
      return '/analytics';
    case 'bulk':
      return '/bulk';
    case 'billing':
      return '/billing';
    case 'settings':
      return '/settings';
    case 'support':
      return '/support';
    default:
      return '/';
  }
}

/** Which nav item is highlighted for the current path. */
function activeNavFor(location: string): Page {
  if (location === '/' || location === '/new' || location.startsWith('/l/'))
    return 'links';
  if (location.startsWith('/campaigns')) return 'campaigns';
  if (location.startsWith('/analytics')) return 'analytics';
  if (location.startsWith('/bulk')) return 'bulk';
  if (location.startsWith('/billing')) return 'billing';
  if (location.startsWith('/settings')) return 'settings';
  if (location.startsWith('/support')) return 'support';
  return 'links';
}

function Shell() {
  const { brandId, activeBrand, brands } = useLinksContext();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [location, navigate] = useLocation();
  const [, detailParams] = useRoute('/l/:id');
  const [, campaignParams] = useRoute('/campaigns/:id');
  const { afterLinkChange, afterCampaignChange, afterBillingChange } =
    useLinksInvalidate();
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
  // owns the cross-app handoff. UnknownRouteRedirect below still targets the MAIN app
  // and only ever fires automatically.
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const canEdit = useCanEditLinks();

  const go = (page: Page, params: RouteParams = {}) => {
    // AppShell closes its own mobile drawer on navigation.
    navigate(pathFor(page, params));
  };

  const { data: entitlement } = useQuery({
    ...trpc.shortLinks.entitlement.queryOptions({ brandId: brandId as string }),
    enabled: !!brandId,
  });

  // Set on the ?sub=success return so the effect below refreshes until the
  // subscription (and the link the webhook activated) show up. No client-side
  // re-enable: the webhook already flipped the specific link on (pendingEnableLinkId).
  const [justSubscribed, setJustSubscribed] = useState(false);

  /* Handle the return from Stripe Checkout (?sub=success|cancel). Checkout is
   * started from the active-toggle gate (useLinkToggle), which stamps
   * pendingEnableLinkId — so the webhook activates BOTH the subscription and that
   * specific link server-side. The client just refreshes (see the poll effect
   * below); nothing is persisted across the redirect. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('sub');
    if (!sub) return;
    if (sub === 'success') setJustSubscribed(true);
    else if (sub === 'cancel') toast('Checkout cancelled.');
    params.delete('sub');
    const qs = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? '?' + qs : ''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* After a successful checkout, refresh until the subscription lands. The webhook
   * can lag the browser redirect (and realtime can miss its own event on a cold
   * boot after the redirect), so we briefly poll entitlement and refetch the list —
   * the link the user was enabling is switched on by the webhook (pendingEnableLinkId),
   * so no client-side re-enable is needed. Keyed on brandId too, since the brand
   * context can still be settling the instant we return. */
  useEffect(() => {
    if (!justSubscribed || !brandId) return;
    let cancelled = false;
    (async () => {
      let entitled = false;
      for (let attempt = 0; attempt < 12 && !cancelled; attempt++) {
        const ent = await qc
          .fetchQuery({
            ...trpc.shortLinks.entitlement.queryOptions({ brandId }),
            staleTime: 0, // force a fresh read each poll
          })
          .catch(() => null);
        // Campaigns are pay-on-enable too, so checkout can be entered from a
        // campaign's toggle — afterLinkChange + afterCampaignChange covers both
        // sides plus billing, so returning from Stripe never leaves whichever
        // screen you started from showing the pre-subscription state.
        // (pathFilter(), not queryKey() — see use-invalidate.ts.)
        afterLinkChange();
        afterCampaignChange();
        afterBillingChange();
        if (ent?.entitled) {
          entitled = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (cancelled) return;
      toast(
        entitled
          ? 'Subscription active — your link is live now.'
          : 'Subscription active. Switch your link on to go live.',
      );
      setJustSubscribed(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justSubscribed, brandId]);

  // Creating links is always free and unlimited — the billing gate is on
  // enabling a link (see useLinkToggle), not creating one.
  function onNewLink() {
    go('create');
  }

  // Non-narrowing: brandId may be null (a brand user with no brands yet, or an
  // agency/contractor who reached this frontend). We render the full shell either
  // way and switch the MAIN area below, so pageProps is only ever called with a
  // real brandId (the routes are gated on it).
  const pageProps = (params: RouteParams = {}) => ({
    brandId: brandId as string,
    go,
    onNewLink,
    entitlement,
    params,
  });

  const activeNav = activeNavFor(location);

  // Viewers (linksViewer, no `links`) get a read-only shell — Bulk create is an
  // editor-only action, so drop it from the nav. Editors/owners see everything.
  const navGroups = canEdit
    ? NAV_GROUPS
    : NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter(([key]) => key !== 'bulk'),
      })).filter((g) => g.items.length > 0);

  const toItems = (items: NavItem[]) =>
    items.map(([key, icon, label]) => ({
      key,
      label,
      icon: <Icon name={icon} />,
      active: activeNav === key,
      onClick: () => go(key),
    }));

  return (
    <AppShell
      appKey="links"
      panelClassName="psp-theme-adeyy"
      mainClassName="amain"
      logo={<span className="psp-word">Adeyy.</span>}
      // Nav targets all need an active brand; hide them until one is set.
      groups={
        brandId
          ? navGroups.map((g) => ({ label: g.label, items: toItems(g.items) }))
          : []
      }
      tail={brandId ? toItems(TAIL_NAV) : []}
      brand={{
        brands,
        activeBrandId: activeBrand?.id ?? null,
        onSwitched: () => go('links'),
        onCreateBrand: () => setAddBrandOpen(true),
        createLabel: 'Add brand',
      }}
      onSignOut={() => void handleSignOut()}
    >
      {brandId ? (
        <Switch>
          <Route path="/">{() => <LinksHome {...pageProps()} />}</Route>
          <Route path="/new">{() => <CreateLink {...pageProps()} />}</Route>
          <Route path="/l/:id">
            {() => <LinkDetail {...pageProps({ linkId: detailParams?.id })} />}
          </Route>
          {/* /campaigns/new must be declared BEFORE /campaigns/:id, or "new"
              would be matched as a campaign id. */}
          <Route path="/campaigns">{() => <Campaigns {...pageProps()} />}</Route>
          <Route path="/campaigns/new">
            {() =>
              canEdit ? (
                <CreateCampaign {...pageProps()} />
              ) : (
                <Campaigns {...pageProps()} />
              )
            }
          </Route>
          <Route path="/campaigns/:id">
            {() => (
              <CampaignDetail
                {...pageProps({ campaignId: campaignParams?.id })}
              />
            )}
          </Route>
          <Route path="/analytics">
            {() => <Analytics {...pageProps()} />}
          </Route>
          <Route path="/bulk">
            {() =>
              canEdit ? (
                <BulkCreate {...pageProps()} />
              ) : (
                <LinksHome {...pageProps()} />
              )
            }
          </Route>
          <Route path="/billing">{() => <Billing {...pageProps()} />}</Route>
          <Route path="/settings">{() => <Settings {...pageProps()} />}</Route>
          <Route path="/support">{() => <Support />}</Route>
          <Route path="/support/:id">{() => <Support />}</Route>
          <Route component={UnknownRouteRedirect} />
        </Switch>
      ) : (
        // No brand for the context selector (e.g. an agency-only user, or a
        // brand user whose brand was removed) → initiate the create-brand
        // onboarding instead of dead-ending. Creating one scopes the app to it
        // and drops into the links workspace. (The sidebar's "Add brand" popup
        // stays available too.)
        <CreateBrandOnboarding />
      )}

      {addBrandOpen && (
        <AddBrandModal
          onClose={() => setAddBrandOpen(false)}
          onCreated={() => {
            setAddBrandOpen(false);
            go('links');
          }}
        />
      )}
    </AppShell>
  );
}

/** Debounce a value so live availability checks don't fire per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Create-a-new-brand dialog, opened from the sidebar. Each brand is its own
 * links workspace. Creating one and switching into it mirrors the dashboard's
 * AddBrand flow (brands.create → auth.switchContext), trimmed to one field. */
function AddBrandModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const [businessName, setBusinessName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Business names are unique across the brand+agency namespace; check live.
  const debouncedName = useDebounced(businessName.trim(), 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({
      businessName: debouncedName,
    }),
    enabled: debouncedName.length > 1,
  });
  const nameTaken =
    !!businessName.trim() && nameCheck.data && !nameCheck.data.available;

  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());
  const create = useMutation({
    ...trpc.brands.create.mutationOptions(),
    onSuccess: async (created) => {
      await qc.invalidateQueries(trpc.brands.mine.pathFilter());
      // Switch into the new brand so the whole app (links, entitlement, etc.)
      // re-scopes to it, then refresh everything role/brand-keyed.
      await switchCtx.mutateAsync({ type: 'brand', entityId: created.id });
      qc.invalidateQueries();
      toast('Brand created.');
      onCreated();
    },
    onError: (e) =>
      setError(e instanceof Error ? e.message : 'Could not create brand'),
  });

  const submit = () => {
    setError(null);
    const name = businessName.trim();
    if (!name) {
      setError('Brand name is required');
      return;
    }
    if (nameTaken) {
      setError(nameCheck.data?.reason ?? 'This business name is already taken');
      return;
    }
    create.mutate({ businessName: name });
  };

  return (
    <Modal title="Add brand" onClose={onClose} width={440}>
      <p className="mutetext" style={{ marginTop: 0 }}>
        Each brand is its own links workspace — its links, analytics and billing
        stay separate. You can refine everything later in Settings.
      </p>
      <div className="afield">
        <label>Brand name</label>
        <input
          className={
            'ainput' +
            (nameTaken || (error && !businessName.trim()) ? ' err' : '')
          }
          autoFocus
          value={businessName}
          onChange={(e) => {
            setBusinessName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          placeholder="e.g. Brighton Bakehouse"
        />
        {nameTaken ? (
          <span className="hint" style={{ color: 'var(--danger)' }}>
            {nameCheck.data?.reason ?? 'This business name is already taken'}
          </span>
        ) : error ? (
          <span className="hint" style={{ color: 'var(--danger)' }}>
            {error}
          </span>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 4,
        }}
      >
        <button className="abtn abtn-quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="abtn abtn-primary"
          disabled={create.isPending || switchCtx.isPending || !!nameTaken}
          onClick={submit}
        >
          {create.isPending || switchCtx.isPending
            ? 'Creating…'
            : 'Create brand'}
        </button>
      </div>
    </Modal>
  );
}

/* The brand switcher (with its own avatar + menu) used to live here, at the BOTTOM
   of the sidebar. It's now the shared AppShell's brand slot, directly under the
   header, and it stays clickable with a single brand so "Add brand" is always
   reachable. The sidebar plan/beta badge was removed too: the per-link rate,
   monthly total and subscribe state all live on the Billing page. */

export function LinksApp() {
  return (
    <div className="adeyy adeyy-app" data-tool="links">
      <ToastProvider>
        <ConfirmProvider>
          <Shell />
        </ConfirmProvider>
      </ToastProvider>
    </div>
  );
}
