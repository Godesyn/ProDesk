/* Prodesk Suite — overlays + in-app shell: unlock drawer, add brand, app front-door. */

import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useLocation } from 'wouter';
import { signOut } from '@shared/auth/auth-context';
import { isProdeskOrigin, SUITE_MESSAGE, type SuiteMessage } from '@shared/lib/embed';
import { Icon, WordmarkTile } from './icons';
import { Button, Field, Scrim, pushToast } from './ui';
import {
  APPS,
  APP_BLURBS,
  CROSS_APP_HOSTS,
  type Brand,
  type SuiteApp,
} from './data';

// Tool interiors are code-split: each is a sizeable screen the user only reaches
// by opening that specific app, so it's loaded on demand rather than shipped in
// the initial bundle. (Named exports → default-shape adapter for React.lazy.)
const BrandKitTool = lazy(() => import('./brand').then((m) => ({ default: m.BrandKitTool })));
const PeopleTool = lazy(() => import('./people').then((m) => ({ default: m.PeopleTool })));
const CompanyTool = lazy(() => import('./company').then((m) => ({ default: m.CompanyTool })));
const ProductsTool = lazy(() => import('./products').then((m) => ({ default: m.ProductsTool })));
const StrategyTool = lazy(() => import('./strategy').then((m) => ({ default: m.StrategyTool })));
const DocumentsTool = lazy(() => import('./documents').then((m) => ({ default: m.DocumentsTool })));

/** Debounce a fast-changing value so we don't fire a query per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Lightweight placeholder shown while a code-split tool interior loads. */
function ToolFallback() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '40vh', color: 'var(--ink-3)', fontSize: 14 }}>
      Loading…
    </div>
  );
}

/* A deep link (e.g. /app/url-qr) to a standalone-frontend app: swap the URL for
   the launcher and open the app in the modal, same as a click. */
function CrossAppDeepLink({
  app,
  onOpenApp,
}: {
  app: SuiteApp;
  onOpenApp: (a: SuiteApp) => void;
}) {
  const [, navigate] = useLocation();
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return; // StrictMode re-runs effects: mint ONE token
    fired.current = true;
    navigate('/', { replace: true });
    onOpenApp(app);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/* ============ APP MODAL ============ */
/* A standalone-frontend app (CROSS_APP_HOSTS) shown over the dashboard in an
   iframe — the user never leaves the page. `url` is null while the session
   hand-off token is minted. The embedded app talks back via postMessage
   (@shared/lib/embed): its Prodesk Suite link, Esc and Sign out close the modal.
   ponytail: iframe of the standalone app; still needs each app hosted. Upgrade
   path = HANDOVER §9 merge (app mounted as a lazy component). */
export function AppModal({
  app,
  url,
  fullScreen,
  onClose,
}: {
  app: SuiteApp;
  url: string | null;
  fullScreen: boolean;
  onClose: () => void;
}) {
  const [, navigate] = useLocation();
  const [loaded, setLoaded] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus into the modal on open and back to the opener on close; the page
  // behind doesn't scroll meanwhile.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  // Only our own frontends, and only the frame we opened, may close the modal.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const msg = e.data as Partial<SuiteMessage> | null;
      if (
        e.source !== frameRef.current?.contentWindow ||
        !isProdeskOrigin(e.origin) ||
        msg?.type !== SUITE_MESSAGE
      )
        return;
      onClose();
      if (msg.action === 'signout') void signOut();
      else if (
        typeof msg.path === 'string' &&
        msg.path.startsWith('/') &&
        !msg.path.startsWith('//') &&
        msg.path !== '/'
      )
        navigate(msg.path);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onClose, navigate]);

  return (
    <Scrim blur onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={app.name}
        aria-busy={!loaded}
        style={{
          width: fullScreen ? '100vw' : 'min(1200px, 94vw)',
          height: fullScreen ? '100dvh' : '90dvh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--paper)',
          borderRadius: fullScreen ? 0 : 14,
          overflow: 'hidden',
          boxShadow: fullScreen ? 'none' : '0 24px 80px rgba(0,0,0,0.25)',
          animation: 'pd-fade var(--dur) var(--ease)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '10px 14px',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
            {/* Sized box: the tile's % padding resolves against its parent. */}
            <span style={{ display: 'flex', width: 28, flexShrink: 0 }}>
              <WordmarkTile app={app} size={28} radius={8} />
            </span>
            <strong style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {app.name}
            </strong>
            {app.brand && app.brand !== app.name && (
              <span className="pd-bychip" style={{ fontSize: 10, padding: '3px 8px' }}>
                {app.brand} by Prodesk
              </span>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label={`Close ${app.name}`}
            onClick={onClose}
            style={{ background: 'none', border: 0, cursor: 'pointer', padding: 6, color: 'var(--ink-2)' }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ position: 'relative', flex: 1 }}>
          {url && (
            <iframe
              ref={frameRef}
              title={app.name}
              src={url}
              allow="clipboard-write"
              onLoad={() => setLoaded(true)}
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
            />
          )}
          {!loaded && (
            <div
              role="status"
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'var(--paper)',
                color: 'var(--ink-3)',
                fontSize: 14,
              }}
            >
              Opening {app.name}…
            </div>
          )}
        </div>
      </div>
    </Scrim>
  );
}

/* ============ UNLOCK DRAWER ============ */
export function UnlockDrawer({
  app,
  onClose,
}: {
  app: SuiteApp | null;
  onClose: () => void;
}) {
  if (!app) return null;
  return (
    <Scrim onClick={onClose} align="right">
      <div
        role="dialog"
        aria-label={'Unlock ' + app.name}
        style={{
          width: 'min(420px, 94vw)',
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
            padding: '16px 20px',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <span className="eyebrow">Locked app</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pd-icon-btn"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ padding: '28px 24px', flex: 1, overflowY: 'auto' }}>
          <span
            style={{
              display: 'inline-flex',
              width: 48,
              height: 48,
              borderRadius: 'var(--r-2)',
              border: '1px solid var(--rule)',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink)',
            }}
          >
            <Icon name={app.icon || 'grid'} size={26} stroke={1.8} />
          </span>
          <h2
            style={{
              fontSize: 28,
              fontWeight: 700,
              margin: '20px 0 4px',
              letterSpacing: '-0.01em',
            }}
          >
            {app.name}
          </h2>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--ink-3)',
              marginBottom: 16,
            }}
          >
            <Icon name="lock" size={15} />
            <span style={{ fontSize: 13 }}>Not on your plan yet</span>
          </div>
          <p
            style={{
              color: 'var(--ink-2)',
              fontSize: 15,
              lineHeight: 1.55,
              margin: 0,
              textWrap: 'pretty',
            }}
          >
            {APP_BLURBS[app.id]}
          </p>
        </div>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
            Available on a higher plan.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              variant="primary"
              full
              onClick={() => {
                pushToast('Plans open in Billing.', 'info');
                onClose();
              }}
            >
              See plans
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Not now
            </Button>
          </div>
        </div>
      </div>
    </Scrim>
  );
}

/* ============ ADD BRAND ============ */
export function AddBrand({
  onClose,
  onCreate,
  dismissable = true,
}: {
  onClose: () => void;
  onCreate: (name: string, type: string) => void;
  dismissable?: boolean;
}) {
  const trpc = useTRPC();
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const trimmed = name.trim();

  // Live business-name availability — unique across the brand+agency namespace.
  const debouncedName = useDebounced(trimmed, 400);
  const nameCheck = useQuery({
    ...trpc.brands.checkBusinessName.queryOptions({ businessName: debouncedName }),
    enabled: debouncedName.length > 1,
  });
  const nameTaken = !!trimmed && nameCheck.data && !nameCheck.data.available;

  const submit = () => {
    if (trimmed && !nameTaken) onCreate(trimmed, type.trim());
  };
  // First-run (no brands yet): nothing sits behind the dialog, so it can't be
  // dismissed — the only way forward is to create a brand.
  return (
    <Scrim onClick={dismissable ? onClose : () => {}}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add brand"
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          background: 'var(--white)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          overflow: 'hidden',
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px',
            borderBottom: '1px solid var(--rule)',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            {dismissable ? 'Add brand' : 'Create your brand'}
          </h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="pd-icon-btn"
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        <div
          style={{
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          }}
        >
          <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 14 }}>
            {dismissable
              ? 'Each brand is its own workspace. Its products, contacts, proposals and settings stay separate from your other brands.'
              : 'Welcome to Prodesk. Your brand is your workspace — its products, contacts, proposals and settings all live inside it. Create one to get started.'}
          </p>
          <div>
            <Field
              id="brand-name"
              label="Brand name"
              value={name}
              onChange={setName}
              placeholder="e.g. Brighton Bakehouse"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            {nameTaken && (
              <p style={{ margin: '6px 0 0', color: 'var(--color-danger)', fontSize: 13 }}>
                {nameCheck.data?.reason ?? 'This business name is already taken'}
              </p>
            )}
          </div>
          <Field
            id="brand-type"
            label="What does it do? (optional)"
            value={type}
            onChange={setType}
            placeholder="e.g. Cafe & wholesale"
            hint="You can change this later in Brand Hub."
          />
        </div>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            padding: '16px 24px',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          {dismissable && (
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button variant="primary" onClick={submit} disabled={!trimmed || !!nameTaken}>
            Create brand
          </Button>
        </div>
      </div>
    </Scrim>
  );
}

/* ---- provenance (surfaces): which sources this tool reads ---- */
function ProvenanceRow({
  app,
  onOpenById,
}: {
  app: SuiteApp;
  onOpenById: (id: string) => void;
}) {
  const sources = (app.pulls || [])
    .map((id) => APPS.find((a) => a.id === id))
    .filter(Boolean) as SuiteApp[];
  if (sources.length === 0) return null;
  return (
    <div className="pd-eco-card">
      <div className="eyebrow" style={{ color: 'var(--ink)' }}>
        Pulls from your record
      </div>
      <p
        style={{
          margin: '8px 0 14px',
          color: 'var(--ink-2)',
          fontSize: 14,
          maxWidth: 520,
          textWrap: 'pretty',
        }}
      >
        Nothing here is retyped. {app.name} reads live from these sources —
        update them once and {app.name} reflects it.
      </p>
      <div className="pd-chip-wrap">
        {sources.map((s) => (
          <button
            key={s.id}
            type="button"
            className="pd-prov-chip"
            onClick={() => onOpenById(s.id)}
          >
            <span className="pd-prov-ic">
              <Icon name={s.icon || 'grid'} size={16} />
            </span>
            {s.name}
            <Icon name="arrowur" size={13} style={{ color: 'var(--ink-3)' }} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---- used in (sources): which surfaces consume this source ---- */
function UsedInRow({
  app,
  onOpenById,
}: {
  app: SuiteApp;
  onOpenById: (id: string) => void;
}) {
  const consumers = APPS.filter((a) => (a.pulls || []).includes(app.id));
  if (consumers.length === 0) return null;
  return (
    <div className="pd-eco-card">
      <div className="eyebrow" style={{ color: 'var(--ink)' }}>
        Used across {consumers.length}{' '}
        {consumers.length === 1 ? 'tool' : 'tools'}
      </div>
      <p
        style={{
          margin: '8px 0 14px',
          color: 'var(--ink-2)',
          fontSize: 14,
          maxWidth: 520,
          textWrap: 'pretty',
        }}
      >
        Change {app.name} once and every one of these updates with it — nothing
        is copied.
      </p>
      <div className="pd-chip-wrap">
        {consumers.map((c) => (
          <button
            key={c.id}
            type="button"
            className="pd-prov-chip"
            onClick={() => onOpenById(c.id)}
          >
            <span className="pd-prov-ic">
              <Icon name={c.icon || 'grid'} size={16} />
            </span>
            {c.name}
            <Icon
              name="arrowRight"
              size={13}
              style={{ color: 'var(--ink-3)' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============ IN-APP SHELL ============ */
export function AppOpen({
  app,
  brand,
  onHome,
  onOpenApp,
  onOpenBilling,
}: {
  app: SuiteApp;
  brand: Brand;
  onHome: () => void;
  onOpenApp: (a: SuiteApp) => void;
  onOpenBilling: () => void;
}) {
  const isSource = app.kind === 'source';
  const openById = (id: string) => {
    const a = APPS.find((x) => x.id === id);
    if (a) onOpenApp(a);
  };

  // Fully-built Foundations interiors (code-split — see lazy() imports above).
  if (app.id === 'people') {
    return (
      <main className="pd-page" data-tool={app.tool}>
        <Suspense fallback={<ToolFallback />}>
          <PeopleTool app={app} brand={brand} />
        </Suspense>
      </main>
    );
  }
  if (app.id === 'info-hub') {
    return (
      <main className="pd-page" data-tool={app.tool}>
        <Suspense fallback={<ToolFallback />}>
          <CompanyTool app={app} brand={brand} />
        </Suspense>
      </main>
    );
  }
  if (app.id === 'product-hub') {
    return (
      <main className="pd-page" data-tool={app.tool}>
        <Suspense fallback={<ToolFallback />}>
          <ProductsTool app={app} brand={brand} />
        </Suspense>
      </main>
    );
  }
  if (app.id === 'brand-hub') {
    return (
      <main className="pd-page" data-tool={app.tool}>
        <Suspense fallback={<ToolFallback />}>
          <BrandKitTool app={app} brand={brand} onOpenApp={onOpenApp} />
        </Suspense>
      </main>
    );
  }
  if (app.id === 'documents') {
    return (
      <main className="pd-page" data-tool={app.tool}>
        <Suspense fallback={<ToolFallback />}>
          <DocumentsTool app={app} brand={brand} />
        </Suspense>
      </main>
    );
  }
  if (app.id === 'strategy') {
    return (
      <Suspense fallback={<ToolFallback />}>
        <StrategyTool brand={brand} onOpenBilling={onOpenBilling} />
      </Suspense>
    );
  }
  // Standalone-frontend apps (Links/Adeyy, Reviews/Verdiict, …) have no in-suite
  // surface: they open in the AppModal. (Clicks are intercepted earlier, in
  // SuiteApp.openApp; this catches deep links to /app/<id>.)
  if (app.id in CROSS_APP_HOSTS) {
    return <CrossAppDeepLink app={app} onOpenApp={onOpenApp} />;
  }

  return (
    <main className="pd-page" data-tool={app.tool}>
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
          marginBottom: 18,
          whiteSpace: 'nowrap',
        }}
      >
        <Icon name="grid" size={15} /> All apps
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <WordmarkTile app={app} size={52} radius={14} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <h1
              style={{
                fontSize: 28,
                fontWeight: 700,
                margin: '2px 0 4px',
                letterSpacing: '-0.01em',
              }}
            >
              {app.name}
            </h1>
            {app.brand && app.brand !== app.name && (
              <span
                className="pd-bychip"
                style={{ fontSize: 10, padding: '3px 8px' }}
              >
                {app.brand} by Prodesk
              </span>
            )}
            <span className="pd-kind-pill">
              {isSource
                ? 'Source of truth'
                : app.kind === 'service'
                  ? 'Specialist'
                  : 'Tool'}
            </span>
            {app.agencyOnly && (
              <span className="pd-kind-pill">Agency only</span>
            )}
          </div>
          <div className="eyebrow">
            {app.stage ? app.stage + ' · ' : ''}
            {brand.name} · {brand.type}
          </div>
        </div>
        <Button
          variant="primary"
          leftIcon="plus"
          onClick={() =>
            pushToast(app.name + ' opens as its own tool.', 'info')
          }
        >
          Open {app.name}
        </Button>
      </div>

      <div
        style={{
          marginTop: 28,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        {isSource ? (
          <UsedInRow app={app} onOpenById={openById} />
        ) : (
          <ProvenanceRow app={app} onOpenById={openById} />
        )}
        <div
          style={{
            background: 'var(--white)',
            border: '1px solid var(--rule)',
            borderRadius: 'var(--r-3)',
            padding: 24,
            display: 'flex',
            gap: 16,
            alignItems: 'flex-start',
          }}
        >
          <span
            style={{
              width: 34,
              height: 34,
              borderRadius: 'var(--r-2)',
              border: '1px solid var(--rule)',
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-2)',
            }}
          >
            <Icon name="link" size={18} />
          </span>
          <div>
            <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 4 }}>
              {app.name} opens full screen, scoped to {brand.name}
            </div>
            <p
              style={{
                margin: 0,
                color: 'var(--ink-2)',
                fontSize: 14,
                maxWidth: 560,
                textWrap: 'pretty',
              }}
            >
              The top bar stays, so the wordmark is always home and you can
              switch brand without leaving. Switching brand keeps you in{' '}
              {app.name}, now reading the new brand&rsquo;s record.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
