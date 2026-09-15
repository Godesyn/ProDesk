/* Verdiict marketing landing page — full-fidelity port of the Manus
 * review-request-tool export (client/src/pages/LandingPage.tsx). Mounted at '/'
 * for unauthenticated visitors; requires no auth or brand context to render.
 * Adaptations from the export: styling is self-contained in styles/landing.css
 * (scoped under `.vlanding`, no CDN fonts); the official SVG wordmark renders
 * via <VerdiictLogo />; CTAs navigate to /signup (or '/' when a session exists,
 * via useCurrentUser); directory tiles link to /directory/industry/{slug}; and —
 * because no PUBLIC pricing procedure exists yet (reviews.entitlement /
 * featureSubscriptions.catalog are protected) — the pricing section carries
 * trial framing with NO hardcoded dollar figures. */
import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { VerdiictLogo } from './VerdiictLogo';
import { money } from './lib';
import '../styles/landing.css';

/** Live public pricing (reviews.public.offer). Null price → price-less copy. */
function useOffer() {
  const trpc = useTRPC();
  const { data } = useQuery(trpc.reviews.public.offer.queryOptions());
  return data;
}

/** "$59.00" → "$59" for display-size price figures. */
function tidyMoney(amount: number, currency: string | null): string {
  return money(amount, currency ?? 'AUD').replace(/\.00$/, '');
}

// ─── Brand wordmark (official SVG logo) ─────────────────────────────────────
function Wordmark({
  dark = false,
  withBy = false,
  size = 22,
}: {
  dark?: boolean;
  withBy?: boolean;
  size?: number;
}) {
  return (
    <a
      href="#top"
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        textDecoration: 'none',
        lineHeight: 1.1,
        color: dark ? 'var(--pm-paper)' : 'var(--pm-ink)',
        gap: 4,
      }}
    >
      <VerdiictLogo
        color={dark ? 'var(--pm-paper)' : 'var(--pm-ink)'}
        height={size}
      />
      {withBy && (
        <span style={{ fontSize: 11, opacity: 0.55, letterSpacing: '0.04em' }}>
          Reviews by Prodesk
        </span>
      )}
    </a>
  );
}

// Kept for the phone mockup inside the demo (ink mark on paper bg)
function ProofMark({ size = 22 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.28),
        background: 'var(--pm-ink)',
        color: 'var(--pm-lime)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.6),
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      V
    </span>
  );
}

function Stars({
  count = 5,
  filled = 5,
  size = 20,
  color = 'var(--pm-ink)',
  emptyColor = 'rgba(11,15,10,0.18)',
}: {
  count?: number;
  filled?: number;
  size?: number;
  color?: string;
  emptyColor?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: size * 0.18 }}>
      {Array.from({ length: count }).map((_, i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24">
          <path
            d="M12 2 L14.9 8.6 L22 9.3 L16.5 14.1 L18.2 21 L12 17.3 L5.8 21 L7.5 14.1 L2 9.3 L9.1 8.6 Z"
            fill={i < filled ? color : emptyColor}
          />
        </svg>
      ))}
    </div>
  );
}

function CheckIcon({ size = 16 }: { size?: number }) {
  return <Check size={size} strokeWidth={2.6} style={{ flexShrink: 0 }} />;
}

// ─── Industry profiles for the live demo ────────────────────────────────────
type IndustryProfile = {
  name: string;
  business: string;
  slug: string;
  headerQ: string;
  tags: string[];
  reviewByTags: (tags: string[]) => string;
};

const INDUSTRY_PROFILES: IndustryProfile[] = [
  {
    name: 'Trades & home services',
    business: 'Mason & Sons Plumbing',
    slug: 'mason-plumbing',
    headerQ: 'How did the job go?',
    tags: [
      'Fast turnaround',
      'Tidy work',
      'Fair price',
      'Knew their stuff',
      'On time',
    ],
    reviewByTags: (tags) =>
      `Called Mason & Sons on a Friday — they were here by Monday. ${tags[0] || 'Tidy work'}, ${(tags[1] || 'fair price').toLowerCase()}, no surprises on the invoice. Easy recommendation.`,
  },
  {
    name: 'Hospitality',
    business: "Joe's Coffee Roasters",
    slug: 'joes-coffee',
    headerQ: 'How was your visit?',
    tags: [
      'Great coffee',
      'Friendly staff',
      'Quick service',
      'Cosy vibe',
      'Clean space',
      'Knew the menu',
    ],
    reviewByTags: () =>
      'Genuinely the best flat white in the neighbourhood. The staff are warm without being over-the-top, and the whole place has this lived-in, cosy energy. Will be back — probably tomorrow.',
  },
  {
    name: 'Health & beauty',
    business: 'Linden Dental',
    slug: 'linden-dental',
    headerQ: 'How was your appointment?',
    tags: [
      'Listened to me',
      'Great results',
      'Clean clinic',
      'No upsell',
      'On schedule',
    ],
    reviewByTags: (tags) =>
      `First clinic in years where I didn't feel rushed. ${tags[0] || 'Listened to me'} from start to finish, and they walked through every option without the upsell. Booking the whole family in.`,
  },
  {
    name: 'Professional services',
    business: 'Brightwell Legal',
    slug: 'brightwell-legal',
    headerQ: 'How did we do?',
    tags: [
      'Clear comms',
      'Met deadlines',
      'Knew their stuff',
      'Patient',
      'Worth it',
    ],
    reviewByTags: (tags) =>
      `Brightwell took something I didn't understand and made it ten minutes of plain English. ${tags[0] || 'Clear comms'}, no jargon, every email answered same day. Worth every dollar.`,
  },
  {
    name: 'Retail',
    business: 'Sparrow & Co',
    slug: 'sparrow-co',
    headerQ: 'How was your visit?',
    tags: [
      'Great selection',
      'Helpful staff',
      'Easy returns',
      'Fair price',
      'Fast checkout',
    ],
    reviewByTags: (tags) =>
      `Came in for one thing, left with three — and not because anyone pushed. ${tags[0] || 'Great selection'}, the staff actually know the stock, and checkout took thirty seconds. My new local.`,
  },
  {
    name: 'Auto',
    business: 'Northside Auto',
    slug: 'northside-auto',
    headerQ: 'How did the service go?',
    tags: [
      'Honest quote',
      'Job done right',
      'On time',
      'Explained well',
      'Loaner sorted',
    ],
    reviewByTags: (tags) =>
      `Quoted me a fair number on the phone, came in cheaper at pickup. ${tags[0] || 'Honest quote'}, ready when they said it would be, and they actually showed me the part they replaced. Found my mechanic.`,
  },
];

// ─── Page shell ─────────────────────────────────────────────────────────────
export function LandingPage() {
  const { sessionLoading, isAuthenticated } = useCurrentUser();
  const [, navigate] = useLocation();
  const [activeIndustry, setActiveIndustry] = useState(0);

  function handleGetStarted() {
    if (isAuthenticated) navigate('/');
    else navigate('/signup');
  }

  return (
    <div id="top" className="vlanding">
      <Nav
        authed={isAuthenticated}
        loading={sessionLoading}
        onSignIn={handleGetStarted}
        onDashboard={() => navigate('/')}
      />
      <Hero
        profile={INDUSTRY_PROFILES[activeIndustry]}
        onGetStarted={handleGetStarted}
      />
      <Trusted />
      <Problem />
      <HowItWorks />
      <TwoPaths />
      <Industries
        activeIndustry={activeIndustry}
        setActiveIndustry={setActiveIndustry}
      />
      <DashboardShowcase />
      <Quote />
      <Setup />
      <Pricing onGetStarted={handleGetStarted} />
      <DirectorySection />
      <FAQ />
      <FinalCTA onGetStarted={handleGetStarted} />
      <Footer />
    </div>
  );
}

// ─── Nav ────────────────────────────────────────────────────────────────────
function Nav({
  authed,
  loading,
  onSignIn,
  onDashboard,
}: {
  authed: boolean;
  loading: boolean;
  onSignIn: () => void;
  onDashboard: () => void;
}) {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'rgba(244, 241, 234, 0.85)',
        backdropFilter: 'saturate(140%) blur(14px)',
        WebkitBackdropFilter: 'saturate(140%) blur(14px)',
        borderBottom: '1px solid var(--pm-line-soft)',
      }}
    >
      <div style={shellStyle}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 64,
          }}
        >
          <Wordmark size={24} />
          <nav style={{ display: 'flex', gap: 28, alignItems: 'center' }}>
            <a href="#how" className="pm-nav-link" style={navLinkStyle}>
              How it works
            </a>
            <a href="#pricing" className="pm-nav-link" style={navLinkStyle}>
              Pricing
            </a>
            <Link
              href="/directory"
              className="pm-nav-link"
              style={navLinkStyle}
            >
              Directory
            </Link>
            {!loading &&
              (authed ? (
                <button onClick={onDashboard} style={primaryBtnStyle}>
                  Dashboard
                </button>
              ) : (
                <button onClick={onSignIn} style={primaryBtnStyle}>
                  Start free <ArrowRight size={13} color="var(--pm-lime)" />
                </button>
              ))}
          </nav>
        </div>
      </div>
    </header>
  );
}

// ─── Hero with live interactive demo ────────────────────────────────────────
function Hero({
  profile,
  onGetStarted,
}: {
  profile: IndustryProfile;
  onGetStarted: () => void;
}) {
  const offer = useOffer();
  return (
    <section
      style={{
        background: 'var(--pm-ink)',
        color: 'var(--pm-paper)',
        position: 'relative',
        overflow: 'hidden',
        padding: 'clamp(56px, 10vw, 80px) 0 clamp(72px, 12vw, 100px)',
      }}
    >
      <div style={shellStyle}>
        <div
          className="pm-hero-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 64,
            alignItems: 'center',
          }}
        >
          <div>
            <div
              className="pm-rise-in"
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 13,
                color: 'var(--pm-lime)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 14px',
                borderRadius: 999,
                border: '1px solid rgba(111,168,255,0.3)',
                background: 'rgba(111,168,255,0.06)',
              }}
            >
              <span style={{ color: 'var(--pm-lime)' }}>★★★★★</span>
              <span style={{ color: 'rgba(244,241,234,0.7)' }}>
                AI-powered review capture
              </span>
            </div>

            <h1
              className="pm-h-display pm-rise-in"
              style={{
                marginTop: 32,
                color: 'var(--pm-paper)',
                fontSize: 'clamp(56px, 9vw, 144px)',
              }}
            >
              Reviews, on tap<span style={{ color: 'var(--pm-lime)' }}>.</span>
            </h1>

            <p
              className="pm-lead pm-rise-in"
              style={{
                marginTop: 28,
                color: 'rgba(244,241,234,0.72)',
                maxWidth: 560,
              }}
            >
              One link. Three taps. A polished, human-sounding review pasted
              straight into Google. Bad ratings? They never make it that far —
              they go to your inbox instead.
            </p>

            <div
              className="pm-rise-in"
              style={{
                marginTop: 36,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <button onClick={onGetStarted} style={limeBtnStyle}>
                Start free <ArrowRight size={14} />
              </button>
              <a href="#how" style={ghostDarkBtnStyle}>
                See how it works
              </a>
            </div>

            <div
              className="pm-rise-in"
              style={{
                marginTop: 28,
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 12,
                color: 'rgba(244,241,234,0.45)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              {offer?.trialLimit
                ? `First ${offer.trialLimit} reviews free`
                : 'First reviews free'}{' '}
              · No card to start ·{' '}
              {offer?.unitAmount != null
                ? `${tidyMoney(offer.unitAmount, offer.currency)}/mo after`
                : 'Simple monthly pricing after'}
            </div>
          </div>

          <div
            className="pm-hero-phone-wrap"
            style={{ display: 'flex', justifyContent: 'center' }}
          >
            <LiveDemo profile={profile} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Live demo (phone mock) ─────────────────────────────────────────────────
function LiveDemo({ profile }: { profile: IndustryProfile }) {
  const [step, setStep] = useState<1 | 2 | 3 | 'private'>(1);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [picks, setPicks] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [reviewText, setReviewText] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setStep(1);
    setRating(0);
    setHoverRating(0);
    setPicks(new Set());
    setReviewText('');
    setCopied(false);
  }, [profile?.slug]);

  const togglePick = (t: string) => {
    setPicks((p) => {
      const n = new Set(p);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  };

  const handleRate = (n: number) => {
    setRating(n);
    setTimeout(() => setStep(n === 5 ? 2 : 'private'), 350);
  };

  const handleGenerate = () => {
    if (picks.size === 0) return;
    setGenerating(true);
    setStep(3);
    setTimeout(() => {
      setReviewText(profile.reviewByTags(Array.from(picks)));
      setGenerating(false);
    }, 1100);
  };

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const reset = () => {
    setStep(1);
    setRating(0);
    setHoverRating(0);
    setPicks(new Set());
    setReviewText('');
    setCopied(false);
  };

  return (
    <div
      style={{
        width: 320,
        height: 660,
        borderRadius: 48,
        background: 'var(--pm-ink)',
        padding: 12,
        boxShadow:
          '0 40px 80px rgba(11,15,10,0.18), 0 0 0 1px rgba(11,15,10,0.4)',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 38,
          background: 'var(--pm-paper)',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 90,
            height: 24,
            borderRadius: 12,
            background: 'var(--pm-ink)',
            zIndex: 5,
          }}
        />

        <div
          style={{
            padding: '52px 22px 22px',
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 18,
            }}
          >
            <ProofMark size={22} />
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: '-0.02em',
                color: 'var(--pm-ink)',
              }}
            >
              {profile.business}
            </div>
          </div>

          {step === 1 && (
            <div
              className="pm-rise-in"
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.05,
                  color: 'var(--pm-ink)',
                }}
              >
                {profile.headerQ}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--pm-muted)',
                  marginTop: 10,
                }}
              >
                Tap a star. About 15 seconds.
              </div>
              <div
                style={{
                  marginTop: 36,
                  display: 'flex',
                  justifyContent: 'center',
                  gap: 6,
                }}
                onMouseLeave={() => setHoverRating(0)}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <svg
                    key={n}
                    width={42}
                    height={42}
                    viewBox="0 0 24 24"
                    onClick={() => handleRate(n)}
                    onMouseEnter={() => setHoverRating(n)}
                    style={{
                      cursor: 'pointer',
                      transition: 'transform 160ms cubic-bezier(.2,.8,.2,1)',
                      transform: hoverRating >= n ? 'scale(1.12)' : 'scale(1)',
                    }}
                  >
                    <path
                      d="M12 2 L14.9 8.6 L22 9.3 L16.5 14.1 L18.2 21 L12 17.3 L5.8 21 L7.5 14.1 L2 9.3 L9.1 8.6 Z"
                      fill={
                        (hoverRating || rating) >= n
                          ? 'var(--pm-ink)'
                          : 'rgba(11,15,10,0.18)'
                      }
                    />
                  </svg>
                ))}
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  color: 'var(--pm-muted)',
                  fontFamily: 'var(--pm-font-mono)',
                }}
              >
                <span>Not great</span>
                <span>Loved it</span>
              </div>
              <div
                style={{
                  marginTop: 'auto',
                  textAlign: 'center',
                  fontSize: 11,
                  color: 'var(--pm-muted)',
                  fontFamily: 'var(--pm-font-mono)',
                }}
              >
                verdiict.com/r/{profile.slug}
              </div>
            </div>
          )}

          {step === 2 && (
            <div
              className="pm-rise-in"
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <Stars filled={5} size={16} />
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.1,
                  marginTop: 18,
                  color: 'var(--pm-ink)',
                }}
              >
                What went well?
              </div>
              <div
                style={{ fontSize: 12, color: 'var(--pm-muted)', marginTop: 6 }}
              >
                Pick a few. We'll do the writing.
              </div>
              <div
                style={{
                  marginTop: 18,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {profile.tags.map((t) => {
                  const sel = picks.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() => togglePick(t)}
                      style={{
                        fontSize: 12,
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: sel
                          ? '2px solid var(--pm-ink)'
                          : '2px solid rgba(11,15,10,0.18)',
                        background: sel ? 'var(--pm-ink)' : 'transparent',
                        color: sel ? 'var(--pm-lime)' : 'var(--pm-ink)',
                        fontWeight: sel ? 600 : 500,
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        transition: 'all 160ms cubic-bezier(.2,.8,.2,1)',
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleGenerate}
                style={{
                  marginTop: 'auto',
                  background:
                    picks.size === 0 ? 'rgba(11,15,10,0.25)' : 'var(--pm-ink)',
                  color:
                    picks.size === 0
                      ? 'rgba(244,241,234,0.6)'
                      : 'var(--pm-paper)',
                  border: 'none',
                  borderRadius: 14,
                  padding: '14px 0',
                  fontSize: 14,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: picks.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                {picks.size === 0
                  ? 'Pick at least one tag'
                  : 'Generate my review →'}
              </button>
            </div>
          )}

          {step === 3 && (
            <div
              className="pm-rise-in"
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--pm-muted)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginBottom: 10,
                  fontFamily: 'var(--pm-font-mono)',
                }}
              >
                Your review · {generating ? 'writing…' : 'ready to post'}
              </div>
              <div
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  padding: 14,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: 'var(--pm-ink)',
                  border: '1px solid rgba(11,15,10,0.1)',
                  minHeight: 130,
                }}
              >
                {generating ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 6,
                      alignItems: 'center',
                      color: 'var(--pm-muted)',
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: 3,
                        background: 'var(--pm-lime)',
                        animation: 'vl-pulse 800ms ease-in-out infinite',
                      }}
                    />
                    <span style={{ fontSize: 12 }}>Writing in your voice…</span>
                  </div>
                ) : (
                  reviewText
                )}
              </div>
              {!generating && reviewText && (
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 11,
                    color: 'var(--pm-muted)',
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      background: copied
                        ? 'var(--pm-lime)'
                        : 'rgba(11,15,10,0.3)',
                    }}
                  />
                  <span
                    style={{
                      fontFamily: 'var(--pm-font-mono)',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {copied ? 'Copied to clipboard' : 'Tap to copy'}
                  </span>
                </div>
              )}
              <div
                style={{
                  marginTop: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <button
                  onClick={handleCopy}
                  disabled={generating}
                  style={{
                    background: 'var(--pm-ink)',
                    color: 'var(--pm-lime)',
                    border: 'none',
                    borderRadius: 12,
                    padding: '13px 0',
                    fontSize: 13,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    cursor: generating ? 'wait' : 'pointer',
                    opacity: generating ? 0.5 : 1,
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      background: 'var(--pm-lime)',
                      borderRadius: 3,
                      color: 'var(--pm-ink)',
                      fontSize: 11,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    G
                  </span>
                  Open Google &amp; paste
                </button>
                <button
                  onClick={reset}
                  style={{
                    background: 'transparent',
                    color: 'var(--pm-ink)',
                    border: '1.5px solid rgba(11,15,10,0.2)',
                    borderRadius: 12,
                    padding: '10px 0',
                    fontSize: 12,
                    fontWeight: 500,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  Start over
                </button>
              </div>
            </div>
          )}

          {step === 'private' && (
            <div
              className="pm-rise-in"
              style={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
              }}
            >
              <Stars filled={rating} size={14} />
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: '-0.035em',
                  lineHeight: 1.1,
                  marginTop: 18,
                  color: 'var(--pm-ink)',
                }}
              >
                Sorry to hear that.
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--pm-muted)',
                  marginTop: 10,
                  lineHeight: 1.4,
                }}
              >
                Tell the owner directly. They'll see this — nobody else will.
              </div>
              <div
                style={{
                  marginTop: 18,
                  background: '#fff',
                  border: '1px solid rgba(11,15,10,0.12)',
                  borderRadius: 12,
                  padding: 12,
                  minHeight: 110,
                  fontSize: 12,
                  color: 'rgba(11,15,10,0.4)',
                  fontStyle: 'italic',
                }}
              >
                What could have been better?
              </div>
              <button
                onClick={reset}
                style={{
                  marginTop: 'auto',
                  background: 'var(--pm-ink)',
                  color: 'var(--pm-paper)',
                  border: 'none',
                  borderRadius: 12,
                  padding: '13px 0',
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                Send privately
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Trusted marquee ────────────────────────────────────────────────────────
function Trusted() {
  const logos = [
    'Hospitality',
    'Trades',
    'Auto',
    'Health & beauty',
    'Retail',
    'Professional services',
    'Home services',
    'Fitness',
  ];
  return (
    <section
      style={{
        background: 'var(--pm-paper)',
        padding: '48px 0',
        borderTop: '1px solid var(--pm-line-soft)',
        borderBottom: '1px solid var(--pm-line-soft)',
      }}
    >
      <div style={shellStyle}>
        <div
          style={{
            fontFamily: 'var(--pm-font-mono)',
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--pm-muted)',
            textAlign: 'center',
            marginBottom: 24,
          }}
        >
          Built for every kind of ★★★★★ business
        </div>
      </div>
      <div className="pm-marquee">
        <div className="pm-marquee-track">
          {[...logos, ...logos, ...logos].map((l, i) => (
            <div
              key={i}
              style={{
                fontSize: 'clamp(24px, 3vw, 36px)',
                fontWeight: 600,
                letterSpacing: '-0.025em',
                color: 'rgba(11,15,10,0.4)',
                whiteSpace: 'nowrap',
              }}
            >
              {l}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Problem ────────────────────────────────────────────────────────────────
function Problem() {
  return (
    <section
      style={{
        background: 'var(--pm-paper)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="The problem"
          title="Most businesses run on reviews. Most don't have enough."
        />
        <div
          className="pm-problem-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 32,
            marginTop: 80,
          }}
        >
          {[
            {
              stat: '93%',
              label:
                'of consumers say online reviews influence their purchase decisions.',
            },
            {
              stat: '4.0+',
              label:
                'minimum star rating buyers expect before they consider a business.',
            },
            {
              stat: '1 / 10',
              label:
                'happy customers actually leaves a review without being asked.',
            },
          ].map((s) => (
            <div
              key={s.stat}
              style={{ borderTop: '2px solid var(--pm-ink)', paddingTop: 24 }}
            >
              <div
                style={{
                  fontSize: 'clamp(56px, 8vw, 112px)',
                  fontWeight: 700,
                  letterSpacing: '-0.05em',
                  lineHeight: 1,
                  color: 'var(--pm-ink)',
                }}
              >
                {s.stat}
              </div>
              <div
                style={{
                  marginTop: 20,
                  fontSize: 16,
                  lineHeight: 1.55,
                  color: 'var(--pm-ink)',
                  maxWidth: 360,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── How it works ───────────────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      n: '01',
      title: 'Rate',
      desc: 'Customer taps a star rating on your unique link.',
      detail:
        '5 stars goes to the review builder. 1–4 stars routes to your inbox as private feedback.',
    },
    {
      n: '02',
      title: 'Pick',
      desc: 'They choose from your custom "what went well" tags.',
      detail:
        '2–4 tags become the spine of the review — so it sounds specific to you, not generic.',
    },
    {
      n: '03',
      title: 'Post',
      desc: 'AI writes a polished review. They tap, copy, post.',
      detail:
        'Average time end-to-end: 15 seconds. Paste into Google, Facebook, Trustpilot, Yelp.',
    },
  ];
  return (
    <section
      id="how"
      style={{
        background: 'var(--pm-paper-2)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="How it works"
          title="Three taps. About fifteen seconds."
          sub="The customer flow is the product. Owners share one link — on a sticker, in an email, in a text. Customers do the rest, almost without trying."
        />
        <div
          className="pm-hiw-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 20,
            marginTop: 72,
          }}
        >
          {steps.map((s) => (
            <div
              key={s.n}
              style={{
                background: 'var(--pm-ink)',
                color: 'var(--pm-paper)',
                borderRadius: 22,
                padding: 32,
                minHeight: 320,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--pm-font-mono)',
                  fontSize: 13,
                  color: 'var(--pm-lime)',
                  letterSpacing: '0.12em',
                }}
              >
                {s.n}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 'clamp(44px, 5vw, 64px)',
                    fontWeight: 700,
                    letterSpacing: '-0.04em',
                    lineHeight: 1,
                  }}
                >
                  {s.title}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    color: 'rgba(244,241,234,0.75)',
                    fontSize: 16,
                    lineHeight: 1.55,
                  }}
                >
                  {s.desc}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    fontFamily: 'var(--pm-font-mono)',
                    fontSize: 12,
                    color: 'rgba(244,241,234,0.45)',
                    lineHeight: 1.5,
                    letterSpacing: '0.02em',
                  }}
                >
                  {s.detail}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Two paths ──────────────────────────────────────────────────────────────
function TwoPaths() {
  return (
    <section
      style={{
        background: 'var(--pm-ink)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="The killer feature"
          title={
            <>
              Negative feedback never{' '}
              <span style={{ color: 'var(--pm-lime)' }}>blindsides you.</span>
            </>
          }
          sub="Every rating gets routed. Five stars become a polished public review. One-to-four stars become a quiet message to your inbox — a chance to make it right before the world sees."
          dark
        />
        <div
          className="pm-paths-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            marginTop: 64,
          }}
        >
          <div
            style={{
              background: 'rgba(111,168,255,0.08)',
              border: '1.5px solid rgba(111,168,255,0.3)',
              borderRadius: 20,
              padding: 36,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 12,
                color: 'var(--pm-lime)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              5 stars · public
            </div>
            <Stars
              filled={5}
              size={22}
              color="var(--pm-lime)"
              emptyColor="rgba(244,241,234,0.2)"
            />
            <div
              className="pm-h-3"
              style={{ marginTop: 24, color: 'var(--pm-paper)' }}
            >
              Routed to the review builder. AI writes it. Customer posts it
              publicly.
            </div>
          </div>
          <div
            style={{
              background: 'rgba(244,241,234,0.04)',
              border: '1.5px solid rgba(244,241,234,0.15)',
              borderRadius: 20,
              padding: 36,
            }}
          >
            <div
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 12,
                color: 'rgba(244,241,234,0.55)',
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                marginBottom: 16,
              }}
            >
              1–4 stars · private
            </div>
            <Stars
              filled={3}
              size={22}
              color="rgba(244,241,234,0.65)"
              emptyColor="rgba(244,241,234,0.15)"
            />
            <div
              className="pm-h-3"
              style={{ marginTop: 24, color: 'var(--pm-paper)' }}
            >
              Sent privately to your inbox. You get a chance to fix it before
              the world sees.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Industries (shares activeIndustry state with the hero demo) ────────────
function Industries({
  activeIndustry,
  setActiveIndustry,
}: {
  activeIndustry: number;
  setActiveIndustry: (i: number) => void;
}) {
  const active = INDUSTRY_PROFILES[activeIndustry];
  return (
    <section
      style={{
        background: 'var(--pm-paper)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="Industry coverage"
          title="Industry-matched tags. Out of the box."
          sub="Pick your category — the demo above and your tags update in real time. Edit anything, anytime."
        />
        {/* Mobile-only horizontal pill scroller */}
        <div
          className="pm-ind-pills"
          style={{
            display: 'none',
            marginTop: 32,
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch',
            scrollSnapType: 'x mandatory',
            paddingBottom: 8,
            marginLeft: -16,
            marginRight: -16,
            paddingLeft: 16,
            paddingRight: 16,
            gap: 8,
          }}
        >
          {INDUSTRY_PROFILES.map((ind, i) => {
            const sel = i === activeIndustry;
            return (
              <button
                key={ind.name}
                onClick={() => setActiveIndustry(i)}
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: 'start',
                  border: sel
                    ? '1.5px solid var(--pm-ink)'
                    : '1px solid var(--pm-line)',
                  background: sel ? 'var(--pm-ink)' : 'transparent',
                  color: sel ? 'var(--pm-paper)' : 'var(--pm-ink)',
                  borderRadius: 999,
                  padding: '10px 18px',
                  fontFamily: 'inherit',
                  fontSize: 15,
                  fontWeight: sel ? 700 : 500,
                  letterSpacing: '-0.01em',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {sel && (
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      background: 'var(--pm-lime)',
                    }}
                  />
                )}
                {ind.name}
              </button>
            );
          })}
        </div>
        <div
          className="pm-ind-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 360px) 1fr',
            gap: 48,
            marginTop: 64,
          }}
        >
          <div
            className="pm-ind-list"
            style={{ display: 'flex', flexDirection: 'column' }}
          >
            {INDUSTRY_PROFILES.map((ind, i) => {
              const sel = i === activeIndustry;
              return (
                <button
                  key={ind.name}
                  onClick={() => setActiveIndustry(i)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    borderTop: '1px solid var(--pm-line)',
                    borderBottom:
                      i === INDUSTRY_PROFILES.length - 1
                        ? '1px solid var(--pm-line)'
                        : 'none',
                    padding: '20px 0',
                    fontFamily: 'inherit',
                    fontSize: 'clamp(20px, 2.2vw, 28px)',
                    fontWeight: sel ? 700 : 500,
                    letterSpacing: '-0.025em',
                    textAlign: 'left',
                    color: sel ? 'var(--pm-ink)' : 'rgba(11,15,10,0.45)',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'color 200ms',
                  }}
                >
                  <span>{ind.name}</span>
                  {sel && (
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        background: 'var(--pm-lime)',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div
            style={{
              background: 'var(--pm-paper-3)',
              border: '1px solid var(--pm-line-soft)',
              borderRadius: 22,
              padding: 36,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div className="pm-eyebrow">Pre-loaded win tags</div>
            <div className="pm-h-3" style={{ marginTop: 12 }}>
              {active.name}
            </div>
            <div
              style={{
                marginTop: 28,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              {active.tags.map((t, i) => (
                <span
                  key={t}
                  className="pm-chip"
                  style={{
                    animation: `vl-rise 320ms cubic-bezier(.2,.8,.2,1) ${i * 40}ms both`,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 32,
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 12,
                color: 'var(--pm-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              Edit, add, remove · zero friction
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Dashboard showcase ─────────────────────────────────────────────────────
function DashboardShowcase() {
  const kpis = [
    { v: '142', l: 'Reviews captured', d: '+38 vs prev' },
    { v: '4.9★', l: 'Avg rating posted', d: 'of 5.0' },
    { v: '94%', l: 'Posted to Google', d: '8 to Facebook' },
    { v: '11', l: 'Private feedback', d: 'in your inbox' },
  ];
  const recent = [
    {
      name: 'Sarah M.',
      stars: 5,
      text: "Genuinely the best service we've had in years. Staff make you feel at home.",
      plat: 'Google',
      t: '12m ago',
    },
    {
      name: 'Tom R.',
      stars: 5,
      text: 'Fast, friendly, and they actually listen. Already booked again.',
      plat: 'Google',
      t: '1h ago',
    },
    {
      name: 'Anonymous',
      stars: 3,
      text: '[Private] Wait was longer than expected. Otherwise great.',
      plat: 'Inbox',
      t: '3h ago',
    },
    {
      name: 'Priya K.',
      stars: 5,
      text: 'Knew their stuff, no upsell, fair price. Found my regular.',
      plat: 'Facebook',
      t: '6h ago',
    },
  ];
  return (
    <section
      style={{
        background: 'var(--pm-paper-2)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="The owner dashboard"
          title="One screen for the whole story."
          sub="Reviews captured, average rating, which platforms got them, private feedback that needs your reply. The boring stuff is automatic — auto-synced every couple minutes."
        />
        <div
          className="pm-dash-frame"
          style={{
            marginTop: 64,
            background: '#fff',
            borderRadius: 20,
            border: '1px solid var(--pm-line-soft)',
            boxShadow: '0 30px 60px rgba(11,15,10,0.06)',
            overflow: 'hidden',
            display: 'flex',
            minHeight: 540,
          }}
        >
          <div
            className="pm-dash-side"
            style={{
              width: 200,
              background: 'var(--pm-ink)',
              color: 'var(--pm-paper)',
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
            }}
          >
            <Wordmark dark withBy size={18} />
            <div
              style={{
                marginTop: 20,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}
            >
              {[
                'Overview',
                'Reviews log',
                'Tags',
                'Platforms',
                'Locations',
                'Settings',
              ].map((l, i) => (
                <div
                  key={l}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    fontSize: 13,
                    fontWeight: i === 0 ? 600 : 400,
                    background: i === 0 ? 'var(--pm-lime)' : 'transparent',
                    color: i === 0 ? 'var(--pm-ink)' : 'rgba(244,241,234,0.7)',
                  }}
                >
                  {l}
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 'auto',
                paddingTop: 16,
                borderTop: '1px solid rgba(244,241,234,0.15)',
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 11,
                color: 'rgba(244,241,234,0.5)',
              }}
            >
              Your Business · Location
            </div>
          </div>
          <div
            style={{
              flex: 1,
              padding: 28,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
              minWidth: 0,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <div>
                <div className="pm-h-3" style={{ fontSize: 24 }}>
                  Last 30 days
                </div>
                <div
                  style={{
                    fontFamily: 'var(--pm-font-mono)',
                    fontSize: 12,
                    color: 'var(--pm-muted)',
                    marginTop: 2,
                  }}
                >
                  APR 01 – APR 30, 2026
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{
                    padding: '8px 14px',
                    fontSize: 12,
                    border: '1px solid var(--pm-line)',
                    borderRadius: 8,
                    background: '#fff',
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                    color: 'var(--pm-ink)',
                  }}
                >
                  Share link
                </button>
                <button
                  style={{
                    padding: '8px 14px',
                    fontSize: 12,
                    border: 'none',
                    borderRadius: 8,
                    background: 'var(--pm-ink)',
                    color: 'var(--pm-lime)',
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  + New location
                </button>
              </div>
            </div>
            <div
              className="pm-kpi-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 10,
              }}
            >
              {kpis.map((k) => (
                <div
                  key={k.l}
                  style={{
                    background: 'var(--pm-paper)',
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 30,
                      fontWeight: 700,
                      letterSpacing: '-0.03em',
                      lineHeight: 1,
                      color: 'var(--pm-ink)',
                    }}
                  >
                    {k.v}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: 'var(--pm-ink)',
                      marginTop: 8,
                      fontWeight: 500,
                    }}
                  >
                    {k.l}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--pm-font-mono)',
                      fontSize: 10,
                      color: 'var(--pm-muted)',
                      marginTop: 2,
                    }}
                  >
                    {k.d}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                background: 'var(--pm-paper)',
                borderRadius: 12,
                padding: 18,
                flex: 1,
                minHeight: 180,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--pm-ink)',
                  }}
                >
                  Recent reviews
                </div>
                <div
                  style={{
                    fontFamily: 'var(--pm-font-mono)',
                    fontSize: 10,
                    color: 'var(--pm-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  AUTO-SYNCED · 2 MIN AGO
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recent.map((r, i) => (
                  <div
                    key={i}
                    className="pm-rev-row"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '110px 76px 1fr 80px 70px',
                      gap: 10,
                      padding: '8px 4px',
                      borderTop:
                        i === 0 ? 'none' : '1px solid var(--pm-line-soft)',
                      alignItems: 'center',
                      fontSize: 12,
                      color: 'var(--pm-ink)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    <Stars size={12} filled={r.stars} />
                    <div
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        opacity: r.plat === 'Inbox' ? 0.6 : 1,
                      }}
                    >
                      {r.text}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--pm-font-mono)',
                        fontSize: 10,
                        padding: '3px 8px',
                        borderRadius: 999,
                        background:
                          r.plat === 'Inbox'
                            ? 'var(--pm-ink)'
                            : 'var(--pm-lime)',
                        color:
                          r.plat === 'Inbox'
                            ? 'var(--pm-lime)'
                            : 'var(--pm-ink)',
                        fontWeight: 600,
                        textAlign: 'center',
                        justifySelf: 'start',
                      }}
                    >
                      {r.plat}
                    </div>
                    <div
                      style={{
                        fontFamily: 'var(--pm-font-mono)',
                        fontSize: 10,
                        color: 'var(--pm-muted)',
                        textAlign: 'right',
                      }}
                    >
                      {r.t}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Quote ──────────────────────────────────────────────────────────────────
function Quote() {
  return (
    <section
      style={{
        background: 'var(--pm-lime)',
        padding: 'clamp(56px, 10vw, 80px) 0',
      }}
    >
      <div style={shellStyle}>
        <div style={{ maxWidth: 1100 }}>
          <div
            style={{
              fontFamily: 'var(--pm-font-mono)',
              fontSize: 13,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--pm-ink)',
            }}
          >
            ★★★★★ Heard back from owners
          </div>
          <div
            style={{
              fontSize: 'clamp(32px, 4.4vw, 64px)',
              fontWeight: 600,
              letterSpacing: '-0.035em',
              lineHeight: 1.1,
              marginTop: 28,
              color: 'var(--pm-ink)',
              textWrap: 'balance',
            }}
          >
            The businesses who deserve the most reviews are usually the worst at
            asking. Verdiict does the asking, gracefully, every single time.
          </div>
          <div
            style={{
              marginTop: 32,
              fontFamily: 'var(--pm-font-mono)',
              fontSize: 12,
              color: 'rgba(11,15,10,0.6)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Why we built this
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Setup ──────────────────────────────────────────────────────────────────
function Setup() {
  const steps = [
    { t: '0:00', l: 'Sign up', d: 'Email + business name. No card.' },
    { t: '0:45', l: 'Pick your industry', d: 'Pre-loaded win tags appear.' },
    {
      t: '2:10',
      l: 'Add your platforms',
      d: 'Google + whichever else matters.',
    },
    {
      t: '3:30',
      l: 'Drop in your logo',
      d: 'Yours, not ours, on the review page.',
    },
    {
      t: '4:30',
      l: 'Copy your link',
      d: 'QR code, sticker, email signature — go.',
    },
  ];
  return (
    <section
      style={{
        background: 'var(--pm-paper)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead
          eyebrow="Setup"
          title="Five minutes from signup to your first link."
        />
        <div
          style={{ marginTop: 64, display: 'flex', flexDirection: 'column' }}
        >
          {steps.map((s, i) => (
            <div
              key={s.t}
              className="pm-setup-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr 1.2fr 40px',
                gap: 24,
                alignItems: 'center',
                padding: '24px 0',
                borderTop: '1px solid var(--pm-line)',
                borderBottom:
                  i === steps.length - 1 ? '1px solid var(--pm-line)' : 'none',
              }}
            >
              <div
                className="pm-setup-time"
                style={{
                  fontFamily: 'var(--pm-font-mono)',
                  fontSize: 'clamp(20px, 2.4vw, 28px)',
                  fontWeight: 500,
                  color: 'var(--pm-ink)',
                }}
              >
                {s.t}
              </div>
              <div
                className="pm-setup-title"
                style={{ display: 'flex', alignItems: 'center', gap: 12 }}
              >
                <span
                  className="pm-setup-check-mobile"
                  style={{
                    display: 'none',
                    flexShrink: 0,
                    width: 24,
                    height: 24,
                    borderRadius: 12,
                    background: 'var(--pm-lime)',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CheckIcon size={12} />
                </span>
                <span className="pm-h-3">{s.l}</span>
              </div>
              <div
                className="pm-setup-desc"
                style={{
                  color: 'var(--pm-muted)',
                  fontSize: 'clamp(15px, 1.6vw, 18px)',
                  lineHeight: 1.5,
                }}
              >
                {s.d}
              </div>
              <div
                className="pm-setup-check-desktop"
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  background: 'var(--pm-lime)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  justifySelf: 'end',
                }}
              >
                <CheckIcon size={16} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ────────────────────────────────────────────────────────────────
// NOTE: intentionally NO dollar figures — there is no public pricing procedure
// yet (the reviews offer lives behind protected reviews.entitlement /
// featureSubscriptions.catalog). Trial framing only; wire real numbers in once
// a publicProcedure exposes the Reviews product price.
function Pricing({ onGetStarted }: { onGetStarted: () => void }) {
  const offer = useOffer();
  const features = [
    'Unlimited reviews',
    'AI generation',
    'Private feedback routing',
    'All review platforms',
    'Custom branding',
    'Industry win tags',
    'Reviews log + analytics',
    'Multiple locations',
  ];
  return (
    <section
      id="pricing"
      style={{
        background: 'var(--pm-lime)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <div
          style={{
            fontFamily: 'var(--pm-font-mono)',
            fontSize: 13,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--pm-ink)',
          }}
        >
          Pricing
        </div>
        <div
          className="pm-price-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: 48,
            alignItems: 'flex-end',
            marginTop: 24,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 'clamp(16px, 1.6vw, 20px)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              One simple plan
            </div>
            <div
              style={{
                fontSize: 'clamp(96px, 16vw, 240px)',
                fontWeight: 700,
                letterSpacing: '-0.06em',
                lineHeight: 0.85,
              }}
            >
              {offer?.unitAmount != null
                ? tidyMoney(offer.unitAmount, offer.currency)
                : 'Free'}
            </div>
            <div
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 'clamp(16px, 1.6vw, 20px)',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontWeight: 500,
                color: 'rgba(11,15,10,0.7)',
                marginTop: 8,
              }}
            >
              {offer?.unitAmount != null
                ? `/mo · first ${offer.trialLimit} reviews free`
                : 'to start · simple monthly pricing after'}
            </div>
          </div>
          <div
            style={{
              paddingBottom: 'clamp(20px, 4vw, 48px)',
              maxWidth: 520,
              display: 'flex',
              flexDirection: 'column',
              gap: 24,
            }}
          >
            <p
              className="pm-lead"
              style={{ fontWeight: 500, color: 'var(--pm-ink)' }}
            >
              Start free — your first reviews are on us. After that it's one
              simple monthly plan for your whole brand: everything included, no
              tiers, no add-ons, no surprises. Each location gets its own link,
              QR code, and analytics. Cancel any time.
            </p>
            <div
              style={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                padding: '10px 16px',
                borderRadius: 999,
                background: 'var(--pm-ink)',
                color: 'var(--pm-lime)',
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
              Your first reviews on us
            </div>
          </div>
        </div>
        <div
          className="pm-features-grid"
          style={{
            marginTop: 56,
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}
        >
          {features.map((f) => (
            <div
              key={f}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 16,
                fontWeight: 500,
                padding: '14px 0',
                borderTop: '1px solid rgba(11,15,10,0.25)',
                color: 'var(--pm-ink)',
              }}
            >
              <CheckIcon size={16} />
              {f}
            </div>
          ))}
        </div>
        <div
          style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap' }}
        >
          <button onClick={onGetStarted} style={primaryBtnStyle}>
            Get started <ArrowRight size={14} color="var(--pm-lime)" />
          </button>
          <button onClick={onGetStarted} style={ghostOnLimeBtnStyle}>
            See pricing <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </section>
  );
}

// ─── FAQ ────────────────────────────────────────────────────────────────────
function FAQ() {
  const [open, setOpen] = useState<number>(0);
  const items = [
    {
      q: 'Is this legal? Filtering bad reviews?',
      a: "We don't filter — we route. Five-star ratings get the public review builder. One-to-four stars get a private feedback form. Customers always know where their feedback is going. We just remove the friction from saying something nice, and add a path for saying something honest in private.",
    },
    {
      q: 'Does it work with platforms other than Google?',
      a: 'Yes — Google, Facebook, Trustpilot, Yelp, and Tripadvisor are supported out of the box. Customers pick which one to post to, or you set a default per location.',
    },
    {
      q: 'Will the AI sound robotic?',
      a: "It won't. The reviews are generated from the specific tags your customer picked, plus your business context. The result reads like a thoughtful regular, not a press release. They can also regenerate or tweak before posting.",
    },
    {
      q: 'What if I have multiple locations?',
      a: 'Each location gets its own link, its own QR code, its own analytics. Pricing is per location, no minimum.',
    },
    {
      q: 'How do I share the link?',
      a: "However you talk to customers. Sticker on the counter, QR on the receipt, email signature, post-purchase SMS — we'll generate the assets for each.",
    },
  ];
  return (
    <section
      style={{
        background: 'var(--pm-paper)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <SectionHead eyebrow="Questions, answered" title="The honest stuff." />
        <div style={{ marginTop: 56, maxWidth: 920 }}>
          {items.map((it, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                style={{
                  borderTop: '1px solid var(--pm-line)',
                  borderBottom:
                    i === items.length - 1
                      ? '1px solid var(--pm-line)'
                      : 'none',
                }}
              >
                <button
                  onClick={() => setOpen(isOpen ? -1 : i)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 24,
                    background: 'transparent',
                    border: 'none',
                    padding: '24px 0',
                    fontFamily: 'inherit',
                    fontSize: 'clamp(18px, 2vw, 24px)',
                    fontWeight: 600,
                    letterSpacing: '-0.02em',
                    color: 'var(--pm-ink)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <span>{it.q}</span>
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      background: isOpen ? 'var(--pm-ink)' : 'transparent',
                      color: isOpen ? 'var(--pm-lime)' : 'var(--pm-ink)',
                      border: isOpen
                        ? 'none'
                        : '1.5px solid rgba(11,15,10,0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 200ms cubic-bezier(.2,.8,.2,1)',
                      flexShrink: 0,
                      fontSize: 18,
                      fontWeight: 400,
                    }}
                  >
                    {isOpen ? '–' : '+'}
                  </span>
                </button>
                {isOpen && (
                  <div
                    className="pm-rise-in"
                    style={{
                      paddingBottom: 28,
                      fontSize: 'clamp(15px, 1.6vw, 18px)',
                      lineHeight: 1.55,
                      color: 'var(--pm-muted)',
                      maxWidth: 720,
                    }}
                  >
                    {it.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─── Directory section ─────────────────────────────────────────────────────
function DirectorySection() {
  const industries = [
    { label: 'Plumbing', slug: 'plumbing', icon: '🔧' },
    { label: 'Electrician', slug: 'electrician', icon: '⚡' },
    { label: 'Dentist', slug: 'dentist', icon: '🦷' },
    { label: 'Mechanic', slug: 'mechanic', icon: '🚗' },
    { label: 'Café', slug: 'cafe', icon: '☕' },
    { label: 'Gym', slug: 'gym', icon: '💪' },
    { label: 'Hairdresser', slug: 'hairdresser', icon: '✂️' },
    { label: 'Landscaping', slug: 'landscaping', icon: '🌿' },
  ];
  return (
    <section
      id="directory"
      style={{
        background: 'var(--pm-paper-2)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <div
          className="pm-dir-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 64,
            alignItems: 'center',
          }}
        >
          {/* Left: copy */}
          <div>
            <div
              style={{
                fontFamily: 'var(--pm-font-mono)',
                fontSize: 13,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--pm-muted)',
              }}
            >
              Verdiict Directory
            </div>
            <h2
              className="pm-h-display"
              style={{
                fontSize: 'clamp(40px, 6vw, 80px)',
                marginTop: 16,
                lineHeight: 1.05,
              }}
            >
              Get found.
              <br />
              <span style={{ color: 'var(--pm-lime-deep)' }}>Get chosen.</span>
            </h2>
            <p
              className="pm-lead"
              style={{ marginTop: 24, color: 'var(--pm-muted)' }}
            >
              Every Verdiict account gets a free public profile in the Verdiict
              Directory — a searchable, SEO-optimised listing that shows your
              star rating, verified reviews, and Best-in-Industry badge if
              you've earned it.
            </p>
            <p
              className="pm-lead"
              style={{ marginTop: 16, color: 'var(--pm-muted)' }}
            >
              Customers searching for the best plumber, dentist, or café in
              their suburb find you — not just your Google listing.
            </p>
            <div
              style={{
                marginTop: 36,
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <Link
                href="/directory"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  background: 'var(--pm-ink)',
                  color: 'var(--pm-paper)',
                  padding: '12px 22px',
                  borderRadius: 10,
                  fontWeight: 600,
                  fontSize: 15,
                  textDecoration: 'none',
                }}
              >
                Browse the directory <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          {/* Right: industry grid */}
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 12,
              }}
            >
              {industries.map((ind) => (
                <Link
                  key={ind.slug}
                  href={`/directory/industry/${ind.slug}`}
                  className="pm-dir-tile"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '16px 18px',
                    background: '#fff',
                    border: '1px solid var(--pm-line-soft)',
                    borderRadius: 12,
                    textDecoration: 'none',
                    color: 'var(--pm-ink)',
                    fontWeight: 500,
                    fontSize: 15,
                  }}
                >
                  <span style={{ fontSize: 22 }}>{ind.icon}</span>
                  <span>{ind.label}</span>
                </Link>
              ))}
            </div>
            {/* Best-in-Industry badge preview */}
            <div
              style={{
                marginTop: 16,
                padding: '16px 20px',
                background: '#fff',
                border: '1px solid var(--pm-line-soft)',
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 10,
                  background: 'var(--pm-lime)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  flexShrink: 0,
                }}
              >
                🏆
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  Best in Industry badge
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: 'var(--pm-muted)',
                    marginTop: 2,
                  }}
                >
                  Automatically awarded to the top 3 businesses in each industry
                  based on verified public reviews.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Final CTA ──────────────────────────────────────────────────────────────
function FinalCTA({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <section
      style={{
        background: 'var(--pm-ink)',
        padding: 'clamp(72px, 12vw, 120px) 0',
      }}
    >
      <div style={shellStyle}>
        <div
          style={{
            fontFamily: 'var(--pm-font-mono)',
            fontSize: 13,
            color: 'var(--pm-lime)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}
        >
          Ready when you are
        </div>
        <h2
          className="pm-h-display"
          style={{
            fontSize: 'clamp(56px, 11vw, 180px)',
            marginTop: 24,
            color: 'var(--pm-paper)',
          }}
        >
          Start collecting
          <br />
          <span style={{ color: 'var(--pm-lime)' }}>reviews today.</span>
        </h2>
        <div
          style={{ marginTop: 48, display: 'flex', gap: 12, flexWrap: 'wrap' }}
        >
          <button onClick={onGetStarted} style={limeBtnStyle}>
            Get started <ArrowRight size={14} />
          </button>
          <a href="#pricing" style={ghostDarkBtnStyle}>
            See pricing
          </a>
        </div>
        <div
          style={{
            marginTop: 32,
            fontFamily: 'var(--pm-font-mono)',
            fontSize: 13,
            color: 'rgba(244,241,234,0.5)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          ★ Free to start · Cancel any time
        </div>
      </div>
    </section>
  );
}

// ─── Footer ─────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer
      style={{
        background: 'var(--pm-ink)',
        borderTop: '1px solid rgba(244,241,234,0.1)',
        padding: '48px 0',
        color: 'rgba(244,241,234,0.55)',
      }}
    >
      <div
        style={{
          ...shellStyle,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          gap: 24,
        }}
      >
        <div>
          <Wordmark dark withBy size={24} />
          <div
            style={{
              marginTop: 16,
              fontFamily: 'var(--pm-font-mono)',
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}
          >
            Reviews, on tap. — verdiict.com
          </div>
        </div>
        <div
          style={{ display: 'flex', gap: 32, fontSize: 13, flexWrap: 'wrap' }}
        >
          <a href="#how" style={{ color: 'inherit', textDecoration: 'none' }}>
            How it works
          </a>
          <a
            href="#pricing"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            Pricing
          </a>
        </div>
      </div>
      <div
        style={{
          ...shellStyle,
          marginTop: 40,
          paddingTop: 24,
          borderTop: '1px solid rgba(244,241,234,0.1)',
          fontFamily: 'var(--pm-font-mono)',
          fontSize: 11,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'rgba(244,241,234,0.4)',
          display: 'flex',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <span>© {new Date().getFullYear()} Verdiict</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              background: 'var(--pm-lime)',
            }}
          />
          A{' '}
          <a
            href="https://prodesk.com.au"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--pm-paper)',
              textDecoration: 'none',
              fontWeight: 600,
              marginLeft: 6,
              marginRight: 6,
            }}
          >
            Prodesk
          </a>{' '}
          funded project
        </span>
        <span>
          Made for the businesses who deserve the reviews they aren't getting.
        </span>
      </div>
    </footer>
  );
}

// ─── Section heading helper ─────────────────────────────────────────────────
function SectionHead({
  eyebrow,
  title,
  sub,
  dark = false,
}: {
  eyebrow?: ReactNode;
  title?: ReactNode;
  sub?: ReactNode;
  dark?: boolean;
}) {
  const muted = dark ? 'rgba(244,241,234,0.55)' : 'var(--pm-muted)';
  const ink = dark ? 'var(--pm-paper)' : 'var(--pm-ink)';
  return (
    <div style={{ maxWidth: 900 }}>
      {eyebrow && (
        <div
          style={{
            fontFamily: 'var(--pm-font-mono)',
            fontSize: 12,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: muted,
            fontWeight: 500,
            marginBottom: 24,
          }}
        >
          {eyebrow}
        </div>
      )}
      {title && (
        <h2 className="pm-h-1" style={{ color: ink, margin: 0 }}>
          {title}
        </h2>
      )}
      {sub && (
        <p
          className="pm-lead"
          style={{
            color: dark ? 'rgba(244,241,234,0.7)' : '#3A3D37',
            marginTop: 24,
            maxWidth: 720,
          }}
        >
          {sub}
        </p>
      )}
    </div>
  );
}

// ─── Shared styles ──────────────────────────────────────────────────────────
const shellStyle: CSSProperties = {
  maxWidth: 1320,
  marginLeft: 'auto',
  marginRight: 'auto',
  paddingLeft: 'clamp(20px, 4vw, 32px)',
  paddingRight: 'clamp(20px, 4vw, 32px)',
  width: '100%',
};

const navLinkStyle: CSSProperties = {
  color: 'var(--pm-ink)',
  textDecoration: 'none',
  fontSize: 14,
  fontWeight: 500,
  opacity: 0.7,
  transition: 'opacity 160ms',
};

const baseBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: '12px 20px',
  borderRadius: 12,
  fontFamily: 'inherit',
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  textDecoration: 'none',
  border: 'none',
  cursor: 'pointer',
  transition: 'transform 120ms cubic-bezier(.2,.8,.2,1), background 200ms',
};

const primaryBtnStyle: CSSProperties = {
  ...baseBtn,
  background: 'var(--pm-ink)',
  color: 'var(--pm-lime)',
};

const limeBtnStyle: CSSProperties = {
  ...baseBtn,
  padding: '14px 22px',
  fontSize: 15,
  background: 'var(--pm-lime)',
  color: 'var(--pm-ink)',
};

const ghostDarkBtnStyle: CSSProperties = {
  ...baseBtn,
  padding: '14px 22px',
  fontSize: 15,
  background: 'transparent',
  color: 'var(--pm-paper)',
  border: '1.5px solid rgba(244,241,234,0.2)',
};

const ghostOnLimeBtnStyle: CSSProperties = {
  ...baseBtn,
  background: 'transparent',
  color: 'var(--pm-ink)',
  border: '1.5px solid rgba(11,15,10,0.35)',
};
