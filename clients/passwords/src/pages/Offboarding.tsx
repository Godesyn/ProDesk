import { useState } from 'react';
import { AlertTriangle, Check, Download, RotateCw } from 'lucide-react';
import { OFFBOARDING, PEOPLE, brandName } from '../data/mock';
import { Ghost, PageHead, Primary, Section, Specimen } from '../components/primitives';

/**
 * OFFBOARDING — the highest-value screen in the product, and one no competitor
 * has designed at all. They give you a delete-user button and wish you luck.
 *
 * The whole flow turns on a distinction two-panel products collapse:
 *
 *   REACHED AND OPENED   they hold these values → ROTATE          (9)
 *   REACHED, NEVER OPENED  they never saw them → REVOKE           (22)
 *   ONLY THEY KNEW       sole holder → RECOVER BEFORE ROTATING    (2)
 *
 * Merge the first two and you make someone rotate 31 keys instead of 9, which is
 * exactly why offboarding never gets finished. Splitting them is the difference
 * between a flow people complete and one they abandon.
 */
export function Offboarding() {
  const [personId, setPersonId] = useState(OFFBOARDING.person);
  const [done, setDone] = useState<string[]>(
    OFFBOARDING.opened.slice(0, OFFBOARDING.rotated).map((o) => o.name),
  );

  const person = PEOPLE.find((p) => p.id === personId)!;
  const queue = OFFBOARDING.opened;
  const complete = done.length === queue.length;
  const pct = Math.round((done.length / queue.length) * 100);

  const toggle = (name: string) =>
    setDone((d) => (d.includes(name) ? d.filter((x) => x !== name) : [...d, name]));

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="THE DAY SOMEONE LEAVES"
        title="Close someone out"
        lede={
          <>
            Rotate only what they actually opened, revoke the rest, and finish
            with a dated record that proves it. Twenty minutes, not a project.
          </>
        }
        actions={
          <select
            value={personId}
            onChange={(e) => setPersonId(e.target.value)}
            className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm"
          >
            {PEOPLE.filter((p) => p.id !== 'sajat').map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.departed ? ` — left ${p.departed}` : ''}
              </option>
            ))}
          </select>
        }
      />

      {/* The screen arms itself: anyone already removed from Prodesk staff is
          waiting here before you go looking. */}
      {person.departed && (
        <div
          className="rise mb-10 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border p-4"
          style={{ borderColor: 'var(--alarm)', background: 'var(--alarm-soft)' }}
        >
          <AlertTriangle
            className="h-4 w-4 flex-none"
            style={{ color: 'var(--alarm)' }}
          />
          <span className="text-sm">
            <span className="font-semibold">{person.name}</span> was removed from
            staff on {person.departed} and has not been closed out.
          </span>
          <span className="spec ml-auto">
            {queue.length - done.length} KEYS OUTSTANDING
          </span>
        </div>
      )}

      {/* ── Blast radius ────────────────────────────────────────────────── */}
      <div className="mb-12">
        <Section eyebrow="BLAST RADIUS" title="What they could reach">
          <div className="grid gap-4 lg:grid-cols-3">
            <Specimen className="p-5" >
              <div className="flex items-baseline gap-2">
                <span
                  className="num text-[38px] font-extrabold leading-none"
                  style={{ color: 'var(--alarm)' }}
                >
                  {queue.length}
                </span>
                <span className="spec">MUST ROTATE</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
                They opened these, so they hold the values. Nothing else closes
                this except changing them.
              </p>
            </Specimen>

            <Specimen className="p-5">
              <div className="flex items-baseline gap-2">
                <span className="num text-[38px] font-extrabold leading-none">
                  {OFFBOARDING.neverOpened}
                </span>
                <span className="spec">REVOKE ONLY</span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
                Reachable, never opened. Pulling the grant is enough — rotating
                these would be twenty-two afternoons spent on nothing.
              </p>
            </Specimen>

            <Specimen
              className="p-5"
              // The one that bites: rotate blind and you lock yourself out.
            >
              <div className="flex items-baseline gap-2">
                <span
                  className="num text-[38px] font-extrabold leading-none"
                  style={{ color: 'var(--alarm)' }}
                >
                  {OFFBOARDING.soleHolder.length}
                </span>
                <span className="spec">ONLY THEY KNEW</span>
              </div>
              <p className="quill mt-3 text-[15px] leading-snug">
                Recover these before you rotate them, or you lock yourself out of
                the domain.
              </p>
              <ul className="mt-3 flex flex-col gap-1">
                {OFFBOARDING.soleHolder.map((k) => (
                  <li key={k.name} className="text-[12px] text-[var(--ink-2)]">
                    {k.name} · {brandName(k.brandId)}
                  </li>
                ))}
              </ul>
            </Specimen>
          </div>
        </Section>
      </div>

      {/* ── Rotation queue ──────────────────────────────────────────────── */}
      <div className="mb-12">
        <Section
          eyebrow="ORDERED BY RISK"
          title="Rotation queue"
          action={
            <span className="num text-sm font-semibold">
              {done.length} of {queue.length}
            </span>
          }
        >
          {/* Progress fills in pigment as the queue drains. */}
          <div
            className="mb-4 h-[3px] w-full overflow-hidden rounded-full"
            style={{ background: 'var(--hair-2)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: 'var(--pigment)' }}
            />
          </div>

          <div
            className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
            style={{ background: 'var(--card)' }}
          >
            {queue.map((k, n) => {
              const isDone = done.includes(k.name);
              const sole = OFFBOARDING.soleHolder.some((s) => s.name === k.name);
              return (
                <div
                  key={k.name}
                  className="ledger-row flex items-center gap-3 px-4 py-3 last:border-b-0"
                  style={{ opacity: isDone ? 0.5 : 1 }}
                >
                  <span className="spec w-6 flex-none">
                    {String(n + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-sm font-medium"
                      style={{
                        textDecoration: isDone ? 'line-through' : undefined,
                      }}
                    >
                      {k.name}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--ink-3)]">
                      {brandName(k.brandId)} · {k.why}
                    </span>
                  </span>
                  {sole && !isDone && (
                    <span className="chip hidden flex-none sm:inline-flex" data-tone="alarm">
                      Recover first
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => toggle(k.name)}
                    className="press inline-flex h-8 flex-none items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition"
                    style={{
                      borderColor: isDone ? 'var(--pigment)' : 'var(--hair-2)',
                      color: isDone ? 'var(--pigment)' : 'var(--ink-2)',
                    }}
                  >
                    {isDone ? (
                      <>
                        <Check className="h-3 w-3" /> Rotated
                      </>
                    ) : (
                      <>
                        <RotateCw className="h-3 w-3" /> Rotate
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="spec mt-3">
            THE QUEUE SURVIVES NAVIGATION — FINISH IT OVER AN AFTERNOON
          </p>
        </Section>
      </div>

      {/* ── Exit certificate ────────────────────────────────────────────── */}
      <Section eyebrow="THE RECORD" title="Exit certificate">
        <Specimen
          className="p-8"
          corners={['PRODESK · KEYMASTR', 'EXIT CERTIFICATE', '', '']}
        >
          <div className="mx-auto max-w-lg py-6 text-center">
            <span className="stamp" data-tone={complete ? undefined : 'alarm'}>
              {complete ? 'Closed out' : 'Incomplete'}
            </span>
            <h3 className="mt-5 text-[24px] font-extrabold tracking-tight">
              {person.name}
            </h3>
            <p className="spec mt-2">
              ACCESS ENDED {person.departed ?? '—'} ·{' '}
              {complete ? 'CLOSED OUT 12 AUG 2026, 4:41PM AEST' : 'IN PROGRESS'}
            </p>

            <dl className="mt-7 grid grid-cols-2 gap-5 border-y border-[var(--hair)] py-5 sm:grid-cols-4">
              {[
                ['In reach', String(queue.length + OFFBOARDING.neverOpened)],
                ['Rotated', String(done.length)],
                ['Revoked unused', String(OFFBOARDING.neverOpened)],
                ['Outstanding', String(queue.length - done.length)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dd className="num text-[22px] font-extrabold leading-none">{v}</dd>
                  <dt className="spec mt-1.5">{k}</dt>
                </div>
              ))}
            </dl>

            <p className="mt-5 text-xs text-[var(--ink-2)]">
              Closed out by Sajat Sivakumar
            </p>

            <div className="mt-7 flex flex-wrap justify-center gap-2">
              {complete ? (
                <Primary>
                  <Download className="h-3.5 w-3.5" /> Export certificate
                </Primary>
              ) : (
                <Ghost>Finish the queue to seal this</Ghost>
              )}
            </div>
            <p className="quill mt-6 text-[15px] text-[var(--ink-2)]">
              Your SOC 2 evidence, produced by doing the work rather than by
              writing it up afterwards.
            </p>
          </div>
        </Specimen>
      </Section>
    </div>
  );
}
