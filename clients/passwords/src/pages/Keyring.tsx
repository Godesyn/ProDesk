import { Link } from 'wouter';
import { ArrowRight, Plus } from 'lucide-react';
import {
  ATTENTION,
  BRANDS,
  EVENTS,
  HEALTH_SCORE,
  PEOPLE,
  TOTAL_KEYS,
  brandName,
  personName,
} from '../data/mock';
import { KeyMark, Section, Specimen } from '../components/primitives';

/**
 * KEYRING — home. In three seconds: what needs you today, and where everything
 * lives. This is the screen the brief asked for — "the user sees a list of
 * brands and their passwords" — with the day's work pinned above it.
 */

/** The four-segment health bar. A clean vault is one unbroken hairline. */
function HealthBar({
  split,
}: {
  split: { strong: number; weak: number; stale: number; breached: number };
}) {
  const total = split.strong + split.weak + split.stale + split.breached || 1;
  const seg = [
    { n: split.strong, c: 'var(--ink-2)' },
    { n: split.weak, c: 'var(--color-ink-20)' },
    { n: split.stale, c: 'var(--color-ink-10)' },
    { n: split.breached, c: 'var(--alarm)' },
  ];
  return (
    <span className="flex h-[3px] w-full gap-[2px] overflow-hidden rounded-full">
      {seg
        .filter((s) => s.n > 0)
        .map((s, i) => (
          <span
            key={i}
            style={{ width: `${(s.n / total) * 100}%`, background: s.c }}
          />
        ))}
    </span>
  );
}

export function Keyring() {
  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      {/* ── Attention strip ───────────────────────────────────────────────
          Only rendered when non-empty. At most four chips, ranked by
          consequence, each one gesture from done. */}
      {ATTENTION.length > 0 ? (
        <div className="rise mb-10 flex snap-x gap-3 overflow-x-auto pb-1">
          {ATTENTION.map((a) => (
            <Link
              key={a.id}
              href={a.href}
              className="lift flex min-w-[280px] snap-start items-start gap-3 rounded-[var(--radius-md)] border p-4"
              style={{
                background: 'var(--card)',
                borderColor: a.tone === 'alarm' ? 'var(--alarm)' : 'var(--hair-2)',
              }}
            >
              <span
                className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full"
                style={{
                  background: a.tone === 'alarm' ? 'var(--alarm)' : 'var(--ink-3)',
                }}
              />
              <span className="min-w-0">
                <span className="block text-sm leading-snug">{a.text}</span>
                <span
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold"
                  style={{
                    color: a.tone === 'alarm' ? 'var(--alarm)' : 'var(--pigment)',
                  }}
                >
                  {a.action} <ArrowRight className="h-3 w-3" />
                </span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        /* The reward state a security tool never gives you. */
        <div className="rise mb-10 border-y border-[var(--hair)] py-6 text-center">
          <p className="quill text-[19px]">
            Nothing needs you. Everything is where it should be.
          </p>
        </div>
      )}

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="mb-14 grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rise">
          <div className="spec">YOUR KEYRING</div>
          <h1 className="text-display mt-3 font-extrabold">
            <span className="num">{TOTAL_KEYS}</span> keys across{' '}
            <span className="quill" style={{ color: 'var(--pigment)' }}>
              {BRANDS.length} brands
            </span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-[var(--ink-2)]">
            Everything you can reach, in one place — your own brands and the ones
            you work on through an agency. Press{' '}
            <span className="spec" style={{ fontSize: 11 }}>
              ⌘K
            </span>{' '}
            anywhere to find a key and copy it without ever putting it on screen.
          </p>

          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {[
              { k: 'Keys', v: String(TOTAL_KEYS) },
              { k: 'Health', v: String(HEALTH_SCORE), pigment: true },
              { k: 'People', v: String(PEOPLE.length) },
            ].map((s) => (
              <div key={s.k}>
                <dd
                  className="num text-[30px] font-extrabold leading-none"
                  style={{ color: s.pigment ? 'var(--pigment)' : undefined }}
                >
                  {s.v}
                </dd>
                <dt className="spec mt-1.5">{s.k}</dt>
              </div>
            ))}
          </dl>
        </div>

        {/* The keyring specimen — every brand's key on one ring, each silhouette
            derived from the brand id so it's stable and becomes recognisable. */}
        <Specimen
          className="stage-grid relative aspect-[4/3]"
          corners={[
            `${BRANDS.length} · BRANDS`,
            `${TOTAL_KEYS} · KEYS`,
            'AES-256-GCM',
            'E2E · ZERO-KNOWLEDGE',
          ]}
        >
          <div className="absolute inset-0 grid place-items-center">
            <div className="relative h-44 w-44">
              {/* the ring */}
              <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
                <circle
                  cx="50"
                  cy="50"
                  r="20"
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  pathLength={1}
                  data-draw
                />
              </svg>
              {/* the keys, fanned */}
              {BRANDS.map((b, i) => {
                const angle = -60 + (i * 120) / Math.max(BRANDS.length - 1, 1);
                return (
                  <div
                    key={b.id}
                    className="absolute left-1/2 top-1/2 h-5 w-11 origin-left"
                    style={{
                      transform: `rotate(${angle}deg) translateX(18px) translateY(-50%)`,
                      color: i === 0 ? 'var(--pigment)' : 'var(--ink)',
                    }}
                  >
                    <KeyMark seed={b.seed} className="h-full w-full" />
                  </div>
                );
              })}
            </div>
          </div>
        </Specimen>
      </div>

      {/* ── Brand board ─────────────────────────────────────────────────── */}
      <div className="mb-14">
        <Section eyebrow="WHERE EVERYTHING LIVES" title="Your brands">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {BRANDS.map((b) => (
              <Link
                key={b.id}
                href={`/b/${b.id}`}
                className="lift group block rounded-[var(--radius-md)] border border-[var(--hair-2)] p-5"
                style={{ background: 'var(--card)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[16px] font-semibold tracking-tight">
                      {b.name}
                    </h3>
                    <p className="spec mt-1 truncate">
                      {b.via ? `VIA ${b.via}` : b.role}
                    </p>
                  </div>
                  <KeyMark
                    seed={b.seed}
                    animate={false}
                    className="h-4 w-9 flex-none text-[var(--ink-3)]"
                  />
                </div>

                <p className="num mt-5 text-xs text-[var(--ink-2)]">
                  {b.keys} keys · {b.people} people
                  {b.sharedOut > 0 && ` · ${b.sharedOut} shared out`}
                </p>
                <div className="mt-2">
                  <HealthBar split={b.split} />
                </div>

                <div className="mt-5 flex items-center justify-between border-t border-[var(--hair)] pt-3">
                  <span className="spec">LAST OPENED {b.lastOpened}</span>
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold opacity-0 transition group-hover:opacity-100"
                    style={{ color: 'var(--pigment)' }}
                  >
                    Open vault <ArrowRight className="h-3 w-3" />
                  </span>
                </div>
              </Link>
            ))}

            <button
              type="button"
              className="lift flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--hair-2)] text-[var(--ink-3)]"
            >
              <Plus className="h-5 w-5" />
              <span className="text-sm font-medium">New brand</span>
            </button>
          </div>
        </Section>
      </div>

      {/* ── Recent activity ─────────────────────────────────────────────── */}
      <Section
        eyebrow="THE REGISTER"
        title="Recently"
        action={
          <Link
            href="/register"
            className="text-xs font-semibold"
            style={{ color: 'var(--pigment)' }}
          >
            See everything →
          </Link>
        }
      >
        <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]">
          {EVENTS.slice(0, 6).map((e) => (
            <div
              key={e.id}
              className="ledger-row flex items-center gap-3 px-4 py-2.5 last:border-b-0"
            >
              <span className="spec w-24 flex-none">{e.at}</span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium">{personName(e.who)}</span>{' '}
                <span
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
                </span>{' '}
                <span className="text-[var(--ink-2)]">{e.item}</span>
              </span>
              <span className="spec hidden flex-none sm:block">
                {brandName(e.brandId)}
              </span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
