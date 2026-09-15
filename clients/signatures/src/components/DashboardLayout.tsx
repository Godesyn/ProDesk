/**
 * SIGKITT workspace chrome — the shared AppShell side panel plus the routed main
 * area.
 *
 * This used to be a bespoke shadcn <Sidebar> (its own collapse machinery, a
 * drag-to-resize handle and a 280px default width). It's now the shared panel, so
 * SIGKITT gets the same layout, width and collapse behaviour as every other
 * frontend and supplies only its palette — the near-black rail with the grey active
 * row — via .psp-theme-sigkitt in index.css, on top of the shared `psp-ink`
 * dark-rail contract (washes, hairlines, dropdown surface).
 *
 * What that deliberately drops: the resize handle. Panel width is now one shared
 * value (side-panel.css --psp-w) precisely so the frontends can't drift apart
 * again; collapse-to-icons covers "I want more room".
 */
import { useCurrentUser, signOut } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { NewBrandDialog } from '@shared/components/layout/new-brand-dialog';
import {
  BarChart3,
  Building2,
  CreditCard,
  LifeBuoy,
  Megaphone,
  Signature,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useSignaturesContext } from '@/app/context';

/* Signatures work — the tool's own surfaces. */
const WORK_ITEMS = [
  { icon: Signature, label: 'Signatures', path: '/' },
  { icon: Megaphone, label: 'Campaigns', path: '/campaigns' },
  { icon: BarChart3, label: 'Analytics', path: '/analytics' },
];

/* Account — the brand's record. Departments is here rather than in Work because
   it manages the brand's signature designs and roster, not one signature. */
const ACCOUNT_ITEMS = [
  { icon: Building2, label: 'Departments', path: '/departments' },
];

// The Team item only shows for staff managers (owner / staffManagement) — the
// page itself re-checks, but hiding it keeps the nav clean for everyone else.
const teamMenuItem = { icon: Users, label: 'Team', path: '/team' };

// Support is mandatory on every frontend and, with Billing, is pinned to the end
// of the panel (shared AppShell `tail`). Billing shows for the brand owner / staff
// with the `payments` permission — they're the only ones who can manage the
// subscription and the card on file.
const supportMenuItem = { icon: LifeBuoy, label: 'Support', path: '/support' };
const billingMenuItem = {
  icon: CreditCard,
  label: 'Billing',
  path: '/billing',
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { data: user } = useCurrentUser();
  const [location, setLocation] = useLocation();
  const { brands, activeBrand } = useSignaturesContext();
  const [newBrandOpen, setNewBrandOpen] = useState(false);
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
  // The Prodesk Suite row lives at the top of the shared panel, which owns the
  // cross-app handoff.

  const canManageTeam =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('staffManagement');
  const canManageBilling =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('payments');

  const toItems = (
    items: { icon: typeof Signature; label: string; path: string }[],
  ) =>
    items.map((item) => ({
      key: item.path,
      label: item.label,
      icon: <item.icon className="h-[18px] w-[18px]" />,
      active: location === item.path,
      onClick: () => setLocation(item.path),
    }));

  return (
    <AppShell
      appKey="signatures"
      panelClassName="psp-ink psp-theme-sigkitt"
      mainClassName="min-w-0"
      logo={
        <img
          src="/sigkitt-logo.svg"
          alt="SIGKITT"
          className="h-5 w-auto"
          style={{ filter: 'brightness(0) invert(1)' }}
        />
      }
      groups={[
        { label: 'Work', items: toItems(WORK_ITEMS) },
        {
          label: 'Account',
          items: toItems([
            ...ACCOUNT_ITEMS,
            ...(canManageTeam ? [teamMenuItem] : []),
          ]),
        },
      ]}
      tail={toItems([
        supportMenuItem,
        ...(canManageBilling ? [billingMenuItem] : []),
      ])}
      brand={{
        brands,
        activeBrandId: activeBrand?.id ?? null,
        onSwitched: () => setLocation('/'),
        onCreateBrand: () => setNewBrandOpen(true),
      }}
      onSignOut={() => void handleSignOut()}
    >
      <main className="min-w-0 flex-1 p-4">{children}</main>
      <NewBrandDialog
        open={newBrandOpen}
        onOpenChange={setNewBrandOpen}
        blurb="Each brand gets its own signatures, campaigns and analytics."
      />
    </AppShell>
  );
}
