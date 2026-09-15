import { useState } from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import { FINDINGS, FINDINGS_RESOLVED, HEALTH_SCORE } from '../data/mock';
import { Ghost, PageHead, Section } from '../components/primitives';

/**
 * WATCHTOWER — hygiene, framed as consequence rather than a grade.
 *
 * Hygiene dashboards die for two reasons: they scold, and you can't dismiss
 * them. So every finding here says what could HAPPEN in one plain sentence, has
 * exactly one gesture to fix it, and can be snoozed WITH A WRITTEN REASON that
 * shows on the row when it returns. That last control is why the screen survives
 * month three (DESIGN.md §5.7).
 */

function Sparkline() {
  // 12 weeks of score, drawn as a hairline. Trend, not a chart.
  const pts = [68, 70, 69, 73, 72, 76, 74, 78, 79, 77, 80, 82];
  const d = pts
    .map((p, i) => `${(i / (pts.length - 1)) * 100},${28 - ((p - 60) / 30) * 24}`)
    .join(' L ');
  return (
    <svg viewBox="0 0 100 30" className="h-7 w-32" fill="none" aria-hidden="true">
      <path
        d={`M ${d}`}
        stroke="var(--ink-3)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Health() {
  const [snoozed, setSnoozed] = useState<string[]>([]);
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const live = FINDINGS.filter((f) => !snoozed.includes(f.id));
  const alarms = live.filter((f) => f.tone === 'alarm');

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="THE WATCHTOWER"
        title="What could go wrong"
        lede={
          <>
            Not a grade and not a nag — a list of the things that would actually
            cost you something, each with one gesture to close it. Anything you
            decide is fine can be snoozed, and the reason you gave comes back with it.
          </>
        }
      />

      {/* ── Score ───────────────────────────────────────────────────────── */}
      <div className="rise mb-10 flex flex-wrap items-center gap-x-10 gap-y-5 border-y border-[var(--hair)] py-6">
        <div className="flex items-end gap-4">
          <span className="num text-[52px] font-extrabold leading-none">
            {HEALTH_SCORE}
          </span>
          <div className="pb-1.5">
            <div className="spec">HEALTH · 12 WEEKS</div>
            <Sparkline />
          </div>
        </div>
        {/* The sentence that matters, right beside the number. */}
        <p className="quill max-w-md flex-1 text-[19px] leading-snug">
          Three keys are reused between Acme and Bellweather. If one leaks, both do.
        </p>
      </div>

      {/* ── Findings ────────────────────────────────────────────────────── */}
      <Section
        eyebrow={`${live.length} OPEN · ${alarms.length} URGENT`}
        title="Findings"
        action={
          snoozed.length > 0 ? (
            <button
              type="button"
              onClick={() => setSnoozed([])}
              className="text-xs font-semibold"
              style={{ color: 'var(--pigment)' }}
            >
              Show {snoozed.length} snoozed
            </button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          {live.map((f) => (
            <div
              key={f.id}
              className="specimen rounded-[var(--radius-md)] p-5"
              style={{
                borderColor: f.tone === 'alarm' ? 'var(--alarm)' : 'var(--hair-2)',
              }}
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{
                        background:
                          f.tone === 'alarm' ? 'var(--alarm)' : 'var(--ink-3)',
                      }}
                    />
                    <span className="spec">{f.check}</span>
                    <span className="num text-[11px] text-[var(--ink-3)]">
                      · {f.count}
                    </span>
                  </div>
                  <p className="mt-2.5 text-sm leading-relaxed">{f.consequence}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {f.keys.map((k) => (
                      <span key={k} className="chip">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="flex flex-none flex-col items-end gap-2">
                  <button
                    type="button"
                    className="press inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] px-4 text-sm font-semibold"
                    style={{
                      background:
                        f.tone === 'alarm' ? 'var(--alarm)' : 'var(--pigment)',
                      color: '#fff',
                    }}
                  >
                    {f.fix} <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSnoozing(f.id);
                      setReason('');
                    }}
                    className="press inline-flex items-center gap-1.5 text-xs text-[var(--ink-3)]"
                  >
                    <Clock className="h-3 w-3" /> Snooze
                  </button>
                </div>
              </div>

              {/* Snoozing REQUIRES a reason — that's what makes it honest, and
                  it's what comes back with the finding in 90 days. */}
              {snoozing === f.id && (
                <div className="pop mt-4 border-t border-[var(--hair)] pt-4">
                  <label className="spec mb-2 block">
                    WHY IS THIS FINE? (SHOWN WHEN IT RETURNS)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. account closes at the end of the quarter"
                      className="h-9 min-w-[240px] flex-1 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3.5 text-sm outline-none placeholder:text-[var(--ink-3)]"
                    />
                    <select className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm">
                      <option>30 days</option>
                      <option>90 days</option>
                    </select>
                    <Ghost
                      onClick={() => {
                        if (!reason.trim()) return;
                        setSnoozed((s) => [...s, f.id]);
                        setSnoozing(null);
                      }}
                    >
                      Snooze it
                    </Ghost>
                  </div>
                </div>
              )}
            </div>
          ))}

          {live.length === 0 && (
            <p className="quill py-14 text-center text-[19px]">
              Nothing outstanding. Everything is where it should be.
            </p>
          )}
        </div>
      </Section>

      {/* The only place this product congratulates you — which is what makes it
          land when it does. */}
      <p className="spec mt-10 border-t border-[var(--hair)] pt-5">
        {FINDINGS_RESOLVED} FINDINGS RESOLVED THIS QUARTER
      </p>
    </div>
  );
}
