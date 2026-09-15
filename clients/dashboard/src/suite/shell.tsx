/* Prodesk Suite — shell: top bar, brand switcher, account menu, personal apps. */

import { useState } from 'react';
import { Icon, WordmarkTile } from './icons';
import { Avatar, BrandMark, Field, Scrim, Wordmark, useIsMobile } from './ui';
import { isFeatureLive } from './flags';
import {
  PERSONAL,
  type Brand,
  type SuiteApp,
  type Vendor,
  type PersonalApp,
} from './data';

/* ============ BRAND SWITCHER ============ */
function BrandList({
  brands,
  activeBrandId,
  onPick,
  onAddBrand,
  autoFocusSearch,
}: {
  brands: Brand[];
  activeBrandId: string;
  onPick: (id: string) => void;
  onAddBrand: () => void;
  autoFocusSearch: boolean;
}) {
  const [q, setQ] = useState('');
  const showSearch = brands.length > 8;
  const filtered = brands.filter((b) =>
    b.name.toLowerCase().includes(q.toLowerCase().trim()),
  );
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        flex: 1,
      }}
    >
      <div
        style={{
          padding: '10px 12px 8px',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <div className="eyebrow" style={{ padding: '2px 4px 8px' }}>
          Your brands · {brands.length}
        </div>
        {showSearch && (
          <Field
            id="brand-search"
            value={q}
            onChange={setQ}
            placeholder="Search brands"
            leftIcon="search"
            autoFocus={autoFocusSearch}
          />
        )}
      </div>
      <div style={{ overflowY: 'auto', padding: 6, flex: 1, minHeight: 0 }}>
        {filtered.length === 0 && (
          <div
            style={{
              padding: '20px 12px',
              color: 'var(--ink-3)',
              fontSize: 13,
            }}
          >
            No brands match &ldquo;{q}&rdquo;.
          </div>
        )}
        {filtered.map((b) => {
          const active = b.id === activeBrandId;
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => onPick(b.id)}
              className="pd-row"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                textAlign: 'left',
                background: active ? 'var(--paper-2)' : 'transparent',
                border: 'none',
                padding: '9px 10px',
                borderRadius: 'var(--r-2)',
                cursor: 'pointer',
              }}
            >
              <BrandMark mono={b.mono} logo={b.logo} size={28} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    color: 'var(--ink)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.name}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: 'var(--ink-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {b.type}
                </span>
              </span>
              {active && (
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'var(--volt)',
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon
                    name="check"
                    size={14}
                    style={{ color: 'var(--ink)' }}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ borderTop: '1px solid var(--rule)', padding: 6 }}>
        <button
          type="button"
          onClick={onAddBrand}
          className="pd-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            padding: '10px',
            borderRadius: 'var(--r-2)',
            cursor: 'pointer',
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 'var(--r-2)',
              border: '1px dashed var(--ink-3)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-2)',
            }}
          >
            <Icon name="plus" size={16} />
          </span>
          <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>
            Add brand
          </span>
        </button>
      </div>
    </div>
  );
}

export function BrandSwitcher({
  open,
  brands,
  activeBrandId,
  onPick,
  onClose,
  onAddBrand,
  anchor,
}: {
  open: boolean;
  brands: Brand[];
  activeBrandId: string;
  onPick: (id: string) => void;
  onClose: () => void;
  onAddBrand: () => void;
  anchor?: 'side';
}) {
  const isMobile = useIsMobile();
  if (!open) return null;
  if (isMobile) {
    return (
      <Scrim onClick={onClose} align="right">
        <div
          role="dialog"
          aria-label="Switch brand"
          style={{
            width: 'min(380px, 92vw)',
            height: '100%',
            background: 'var(--white)',
            boxShadow: 'var(--shadow-drawer)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'pd-slide-right var(--dur) var(--ease)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderBottom: '1px solid var(--rule)',
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 16 }}>Switch brand</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pd-icon-btn"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
          <BrandList
            brands={brands}
            activeBrandId={activeBrandId}
            onPick={onPick}
            onAddBrand={onAddBrand}
            autoFocusSearch={false}
          />
        </div>
      </Scrim>
    );
  }
  return (
    <>
      <div
        onMouseDown={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 90 }}
      />
      <div
        role="dialog"
        aria-label="Switch brand"
        style={{
          position: 'absolute',
          zIndex: 100,
          ...(anchor === 'side'
            ? { left: 'calc(100% + 12px)', top: 0 }
            : { top: 'calc(100% + 6px)', left: 0 }),
          width: 320,
          maxHeight: 'min(70vh, 540px)',
          background: 'var(--white)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <BrandList
          brands={brands}
          activeBrandId={activeBrandId}
          onPick={onPick}
          onAddBrand={onAddBrand}
          autoFocusSearch={brands.length > 8}
        />
      </div>
    </>
  );
}

/* ============ ACCOUNT MENU ============ */
export function AccountMenu({
  open,
  vendor,
  onClose,
  onItem,
}: {
  open: boolean;
  vendor: Vendor;
  onClose: () => void;
  onItem: (key: string) => void;
}) {
  if (!open) return null;
  const items = [
    { key: 'settings', label: 'Account settings', icon: 'settings' },
    { key: 'team', label: 'Team', icon: 'team', meta: `${vendor.team} people` },
    { key: 'billing', label: 'Billing', icon: 'billing' },
  ];
  return (
    <>
      <div
        onMouseDown={onClose}
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
          width: 280,
          background: 'var(--white)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          overflow: 'hidden',
          animation: 'pd-rise var(--dur) var(--ease)',
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
        <div className="eyebrow" style={{ padding: '10px 16px 4px' }}>
          Account · sits above brands
        </div>
        <div style={{ padding: 6 }}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              onClick={() => onItem(it.key)}
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
                name={it.icon}
                size={18}
                style={{ color: 'var(--ink-2)' }}
              />
              <span style={{ flex: 1, fontSize: 14 }}>{it.label}</span>
              {it.meta && (
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {it.meta}
                </span>
              )}
            </button>
          ))}
        </div>
        <div style={{ borderTop: '1px solid var(--rule)', padding: 6 }}>
          <button
            type="button"
            onClick={() => onItem('logout')}
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
              color: 'var(--ink)',
            }}
          >
            <Icon name="logout" size={18} style={{ color: 'var(--ink-2)' }} />
            <span style={{ fontSize: 14 }}>Log out</span>
          </button>
        </div>
      </div>
    </>
  );
}

/* ============ PERSONAL APPS ============ */
function PersonalMenu({
  open,
  person,
  apps,
  onClose,
  onOpenApp,
}: {
  open: boolean;
  person: { name: string; initials: string };
  apps: PersonalApp[];
  onClose: () => void;
  onOpenApp: (a: PersonalApp) => void;
}) {
  if (!open) return null;
  return (
    <>
      <div
        onMouseDown={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 90 }}
      />
      <div
        role="menu"
        aria-label="Personal apps"
        style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          right: 0,
          zIndex: 100,
          width: 308,
          background: 'var(--white)',
          border: '1px solid var(--rule)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          overflow: 'hidden',
          animation: 'pd-rise var(--dur) var(--ease)',
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
          <span
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'var(--ink)',
              color: 'var(--paper)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 13,
              boxShadow: '0 0 0 2px var(--volt)',
            }}
          >
            {person.initials}
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="eyebrow" style={{ fontSize: 10, lineHeight: 1.3 }}>
              Personal
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {person.name}
            </div>
          </div>
        </div>
        <div
          style={{
            padding: '10px 16px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span className="eyebrow" style={{ fontSize: 10 }}>
            Your apps
          </span>
          <span style={{ flex: 1, height: 1, background: 'var(--rule)' }} />
          <span
            className="eyebrow"
            style={{ fontSize: 10, color: 'var(--ink-3)' }}
          >
            follows you
          </span>
        </div>
        <div style={{ padding: 6, maxHeight: '56vh', overflowY: 'auto' }}>
          {apps.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => a.live && onOpenApp(a)}
              className="pd-row"
              disabled={!a.live}
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
                cursor: a.live ? 'pointer' : 'default',
                opacity: a.live ? 1 : 0.5,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background:
                    a.id === 'aggyl' ? 'var(--ink)' : 'var(--paper-2)',
                  color: a.id === 'aggyl' ? 'var(--volt)' : 'var(--ink-2)',
                }}
              >
                <Icon name={a.icon} size={17} stroke={1.9} />
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: 'var(--ink)',
                    }}
                  >
                    {a.name}
                  </span>
                  {!a.live && (
                    <span
                      className="pd-kind-pill"
                      style={{ fontSize: 9, padding: '2px 6px' }}
                    >
                      Soon
                    </span>
                  )}
                </span>
                <span
                  style={{
                    display: 'block',
                    fontSize: 11.5,
                    color: 'var(--ink-3)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {a.tag}
                </span>
              </span>
              {a.live && a.meta && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    flexShrink: 0,
                    fontSize: 11.5,
                    color: 'var(--ink-2)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: 'var(--volt)',
                      boxShadow: '0 0 0 3px var(--volt-glow)',
                    }}
                  />
                  {a.meta}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

/* ============ TOP BAR ============ */
export interface TopBarProps {
  vendor: Vendor;
  activeBrand: Brand;
  brands: Brand[];
  navMode: 'sidebar' | 'home';
  onMenu: () => void;
  launchTab: string;
  inApp: boolean;
  openApp: SuiteApp | null;
  onTab: (t: string) => void;
  switcherOpen: boolean;
  accountOpen: boolean;
  onToggleSwitcher: () => void;
  onToggleAccount: () => void;
  onPickBrand: (id: string) => void;
  onAddBrand: () => void;
  onAccountItem: (key: string) => void;
  onHome: () => void;
  closeSwitcher: () => void;
  closeAccount: () => void;
  personalOpen: boolean;
  onTogglePersonal: () => void;
  closePersonal: () => void;
  onOpenPersonalApp: (a: PersonalApp) => void;
}

export function TopBar(props: TopBarProps) {
  const {
    vendor,
    activeBrand,
    brands,
    navMode,
    onMenu,
    launchTab,
    inApp,
    openApp,
    onTab,
    switcherOpen,
    accountOpen,
    onToggleSwitcher,
    onToggleAccount,
    onPickBrand,
    onAddBrand,
    onAccountItem,
    onHome,
    closeSwitcher,
    closeAccount,
    personalOpen,
    onTogglePersonal,
    closePersonal,
    onOpenPersonalApp,
  } = props;
  const isMobile = useIsMobile();
  const personal = PERSONAL;
  const hasLeading = navMode !== 'sidebar' || isMobile;
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        height: 'var(--topbar-h)',
        background: 'var(--paper)',
        borderBottom: '1px solid var(--rule)',
        display: 'flex',
        alignItems: 'center',
        padding: isMobile ? '0 12px' : '0 20px',
        gap: isMobile ? 8 : 14,
      }}
    >
      {navMode === 'sidebar' ? (
        isMobile ? (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="pd-icon-btn"
          >
            <Icon name="menu" size={20} />
          </button>
        ) : null
      ) : (
        <Wordmark onClick={onHome} height={isMobile ? 18 : 20} />
      )}
      {hasLeading && (
        <div
          style={{
            width: 1,
            height: 24,
            background: 'var(--rule)',
            flexShrink: 0,
          }}
        />
      )}

      {!(navMode === 'sidebar' && !isMobile) && (
        <div style={{ position: 'relative', flexShrink: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={onToggleSwitcher}
            aria-haspopup="dialog"
            aria-expanded={switcherOpen}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: isMobile ? 6 : 10,
              background: switcherOpen ? 'var(--paper-2)' : 'transparent',
              border: '1px solid',
              borderColor: switcherOpen ? 'var(--rule)' : 'transparent',
              borderRadius: 'var(--r-2)',
              padding: isMobile ? '6px 8px' : '7px 10px',
              cursor: 'pointer',
              maxWidth: isMobile ? 200 : 340,
              transition: 'background var(--dur) var(--ease)',
            }}
          >
            <BrandMark
              mono={activeBrand.mono}
              logo={activeBrand.logo}
              size={24}
            />
            {!isMobile && (
              <span style={{ minWidth: 0, textAlign: 'left' }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: 700,
                    color: 'var(--ink)',
                    lineHeight: 1.2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeBrand.name}
                </span>
                <span
                  className="eyebrow"
                  style={{ display: 'block', fontSize: 10, lineHeight: 1.3 }}
                >
                  Active brand
                </span>
              </span>
            )}
            <Icon
              name="chevron"
              size={16}
              style={{
                color: 'var(--ink-2)',
                flexShrink: 0,
                transform: switcherOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--dur) var(--ease)',
              }}
            />
          </button>
          <BrandSwitcher
            open={switcherOpen}
            brands={brands}
            activeBrandId={activeBrand.id}
            onPick={onPickBrand}
            onClose={closeSwitcher}
            onAddBrand={onAddBrand}
          />
        </div>
      )}

      {!isMobile && inApp && openApp ? (
        <div
          data-tool={openApp.tool}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
          }}
        >
          <button
            type="button"
            onClick={onHome}
            className="pd-crumb"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: 'none',
              color: 'var(--ink-3)',
              cursor: 'pointer',
              fontSize: 13,
              padding: '4px 0',
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name="grid" size={15} /> All apps
          </button>
          <span
            style={{
              width: 1,
              height: 20,
              background: 'var(--rule)',
              flexShrink: 0,
            }}
          />
          <WordmarkTile app={openApp} size={26} radius={7} />
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {openApp.name}
          </span>
          {openApp.brand && openApp.brand !== openApp.name && (
            <span className="pd-bychip">{openApp.brand}</span>
          )}
        </div>
      ) : !isMobile ? (
        <div className="pd-tabs" role="tablist" aria-label="Dashboard">
          <button
            type="button"
            role="tab"
            aria-selected={launchTab === 'health' && !inApp}
            className="pd-tab"
            data-on={launchTab === 'health' && !inApp}
            onClick={() => onTab('health')}
          >
            Business Health
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={launchTab === 'tools' && !inApp}
            className="pd-tab"
            data-on={launchTab === 'tools' && !inApp}
            onClick={() => onTab('tools')}
          >
            Power Tools
          </button>
        </div>
      ) : null}

      <div style={{ flex: 1 }} />

      {isFeatureLive('personalApps') && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            type="button"
            onClick={onTogglePersonal}
            aria-haspopup="menu"
            aria-expanded={personalOpen}
            title="Personal"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: personalOpen ? 'var(--paper-2)' : 'transparent',
              border: '1px solid',
              borderColor: personalOpen ? 'var(--rule)' : 'transparent',
              borderRadius: 'var(--r-2)',
              padding: '5px 6px',
              cursor: 'pointer',
              transition: 'background var(--dur) var(--ease)',
            }}
          >
            {!isMobile && (
              <span
                className="eyebrow"
                style={{ fontSize: 9.5, color: 'var(--ink-3)' }}
              >
                Personal
              </span>
            )}
            <span
              style={{
                position: 'relative',
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'var(--ink)',
                color: 'var(--paper)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: 12,
                boxShadow: '0 0 0 2px var(--volt)',
              }}
            >
              {personal.person.initials}
              <span
                style={{
                  position: 'absolute',
                  top: -2,
                  right: -2,
                  width: 9,
                  height: 9,
                  borderRadius: '50%',
                  background: 'var(--volt)',
                  border: '2px solid var(--paper)',
                }}
              />
            </span>
          </button>
          <PersonalMenu
            open={personalOpen}
            person={personal.person}
            apps={personal.apps}
            onClose={closePersonal}
            onOpenApp={onOpenPersonalApp}
          />
        </div>
      )}

      <div
        style={{
          width: 1,
          height: 24,
          background: 'var(--rule)',
          flexShrink: 0,
        }}
      />

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          type="button"
          onClick={onToggleAccount}
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: accountOpen ? 'var(--paper-2)' : 'transparent',
            border: '1px solid',
            borderColor: accountOpen ? 'var(--rule)' : 'transparent',
            borderRadius: 'var(--r-2)',
            padding: '5px 8px 5px 5px',
            cursor: 'pointer',
            transition: 'background var(--dur) var(--ease)',
          }}
        >
          <Avatar
            src={vendor.profileUrl}
            initials={vendor.initials}
            size={30}
            fontSize={12}
          />
          {!isMobile && (
            <Icon
              name="chevron"
              size={16}
              style={{
                color: 'var(--ink-2)',
                transform: accountOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--dur) var(--ease)',
              }}
            />
          )}
        </button>
        <AccountMenu
          open={accountOpen}
          vendor={vendor}
          onClose={closeAccount}
          onItem={onAccountItem}
        />
      </div>
    </header>
  );
}
