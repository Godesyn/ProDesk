/* Prodesk Suite — Command palette (Cmd/Ctrl + K). Jump to any app, switch brand,
   or run an action. Full keyboard control. */

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { Icon } from './icons';
import { BrandMark } from './ui';
import { isAppLive } from './flags';
import type { Brand, SuiteApp } from './data';

type Result = {
  group: string;
  label: string;
  sublabel?: string;
  icon?: string;
  mono?: string;
  logo?: string;
  locked?: boolean;
  run: () => void;
};

export interface CommandPaletteProps {
  open: boolean;
  apps: SuiteApp[];
  brands: Brand[];
  entitledIds: string[];
  onClose: () => void;
  onOpenApp: (a: SuiteApp) => void;
  onUnlock: (a: SuiteApp) => void;
  onPickBrand: (id: string) => void;
  onHome: () => void;
  onAddBrand: () => void;
  onSettings: () => void;
  onTeam: () => void;
}

export function CommandPalette({
  open,
  apps,
  brands,
  entitledIds,
  onClose,
  onOpenApp,
  onUnlock,
  onPickBrand,
  onHome,
  onAddBrand,
  onSettings,
  onTeam,
}: CommandPaletteProps) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setSel(0);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const ql = q.toLowerCase().trim();
    const hit = (s: string) => !ql || s.toLowerCase().includes(ql);
    const wrap = (fn: () => void) => () => {
      fn();
      onClose();
    };
    const appRes: Result[] = apps
      .filter(
        (a) =>
          isAppLive(a.id) &&
          (hit(a.name) || (a.tags || []).some((t) => hit(t))),
      )
      .map((a) => {
        const locked = !entitledIds.includes(a.id);
        return {
          group: 'Apps',
          label: a.name,
          icon: a.icon,
          locked,
          run: wrap(() => (locked ? onUnlock(a) : onOpenApp(a))),
        };
      });
    const brandRes: Result[] = brands
      .filter((b) => hit(b.name) || hit(b.type))
      .map((b) => ({
        group: 'Brands',
        label: b.name,
        sublabel: b.type,
        mono: b.mono,
        logo: b.logo,
        run: wrap(() => onPickBrand(b.id)),
      }));
    const actionRes: Result[] = [
      {
        group: 'Actions',
        label: 'Go to home',
        icon: 'grid',
        run: wrap(onHome),
      },
      {
        group: 'Actions',
        label: 'Add brand',
        icon: 'plus',
        run: wrap(onAddBrand),
      },
      {
        group: 'Actions',
        label: 'Account settings',
        icon: 'settings',
        run: wrap(onSettings),
      },
      { group: 'Actions', label: 'Team', icon: 'team', run: wrap(onTeam) },
    ].filter((a) => hit(a.label));
    return [...appRes, ...brandRes, ...actionRes];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, apps, brands, entitledIds]);

  useEffect(() => {
    setSel(0);
  }, [q]);
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${sel}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      const pr = listRef.current.getBoundingClientRect();
      if (r.bottom > pr.bottom)
        listRef.current.scrollTop += r.bottom - pr.bottom + 8;
      if (r.top < pr.top) listRef.current.scrollTop -= pr.top - r.top + 8;
    }
  }, [sel]);

  if (!open) return null;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[sel] && results[sel].run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup: string | null = null;
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        background: 'rgba(14,14,12,0.18)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        style={{
          width: 'min(580px, calc(100vw - 32px))',
          maxHeight: '70vh',
          background: 'var(--white)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 16px',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <Icon
            name="search"
            size={18}
            style={{ color: 'var(--ink-3)', flexShrink: 0 }}
          />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search apps, brands and actions"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: 'var(--font)',
              fontSize: 15,
              color: 'var(--ink)',
            }}
          />
          <span
            className="mono"
            style={{
              fontSize: 11,
              color: 'var(--ink-3)',
              border: '1px solid var(--rule-2)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            ESC
          </span>
        </div>
        <div ref={listRef} style={{ overflowY: 'auto', padding: 8 }}>
          {results.length === 0 && (
            <div
              style={{
                padding: '28px 16px',
                textAlign: 'center',
                color: 'var(--ink-3)',
                fontSize: 14,
              }}
            >
              No matches for &ldquo;{q}&rdquo;.
            </div>
          )}
          {results.map((r, i) => {
            const showHeader = r.group !== lastGroup;
            lastGroup = r.group;
            const active = i === sel;
            return (
              <Fragment key={r.group + r.label}>
                {showHeader && (
                  <div
                    className="eyebrow"
                    style={{
                      fontSize: 10,
                      padding: '10px 10px 4px',
                      color: 'var(--ink-3)',
                    }}
                  >
                    {r.group}
                  </div>
                )}
                <button
                  type="button"
                  data-idx={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={r.run}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    textAlign: 'left',
                    background: active ? 'var(--paper-2)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--r-2)',
                    padding: '9px 10px',
                    cursor: 'pointer',
                    color: r.locked ? 'var(--ink-3)' : 'var(--ink)',
                  }}
                >
                  {r.mono ? (
                    <BrandMark mono={r.mono} logo={r.logo} size={26} />
                  ) : (
                    <span
                      style={{
                        width: 26,
                        display: 'inline-flex',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Icon name={r.icon || 'grid'} size={18} stroke={1.9} />
                    </span>
                  )}
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 14,
                        fontWeight: 500,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.label}
                    </span>
                    {r.sublabel && (
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--ink-3)',
                        }}
                      >
                        {r.sublabel}
                      </span>
                    )}
                  </span>
                  {r.locked && (
                    <Icon
                      name="lock"
                      size={14}
                      style={{ color: 'var(--ink-3)' }}
                    />
                  )}
                  {active && (
                    <Icon
                      name="arrowRight"
                      size={15}
                      style={{ color: 'var(--ink-3)' }}
                    />
                  )}
                </button>
              </Fragment>
            );
          })}
        </div>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '8px 14px',
            display: 'flex',
            gap: 16,
            color: 'var(--ink-3)',
            fontSize: 11,
          }}
        >
          <span className="mono">↑↓ move</span>
          <span className="mono">↵ open</span>
          <span className="mono">esc close</span>
        </div>
      </div>
    </div>
  );
}
