import { Link, useParams } from 'wouter';
import { ArrowLeft, Eye } from 'lucide-react';
import {
  BRANDS,
  EVENTS,
  PEOPLE,
  SENDS,
  itemsFor,
  personName,
} from '../data/mock';
import { ItemLedger } from '../components/ItemLedger';
import { Drain, Ghost, KeyMark, Section } from '../components/primitives';

/**
 * BRAND VAULT — one brand's everything. The screen a brand owner lives in, and
 * the one an agency opens during a client call.
 *
 * When the viewer reaches this brand through an agency, the header says so out
 * loud: "Acme can see everything on this screen." Because they can — that's the
 * whole thesis (DESIGN.md §5.11), and saying it is what earns the trust.
 */
export function BrandVault() {
  const { brandId } = useParams<{ brandId: string }>();
  const brand = BRANDS.find((b) => b.id === brandId);
  const items = itemsFor(brandId ?? '');
  const sends = SENDS.filter((s) => s.brandId === brandId);
  const events = EVENTS.filter((e) => e.brandId === brandId);

  if (!brand) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-20 text-center">
        <p className="text-sm text-[var(--ink-3)]">That brand isn’t on your keyring.</p>
        <Link href="/" className="mt-3 inline-block text-sm font-semibold" style={{ color: 'var(--pigment)' }}>
          ← Back to your keyring
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/"
        className="spec press mb-6 inline-flex items-center gap-1.5 hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-3 w-3" /> KEYRING
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="rise mb-10 flex flex-wrap items-end justify-between gap-6 border-b border-[var(--hair)] pb-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <KeyMark seed={brand.seed} className="h-5 w-11 text-[var(--ink)]" />
            <span className="spec">{brand.via ? `VIA ${brand.via}` : brand.role}</span>
          </div>
          <h1 className="mt-3 text-[32px] font-extrabold leading-none tracking-[-0.03em]">
            {brand.name}
          </h1>
          <p className="num mt-3 text-sm text-[var(--ink-2)]">
            {brand.keys} keys · {brand.people} people
            {brand.sharedOut > 0 && ` · ${brand.sharedOut} shared out`}
          </p>

          {/* The line that makes the two-sided model real. */}
          {brand.via && (
            <p className="mt-4 flex items-center gap-2 text-xs text-[var(--ink-2)]">
              <Eye className="h-3.5 w-3.5" style={{ color: 'var(--pigment)' }} />
              {brand.name} can see everything on this screen.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Ghost>Access statement ↗</Ghost>
          <Link
            href="/access"
            className="press inline-flex h-9 items-center rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-white"
            style={{ background: 'var(--pigment)' }}
          >
            Who can open these?
          </Link>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_300px]">
        {/* ── Keys ──────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Section eyebrow={`${items.length} SHOWN`} title="Keys">
            <ItemLedger items={items} showBrand={false} />
          </Section>
        </div>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-8">
          <Section eyebrow="WHO'S IN HERE" title="People">
            <div className="flex flex-col gap-2.5">
              {PEOPLE.slice(0, brand.people).map((p) => (
                <div key={p.id} className="flex items-center gap-3">
                  <span
                    className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-semibold"
                    style={{
                      background: 'var(--stage-2)',
                      color: 'var(--ink-2)',
                    }}
                  >
                    {p.name
                      .split(' ')
                      .map((n) => n[0])
                      .join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {p.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--ink-3)]">
                      {p.org}
                    </span>
                  </span>
                  {p.departed && (
                    <span className="chip flex-none" data-tone="alarm">
                      Left
                    </span>
                  )}
                </div>
              ))}
            </div>
          </Section>

          {sends.length > 0 && (
            <Section eyebrow="OPEN RIGHT NOW" title="Live shares">
              <div className="flex flex-col gap-3">
                {sends.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-3"
                    style={{ background: 'var(--card)' }}
                  >
                    <div className="flex items-center gap-2">
                      <Drain remaining={s.remaining} title={`Expires ${s.expires}`} />
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                        {s.to}
                      </span>
                    </div>
                    <p className="spec mt-1.5">
                      {s.items} · {s.opens} · {s.expires}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <Section eyebrow="THE REGISTER" title="Recently">
            <div className="flex flex-col gap-2">
              {events.length === 0 && (
                <p className="text-xs text-[var(--ink-3)]">Nothing yet today.</p>
              )}
              {events.map((e) => (
                <p key={e.id} className="text-[12px] leading-snug text-[var(--ink-2)]">
                  <span className="spec mr-1.5">{e.at}</span>
                  <span className="font-medium text-[var(--ink)]">
                    {personName(e.who)}
                  </span>{' '}
                  {e.action} {e.item}
                </p>
              ))}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
