import { useMemo, useState } from 'react';
import { Download, Scissors } from 'lucide-react';
import {
  ACCESS_SUMMARY,
  BRANDS,
  GRANTS,
  ITEMS,
  PEOPLE,
  itemById,
} from '../data/mock';
import { Ghost, PageHead, Primary, Section } from '../components/primitives';

/**
 * ACCESS MAP — the flagship (DESIGN.md §5.3).
 *
 * People left, keys right, hairlines between. Tie WEIGHT is the message: solid
 * ink = opened in the last 90 days, dashed = granted but never opened. A wall of
 * dashed lines reads as over-provisioning before you read a single label.
 *
 * Two things here exist nowhere else on the market:
 *   · the CLIENT'S SIDE toggle — the same data from the brand's point of view,
 *     which an agency can open in a client meeting
 *   · TRIM TO WHAT'S USED — least privilege as one gesture instead of a project
 */

const ROW_H = 44;

export function Access() {
  const [side, setSide] = useState<'ours' | 'client'>('ours');
  const [brandId, setBrandId] = useState('acme');
  const [focus, setFocus] = useState<string | null>(null);
  const [trimOpen, setTrimOpen] = useState(false);

  const brand = BRANDS.find((b) => b.id === brandId)!;
  const keys = useMemo(() => ITEMS.filter((i) => i.brandId === brandId), [brandId]);
  const people = useMemo(
    () => PEOPLE.filter((p) => GRANTS.some((g) => g.person === p.id)),
    [],
  );
  const grants = useMemo(
    () => GRANTS.filter((g) => keys.some((k) => k.id === g.item)),
    [keys],
  );

  const unused = grants.filter((g) => !g.used);
  const summary = focus ? ACCESS_SUMMARY[focus] : null;
  const focused = focus ? PEOPLE.find((p) => p.id === focus) : null;

  const height = Math.max(people.length, keys.length) * ROW_H + 20;

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="THE ACCESS IS GLASS"
        title="Who can open what"
        lede={
          <>
            Solid lines are keys somebody actually opens. Dashed lines are keys
            they were handed and never touched. You should be able to tell which
            vault is over-provisioned without reading a single label.
          </>
        }
        actions={
          <>
            <Ghost>
              <Download className="h-3.5 w-3.5" /> Access statement
            </Ghost>
            <Primary onClick={() => setTrimOpen(true)}>
              <Scissors className="h-3.5 w-3.5" /> Trim to what’s used
            </Primary>
          </>
        }
      />

      {/* ── Controls ────────────────────────────────────────────────────── */}
      <div className="rise mb-8 flex flex-wrap items-center gap-4 border-y border-[var(--hair)] py-4">
        {/* The toggle that reframes the entire screen. */}
        <div
          className="inline-flex rounded-[var(--radius-pill)] p-0.5"
          style={{ background: 'var(--stage-2)' }}
        >
          {(
            [
              ['ours', 'Our side'],
              ['client', 'Client’s side'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setSide(k)}
              className="press rounded-[var(--radius-pill)] px-4 py-1.5 text-xs font-semibold transition"
              style={{
                background: side === k ? 'var(--ink)' : 'transparent',
                color: side === k ? 'var(--stage)' : 'var(--ink-2)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <select
          value={brandId}
          onChange={(e) => {
            setBrandId(e.target.value);
            setFocus(null);
          }}
          className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm"
        >
          {BRANDS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>

        <span className="spec ml-auto">
          {grants.length} GRANTS · {unused.length} NEVER USED
        </span>
      </div>

      {/* When the toggle is flipped, the copy changes with it — this is the
          brand owner reading it, not the agency. */}
      {side === 'client' && (
        <p className="rise quill mb-8 text-[19px] leading-snug">
          This is exactly what {brand.name} sees when they open their own vault.
          Nothing is hidden from them, including this sentence.
        </p>
      )}

      {/* ── The sentence ────────────────────────────────────────────────── */}
      {summary && focused && (
        <div
          className="pop mb-8 rounded-[var(--radius-md)] border p-5"
          style={{ borderColor: 'var(--pigment)', background: 'var(--card)' }}
        >
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-[17px] font-semibold">{focused.name}</span>
            <span className="spec">
              {focused.org} · {focused.role}
            </span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
            can open{' '}
            <span className="num font-semibold text-[var(--ink)]">
              {summary.can} of {brand.name}’s {summary.of} keys
            </span>
            . They have opened{' '}
            <span className="num font-semibold text-[var(--ink)]">
              {summary.opened}
            </span>{' '}
            in the last 30 days.{' '}
            <span className="num font-semibold" style={{ color: 'var(--alarm)' }}>
              {summary.never} have never been opened.
            </span>{' '}
            Access was granted by {summary.by} on {summary.on}.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Ghost>Trim their unused keys</Ghost>
            <Ghost tone="alarm">Revoke everything</Ghost>
            <button
              type="button"
              onClick={() => setFocus(null)}
              className="press px-3 text-xs text-[var(--ink-3)]"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ── The bipartite ledger ────────────────────────────────────────── */}
      <Section
        eyebrow={side === 'ours' ? 'PEOPLE ↔ KEYS' : `WHO ${brand.name.toUpperCase()} IS TRUSTING`}
        title={brand.name}
      >
        <div
          className="relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
          style={{ background: 'var(--card)' }}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_90px_minmax(0,1fr)] sm:grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)]">
            {/* people */}
            <div className="py-2.5">
              {people.map((p) => {
                const lit = focus === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onMouseEnter={() => setFocus(p.id)}
                    onClick={() => setFocus(lit ? null : p.id)}
                    className="flex w-full items-center gap-2.5 px-4 text-left"
                    style={{ height: ROW_H, opacity: focus && !lit ? 0.35 : 1 }}
                  >
                    <span
                      className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-semibold"
                      style={{
                        background: lit ? 'var(--pigment)' : 'var(--stage-2)',
                        color: lit ? '#fff' : 'var(--ink-2)',
                      }}
                    >
                      {p.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {p.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ink-3)]">
                        {p.departed ? `Left ${p.departed}` : p.org}
                      </span>
                    </span>
                    {p.departed && (
                      <span
                        className="ml-auto h-1.5 w-1.5 flex-none rounded-full"
                        style={{ background: 'var(--alarm)' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* the ties */}
            <svg
              className="h-full w-full"
              viewBox={`0 0 100 ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {grants.map((g, n) => {
                const pi = people.findIndex((p) => p.id === g.person);
                const ki = keys.findIndex((k) => k.id === g.item);
                if (pi < 0 || ki < 0) return null;
                const y1 = 10 + pi * ROW_H + ROW_H / 2;
                const y2 = 10 + ki * ROW_H + ROW_H / 2;
                const lit = focus === g.person;
                return (
                  <path
                    key={n}
                    className="tie"
                    data-used={g.used}
                    data-lit={lit || undefined}
                    data-dim={focus && !lit ? true : undefined}
                    d={`M0 ${y1} C 40 ${y1}, 60 ${y2}, 100 ${y2}`}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              })}
            </svg>

            {/* keys */}
            <div className="py-2.5">
              {keys.map((k) => {
                const held = grants.some(
                  (g) => g.item === k.id && (!focus || g.person === focus),
                );
                return (
                  <div
                    key={k.id}
                    className="flex items-center gap-2 px-4"
                    style={{ height: ROW_H, opacity: focus && !held ? 0.3 : 1 }}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">
                        {k.name}
                      </span>
                      <span className="block truncate text-[11px] text-[var(--ink-3)]">
                        {k.identity}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1">
          <span className="spec">— SOLID · OPENED IN 90 DAYS</span>
          <span className="spec">- - DASHED · NEVER OPENED</span>
          <span className="spec">HOVER A PERSON TO LIGHT THEIR REACH</span>
        </div>
      </Section>

      {/* ── Trim panel ──────────────────────────────────────────────────── */}
      {trimOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
          style={{ background: 'rgba(14,14,12,0.44)' }}
          onClick={() => setTrimOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="pop max-h-[86vh] w-full max-w-lg overflow-y-auto rounded-t-[var(--radius-lg)] border border-[var(--hair-2)] p-6 sm:rounded-[var(--radius-md)]"
            style={{ background: 'var(--card)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="spec">LEAST PRIVILEGE, IN ONE GESTURE</div>
            <h2 className="mt-2 text-[22px] font-extrabold tracking-tight">
              Trim to what’s used
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
              These grants have not been opened in 90 days. Revoking them changes
              nothing about anybody’s work today — and everyone affected gets one
              notification with a <span className="font-medium">Request it back</span>{' '}
              button, so nobody is ever stuck.
            </p>

            <div className="my-5 border-y border-[var(--hair)]">
              {unused.map((g, n) => (
                <label
                  key={n}
                  className="flex cursor-pointer items-center gap-3 border-b border-[var(--hair)] py-2.5 last:border-b-0"
                >
                  <input
                    type="checkbox"
                    defaultChecked
                    className="h-3.5 w-3.5 accent-[var(--pigment)]"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    <span className="font-medium">
                      {PEOPLE.find((p) => p.id === g.person)?.name}
                    </span>{' '}
                    <span className="text-[var(--ink-2)]">
                      → {itemById(g.item)?.name}
                    </span>
                  </span>
                  <span className="spec flex-none">NEVER</span>
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="num text-sm font-semibold">
                Revoking {unused.length} grants
              </span>
              <div className="flex gap-2">
                <Ghost onClick={() => setTrimOpen(false)}>Cancel</Ghost>
                <Primary onClick={() => setTrimOpen(false)}>Revoke them</Primary>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
