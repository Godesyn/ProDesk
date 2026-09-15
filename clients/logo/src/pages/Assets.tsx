import { useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Download, Loader2, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '@shared/lib/trpc';
import { useCrossAppOpen } from '@shared/auth/use-cross-app';
import { PRODESK_ORIGINS } from '@shared/lib/origins';
import { primaryHexOf } from '@server/modules/logo/layout';
import { PageHeader, Eyebrow, PigmentButton } from '../components/primitives';
import { SvgMark, recolorSvg } from '../components/SvgMark';
import { LogoSuite } from '../components/LogoSuite';
import { downloadSuiteZip, type DownloadFormat } from '../lib/download-mark';
import { useStudio } from '../app/studio-context';

/**
 * Formats that are BUILT ON THE SERVER — rasterised, uploaded, and handed back as
 * hosted files. The suite formats (SVG/PNG) are not among them: they are the same
 * twelve lockups the page is already rendering, so they zip in the browser (see
 * lib/download-mark.ts) instead of costing 24 uploads a click.
 */
type ServerFmt = 'pdf' | 'guidelines';
/** Everything the download buttons can be busy with. */
type Busy = ServerFmt | 'svg' | 'png' | 'suite';

const FORMATS: { fmt: string; key: Busy; detail: string; primary?: boolean }[] = [
  { fmt: 'SVG', key: 'svg', detail: 'Editable vector · all 12 versions', primary: true },
  { fmt: 'PNG', key: 'png', detail: 'Transparent · 2048px · all 12' },
  { fmt: 'PDF', key: 'pdf', detail: 'Print-ready' },
  { fmt: 'Guidelines', key: 'guidelines', detail: 'The full rulebook, as a PDF' },
];

const INK = '#0E0E0C';
const PAPER = '#F4F1EA';

/**
 * Real-world mockups, each showing the suite asset that would actually be used in
 * that context — an app icon is the mark alone, merch is the knockout.
 *
 * `ink` repaints an asset for a tile darker than the one it was composed for;
 * `bg: null` means the tile takes the brand's primary colour. Both exist because
 * an asset carries its OWN colour contract: the ink mark on a black app-icon tile
 * would be black-on-black, and the coloured knockout bakes the primary as its
 * ground, so any other tile colour framed a mismatched plate around it.
 */
const MOCKUPS: { label: string; asset: string; bg: string | null; ink?: string }[] = [
  { label: 'App icon', asset: 'mark-ink', bg: INK, ink: PAPER },
  { label: 'Storefront', asset: 'primary-ink', bg: 'var(--stage-2)' },
  { label: 'Business card', asset: 'stacked-ink', bg: 'var(--card)' },
  { label: 'Merch', asset: 'reversed-colour', bg: null },
];

/**
 * Kick off the browser downloads. Staggered because several browsers drop
 * simultaneous programmatic downloads.
 */
function triggerDownloads(files: { name: string; url: string }[]) {
  files.forEach((f, i) => {
    setTimeout(() => {
      const a = document.createElement('a');
      a.href = f.url;
      a.download = f.name;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }, i * 250);
  });
}

function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** Pill action that can go busy — the page's unlock call to action. */
function ActionButton({
  onClick,
  disabled,
  busy,
  tone = 'pigment',
  children,
  note,
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  tone?: 'pigment' | 'ink';
  children: React.ReactNode;
  note?: string;
}) {
  const pigment = tone === 'pigment';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={`press inline-flex h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-pill)] px-5 text-sm font-semibold transition disabled:opacity-60 ${
        pigment
          ? 'text-white hover:brightness-105'
          : 'border border-[var(--hair-2)] text-[var(--ink)] hover:bg-[var(--stage-2)]'
      }`}
      style={pigment ? { background: 'var(--pigment)' } : undefined}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {children}
      {note && (
        <span
          className={`tnum text-xs font-medium ${pigment ? 'text-white/70' : 'text-[var(--ink-3)]'}`}
        >
          {note}
        </span>
      )}
    </button>
  );
}

export function Assets() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const openApp = useCrossAppOpen();
  const { brandId, overview } = useStudio();
  const chosen = overview.data?.chosen ?? null;
  const status = overview.data?.project?.status ?? '';
  const applied = status === 'system' || status === 'complete';
  const rightsAt = overview.data?.project?.rightsAssignedAt ?? null;

  const planQuery = useQuery(
    trpc.logo.assets.plan.queryOptions({ brandId: brandId! }, { enabled: !!brandId }),
  );
  /**
   * The twelve delivered files. This is the page's ONLY artwork query — the
   * mockups below are drawn from the same set, so what a mockup shows and what a
   * download contains cannot drift apart.
   */
  const suiteQuery = useQuery(
    trpc.logo.assets.suite.queryOptions({ generationId: chosen?.id ?? '' }, { enabled: !!chosen }),
  );
  const exportMut = useMutation(trpc.logo.assets.export.mutationOptions());
  const claimMut = useMutation(trpc.logo.assets.claim.mutationOptions());
  const checkout = useMutation(trpc.featureSubscriptions.checkout.mutationOptions());
  const [busy, setBusy] = useState<Busy | null>(null);

  const plan = planQuery.data;
  const allowed = plan?.entitlement.allowed ?? true;
  const free = plan?.entitlement.free ?? true;
  const product = plan?.product ?? null;
  const suite = suiteQuery.data?.suite ?? [];
  const stem = suiteQuery.data?.stem ?? 'logo';
  /** The colour the knockout bakes as its ground — see MOCKUPS. */
  const primaryHex = primaryHexOf(chosen?.spec?.palette ?? []);
  const suiteReady = suite.length > 0;

  /**
   * Record the download server-side BEFORE building it: `claim` runs the same
   * subscription gate and the same "you own it when you download" stamp an export
   * does, and throwing there has to stop the zip rather than follow it.
   */
  const claim = async () => {
    if (!chosen) throw new Error('Choose a mark first.');
    await claimMut.mutateAsync({ generationId: chosen.id });
    void qc.invalidateQueries({ queryKey: trpc.logo.overview.queryKey() });
  };

  /** SVG / PNG — the whole suite, zipped in the browser. */
  const runZip = async (formats: DownloadFormat[], key: Busy) => {
    if (!suiteReady || busy) return;
    setBusy(key);
    try {
      await claim();
      const only = formats.length === 1 ? formats[0] : null;
      await downloadSuiteZip({
        files: suite.map((a) => ({ name: `${stem}-${a.key}`, svg: a.svg })),
        formats,
        archive: only ? `${stem}-logo-${only}` : `${stem}-logo-suite`,
      });
      toast.success(`${suite.length * formats.length} files zipped and downloading.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not build that download.');
    } finally {
      setBusy(null);
    }
  };

  /** PDF / guidelines — built and hosted server-side, then fetched. */
  const runExport = (key: ServerFmt) => {
    if (!chosen || busy) return;
    setBusy(key);
    exportMut.mutate(
      { generationId: chosen.id, format: key },
      {
        onSuccess: (res) => {
          triggerDownloads(res.files);
          toast.success(`${res.label} — ${res.files.length} file${res.files.length === 1 ? '' : 's'} ready.`);
          void qc.invalidateQueries({ queryKey: trpc.logo.overview.queryKey() });
        },
        onError: (e) => toast.error(e.message),
        onSettled: () => setBusy(null),
      },
    );
  };

  const onFormat = (key: Busy) => {
    if (key === 'svg' || key === 'png') return void runZip([key], key);
    if (key === 'pdf' || key === 'guidelines') return runExport(key);
  };

  /**
   * Subscribe through the SHARED feature-subscription checkout: it charges a card
   * on file when there is one (returning no url) and falls back to Stripe
   * Checkout otherwise — so both outcomes have to be handled.
   */
  const onUnlock = () => {
    if (!brandId || !product) return;
    const here = window.location.href;
    checkout.mutate(
      { brandId, priceId: product.priceId, successUrl: here, cancelUrl: here },
      {
        onSuccess: (res) => {
          if (res.url) {
            window.location.assign(res.url);
            return;
          }
          toast.success('Logo Studio unlocked — your downloads are ready.');
          void qc.invalidateQueries();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  /**
   * The marketing kit routes generated assets into the sibling apps that own
   * them. Cross-app navigation goes through the shared handoff so the session
   * follows the user across domains.
   */
  const KIT: { name: string; app: string; host?: string; path: string; ready: boolean }[] = [
    { name: 'Email signature', app: 'Signatures', host: PRODESK_ORIGINS.signatures, path: '/', ready: applied },
    { name: 'Invoice header', app: 'Payments', host: PRODESK_ORIGINS.payments, path: '/', ready: applied },
    { name: 'Review page banner', app: 'Reviews', host: PRODESK_ORIGINS.reviews, path: '/', ready: applied },
    { name: 'Short-link brand', app: 'Links', host: PRODESK_ORIGINS.links, path: '/', ready: applied },
    { name: 'Brand hub', app: 'Dashboard', host: PRODESK_ORIGINS.dashboard, path: '/', ready: applied },
  ];

  if (!chosen) {
    return (
      <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
        <PageHeader
          index="06"
          eyebrow="Assets"
          title="Nothing to export yet."
          lede="Choose a mark, then download it every way you'll ever need it."
        />
        <PigmentButton className="mt-8" onClick={() => navigate('/concepts')}>
          See concepts <ArrowUpRight className="h-4 w-4" />
        </PigmentButton>
      </div>
    );
  }

  const byKey = new Map(suite.map((a) => [a.key, a.svg]));

  return (
    <div className="mx-auto max-w-[1120px] px-4 pb-24 pt-8 sm:px-6 lg:px-8 lg:pt-10">
      <PageHeader
        index="06"
        eyebrow="Assets"
        title="Everything you need to launch."
        lede="Real editable vectors, every raster size, and a full marketing kit — the vector files are included, never the surprise paywall."
      />

      {/* Export formats */}
      <section className="mt-10">
        <Eyebrow>Export formats</Eyebrow>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FORMATS.map((e) => (
            <button
              key={e.fmt}
              onClick={() => onFormat(e.key)}
              disabled={!allowed || busy !== null}
              className="group flex items-center gap-4 rounded-[var(--radius-md)] border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              style={{
                borderColor: e.primary ? 'var(--pigment)' : 'var(--hair-2)',
                background: e.primary ? 'var(--pigment-soft)' : 'var(--card)',
              }}
            >
              <span
                className="grid h-12 w-12 shrink-0 place-items-center rounded-[var(--radius-md)] font-mono text-xs font-bold"
                style={{
                  background: e.primary ? 'var(--pigment)' : 'var(--stage-2)',
                  color: e.primary ? '#fff' : 'var(--ink)',
                }}
              >
                {e.fmt.length > 4 ? e.fmt.slice(0, 3).toUpperCase() : e.fmt}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[var(--ink)]">{e.fmt}</p>
                <p className="truncate text-xs text-[var(--ink-3)]">{e.detail}</p>
              </div>
              {busy === e.key ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[var(--ink-3)]" />
              ) : !allowed ? (
                <Lock className="h-4 w-4 shrink-0 text-[var(--ink-3)]" />
              ) : (
                <Download className="h-4 w-4 shrink-0 text-[var(--ink-3)] opacity-0 transition group-hover:opacity-100" />
              )}
            </button>
          ))}
        </div>
      </section>

      {/* The suite — the same component the public share page renders. */}
      {suiteQuery.isLoading ? (
        <div className="mt-12 grid place-items-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ink-3)]" />
        </div>
      ) : (
        <LogoSuite
          className="mt-12"
          suite={suite}
          stem={stem}
          primaryHex={primaryHex}
          onBeforeDownload={claim}
        />
      )}

      {/* Mockups */}
      <section className="mt-12">
        <Eyebrow>In the real world</Eyebrow>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {MOCKUPS.map((m) => {
            const svg = byKey.get(m.asset);
            return (
              <div
                key={m.label}
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
              >
                <div
                  className="grid h-32 place-items-center px-5 sm:h-40"
                  style={{ background: m.bg ?? primaryHex }}
                >
                  {/*
                    An explicit HEIGHT, not just a max-height: `.svg-mark` is an
                    inline-block whose <svg> is sized 100%/100% of it, so a box
                    with only a width collapses to zero height — and because the
                    <svg> is `overflow: visible`, the artwork then paints at its
                    natural scale straight out of the tile instead of scaling
                    down into it. `w-full` + a real height lets the viewBox's
                    preserveAspectRatio fit and centre every lockup, wide or
                    square.
                  */}
                  {svg ? (
                    <SvgMark
                      svg={m.ink ? recolorSvg(svg, m.ink) : svg}
                      className="h-14 w-full sm:h-16"
                    />
                  ) : (
                    <SvgMark svg={chosen.svg} tone="ink" className="h-14 w-14" />
                  )}
                </div>
                <div className="bg-[var(--card)] px-4 py-2.5">
                  <span className="text-xs font-semibold text-[var(--ink)]">{m.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Marketing kit */}
      <section className="mt-12">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Eyebrow>Marketing kit</Eyebrow>
          <span className="spec" style={{ fontSize: 10 }}>
            {applied ? 'Generated from your brand system' : 'Push to the suite to unlock'}
          </span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {KIT.map((k) => (
            <div
              key={k.name}
              className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] p-4"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)]">
                <SvgMark svg={chosen.svg} tone={k.ready ? 'pigment' : 'ink'} className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--ink)]">{k.name}</p>
                <p className="spec" style={{ fontSize: 9 }}>
                  via {k.app}
                </p>
              </div>
              {k.ready ? (
                <button
                  onClick={() => void openApp(k.host, k.path, { newWindow: true })}
                  className="-my-2 flex shrink-0 items-center gap-1 py-2 text-xs font-semibold text-[var(--pigment)] hover:underline"
                >
                  Open <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              ) : (
                <button
                  onClick={() => navigate('/brand')}
                  className="-my-2 flex shrink-0 items-center gap-1 py-2 text-xs font-medium text-[var(--ink-3)] transition hover:text-[var(--ink)]"
                >
                  Generate <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Pay-on-download */}
      <section className="mt-12 flex flex-wrap items-center gap-4 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] p-5">
        {rightsAt ? (
          <ShieldCheck className="h-5 w-5 shrink-0" style={{ color: 'var(--pigment)' }} />
        ) : (
          <Lock className="h-5 w-5 shrink-0 text-[var(--ink-3)]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--ink)]">
            {rightsAt ? 'This mark is yours.' : 'Designing is free. You own it when you download.'}
          </p>
          <p className="text-xs text-[var(--ink-3)]">
            {rightsAt
              ? `Full commercial rights assigned on ${new Date(rightsAt).toLocaleDateString()} — vectors included, yours to use anywhere.`
              : allowed
                ? 'Full commercial rights and vector files included — no hidden tiers, cancel anytime.'
                : product
                  ? `${formatPrice(product.amount, product.currency)}/${product.interval} unlocks every download. Everything you designed stays saved.`
                  : 'Everything you designed stays saved.'}
          </p>
        </div>
        {!allowed && product ? (
          <ActionButton onClick={onUnlock} busy={checkout.isPending}>
            {product.cardButtonLabel || `Unlock — ${formatPrice(product.amount, product.currency)}`}
          </ActionButton>
        ) : null}
      </section>

      {free && (
        <p className="spec mt-3" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
          Downloads are open while Logo Studio is in beta.
        </p>
      )}
    </div>
  );
}
