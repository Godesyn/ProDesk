import { Check, ExternalLink, Link2, ShieldCheck } from 'lucide-react';
import { INTAKES } from '../data/mock';
import { Ghost, PageHead, Primary, Section } from '../components/primitives';

/**
 * INTAKE — the reverse of Send, and the real agency wedge (DESIGN.md §5.6).
 *
 * Every agency collects credentials from every new client, and every agency does
 * it with a Google Doc, an email thread or a Slack DM. It is universally awful
 * and nobody has designed it properly.
 *
 * The part that makes this an ACCESS manager rather than a password manager:
 * for platforms where sharing a password is actively harmful — Meta and Google
 * flag cross-country logins as fraud and can restrict the ad account — the row
 * doesn't ask for a password at all. It offers "Grant access instead" with the
 * click-path, and records a DELEGATION. Completion goes up, risk goes down, and
 * the vault ends up holding the right artefact.
 */

const TEMPLATES = [
  'New client onboarding',
  'Website handover',
  'Ad platforms',
  'Blank',
];

export function Intake() {
  const intake = INTAKES[0];
  const supplied = intake.rows.filter((r) => r.status !== 'outstanding').length;
  const outstanding = intake.rows.filter((r) => r.status === 'outstanding');

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="INBOUND"
        title="Ask a client for access"
        lede={
          <>
            One link instead of an email thread. They fill it in without an
            account, everything is encrypted in their browser before it leaves,
            and it files itself into the right vault when it lands.
          </>
        }
        actions={<Primary>New request</Primary>}
      />

      {/* ── Templates ───────────────────────────────────────────────────── */}
      <div className="rise mb-12 flex flex-wrap gap-2 border-y border-[var(--hair)] py-4">
        <span className="spec mr-2 self-center">START FROM</span>
        {TEMPLATES.map((t, i) => (
          <button
            key={t}
            type="button"
            className="press chip"
            data-on={i === 0 || undefined}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── The request ───────────────────────────────────────────────── */}
        <div className="min-w-0">
          <Section
            eyebrow={`SENT ${intake.sent.toUpperCase()}`}
            title={intake.client}
            action={
              <span className="num text-sm font-semibold">
                {supplied} of {intake.rows.length}
              </span>
            }
          >
            <div
              className="mb-5 h-[3px] w-full overflow-hidden rounded-full"
              style={{ background: 'var(--hair-2)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${(supplied / intake.rows.length) * 100}%`,
                  background: 'var(--pigment)',
                }}
              />
            </div>

            <div className="flex flex-col gap-2.5">
              {intake.rows.map((r) => (
                <div
                  key={r.label}
                  className="rounded-[var(--radius-md)] border p-4"
                  style={{
                    background: 'var(--card)',
                    borderColor: r.steer ? 'var(--pigment)' : 'var(--hair-2)',
                    borderStyle: r.steer ? 'dashed' : 'solid',
                  }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 max-w-lg">
                      <div className="flex items-center gap-2">
                        {r.status === 'supplied' && (
                          <Check
                            className="h-3.5 w-3.5 flex-none"
                            style={{ color: 'var(--pigment)' }}
                          />
                        )}
                        {r.status === 'delegated' && (
                          <ShieldCheck
                            className="h-3.5 w-3.5 flex-none"
                            style={{ color: 'var(--pigment)' }}
                          />
                        )}
                        {r.status === 'outstanding' && (
                          <span
                            className="h-1.5 w-1.5 flex-none rounded-full"
                            style={{ background: 'var(--ink-3)' }}
                          />
                        )}
                        <span className="truncate text-sm font-medium">
                          {r.label}
                        </span>
                      </div>
                      {/* The "why" is shown to the client, and it visibly raises
                          completion — people supply what they understand. */}
                      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-2)]">
                        {r.why}
                      </p>

                      {r.steer && (
                        <p className="mt-3 flex gap-2 text-[12px] leading-relaxed">
                          <ShieldCheck
                            className="mt-0.5 h-3.5 w-3.5 flex-none"
                            style={{ color: 'var(--pigment)' }}
                          />
                          <span>
                            {r.steer}{' '}
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 font-semibold"
                              style={{ color: 'var(--pigment)' }}
                            >
                              Show me the steps{' '}
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          </span>
                        </p>
                      )}
                    </div>

                    <span
                      className="chip flex-none"
                      data-tone={r.status === 'delegated' ? 'pigment' : undefined}
                    >
                      {r.status === 'supplied'
                        ? 'Supplied'
                        : r.status === 'delegated'
                          ? 'Granted at source'
                          : 'Waiting'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        </div>

        {/* ── Rail ──────────────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-8">
          <Section eyebrow="THE LINK" title="Share it">
            <div
              className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-4"
              style={{ background: 'var(--card)' }}
            >
              <code className="revealed block truncate">
                keymastr.prodesk.com/i/nw7742
              </code>
              <Ghost className="mt-3">
                <Link2 className="h-3.5 w-3.5" /> Copy link
              </Ghost>
              <p className="mt-3 text-[12px] leading-relaxed text-[var(--ink-2)]">
                They can save and come back to the same link. Nothing they type is
                readable by us — it’s encrypted in their browser before it’s sent.
              </p>
            </div>
          </Section>

          {outstanding.length > 0 && (
            <Section eyebrow="STILL WAITING" title="Chase">
              <ul className="mb-4 flex flex-col gap-1.5">
                {outstanding.map((r) => (
                  <li key={r.label} className="text-[13px] text-[var(--ink-2)]">
                    · {r.label}
                  </li>
                ))}
              </ul>
              <Primary>Send a nudge</Primary>
              <p className="spec mt-3">NAMES ONLY WHAT'S MISSING</p>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
