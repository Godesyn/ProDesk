import { Link } from 'wouter';
import { ArrowRight, DoorOpen, Eye, Network, ShieldCheck } from 'lucide-react';
import { KeyMark, Specimen } from '../components/primitives';

/**
 * The signed-out marketing page.
 *
 * Leads with the thesis, not a feature list, because the thesis IS the wedge:
 * every competitor is casual about secrets and opaque about access, and KEYMASTR
 * inverts both. Then the one claim nobody else can make (§1 of DESIGN.md): the
 * vault already knows the org chart, so provisioning and de-provisioning — the
 * two operations that define the category — are free here.
 */

const PROOF = [
  {
    icon: DoorOpen,
    title: 'The day someone leaves',
    body: 'Pick the person. See the nine keys they actually opened, separated from the twenty-two they never touched. Rotate nine, revoke twenty-two, and export the certificate that proves it.',
  },
  {
    icon: Network,
    title: 'What your client can see',
    body: 'A live access statement, in plain English, from their side of the table. No agency has ever been able to show a client this. Now it exports as a one-page PDF.',
  },
  {
    icon: ShieldCheck,
    title: 'We show you the key',
    body: 'Every teammate’s encryption key has a six-word fingerprint you confirm once. If it ever changes, sharing stops. That closes the substitution attack researchers found in three of the biggest vaults.',
  },
];

export function LandingPage() {
  return (
    <div className="km-ui min-h-screen" style={{ background: 'var(--stage)' }}>
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5">
        <KeyMark seed={3} className="h-4 w-8 text-[var(--ink)]" />
        <span className="text-[15px] font-semibold tracking-tight">KEYMASTR</span>
        <span className="spec ml-2 hidden sm:block">BY PRODESK</span>
        <nav className="ml-auto flex items-center gap-2">
          <Link
            href="/login"
            className="press inline-flex h-9 items-center rounded-[var(--radius-pill)] px-4 text-sm font-medium text-[var(--ink-2)]"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="press inline-flex h-9 items-center rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-white"
            style={{ background: 'var(--pigment)' }}
          >
            Start free
          </Link>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="mx-auto grid max-w-[1180px] items-center gap-12 px-5 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
        <div className="rise">
          <div className="spec">THE PASSWORD VAULT FOR PEOPLE WITH CLIENTS</div>
          <h1 className="text-display mt-4 font-extrabold">
            The secret stays dark.
            <br />
            The access is <span className="quill" style={{ color: 'var(--pigment)' }}>glass</span>.
          </h1>
          <p className="mt-6 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
            Every other vault has this backwards — one click to splash a password
            across your screen forever, and a buried admin console for the thing
            that actually matters. KEYMASTR hides the secret and shows you the
            access: who can open what, who did, and exactly what breaks the day
            they leave.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/signup"
              className="press inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-semibold text-white"
              style={{ background: 'var(--pigment)' }}
            >
              Start free <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/login"
              className="press inline-flex h-11 items-center rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-6 text-sm font-medium text-[var(--ink-2)]"
            >
              I already have an account
            </Link>
          </div>
          <p className="spec mt-6">
            END-TO-END ENCRYPTED · YOUR CLIENTS COLLABORATE FREE
          </p>
        </div>

        {/* The specimen: the Aperture, explained without a word of copy. */}
        <Specimen
          className="stage-grid relative aspect-[4/3] w-full"
          corners={['AES-256-GCM', 'ZERO-KNOWLEDGE', 'PRESS · HOLD · DRAIN', '20S']}
        >
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-6">
              <div
                className="grid h-24 w-24 place-items-center rounded-full"
                style={{
                  background:
                    'conic-gradient(var(--pigment) 246deg, rgba(14,14,12,0.14) 0)',
                }}
              >
                <div
                  className="grid h-[86px] w-[86px] place-items-center rounded-full"
                  style={{ background: 'var(--card)' }}
                >
                  <Eye className="h-7 w-7" style={{ color: 'var(--pigment)' }} />
                </div>
              </div>
              <div className="text-center">
                <div className="revealed text-[15px]">Tr4ce-Hollow-Bramble-92</div>
                <div className="spec mt-2">RE-MASKS IN 14S</div>
              </div>
            </div>
          </div>
        </Specimen>
      </section>

      {/* ── The wedge ──────────────────────────────────────────────────── */}
      <section
        className="border-y border-[var(--hair)]"
        style={{ background: 'var(--card)' }}
      >
        <div className="mx-auto max-w-[1180px] px-5 py-16">
          <div className="max-w-2xl">
            <div className="spec">WHY THIS ONE</div>
            <h2 className="mt-3 text-[28px] font-extrabold leading-tight tracking-[-0.02em] sm:text-[34px]">
              It already knows who works on what.
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[var(--ink-2)]">
              Every vault on the market hands you an empty tree and wishes you
              luck. KEYMASTR lives inside Prodesk, where your brands, your staff
              and your client relationships already exist — so a new client has a
              vault the moment it has a name, and a departing contractor is
              already queued for close-out before you open the app.
            </p>
          </div>

          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {PROOF.map((p) => (
              <div
                key={p.title}
                className="lift rounded-[var(--radius-md)] border border-[var(--hair-2)] p-6"
                style={{ background: 'var(--stage)' }}
              >
                <p.icon className="h-5 w-5" style={{ color: 'var(--pigment)' }} />
                <h3 className="mt-4 text-[17px] font-semibold tracking-tight">
                  {p.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink-2)]">
                  {p.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Close ──────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-5 py-20 text-center">
        <p className="quill mx-auto max-w-xl text-[26px] leading-snug">
          “The vault is not the hard part. Knowing who can open it is.”
        </p>
        <Link
          href="/signup"
          className="press mt-8 inline-flex h-11 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-semibold text-white"
          style={{ background: 'var(--pigment)' }}
        >
          Start free <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <footer className="border-t border-[var(--hair)]">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-8">
          <span className="spec">KEYMASTR — A PRODESK TOOL</span>
          <span className="spec ml-auto">END-TO-END ENCRYPTED</span>
        </div>
      </footer>
    </div>
  );
}
