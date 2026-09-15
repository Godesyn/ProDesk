import { useState } from 'react';
import { Check, Clock, UserPlus } from 'lucide-react';
import { BRANDS, PEOPLE } from '../data/mock';
import { Ghost, PageHead, Primary, Section } from '../components/primitives';

/**
 * TEAM — the scoped `passwords` permission panel, per the template's Team &
 * permissions rules.
 *
 * The rule that matters and is easy to get wrong: list EVERY active teammate of
 * the brand, not only those who already hold `passwords`. Someone added from
 * another tool must be visible here or a manager has no way to grant them
 * access. Grant adds the permission; Revoke strips only ours and leaves the rest.
 *
 * Above that sits the KEYMASTR-specific layer: app access and VAULT access are
 * different things, so "has the app but no keys" is shown as a visible, fixable
 * state rather than a confusing dead end.
 */

const REQUESTS = [
  {
    id: 'r1',
    who: 'Devan Roy',
    key: 'Stripe — live keys',
    brand: 'Acme Coffee',
    reason: 'Reconciling the September payouts with the invoice run.',
    when: '18m ago',
  },
];

export function Team() {
  const [access, setAccess] = useState<Record<string, 'editor' | 'viewer' | null>>({
    sajat: 'editor',
    priya: 'editor',
    devan: 'viewer',
    marcus: null,
    joanne: 'editor',
    noor: 'viewer',
  });

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="ONE TEAM, PER-TOOL ACCESS"
        title="Who’s on the team"
        lede={
          <>
            Everyone on the brand’s team is listed here, including people added
            from another Prodesk tool — so you can grant them a vault without
            inviting them twice.
          </>
        }
        actions={
          <Primary>
            <UserPlus className="h-3.5 w-3.5" /> Invite
          </Primary>
        }
      />

      {/* ── Access requests ─────────────────────────────────────────────── */}
      {REQUESTS.length > 0 && (
        <div className="mb-12">
          <Section eyebrow="WAITING ON YOU" title="Access requests">
            {REQUESTS.map((r) => (
              <div
                key={r.id}
                className="rounded-[var(--radius-md)] border p-5"
                style={{ borderColor: 'var(--pigment)', background: 'var(--card)' }}
              >
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 max-w-lg">
                    <p className="text-sm">
                      <span className="font-semibold">{r.who}</span> asked for{' '}
                      <span className="font-medium">{r.key}</span> in {r.brand}.
                    </p>
                    <p className="quill mt-2 text-[15px] text-[var(--ink-2)]">
                      “{r.reason}”
                    </p>
                    <p className="spec mt-2">{r.when}</p>
                  </div>
                  <div className="flex flex-none flex-wrap items-center gap-2">
                    {/* Time-boxed is the DEFAULT — just-in-time access, one click,
                        and the grant carries its own drain ring. */}
                    <select className="h-9 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3 text-sm">
                      <option>7 days</option>
                      <option>30 days</option>
                      <option>Indefinitely</option>
                    </select>
                    <Primary>
                      <Clock className="h-3.5 w-3.5" /> Grant
                    </Primary>
                    <Ghost tone="alarm">Decline</Ghost>
                  </div>
                </div>
              </div>
            ))}
          </Section>
        </div>
      )}

      {/* ── The team ────────────────────────────────────────────────────── */}
      <Section eyebrow={`${PEOPLE.length} TEAMMATES`} title="Team">
        <div
          className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
          style={{ background: 'var(--card)' }}
        >
          {PEOPLE.map((p) => {
            const level = access[p.id];
            return (
              <div
                key={p.id}
                className="ledger-row flex flex-wrap items-center gap-3 px-4 py-3 last:border-b-0"
              >
                <span
                  className="grid h-8 w-8 flex-none place-items-center rounded-full text-[11px] font-semibold"
                  style={{ background: 'var(--stage-2)', color: 'var(--ink-2)' }}
                >
                  {p.name
                    .split(' ')
                    .map((n) => n[0])
                    .join('')}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{p.name}</span>
                  <span className="block truncate text-[11px] text-[var(--ink-3)]">
                    {p.org}
                    {p.external && ' · external'}
                  </span>
                </span>

                {p.departed ? (
                  <span className="chip flex-none" data-tone="alarm">
                    Left {p.departed}
                  </span>
                ) : level ? (
                  <>
                    <div
                      className="hidden flex-none rounded-[var(--radius-pill)] p-0.5 sm:inline-flex"
                      style={{ background: 'var(--stage-2)' }}
                    >
                      {(['editor', 'viewer'] as const).map((l) => (
                        <button
                          key={l}
                          type="button"
                          onClick={() =>
                            setAccess((a) => ({ ...a, [p.id]: l }))
                          }
                          className="press rounded-[var(--radius-pill)] px-3 py-1 text-[11px] font-semibold capitalize transition"
                          style={{
                            background: level === l ? 'var(--ink)' : 'transparent',
                            color: level === l ? 'var(--stage)' : 'var(--ink-2)',
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => setAccess((a) => ({ ...a, [p.id]: null }))}
                      className="press flex-none text-xs font-semibold"
                      style={{ color: 'var(--alarm)' }}
                    >
                      Revoke access
                    </button>
                  </>
                ) : (
                  <>
                    {/* The state that would otherwise be a dead end, named. */}
                    <span className="spec hidden flex-none sm:block">
                      NO VAULT ACCESS
                    </span>
                    <button
                      type="button"
                      onClick={() => setAccess((a) => ({ ...a, [p.id]: 'viewer' }))}
                      className="press inline-flex h-8 flex-none items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold"
                      style={{ borderColor: 'var(--pigment)', color: 'var(--pigment)' }}
                    >
                      <Check className="h-3 w-3" /> Grant access
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <p className="mt-4 max-w-2xl text-xs leading-relaxed text-[var(--ink-2)]">
          <span className="font-semibold">Editor</span> can create, share, reveal
          and rotate. <span className="font-semibold">Viewer</span> can find a key
          and copy it into a form, but never reveal it on screen and never share
          it onward — which covers most of what most people need.
        </p>
      </Section>

      {/* ── Vault-level roles ───────────────────────────────────────────── */}
      <div className="mt-12">
        <Section eyebrow="PER BRAND" title="Which vaults">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BRANDS.map((b) => (
              <div
                key={b.id}
                className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-4"
                style={{ background: 'var(--card)' }}
              >
                <h3 className="truncate text-sm font-semibold">{b.name}</h3>
                <p className="num mt-1.5 text-[11px] text-[var(--ink-3)]">
                  {b.people} people · {b.keys} keys
                </p>
                <div className="mt-3 flex -space-x-1.5">
                  {PEOPLE.slice(0, b.people).map((p) => (
                    <span
                      key={p.id}
                      title={p.name}
                      className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-semibold ring-2"
                      style={{
                        background: 'var(--stage-2)',
                        color: 'var(--ink-2)',
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        ['--tw-ring-color' as any]: 'var(--card)',
                      }}
                    >
                      {p.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}
