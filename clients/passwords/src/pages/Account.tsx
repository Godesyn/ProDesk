import { Link } from 'wouter';
import { Fingerprint, Laptop, Printer, ShieldCheck } from 'lucide-react';
import { useCurrentUser } from '@shared/auth/auth-context';
import { PEOPLE } from '../data/mock';
import { Ghost, PageHead, Primary, Section, Specimen } from '../components/primitives';

/**
 * ACCOUNT — the native profile screen (every frontend keeps its own so the shell
 * never breaks skin mid-session; the shared ProfilePage is only used before a
 * role exists).
 *
 * The KEYMASTR-specific half is below the profile: this is the one app where a
 * user's own key material matters to them, so their fingerprint, their recovery
 * kit and their signed-in devices are first-class rather than buried in settings.
 */

const DEVICES = [
  { name: 'MacBook Pro · Melbourne AU', when: 'active now', current: true },
  { name: 'iPhone 16 · Melbourne AU', when: '2 hours ago', current: false },
  { name: 'Chrome · Sydney AU', when: '11 days ago', current: false },
];

export function Account() {
  const { data: user } = useCurrentUser();
  const me = PEOPLE[0];
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || me.name;

  const input =
    'h-9 w-full rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-3.5 text-sm outline-none';

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead eyebrow="YOUR ACCOUNT" title={name} lede={user?.email ?? undefined} />

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <Section eyebrow="PROFILE" title="Details">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['First name', user?.firstName ?? ''],
                ['Last name', user?.lastName ?? ''],
                ['Email', user?.email ?? ''],
                ['Role', user?.role ?? ''],
              ].map(([label, value]) => (
                <label key={label} className="block">
                  <span className="spec mb-1.5 block">{label}</span>
                  <input className={input} defaultValue={value} />
                </label>
              ))}
            </div>
            <Primary className="mt-5">Save changes</Primary>
          </Section>

          <div className="mt-12">
            <Section eyebrow="SIGNED IN" title="Your devices">
              <div
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
                style={{ background: 'var(--card)' }}
              >
                {DEVICES.map((d) => (
                  <div
                    key={d.name}
                    className="ledger-row flex items-center gap-3 px-4 py-3 last:border-b-0"
                  >
                    <Laptop className="h-4 w-4 flex-none text-[var(--ink-3)]" />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {d.name}
                    </span>
                    <span className="spec flex-none">{d.when}</span>
                    {d.current ? (
                      <span className="chip flex-none" data-tone="pigment">
                        This one
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="press flex-none text-xs font-semibold"
                        style={{ color: 'var(--alarm)' }}
                      >
                        Sign out
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          </div>

          <div className="mt-12">
            <Section eyebrow="ELSEWHERE" title="Other screens">
              <div className="flex flex-wrap gap-2">
                <Link href="/support">
                  <Ghost>Support tickets</Ghost>
                </Link>
                <Link href="/billing">
                  <Ghost>Billing</Ghost>
                </Link>
                <Link href="/trust">
                  <Ghost>How this works</Ghost>
                </Link>
              </div>
            </Section>
          </div>
        </div>

        {/* ── Key material ──────────────────────────────────────────────── */}
        <aside className="flex flex-col gap-8">
          <Specimen className="p-6">
            <div className="pt-4">
              <div className="flex items-center gap-2">
                <Fingerprint
                  className="h-4 w-4"
                  style={{ color: 'var(--pigment)' }}
                />
                <span className="spec">YOUR FINGERPRINT</span>
              </div>
              <p className="num mt-3 text-[13px] leading-relaxed">
                {me.fingerprint.split(' ').join(' · ')}
              </p>
              <p className="mt-4 border-t border-[var(--hair)] pt-4 text-[12px] leading-relaxed text-[var(--ink-2)]">
                This is what a teammate confirms the first time they share with
                you. Read it to them out loud — that is the whole point of it
                being six ordinary words rather than forty characters of hex.
              </p>
            </div>
          </Specimen>

          <Section eyebrow="IF YOU LOSE ACCESS" title="Recovery">
            <div
              className="rounded-[var(--radius-md)] border p-5"
              style={{ borderColor: 'var(--pigment)', background: 'var(--card)' }}
            >
              <p className="text-sm leading-relaxed text-[var(--ink-2)]">
                We can’t reset your passphrase — nobody here can read your vault,
                which is what makes it worth having. Print the kit and name a
                contact and you are covered either way.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Primary>
                  <Printer className="h-3.5 w-3.5" /> Print recovery kit
                </Primary>
              </div>
              <div className="mt-4 flex items-center gap-2 border-t border-[var(--hair)] pt-4">
                <ShieldCheck
                  className="h-3.5 w-3.5 flex-none"
                  style={{ color: 'var(--pigment)' }}
                />
                <span className="text-[12px] text-[var(--ink-2)]">
                  2 recovery contacts named
                </span>
              </div>
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}
