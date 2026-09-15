import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Eye, Copy, Check } from 'lucide-react';

/**
 * KEYMASTR's design primitives.
 *
 * The whole app is built from these five: the Aperture (reveal), the Mask
 * (hidden value), the Drain (remaining life), the Specimen (a framed record),
 * and the KeyMark (a brand's key silhouette). See DESIGN.md §2–3.
 */

/* ------------------------------------------------------------------ helpers */

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

/** Mono bullets sized to the real value, so unmasking shifts nothing. */
export const maskOf = (value: string) => '•'.repeat(Math.min(value.length, 28));

/* ---------------------------------------------------------------- Aperture */

const HOLD_MS = 350;
const REVEAL_MS = 20_000;

/**
 * THE APERTURE — press and hold to reveal.
 *
 * Hold for 350ms and the ring fills clockwise with pigment; on completion the
 * secret unmasks and the ring immediately drains counterclockwise over its
 * lifetime, then re-masks itself. Release early and it snaps back to dark —
 * nothing is revealed and nothing is logged.
 *
 * The hold isn't friction theatre: it makes an accidental reveal (a stray click
 * mid screen-share, a shoulder-surfer) structurally impossible, and it gives the
 * act the weight it deserves. Every competitor makes this a one-click eye icon.
 *
 * Reduced motion drops the ANIMATION, never the TIMER — the secret still
 * re-masks on schedule. Security behaviour is not a motion preference.
 */
export function Aperture({
  open,
  onOpenChange,
  lifetimeMs = REVEAL_MS,
  tone,
  ground,
  label = 'Hold to reveal',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lifetimeMs?: number;
  tone?: 'alarm';
  ground?: 'ink';
  label?: string;
}) {
  const [fill, setFill] = useState(0);
  const raf = useRef<number | null>(null);
  const holding = useRef(false);

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
  }, []);

  // The drain: runs whenever the aperture is open, and closes it at zero.
  useEffect(() => {
    if (!open) return;
    const started = performance.now();
    const tick = (now: number) => {
      const left = 1 - (now - started) / lifetimeMs;
      if (left <= 0) {
        setFill(0);
        onOpenChange(false);
        return;
      }
      setFill(left);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return stop;
  }, [open, lifetimeMs, onOpenChange, stop]);

  const beginHold = () => {
    if (open) {
      // Pressing an open aperture closes it at once.
      stop();
      setFill(0);
      onOpenChange(false);
      return;
    }
    holding.current = true;
    const started = performance.now();
    const tick = (now: number) => {
      if (!holding.current) return;
      const p = Math.min(1, (now - started) / HOLD_MS);
      setFill(p);
      if (p >= 1) {
        holding.current = false;
        onOpenChange(true);
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const endHold = () => {
    if (!holding.current) return;
    holding.current = false;
    stop();
    setFill(0); // released early — snap back to dark
  };

  useEffect(() => stop, [stop]);

  return (
    <button
      type="button"
      className="aperture press"
      data-open={open}
      data-tone={tone}
      data-ground={ground}
      style={{ '--km-fill': fill } as CSSProperties}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!open) onOpenChange(true);
          else onOpenChange(false);
        }
      }}
      aria-pressed={open}
      aria-label={open ? 'Hide' : label}
      title={open ? 'Hide' : label}
    >
      <Eye className="h-3.5 w-3.5" />
    </button>
  );
}

/* ------------------------------------------------------------------- Drain */

/** A bare ring with no control — remaining life on shares, grants, clipboards. */
export function Drain({
  remaining,
  tone,
  title,
}: {
  remaining: number;
  tone?: 'alarm';
  title?: string;
}) {
  return (
    <span
      className="drain"
      data-tone={tone}
      style={{ '--km-fill': remaining } as CSSProperties}
      title={title}
      aria-hidden="true"
    />
  );
}

/* ------------------------------------------------------------ Secret field */

/**
 * A masked value with its Aperture and a Copy that never reveals.
 *
 * Copy is the PRIMARY action — one click, the clipboard self-clears, and the act
 * is written to the register. Reveal is the deliberate, slower path. Every
 * competitor has this the other way round, which is worse UX *and* worse
 * security: the value ends up on screen when all you wanted was it in a form.
 */
export function Secret({
  value,
  onCopy,
  lifetimeMs,
}: {
  value: string;
  onCopy?: () => void;
  lifetimeMs?: number;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    setCopied(true);
    onCopy?.();
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <span className="inline-flex items-center gap-2">
      {open ? (
        <span className="revealed" data-unmask>
          {value}
        </span>
      ) : (
        <span className="masked">{maskOf(value)}</span>
      )}
      <button
        type="button"
        onClick={copy}
        className="press grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] text-[var(--ink-3)] transition hover:bg-[var(--stage-2)] hover:text-[var(--ink)]"
        aria-label="Copy — clears in 45 seconds"
        title="Copy — clears in 45s"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5" style={{ color: 'var(--pigment)' }} />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <Aperture open={open} onOpenChange={setOpen} lifetimeMs={lifetimeMs} />
    </span>
  );
}

/* ---------------------------------------------------------------- Specimen */

/** A framed record — corner ticks, hairline rule. Logo Studio frames a MARK
 *  with this; KEYMASTR frames a RECORD, because that's the artefact here. */
export function Specimen({
  children,
  className,
  corners,
}: {
  children: ReactNode;
  className?: string;
  /** Mono labels pinned to the frame's corners. */
  corners?: [string, string, string, string];
}) {
  return (
    <div className={cx('specimen rounded-[var(--radius-md)]', className)}>
      {corners && (
        <>
          <span className="spec absolute left-6 top-4">{corners[0]}</span>
          <span className="spec absolute right-6 top-4">{corners[1]}</span>
          <span className="spec absolute left-6 bottom-4">{corners[2]}</span>
          <span className="spec absolute right-6 bottom-4">{corners[3]}</span>
        </>
      )}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- KeyMark */

/**
 * A brand's key silhouette, derived deterministically from its seed — so a
 * brand's key looks the same every time and becomes recognisable at a glance,
 * the way Logo Studio's marks do. Draws itself in on mount.
 */
export function KeyMark({
  seed,
  className,
  tone = 'ink',
  animate = true,
}: {
  seed: number;
  className?: string;
  tone?: 'ink' | 'paper' | 'pigment';
  animate?: boolean;
}) {
  // Three bits per key, from the seed — the tooth pattern.
  const teeth = [seed % 3, (seed >> 1) % 3, (seed >> 2) % 3].map((t) => 3 + t * 2);
  const color =
    tone === 'paper'
      ? 'var(--rail-ink)'
      : tone === 'pigment'
        ? 'var(--pigment)'
        : 'currentColor';

  return (
    <svg
      viewBox="0 0 48 24"
      className={className}
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      {/* the bow */}
      <circle cx="10" cy="12" r="6.5" pathLength={1} {...(animate ? { 'data-draw': '' } : {})} />
      {/* the shaft */}
      <path d="M16.5 12 H40" pathLength={1} {...(animate ? { 'data-draw': '' } : {})} />
      {/* the bit — deterministic teeth */}
      {teeth.map((h, i) => (
        <path
          key={i}
          d={`M${28 + i * 5} 12 V${12 + h}`}
          pathLength={1}
          {...(animate ? { 'data-draw': '' } : {})}
        />
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------------- Chips */

export function Chip({
  children,
  on,
  tone,
  onClick,
}: {
  children: ReactNode;
  on?: boolean;
  tone?: 'pigment' | 'alarm';
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      className={cx('chip', onClick && 'press cursor-pointer')}
      data-on={on}
      data-tone={tone}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      {children}
    </Tag>
  );
}

/* -------------------------------------------------------------------- Pips */

/**
 * Health as four segments, not a number. A clean key is a single unbroken
 * hairline; trouble shows as texture. Nothing to argue with, nothing to game.
 */
export function Pips({ health }: { health: 'strong' | 'weak' | 'stale' | 'breached' }) {
  const level = { strong: 4, stale: 3, weak: 2, breached: 1 }[health];
  const alarm = health === 'breached';
  return (
    <span className="pips" title={health}>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className="pip"
          data-on={n <= level}
          data-tone={alarm ? 'alarm' : undefined}
        />
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ Section */

/** A screen section: mono eyebrow, optional trailing control, hairline rule. */
export function Section({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow?: string;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rise">
      {(eyebrow || title || action) && (
        <div className="mb-4 flex items-end justify-between gap-4 border-b border-[var(--hair)] pb-3">
          <div className="min-w-0">
            {eyebrow && <div className="spec">{eyebrow}</div>}
            {title && (
              <h2 className="mt-1 text-[19px] font-semibold tracking-tight">{title}</h2>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ Buttons */

export function Primary({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'press inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-white',
        className,
      )}
      style={{ background: 'var(--pigment)' }}
    >
      {children}
    </button>
  );
}

export function Ghost({
  children,
  onClick,
  tone,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: 'alarm';
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'press inline-flex h-9 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-medium transition',
        className,
      )}
      style={{
        borderColor: tone === 'alarm' ? 'var(--alarm)' : 'var(--hair-2)',
        color: tone === 'alarm' ? 'var(--alarm)' : 'var(--ink-2)',
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------- Page header */

/** Every screen opens the same way: eyebrow, display headline, lede, actions. */
export function PageHead({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="rise mb-8 flex flex-wrap items-end justify-between gap-6">
      <div className="min-w-0 max-w-2xl">
        <div className="spec">{eyebrow}</div>
        <h1 className="mt-2 text-[30px] font-extrabold leading-[1.05] tracking-[-0.03em] sm:text-[38px]">
          {title}
        </h1>
        {lede && (
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-2)]">{lede}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
