/**
 * Logo Studio marketing landing — the `/` route for signed-out visitors, so the
 * frontend opens on a pitch instead of a login form (matching Adeyy/Verdiict).
 * No session, no brand context, no protected query: the only data it reads is
 * `logo.public.offer`, the advertised price, so nothing here hardcodes money.
 *
 * Design: the page is mounted inside `.logo-ui`, so it reuses the studio's own
 * Atelier language — ink-on-paper, the mono `.spec` label, the serif `.quill`
 * accent, and the self-drawing `[data-draw]` marks. The landing-only pieces (the
 * dark studio TABLE the paper sits on, the type ramp, the ticker) live in
 * ../styles/landing.css under `.llanding`.
 *
 * The signature moment is the drafting sheet in the hero: six marks draw
 * themselves in monochrome, and colour only arrives once the visitor commits to
 * one — the studio's thesis performed rather than described. It is a local
 * demo of hand-authored specimen marks (components/LogoMark), labelled as such;
 * the real studio draws original vectors from a brief.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, Check, Minus, Plus } from 'lucide-react';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { mainAppUrl } from '@shared/lib/origins';
import { LogoMark } from '../components/LogoMark';
import '../styles/landing.css';

const SHELL = 'mx-auto w-full max-w-[1180px] px-5 sm:px-8';

/** Advertised price. Null amount → price-less copy (pricing not configured). */
function useOffer() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.logo.public.offer.queryOptions());
  return data;
}

/** "$29.00" → "$29"; keeps cents only when they matter. */
function priceLabel(amount: number, currency: string | null): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: (currency ?? 'AUD').toUpperCase(),
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

// ─── Reveal-on-scroll (the page's one orchestrated motion device) ───────────
function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.shown = 'true';
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`ld-reveal ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────
function Wordmark({
  dark = false,
  size = 26,
}: {
  dark?: boolean;
  size?: number;
}) {
  return (
    <a
      href="#top"
      className="inline-flex items-center gap-2.5 no-underline"
      style={{ color: dark ? 'var(--table-ink)' : 'var(--ink)' }}
    >
      <LogoMark
        seed={2}
        tone={dark ? 'paper' : 'ink'}
        animate={false}
        strokeWidth={7}
        className="h-7 w-7 shrink-0"
        title="Logo Studio"
      />
      <span className="flex flex-col leading-none">
        <span
          style={{
            fontSize: size * 0.62,
            fontWeight: 800,
            letterSpacing: '-0.045em',
          }}
        >
          Logo Studio
        </span>
        <span
          className="mt-1"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9.5,
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: dark ? 'var(--table-ink-3)' : 'var(--ink-3)',
          }}
        >
          by Prodesk
        </span>
      </span>
    </a>
  );
}

function SectionHead({
  label,
  title,
  lede,
  dark = false,
  align = 'left',
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  dark?: boolean;
  align?: 'left' | 'center';
}) {
  return (
    <Reveal
      className={
        align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'
      }
    >
      <p className={dark ? 'spec-dark' : 'spec'}>{label}</p>
      <h2
        className="ld-h2 mt-5"
        style={{ color: dark ? 'var(--table-ink)' : 'var(--ink)' }}
      >
        {title}
      </h2>
      {lede && (
        <p
          className="ld-lead mt-5 max-w-2xl"
          style={{
            color: dark ? 'var(--table-ink-2)' : 'var(--ink-2)',
            marginInline: align === 'center' ? 'auto' : undefined,
          }}
        >
          {lede}
        </p>
      )}
    </Reveal>
  );
}

function PigmentCta({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-7 text-sm font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98] ${className}`}
      style={{ background: 'var(--pigment)' }}
    >
      {children}
    </button>
  );
}

function GhostCta({
  children,
  href,
  onClick,
  dark = false,
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  dark?: boolean;
}) {
  const cls =
    'inline-flex h-12 items-center justify-center gap-2 rounded-[var(--radius-pill)] border px-6 text-sm font-semibold no-underline transition active:scale-[0.98]';
  const style = dark
    ? { borderColor: 'var(--table-line)', color: 'var(--table-ink)' }
    : { borderColor: 'var(--hair-2)', color: 'var(--ink)' };
  return href ? (
    <a href={href} className={cls} style={style}>
      {children}
    </a>
  ) : (
    <button type="button" onClick={onClick} className={cls} style={style}>
      {children}
    </button>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export function LandingPage() {
  const { isAuthenticated, sessionLoading } = useCurrentUser();
  const [, navigate] = useLocation();

  const start = () => navigate(isAuthenticated ? '/' : '/signup');
  const signIn = () => navigate(isAuthenticated ? '/' : '/login');

  return (
    <div id="top" className="logo-ui llanding">
      <Nav
        authed={isAuthenticated}
        loading={sessionLoading}
        onStart={start}
        onSignIn={signIn}
      />
      <Hero onStart={start} />
      <Ticker />
      <Trouble />
      <Process />
      <EditorShowcase onStart={start} />
      <Inheritance />
      <Thesis />
      <Deliverables />
      <Pricing onStart={start} />
      <Faq />
      <FinalCta onStart={start} />
      <Footer onStart={start} onSignIn={signIn} />
    </div>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────────
function Nav({
  authed,
  loading,
  onStart,
  onSignIn,
}: {
  authed: boolean;
  loading: boolean;
  onStart: () => void;
  onSignIn: () => void;
}) {
  return (
    <header
      className="table-surface sticky top-0 z-50 border-b"
      style={{
        borderColor: 'var(--table-line)',
        background: 'rgba(10, 10, 9, 0.82)',
        backdropFilter: 'saturate(140%) blur(14px)',
        WebkitBackdropFilter: 'saturate(140%) blur(14px)',
      }}
    >
      <div
        className={`${SHELL} flex h-[72px] items-center justify-between gap-4`}
      >
        <Wordmark dark />
        <nav className="flex items-center gap-7">
          <a
            href="#process"
            className="ld-nav-link hidden text-sm font-medium no-underline md:inline"
          >
            The process
          </a>
          <a
            href="#assets"
            className="ld-nav-link hidden text-sm font-medium no-underline md:inline"
          >
            What you get
          </a>
          <a
            href="#pricing"
            className="ld-nav-link hidden text-sm font-medium no-underline sm:inline"
          >
            Pricing
          </a>
          {!loading && (
            <>
              {!authed && (
                <button
                  type="button"
                  onClick={onSignIn}
                  className="ld-nav-link hidden text-sm font-medium sm:inline"
                >
                  Sign in
                </button>
              )}
              <PigmentCta onClick={onStart} className="!h-10 !px-5">
                {authed ? 'Open the studio' : 'Design your logo'}
                <ArrowRight className="h-4 w-4" />
              </PigmentCta>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

// ─── Hero ───────────────────────────────────────────────────────────────────
function Hero({ onStart }: { onStart: () => void }) {
  const offer = useOffer();
  const priceLine =
    offer?.unitAmount != null
      ? `Free to design · ${priceLabel(offer.unitAmount, offer.currency)} per ${offer.interval ?? 'month'} to download`
      : 'Free to design · Free to download in early access';

  return (
    <section className="table-surface table-grid relative overflow-hidden">
      <div
        className={`${SHELL} grid gap-14 py-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:items-center lg:gap-16 lg:py-24`}
      >
        <div className="rise">
          <p className="spec-dark">AI logo studio · Prodesk</p>
          <h1 className="ld-display mt-6" style={{ color: 'var(--table-ink)' }}>
            Great marks are born in{' '}
            <span className="quill" style={{ color: 'var(--table-ink)' }}>
              black &amp; white
            </span>
            <span style={{ color: 'var(--pigment)' }}>.</span>
          </h1>
          <p
            className="ld-lead mt-7 max-w-xl"
            style={{ color: 'var(--table-ink-2)' }}
          >
            Describe your business and the studio draws original, editable
            vector marks — form first, no colour to hide behind. Choose one and
            it becomes a whole identity: palette, type, lockups, guidelines, and
            every file you will ever be asked for.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <PigmentCta onClick={onStart}>
              Design your logo <ArrowRight className="h-4 w-4" />
            </PigmentCta>
            <GhostCta href="#process" dark>
              See the process
            </GhostCta>
          </div>
          <p className="spec-dark mt-8">
            {priceLine} · You own what you download
          </p>
        </div>

        <DraftingSheet />
      </div>
    </section>
  );
}

// ─── The drafting sheet (signature element) ─────────────────────────────────
type Phase = 'brief' | 'sheet' | 'committed';

/** The six specimen marks, named the way a designer would present a set. */
const DIRECTIONS = [
  'Peak',
  'Loop',
  'Orbit',
  'Prism',
  'Compass',
  'Ridge',
] as const;

/** One committed colourway per direction — colour as the *outcome* of a choice. */
const COLOURWAYS: {
  name: string;
  swatches: { role: string; hex: string }[];
}[] = [
  {
    name: 'Meridian',
    swatches: [
      { role: 'Primary', hex: '#2E6F4E' },
      { role: 'Accent', hex: '#8FBF9F' },
      { role: 'Ink', hex: '#101311' },
      { role: 'Paper', hex: '#F3F1EA' },
      { role: 'Rule', hex: '#D8D3C4' },
    ],
  },
  {
    name: 'Cobalt',
    swatches: [
      { role: 'Primary', hex: '#23408F' },
      { role: 'Accent', hex: '#7C9AE8' },
      { role: 'Ink', hex: '#0E1118' },
      { role: 'Paper', hex: '#F2F3F7' },
      { role: 'Rule', hex: '#D2D6E2' },
    ],
  },
  {
    name: 'Ember',
    swatches: [
      { role: 'Primary', hex: '#B4471F' },
      { role: 'Accent', hex: '#E9A57C' },
      { role: 'Ink', hex: '#17100C' },
      { role: 'Paper', hex: '#F6F0E8' },
      { role: 'Rule', hex: '#E0D3C4' },
    ],
  },
  {
    name: 'Aubergine',
    swatches: [
      { role: 'Primary', hex: '#55306B' },
      { role: 'Accent', hex: '#B591C9' },
      { role: 'Ink', hex: '#140F18' },
      { role: 'Paper', hex: '#F4F0F6' },
      { role: 'Rule', hex: '#DCD3E2' },
    ],
  },
  {
    name: 'Slate',
    swatches: [
      { role: 'Primary', hex: '#2B3A42' },
      { role: 'Accent', hex: '#8AA3AE' },
      { role: 'Ink', hex: '#0D1113' },
      { role: 'Paper', hex: '#F1F2F1' },
      { role: 'Rule', hex: '#D4D8D8' },
    ],
  },
  {
    name: 'Ochre',
    swatches: [
      { role: 'Primary', hex: '#9A7213' },
      { role: 'Accent', hex: '#E0C371' },
      { role: 'Ink', hex: '#16130A' },
      { role: 'Paper', hex: '#F6F2E4' },
      { role: 'Rule', hex: '#E3DAC2' },
    ],
  },
];

/** The brief's real Classic↔Modern dial, rendered as plain language. */
function dialWord(v: number): string {
  if (v <= 1) return 'classic';
  if (v >= 3) return 'modern';
  return 'balanced classic/modern';
}

function DraftingSheet() {
  const [name, setName] = useState('Northbeam');
  const [dial, setDial] = useState(3);
  // Opens ON the sheet so the marks draw themselves in as the page loads — the
  // birth of the mark is the hero moment. Editing the brief invalidates it.
  const [phase, setPhase] = useState<Phase>('sheet');
  const [picked, setPicked] = useState<number | null>(null);
  const [run, setRun] = useState(0);

  // Heavier line as the dial moves modern — the sheet visibly answers the brief.
  const stroke = useMemo(() => 4.5 + dial * 1.6, [dial]);
  const wordmark = name.trim() || 'Your brand';
  const colourway = picked == null ? null : COLOURWAYS[picked];

  const draw = () => {
    setPicked(null);
    setPhase('sheet');
    setRun((r) => r + 1);
  };

  const commit = (i: number) => {
    setPicked(i);
    setPhase('committed');
  };

  const caption =
    phase === 'brief'
      ? 'Form first. Colour is a decision.'
      : phase === 'sheet'
        ? 'Six directions, still in black & white.'
        : 'Colour arrives the moment you commit.';

  return (
    <div className="ld-sheet pop rounded-[var(--radius-lg)] p-5 sm:p-7">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--hair)] pb-4">
        <span className="spec">Drafting sheet · demo</span>
        <span className="spec" style={{ color: 'var(--ink-2)' }}>
          {phase === 'brief'
            ? 'Brief'
            : phase === 'sheet'
              ? '6 concepts'
              : colourway?.name}
        </span>
      </div>

      {/* Brief controls — the real studio's first two questions. */}
      <div className="mt-5 grid gap-4">
        <label className="block">
          <span className="spec">Business name</span>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value.slice(0, 22));
              if (phase !== 'brief') setPhase('brief');
            }}
            placeholder="Your brand"
            className="mt-2 w-full rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)] px-3.5 py-2.5 text-base font-semibold text-[var(--ink)] outline-none placeholder:font-normal placeholder:text-[var(--ink-3)]"
          />
        </label>

        <div>
          <div className="flex items-baseline justify-between">
            <span className="spec">Personality</span>
            <span className="spec" style={{ color: 'var(--ink-2)' }}>
              {dialWord(dial)}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-3">
            <span className="spec shrink-0" style={{ fontSize: 10 }}>
              Classic
            </span>
            <input
              type="range"
              min={0}
              max={4}
              step={1}
              value={dial}
              aria-label="Classic to modern"
              onChange={(e) => setDial(Number(e.target.value))}
              className="logo-range w-full flex-1"
            />
            <span className="spec shrink-0" style={{ fontSize: 10 }}>
              Modern
            </span>
          </div>
        </div>
      </div>

      {/* The sheet itself */}
      <div className="mt-6">
        {phase === 'committed' && colourway ? (
          <Committed
            wordmark={wordmark}
            seed={picked ?? 0}
            stroke={stroke}
            colourway={colourway}
            onBack={() => setPhase('sheet')}
          />
        ) : phase === 'sheet' ? (
          <div className="grid grid-cols-3 gap-2.5">
            {DIRECTIONS.map((dir, i) => (
              <button
                key={`${run}-${dir}`}
                type="button"
                onClick={() => commit(i)}
                className="ld-cell pop grid aspect-square place-items-center rounded-[var(--radius-md)]"
                style={{ animationDelay: `${i * 70}ms` }}
                title={`Commit to ${dir}`}
              >
                <LogoMark
                  seed={i}
                  strokeWidth={stroke}
                  className="h-10 w-10 sm:h-12 sm:w-12"
                  title={`${dir} direction`}
                />
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={draw}
            className="stage-grid grid w-full place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--hair-2)] py-12 transition hover:border-[var(--pigment)]"
          >
            <span className="text-sm font-semibold text-[var(--ink-2)]">
              Draw six marks for {wordmark}
            </span>
            <span className="spec mt-1.5">Monochrome · vector · 1:1</span>
          </button>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hair)] pt-4">
        <span
          className="spec"
          style={{ textTransform: 'none', letterSpacing: 0 }}
        >
          {caption}
        </span>
        {phase !== 'brief' && (
          <button
            type="button"
            onClick={draw}
            className="spec underline decoration-[var(--hair-2)] underline-offset-4 hover:text-[var(--ink)]"
          >
            Draw again
          </button>
        )}
      </div>
    </div>
  );
}

function Committed({
  wordmark,
  seed,
  stroke,
  colourway,
  onBack,
}: {
  wordmark: string;
  seed: number;
  stroke: number;
  colourway: { name: string; swatches: { role: string; hex: string }[] };
  onBack: () => void;
}) {
  const primary = colourway.swatches[0].hex;
  return (
    <div>
      <div
        className="specimen pop flex items-center justify-center gap-4 rounded-[var(--radius-md)] px-5 py-9"
        style={{ background: colourway.swatches[3].hex }}
      >
        <span style={{ color: primary, lineHeight: 0 }}>
          <LogoMark
            seed={seed}
            strokeWidth={stroke}
            className="h-12 w-12 sm:h-14 sm:w-14"
          />
        </span>
        <span
          className="min-w-0 truncate"
          style={{
            fontSize: 'clamp(22px, 3.4vw, 34px)',
            fontWeight: 800,
            letterSpacing: '-0.045em',
            color: colourway.swatches[2].hex,
          }}
        >
          {wordmark}
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {colourway.swatches.map((s, i) => (
          <div
            key={s.role}
            className="ld-swatch"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <div
              className="swatch h-10 w-10 rounded-[var(--radius-md)]"
              style={{ background: s.hex }}
              title={`${s.role} · ${s.hex}`}
            />
            <span className="spec mt-1.5 block" style={{ fontSize: 9 }}>
              {s.hex.replace('#', '')}
            </span>
          </div>
        ))}
        <button
          type="button"
          onClick={onBack}
          className="spec ml-auto inline-flex items-center gap-1 pb-5 hover:text-[var(--ink)]"
        >
          Back to the six
        </button>
      </div>
    </div>
  );
}

// ─── Deliverables ticker ────────────────────────────────────────────────────
function Ticker() {
  const items = [
    'SVG',
    'PNG @1–4×',
    'Print PDF',
    'Favicon set',
    'Social kit',
    'Guidelines PDF',
    'Lockups',
    'Colourways',
  ];
  return (
    <section className="border-y border-[var(--hair)] bg-[var(--stage)] py-9">
      <p className="spec mb-6 text-center">
        Everything a printer, a developer or a sign-maker asks for
      </p>
      <div className="ld-ticker">
        {/* Exactly TWO copies: the track translates -50%, i.e. one full copy,
            so the loop restarts on an identical frame with no seam. */}
        <div className="ld-ticker-track">
          {[...items, ...items].map((item, i) => (
            <span
              key={i}
              className="whitespace-nowrap"
              style={{
                fontSize: 'clamp(20px, 2.6vw, 32px)',
                fontWeight: 700,
                letterSpacing: '-0.03em',
                color: 'var(--ink-3)',
              }}
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── The trouble with logo makers ───────────────────────────────────────────
function Trouble() {
  const items = [
    {
      k: 'Stock',
      t: 'Assembled, not drawn',
      d: 'Most generators pull from one stock icon library. Search “mountain”, and so does every other business in your category.',
    },
    {
      k: 'Locked',
      t: 'The vector is the upsell',
      d: 'The preview is free. The SVG — the only file a printer or sign-maker can actually use — sits behind the highest tier.',
    },
    {
      k: 'Stuck',
      t: 'No way to change it',
      d: 'A flat PNG and a thank-you email. No editor, no colourways, no guidelines, nothing that carries into the rest of your business.',
    },
  ];
  return (
    <section className="bg-[var(--stage)] py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead
          label="Why this exists"
          title={
            <>
              The logo you generated somewhere else is still sitting in your{' '}
              <span className="quill">downloads folder.</span>
            </>
          }
        />
        <div className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {items.map((it, i) => (
            <Reveal key={it.k} delay={i * 90}>
              <div className="border-t-2 border-[var(--ink)] pt-5">
                <p className="spec">{it.k}</p>
                <h3 className="ld-h3 mt-4 text-[var(--ink)]">{it.t}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">
                  {it.d}
                </p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── The process (numbered because it genuinely is a sequence) ──────────────
function Process() {
  const steps = [
    {
      n: '01',
      t: 'Create',
      d: 'Name the business and set four dials — classic↔modern, serious↔playful, minimal↔expressive, geometric↔organic. Or just talk it through and the studio writes the brief for you.',
    },
    {
      n: '02',
      t: 'Concepts',
      d: 'Six original marks come back as vectors, in monochrome, each with a uniqueness read. Save the ones worth keeping. Commit to one.',
    },
    {
      n: '03',
      t: 'Editor',
      d: 'Real geometry: scale, stroke weight, clearspace, hidden elements, colourways. Ask for a new direction in plain English. Undo walks the actual history of the mark.',
    },
    {
      n: '04',
      t: 'Brand system',
      d: 'The mark becomes a five-role palette, a type pairing and a set of lockups — then pushes into your brand so the rest of Prodesk inherits it.',
    },
    {
      n: '05',
      t: 'Guidelines',
      d: 'A real rulebook: clearspace, minimum sizes, misuse, colour values, type. Share it as a link or hand over the PDF.',
    },
    {
      n: '06',
      t: 'Assets',
      d: 'Export the lot, generated from the same geometry you edited on screen. What you saw on the canvas is what lands in the file.',
    },
  ];
  return (
    <section id="process" className="bg-[var(--stage-2)] py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead
          label="The process"
          title="Six steps, in the order a designer would take them."
          lede="Every stage is a real screen you can go back to. Nothing is a one-shot generation you either accept or throw away."
        />
        <div className="mt-14 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={(i % 3) * 80}>
              <div
                className="table-surface flex h-full flex-col justify-between rounded-[var(--radius-lg)] p-7"
                style={{ minHeight: 260 }}
              >
                <span className="spec-dark" style={{ color: 'var(--pigment)' }}>
                  {s.n}
                </span>
                <div className="mt-10">
                  <h3
                    style={{
                      fontSize: 'clamp(30px, 3.4vw, 42px)',
                      fontWeight: 800,
                      letterSpacing: '-0.04em',
                      lineHeight: 1,
                    }}
                  >
                    {s.t}
                  </h3>
                  <p
                    className="mt-4 text-[15px] leading-relaxed"
                    style={{ color: 'var(--table-ink-2)' }}
                  >
                    {s.d}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── The editor ─────────────────────────────────────────────────────────────
function EditorShowcase({ onStart }: { onStart: () => void }) {
  const dials = [
    { label: 'Scale', value: '1.08×', fill: 0.54 },
    { label: 'Stroke', value: '6.5 px', fill: 0.42 },
    { label: 'Clearspace', value: '1.0×', fill: 0.5 },
  ];
  return (
    <section className="bg-[var(--stage)] py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead
          label="The editor"
          title={
            <>
              Generated is the first draft, not the{' '}
              <span className="quill">final answer.</span>
            </>
          }
          lede="Most tools stop at the download. This one opens the mark up: adjust the geometry, commit a colourway, ask for a different direction — and the export comes out of exactly what you see."
        />

        <Reveal className="mt-14">
          <div className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] shadow-[var(--shadow-3)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--hair)] px-5 py-3">
              <span className="spec">Northbeam · concept 03 · Orbit</span>
              <span className="spec hidden sm:block">Canvas = export</span>
            </div>
            <div className="grid lg:grid-cols-[128px_minmax(0,1fr)_240px]">
              {/* Concept strip */}
              <div className="hidden flex-col gap-2 border-r border-[var(--hair)] p-3 lg:flex">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="grid aspect-square place-items-center rounded-[var(--radius-md)] border"
                    style={{
                      borderColor: i === 2 ? 'var(--pigment)' : 'var(--hair-2)',
                      background: 'var(--stage)',
                      boxShadow:
                        i === 2 ? '0 0 0 2px var(--pigment)' : undefined,
                    }}
                  >
                    <LogoMark
                      seed={i}
                      animate={false}
                      strokeWidth={7}
                      className="h-7 w-7"
                    />
                  </div>
                ))}
              </div>

              {/* Canvas */}
              <div className="stage-grid relative grid min-h-[300px] place-items-center p-8 sm:min-h-[380px]">
                <span style={{ color: '#2E6F4E', lineHeight: 0 }}>
                  <LogoMark
                    seed={2}
                    animate={false}
                    strokeWidth={6.5}
                    className="h-24 w-24 sm:h-32 sm:w-32"
                  />
                </span>
                <div className="pointer-events-none absolute inset-4 flex flex-col justify-between sm:inset-6">
                  <div className="flex justify-between">
                    <span className="spec">1:1 · MARK</span>
                    <span className="spec hidden sm:block">
                      CLEARSPACE 1.0×
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="spec">#2E6F4E</span>
                    <span className="spec">SVG · VECTOR</span>
                  </div>
                </div>
              </div>

              {/* Inspector */}
              <div className="border-t border-[var(--hair)] p-5 lg:border-l lg:border-t-0">
                <p className="spec">Inspector</p>
                <div className="mt-4 space-y-4">
                  {dials.map((d) => (
                    <div key={d.label}>
                      <div className="flex items-baseline justify-between">
                        <span className="text-[13px] font-medium text-[var(--ink)]">
                          {d.label}
                        </span>
                        <span className="spec" style={{ fontSize: 10 }}>
                          {d.value}
                        </span>
                      </div>
                      <div className="mt-2 h-1 rounded-full bg-[var(--hair-2)]">
                        <div
                          className="h-1 rounded-full"
                          style={{
                            width: `${d.fill * 100}%`,
                            background: 'var(--pigment)',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 border-t border-[var(--hair)] pt-4">
                  <p className="spec">Colourway</p>
                  <div className="mt-3 flex gap-2">
                    {[
                      '#2E6F4E',
                      '#8FBF9F',
                      '#101311',
                      '#F3F1EA',
                      '#D8D3C4',
                    ].map((hex) => (
                      <span
                        key={hex}
                        className="swatch h-7 w-7 rounded-[var(--radius-sm)]"
                        style={{ background: hex }}
                      />
                    ))}
                  </div>
                </div>
                <div className="mt-6 border-t border-[var(--hair)] pt-4">
                  <p className="spec">Ask for a direction</p>
                  <p className="mt-2 rounded-[var(--radius-md)] bg-[var(--stage)] px-3 py-2.5 text-[13px] leading-snug text-[var(--ink-2)]">
                    “Keep the ring, drop the inner arc, make it feel steadier.”
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Reveal>

        <Reveal className="mt-10 flex flex-wrap items-center gap-3" delay={80}>
          <PigmentCta onClick={onStart}>
            Try the editor <ArrowRight className="h-4 w-4" />
          </PigmentCta>
          <span className="spec">
            Designing is free — you only pay at the download
          </span>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Suite inheritance (the part no standalone logo maker can do) ───────────
function Inheritance() {
  const tools = [
    {
      t: 'Signatures',
      d: 'Every staff email signature, re-issued in the new mark and colours.',
    },
    {
      t: 'Payments',
      d: 'Proposals and invoices branded the moment they are sent.',
    },
    {
      t: 'Reviews',
      d: 'Your review page and public profile carry your logo, not ours.',
    },
    { t: 'Links', d: 'Short links and QR codes generated in your palette.' },
    {
      t: 'Websites',
      d: 'Colour and type tokens ready for whatever you build next.',
    },
  ];
  return (
    <section className="table-surface py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead
          dark
          label="Downstream"
          title="Most logo makers hand you a zip. This one updates the rest of your business."
          lede="Logo Studio writes the finished identity back into your Prodesk brand — logo files, the five-role palette, the type pairing. Anything you already run on Prodesk picks it up from there."
        />
        <div
          className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-lg)] sm:grid-cols-2 lg:grid-cols-3"
          style={{ background: 'var(--table-line)' }}
        >
          {tools.map((tool, i) => (
            <Reveal key={tool.t} delay={(i % 3) * 70}>
              <div className="table-surface flex h-full flex-col gap-3 p-7">
                <h3 className="ld-h3" style={{ color: 'var(--table-ink)' }}>
                  {tool.t}
                </h3>
                <p
                  className="text-[15px] leading-relaxed"
                  style={{ color: 'var(--table-ink-2)' }}
                >
                  {tool.d}
                </p>
              </div>
            </Reveal>
          ))}
          <Reveal delay={210}>
            <div
              className="flex h-full flex-col justify-between gap-4 p-7"
              style={{ background: 'var(--pigment)' }}
            >
              <span
                className="spec-dark"
                style={{ color: 'rgba(255,255,255,0.72)' }}
              >
                One push
              </span>
              <p className="ld-h3 text-white">
                Change the mark later and everything downstream changes with it.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// ─── Thesis band ────────────────────────────────────────────────────────────
function Thesis() {
  return (
    <section className="bg-[var(--stage-2)] py-16 lg:py-24">
      <div className={SHELL}>
        <Reveal className="max-w-4xl">
          <p className="spec">The studio's one rule</p>
          <p
            className="quill mt-7"
            style={{
              fontSize: 'clamp(28px, 4.6vw, 60px)',
              lineHeight: 1.12,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              textWrap: 'balance',
            }}
          >
            Get the form right in monochrome, so it has to earn its keep. Then
            let colour mean something.
          </p>
          <p className="ld-lead mt-7 max-w-2xl text-[var(--ink-2)]">
            It is why every concept arrives in black and white, why the palette
            only appears once you have chosen a mark, and why the accent in this
            studio is rationed to the two moments that matter: making something,
            and committing to it.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── What you get ───────────────────────────────────────────────────────────
function Deliverables() {
  const assets = [
    {
      t: 'SVG',
      d: 'Editable vector — the master file. Mark, wordmark and every lockup.',
    },
    {
      t: 'PNG',
      d: 'Transparent, exported at 1× through 4× for screens and slide decks.',
    },
    {
      t: 'PDF',
      d: 'Print-ready, for signage, uniforms, vehicle wraps and packaging.',
    },
    {
      t: 'Favicon',
      d: 'The full set — SVG plus the PNG sizes browsers and phones ask for.',
    },
    {
      t: 'Social kit',
      d: 'Avatars and cover art, cropped and safe-zoned per platform.',
    },
    {
      t: 'Guidelines',
      d: 'A multi-page rulebook PDF, plus a share link for anyone who needs it.',
    },
  ];
  return (
    <section id="assets" className="bg-[var(--stage)] py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead
          label="What you get"
          title="Files, not screenshots."
          lede="Every format comes out of the same measured geometry, so the favicon, the billboard and the PDF are the same mark — not three near-misses."
        />
        <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assets.map((a, i) => (
            <Reveal key={a.t} delay={(i % 3) * 70}>
              <div className="flex h-full items-start gap-4 rounded-[var(--radius-lg)] border border-[var(--hair-2)] bg-[var(--card)] p-6">
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full"
                  style={{ background: 'var(--pigment-soft)' }}
                >
                  <Check
                    className="h-4 w-4"
                    style={{ color: 'var(--pigment)' }}
                  />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-bold tracking-tight text-[var(--ink)]">
                    {a.t}
                  </h3>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink-2)]">
                    {a.d}
                  </p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing (always driven by logo.public.offer) ───────────────────────────
function Pricing({ onStart }: { onStart: () => void }) {
  const offer = useOffer();
  const amount = offer?.unitAmount ?? null;
  const interval = offer?.interval ?? 'month';
  const included = offer?.features?.length
    ? offer.features
    : [
        'Unlimited concepts',
        'Full vector editor',
        'Conversational iteration',
        'Brand system + suite push',
        'Guidelines PDF + share link',
        'Every export format',
        'Commercial rights on download',
        'Unlimited projects',
      ];

  return (
    <section id="pricing" className="bg-[var(--stage-2)] py-20 lg:py-28">
      <div className={SHELL}>
        <p className="spec">Pricing</p>
        <div className="mt-6 grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end lg:gap-16">
          <Reveal>
            <p className="spec" style={{ fontSize: 13 }}>
              {amount != null ? 'One plan, per brand' : 'Early access'}
            </p>
            <div
              style={{
                fontSize: 'clamp(76px, 13vw, 190px)',
                fontWeight: 800,
                letterSpacing: '-0.06em',
                lineHeight: 0.85,
                color: 'var(--ink)',
              }}
            >
              {amount != null
                ? priceLabel(amount, offer?.currency ?? null)
                : 'Free'}
            </div>
            <p className="spec mt-4" style={{ fontSize: 13 }}>
              {amount != null
                ? `per ${interval} · designing stays free`
                : 'to design and to download, while Logo Studio is in early access'}
            </p>
          </Reveal>

          <Reveal delay={90} className="max-w-xl lg:pb-6">
            <p className="ld-lead text-[var(--ink)]">
              {amount != null
                ? 'Design as much as you like for nothing — brief, concepts, editor, brand system. The subscription starts when you download the files, and it covers every format, every project under the brand, and the guidelines your suppliers will ask for.'
                : 'Design as much as you like, then take the files. Pricing has not been set yet, so everything — including the vectors and the guidelines — is free while Logo Studio is in early access.'}
            </p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-[var(--ink)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--stage)]">
              You own what you download
            </p>
          </Reveal>
        </div>

        <div className="mt-14 grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4">
          {included.map((f) => (
            <div
              key={f}
              className="flex items-center gap-3 border-t border-[var(--hair-2)] py-4 text-[15px] font-medium text-[var(--ink)]"
            >
              <Check
                className="h-4 w-4 shrink-0"
                style={{ color: 'var(--pigment)' }}
              />
              {f}
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center gap-3">
          <PigmentCta onClick={onStart}>
            Start designing <ArrowRight className="h-4 w-4" />
          </PigmentCta>
          <span className="spec">No card to start</span>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────
function Faq() {
  const [open, setOpen] = useState(0);
  const items = [
    {
      q: 'Do I actually own the logo?',
      a: 'Yes. The moment you download, the vectors are yours to use commercially — and the studio records when those rights transferred, so there is a trail if anyone ever asks. No per-use licence and no buying the same file twice.',
    },
    {
      q: 'Is it the same handful of icons everybody else gets?',
      a: 'No. Each set is drawn as fresh vector geometry against your brief rather than picked from a stock library, and every concept carries a uniqueness read so you can tell a common shape from a distinctive one before you commit.',
    },
    {
      q: 'Can I change it after it is generated?',
      a: 'That is most of the product. Scale, stroke weight, clearspace, hidden elements and colourways are all live, you can ask for a new direction in plain English, and undo walks the real history of the mark rather than a local stack.',
    },
    {
      q: 'Will it hold up at small sizes and in print?',
      a: 'It is built to. Wordmarks are exported as vector outlines rather than live text, so a printer with none of your fonts installed still gets exactly what you approved, and lockup sizing is measured rather than guessed.',
    },
    {
      q: 'Do I need to be a designer?',
      a: 'No — but one will recognise what comes out. You get measured clearspace, minimum sizes, real lockups, a five-role palette, a type pairing and a rulebook you can hand to a supplier without apologising for it.',
    },
    {
      q: 'What happens to the rest of my Prodesk tools?',
      a: 'They inherit the identity. Push the brand system and your signatures, proposals, review pages and short links pick up the new mark, colours and type without you rebuilding anything.',
    },
  ];
  return (
    <section className="bg-[var(--stage)] py-20 lg:py-28">
      <div className={SHELL}>
        <SectionHead label="Questions" title="The honest answers." />
        <div className="mt-12 max-w-4xl">
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={it.q}
                className="border-t border-[var(--hair-2)] last:border-b"
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-6 py-6 text-left"
                >
                  <span
                    style={{
                      fontSize: 'clamp(17px, 2vw, 22px)',
                      fontWeight: 700,
                      letterSpacing: '-0.025em',
                      color: 'var(--ink)',
                    }}
                  >
                    {it.q}
                  </span>
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border transition"
                    style={{
                      borderColor: isOpen ? 'transparent' : 'var(--hair-2)',
                      background: isOpen ? 'var(--ink)' : 'transparent',
                      color: isOpen ? 'var(--stage)' : 'var(--ink)',
                    }}
                  >
                    {isOpen ? (
                      <Minus className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                  </span>
                </button>
                {isOpen && (
                  <p className="ld-lead max-w-3xl pb-7 text-[var(--ink-2)]">
                    {it.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────
function FinalCta({ onStart }: { onStart: () => void }) {
  return (
    <section className="table-surface table-grid py-24 lg:py-32">
      <div className={`${SHELL} text-center`}>
        <Reveal>
          <div className="mx-auto mb-10 flex justify-center gap-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <LogoMark
                key={i}
                seed={i}
                tone="paper"
                animate={false}
                strokeWidth={7}
                className="h-7 w-7 opacity-70 sm:h-9 sm:w-9"
              />
            ))}
          </div>
          <h2
            className="ld-h2 mx-auto max-w-3xl"
            style={{ color: 'var(--table-ink)' }}
          >
            Your mark is six drawings away.
          </h2>
          <p
            className="ld-lead mx-auto mt-6 max-w-xl"
            style={{ color: 'var(--table-ink-2)' }}
          >
            Start with a name and four dials. Leave with an identity the rest of
            your business can actually use.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <PigmentCta onClick={onStart}>
              Design your logo <ArrowRight className="h-4 w-4" />
            </PigmentCta>
          </div>
          <p className="spec-dark mt-7">Free to design · No card to start</p>
        </Reveal>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────
function Footer({
  onStart,
  onSignIn,
}: {
  onStart: () => void;
  onSignIn: () => void;
}) {
  return (
    <footer
      className="table-surface border-t"
      style={{ borderColor: 'var(--table-line)' }}
    >
      <div
        className={`${SHELL} flex flex-col gap-8 py-12 sm:flex-row sm:items-center sm:justify-between`}
      >
        <Wordmark dark size={24} />
        <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
          <button
            type="button"
            onClick={onSignIn}
            className="ld-nav-link text-sm font-medium"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onStart}
            className="ld-nav-link text-sm font-medium"
          >
            Create an account
          </button>
          <a
            href={mainAppUrl('/')}
            target="_blank"
            rel="noreferrer"
            className="ld-nav-link inline-flex items-center gap-1 text-sm font-medium no-underline"
          >
            Prodesk <ArrowUpRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <div
        className={`${SHELL} border-t py-6`}
        style={{ borderColor: 'var(--table-line)' }}
      >
        <p className="spec-dark">
          © {new Date().getFullYear()} Prodesk · Logo Studio
        </p>
      </div>
    </footer>
  );
}
