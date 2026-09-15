/**
 * AppShell — the ONE side panel every satellite frontend wears.
 *
 * Before this existed, each frontend hand-rolled its own sidebar and they drifted:
 * the brand switcher was at the bottom in Verdiict/Adeyy and at the top in Logo
 * Studio, "Add brand" was a separate nav row that vanished for single-brand users
 * (so they could never make a second one), Support/Billing sat wherever they
 * landed, only SIGKITT collapsed, and the widths were 224/240/248/260/280px.
 *
 * The fixed order down the panel — identical everywhere:
 *
 *   header        app logo + the BY PRODESK tag
 *   suite         Prodesk Suite → the dashboard, under the other apps' marks
 *   context slot  brand dropdown (brand-level) · ContextSelector (jobs) · nothing
 *   nav           grouped by category, scrolls
 *   tail          Support, Billing
 *   identity      plain Profile row — USER-LEVEL apps only, sits above sign out
 *   exit          Sign out
 *
 * WHY THE SUITE ROW IS AT THE TOP: it used to be a footer tile next to Sign out,
 * which put the rest of the suite in the one region users only visit to leave — and
 * made "Prodesk Suite" read as a sibling of "sign out" rather than as the product
 * the tool belongs to. At the top, under the app's own logo, it sits where an app
 * switcher is expected, and it shows the OTHER apps' marks inline: someone living in
 * one tool can see there are eight more without opening anything. That discovery is
 * the point — most users never learn the suite exists from inside a single app.
 *
 * It still goes ONE place: the dashboard. The marks advertise, they don't link (see
 * SuiteLauncher) — the dashboard owns entitlements and the add-a-tool flow, so it
 * stays the only way in to another app.
 *
 * BRAND- VS USER-LEVEL: a frontend scoped to one brand at a time passes `brand`
 * and gets the dropdown directly under the header. A user-level frontend (Design)
 * passes `identity` instead and gets a plain Profile row above the exit row. Jobs
 * is neither — it passes `contextSlot` and renders the shared ContextSelector
 * (brands AND agencies) in the same position as the brand dropdown.
 *
 * THE DROPDOWN IS ALWAYS A BUTTON, even with a single brand. It's the only route
 * to "New brand", so rendering a dead label for single-brand users (what Verdiict,
 * Adeyy and Logo Studio all used to do) locked them out of creating their second.
 *
 * Colours come from `--psp-*` overridden on `panelClassName`; layout and width
 * come from styles/side-panel.css. Never pass a colour in from a call site.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Briefcase,
  Check,
  ChevronsUpDown,
  CreditCard,
  FileText,
  Globe,
  Grip,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Palette,
  PanelLeft,
  Plus,
  Sparkles,
  Stamp,
  Star,
  X,
} from 'lucide-react';
import { useTRPC } from '../../lib/trpc';
import { useCrossAppOpen } from '../../auth/use-cross-app';
import { PRODESK_ORIGINS } from '../../lib/origins';

/**
 * The suite roster the switcher shows, in the order it shows them: the dashboard
 * (the way in to everything, including the apps you don't have yet) and then the
 * tools. `color` + `icon` ARE each app's mark here — the satellites don't ship each
 * other's logo files, and 9 SVGs bundled into 9 frontends to draw 16px chips is a
 * worse trade than one coloured tile per app.
 */
export type SuiteFrontendItem = {
  key: string;
  name: string;
  shortName: string;
  tagline: string;
  originKey: keyof typeof PRODESK_ORIGINS;
  color: string;
  icon: typeof Sparkles;
};

export const SUITE_FRONTENDS: SuiteFrontendItem[] = [
  {
    key: 'dashboard',
    name: 'Prodesk Dashboard',
    shortName: 'Prodesk',
    tagline: 'Brand Command Centre',
    originKey: 'dashboard',
    color: '#D9F542',
    icon: Sparkles,
  },
  {
    key: 'reviews',
    name: 'Verdiict',
    shortName: 'Reviews',
    tagline: 'Review Capture & Directory',
    originKey: 'reviews',
    color: '#3B82F6',
    icon: Star,
  },
  {
    key: 'signatures',
    name: 'SIGKITT',
    shortName: 'Signatures',
    tagline: 'Email Signature Builder',
    originKey: 'signatures',
    color: '#10B981',
    icon: FileText,
  },
  {
    key: 'payments',
    name: 'EziQuotes',
    shortName: 'Payments',
    tagline: 'Proposals & Stripe Payments',
    originKey: 'payments',
    color: '#F59E0B',
    icon: CreditCard,
  },
  {
    key: 'links',
    name: 'Adeyy',
    shortName: 'Links',
    tagline: 'Short Links & QR Codes',
    originKey: 'links',
    color: '#14B8A6',
    icon: Link2,
  },
  {
    key: 'jobs',
    name: 'Jobs',
    shortName: 'Jobs Workspace',
    tagline: 'Multi-Role Team Hub',
    originKey: 'jobs',
    color: '#8B5CF6',
    icon: Briefcase,
  },
  {
    key: 'websites',
    name: 'Websites',
    shortName: 'Websites',
    tagline: 'Brand Sites Builder',
    originKey: 'websites',
    color: '#EC4899',
    icon: Globe,
  },
  {
    key: 'design',
    name: 'Design',
    shortName: 'Design Studio',
    tagline: 'User Design Tool',
    originKey: 'design',
    color: '#6366F1',
    icon: Palette,
  },
  {
    key: 'logo',
    name: 'Logo',
    shortName: 'Logo Studio',
    tagline: 'Brand Logo Studio',
    originKey: 'logo',
    color: '#F43F5E',
    icon: Stamp,
  },
  {
    key: 'chat',
    name: 'Chat',
    shortName: 'Chat',
    tagline: 'Messages & Groups',
    originKey: 'chat',
    color: '#38BDF8',
    icon: MessageCircle,
  },
];

export type SidePanelItem = {
  /** Stable key; also the tooltip/aria fallback. */
  key: string;
  label: string;
  icon?: ReactNode;
  /** Wouter route to link to. Mutually exclusive with onClick. */
  href?: string;
  onClick?: () => void;
  active?: boolean;
  /** Small trailing hint (step number, count). Hidden when collapsed. */
  badge?: ReactNode;
};

export type SidePanelGroup = {
  /** Category heading. Null/undefined renders the items with no heading. */
  label?: string | null;
  items: SidePanelItem[];
};

export type SidePanelBrand = {
  id: string;
  businessName: string;
  logoUrl?: string | null;
};

export type SidePanelBrandSlot = {
  brands: SidePanelBrand[];
  activeBrandId?: string | null;
  /** e.g. "Owner" / "Editor" / "Viewer" — shown small next to the name. */
  roleLabel?: string | null;
  /** Opens the frontend's own create-brand flow. Always offered in the menu. */
  onCreateBrand: () => void;
  /** Ran after a successful switch (usually "go home"). */
  onSwitched?: () => void;
  createLabel?: string;
};

export type AppShellProps = {
  /** Namespaces the persisted collapse state, e.g. 'reviews'. */
  appKey: string;
  /** The app's wordmark/logo node. Keep it ~20px tall. */
  logo: ReactNode;
  byline?: string;
  /** Theme class carrying the --psp-* overrides, e.g. 'psp-theme-adeyy'. */
  panelClassName?: string;
  /** Class for the routed main column — keeps each app's own page padding. */
  mainClassName?: string;
  groups: SidePanelGroup[];
  /** Pinned to the end of the panel, above the identity/exit rows. */
  tail?: SidePanelItem[];
  brand?: SidePanelBrandSlot;
  /**
   * Custom top slot (Jobs' ContextSelector). Gets the collapse state so the
   * selector can render its own icon-only trigger and expand the rail on click.
   */
  contextSlot?: (state: {
    collapsed: boolean;
    expand: () => void;
    collapse: () => void;
  }) => ReactNode;
  /** User-level apps only: the plain Profile row above the exit row. */
  identity?: SidePanelItem;
  /** Confirm-then-signOut, owned by the frontend so it keeps its own dialog. */
  onSignOut: () => void;
  /** Where the logo links. Defaults to '/'. */
  homeHref?: string;
  children: ReactNode;
};

const COLLAPSE_KEY = (appKey: string) => `psp.collapsed.${appKey}`;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function Avatar({ name, url }: { name: string; url?: string | null }) {
  return (
    <span className="psp-avatar" aria-hidden="true">
      {url ? <img src={url} alt="" /> : initials(name)}
    </span>
  );
}

/** Nav row — a wouter Link when it has an href, a button otherwise. */
function Row({ item, collapsed }: { item: SidePanelItem; collapsed: boolean }) {
  const inner = (
    <>
      {item.icon ? <span className="psp-item-ico">{item.icon}</span> : null}
      <span className="psp-item-label">{item.label}</span>
      {item.badge ? <span className="psp-item-badge">{item.badge}</span> : null}
    </>
  );
  const className = 'psp-item' + (item.active ? ' active' : '');
  // Collapsed rows are icon-only, so the native tooltip is the only label left.
  const title = collapsed ? item.label : undefined;

  if (item.href) {
    return (
      <Link
        href={item.href}
        className={className}
        title={title}
        onClick={item.onClick}
      >
        {inner}
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={className}
      title={title}
      onClick={item.onClick}
    >
      {inner}
    </button>
  );
}

/**
 * The brand dropdown. Switching is server-persisted (auth.switchContext) and
 * shared with every other frontend, so this is the same context the suite sees.
 */
function BrandSlot({
  slot,
  collapsed,
  onExpand,
}: {
  slot: SidePanelBrandSlot;
  collapsed: boolean;
  onExpand: () => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const switchCtx = useMutation(trpc.auth.switchContext.mutationOptions());

  const active =
    slot.brands.find((b) => b.id === slot.activeBrandId) ??
    slot.brands[0] ??
    null;
  const label = active?.businessName ?? 'Select brand';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id === active?.id) return;
    switchCtx.mutate(
      { type: 'brand', entityId: id },
      {
        onSuccess: () => {
          // Everything on screen is brand-scoped; drop the whole cache rather
          // than trying to enumerate the keys that just went stale.
          qc.invalidateQueries();
          slot.onSwitched?.();
        },
      },
    );
  };

  return (
    <div className="psp-slot">
      <button
        type="button"
        className="psp-switch"
        aria-expanded={open}
        aria-haspopup="listbox"
        title={collapsed ? label : undefined}
        disabled={switchCtx.isPending}
        onClick={() => {
          // Collapsed rail: expand first so the menu has somewhere to land.
          if (collapsed) onExpand();
          setOpen((o) => !o);
        }}
      >
        <Avatar name={label} url={active?.logoUrl} />
        {/* Name, role and chevron are all hidden by CSS on the collapsed rail —
            only the avatar survives, so the trigger stays a clean square. */}
        <span className="psp-switch-name">{label}</span>
        {slot.roleLabel ? (
          <span className="psp-switch-role">{slot.roleLabel}</span>
        ) : null}
        <ChevronsUpDown size={14} className="psp-switch-chev" />
      </button>

      {open && (
        <>
          <div className="psp-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="psp-menu" role="listbox">
            <div className="psp-menu-head">
              {slot.brands.length === 1
                ? 'Your brand'
                : `Your brands · ${slot.brands.length}`}
            </div>
            {slot.brands.map((b) => (
              <button
                key={b.id}
                type="button"
                role="option"
                aria-selected={b.id === active?.id}
                className={
                  'psp-menu-item' + (b.id === active?.id ? ' active' : '')
                }
                onClick={() => pick(b.id)}
              >
                <Avatar name={b.businessName} url={b.logoUrl} />
                <span className="psp-menu-name">{b.businessName}</span>
                {b.id === active?.id && <Check size={14} />}
              </button>
            ))}
            <div className="psp-menu-sep" />
            <button
              type="button"
              className="psp-menu-item"
              onClick={() => {
                setOpen(false);
                slot.onCreateBrand();
              }}
            >
              <span className="psp-avatar">
                <Plus size={13} />
              </span>
              <span className="psp-menu-name">
                {slot.createLabel ?? 'New brand'}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The Prodesk Suite row — top of the panel, under the app's own logo.
 *
 * ONE destination: the dashboard. Deliberately not an app switcher — the dashboard
 * is where entitlements, pricing and the "add this tool" flow live, so every route
 * into another tool goes through it rather than around it. A menu of direct links
 * would let someone jump into an app they don't have and hit a locked screen with no
 * explanation.
 *
 * It used to carry a strip of the other tools' coloured marks as a visible upsell.
 * Those are gone: nine chips of unrelated hues fought with each frontend's own
 * palette, and the row reads as what it is — a labelled way out to the suite — with
 * just the waffle glyph and the label. It stays at the top rather than next to Sign
 * out so it's still the first thing that says the suite exists.
 *
 * Opens a new tab: you're stepping sideways out of work in progress, not navigating
 * within an app. useCrossAppOpen makes that a proper session hand-off when the
 * dashboard sits on another domain (adeyy.com).
 */
function SuiteLauncher({ collapsed }: { collapsed: boolean }) {
  const openCrossApp = useCrossAppOpen();

  return (
    <div className="psp-suitebar">
      <button
        type="button"
        className="psp-suite"
        aria-label="Prodesk Suite dashboard — all your apps"
        title={
          collapsed
            ? 'Prodesk Suite — all your apps'
            : 'Your Prodesk Suite dashboard — every app, and the ones you can add'
        }
        onClick={() =>
          void openCrossApp(PRODESK_ORIGINS.dashboard, '/', { newWindow: true })
        }
      >
        <Grip size={15} className="psp-suite-ico" />
        <span className="psp-suite-text">
          <span className="psp-suite-row">
            <span className="psp-suite-label">Prodesk Suite</span>
            <ArrowUpRight size={13} className="psp-suite-arrow" />
          </span>
        </span>
      </button>
    </div>
  );
}

export function AppShell({
  appKey,
  logo,
  byline = 'By Prodesk',
  panelClassName,
  mainClassName,
  groups,
  tail,
  brand,
  contextSlot,
  identity,
  onSignOut,
  homeHref = '/',
  children,
}: AppShellProps) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY(appKey)) === '1';
    } catch {
      return false; /* private mode / storage disabled */
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  const setCollapsedPersisted = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        localStorage.setItem(COLLAPSE_KEY(appKey), next ? '1' : '0');
      } catch {
        /* ignore */
      }
    },
    [appKey],
  );
  const expand = useCallback(
    () => setCollapsedPersisted(false),
    [setCollapsedPersisted],
  );
  const collapse = useCallback(
    () => setCollapsedPersisted(true),
    [setCollapsedPersisted],
  );

  // Navigating from inside the drawer must close it, or the new page renders
  // behind a full-screen scrim.
  useEffect(() => {
    setMobileOpen(false);
  }, [location]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  const brandMark = useMemo(
    () => (
      <Link href={homeHref} className="psp-brand" aria-label="Home">
        <span className="psp-brand-mark">{logo}</span>
        {byline ? <span className="psp-by">{byline}</span> : null}
      </Link>
    ),
    [homeHref, logo, byline],
  );

  return (
    <div className="psp-shell" data-collapsed={collapsed ? 'true' : 'false'}>
      {/* Mobile top bar — the only way to reach the drawer under 900px. */}
      <header
        className={
          'psp-mobilebar' + (panelClassName ? ' ' + panelClassName : '')
        }
      >
        {brandMark}
        <button
          type="button"
          className="psp-burger"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={20} />
        </button>
      </header>

      {mobileOpen && (
        <div className="psp-scrim" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={
          'psp-side' +
          (panelClassName ? ' ' + panelClassName : '') +
          (mobileOpen ? ' psp-open' : '')
        }
        data-collapsed={collapsed ? 'true' : 'false'}
      >
        <div className="psp-head">
          {brandMark}
          <button
            type="button"
            className="psp-toggle"
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={() => setCollapsedPersisted(!collapsed)}
          >
            <PanelLeft size={16} />
          </button>
          <button
            type="button"
            className="psp-close"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          >
            <X size={18} />
          </button>
        </div>

        {/* The suite comes before the app's own context — it's the frame the tool
            sits in, and it's the one row that has to be found without looking. */}
        <SuiteLauncher collapsed={collapsed} />

        {/* Context slot: brand dropdown, or a frontend-supplied selector. */}
        {brand ? (
          <BrandSlot slot={brand} collapsed={collapsed} onExpand={expand} />
        ) : contextSlot ? (
          <div className="psp-slot">
            {contextSlot({ collapsed, expand, collapse })}
          </div>
        ) : null}

        <nav className="psp-nav">
          {groups.map((g, gi) => (
            <div key={g.label ?? `g${gi}`} style={{ display: 'contents' }}>
              {g.label ? <div className="psp-grp">{g.label}</div> : null}
              {g.items.map((item) => (
                <Row key={item.key} item={item} collapsed={collapsed} />
              ))}
            </div>
          ))}
        </nav>

        <div className="psp-foot">
          {/* Support + Billing live here on every frontend, whatever else moves. */}
          {(tail ?? []).map((item) => (
            <Row key={item.key} item={item} collapsed={collapsed} />
          ))}
          {identity ? <Row item={identity} collapsed={collapsed} /> : null}

          {/* Sign out is the whole exit row now — the suite switcher moved to the
              top, so leaving the ACCOUNT is all that's left down here. Collapsed,
              CSS drops the label and leaves the glyph. */}
          <div className="psp-exit">
            <button
              type="button"
              className="psp-signout"
              onClick={onSignOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut size={17} className="psp-signout-ico" />
              <span className="psp-signout-label">Sign out</span>
            </button>
          </div>
        </div>
      </aside>

      <div className={'psp-main' + (mainClassName ? ' ' + mainClassName : '')}>
        {children}
      </div>
    </div>
  );
}
