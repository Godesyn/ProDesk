import { useLocation } from 'wouter';
import { useCurrentUser, signOut } from '@shared/auth/auth-context';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { toast } from 'sonner';
import { useEffect, useState, useRef } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useBrandId, usePaymentsContext } from '@/lib/payments-trpc';
import { isProd } from '@/lib/env';
import { AppShell as ProdeskAppShell } from '@shared/components/layout/app-side-panel';
import { NewBrandDialog } from '@shared/components/layout/new-brand-dialog';

/* -- Icons (exact paths from shell.jsx prototype) -- */
const NavIcon = ({ name }: { name: string }) => {
  const paths: Record<string, React.ReactNode> = {
    dashboard: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="13" y="3" width="7" height="5" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="13" y="10" width="7" height="11" rx="1.5" />
      </g>
    ),
    proposals: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M5 3h11l3 3v15a1 1 0 01-1 1H5a1 1 0 01-1-1V4a1 1 0 011-1z" />
        <path d="M16 3v3h3M8 12h8M8 16h6M8 8h4" />
      </g>
    ),
    clients: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <circle cx="9" cy="8" r="3.2" />
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
        <circle cx="16" cy="6" r="2.4" />
        <path d="M14 13c2 0 4 0 5 1.6" />
      </g>
    ),
    templates: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <rect x="3" y="3" width="18" height="6" rx="1.5" />
        <rect x="3" y="12" width="8" height="9" rx="1.5" />
        <rect x="13" y="12" width="8" height="9" rx="1.5" />
      </g>
    ),
    pricing: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M3 14L13.5 3.5a1.4 1.4 0 011-.5H21v6.5a1.4 1.4 0 01-.5 1L10 21a2 2 0 01-2.8 0L3 16.8a2 2 0 010-2.8z" />
        <circle cx="17" cy="7" r="1.4" />
      </g>
    ),
    brand: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <path d="M12 3l3 3 6 1-4 4 1 6-6-3-6 3 1-6-4-4 6-1z" />
      </g>
    ),
    settings: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <circle cx="12" cy="12" r="2.4" />
        <path d="M19.4 15a1.6 1.6 0 00.3 1.7l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.7-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1.1-1.5 1.6 1.6 0 00-1.7.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.7 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1.1 1.6 1.6 0 00-.3-1.7l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.7.3 1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.7-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.7v0a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
      </g>
    ),
    quickbuilder: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
      </g>
    ),
    inbox: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 13l3-9h12l3 9M3 13v7a1 1 0 001 1h16a1 1 0 001-1v-7M3 13h5l2 3h4l2-3h5" />
      </g>
    ),
    activity: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </g>
    ),
    bell: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <path d="M6 8a6 6 0 0112 0v5l2 2H4l2-2V8z" />
        <path d="M10 19a2 2 0 004 0" />
      </g>
    ),
    plus: (
      <path
        d="M12 4v16M4 12h16"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    ),
    search: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      >
        <circle cx="10" cy="10" r="6" />
        <path d="M14.5 14.5L19 19" />
      </g>
    ),
    arrow_r: (
      <path
        d="M5 12h14m-5-5l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    calendar: (
      <g stroke="currentColor" strokeWidth="1.6" fill="none">
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 3v4M16 3v4" />
      </g>
    ),
    sparkle: (
      <path
        d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinejoin="round"
      />
    ),
    edit: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
        <path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
      </g>
    ),
    trash: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        <path d="M10 11v6M14 11v6" />
        <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
      </g>
    ),
    more: (
      <g fill="currentColor">
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </g>
    ),
    eye: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
      >
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    ),
    send: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </g>
    ),
    save: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
      </g>
    ),
    check: (
      <polyline
        points="20 6 9 17 4 12"
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    x: (
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </g>
    ),
    filter: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
      </g>
    ),
    upload: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="16 16 12 12 8 16" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.4 6.4A9 9 0 1 0 5.6 17.6" />
      </g>
    ),
    download: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="8 17 12 21 16 17" />
        <line x1="12" y1="12" x2="12" y2="21" />
        <path d="M20.9 18.6A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 4 17.3" />
      </g>
    ),
    duplicate: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="9" y="9" width="13" height="13" rx="2" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
      </g>
    ),
    pen: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
      </g>
    ),
    grip: (
      <g fill="currentColor">
        <circle cx="9" cy="7" r="1.5" />
        <circle cx="15" cy="7" r="1.5" />
        <circle cx="9" cy="12" r="1.5" />
        <circle cx="15" cy="12" r="1.5" />
        <circle cx="9" cy="17" r="1.5" />
        <circle cx="15" cy="17" r="1.5" />
      </g>
    ),
    up: (
      <polyline
        points="18 15 12 9 6 15"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    down: (
      <polyline
        points="6 9 12 15 18 9"
        stroke="currentColor"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
    affiliate: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </g>
    ),
    chase: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.8 19.8 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8 19.8 19.8 0 01.08 1.18 2 2 0 012.06 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z" />
      </g>
    ),
    admin: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2L3 7l9 5 9-5-9-5z" />
        <path d="M3 12l9 5 9-5" />
        <path d="M3 17l9 5 9-5" />
      </g>
    ),
    link: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
        <polyline points="15 3 21 3 21 9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </g>
    ),
    lifebuoy: (
      <g
        stroke="currentColor"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="3.5" />
        <line x1="4.9" y1="4.9" x2="9.5" y2="9.5" />
        <line x1="14.5" y1="14.5" x2="19.1" y2="19.1" />
        <line x1="14.5" y1="9.5" x2="19.1" y2="4.9" />
        <line x1="4.9" y1="19.1" x2="9.5" y2="14.5" />
      </g>
    ),
  };
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      {paths[name] || paths.dashboard}
    </svg>
  );
};

export { NavIcon };

const CUSTOMER_NAV = [
  {
    section: 'Workspace',
    items: [
      { icon: 'dashboard', name: 'Dashboard', href: '/app' },
      { icon: 'inbox', name: 'Inbox', href: '/inbox' },
      { icon: 'activity', name: 'Activity', href: '/activity' },
    ],
  },
  {
    section: 'Sell',
    items: [
      { icon: 'proposals', name: 'Proposals', href: '/proposals' },
      { icon: 'quickbuilder', name: 'Quick Quote', href: '/quick' },
      { icon: 'templates', name: 'Templates', href: '/templates' },
      { icon: 'pricing', name: 'Pricing', href: '/pricing' },
      { icon: 'activity', name: 'Chase Queue', href: '/chase' },
      {
        icon: 'activity',
        name: 'Recurring Invoices',
        href: '/recurring-invoices',
      },
      { icon: 'sparkle', name: 'AI Insights', href: '/ai' },
    ],
  },
  {
    section: 'Relate',
    items: [
      { icon: 'clients', name: 'Payers', href: '/clients' },
      { icon: 'sparkle', name: 'Affiliate', href: '/affiliate/dashboard' },
      { icon: 'activity', name: 'Forecast', href: '/forecast' },
    ],
  },
  {
    section: 'Brand',
    items: [
      { icon: 'brand', name: 'Brand kit', href: '/brand' },
      // Platform staff management replaces the export's "Invite team" stub.
      { icon: 'clients', name: 'Team', href: '/staff' },
      { icon: 'settings', name: 'Settings', href: '/settings' },
    ],
  },
];

/* Support + Billing are pinned to the end of the panel on every frontend (shared
   AppShell `tail`), so they're deliberately NOT in CUSTOMER_NAV. EziQuotes has no
   standalone billing page — its billing lives in a Settings tab. */
const TAIL_NAV = [
  { icon: 'lifebuoy', name: 'Support', href: '/support' },
  { icon: 'pricing', name: 'Billing', href: '/settings/billing' },
];

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const [location, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: user } = useCurrentUser();
  const confirm = useConfirm();
  const [avtMenuOpen, setAvtMenuOpen] = useState(false);
  const [newBrandOpen, setNewBrandOpen] = useState(false);
  const avtRef = useRef<HTMLDivElement>(null);
  // The panel's brand dropdown replaces the old bottom-of-sidebar BrandSwitcher.
  const { brands } = usePaymentsContext();

  const handleSignOut = async () => {
    setAvtMenuOpen(false);
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

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!avtMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (avtRef.current && !avtRef.current.contains(e.target as Node)) {
        setAvtMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [avtMenuOpen]);
  const ensureAccount = useMutation(
    trpc.payments.accounts.ensureAccount.mutationOptions(),
  );
  const { data: accountData } = useQuery({
    ...trpc.payments.accounts.me.queryOptions({ brandId: brandId! }),
    enabled: !!user && !!brandId,
  });
  // Auto-create the payments account row on first authenticated mount
  useEffect(() => {
    if (user && brandId) ensureAccount.mutate({ brandId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, brandId]);
  // Redirect new users to onboarding if setup is not complete
  useEffect(() => {
    if (!accountData) return;
    const state = (accountData as any).onboardingState;
    const isComplete = !state || state === 'complete';
    if (!isComplete && !location.startsWith('/onboarding')) {
      navigate('/onboarding');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(accountData as any)?.onboardingState, location]);

  const displayName = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .join(' ');
  const initials = displayName
    ? displayName
        .split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '??';

  const now = new Date();
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const months = [
    'JAN',
    'FEB',
    'MAR',
    'APR',
    'MAY',
    'JUN',
    'JUL',
    'AUG',
    'SEP',
    'OCT',
    'NOV',
    'DEC',
  ];
  const dateStr = `${days[now.getDay()]} · ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  // Derive active nav item directly from the nav items list.
  // This is data-driven: any item added to CUSTOMER_NAV is automatically
  // highlighted when its href matches the current location. (Super-admin
  // screens live in the Prodesk app's /super-admin section, not here.)
  const allNav = [...CUSTOMER_NAV];
  const allNavItems = allNav.flatMap((g) => g.items);
  // Sort by href length descending so more-specific paths match first
  // (e.g. /affiliate/dashboard before /affiliate)
  const sortedNavItems = [...allNavItems].sort(
    (a, b) => b.href.length - a.href.length,
  );
  const activeItem = sortedNavItems.find((item) => {
    // Exact match for root-level dashboard paths
    if (item.href === '/' || item.href === '/app') {
      return (
        location === '/' || location === '/dashboard' || location === '/app'
      );
    }
    // Match exact path or sub-paths (e.g. /proposals/123)
    return (
      location === item.href ||
      location.startsWith(item.href + '/') ||
      location.startsWith(item.href + '?')
    );
  });
  const active = activeItem?.name ?? '';

  const navItems = (items: { icon: string; name: string; href: string }[]) =>
    items.map((item) => ({
      key: item.href,
      label: item.name,
      icon: <NavIcon name={item.icon} />,
      href: item.href,
      active: active === item.name,
    }));

  return (
    <ProdeskAppShell
      appKey="payments"
      panelClassName="psp-theme-eziquotes"
      mainClassName="main-area"
      homeHref="/app"
      logo={
        <img
          src="/logo-wordmark.svg"
          alt="Prodesk"
          className="wordmark-logo"
          style={{ height: 22 }}
        />
      }
      groups={CUSTOMER_NAV.map((g) => ({
        label: g.section,
        items: navItems(g.items),
      }))}
      tail={navItems(TAIL_NAV)}
      brand={{
        brands,
        activeBrandId: brandId,
        onSwitched: () => navigate('/app'),
        onCreateBrand: () => setNewBrandOpen(true),
      }}
      onSignOut={() => void handleSignOut()}
    >
      <>
        {/* Topbar */}
        <div className="tb">
          <span className="date">{dateStr}</span>
          <span className="greet">
            Hey <em>{user?.firstName || 'there'}</em> - let's close some deals.
          </span>
          <span className="spc" />
          <div className="search">
            <NavIcon name="search" />
            <input
              placeholder="Search payers, proposals, products..."
              readOnly
            />
            <span className="kbd">⌘K</span>
          </div>
          {!isProd && (
            <div
              className="tb-ico"
              onClick={() => toast.info('Notifications coming soon')}
            >
              <NavIcon name="bell" />
            </div>
          )}
          {!isProd && (
            <div
              className="tb-ico"
              onClick={() => toast.info('Calendar coming soon')}
            >
              <NavIcon name="calendar" />
            </div>
          )}
          <button
            className="btn primary"
            onClick={() => navigate('/proposals/new')}
          >
            <NavIcon name="plus" />
            New Proposal
          </button>
          <div
            className="avt-wrap"
            ref={avtRef}
            style={{ position: 'relative' }}
          >
            <div
              className="avt"
              title={displayName}
              onClick={() => setAvtMenuOpen((o) => !o)}
              style={{ cursor: 'pointer', overflow: 'hidden', padding: 0 }}
            >
              {user?.profileUrl ? (
                <img
                  src={user.profileUrl}
                  alt={displayName}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: 'block',
                    borderRadius: 'inherit',
                  }}
                />
              ) : (
                initials
              )}
            </div>
            {avtMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  zIndex: 500,
                  background: 'var(--bg-card, #fff)',
                  border: '1px solid var(--border-1, rgba(0,0,0,0.1))',
                  borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                  minWidth: 180,
                  padding: '4px 0',
                }}
              >
                {user && (
                  <div
                    style={{
                      padding: '8px 14px 6px',
                      borderBottom:
                        '1px solid var(--border-1, rgba(0,0,0,0.1))',
                      marginBottom: 4,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--ink, #0a0a0a)',
                        lineHeight: 1.3,
                      }}
                    >
                      {displayName}
                    </div>
                    {user.email && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--ink-60, rgba(0,0,0,0.6))',
                          marginTop: 2,
                        }}
                      >
                        {user.email}
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    width: '100%',
                    textAlign: 'left',
                    padding: '7px 14px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 13,
                    color: 'var(--danger, #e53e3e)',
                  }}
                >
                  <svg
                    width={13}
                    height={13}
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    aria-hidden="true"
                  >
                    <path
                      d="M10 3h3a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-3M7 11l3-3-3-3M10 8H1"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Page content — brand-scoped, so guard the no-brand case (e.g. an
            agency-only user useEnsureBrandContext couldn't switch) like the
            links/reviews frontends do. */}
        {brandId ? (
          children
        ) : (
          <div className="page">
            <div
              style={{
                maxWidth: 420,
                margin: '80px auto',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontStyle: 'italic',
                  fontSize: 22,
                }}
              >
                No brand selected.
              </div>
              <p style={{ fontSize: 13, color: 'var(--ink-60)', marginTop: 8 }}>
                Proposals and payments belong to a brand. Switch into a brand
                workspace to manage them.
              </p>
            </div>
          </div>
        )}
      </>
      <NewBrandDialog
        open={newBrandOpen}
        onOpenChange={setNewBrandOpen}
        blurb="Each brand is its own EziQuotes workspace — proposals, payers and payouts."
      />
    </ProdeskAppShell>
  );
}
