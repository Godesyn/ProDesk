import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'wouter';
import { X, PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ENV_BADGE } from '../../lib/app-env';
import { Tooltip } from '../ui/tooltip';
import { PendingVerificationRail } from './pending-verification-rail';
import { buildNavItems, type NavContext, type NavEntry } from './nav-items';

type NavItemEntry = Extract<NavEntry, { kind: 'item' }>;

/**
 * Collapsed-rail shape: a run of items following a `header` becomes ONE icon
 * that opens a flyout, so a role with many tabs (super-admin: ~28) shows a
 * handful of group icons instead of a 28-icon strip that overruns the viewport.
 * Items with no header above them stay as their own icon (roles that use plain
 * dividers keep the flat rail they've always had).
 */
type CollapsedNode =
  | { kind: 'item'; entry: NavItemEntry }
  | { kind: 'divider' }
  | { kind: 'group'; title: string; icon: LucideIcon; items: NavItemEntry[] };

function buildCollapsedNodes(entries: NavEntry[]): CollapsedNode[] {
  const nodes: CollapsedNode[] = [];
  let group: Extract<CollapsedNode, { kind: 'group' }> | null = null;
  for (const e of entries) {
    if (e.kind === 'pending') continue;
    if (e.kind === 'header') {
      group = { kind: 'group', title: e.title, icon: e.icon, items: [] };
      nodes.push(group);
    } else if (e.kind === 'divider') {
      // Dividers only structure the ungrouped run — inside a group the flyout
      // renders one continuous list, so there's nothing to separate.
      if (!group) nodes.push({ kind: 'divider' });
    } else if (group) {
      group.items.push(e);
    } else {
      nodes.push({ kind: 'item', entry: e });
    }
  }
  // A header whose items were all permission-filtered away would leave a dead icon.
  const kept = nodes.filter((n) => n.kind !== 'group' || n.items.length > 0);
  // One group isn't worth a flyout — it would hide the whole nav behind a single
  // icon (individualContractor). Only fold when grouping actually shortens the rail.
  if (kept.filter((n) => n.kind === 'group').length < 2) {
    return kept.flatMap((n) =>
      n.kind === 'group' ? n.items.map((entry) => ({ kind: 'item', entry }) as CollapsedNode) : [n],
    );
  }
  return kept;
}

const isActiveHref = (location: string, href: string) =>
  location === href || location.startsWith(href + '/');

// Types live in ./nav-items so this module only exports React components
// (keeps Vite Fast Refresh working). Re-exported here for existing importers.
export type {
  UserRole,
  StaffPermission,
  NavContext,
  NavEntry,
} from './nav-items';

function NavList({
  entries,
  top,
  collapsed = false,
}: {
  entries: NavEntry[];
  top?: React.ReactNode;
  collapsed?: boolean;
}) {
  const [location] = useLocation();
  const isPending = entries.length === 1 && entries[0].kind === 'pending';
  // Which collapsible group headers are closed (by title). Default: collapse
  // every group EXCEPT the one holding the active route, so the rail opens tidy
  // but still shows where you are (and single-group roles stay expanded).
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => {
    const headers: string[] = [];
    let activeHeader: string | null = null;
    let cur: string | null = null;
    for (const e of entries) {
      if (e.kind === 'header') {
        headers.push(e.title);
        cur = e.title;
      } else if (e.kind === 'item' && cur) {
        if (location === e.href || location.startsWith(e.href + '/')) activeHeader = cur;
      }
    }
    return new Set(headers.filter((h) => h !== activeHeader));
  });
  const toggleGroup = (title: string) =>
    setClosedGroups((prev) => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });

  // Track which header the current run of items belongs to, so items under a
  // collapsed header can be hidden. Reset by the next header (dividers don't).
  let currentHeader: string | null = null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Context selector is full-bleed (no side padding); the tab list owns the side margin. */}
      {top}
      {/* Pending-verification rail replaces the whole tab list, centered in the rail. */}
      {isPending ? (
        <div className="flex flex-1 flex-col justify-center pb-6">
          <PendingVerificationRail />
        </div>
      ) : collapsed ? (
        <nav className="flex flex-col gap-0.5 px-2 pt-3">
          {buildCollapsedNodes(entries).map((n, i) => {
            if (n.kind === 'divider') {
              return (
                <div key={`d${i}`} className="my-3 h-px bg-[color:var(--color-border-hairline)]" />
              );
            }
            if (n.kind === 'group') {
              return <CollapsedGroup key={`g${n.title}`} title={n.title} icon={n.icon} items={n.items} />;
            }
            return (
              <NavLink
                key={n.entry.href}
                entry={n.entry}
                collapsed
                active={isActiveHref(location, n.entry.href)}
              />
            );
          })}
        </nav>
      ) : (
        <nav className="flex flex-col gap-0.5 px-3 pt-3">
          {entries.map((e, i) => {
            if (e.kind === 'pending') {
              return null;
            }
            if (e.kind === 'divider') {
              return (
                <div
                  key={`d${i}`}
                  className="my-3 h-px bg-[color:var(--color-border-hairline)]"
                />
              );
            }
            if (e.kind === 'header') {
              const Icon = e.icon;
              currentHeader = e.title;
              // Expanded rail: the header is a collapsible toggle for its group.
              const isClosed = closedGroups.has(e.title);
              return (
                <button
                  key={`h${i}`}
                  type="button"
                  onClick={() => toggleGroup(e.title)}
                  aria-expanded={!isClosed}
                  className="mt-2 flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-3 py-2 text-eyebrow text-ink-40 transition-colors hover:text-ink-60"
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="flex-1 text-left">{e.title}</span>
                  <ChevronDown
                    className={cn('h-3.5 w-3.5 transition-transform', isClosed && '-rotate-90')}
                  />
                </button>
              );
            }
            // item — hidden when its group's header is collapsed.
            if (currentHeader && closedGroups.has(currentHeader)) {
              return null;
            }
            return (
              <NavLink
                key={e.href}
                entry={e}
                active={isActiveHref(location, e.href)}
              />
            );
          })}
        </nav>
      )}
    </div>
  );
}

/**
 * One group icon on the collapsed rail. Hover (or click, to pin) opens a
 * body-portalled flyout listing the group's tabs at full width — so a collapsed
 * rail stays a short strip of icons no matter how many tabs the role has.
 */
function CollapsedGroup({
  title,
  icon: Icon,
  items,
}: {
  title: string;
  icon: LucideIcon;
  items: NavItemEntry[];
}) {
  const [location] = useLocation();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  // Pinned = opened by click, so it survives the pointer leaving (lets you
  // scroll a long group). Cleared by Escape, an outside click, or navigating.
  const [pinned, setPinned] = useState(false);
  const open = pos !== null;

  const hasActive = items.some((it) => isActiveHref(location, it.href));
  const badgeTotal = items.reduce((n, it) => n + (it.badge ?? 0), 0);

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const close = () => {
    cancelClose();
    setPos(null);
    setPinned(false);
  };
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.top, left: r.right });
  };
  const openNow = () => {
    cancelClose();
    place();
  };
  // Small grace period so the pointer can cross the rail→flyout gap.
  const scheduleClose = () => {
    if (pinned) return;
    cancelClose();
    closeTimer.current = setTimeout(() => setPos(null), 120);
  };

  useEffect(() => () => cancelClose(), []);

  // Keep the flyout glued to its icon: any scroll (the rail scrolls internally,
  // hence capture) or resize invalidates the measured anchor.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      close();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open]);

  // A group anchored near the bottom of the viewport would render off-screen;
  // lift it just enough to fit (it converges — one nudge makes the test pass).
  useLayoutEffect(() => {
    if (!pos || !panelRef.current) return;
    const h = panelRef.current.offsetHeight;
    const maxTop = window.innerHeight - 8 - h;
    if (pos.top > maxTop) setPos({ ...pos, top: Math.max(8, maxTop) });
  }, [pos]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={title}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        onFocus={openNow}
        onClick={() => (open && pinned ? close() : (openNow(), setPinned(true)))}
        className={cn(
          'group relative flex items-center justify-center rounded-[var(--radius-sm)] py-2 transition-colors',
          hasActive || open
            ? 'bg-[color:var(--color-active-muted)] text-ink-100'
            : 'text-ink-60 hover:bg-inset hover:text-ink-100',
        )}
      >
        {hasActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
        )}
        <span className="relative">
          <Icon className="h-4 w-4 shrink-0" />
          {badgeTotal ? (
            <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
          ) : null}
        </span>
        {/* Affordance that this icon opens a submenu rather than navigating. */}
        <ChevronRight className="absolute right-0.5 h-3 w-3 text-ink-40" />
      </button>

      {pos &&
        createPortal(
          <div
            ref={panelRef}
            role="group"
            aria-label={title}
            onMouseEnter={cancelClose}
            onMouseLeave={scheduleClose}
            style={{ position: 'fixed', top: pos.top, left: pos.left }}
            // pl-2 is a transparent bridge so the pointer can cross rail→flyout.
            className="z-[60] pl-2"
          >
            <div className="max-h-[calc(100vh-16px)] min-w-[196px] overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-1.5 shadow-3">
              <div className="px-2 pb-1 pt-1 text-eyebrow text-ink-40">{title}</div>
              <div className="flex flex-col gap-0.5">
                {items.map((it) => (
                  <NavLink
                    key={it.href}
                    entry={it}
                    active={isActiveHref(location, it.href)}
                    onNavigate={close}
                  />
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function NavLink({
  entry,
  active,
  collapsed = false,
  onNavigate,
}: {
  entry: NavItemEntry;
  active: boolean;
  collapsed?: boolean;
  /** Called after the link is clicked (closes the collapsed-rail flyout). */
  onNavigate?: () => void;
}) {
  const Icon = entry.icon;
  return (
    // Collapsed rail: instant (no-delay) tooltip shows the tab label on hover.
    <Tooltip label={collapsed ? entry.title : undefined} side="right">
    <Link
      href={entry.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center rounded-[var(--radius-sm)] py-2 text-ui-sm transition-colors',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
        active
          ? 'bg-[color:var(--color-active-muted)] text-ink-100'
          : 'text-ink-60 hover:bg-inset hover:text-ink-100',
      )}
    >
      {/* Volt left-bar indicator (animated_nav_tile.dart). */}
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-accent" />
      )}
      <span className="relative">
        <Icon className="h-4 w-4 shrink-0" />
        {/* Collapsed: surface a pending badge as a small dot rather than losing it. */}
        {collapsed && entry.badge ? (
          <span className="absolute -right-1 -top-1 h-1.5 w-1.5 rounded-full bg-accent" />
        ) : null}
      </span>
      {!collapsed && <span className="truncate">{entry.title}</span>}
      {!collapsed && entry.badge ? (
        <span className="ml-auto rounded-pill bg-accent px-1.5 text-ui-xs text-white">
          {entry.badge}
        </span>
      ) : null}
    </Link>
    </Tooltip>
  );
}

/** Bottom-of-rail toggle to collapse/expand the desktop sidebar. */
function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'mx-2 mt-2 flex items-center rounded-[var(--radius-sm)] py-2 text-ui-sm text-ink-60 transition-colors hover:bg-inset hover:text-ink-100',
        collapsed ? 'justify-center px-0' : 'gap-3 px-3',
      )}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-4 w-4 shrink-0" />
      ) : (
        <PanelLeftClose className="h-4 w-4 shrink-0" />
      )}
      {!collapsed && <span>Collapse</span>}
    </button>
  );
}

/** Per-environment palette for the non-production badge. */
const ENV_BADGE_STYLE: Record<string, { dot: string; text: string; bg: string; ring: string }> = {
  Staging: { dot: '#f59e0b', text: '#b45309', bg: 'rgba(245,158,11,0.12)', ring: 'rgba(245,158,11,0.35)' },
  Development: { dot: '#8b5cf6', text: '#6d28d9', bg: 'rgba(139,92,246,0.12)', ring: 'rgba(139,92,246,0.35)' },
};

/**
 * Foot of the nav rail. In production: compact Privacy / Terms links pointing at
 * the canonical legal pages on the marketing site (prodesk.com/legal), opened in
 * a new tab. In any non-production build: a beautiful environment chip ("Staging"
 * / "Development") in their place, so it's instantly clear you're not on prod.
 */
function SidebarLegalFooter() {
  if (ENV_BADGE) {
    const c = ENV_BADGE_STYLE[ENV_BADGE] ?? ENV_BADGE_STYLE.Staging;
    return (
      <div className="mt-auto px-5 pt-4">
        <span
          className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-ui-xs font-semibold uppercase tracking-[0.08em] ring-1 ring-inset"
          style={{ color: c.text, backgroundColor: c.bg, boxShadow: `inset 0 0 0 1px ${c.ring}` }}
          title={`You are on the ${ENV_BADGE.toLowerCase()} environment`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
              style={{ backgroundColor: c.dot }}
            />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: c.dot }} />
          </span>
          {ENV_BADGE}
        </span>
      </div>
    );
  }
  return (
    <div className="mt-auto flex flex-wrap gap-x-3 gap-y-1 px-5 pt-4 text-ui-xs text-ink-40">
      <a
        href="https://www.prodesk.com/legal/privacy.html"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-accent"
      >
        Privacy
      </a>
      <a
        href="https://www.prodesk.com/legal/terms.html"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-accent"
      >
        Terms
      </a>
    </div>
  );
}

interface SidebarProps {
  nav: NavContext;
  /**
   * Workspace switcher rendered at the top of the rail. A render fn so each rail
   * (collapsed desktop vs. always-expanded mobile drawer) gets the right variant.
   */
  contextSelector?: (collapsed: boolean) => React.ReactNode;
  /** Mobile drawer state (controlled by MainLayout). */
  mobileOpen: boolean;
  onMobileClose: () => void;
  /** Desktop rail collapsed to an icon-only strip (persisted by MainLayout). */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  nav,
  contextSelector,
  mobileOpen,
  onMobileClose,
  collapsed,
  onToggleCollapse,
}: SidebarProps) {
  const entries = buildNavItems(nav);
  const fallbackTop = (
    <Link href="/" className="mb-4 block px-2 text-panel-title text-ink-100">
      Prodesk
    </Link>
  );
  // Desktop honours the collapsed flag; the mobile drawer is always expanded.
  const desktopTop = contextSelector ? contextSelector(collapsed) : fallbackTop;
  const mobileTop = contextSelector ? contextSelector(false) : fallbackTop;

  return (
    <>
      {/* Desktop rail — 210px expanded / 64px collapsed, animated width.
          Pinned to the viewport height (sticky top-0 h-screen) so the rail scrolls
          on its own: NavList overflows internally while the collapse toggle + legal
          footer stay anchored at the bottom of the viewport, regardless of how tall
          the main content scrolls. */}
      <aside
        className={cn(
          'sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-[color:var(--color-border-hairline)] bg-paper pb-5 pt-0 md:flex',
          'transition-[width] ease-[cubic-bezier(0.2,0.8,0.2,1)] [transition-duration:var(--duration-standard)]',
          collapsed ? 'w-[64px]' : 'w-[210px]',
        )}
      >
        <NavList entries={entries} top={desktopTop} collapsed={collapsed} />
        <CollapseToggle collapsed={collapsed} onToggle={onToggleCollapse} />
        {!collapsed && <SidebarLegalFooter />}
      </aside>

      {/* Mobile drawer. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-ink-100/40"
            onClick={onMobileClose}
          />
          <aside className="absolute inset-y-0 left-0 flex w-[260px] flex-col border-r border-[color:var(--color-border-hairline)] bg-paper py-5 shadow-3">
            <div className="mb-2 flex items-center gap-1 pr-2">
              <div className="min-w-0 flex-1">{mobileTop}</div>
              <button
                onClick={onMobileClose}
                aria-label="Close menu"
                className="shrink-0 rounded-[var(--radius-sm)] p-1 text-ink-60 hover:bg-inset"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList entries={entries} />
            <SidebarLegalFooter />
          </aside>
        </div>
      )}
    </>
  );
}
