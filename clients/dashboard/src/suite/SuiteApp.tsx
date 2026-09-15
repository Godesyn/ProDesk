/* Prodesk Suite — root: state machine + routing for the brand dashboard shell.
   Brand identity, the brand switcher, team and account settings are wired to the
   live tRPC backend (see live.tsx). The app catalogue, strategist chat and
   peer/KPI copy that have no backend remain presentational. */

import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { signOut } from '@shared/auth/auth-context';
import { useCrossAppOpen } from '@shared/auth/use-cross-app';
import { InvitationsSection } from '@shared/pages/role-selection';
import { Icon } from './icons';
import {
  Avatar,
  ConfirmModal,
  Scrim,
  ToastHost,
  useIsMobile,
  pushToast,
} from './ui';
import { TopBar } from './shell';
import { Sidebar } from './sidebar';
import { ChatDock, ChatReopen } from './chat';
import { Launcher } from './launcher';
import { CommandPalette } from './palette';
import { AppOpen, AddBrand, UnlockDrawer } from './overlays';
import { useSuiteContext } from './live';
import { useDashboardRealtime } from './realtime';
import { isAppLive, isFeatureLive } from './flags';
import {
  APPS,
  CROSS_APP_HOSTS,
  GROUPS,
  type SuiteApp as App,
  type PersonalApp,
  type Vendor,
} from './data';

// Account + People are full settings screens reached on demand — code-split so
// they don't weigh down the initial shell bundle. (Named exports → default shape.)
const AccountSettings = lazy(() => import('./account').then((m) => ({ default: m.AccountSettings })));
const PeopleTool = lazy(() => import('./people').then((m) => ({ default: m.PeopleTool })));
const SupportTool = lazy(() => import('./support').then((m) => ({ default: m.SupportTool })));

/** Placeholder while a code-split screen loads. */
function ScreenFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh', color: 'var(--ink-3)', fontSize: 14 }}>
      Loading…
    </div>
  );
}

type View = 'launcher' | 'app' | 'settings' | 'team' | 'support' | 'unknown';

/** Derive the view + appId from the current URL path. */
function parseRoute(path: string): {
  view: View;
  openAppId: string | null;
  settingsTab?: string;
} {
  const seg = path.replace(/^\/+/, '').split('/');
  if (seg[0] === 'app' && seg[1]) return { view: 'app', openAppId: seg[1] };
  if (seg[0] === 'settings')
    return { view: 'settings', openAppId: null, settingsTab: seg[1] };
  if (seg[0] === 'team') return { view: 'team', openAppId: null };
  if (seg[0] === 'support') return { view: 'support', openAppId: null };
  // Root path → launcher; anything else is unknown
  if (!seg[0] || seg[0] === '') return { view: 'launcher', openAppId: null };
  return { view: 'unknown', openAppId: null };
}

/* Account chrome shown during onboarding (before any brand exists), so the user
   can still reach their account or log out. A trimmed version of the top-bar
   account menu — "Account details" (the brand-free /profile page) and "Log out".
   Floated above the create-brand surface. */
function OnboardingChrome({
  vendor,
  onLogout,
}: {
  vendor: Vendor;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: 'var(--topbar-h)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        zIndex: 300,
      }}
    >
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: open ? 'var(--paper-2)' : 'transparent',
            border: '1px solid',
            borderColor: open ? 'var(--rule)' : 'transparent',
            borderRadius: 'var(--r-2)',
            padding: '5px 8px 5px 5px',
            cursor: 'pointer',
          }}
        >
          <Avatar
            src={vendor.profileUrl}
            initials={vendor.initials}
            size={30}
            fontSize={12}
          />
          <Icon
            name="chevron"
            size={16}
            style={{
              color: 'var(--ink-2)',
              transform: open ? 'rotate(180deg)' : 'none',
            }}
          />
        </button>
        {open && (
          <>
            <div
              onMouseDown={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 90 }}
            />
            <div
              role="menu"
              aria-label="Account"
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 100,
                width: 260,
                background: 'var(--white)',
                border: '1px solid var(--rule)',
                borderRadius: 'var(--r-3)',
                boxShadow: 'var(--shadow-drawer)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  padding: '16px',
                  borderBottom: '1px solid var(--rule)',
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                }}
              >
                <Avatar
                  src={vendor.profileUrl}
                  initials={vendor.initials}
                  size={36}
                  fontSize={13}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 700,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {vendor.name}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--ink-3)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {vendor.email}
                  </div>
                </div>
              </div>
              <div style={{ padding: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate('/profile');
                  }}
                  className="pd-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: '9px 10px',
                    borderRadius: 'var(--r-2)',
                    cursor: 'pointer',
                  }}
                >
                  <Icon
                    name="user"
                    size={18}
                    style={{ color: 'var(--ink-2)' }}
                  />
                  <span style={{ fontSize: 14 }}>Account details</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onLogout();
                  }}
                  className="pd-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: '9px 10px',
                    borderRadius: 'var(--r-2)',
                    cursor: 'pointer',
                  }}
                >
                  <Icon
                    name="logout"
                    size={18}
                    style={{ color: 'var(--ink-2)' }}
                  />
                  <span style={{ fontSize: 14 }}>Log out</span>
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Pinned apps persist locally (no backend yet). Default: the live apps, so the
// rail comes pre-filled to match the design system's populated "Your apps" nav.
const PIN_KEY = 'pd-suite-pinned-apps';
function loadPinned(): string[] {
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch {
    /* ignore malformed storage */
  }
  return APPS.filter((a) => isAppLive(a.id)).map((a) => a.id);
}

function crumbApp(id: string, name: string, icon: string): App {
  return { id, group: '', kind: 'source', name, icon, tag: '' };
}

const PEOPLE_APP =
  APPS.find((a) => a.id === 'people') ??
  crumbApp('people', 'Team & people', 'team');

export function SuiteApp() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const ctx = useSuiteContext();
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();

  // App-wide realtime: one Supabase channel keeps every brand-scoped list/stat
  // live by invalidating its React Query key when the underlying table changes.
  useDashboardRealtime();

  // Derive view + openAppId from the URL
  const route = useMemo(() => parseRoute(location), [location]);
  const view = route.view;
  const openAppId = route.openAppId;
  const [settingsTab, setSettingsTab] = useState(
    route.settingsTab || 'profile',
  );
  const [optimisticBrandId, setOptimisticBrandId] = useState<string | null>(
    null,
  );
  const [collapsed, setCollapsed] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Strategist dock open/collapsed — persisted per user in
  // uiPreferences.strategistPanelOpen so the choice follows the user across
  // devices and survives logout/login. localStorage seeds the first paint
  // (before auth.me resolves) to avoid a flash; default is open.
  const [chatOpen, setChatOpen] = useState<boolean>(
    () =>
      typeof window === 'undefined' ||
      window.localStorage.getItem('pd.strategist.open') !== '0',
  );
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [launchTab, setLaunchTab] = useState<'health' | 'tools'>('tools');
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false);
  const [unlockApp, setUnlockApp] = useState<App | null>(null);
  const [addBrandOpen, setAddBrandOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>(loadPinned);

  // Adopt the server-stored strategist preference once the user loads (source of
  // truth), seeding localStorage for the next reload.
  const serverChatOpen = (
    ctx.user?.uiPreferences as { strategistPanelOpen?: boolean } | undefined
  )?.strategistPanelOpen;
  useEffect(() => {
    if (typeof serverChatOpen === 'boolean') {
      setChatOpen(serverChatOpen);
      window.localStorage.setItem('pd.strategist.open', serverChatOpen ? '1' : '0');
    }
  }, [serverChatOpen]);

  const saveChatPref = useMutation({
    ...trpc.users.updateUiPreference.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
  });
  // Apply + persist the strategist dock state: instant local update, localStorage
  // seed for next reload, and a server write so it sticks across sessions.
  const applyChatOpen = useCallback(
    (next: boolean) => {
      setChatOpen(next);
      window.localStorage.setItem('pd.strategist.open', next ? '1' : '0');
      saveChatPref.mutate({ key: 'strategistPanelOpen', value: next });
    },
    [saveChatPref],
  );

  const entitledIds = useMemo(() => APPS.map((a) => a.id), []);
  const activeBrandId = optimisticBrandId ?? ctx.activeBrandId;
  const activeBrand =
    ctx.brands.find((b) => b.id === activeBrandId) ?? ctx.activeBrand;

  // Live, brand-scoped signals for the dashboard.
  const statsQ = useQuery({
    ...trpc.brands.dashboardStats.queryOptions({
      brandId: activeBrandId ?? '',
    }),
    enabled: !!activeBrandId,
  });
  const attnQ = useQuery({
    ...trpc.proposals.attentionCount.queryOptions({
      brandId: activeBrandId ?? '',
    }),
    enabled: !!activeBrandId,
  });
  const stats = statsQ.data ?? null;

  const liveStatus = useMemo<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    if (stats?.teamMembers)
      m['people'] =
        `${stats.teamMembers} ${stats.teamMembers === 1 ? 'person' : 'people'}`;
    if (attnQ.data?.count) m['proposals'] = `${attnQ.data.count} to action`;
    return m;
  }, [stats?.teamMembers, attnQ.data?.count]);

  const vendor = useMemo(
    () => ({ ...ctx.vendor, team: stats?.teamMembers ?? 0 }),
    [ctx.vendor, stats?.teamMembers],
  );

  // Keep the optimistic override only until the server selection catches up.
  useEffect(() => {
    if (optimisticBrandId && ctx.activeBrandId === optimisticBrandId)
      setOptimisticBrandId(null);
  }, [ctx.activeBrandId, optimisticBrandId]);

  const openCrossApp = useCrossAppOpen();

  const goHome = useCallback(() => {
    navigate('/');
    setSwitcherOpen(false);
    setAccountOpen(false);
    setPersonalOpen(false);
    setMobileNavOpen(false);
    setPaletteOpen(false);
  }, [navigate]);
  const openApp = useCallback(
    (app: App) => {
      if (!app) return;
      // Standalone-frontend apps (Links, Payments, Reviews) open in a new
      // window, with the session handed off when they sit on another domain.
      if (app.id in CROSS_APP_HOSTS) {
        void openCrossApp(CROSS_APP_HOSTS[app.id], '/', { newWindow: true });
      } else {
        navigate('/app/' + app.id);
      }
      setSwitcherOpen(false);
      setAccountOpen(false);
      setPersonalOpen(false);
      setMobileNavOpen(false);
      setPaletteOpen(false);
    },
    [navigate, openCrossApp],
  );
  const openPersonalApp = (a: PersonalApp) => {
    setPersonalOpen(false);
    pushToast(a.name + ' — part of your personal layer.', 'info');
  };

  const pickBrand = (id: string) => {
    setOptimisticBrandId(id);
    ctx.setActiveBrand(id);
    setSwitcherOpen(false);
    setMobileNavOpen(false);
    navigate('/');
  };
  const togglePin = (id: string) => {
    setPinnedIds((cur) => {
      const next = cur.includes(id)
        ? cur.filter((x) => x !== id)
        : [...cur, id];
      try {
        localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      pushToast(
        cur.includes(id) ? 'Removed from your apps.' : 'Pinned to your apps.',
        'info',
      );
      return next;
    });
  };
  const onSupport = () => {
    setMobileNavOpen(false);
    navigate('/support');
  };

  const onAccountItem = (key: string) => {
    setAccountOpen(false);
    if (key === 'logout') {
      setConfirmLogout(true);
      return;
    }
    if (key === 'team') {
      navigate('/team');
      return;
    }
    setSettingsTab(key === 'billing' ? 'billing' : 'profile');
    navigate('/settings');
  };

  // Open Account → Plan & billing directly (used by the Growth-strategy plan pill).
  const openBilling = () => {
    setSettingsTab('billing');
    navigate('/settings/billing');
    setSwitcherOpen(false);
    setAccountOpen(false);
    setPersonalOpen(false);
  };

  const createBrand = (name: string, type: string) => {
    ctx.createBrand(name, type);
    setAddBrandOpen(false);
    navigate('/');
  };

  // Cmd/Ctrl + K opens the palette anywhere
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- gates ----

  // Unknown route → back to this frontend's root (the launcher), the same
  // not-found behaviour as every other Prodesk frontend. The suite derives its
  // view from the URL itself (parseRoute) rather than from a <Switch>, so the
  // shared catch-all is rendered directly instead of mounted as a <Route>.
  if (view === 'unknown') return <UnknownRouteRedirect />;

  if (ctx.loading) {
    return (
      <div
        className="pd-suite"
        style={{
          display: 'grid',
          placeItems: 'center',
          minHeight: '100vh',
          color: 'var(--ink-3)',
        }}
      >
        Loading your workspace…
      </div>
    );
  }
  // No brands yet (e.g. right after signup — this dashboard skips role selection).
  // Onboarding surface, modelled on the prodesk role-selection screen but brand-only:
  // a "Create a brand" card (creating one sets the brandOwner role + active brand and
  // drops through to the dashboard) plus any PENDING STAFF INVITES (reused verbatim
  // from role-selection's InvitationsSection — accepting one makes the user staff of
  // an existing brand). The account menu stays reachable top-right for logout/profile.
  if (ctx.hasNoBrand || !activeBrand) {
    return (
      <div
        className="pd-suite"
        style={{ minHeight: '100vh', background: 'var(--paper)' }}
      >
        <OnboardingChrome
          vendor={vendor}
          onLogout={() => setConfirmLogout(true)}
        />
        <div className="grid place-items-center px-5 py-14">
          <div className="w-full max-w-xl animate-reveal">
            <div className="mb-10 text-center">
              <div className="text-eyebrow mb-3 text-accent">Get started</div>
              <h1 className="text-h2 text-ink-100">
                Create your{' '}
                <span className="text-serif-italic text-accent">brand</span>
              </h1>
              <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-ink-60">
                Your brand is your workspace — products, contacts, proposals and
                settings all live inside it.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setAddBrandOpen(true)}
              className="group press animate-reveal flex w-full items-center gap-4 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-6 text-left shadow-1 transition-all duration-[240ms] hover:-translate-y-1 hover:border-accent/40 hover:shadow-2"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-md)] bg-accent/12 text-accent ring-1 ring-accent/15 transition-colors group-hover:bg-accent group-hover:text-white">
                <Icon name="building" size={24} />
              </span>
              <div className="flex-1">
                <div className="text-ui-lg text-ink-100">Create a brand</div>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-60">
                  Set up your brand workspace in a few seconds.
                </p>
              </div>
              <Icon
                name="arrowRight"
                size={18}
                style={{ color: 'var(--color-accent)' }}
              />
            </button>

            <InvitationsSection />
          </div>
        </div>

        {addBrandOpen && (
          <AddBrand
            onClose={() => setAddBrandOpen(false)}
            onCreate={createBrand}
          />
        )}
        {confirmLogout && (
          <ConfirmModal
            title="Log out?"
            body="You will need to sign back in to reach your brands."
            confirmLabel="Log out"
            danger
            onCancel={() => setConfirmLogout(false)}
            onConfirm={() => {
              setConfirmLogout(false);
              void signOut();
            }}
          />
        )}
        <ToastHost />
      </div>
    );
  }

  const realApp = openAppId
    ? APPS.find((a) => a.id === openAppId) || null
    : null;
  const openApp_ =
    view === 'app'
      ? realApp
      : view === 'settings'
        ? crumbApp('settings', 'Account settings', 'settings')
        : view === 'team'
          ? crumbApp('team', 'Team & people', 'team')
          : view === 'support'
            ? crumbApp('support', 'Support', 'lifebuoy')
            : null;
  const inApp = view !== 'launcher';

  const topbar = (
    <TopBar
      vendor={vendor}
      activeBrand={activeBrand}
      brands={ctx.brands}
      navMode="sidebar"
      onMenu={() => setMobileNavOpen(true)}
      launchTab={launchTab}
      inApp={inApp}
      openApp={openApp_}
      onTab={(t) => {
        setLaunchTab(t as 'health' | 'tools');
        navigate('/');
        setSwitcherOpen(false);
        setAccountOpen(false);
      }}
      switcherOpen={switcherOpen}
      accountOpen={accountOpen}
      onToggleSwitcher={() => {
        setSwitcherOpen((o) => !o);
        setAccountOpen(false);
        setPersonalOpen(false);
      }}
      onToggleAccount={() => {
        setAccountOpen((o) => !o);
        setSwitcherOpen(false);
        setPersonalOpen(false);
      }}
      personalOpen={personalOpen}
      onTogglePersonal={() => {
        setPersonalOpen((o) => !o);
        setSwitcherOpen(false);
        setAccountOpen(false);
      }}
      closePersonal={() => setPersonalOpen(false)}
      onOpenPersonalApp={openPersonalApp}
      onPickBrand={pickBrand}
      onAddBrand={() => {
        setSwitcherOpen(false);
        setAddBrandOpen(true);
      }}
      onAccountItem={onAccountItem}
      onHome={goHome}
      closeSwitcher={() => setSwitcherOpen(false)}
      closeAccount={() => setAccountOpen(false)}
    />
  );

  const content =
    view === 'launcher' ? (
      <Launcher
        apps={APPS}
        groups={GROUPS}
        brand={activeBrand}
        entitledIds={entitledIds}
        loadState="ready"
        tab={launchTab}
        onOpenApp={openApp}
        onUnlock={(app) => setUnlockApp(app)}
        pinnedIds={pinnedIds}
        onTogglePin={togglePin}
        onGoTools={() => setLaunchTab('tools')}
        liveStatus={liveStatus}
        healthStats={stats}
      />
    ) : view === 'settings' ? (
      <Suspense fallback={<ScreenFallback />}>
        <AccountSettings
          vendor={vendor}
          brandId={activeBrand.id}
          initialTab={settingsTab}
        />
      </Suspense>
    ) : view === 'team' ? (
      <main className="pd-page" data-tool="people">
        <Suspense fallback={<ScreenFallback />}>
          <PeopleTool app={PEOPLE_APP} brand={activeBrand} />
        </Suspense>
      </main>
    ) : view === 'support' ? (
      <main className="pd-page" data-tool="support">
        <Suspense fallback={<ScreenFallback />}>
          <SupportTool brand={activeBrand} />
        </Suspense>
      </main>
    ) : realApp ? (
      <AppOpen
        app={realApp}
        brand={activeBrand}
        onHome={goHome}
        onOpenApp={openApp}
        onOpenBilling={openBilling}
      />
    ) : null;

  const sidebarEl = (
    <Sidebar
      apps={APPS}
      brand={activeBrand}
      brands={ctx.brands}
      entitledIds={entitledIds}
      view={view}
      openAppId={openAppId}
      pinnedIds={pinnedIds}
      collapsed={collapsed}
      switcherOpen={switcherOpen}
      onToggleSwitcher={() => {
        setSwitcherOpen((o) => !o);
        setAccountOpen(false);
        setPersonalOpen(false);
      }}
      closeSwitcher={() => setSwitcherOpen(false)}
      onPickBrand={pickBrand}
      onOpenApp={openApp}
      onUnlock={(a) => setUnlockApp(a)}
      onHome={goHome}
      onAddBrand={() => setAddBrandOpen(true)}
      onTogglePin={togglePin}
      onOpenPalette={() => setPaletteOpen(true)}
      onToggleCollapse={() => setCollapsed((c) => !c)}
      onSupport={onSupport}
    />
  );

  // The right-rail strategist dock and the full-screen Growth strategy app are
  // the same brand AI thread. Mounting both at once double-subscribes the single
  // Supabase realtime channel — supabase reuses a channel by topic, and binding a
  // handler on an already-joined channel throws (blanking the app). So suppress
  // the dock while the full Growth strategy screen is open: that screen already
  // is the strategist. (Enter/leave transitions are safe — the leaving channel
  // drops out of the joined state before the other panel re-binds.)
  const strategyOpen = view === 'app' && openAppId === 'strategy';
  const chatLive = isFeatureLive('strategistChat') && !strategyOpen;
  const deskChat = !isMobile && chatOpen && chatLive;

  return (
    <div
      className="pd-suite"
      style={{
        minHeight: '100vh',
        paddingRight: deskChat ? 420 : 0,
        transition: 'padding-right var(--dur) var(--ease)',
      }}
    >
      {!isMobile ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: (collapsed ? 72 : 232) + 'px 1fr',
            minHeight: '100vh',
          }}
        >
          {sidebarEl}
          <div
            style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}
          >
            {topbar}
            {content}
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: '100vh',
          }}
        >
          {topbar}
          {content}
        </div>
      )}

      {isMobile && mobileNavOpen && (
        <Scrim onClick={() => setMobileNavOpen(false)} align="left">
          <div
            style={{
              height: '100%',
              animation: 'pd-slide-left var(--dur) var(--ease)',
            }}
          >
            {sidebarEl}
          </div>
        </Scrim>
      )}

      {chatLive && (
        <>
          <ChatDock
            brand={activeBrand}
            onOpenApp={openApp}
            isMobile={isMobile}
            deskOpen={chatOpen}
            setDeskOpen={applyChatOpen}
            mobileOpen={mobileChatOpen}
            setMobileOpen={setMobileChatOpen}
          />
          {!isMobile && !chatOpen && (
            <ChatReopen onClick={() => applyChatOpen(true)} />
          )}
          {isMobile && !mobileChatOpen && (
            <button
              type="button"
              className="pd-chat-fab"
              aria-label="Open strategist chat"
              onClick={() => setMobileChatOpen(true)}
            >
              <Icon name="sparkle" size={20} />
            </button>
          )}
        </>
      )}

      {unlockApp && (
        <UnlockDrawer app={unlockApp} onClose={() => setUnlockApp(null)} />
      )}
      {addBrandOpen && (
        <AddBrand
          onClose={() => setAddBrandOpen(false)}
          onCreate={createBrand}
        />
      )}
      {confirmLogout && (
        <ConfirmModal
          title="Log out?"
          body="You will need to sign back in to reach your brands."
          confirmLabel="Log out"
          danger
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false);
            void signOut();
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        apps={APPS}
        brands={ctx.brands}
        entitledIds={entitledIds}
        onClose={() => setPaletteOpen(false)}
        onOpenApp={openApp}
        onUnlock={(a) => setUnlockApp(a)}
        onPickBrand={pickBrand}
        onHome={goHome}
        onAddBrand={() => setAddBrandOpen(true)}
        onSettings={() => {
          navigate('/settings');
        }}
        onTeam={() => {
          navigate('/team');
        }}
      />
      <ToastHost />
    </div>
  );
}
