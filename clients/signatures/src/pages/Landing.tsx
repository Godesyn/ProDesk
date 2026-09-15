/**
 * Landing Page — SIGKITT
 *
 * Public, unauthenticated marketing page. Ported (design/copy) from the Manus
 * "email-signature-builder" export, rewired to prodesk auth: CTAs route to the
 * shared /signup + /login pages, and auth is gated in App.tsx (this only mounts
 * for signed-out visitors), mirroring clients/links.
 */

import { useLocation } from 'wouter';

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({
  onSignUp,
  onLogin,
}: {
  onSignUp: () => void;
  onLogin: () => void;
}) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-[#F4F1E8]/90 backdrop-blur-sm border-b border-[#E8E5DC]">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        <a href="/" className="flex items-center">
          <span className="font-black text-xl tracking-tight text-[#0E0E0C]">
            SIG<span className="text-[#8fb400]">KITT</span>
          </span>
        </a>
        <div className="hidden md:flex items-center gap-6 text-sm text-[#555]">
          <a
            href="#features"
            className="hover:text-[#0E0E0C] transition-colors"
          >
            Features
          </a>
          <a href="#pricing" className="hover:text-[#0E0E0C] transition-colors">
            Pricing
          </a>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onLogin}
            className="text-sm font-medium text-[#0E0E0C] px-4 py-1.5 rounded-full hover:bg-[#E8E5DC] transition-colors"
          >
            Log in
          </button>
          <button
            onClick={onSignUp}
            className="text-sm font-semibold bg-[#0E0E0C] text-white px-4 py-1.5 rounded-full hover:bg-[#1a1a18] transition-colors flex items-center gap-1"
          >
            Sign up <span className="text-primary">→</span>
          </button>
        </div>
      </div>
    </nav>
  );
}

// ─── Hero ─────────────────────────────────────────────────────────────────────
function Hero({
  onSignUp,
  onLogin,
}: {
  onSignUp: () => void;
  onLogin: () => void;
}) {
  return (
    <section className="pt-32 pb-20 px-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
        {/* Left: headline + CTAs */}
        <div>
          <div className="inline-flex items-center gap-2 bg-[#0E0E0C] text-white text-xs font-semibold px-3 py-1.5 rounded-full mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            NEW · Brand Manager · One signature, every teammate
          </div>
          <h1 className="text-5xl md:text-6xl font-black text-[#0E0E0C] leading-[1.05] tracking-tight mb-6">
            Every email,{' '}
            <em
              className="not-italic"
              style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
            >
              signed
            </em>{' '}
            like you mean it.
          </h1>
          <p className="text-lg text-[#555] leading-relaxed mb-8 max-w-lg">
            Build an on-brand signature in under a minute. Roll it out to your
            team in two. Keep it consistent forever — no copy-paste, no rogue
            fonts, no broken images.
          </p>
          <ul className="space-y-3 mb-10">
            {[
              'Six templates, infinite tweaks. Looks right in Gmail, Outlook, Apple Mail, Superhuman.',
              'One brand kit — fonts, colors, logo — pulled into every signature, every time.',
              'Deploy across your team with one link. Updates ship instantly.',
            ].map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-3 text-sm text-[#444]"
              >
                <span className="w-5 h-5 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path
                      d="M1 4L3.5 6.5L9 1"
                      stroke="#0E0E0C"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={onSignUp}
              className="bg-[#0E0E0C] text-white font-semibold px-6 py-3 rounded-full hover:bg-[#1a1a18] transition-colors flex items-center gap-2"
            >
              Get started
              <span className="text-primary">→</span>
            </button>
            <button
              onClick={onLogin}
              className="border border-[#0E0E0C] text-[#0E0E0C] font-semibold px-6 py-3 rounded-full hover:bg-[#0E0E0C] hover:text-white transition-colors"
            >
              Log in
            </button>
          </div>
          <p className="text-xs text-[#999] mt-3">
            $1/signature per month · Cancel anytime
          </p>

          {/* Social proof */}
          <div className="flex items-center gap-3 mt-8 pt-8 border-t border-[#E8E5DC]">
            <div className="flex -space-x-2">
              {['AJ', 'SR', 'MK', 'TC'].map((initials, i) => (
                <div
                  key={i}
                  className="w-8 h-8 rounded-full border-2 border-[#F4F1E8] flex items-center justify-center text-xs font-bold text-white"
                  style={{
                    backgroundColor: [
                      '#0E0E0C',
                      'var(--color-primary)',
                      '#555',
                      '#888',
                    ][i],
                    color: i === 1 ? '#0E0E0C' : '#fff',
                  }}
                >
                  {initials}
                </div>
              ))}
              <div className="w-8 h-8 rounded-full border-2 border-[#F4F1E8] bg-[#E8E5DC] flex items-center justify-center text-xs font-bold text-[#555]">
                +
              </div>
            </div>
            <p className="text-sm text-[#555]">
              <strong className="text-[#0E0E0C]">4,200+ teams</strong> use
              SIGKITT
            </p>
          </div>
        </div>

        {/* Right: Sign-up card */}
        <SignUpCard onSignUp={onSignUp} onLogin={onLogin} />
      </div>
    </section>
  );
}

// ─── Sign-up Card ─────────────────────────────────────────────────────────────
function SignUpCard({
  onSignUp,
  onLogin,
}: {
  onSignUp: () => void;
  onLogin: () => void;
}) {
  return (
    <div className="bg-white rounded-3xl border border-[#E8E5DC] shadow-xl overflow-hidden">
      {/* Tabs */}
      <div className="grid grid-cols-2 border-b border-[#E8E5DC]">
        <button className="py-3.5 text-sm font-semibold text-[#0E0E0C] border-b-2 border-[#0E0E0C]">
          Sign up
        </button>
        <button
          className="py-3.5 text-sm font-medium text-[#999] hover:text-[#0E0E0C] transition-colors"
          onClick={onLogin}
        >
          Log in
        </button>
      </div>

      <div className="p-6 space-y-5">
        {/* Badge */}
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="text-xs font-semibold text-[#0E0E0C] uppercase tracking-wider">
            Simple pricing
          </span>
        </div>

        <div>
          <h3 className="text-xl font-bold text-[#0E0E0C] mb-1">
            Sign every email like you{' '}
            <em
              className="not-italic text-[#0E0E0C]"
              style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}
            >
              mean it
            </em>
            .
          </h3>
          <p className="text-sm text-[#666] leading-relaxed">
            Create your account, add your brand, and build signatures for your
            team in minutes. Simple $1 per seat monthly pricing.
          </p>
        </div>

        <button
          onClick={onSignUp}
          className="w-full bg-[#0E0E0C] text-white font-semibold py-3 rounded-xl hover:bg-[#1a1a18] transition-colors flex items-center justify-center gap-2"
        >
          Create my account <span className="text-primary">→</span>
        </button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[#E8E5DC]" />
          </div>
          <div className="relative flex justify-center">
            <span className="bg-white px-3 text-xs text-[#999] uppercase tracking-wider">
              Already have an account?
            </span>
          </div>
        </div>

        <button
          onClick={onLogin}
          className="w-full border border-[#E8E5DC] text-[#0E0E0C] font-semibold py-3 rounded-xl hover:border-[#0E0E0C] transition-colors flex items-center justify-center gap-2"
        >
          Log in <span>→</span>
        </button>

        <p className="text-xs text-center text-[#999]">
          By continuing you agree to our{' '}
          <a
            href="https://www.prodesk.com/legal/terms.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[#0E0E0C]"
          >
            Terms
          </a>{' '}
          and{' '}
          <a
            href="https://www.prodesk.com/legal/privacy.html"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-[#0E0E0C]"
          >
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}

// ─── Features ─────────────────────────────────────────────────────────────────
function Features() {
  const features = [
    {
      tag: 'Feature 01',
      title: (
        <>
          Brand kit,{' '}
          <em style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            built in
          </em>
          .
        </>
      ),
      body: 'Drop your logo, lock your colors, pick your typeface. Every signature your team makes pulls from the same source of truth.',
      items: [
        'Logo · sigkitt-mark.svg',
        'Type · Inter Tight',
        'Color · #D9F542',
      ],
      dark: false,
    },
    {
      tag: 'Feature 02',
      title: (
        <>
          Render perfect{' '}
          <em style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            everywhere
          </em>
          .
        </>
      ),
      body: "We tested across 11 clients so you don't have to. No table-soup, no weird spacing, no fallback fonts pretending to be your brand.",
      items: [
        'Gmail · ok',
        'Outlook · ok',
        'Apple Mail · ok',
        'Superhuman · ok',
      ],
      dark: true,
    },
    {
      tag: 'Feature 03',
      title: (
        <>
          Roll out in{' '}
          <em style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
            one
          </em>{' '}
          click.
        </>
      ),
      body: "Send a deploy link to your team. They click. Their signature installs. You move on with your day. It's almost boring.",
      items: [
        'Team link · sigkitt.co/t/acme',
        'Active · 47 / 52',
        'Last sync · 2 min ago',
      ],
      dark: false,
    },
  ];

  return (
    <section id="features" className="py-20 px-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary bg-[#0E0E0C] inline-block px-2 py-0.5 rounded mb-4">
            What you get
          </p>
          <h2 className="text-4xl font-black text-[#0E0E0C] leading-tight">
            Less fiddling. More{' '}
            <em style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
              shipping
            </em>
            .
          </h2>
          <p className="text-[#666] mt-3 max-w-lg">
            Three things you'll notice in the first ten minutes. There's more —
            but these are the headline acts.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f, i) => (
            <div
              key={i}
              className={`rounded-2xl p-7 space-y-4 ${f.dark ? 'bg-[#0E0E0C] text-white' : 'bg-[#F4F1E8]'}`}
            >
              <p
                className={`text-xs font-semibold uppercase tracking-widest ${f.dark ? 'text-primary' : 'text-[#999]'}`}
              >
                {f.tag}
              </p>
              <h3
                className={`text-xl font-bold leading-snug ${f.dark ? 'text-white' : 'text-[#0E0E0C]'}`}
              >
                {f.title}
              </h3>
              <p
                className={`text-sm leading-relaxed ${f.dark ? 'text-white/70' : 'text-[#555]'}`}
              >
                {f.body}
              </p>
              <div
                className={`rounded-xl p-4 space-y-2 ${f.dark ? 'bg-white/10' : 'bg-white'}`}
              >
                {f.items.map((item, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${f.dark ? 'bg-primary' : 'bg-[#0E0E0C]'}`}
                    >
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path
                          d="M1 3L3 5L7 1"
                          stroke={f.dark ? '#0E0E0C' : 'var(--color-primary)'}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className={f.dark ? 'text-white/80' : 'text-[#444]'}>
                      {item}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Pricing ──────────────────────────────────────────────────────────────────
function Pricing({ onSignUp }: { onSignUp: () => void }) {
  const plans = [
    {
      name: 'Standard',
      price: '$1',
      period: '/ seat / mo',
      desc: 'On-brand email signatures for freelancers, professionals and teams.',
      features: [
        'Unlimited signatures',
        'Brand Manager',
        'One-click deploy',
        'Click analytics',
        'Priority support',
      ],
      cta: 'Get started',
      ctaAction: onSignUp,
      popular: true,
    },
    {
      name: 'Studio',
      price: 'Custom',
      period: '',
      desc: 'For agencies running signatures across 10+ client brands.',
      features: [
        'Everything in Standard',
        'Multi-brand workspace',
        'SSO + SCIM',
        'Audit log',
        'Dedicated success manager',
      ],
      cta: 'Talk to us',
      ctaAction: () => window.open('mailto:hello@noize.com.au', '_blank'),
      popular: false,
    },
  ];

  return (
    <section id="pricing" className="py-20 px-6 bg-[#F4F1E8]">
      <div className="max-w-4xl mx-auto">
        <div className="mb-12">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#999] mb-4">
            Pricing — pick one
          </p>
          <h2 className="text-4xl font-black text-[#0E0E0C] leading-tight">
            Honest pricing. No{' '}
            <em style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic' }}>
              surprises
            </em>
            .
          </h2>
          <p className="text-[#666] mt-3">
            Pay per seat, cancel any time. Simple $1 per seat monthly pricing
            with no commitments.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {plans.map((plan, i) => (
            <div
              key={i}
              className={`rounded-2xl border p-7 space-y-5 relative ${
                plan.popular
                  ? 'bg-white border-[#0E0E0C] shadow-xl'
                  : 'bg-white border-[#E8E5DC]'
              }`}
            >
              {plan.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="bg-primary text-[#0E0E0C] text-xs font-bold px-3 py-1 rounded-full border border-[#0E0E0C]">
                    Most popular
                  </span>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-[#999] mb-2">
                  {plan.name}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-black text-[#0E0E0C]">
                    {plan.price}
                  </span>
                  {plan.period && (
                    <span className="text-sm text-[#999]">{plan.period}</span>
                  )}
                </div>
                <p className="text-sm text-[#666] mt-2 leading-relaxed">
                  {plan.desc}
                </p>
              </div>

              <div className="border-t border-[#E8E5DC] pt-4 space-y-2.5">
                {plan.features.map((feat, j) => (
                  <div
                    key={j}
                    className="flex items-center gap-2.5 text-sm text-[#444]"
                  >
                    <span className="w-4 h-4 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                      <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                        <path
                          d="M1 3L3 5L7 1"
                          stroke="#0E0E0C"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    {feat}
                  </div>
                ))}
              </div>

              <button
                onClick={plan.ctaAction}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
                  plan.popular
                    ? 'bg-[#0E0E0C] text-white hover:bg-[#1a1a18]'
                    : 'border border-[#E8E5DC] text-[#0E0E0C] hover:border-[#0E0E0C]'
                }`}
              >
                {plan.cta} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  const cols = [
    {
      heading: 'Product',
      links: [
        { label: 'Features', href: '#features' },
        { label: 'Pricing', href: '#pricing' },
      ],
    },
    {
      heading: 'Company',
      links: [{ label: 'Contact', href: 'mailto:hello@noize.com.au' }],
    },
    {
      heading: 'Legal',
      links: [
        { label: 'Terms', href: 'https://www.prodesk.com/legal/terms.html' },
        {
          label: 'Privacy',
          href: 'https://www.prodesk.com/legal/privacy.html',
        },
      ],
    },
  ];

  return (
    <footer className="bg-[#0E0E0C] text-white">
      <div className="max-w-6xl mx-auto px-6 py-16">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
                <span className="text-[#0E0E0C] font-black text-sm leading-none">
                  S
                </span>
              </div>
              <span className="font-bold text-white text-sm">SIGKITT</span>
            </div>
            <p className="text-sm text-white/50 leading-relaxed">
              Email signatures, built like the rest of your brand: deliberate,
              consistent, quietly excellent.
            </p>
          </div>
          {cols.map((col, i) => (
            <div key={i}>
              <h4 className="text-xs font-semibold uppercase tracking-widest text-white/40 mb-4">
                {col.heading}
              </h4>
              <ul className="space-y-2.5">
                {col.links.map((link, j) => (
                  <li key={j}>
                    <a
                      href={link.href}
                      {...(link.href.startsWith('http')
                        ? { target: '_blank', rel: 'noopener noreferrer' }
                        : {})}
                      className="text-sm text-white/60 hover:text-white transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 mt-12 pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-white/30">
          <span>
            © {new Date().getFullYear()} SIGKITT. All rights reserved.
          </span>
          <span>A Prodesk-funded project</span>
        </div>
      </div>
    </footer>
  );
}

// ─── Main Landing Page ────────────────────────────────────────────────────────
export default function LandingPage() {
  const [, navigate] = useLocation();

  // Auth is gated in App.tsx — this page only mounts for signed-out visitors, so
  // the CTAs just route to the shared /signup + /login pages (mirroring links).
  const handleSignUp = () => {
    navigate('/signup');
  };

  const handleLogin = () => {
    navigate('/login');
  };

  return (
    <div className="sigkitt">
      <div className="bg-[#F4F1E8] min-h-screen">
        <Nav onSignUp={handleSignUp} onLogin={handleLogin} />
        <Hero onSignUp={handleSignUp} onLogin={handleLogin} />
        <Features />
        <Pricing onSignUp={handleSignUp} />
        <Footer />
      </div>
    </div>
  );
}
