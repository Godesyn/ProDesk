import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, X } from 'lucide-react';
import { primaryHexOf } from '@server/modules/logo/layout';
import { useTRPC } from '@shared/lib/trpc';
import { SvgMark } from '../components/SvgMark';
import { LogoSuite } from '../components/LogoSuite';

/**
 * The PUBLIC brand rulebook (`/share/:brand/:version`, or the legacy `/g/:token`)
 * — no account, no auth. The share token
 * is the only credential, and the procedure behind it returns just the rulebook
 * (never the brief, the other concepts, or anything about the account).
 *
 * Rendered outside the studio shell but inside `.logo-ui` so it keeps the
 * studio's ink-on-paper register: this page is a brand's public face.
 */
export function PublicGuidelines({ token }: { token: string }) {
  const trpc = useTRPC();
  const q = useQuery(
    trpc.logo.guidelines.public.queryOptions({ token }, { retry: false }),
  );

  if (q.isLoading) {
    return (
      <div
        className="logo-ui grid min-h-screen place-items-center"
        style={{ background: 'var(--stage)' }}
      >
        <Loader2 className="h-7 w-7 animate-spin text-[var(--ink-3)]" />
      </div>
    );
  }

  if (q.isError || !q.data) {
    return (
      <div
        className="logo-ui grid min-h-screen place-items-center px-6 text-center"
        style={{ background: 'var(--stage)' }}
      >
        <div>
          <p className="text-lg font-semibold text-[var(--ink)]">
            This link isn’t available.
          </p>
          <p className="mt-1.5 text-sm text-[var(--ink-2)]">
            The guidelines may have been unpublished, or the link is incomplete.
          </p>
        </div>
      </div>
    );
  }

  const g = q.data;
  const dos = g.rules.filter((r) => r.do);
  const donts = g.rules.filter((r) => !r.do);
  // Clearspace and the size ladder are statements about the MARK in a square, so
  // they show the ink-centred square lockup. The raw mark carries whatever offset
  // the artwork has inside its own viewBox, which at 16–24px reads as off-centre.
  const squareMark = g.lockups.mark || g.svg;

  return (
    <div
      className="logo-ui min-h-screen"
      style={{ background: 'var(--stage)' }}
    >
      <div className="mx-auto max-w-[960px] px-4 pb-24 pt-10 sm:px-6 lg:px-8">
        {/* Masthead */}
        <header className="rise flex flex-wrap items-center justify-between gap-6 border-b border-[var(--hair-2)] pb-8">
          <div className="min-w-0">
            <p className="spec">Brand guidelines</p>
            <h1 className="mt-2 text-h1 text-[var(--ink)]">{g.brandName}</h1>
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              How to use the mark — clearspace, sizing, colour, and the rules
              that keep it consistent.
            </p>
          </div>
          <div className="specimen stage-grid grid h-28 w-28 shrink-0 place-items-center rounded-[var(--radius-lg)]">
            <SvgMark
              svg={g.svg}
              animate
              className="h-16 w-16"
              title={g.markName}
            />
          </div>
        </header>

        {/* The suite — the same twelve files the owner exports (components/LogoSuite). */}
        <LogoSuite
          className="mt-10"
          suite={g.suite}
          stem={g.stem}
          primaryHex={primaryHexOf(g.palette)}
        />

        {/* Clearspace + sizes */}
        <section className="mt-10 grid gap-6 lg:grid-cols-2">
          <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
            <p className="spec">Clearspace</p>
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              Keep {g.clearspace} of cap-height clear on every side.
            </p>
            <div className="stage-grid mt-5 grid place-items-center rounded-[var(--radius-md)] border border-[var(--hair-2)] py-10">
              <div className="relative grid place-items-center p-12">
                <div className="pointer-events-none absolute inset-3 rounded-sm border border-dashed border-[var(--hair-2)]" />
                <SvgMark svg={squareMark} className="h-20 w-20" />
              </div>
            </div>
          </div>

          <div className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
            <p className="spec">Minimum sizes</p>
            <p className="mt-2 text-sm text-[var(--ink-2)]">
              Shown at true size — below 24px, use the mark alone.
            </p>
            <div className="mt-6 flex flex-wrap items-end justify-around gap-6">
              {g.minSizes.map((s) => (
                <div key={s.px} className="flex flex-col items-center gap-3">
                  <SvgMark
                    svg={squareMark}
                    style={{ width: s.px, height: s.px }}
                    title={`${s.px}px`}
                  />
                  <div
                    className="text-center"
                    style={{ width: Math.max(s.px, 44) }}
                  >
                    <div className="spec tnum">{s.px}px</div>
                    <div className="spec" style={{ fontSize: 9 }}>
                      {s.label}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Palette */}
        {!!g.palette.length && (
          <section className="mt-10 rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7">
            <p className="spec">Palette</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {g.palette.map((c, i) => (
                <div
                  key={`${c.hex}-${i}`}
                  className="flex items-center gap-3.5"
                >
                  <span
                    className="swatch h-11 w-11 shrink-0 rounded-[var(--radius-md)]"
                    style={{ background: c.hex }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">
                      {c.name}
                    </p>
                    <p className="spec" style={{ fontSize: 10 }}>
                      {c.role}
                    </p>
                  </div>
                  <span className="spec tnum shrink-0">
                    {c.hex.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Rules */}
        <section className="mt-6 grid gap-6 md:grid-cols-2">
          {[
            { ok: true, title: 'Do', items: dos },
            { ok: false, title: 'Don’t', items: donts },
          ].map((col) => (
            <div
              key={col.title}
              className="rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-5 sm:p-7"
            >
              <div className="flex items-center gap-2">
                <span
                  className="grid h-6 w-6 place-items-center rounded-full text-white"
                  style={{
                    background: col.ok
                      ? 'var(--pigment)'
                      : 'var(--color-danger)',
                  }}
                >
                  {col.ok ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </span>
                <h3 className="text-base font-bold text-[var(--ink)]">
                  {col.title}
                </h3>
              </div>
              <ul className="mt-4 space-y-3">
                {col.items.map((r) => (
                  <li
                    key={r.text}
                    className="flex gap-3 text-sm text-[var(--ink-2)]"
                  >
                    <span
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: col.ok
                          ? 'var(--pigment)'
                          : 'var(--color-danger)',
                      }}
                    />
                    {r.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <footer className="mt-12 border-t border-[var(--hair-2)] pt-6">
          <p className="spec">{g.markName} · made in Prodesk Logo Studio</p>
        </footer>
      </div>
    </div>
  );
}
