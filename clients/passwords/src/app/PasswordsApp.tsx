import { useEffect, useState, type ReactNode } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import {
  Command,
  DoorOpen,
  FileClock,
  Inbox,
  KeyRound,
  LifeBuoy,
  Network,
  Receipt,
  Send as SendIcon,
  ShieldCheck,
  Stethoscope,
  User,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { signOut, useCurrentUser } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { QuickFind } from '../components/QuickFind';
import { KeyMark } from '../components/primitives';
import { Keyring } from '../pages/Keyring';
import { Vault } from '../pages/Vault';
import { BrandVault } from '../pages/BrandVault';
import { Item } from '../pages/Item';
import { Access } from '../pages/Access';
import { Health } from '../pages/Health';
import { Send } from '../pages/Send';
import { Intake } from '../pages/Intake';
import { Offboarding } from '../pages/Offboarding';
import { Register } from '../pages/Register';
import { Team } from '../pages/Team';
import { Trust } from '../pages/Trust';
import { Billing } from '../pages/Billing';
import { Support } from '../pages/Support';
import { Account } from '../pages/Account';

/**
 * Authenticated KEYMASTR shell — the shared AppShell side panel (wearing Logo
 * Studio's dark ink rail) around the warm paper stage, with a slim topbar.
 *
 * KEYMASTR is USER-LEVEL (like clients/design): no brand dropdown, a plain
 * Profile row above the exit row. The user's working life spans brands so the
 * vault must too — Access, Watchtower and Offboarding are all cross-brand, and a
 * switcher would make them impossible to build. Brand scoping lives in the
 * content instead: every item belongs to one brand, every screen has a brand
 * filter. See DESIGN.md §4.
 */

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

const VAULT: NavItem[] = [
  { href: '/', label: 'Keyring', icon: KeyRound },
  { href: '/vault', label: 'Vault', icon: FileClock },
  { href: '/access', label: 'Access', icon: Network },
  { href: '/health', label: 'Watchtower', icon: Stethoscope },
];
const SHARE: NavItem[] = [
  { href: '/send', label: 'Send', icon: SendIcon },
  { href: '/intake', label: 'Intake', icon: Inbox },
];
const GOVERNANCE: NavItem[] = [
  { href: '/offboarding', label: 'Offboarding', icon: DoorOpen },
  { href: '/register', label: 'Register', icon: FileClock },
];
const ACCOUNT: NavItem[] = [
  { href: '/team', label: 'Team', icon: Users },
  { href: '/trust', label: 'Trust', icon: ShieldCheck },
  { href: '/billing', label: 'Billing', icon: Receipt },
];

function Topbar({ onOpenFind }: { onOpenFind: () => void }) {
  const [location] = useLocation();
  const current =
    [...VAULT, ...SHARE, ...GOVERNANCE, ...ACCOUNT].find((n) =>
      n.href === '/' ? location === '/' : location.startsWith(n.href),
    )?.label ?? 'Keyring';

  return (
    <header
      className="sticky top-0 z-30 flex h-14 items-center gap-3 px-4 sm:gap-4 sm:px-6 lg:px-8"
      style={{
        background: 'color-mix(in srgb, var(--stage) 82%, transparent)',
        borderBottom: '1px solid var(--hair)',
        backdropFilter: 'saturate(1.2) blur(8px)',
      }}
    >
      <span className="spec hidden min-w-0 truncate sm:block">KEYMASTR</span>
      <span className="hidden text-[var(--hair-2)] sm:block">/</span>
      <span className="spec min-w-0 truncate" style={{ color: 'var(--ink-2)' }}>
        {current}
      </span>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        {/* Quick find is the primary action on EVERY screen — it's the one thing
            people open this app to do. It gets the pigment, not a "New key". */}
        <button
          onClick={onOpenFind}
          className="press flex h-9 items-center gap-2 rounded-[var(--radius-pill)] px-3 text-sm font-semibold text-white sm:px-4"
          style={{ background: 'var(--pigment)' }}
        >
          <Command className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Find a key</span>
          <span className="spec hidden sm:inline" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 10 }}>
            ⌘K
          </span>
        </button>
      </div>
    </header>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [findOpen, setFindOpen] = useState(false);
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

  // ⌘K / Ctrl-K anywhere in the vault.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setFindOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string) =>
    href === '/' ? location === '/' : location.startsWith(href);
  const toItem = (item: NavItem) => ({
    key: item.href,
    label: item.label,
    icon: <item.icon className="h-[18px] w-[18px]" />,
    href: item.href,
    active: isActive(item.href),
  });

  return (
    /* .km-ui must wrap the PANEL too: .psp-theme-keymastr reads --rail-* from it. */
    <div className="km-ui">
      <AppShell
        appKey="passwords"
        panelClassName="psp-ink psp-theme-keymastr"
        logo={
          <span className="flex items-center gap-2.5">
            <KeyMark seed={3} tone="paper" animate={false} className="h-4 w-8" />
            <span className="text-[15px] font-semibold tracking-tight">KEYMASTR</span>
          </span>
        }
        groups={[
          { items: VAULT.map(toItem) },
          { label: 'Share', items: SHARE.map(toItem) },
          { label: 'Governance', items: GOVERNANCE.map(toItem) },
          { label: 'Account', items: ACCOUNT.map(toItem) },
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
        <div
          className="km-ui flex min-h-screen flex-col"
          style={{ background: 'var(--stage)' }}
        >
          <Topbar onOpenFind={() => setFindOpen(true)} />
          <main className="min-w-0 flex-1">{children}</main>
          <QuickFind open={findOpen} onClose={() => setFindOpen(false)} />
        </div>
      </AppShell>
    </div>
  );
}

export function PasswordsApp() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Keyring} />
        <Route path="/vault" component={Vault} />
        <Route path="/b/:brandId" component={BrandVault} />
        <Route path="/item/:id" component={Item} />
        <Route path="/access" component={Access} />
        <Route path="/health" component={Health} />
        <Route path="/send" component={Send} />
        <Route path="/intake" component={Intake} />
        <Route path="/offboarding" component={Offboarding} />
        <Route path="/register" component={Register} />
        <Route path="/team" component={Team} />
        <Route path="/trust" component={Trust} />
        <Route path="/billing" component={Billing} />
        <Route path="/support" component={Support} />
        <Route path="/support/:id" component={Support} />
        <Route path="/profile" component={Account} />
        <Route component={UnknownRouteRedirect} />
      </Switch>
    </Shell>
  );
}
