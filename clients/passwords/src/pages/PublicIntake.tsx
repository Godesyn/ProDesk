import { useState } from 'react';
import { Check, ExternalLink, ShieldCheck } from 'lucide-react';
import { INTAKES } from '../data/mock';
import { KeyMark, Specimen } from '../components/primitives';

/**
 * THE PUBLIC INTAKE FORM — a client supplying credentials to their agency,
 * without an account.
 *
 * Two things this has to earn in the first three seconds: that it's really from
 * their agency, and that the agency's server won't be able to read what they
 * type. Both are said plainly at the top rather than in a footer.
 *
 * And the row that defines the product: where sharing a password would actually
 * HARM them, the form doesn't ask for one. It shows the click-path to grant
 * access at the source instead.
 */
export function PublicIntake({ token }: { token: string }) {
  const intake = INTAKES[0];
  const [values, setValues] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);

  const answerable = intake.rows.filter((r) => !r.steer);
  const done = answerable.filter((r) => values[r.label]?.trim()).length;

  if (sent) {
    return (
      <div
        className="km-ui stage-grid grid min-h-screen place-items-center px-4"
        style={{ background: 'var(--stage)' }}
      >
        <Specimen className="w-full max-w-md p-8 text-center">
          <span className="stamp">Received</span>
          <h1 className="mt-5 text-[24px] font-extrabold tracking-tight">
            That’s everything.
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
            Noize Agency has what they need to get started. Nothing you typed was
            readable by anyone but them.
          </p>
          <button
            type="button"
            className="press mt-6 text-xs font-semibold"
            style={{ color: 'var(--pigment)' }}
          >
            Email me a copy of what I supplied
          </button>
        </Specimen>
      </div>
    );
  }

  return (
    <div
      className="km-ui min-h-screen px-4 py-10"
      style={{ background: 'var(--stage)' }}
    >
      <div className="mx-auto w-full max-w-lg">
        <div className="rise mb-8 flex items-center justify-center gap-2.5">
          <KeyMark seed={11} className="h-4 w-9 text-[var(--ink)]" />
          <span className="text-[15px] font-semibold tracking-tight">
            Noize Agency
          </span>
        </div>

        <div className="rise mb-8 text-center">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">
            A few things to get {intake.client} started
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">
            Nine items, most of them a minute each. You can close this and come
            back to the same link whenever — nothing is lost.
          </p>
        </div>

        {/* The trust line, at the top where it does its job. */}
        <p className="mb-8 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--hair-2)] p-4 text-[12px] leading-relaxed text-[var(--ink-2)]">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 flex-none"
            style={{ color: 'var(--pigment)' }}
          />
          <span>
            Everything you type is scrambled in your own browser before it’s sent.
            Noize can read it; the servers in between cannot, and neither can we.
          </span>
        </p>

        {/* progress */}
        <div className="mb-8">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="spec">PROGRESS</span>
            <span className="num text-xs">
              {done} of {answerable.length}
            </span>
          </div>
          <div
            className="h-[3px] w-full overflow-hidden rounded-full"
            style={{ background: 'var(--hair-2)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(done / answerable.length) * 100}%`,
                background: 'var(--pigment)',
              }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {intake.rows.map((r) => (
            <div
              key={r.label}
              className="rounded-[var(--radius-md)] border p-5"
              style={{
                background: 'var(--card)',
                borderColor: r.steer ? 'var(--pigment)' : 'var(--hair-2)',
                borderStyle: r.steer ? 'dashed' : 'solid',
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{r.label}</h2>
                  <p className="mt-1 text-[12px] leading-relaxed text-[var(--ink-2)]">
                    {r.why}
                  </p>
                </div>
                {values[r.label]?.trim() && (
                  <Check
                    className="h-4 w-4 flex-none"
                    style={{ color: 'var(--pigment)' }}
                  />
                )}
              </div>

              {r.steer ? (
                /* The row that makes this an ACCESS manager: no password field
                   at all, because giving one here would harm them. */
                <div className="mt-4 border-t border-[var(--hair)] pt-4">
                  <p className="text-[12px] leading-relaxed">
                    <span className="font-semibold">Please don’t send a password.</span>{' '}
                    {r.steer.replace('Don’t send a password — ', '').replace('Don’t send a password. ', '')}
                  </p>
                  <button
                    type="button"
                    className="press mt-3 inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-white"
                    style={{ background: 'var(--pigment)' }}
                  >
                    Show me how <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    className="press ml-2 text-xs font-medium text-[var(--ink-3)]"
                  >
                    I’ve done it
                  </button>
                </div>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <input
                    placeholder="Username or email"
                    className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3.5 text-sm outline-none placeholder:text-[var(--ink-3)]"
                  />
                  <input
                    type="password"
                    placeholder="Password"
                    value={values[r.label] ?? ''}
                    onChange={(e) =>
                      setValues((v) => ({ ...v, [r.label]: e.target.value }))
                    }
                    className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3.5 text-sm outline-none placeholder:text-[var(--ink-3)]"
                  />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <span className="spec">SAVED AUTOMATICALLY · /{token.slice(0, 6)}</span>
          <button
            type="button"
            onClick={() => setSent(true)}
            className="press inline-flex h-10 items-center rounded-[var(--radius-pill)] px-6 text-sm font-semibold text-white"
            style={{ background: 'var(--pigment)' }}
          >
            Send it to Noize
          </button>
        </div>

        <p className="spec mt-10 text-center">SECURED BY KEYMASTR — A PRODESK TOOL</p>
      </div>
    </div>
  );
}
