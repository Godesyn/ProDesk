import { useMemo, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';
import { ANOMALY, BRANDS, EVENTS, PEOPLE, brandName, personName } from '../data/mock';
import { Ghost, PageHead, Section } from '../components/primitives';

/**
 * REGISTER — every answer to "who did what" in ten seconds, as an object you
 * would happily hand to an auditor.
 *
 * A specimen-framed sheet, not a log dump: mono, tabular, hairline-ruled. In the
 * real build it virtualises and every filter lives in the URL.
 *
 * ANOMALY SURFACING sits above the ledger and renders only when there is
 * something to say. It will fire rarely — and it is the reason you bought the
 * product.
 */
export function Register() {
  const [who, setWho] = useState('');
  const [brand, setBrand] = useState('');

  const rows = useMemo(
    () =>
      EVENTS.filter(
        (e) => (!who || e.who === who) && (!brand || e.brandId === brand),
      ),
    [who, brand],
  );

  const select =
    'h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm';

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="THE REGISTER"
        title="Everything that happened"
        lede={
          <>
            Every reveal, copy, share, rotation and revocation — who, when, which
            key, and where from. Append-only, so it can’t be tidied up after the
            fact.
          </>
        }
        actions={
          <>
            <Ghost>Export CSV</Ghost>
            <Ghost>
              <Download className="h-3.5 w-3.5" /> Export sheet
            </Ghost>
          </>
        }
      />

      {/* ── Anomaly ─────────────────────────────────────────────────────── */}
      <div
        className="rise mb-8 rounded-[var(--radius-md)] border p-5"
        style={{ borderColor: 'var(--alarm)', background: 'var(--alarm-soft)' }}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle
            className="mt-0.5 h-4 w-4 flex-none"
            style={{ color: 'var(--alarm)' }}
          />
          <div className="min-w-0">
            <div className="spec" style={{ color: 'var(--alarm)' }}>
              UNUSUAL
            </div>
            <p className="mt-1.5 text-sm leading-relaxed">
              <span className="font-semibold">{ANOMALY.who}</span> {ANOMALY.what} at{' '}
              <span className="num">{ANOMALY.at}</span>, from {ANOMALY.from}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Ghost tone="alarm">Close them out</Ghost>
              <Ghost>See the eleven keys</Ghost>
              <Ghost>This was expected</Ghost>
            </div>
          </div>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="rise mb-6 flex flex-wrap items-center gap-3">
        <select value={who} onChange={(e) => setWho(e.target.value)} className={select}>
          <option value="">Everyone</option>
          {PEOPLE.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className={select}
        >
          <option value="">Every brand</option>
          {BRANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select className={select} defaultValue="Last 7 days">
          <option>Today</option>
          <option>Last 7 days</option>
          <option>Last 90 days</option>
        </select>
        <span className="spec ml-auto">{rows.length} EVENTS</span>
      </div>

      {/* ── The sheet ───────────────────────────────────────────────────── */}
      <Section>
        <div className="specimen overflow-hidden rounded-[var(--radius-md)]">
          <div className="px-6 pb-2 pt-12">
            <div className="flex items-center gap-3 border-b border-[var(--hair-2)] pb-2">
              <span className="spec w-24 flex-none">WHEN</span>
              <span className="spec w-40 flex-none">WHO</span>
              <span className="spec w-32 flex-none">WHAT</span>
              <span className="spec min-w-0 flex-1">KEY</span>
              <span className="spec hidden w-32 flex-none md:block">BRAND</span>
              <span className="spec hidden w-32 flex-none lg:block">FROM</span>
            </div>

            {rows.map((e) => (
              <div
                key={e.id}
                className="ledger-row flex items-center gap-3 py-2.5 last:border-b-0"
              >
                <span className="num w-24 flex-none text-[12px] text-[var(--ink-2)]">
                  {e.at}
                </span>
                <span className="w-40 flex-none truncate text-[13px] font-medium">
                  {personName(e.who)}
                </span>
                <span
                  className="w-32 flex-none truncate text-[13px]"
                  style={{
                    color:
                      e.tone === 'alarm'
                        ? 'var(--alarm)'
                        : e.tone === 'pigment'
                          ? 'var(--pigment)'
                          : 'var(--ink-2)',
                  }}
                >
                  {e.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{e.item}</span>
                <span className="spec hidden w-32 flex-none truncate md:block">
                  {brandName(e.brandId)}
                </span>
                <span className="spec hidden w-32 flex-none truncate lg:block">
                  {e.from}
                </span>
              </div>
            ))}

            {rows.length === 0 && (
              <p className="py-14 text-center text-sm text-[var(--ink-3)]">
                Nothing matches those filters.
              </p>
            )}
          </div>
          <div className="flex items-center justify-between px-6 pb-10 pt-4">
            <span className="spec">APPEND-ONLY · CANNOT BE EDITED</span>
            <span className="spec">KEYMASTR · PRODESK</span>
          </div>
        </div>
      </Section>
    </div>
  );
}
