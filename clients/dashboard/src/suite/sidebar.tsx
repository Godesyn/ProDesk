/* Prodesk Master App — dark icon rail (the suite spine). Holds the apps you've
   pinned, the active-brand switcher, search, and the collapse affordance. */

import { useEffect, useState } from 'react';
import { Icon, WordmarkTile } from './icons';
import { Wordmark } from './ui';
import { BrandSwitcher } from './shell';
import { isAppLive } from './flags';
import type { Brand, SuiteApp } from './data';

function RailApp({
  app,
  active,
  collapsed,
  onClick,
  onUnpin,
}: {
  app: SuiteApp;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
  onUnpin?: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const sz = collapsed ? 48 : 40;
  const later = !isAppLive(app.id);
  const isMono = later || !!app.comingSoon;
  return (
    <div
      onMouseEnter={(e) => {
        setRect(e.currentTarget.getBoundingClientRect());
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={app.name}
        aria-current={active ? 'page' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          width: '100%',
          textAlign: 'left',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '4px 0' : '5px 8px',
          background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
          border: '1px solid',
          borderColor: active ? 'rgba(255,255,255,0.14)' : 'transparent',
          borderRadius: 14,
          cursor: 'pointer',
          transition: 'background var(--dur) var(--ease)',
        }}
        onMouseOver={(e) => {
          if (!active)
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseOut={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            borderRadius: 13,
            boxShadow: active ? '0 0 0 2px var(--volt)' : 'none',
            filter: isMono ? 'grayscale(1)' : 'none',
            opacity: isMono ? 0.45 : 1,
          }}
        >
          <WordmarkTile app={app} size={sz} radius={13} />
        </span>
        {!collapsed && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 14,
              fontWeight: active ? 600 : 500,
              color: active ? '#FBFAF4' : '#E4E2D8',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {app.name}
          </span>
        )}
      </button>

      {collapsed && hover && rect && (
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            left: rect.right + 12,
            top: rect.top + rect.height / 2,
            transform: 'translateY(-50%)',
            zIndex: 200,
            background: 'var(--ink)',
            color: '#FBFAF4',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 7,
            padding: '7px 11px',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-drawer)',
            pointerEvents: 'none',
          }}
        >
          {app.name}
        </span>
      )}
      {!collapsed && hover && onUnpin && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onUnpin(app.id);
          }}
          title="Remove from sidebar"
          aria-label={'Remove ' + app.name + ' from sidebar'}
          style={{
            position: 'absolute',
            right: 6,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 22,
            height: 22,
            borderRadius: 5,
            border: 'none',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.10)',
            color: '#9a9a90',
          }}
        >
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );
}

function RailSys({
  name,
  icon,
  active,
  collapsed,
  onClick,
}: {
  name: string;
  icon: string;
  active?: boolean;
  collapsed: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  return (
    <div
      onMouseEnter={(e) => {
        setRect(e.currentTarget.getBoundingClientRect());
        setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
      style={{ position: 'relative' }}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={name}
        aria-current={active ? 'page' : undefined}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          width: '100%',
          textAlign: 'left',
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '10px 0' : '9px 10px',
          background: active ? 'rgba(255,255,255,0.10)' : 'transparent',
          border: '1px solid',
          borderColor: active ? 'rgba(255,255,255,0.14)' : 'transparent',
          borderRadius: 'var(--r-2)',
          cursor: 'pointer',
          color: active ? '#FBFAF4' : '#9a9a90',
          transition: 'background var(--dur) var(--ease)',
        }}
        onMouseOver={(e) => {
          if (!active)
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onMouseOut={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        <Icon name={icon} size={20} stroke={1.9} style={{ flexShrink: 0 }} />
        {!collapsed && (
          <span
            style={{ flex: 1, fontSize: 13.5, fontWeight: active ? 600 : 500 }}
          >
            {name}
          </span>
        )}
      </button>
      {collapsed && hover && rect && (
        <span
          role="tooltip"
          style={{
            position: 'fixed',
            left: rect.right + 12,
            top: rect.top + rect.height / 2,
            transform: 'translateY(-50%)',
            zIndex: 200,
            background: 'var(--ink)',
            color: '#FBFAF4',
            border: '1px solid rgba(255,255,255,0.16)',
            borderRadius: 7,
            padding: '7px 11px',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            boxShadow: 'var(--shadow-drawer)',
            pointerEvents: 'none',
          }}
        >
          {name}
        </span>
      )}
    </div>
  );
}

export interface SidebarProps {
  apps: SuiteApp[];
  brand: Brand;
  brands: Brand[];
  entitledIds: string[];
  view: string;
  openAppId: string | null;
  pinnedIds: string[];
  collapsed: boolean;
  switcherOpen: boolean;
  onToggleSwitcher: () => void;
  closeSwitcher: () => void;
  onPickBrand: (id: string) => void;
  onOpenApp: (a: SuiteApp) => void;
  onUnlock: (a: SuiteApp) => void;
  onHome: () => void;
  onAddBrand: () => void;
  onTogglePin: (id: string) => void;
  onOpenPalette: () => void;
  onToggleCollapse: () => void;
  onSupport: () => void;
}

export function Sidebar(props: SidebarProps) {
  const {
    apps,
    brand,
    brands,
    entitledIds,
    view,
    openAppId,
    pinnedIds,
    collapsed,
    switcherOpen,
    onToggleSwitcher,
    closeSwitcher,
    onPickBrand,
    onOpenApp,
    onUnlock,
    onHome,
    onAddBrand,
    onTogglePin,
    onOpenPalette,
    onToggleCollapse,
    onSupport,
  } = props;
  const [brandHover, setBrandHover] = useState(false);
  // Opening the switcher (and picking a brand from it) moves the pointer onto
  // the popover, so the brand button never receives a mouseleave — leaving
  // brandHover stuck true. Once the switcher closes, that stale flag would show
  // the collapsed tooltip and keep it there until the next mouse move. Clear the
  // hover whenever the switcher is open so the tooltip only returns on a genuine
  // re-hover of the button.
  useEffect(() => {
    if (switcherOpen) setBrandHover(false);
  }, [switcherOpen]);
  // Track the logo URL that failed to load (keyed by URL so switching brands re-attempts).
  const [failedLogo, setFailedLogo] = useState<string | null>(null);

  const BrandTile = ({ size, radius }: { size: number; radius: number }) => {
    // Show the brand's uploaded logo (the "favicon") when set — this is what
    // appears in the collapsed rail. Fall back to the colour + mono tile.
    if (brand.logo && failedLogo !== brand.logo) {
      return (
        <img
          src={brand.logo}
          alt=""
          loading="eager"
          onError={() => setFailedLogo(brand.logo ?? null)}
          style={{
            width: size,
            height: size,
            borderRadius: radius,
            objectFit: 'cover',
            flexShrink: 0,
            display: 'block',
          }}
        />
      );
    }
    const h = (brand.colour || '#0E0E0C').replace('#', '');
    const L =
      (0.299 * parseInt(h.substr(0, 2), 16) +
        0.587 * parseInt(h.substr(2, 2), 16) +
        0.114 * parseInt(h.substr(4, 2), 16)) /
      255;
    return (
      <span
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          background: brand.colour || 'var(--ink)',
          color: L > 0.62 ? '#0E0E0C' : '#FBFAF4',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            fontWeight: 800,
            fontSize: Math.round(size * 0.34),
            letterSpacing: '0.01em',
            lineHeight: 1,
          }}
        >
          {brand.mono}
        </span>
      </span>
    );
  };

  /* Pins persist in localStorage, so an app that has since been un-graduated in
     flags.ts would otherwise linger in the rail — filter on isAppLive too. */
  const pinned = pinnedIds
    .map((id) => apps.find((a) => a.id === id))
    .filter((a): a is SuiteApp => !!a && isAppLive(a.id));

  return (
    <aside
      className="pd-sidebar pd-rail"
      style={{
        position: 'relative',
        width: collapsed ? 72 : 232,
        background: 'var(--ink)',
        borderRight: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <button
        type="button"
        onClick={onToggleCollapse}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand' : 'Collapse'}
        style={{
          position: 'absolute',
          top: 74,
          right: -11,
          // Above the page content it overhangs, but below dialogs (Radix z-50).
          zIndex: 40,
          width: 22,
          height: 22,
          borderRadius: '50%',
          border: '1px solid var(--rule)',
          background: 'var(--white)',
          color: 'var(--ink)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: 'var(--shadow-row)',
        }}
      >
        <Icon
          name="chevronRight"
          size={14}
          style={{ transform: collapsed ? 'none' : 'scaleX(-1)' }}
        />
      </button>

      <div
        style={{
          padding: collapsed ? '16px 0 10px' : '16px 12px 10px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: collapsed ? 'center' : 'stretch',
          gap: 12,
        }}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onHome}
            title="Prodesk — home"
            aria-label="Home"
            style={{
              width: 48,
              height: 48,
              borderRadius: 13,
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              overflow: 'hidden',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/favicon.png"
              alt="Prodesk"
              width={48}
              height={48}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                display: 'block',
              }}
            />
          </button>
        ) : (
          <div style={{ padding: '2px 4px' }}>
            <Wordmark onClick={onHome} onInk height={20} />
          </div>
        )}

        <div
          style={{ position: 'relative' }}
          onMouseEnter={() => setBrandHover(true)}
          onMouseLeave={() => setBrandHover(false)}
        >
          <button
            type="button"
            onClick={onToggleSwitcher}
            aria-haspopup="dialog"
            aria-expanded={switcherOpen}
            aria-label={'Switch brand — ' + brand.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              justifyContent: collapsed ? 'center' : 'flex-start',
              background: switcherOpen
                ? 'rgba(255,255,255,0.10)'
                : 'transparent',
              border: '1px solid',
              borderColor: switcherOpen
                ? 'rgba(255,255,255,0.14)'
                : 'transparent',
              borderRadius: 14,
              padding: collapsed ? '4px 0' : '5px 8px',
              cursor: 'pointer',
              transition: 'background var(--dur) var(--ease)',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.10)';
            }}
            onMouseOut={(e) => {
              if (!switcherOpen)
                e.currentTarget.style.background = 'transparent';
            }}
          >
            <BrandTile size={collapsed ? 48 : 40} radius={13} />
            {!collapsed && (
              <>
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 13,
                      fontWeight: 700,
                      color: '#FBFAF4',
                      lineHeight: 1.2,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {brand.name}
                  </span>
                  <span
                    className="eyebrow"
                    style={{
                      display: 'block',
                      fontSize: 9.5,
                      lineHeight: 1.3,
                      color: '#8E8E84',
                    }}
                  >
                    Active brand
                  </span>
                </span>
                <Icon
                  name="chevron"
                  size={15}
                  style={{
                    color: '#9a9a90',
                    flexShrink: 0,
                    transform: switcherOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--dur) var(--ease)',
                  }}
                />
              </>
            )}
          </button>
          {collapsed && brandHover && !switcherOpen && (
            <span
              role="tooltip"
              style={{
                position: 'absolute',
                left: 'calc(100% + 12px)',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 200,
                background: 'var(--ink)',
                color: '#FBFAF4',
                border: '1px solid rgba(255,255,255,0.16)',
                borderRadius: 7,
                padding: '7px 11px',
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                boxShadow: 'var(--shadow-drawer)',
                pointerEvents: 'none',
              }}
            >
              {brand.name} · switch brand
            </span>
          )}
          <BrandSwitcher
            open={switcherOpen}
            brands={brands}
            activeBrandId={brand.id}
            anchor="side"
            onPick={onPickBrand}
            onClose={closeSwitcher}
            onAddBrand={onAddBrand}
          />
        </div>

        <button
          type="button"
          onClick={onOpenPalette}
          title="Search (Cmd K)"
          aria-label="Open command palette"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: '100%',
            justifyContent: collapsed ? 'center' : 'space-between',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: 'var(--r-2)',
            padding: collapsed ? '9px 0' : '8px 10px',
            cursor: 'pointer',
            color: '#9a9a90',
          }}
        >
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <Icon name="search" size={16} />
            {!collapsed && <span style={{ fontSize: 13 }}>Search</span>}
          </span>
          {!collapsed && (
            <span
              className="mono"
              style={{
                fontSize: 11,
                color: '#9a9a90',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              ⌘K
            </span>
          )}
        </button>
      </div>

      <nav className="pd-sb-nav" style={{ padding: '0 12px' }}>
        <RailSys
          name="Dashboard"
          icon="grid"
          active={view === 'launcher'}
          collapsed={collapsed}
          onClick={onHome}
        />

        <div style={{ marginTop: collapsed ? 8 : 14 }}>
          {!collapsed ? (
            <div
              className="eyebrow"
              style={{ fontSize: 10, padding: '0 10px 6px', color: '#8E8E84' }}
            >
              Your apps
            </div>
          ) : (
            <div
              style={{
                height: 1,
                background: 'rgba(255,255,255,0.10)',
                margin: '0 14px 8px',
              }}
            />
          )}
          {pinned.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {pinned.map((app) => (
                <RailApp
                  key={app.id}
                  app={app}
                  collapsed={collapsed}
                  active={view === 'app' && openAppId === app.id}
                  onClick={() =>
                    entitledIds.includes(app.id)
                      ? onOpenApp(app)
                      : onUnlock(app)
                  }
                  onUnpin={onTogglePin}
                />
              ))}
            </div>
          ) : !collapsed ? (
            <p
              style={{
                margin: '2px 10px',
                fontSize: 12,
                lineHeight: 1.4,
                color: '#7a7a72',
              }}
            >
              No apps added yet. Open the dashboard and add the ones you use —
              they&rsquo;ll live here.
            </p>
          ) : (
            <button
              type="button"
              onClick={onHome}
              title="Add apps"
              aria-label="Add apps"
              style={{
                width: 48,
                height: 48,
                margin: '0 auto',
                borderRadius: 13,
                cursor: 'pointer',
                border: '1px dashed rgba(255,255,255,0.22)',
                background: 'transparent',
                color: '#7a7a72',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="plus" size={18} />
            </button>
          )}
        </div>
      </nav>

      <div
        style={{
          marginTop: 'auto',
          padding: '10px 12px 14px',
          borderTop: '1px solid rgba(255,255,255,0.10)',
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
        }}
      >
        <RailSys
          name="Add brand"
          icon="plus"
          collapsed={collapsed}
          onClick={onAddBrand}
        />
        <RailSys
          name="Support"
          icon="lifebuoy"
          collapsed={collapsed}
          onClick={onSupport}
        />
        <button
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand' : 'Collapse'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            width: '100%',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '9px 0' : '8px 10px',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--r-2)',
            cursor: 'pointer',
            color: '#9a9a90',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <Icon
            name="collapse"
            size={18}
            style={{ transform: collapsed ? 'scaleX(-1)' : 'none' }}
          />
          {!collapsed && (
            <span style={{ fontSize: 13, fontWeight: 500 }}>Collapse</span>
          )}
        </button>
      </div>
    </aside>
  );
}
