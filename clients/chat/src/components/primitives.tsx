import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';

/**
 * The Chat kit — the seven pieces every screen is built from.
 *
 * Chat has no local shadcn `ui/` folder, exactly like Logo Studio and KEYMASTR.
 * Its design system is this file plus the scoped classes in index.css; the shared
 * `@shared/components/ui/*` primitives are reached for only where a genuinely
 * modal or portalled behaviour is needed (dialog, dropdown, confirm).
 */

/* ---------------------------------------------------------------- wordmark */

/**
 * The app's mark.
 *
 * A ring with two wedges meeting at its centre: one solid, one outlined. Two
 * turns of a conversation — what was said and what came back — closed into a
 * single circle. It replaced the old `SpineMark` (a drawing of the transcript's
 * spine) when the transcript moved to bubbles and the spine stopped existing.
 *
 * `currentColor` throughout, never a literal: the mark is drawn on the Night
 * ground in the rail, on ink in Day, and on the auth screens' own surface, and a
 * baked-in hex would be invisible in at least one of them. The standalone
 * favicon at `public/chat.svg` carries the same geometry with a
 * prefers-color-scheme swap, since a tab icon has no parent to inherit from.
 */
export function ChatMark({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg viewBox="7 7 86 86" fill="none" className={className} style={style} aria-hidden="true">
      <circle cx="50" cy="50" r="32" stroke="currentColor" strokeWidth="6" />
      <path d="M50 22 L60 50 L50 50 Z" fill="currentColor" />
      <path
        d="M50 78 L40 50 L50 50 Z"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------- type */

/** Mono uppercase label — every number and every structural marker. */
export function Spec({
  children,
  className = '',
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`spec ${className}`} style={style}>
      {children}
    </span>
  );
}

/** The one editorial line an empty state is allowed. */
export function Quill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`quill ${className}`}>{children}</p>;
}

/* ---------------------------------------------------------------- identity */

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A person. `online` adds the pigment ring — the pigment doctrine's most common
 * appearance in the app, and the reason presence reads at a glance.
 */
export function Avatar({
  name,
  url,
  size = 36,
  online,
  className = '',
}: {
  name: string;
  url?: string | null;
  size?: number;
  online?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: 'var(--room-3)',
        color: 'var(--voice-2)',
        fontSize: Math.max(10, Math.round(size * 0.36)),
        fontWeight: 600,
        letterSpacing: '-0.01em',
        boxShadow: online ? '0 0 0 1.5px var(--live)' : undefined,
      }}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/**
 * A group. Rendered as a tile of its most recent speakers rather than a generic
 * group glyph, because who is IN a group is what identifies it — "Design" and
 * "Design (old)" are told apart by their faces, never by their names.
 */
export function GroupAvatar({
  members,
  photoUrl,
  size = 36,
  className = '',
}: {
  members: { name: string; avatarUrl?: string | null }[];
  photoUrl?: string | null;
  size?: number;
  className?: string;
}) {
  if (photoUrl) {
    return <Avatar name="" url={photoUrl} size={size} className={className} />;
  }
  const tiles = members.slice(0, 4);
  if (tiles.length <= 1) {
    return (
      <Avatar
        name={tiles[0]?.name ?? '?'}
        url={tiles[0]?.avatarUrl}
        size={size}
        className={className}
      />
    );
  }
  const cols = tiles.length === 2 ? 2 : 2;
  return (
    <span
      className={`grid shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: 1,
        background: 'var(--wire)',
      }}
      aria-hidden="true"
    >
      {tiles.map((m, i) => (
        <span
          key={i}
          className="flex items-center justify-center overflow-hidden"
          style={{
            background: 'var(--room-3)',
            color: 'var(--voice-3)',
            fontSize: Math.max(8, Math.round(size * 0.22)),
            fontWeight: 600,
            gridColumn: tiles.length === 3 && i === 0 ? 'span 2' : undefined,
          }}
        >
          {m.avatarUrl ? (
            <img src={m.avatarUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            initials(m.name)
          )}
        </span>
      ))}
    </span>
  );
}

/* ---------------------------------------------------------------- controls */

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode };

/**
 * A ghost control. The everyday, colourless action — attach, close, menu.
 * 36px visual, 44px hit area on touch (index.css keeps the padding off the
 * resting design).
 */
export function IconButton({ children, className = '', ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${className}`}
      style={{ color: 'var(--voice-2)', ...rest.style }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--room-3)';
        e.currentTarget.style.color = 'var(--voice)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent';
        e.currentTarget.style.color = 'var(--voice-2)';
      }}
    >
      {children}
    </button>
  );
}

/**
 * The one pigment control on a surface. Inert and ink while there is nothing to
 * commit; pigment the moment there is. `armed` is the whole point — do not pass
 * a constant true.
 */
export function LiveButton({
  children,
  armed = true,
  className = '',
  ...rest
}: BtnProps & { armed?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-all disabled:opacity-40 ${className}`}
      style={{
        background: armed ? 'var(--live)' : 'var(--room-3)',
        color: armed ? '#fff' : 'var(--voice-3)',
        ...rest.style,
      }}
    >
      {children}
    </button>
  );
}

/** A quiet outline action — Cancel, Decline, secondary paths. */
export function GhostButton({ children, className = '', ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      className={`press inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors ${className}`}
      style={{
        border: '1px solid var(--wire-2)',
        color: 'var(--voice)',
        background: 'transparent',
        ...rest.style,
      }}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ states */

/**
 * An empty screen is an invitation to act, so it is exactly three things: the
 * mark, one serif line, and one control. No illustration, no explanation.
 */
export function EmptyState({
  line,
  action,
  className = '',
}: {
  line: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-5 px-8 py-16 text-center ${className}`}
    >
      <ChatMark className="h-9 w-9" style={{ color: 'var(--voice-3)' }} />
      <Quill className="max-w-sm">{line}</Quill>
      {action}
    </div>
  );
}

/** A one-line hairline separator carrying a mono marker. */
export function Marker({ label, tone = 'ink' }: { label: string; tone?: 'ink' | 'live' }) {
  return (
    <div className="flex items-center gap-3 px-4 pb-2 pt-5">
      <Spec style={tone === 'live' ? { color: 'var(--live)' } : undefined}>{label}</Spec>
      {tone === 'live' && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: 'var(--live)' }}
        />
      )}
      <span className="h-px flex-1" style={{ background: 'var(--wire)' }} />
    </div>
  );
}
