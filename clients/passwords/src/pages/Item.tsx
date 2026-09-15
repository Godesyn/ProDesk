import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { ArrowLeft, ExternalLink, RotateCw, Trash2 } from 'lucide-react';
import { PEOPLE, brandName, itemById, personName } from '../data/mock';
import {
  Chip,
  Drain,
  Ghost,
  Pips,
  Primary,
  Secret,
  Section,
} from '../components/primitives';

/**
 * ITEM SHEET — everything about one key, including the two questions no
 * competitor answers: who else can open this, and what breaks if it goes.
 *
 * Not a modal. A full specimen sheet, because here the item IS the artefact.
 * Layout: fields (fluid) · access + history rail (320, sticky).
 */

/* ---------------------------------------------------------------- TOTP ---- */

/**
 * The one-time code, with the drain ring as its 30-second window — the SAME ring
 * as the reveal, the share and the grant. Six mechanisms, one shape: learn the
 * ring once and you've learned the security model.
 *
 * Sharing 2FA without sharing a phone is the single most-requested team feature
 * in this category.
 */
function Totp({ code }: { code: string }) {
  const [left, setLeft] = useState(30);
  useEffect(() => {
    const t = window.setInterval(
      () => setLeft((n) => (n <= 1 ? 30 : n - 1)),
      1000,
    );
    return () => window.clearInterval(t);
  }, []);
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className="revealed text-[15px] tracking-[0.18em]"
        style={{ color: 'var(--pigment)' }}
      >
        {code}
      </span>
      <Drain remaining={left / 30} title={`${left}s`} />
      <span className="spec">{left}S</span>
    </span>
  );
}

/* --------------------------------------------------------------- fields --- */

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 border-b border-[var(--hair)] py-3.5 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
      <div className="spec sm:pt-1">{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Item() {
  const { id } = useParams<{ id: string }>();
  const item = itemById(id ?? '');

  if (!item) {
    return (
      <div className="mx-auto max-w-[1240px] px-6 py-20 text-center">
        <p className="text-sm text-[var(--ink-3)]">That key isn’t in your vault.</p>
        <Link
          href="/vault"
          className="mt-3 inline-block text-sm font-semibold"
          style={{ color: 'var(--pigment)' }}
        >
          ← Back to the vault
        </Link>
      </div>
    );
  }

  const holders = PEOPLE.filter((p) => item.holders.includes(p.id));

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <Link
        href="/vault"
        className="spec press mb-6 inline-flex items-center gap-1.5 hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-3 w-3" /> VAULT
      </Link>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="rise mb-8 flex flex-wrap items-end justify-between gap-5 border-b border-[var(--hair)] pb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/b/${item.brandId}`}>
              <Chip>{brandName(item.brandId)}</Chip>
            </Link>
            {item.tags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
            <Pips health={item.health} />
          </div>
          <h1 className="mt-3 text-[30px] font-extrabold leading-none tracking-[-0.03em]">
            {item.name}
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-2)]">{item.identity}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {item.url && (
            <Ghost>
              Launch <ExternalLink className="h-3.5 w-3.5" />
            </Ghost>
          )}
          <Primary>
            <RotateCw className="h-3.5 w-3.5" /> Rotate this key
          </Primary>
        </div>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Fields ────────────────────────────────────────────────────── */}
        <div className="min-w-0">
          {/* A DELEGATION is not a secret. It gets a dashed frame and a revoke
              deep link, so it never reads as something you can copy. */}
          {item.delegation ? (
            <Section eyebrow="NOT A PASSWORD" title="Delegated access">
              <div
                className="rounded-[var(--radius-md)] border border-dashed p-5"
                style={{ borderColor: 'var(--pigment)', background: 'var(--card)' }}
              >
                <p className="text-sm leading-relaxed text-[var(--ink-2)]">
                  Nobody stored a password for this. {item.delegation.grantedBy}{' '}
                  granted us access at the source on {item.delegation.granted}, which
                  is the right way round — this platform flags shared logins as
                  fraud and can restrict the account.
                </p>
                <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Platform', item.delegation.platform],
                    ['Account', item.delegation.account],
                    ['Level', item.delegation.level],
                    ['Granted by', item.delegation.grantedBy],
                  ].map(([k, v]) => (
                    <div key={k}>
                      <dt className="spec">{k}</dt>
                      <dd className="mt-1 text-sm">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-5 border-t border-[var(--hair)] pt-4">
                  <Ghost tone="alarm">
                    Revoke at source <ExternalLink className="h-3.5 w-3.5" />
                  </Ghost>
                </div>
              </div>
            </Section>
          ) : (
            <Section eyebrow={`${item.fields.length} FIELDS`} title="Details">
              <div className="border-t border-[var(--hair)]">
                {item.fields.map((f) => (
                  <FieldRow key={f.label} label={f.label}>
                    {f.kind === 'secret' && <Secret value={f.value} />}
                    {f.kind === 'totp' && <Totp code={f.value} />}
                    {f.kind === 'url' && (
                      <a
                        href={`https://${f.value}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-sm"
                        style={{ color: 'var(--pigment)' }}
                      >
                        {f.value} <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {(f.kind === 'text' || f.kind === 'note') && (
                      <span className="text-sm">{f.value}</span>
                    )}
                  </FieldRow>
                ))}
              </div>

              {/* Password age, framed by type — a registrar at 3 years is urgent,
                  a newsletter tool is not. A flat 90-day rule is why people stop
                  believing hygiene screens. */}
              {item.age > 0 && (
                <p className="mt-4 text-xs text-[var(--ink-2)]">
                  This password is{' '}
                  <span className="num font-semibold">{item.age} days</span> old.
                  {item.age > 365 && (
                    <span style={{ color: 'var(--alarm)' }}>
                      {' '}
                      For a key that controls infrastructure, that is well past due.
                    </span>
                  )}
                </p>
              )}
            </Section>
          )}

          {/* ── History ──────────────────────────────────────────────────── */}
          <div className="mt-12">
            <Section eyebrow="EVERY VERSION KEPT" title="History">
              <div
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
                style={{ background: 'var(--card)' }}
              >
                {[
                  { v: 'v4', who: 'priya', when: '12 Jul', what: 'password, url' },
                  { v: 'v3', who: 'sajat', when: '2 Apr', what: 'password' },
                  { v: 'v2', who: 'sajat', when: '18 Jan', what: 'one-time code added' },
                  { v: 'v1', who: 'sajat', when: '2 Jan', what: 'created' },
                ].map((h) => (
                  <div
                    key={h.v}
                    className="ledger-row flex items-center gap-3 px-4 py-2.5 last:border-b-0"
                  >
                    <span className="spec w-8 flex-none">{h.v}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="font-medium">{personName(h.who)}</span>{' '}
                      <span className="text-[var(--ink-2)]">changed {h.what}</span>
                    </span>
                    <span className="spec flex-none">{h.when}</span>
                    <button
                      type="button"
                      className="press text-xs font-semibold"
                      style={{ color: 'var(--pigment)' }}
                    >
                      Restore
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        </div>

        {/* ── Access rail ───────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-8 lg:sticky lg:top-20 lg:self-start">
          <Section eyebrow="WHO CAN OPEN THIS" title="Access">
            <div className="flex flex-col gap-3">
              {holders.map((p, i) => (
                <div key={p.id} className="flex items-start gap-3">
                  <span
                    className="grid h-7 w-7 flex-none place-items-center rounded-full text-[10px] font-semibold"
                    style={{ background: 'var(--stage-2)', color: 'var(--ink-2)' }}
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
                    {/* "never opened" is the finding that drives Trim — so it is
                        said plainly, in quiet ink, not hidden in a report. */}
                    <span
                      className="block truncate text-[11px]"
                      style={{
                        color: i === 0 ? 'var(--ink-2)' : 'var(--ink-3)',
                      }}
                    >
                      {i === 0
                        ? 'opened 12× · last Tue'
                        : i === 1
                          ? 'opened 4× · last Tue'
                          : 'never opened'}
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
            <Link
              href="/access"
              className="mt-4 inline-block text-xs font-semibold"
              style={{ color: 'var(--pigment)' }}
            >
              See the whole map →
            </Link>
          </Section>

          {item.shared > 0 && (
            <Section eyebrow="OPEN RIGHT NOW" title="Shared out">
              <div
                className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-3"
                style={{ background: 'var(--card)' }}
              >
                <div className="flex items-center gap-2">
                  <Drain remaining={0.42} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    jo@northwind.studio
                  </span>
                </div>
                <p className="spec mt-1.5">0 OF 1 OPENED · EXPIRES IN 9H</p>
                <button
                  type="button"
                  className="press mt-3 text-xs font-semibold"
                  style={{ color: 'var(--alarm)' }}
                >
                  Revoke now
                </button>
              </div>
            </Section>
          )}

          {/* A standing impact preview — not a dialog you meet AFTER deciding. */}
          <Section eyebrow="IMPACT" title="If you delete this">
            <div
              className="rounded-[var(--radius-md)] border p-4"
              style={{ borderColor: 'var(--hair-2)', background: 'var(--card)' }}
            >
              <ul className="flex flex-col gap-1.5 text-[13px] text-[var(--ink-2)]">
                <li>
                  <span className="num font-semibold text-[var(--ink)]">
                    {item.holders.length}
                  </span>{' '}
                  people lose access
                </li>
                <li>
                  <span className="num font-semibold text-[var(--ink)]">
                    {item.shared}
                  </span>{' '}
                  live share{item.shared === 1 ? '' : 's'} break
                </li>
                <li>
                  Referenced by{' '}
                  <span className="num font-semibold text-[var(--ink)]">2</span>{' '}
                  projects
                </li>
              </ul>
              <button
                type="button"
                className="press mt-4 inline-flex items-center gap-1.5 text-xs font-semibold"
                style={{ color: 'var(--alarm)' }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete this key
              </button>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
