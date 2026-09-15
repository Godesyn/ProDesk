import { useState } from 'react';
import { AlertTriangle, Printer, ShieldAlert } from 'lucide-react';
import { PEOPLE } from '../data/mock';
import { Ghost, PageHead, Primary, Section, Specimen } from '../components/primitives';

/**
 * TRUST — the security model, as a screen.
 *
 * In this category the security model IS a feature, and burying it in a PDF is a
 * lost conversion. So it gets a designed page with a live diagram, the key
 * fingerprints, break-glass, and the honest sentence consumer products dodge.
 *
 * The wedge (DESIGN.md §1): in February 2026 ETH Zürich researchers showed that
 * Bitwarden, LastPass and Dashlane enterprise recovery flows fetch a recipient's
 * public key from the server WITHOUT authenticating it — a compromised server can
 * substitute its own and be handed the vault. Confirming a six-word fingerprint
 * once closes that structurally. It's a real, checkable difference, so we say it
 * plainly rather than hiding behind "military-grade encryption".
 */

const STEPS = [
  {
    n: '01',
    t: 'You type it',
    b: 'The value exists in your browser and nowhere else yet.',
  },
  {
    n: '02',
    t: 'Your device locks it',
    b: 'Encrypted with a key derived from your passphrase, which never leaves this device.',
  },
  {
    n: '03',
    t: 'Only the locked version travels',
    b: 'What reaches us is ciphertext. There is no step where we hold the key.',
  },
  {
    n: '04',
    t: 'Teammates unlock it themselves',
    b: 'The vault key is wrapped once for each person’s own key — so adding someone is one wrap, and removing them is one delete.',
  },
];

export function Trust() {
  const [glass, setGlass] = useState(false);

  return (
    <div className="mx-auto max-w-[1240px] px-4 py-8 sm:px-6 lg:px-8">
      <PageHead
        eyebrow="HOW THIS ACTUALLY WORKS"
        title="What we can and can’t see"
        lede={
          <>
            The short version: we hold the locked box and never the key. The long
            version is on this page, in plain words, because you should not have
            to take a security claim on faith.
          </>
        }
      />

      {/* ── The diagram ─────────────────────────────────────────────────── */}
      <div className="mb-14">
        <Section eyebrow="END TO END" title="What happens when you save a secret">
          <Specimen className="stage-grid p-8">
            <div className="grid gap-6 pt-6 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <div key={s.n} className="relative">
                  {i < STEPS.length - 1 && (
                    <svg
                      className="absolute -right-3 top-3 hidden h-px w-6 lg:block"
                      aria-hidden="true"
                    >
                      <line
                        x1="0"
                        y1="0.5"
                        x2="24"
                        y2="0.5"
                        stroke="var(--hair-2)"
                        strokeDasharray="2 3"
                      />
                    </svg>
                  )}
                  <div className="spec" style={{ color: 'var(--pigment)' }}>
                    {s.n}
                  </div>
                  <h3 className="mt-2 text-[15px] font-semibold tracking-tight">
                    {s.t}
                  </h3>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--ink-2)]">
                    {s.b}
                  </p>
                </div>
              ))}
            </div>
            <p className="quill mt-8 border-t border-[var(--hair)] pt-6 text-[17px]">
              If someone walked out of our office with the whole database, they
              would have a very large amount of noise.
            </p>
          </Specimen>
        </Section>
      </div>

      {/* ── Fingerprints — the wedge ────────────────────────────────────── */}
      <div className="mb-14">
        <Section
          eyebrow="THE PART NOBODY ELSE DOES"
          title="We show you the key"
        >
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0">
              <p className="max-w-xl text-sm leading-relaxed text-[var(--ink-2)]">
                When you share a key with a teammate, your device has to encrypt it
                to <em>their</em> key — which it fetches from a server. In February
                2026 researchers at ETH Zürich showed that three of the biggest
                vaults on the market accept whatever key the server hands back,
                without checking it. A compromised server can substitute its own and
                be given everything.
              </p>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--ink-2)]">
                So we show you the key. Every person has a fingerprint rendered as
                six ordinary words. The first time you share with someone you
                confirm it once — a two-second act — and if their key ever changes,
                sharing <span className="font-semibold">stops</span> until you look
                at the new one.
              </p>

              <div
                className="mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border p-4"
                style={{ borderColor: 'var(--alarm)', background: 'var(--alarm-soft)' }}
              >
                <AlertTriangle
                  className="h-4 w-4 flex-none"
                  style={{ color: 'var(--alarm)' }}
                />
                <span className="text-sm">
                  Priya’s key changed on 3 Aug. Confirm the new one before sharing
                  with her again.
                </span>
                <Ghost tone="alarm" className="ml-auto">
                  Review
                </Ghost>
              </div>
            </div>

            <aside>
              <div className="spec mb-3">FINGERPRINTS</div>
              <div
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--hair-2)]"
                style={{ background: 'var(--card)' }}
              >
                {PEOPLE.map((p) => (
                  <div
                    key={p.id}
                    className="border-b border-[var(--hair)] px-4 py-3 last:border-b-0"
                  >
                    <div className="truncate text-[13px] font-medium">{p.name}</div>
                    <div className="num mt-1 text-[11px] text-[var(--ink-2)]">
                      {p.fingerprint.split(' ').join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </Section>
      </div>

      {/* ── Break glass ─────────────────────────────────────────────────── */}
      <div className="mb-14">
        <Section eyebrow="WHEN SOMETHING GOES WRONG" title="Emergency access">
          <div className="grid gap-4 lg:grid-cols-2">
            <div
              className="rounded-[var(--radius-md)] border border-[var(--hair-2)] p-5"
              style={{ background: 'var(--card)' }}
            >
              <h3 className="text-[15px] font-semibold tracking-tight">
                Recovery contacts
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
                Two named people can start a recovery if you can’t get in. It takes
                48 hours, you’re notified the whole time, and you can stop it with
                one click.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <span className="chip">Joanne Ellis</span>
                <span className="chip">Priya Raghunathan</span>
              </div>
            </div>

            <div
              className="rounded-[var(--radius-md)] border p-5"
              style={{ borderColor: 'var(--alarm)', background: 'var(--card)' }}
            >
              <h3
                className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
                style={{ color: 'var(--alarm)' }}
              >
                <ShieldAlert className="h-4 w-4" /> Break glass
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
                Immediate access to a brand’s whole vault, for the ten minutes
                after something has genuinely gone wrong. Every owner is notified
                the second it starts, and it writes itself into the register in a
                way nobody can tidy up.
              </p>
              <button
                type="button"
                onClick={() => setGlass(true)}
                className="press mt-4 inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold"
                style={{ borderColor: 'var(--alarm)', color: 'var(--alarm)' }}
              >
                Break glass
              </button>
            </div>
          </div>
        </Section>
      </div>

      {/* ── Recovery kit ────────────────────────────────────────────────── */}
      <Section eyebrow="THE HONEST PART" title="If you forget your passphrase">
        <Specimen className="p-8">
          <div className="mx-auto max-w-lg py-4 text-center">
            <p className="quill text-[21px] leading-snug">
              We cannot reset it. That is the point.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-[var(--ink-2)]">
              A vault whose operator can open it is a vault whose operator can be
              compelled to open it. So print the recovery kit, put it somewhere
              physical, and name your recovery contacts above. Those are the two
              things that make this safe rather than merely private.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Primary>
                <Printer className="h-3.5 w-3.5" /> Print my recovery kit
              </Primary>
              <Ghost>Name a recovery contact</Ghost>
            </div>
          </div>
        </Specimen>
      </Section>

      {/* ── Break-glass overlay — loud by design. ───────────────────────── */}
      {glass && (
        <div
          className="fixed inset-0 z-50 grid place-items-center px-4"
          style={{ background: 'rgba(14,14,12,0.9)' }}
          role="dialog"
          aria-modal="true"
        >
          <div className="pop w-full max-w-md text-center">
            <div
              className="mx-auto grid h-20 w-20 place-items-center rounded-full"
              style={{
                background: 'conic-gradient(var(--alarm) 300deg, rgba(255,255,255,0.14) 0)',
              }}
            >
              <div
                className="grid h-[68px] w-[68px] place-items-center rounded-full"
                style={{ background: 'var(--rail)' }}
              >
                <ShieldAlert className="h-7 w-7" style={{ color: 'var(--alarm)' }} />
              </div>
            </div>
            <h2
              className="mt-6 text-[24px] font-extrabold tracking-tight"
              style={{ color: 'var(--rail-ink)' }}
            >
              This will be very loud
            </h2>
            <p
              className="mt-3 text-sm leading-relaxed"
              style={{ color: 'var(--rail-ink-2)' }}
            >
              Every owner of this brand is notified immediately. The session lasts
              ten minutes and everything you open during it is recorded. Say why.
            </p>
            <textarea
              rows={3}
              placeholder="What has happened?"
              className="mt-5 w-full rounded-[var(--radius-md)] border bg-transparent p-3 text-sm outline-none"
              style={{
                borderColor: 'rgba(255,255,255,0.18)',
                color: 'var(--rail-ink)',
              }}
            />
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setGlass(false)}
                className="press h-9 rounded-[var(--radius-pill)] border px-4 text-sm font-medium"
                style={{
                  borderColor: 'rgba(255,255,255,0.2)',
                  color: 'var(--rail-ink-2)',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setGlass(false)}
                className="press h-9 rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-white"
                style={{ background: 'var(--alarm)' }}
              >
                Break glass
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
