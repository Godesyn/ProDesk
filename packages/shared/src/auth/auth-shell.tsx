import { forwardRef, useState, type ReactNode } from 'react';
import {
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Workflow,
  Wallet,
  Link2,
  Download,
  BarChart2,
  Star,
  Code2,
  Globe,
  FileText,
  CreditCard,
  Bell,
  LayoutDashboard,
  Users,
  Activity,
  AtSign,
  Inbox,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Input } from '../components/ui/input';
import { PRODESK_CLIENT, type ProdeskClient } from '../lib/client-id';

/**
 * Shared auth chrome — a split layout: a brand-coloured panel (editorial
 * serif statement, matches the house style) beside the form column. The form
 * column rises + fades in (reveal) and stays centered. On mobile the brand panel
 * collapses to a compact wordmark above the form. Used by login / signup /
 * forgot / reset / verify-email so every entry screen shares one identity.
 *
 * The brand panel's content and colour are driven per-frontend via
 * CLIENT_AUTH_BRANDING, keyed on PRODESK_CLIENT.
 */
export function AuthShell({
  eyebrow,
  title,
  titleAccent,
  subtitle,
  children,
  footer,
}: {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const branding =
    CLIENT_AUTH_BRANDING[PRODESK_CLIENT] ?? CLIENT_AUTH_BRANDING.prodesk;
  // Pin the accent tokens for the whole auth screen to this frontend's brand so
  // the CTA (and accented text/links/icons) matches the brand panel on the left.
  // Without this the accent falls back to the default forest-green — the runtime
  // agency accent hasn't resolved pre-login. Setting it inline here wins for the
  // subtree.
  //
  // Payments (EziQuotes) and Signatures (SIGKITT) map their shadcn tokens with
  // Tailwind's `@theme inline`, which *inlines* the value — so `bg-accent` /
  // `text-accent` compile to `var(--accent)` (their shadcn light-grey) rather
  // than `var(--color-accent)`, and the override above never reaches them. Pin
  // the raw `--accent`/`--accent-foreground` too so every accented surface on
  // the auth screens (CTA, eyebrow, icon badges, links) resolves to the brand
  // accent. Inert for the other clients (their utilities read --color-accent).
  const shellStyle: React.CSSProperties = {
    ['--color-accent' as string]: branding.accent,
    ['--color-accent-hover' as string]: branding.accentHover,
    ['--accent' as string]: branding.accent,
    ['--accent-foreground' as string]: '#ffffff',
  };

  return (
    <div className="flex min-h-screen bg-paper" style={shellStyle}>
      <BrandPanel />
      <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px] animate-reveal">
          {/* Compact wordmark for mobile (the brand panel carries it on desktop). */}
          <div className="mb-8 font-mono text-sm font-semibold uppercase tracking-[0.32em] text-ink-100 lg:hidden">
            {branding.wordmark}
          </div>
          <div className="mb-7">
            <div className="text-eyebrow mb-3 text-accent">{eyebrow}</div>
            <h1 className="text-section-title text-ink-100">
              {title}
              {titleAccent ? (
                <>
                  {' '}
                  <span className="text-serif-italic text-accent">
                    {titleAccent}
                  </span>
                </>
              ) : null}
            </h1>
            {subtitle && (
              <p className="mt-2.5 text-sm leading-relaxed text-ink-60">
                {subtitle}
              </p>
            )}
          </div>
          {children}
          {footer && (
            <div className="mt-8 border-t border-[color:var(--color-border-hairline)] pt-6 text-center text-sm text-ink-60">
              {footer}
            </div>
          )}
          {/* Legal links — present on every auth screen. By continuing, users
              accept these. The canonical Terms & Privacy live on the marketing
              site (prodesk.com/legal); open them in a new tab so the user keeps
              their place in the auth flow. */}
          <p className="mt-6 text-center text-xs leading-relaxed text-ink-40">
            By continuing you agree to our{' '}
            <a
              href="https://www.prodesk.com/legal/terms.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-60 hover:text-accent"
            >
              Terms &amp; Conditions
            </a>{' '}
            and{' '}
            <a
              href="https://www.prodesk.com/legal/privacy.html"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink-60 hover:text-accent"
            >
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Per-frontend auth branding config                                         */
/* -------------------------------------------------------------------------- */

interface AuthBranding {
  /** Name displayed as the wordmark in the panel + mobile header. */
  wordmark: string;
  /** Main portion of the editorial headline (before the italic accent). */
  headline: string;
  /** Italic accent word(s) appended to the headline. */
  headlineAccent: string;
  /** Paragraph beneath the headline. */
  description: string;
  /** Three bullet-point value props (Icon + label). */
  valueProps: { Icon: React.ElementType; label: string }[];
  /**
   * Static HSL hue for the brand panel background. We don't use the runtime
   * `--accent-h` because the auth screen renders before the agency accent
   * resolves, so every frontend would flash forest-green. A fixed hue per
   * frontend avoids that and gives each product its own identity.
   *
   * For `payments` (EziQuotes) the panel is near-black with a volt accent,
   * handled as a special case in BrandPanel.
   */
  panelHue: number;
  /**
   * CSS colour for the form-column accent (primary CTA, accented text, links).
   * Kept in sync with the panel so the button matches it instead of flashing
   * the default forest-green runtime accent (which hasn't resolved pre-login,
   * and which eziquotes.css even remaps to grey). `accentHover` is the darker
   * hover state. White is the CTA foreground, so pick values legible with it.
   */
  accent: string;
  accentHover: string;
  /**
   * Optional literal panel colours, for a frontend whose ground is a designed
   * colour rather than a tint of its accent hue (chat is dark-first: its panel
   * IS the Night room from clients/chat/index.css, not a hue wash). When absent
   * the panel is derived from `panelHue` as usual.
   */
  panel?: { bg: string; glow: string; glow2: string };
}

export const CLIENT_AUTH_BRANDING: Record<ProdeskClient, AuthBranding> = {
  prodesk: {
    wordmark: 'Prodesk',
    headline: 'Where brands and agencies',
    headlineAccent: 'build together',
    description:
      'The operating system for creative work — proposals, projects, and payments in one place.',
    valueProps: [
      { Icon: Workflow, label: 'Proposals → projects in one flow' },
      { Icon: ShieldCheck, label: 'Verified agencies & secure approvals' },
      { Icon: Wallet, label: 'Payments and payouts, built in' },
    ],
    panelHue: 142.5, // forest green
    accent: 'hsl(142.5 55% 40%)',
    accentHover: 'hsl(142.5 55% 34%)',
  },
  dashboard: {
    wordmark: 'Prodesk',
    headline: "Your brand's",
    headlineAccent: 'command centre',
    description: 'Every tool, every metric — one dashboard to run it all.',
    valueProps: [
      { Icon: Activity, label: 'Real-time analytics & insights' },
      { Icon: LayoutDashboard, label: 'All your tools in one place' },
      { Icon: Users, label: 'Team collaboration, built in' },
    ],
    panelHue: 142.5, // same as Prodesk — it is a Prodesk sub-app
    accent: 'hsl(142.5 55% 40%)',
    accentHover: 'hsl(142.5 55% 34%)',
  },
  links: {
    wordmark: 'Adeyy',
    headline: 'Link',
    headlineAccent: 'anywhere',
    description:
      'One short link. One QR code. Change where they point at any time, even after you print.',
    valueProps: [
      { Icon: Link2, label: 'Custom short links & QR codes' },
      { Icon: Download, label: 'Print-ready SVG & PDF exports' },
      { Icon: BarChart2, label: 'Detailed scan & click analytics' },
    ],
    panelHue: 168, // teal (#04d5b0)
    accent: 'hsl(168 82% 30%)', // deep teal — legible with white CTA text
    accentHover: 'hsl(168 82% 24%)',
  },
  reviews: {
    wordmark: 'Verdiict',
    headline: 'Reviews that',
    headlineAccent: 'build trust',
    description:
      'Capture real customer reviews and showcase them everywhere — widgets, directories, and more.',
    valueProps: [
      { Icon: Star, label: 'Automated review collection' },
      { Icon: Code2, label: 'Embeddable review widgets' },
      { Icon: Globe, label: 'Public review directory' },
    ],
    panelHue: 222, // blue (#2f6df0)
    accent: 'hsl(222 80% 55%)',
    accentHover: 'hsl(222 80% 48%)',
  },
  payments: {
    wordmark: 'EziQuotes',
    headline: 'Quotes that',
    headlineAccent: 'close deals',
    description:
      'Professional proposals, Stripe-powered payments, and automated chase sequences — all in one flow.',
    valueProps: [
      { Icon: FileText, label: 'Professional proposal builder' },
      { Icon: CreditCard, label: 'Stripe Connect payments' },
      { Icon: Bell, label: 'Automated follow-up sequences' },
    ],
    panelHue: 72, // volt (#D9F542)
    // Panel is near-black with volt accents; volt itself is too light for a
    // white-text CTA, so the button mirrors the panel's near-black instead.
    accent: '#0e0e0c',
    accentHover: '#2a2a24',
  },
  signatures: {
    wordmark: 'SIGKITT',
    headline: 'Email signatures that',
    headlineAccent: 'stay on brand',
    description:
      'Design polished, on-brand email signatures for your whole team — with campaign banners and click analytics built in.',
    valueProps: [
      { Icon: FileText, label: 'On-brand signature builder' },
      { Icon: Users, label: 'Manage your whole team' },
      { Icon: BarChart2, label: 'Banner campaigns & click analytics' },
    ],
    panelHue: 72, // lime (#D9F542) — near-black panel, handled with payments below
    // Lime is too light for a white-text CTA, so (like payments) the button
    // mirrors the near-black panel instead.
    accent: '#0e0e0c',
    accentHover: '#2a2a24',
  },
  jobs: {
    wordmark: 'Jobs',
    headline: 'Work, organised',
    headlineAccent: 'end to end',
    description:
      'The Jobs workspace for agencies, brands and contractors — one place to run the work.',
    valueProps: [
      { Icon: LayoutDashboard, label: 'A workspace for every role' },
      { Icon: Users, label: 'Agencies, brands & contractors' },
      { Icon: Activity, label: 'More coming soon' },
    ],
    panelHue: 25, // amber
    accent: 'hsl(25 80% 44%)',
    accentHover: 'hsl(25 80% 37%)',
  },
  websites: {
    wordmark: 'Websites',
    headline: 'Websites for',
    headlineAccent: 'your brand',
    description:
      'Build and manage your brand’s web presence — all inside Prodesk.',
    valueProps: [
      { Icon: Globe, label: 'Your brand’s web presence' },
      { Icon: Code2, label: 'Built on Prodesk' },
      { Icon: Activity, label: 'More coming soon' },
    ],
    panelHue: 200, // sky
    accent: 'hsl(200 80% 38%)',
    accentHover: 'hsl(200 80% 31%)',
  },
  design: {
    wordmark: 'Design',
    headline: 'Design across',
    headlineAccent: 'all your brands',
    description:
      'A user-level design workspace that follows you across every brand you work on.',
    valueProps: [
      { Icon: FileText, label: 'Design across your brands' },
      { Icon: Star, label: 'A workspace that’s yours' },
      { Icon: Activity, label: 'More coming soon' },
    ],
    panelHue: 280, // violet
    accent: 'hsl(280 55% 48%)',
    accentHover: 'hsl(280 55% 41%)',
  },
  logo: {
    wordmark: 'Logo',
    headline: 'Logos that',
    headlineAccent: 'mean business',
    description:
      'Create and manage your brand’s logo assets — all inside Prodesk.',
    valueProps: [
      { Icon: FileText, label: 'Logo design for your brand' },
      { Icon: Download, label: 'Export-ready assets' },
      { Icon: Activity, label: 'More coming soon' },
    ],
    panelHue: 330, // magenta
    accent: 'hsl(330 68% 46%)',
    accentHover: 'hsl(330 68% 39%)',
  },
  chat: {
    wordmark: 'Chat',
    // The product thesis, said in one line (clients/chat/DESIGN.md §2): the
    // inbox is ordered by what you OWE, not by what arrived.
    headline: 'The inbox that knows',
    headlineAccent: 'who’s waiting',
    description:
      'A person-to-person messenger for everyone on Prodesk. Find anyone by email, start talking, and see at a glance whose turn it is.',
    valueProps: [
      { Icon: AtSign, label: 'Find anyone on Prodesk by email' },
      { Icon: Inbox, label: 'Sorted by what you owe, not what arrived' },
      { Icon: Users, label: 'Groups, files & live presence' },
    ],
    // Chat is the one dark-FIRST app in the suite, so its panel is the actual
    // Night room (--room, #101317) rather than a tint of an accent hue — the
    // sign-in screen should look like the room you're signing in to. Pigment
    // here means PRESENCE, so the glows are the online-bead green.
    panelHue: 152,
    accent: 'hsl(152 58% 34%)', // legible under the white CTA text
    accentHover: 'hsl(152 58% 28%)',
    panel: {
      bg: '#101317',
      glow: 'hsl(152 64% 45% / 0.28)',
      glow2: 'hsl(152 70% 50% / 0.14)',
    },
  },
};

function BrandPanel() {
  const branding =
    CLIENT_AUTH_BRANDING[PRODESK_CLIENT] ?? CLIENT_AUTH_BRANDING.prodesk;
  // Payments (EziQuotes) and Signatures (SIGKITT) both get a near-black panel
  // with volt/lime accents to match their marketing aesthetic.
  const isDarkVolt =
    PRODESK_CLIENT === 'payments' || PRODESK_CLIENT === 'signatures';

  // All other frontends use the standard accent-hue dark tint. We use inline
  // styles because the hue is data-driven and Tailwind can't resolve dynamic
  // template-literal class names at build time.
  // An explicit `panel` on the branding wins over both (chat ships its own
  // ground), so a designed dark room doesn't need another special case here.
  const panelStyle: React.CSSProperties = branding.panel
    ? { backgroundColor: branding.panel.bg }
    : isDarkVolt
      ? { backgroundColor: '#0e0e0c' }
      : { backgroundColor: `hsl(${branding.panelHue} 45% 11%)` };

  const glowStyle: React.CSSProperties = branding.panel
    ? { backgroundColor: branding.panel.glow }
    : isDarkVolt
      ? { backgroundColor: 'rgba(217, 245, 66, 0.3)' }
      : { backgroundColor: `hsl(${branding.panelHue} 55% 40% / 0.3)` };

  const glow2Style: React.CSSProperties = branding.panel
    ? { backgroundColor: branding.panel.glow2 }
    : isDarkVolt
      ? { backgroundColor: 'rgba(217, 245, 66, 0.15)' }
      : { backgroundColor: `hsl(${branding.panelHue} 60% 35% / 0.25)` };

  return (
    <aside
      className="relative hidden w-[42%] max-w-[560px] shrink-0 flex-col justify-between overflow-hidden p-12 text-paper lg:flex"
      style={panelStyle}
    >
      {/* Soft accent glows — on-brand depth without blurry haloes elsewhere. */}
      <div
        className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full blur-3xl"
        style={glowStyle}
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full blur-3xl"
        style={glow2Style}
      />

      <div className="relative font-mono text-sm font-semibold uppercase tracking-[0.32em] text-paper/85">
        {branding.wordmark}
      </div>

      <div className="relative">
        <h2 className="text-h2 leading-[1.1] text-paper">
          {branding.headline}{' '}
          <span className="text-serif-italic">{branding.headlineAccent}</span>.
        </h2>
        <p className="mt-5 max-w-sm text-body text-paper/70">
          {branding.description}
        </p>
        <ul className="mt-9 flex flex-col gap-4">
          {branding.valueProps.map(({ Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-3 text-sm text-paper/85"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-paper/10 ring-1 ring-paper/15">
                <Icon className="h-4 w-4" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="relative text-xs text-paper/45">
        © {new Date().getFullYear()} {branding.wordmark}
      </div>
    </aside>
  );
}

/** Labelled field for the auth forms (Label above, optional inline error). */
export function AuthField({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-ui-sm text-ink-80">
        {label}
      </label>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

/** Input with a leading icon (house pattern: relative wrapper + pl-9). */
export const IconInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { icon: React.ElementType }
>(({ icon: Icon, className, ...props }, ref) => (
  <div className="relative">
    <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
    <Input ref={ref} className={cn('pl-9', className)} {...props} />
  </div>
));
IconInput.displayName = 'IconInput';

/** Password field with a leading lock + a show/hide toggle. */
export function PasswordInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
      <Input
        type={show ? 'text' : 'password'}
        className={cn('px-9', className)}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-40 transition-colors hover:text-ink-60"
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** "or" divider used between the primary CTA and Google sign-in. */
export function OrDivider() {
  return (
    <div className="my-1 flex items-center gap-3">
      <span className="h-px flex-1 bg-[color:var(--color-border-default)]" />
      <span className="text-eyebrow text-ink-40">or</span>
      <span className="h-px flex-1 bg-[color:var(--color-border-default)]" />
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
        fill="#EA4335"
      />
    </svg>
  );
}
