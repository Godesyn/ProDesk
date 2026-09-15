/* Prodesk Suite — Launcher (command centre): Business Health + Power Tools.
   Power Tools is the dense app springboard with a search + tag filter bar. */

import { useState } from 'react';
import { Icon, WordmarkTile } from './icons';
import { Button, Skeleton } from './ui';
import { isAppLive, isFeatureLive } from './flags';
import { TAGS, type Brand, type SuiteApp } from './data';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function fmtDate(): string {
  try {
    return new Date()
      .toLocaleDateString('en-AU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })
      .toUpperCase();
  } catch {
    return 'TODAY';
  }
}

/* ---- large wordmark app card (Power Tools springboard) ---- */
function AppGridCard({
  app,
  status,
  locked,
  pinned,
  onOpen,
  onTogglePin,
}: {
  app: SuiteApp;
  status?: string;
  locked: boolean;
  pinned?: boolean;
  onOpen: () => void;
  onTogglePin?: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  // "Later" = not yet graduated in flags.ts LIVE_APPS — the single source of
  // truth for what's live. (The grid is already filtered to live apps, so this
  // only fades anything shown with HIDE_WIP off.)
  const later = !isAppLive(app.id);
  const isMono = later || !!app.comingSoon;
  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        type="button"
        onClick={onOpen}
        className="pd-card pd-app-tile"
        title={app.tag + (later ? ' — later tranche' : app.comingSoon ? ' — coming soon' : '')}
        aria-label={
          app.name +
          (locked ? ' (locked)' : '') +
          (later ? ' (later tranche)' : app.comingSoon ? ' (coming soon)' : '')
        }
        style={{ opacity: locked || app.comingSoon ? 0.6 : 1 }}
      >
        <span
          style={{
            position: 'relative',
            display: 'inline-flex',
            filter: isMono ? 'grayscale(1)' : 'none',
            opacity: isMono ? 0.38 : 1,
            transition:
              'filter var(--dur) var(--ease), opacity var(--dur) var(--ease)',
          }}
        >
          <WordmarkTile app={app} size={76} />
          {locked ? (
            <span
              style={{
                position: 'absolute',
                right: -4,
                bottom: -4,
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: 'var(--white)',
                border: '1px solid var(--rule-2)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--ink-3)',
              }}
            >
              <Icon name="lock" size={12} />
            </span>
          ) : status ? (
            <span
              style={{
                position: 'absolute',
                right: -2,
                top: -2,
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: 'var(--volt)',
                border: '2px solid var(--white)',
              }}
              title={status}
            />
          ) : null}
        </span>
        <span
          className="pd-card-name"
          style={later || app.comingSoon ? { color: 'var(--ink-3)' } : undefined}
        >
          {app.name}
        </span>
        {app.comingSoon && (
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-3)',
              border: '1px solid var(--rule-2)',
              borderRadius: 4,
              padding: '2px 7px',
              background: 'var(--white)',
            }}
          >
            Coming soon
          </span>
        )}
        {app.build && (
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-2)',
              border: '1px solid var(--rule-2)',
              borderRadius: 4,
              padding: '2px 7px',
              background: 'var(--white)',
            }}
          >
            Next build
          </span>
        )}
      </button>
      {onTogglePin && (hover || pinned) && (
        <button
          type="button"
          onClick={() => onTogglePin(app.id)}
          title={pinned ? 'Remove from sidebar' : 'Add to sidebar'}
          aria-label={
            pinned
              ? 'Remove ' + app.name + ' from sidebar'
              : 'Add ' + app.name + ' to sidebar'
          }
          style={{
            position: 'absolute',
            top: 10,
            right: 12,
            width: 26,
            height: 26,
            borderRadius: 7,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid',
            borderColor: pinned ? 'var(--ink)' : 'var(--rule-2)',
            background: pinned ? 'var(--ink)' : 'var(--white)',
            color: pinned ? 'var(--volt)' : 'var(--ink-3)',
            boxShadow: 'var(--shadow-row)',
          }}
        >
          <Icon name="pin" size={14} />
        </button>
      )}
    </div>
  );
}

/* ---- filter bar: text search + tag chips ---- */
function TagChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className="pd-tag"
      aria-pressed={on}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: on ? 'var(--ink)' : 'var(--white)',
        color: on ? 'var(--paper)' : hover ? 'var(--ink)' : 'var(--ink-2)',
        borderColor: on ? 'var(--ink)' : hover ? 'var(--ink)' : 'var(--rule-2)',
      }}
    >
      {label}
    </button>
  );
}

function FilterBar({
  query,
  setQuery,
  activeTag,
  setActiveTag,
  tags,
}: {
  query: string;
  setQuery: (v: string) => void;
  activeTag: string | null;
  setActiveTag: (v: string | null) => void;
  tags: string[];
}) {
  return (
    <div className="pd-filterbar">
      <div className="pd-find">
        <Icon
          name="search"
          size={16}
          style={{ color: 'var(--ink-3)', flexShrink: 0 }}
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an app"
          aria-label="Find an app"
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            flex: 1,
            fontFamily: 'var(--font)',
            fontSize: 14,
            color: 'var(--ink)',
            minWidth: 0,
          }}
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--ink-3)',
              display: 'inline-flex',
              padding: 2,
            }}
          >
            <Icon name="close" size={14} />
          </button>
        )}
      </div>
      <div className="pd-tagrow" role="group" aria-label="Filter by tag">
        <TagChip
          label="All"
          on={activeTag === null}
          onClick={() => setActiveTag(null)}
        />
        {tags.map((t) => (
          <TagChip
            key={t}
            label={t}
            on={activeTag === t}
            onClick={() => setActiveTag(activeTag === t ? null : t)}
          />
        ))}
      </div>
    </div>
  );
}

export interface HealthStats {
  activeProjects: number;
  connectedAgencies: number;
  teamMembers: number;
  pendingActions: number;
}

export interface LauncherProps {
  apps: SuiteApp[];
  groups: string[];
  brand: Brand;
  entitledIds: string[];
  loadState: 'ready' | 'loading' | 'error';
  tab?: string;
  onOpenApp: (a: SuiteApp) => void;
  onUnlock: (a: SuiteApp) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onGoTools: () => void;
  liveStatus?: Record<string, string>;
  healthStats?: HealthStats | null;
}

const HEALTH_KPIS: { key: keyof HealthStats; label: string }[] = [
  { key: 'activeProjects', label: 'Active projects' },
  { key: 'pendingActions', label: 'Need your action' },
  { key: 'teamMembers', label: 'Team members' },
  { key: 'connectedAgencies', label: 'Connected agencies' },
];

export function Launcher({
  apps,
  groups,
  brand,
  entitledIds,
  loadState,
  tab = 'health',
  onOpenApp,
  onUnlock,
  pinnedIds,
  onTogglePin,
  onGoTools,
  liveStatus = {},
  healthStats = null,
}: LauncherProps) {
  const [query, setQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);

  if (loadState === 'loading') {
    return (
      <main className="pd-page">
        <header style={{ marginBottom: 32 }}>
          <Skeleton w={220} h={12} style={{ marginBottom: 16 }} />
          <Skeleton w="46%" h={44} r={8} />
        </header>
        <div className="pd-app-grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} w="100%" h={120} r={14} />
          ))}
        </div>
      </main>
    );
  }
  if (loadState === 'error') {
    return (
      <main className="pd-page">
        <div
          style={{ maxWidth: 420, margin: '80px auto', textAlign: 'center' }}
        >
          <Icon name="warning" size={28} style={{ color: 'var(--ink-2)' }} />
          <h2 style={{ fontSize: 20, margin: '14px 0 6px' }}>
            {brand.name} did not load
          </h2>
          <p
            style={{ color: 'var(--ink-2)', fontSize: 14, margin: '0 0 18px' }}
          >
            Something did not click. Try again, or switch brand.
          </p>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (tab === 'tools') {
    return (
      <PowerTools
        apps={apps}
        groups={groups}
        brand={brand}
        entitledIds={entitledIds}
        query={query}
        setQuery={setQuery}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        onOpenApp={onOpenApp}
        onUnlock={onUnlock}
        pinnedIds={pinnedIds}
        onTogglePin={onTogglePin}
        liveStatus={liveStatus}
      />
    );
  }

  /* Business Health — live KPIs from the brand dashboard. */
  const hasStats =
    !!healthStats && HEALTH_KPIS.some((k) => (healthStats[k.key] ?? 0) > 0);
  return (
    <main className="pd-page">
      <header className="pd-launch-head">
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          {fmtDate()} · {brand.name}
        </div>
        <h1 className="pd-greet">
          {greeting()}. Let&rsquo;s get{' '}
          <span className="serif">{brand.name}</span> working.
        </h1>
      </header>

      {healthStats && (
        <div className="pd-metric-row" style={{ marginBottom: 28 }}>
          {HEALTH_KPIS.map((k) => (
            <div
              key={k.key}
              className="pd-metric"
              style={{ cursor: 'default' }}
            >
              <span
                className="eyebrow"
                style={{ color: 'var(--ink-2)', fontSize: 10 }}
              >
                {k.label}
              </span>
              <span
                className="tnum"
                style={{
                  fontSize: 38,
                  fontWeight: 800,
                  letterSpacing: '-0.04em',
                  lineHeight: 1,
                }}
              >
                {healthStats[k.key] ?? 0}
              </span>
            </div>
          ))}
        </div>
      )}

      {!hasStats && (
        <section
          style={{
            background: 'var(--white)',
            border: '1px solid var(--rule-2)',
            borderRadius: 'var(--r-3)',
            padding: '40px 32px',
            textAlign: 'center',
            maxWidth: 640,
            margin: '0 auto',
          }}
        >
          <div className="eyebrow" style={{ marginBottom: 14 }}>
            Business health
          </div>
          <h2
            style={{
              fontSize: 22,
              fontWeight: 700,
              margin: '0 0 10px',
              letterSpacing: '-0.01em',
            }}
          >
            Nothing to measure yet
          </h2>
          <p
            style={{
              margin: '0 auto 22px',
              fontSize: 14.5,
              lineHeight: 1.55,
              color: 'var(--ink-2)',
              maxWidth: 420,
              textWrap: 'pretty',
            }}
          >
            This page fills in as your brand gets going — projects, proposals,
            your team and the agencies you work with.
          </p>
          <button
            type="button"
            onClick={onGoTools}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 'none',
              borderRadius: 'var(--r-2)',
              padding: '11px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Browse power tools →
          </button>
        </section>
      )}
    </main>
  );
}

function PowerTools({
  apps,
  groups,
  brand,
  entitledIds,
  query,
  setQuery,
  activeTag,
  setActiveTag,
  onOpenApp,
  onUnlock,
  pinnedIds,
  onTogglePin,
  liveStatus,
}: {
  apps: SuiteApp[];
  groups: string[];
  brand: Brand;
  entitledIds: string[];
  query: string;
  setQuery: (v: string) => void;
  activeTag: string | null;
  setActiveTag: (v: string | null) => void;
  onOpenApp: (a: SuiteApp) => void;
  onUnlock: (a: SuiteApp) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  liveStatus: Record<string, string>;
}) {
  // Hide apps whose real screen isn't wired yet (gated by the WIP flag).
  const visibleApps = apps.filter((a) => isAppLive(a.id));
  const pinningLive = isFeatureLive('pinning');
  const ql = query.toLowerCase().trim();
  const matches = (a: SuiteApp) =>
    (!activeTag || (a.tags || []).includes(activeTag)) &&
    (!ql ||
      a.name.toLowerCase().includes(ql) ||
      (a.tag || '').toLowerCase().includes(ql) ||
      (a.tags || []).some((t) => t.toLowerCase().includes(ql)));

  const renderRow = (app: SuiteApp, i: number) => {
    const locked = !entitledIds.includes(app.id);
    return (
      <div
        key={app.id}
        className="pd-tile-in"
        style={{ animationDelay: i * 18 + 'ms' }}
      >
        <AppGridCard
          app={app}
          status={liveStatus[app.id] ?? brand.status[app.id]}
          locked={locked}
          pinned={pinnedIds.includes(app.id)}
          onTogglePin={pinningLive ? onTogglePin : undefined}
          onOpen={() => (locked ? onUnlock(app) : onOpenApp(app))}
        />
      </div>
    );
  };

  const sortApps = (list: SuiteApp[]) => [
    ...list.filter((a) => !a.comingSoon),
    ...list.filter((a) => a.comingSoon),
  ];

  const filtering = !!ql || !!activeTag;
  return (
    <main className="pd-page">
      <FilterBar
        query={query}
        setQuery={setQuery}
        activeTag={activeTag}
        setActiveTag={setActiveTag}
        tags={TAGS}
      />
      {filtering
        ? (() => {
            const found = sortApps(visibleApps.filter(matches));
            return (
              <section style={{ marginBottom: 28 }}>
                <div className="pd-section-head">
                  <h2
                    className="eyebrow"
                    style={{
                      margin: 0,
                      color: 'var(--ink)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activeTag || 'Results'}
                  </h2>
                  <span
                    className="eyebrow"
                    style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
                  >
                    {found.length} {found.length === 1 ? 'app' : 'apps'}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      height: 1,
                      background: 'var(--rule-2)',
                      marginLeft: 4,
                    }}
                  />
                </div>
                {found.length === 0 ? (
                  <div
                    style={{
                      padding: '40px 0',
                      textAlign: 'center',
                      color: 'var(--ink-3)',
                      fontSize: 14,
                    }}
                  >
                    No apps match.
                  </div>
                ) : (
                  <div className="pd-app-grid">
                    {found.map((a, i) => renderRow(a, i))}
                  </div>
                )}
              </section>
            );
          })()
        : (() => {
            let i = 0;
            return groups.map((group) => {
              const groupApps = sortApps(visibleApps.filter((a) => a.group === group));
              if (!groupApps.length) return null;
              return (
                <section key={group} style={{ marginBottom: 28 }}>
                  <div className="pd-section-head">
                    <h2
                      className="eyebrow"
                      style={{
                        margin: 0,
                        color: 'var(--ink)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {group}
                    </h2>
                    <span
                      className="eyebrow"
                      style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap' }}
                    >
                      {groupApps.length} apps
                    </span>
                    <span
                      style={{
                        flex: 1,
                        height: 1,
                        background: 'var(--rule-2)',
                        marginLeft: 4,
                      }}
                    />
                  </div>
                  <div className="pd-app-grid">
                    {groupApps.map((app) => renderRow(app, i++))}
                  </div>
                </section>
              );
            });
          })()}
    </main>
  );
}
