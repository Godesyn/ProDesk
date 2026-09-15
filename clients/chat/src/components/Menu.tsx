import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The app's one dropdown.
 *
 * Chat has no local shadcn `ui/` folder, and a menu is the one control the two
 * places that need it (a thread row, a room header) were each about to grow their
 * own copy of. There is now one, and it is deliberately NOT portalled — matching
 * the shared popover convention, so it can never fall into the pointer-events
 * trap a portalled menu inside a modal host does.
 *
 * SUBMENUS OPEN IN PLACE, replacing the panel rather than flying out sideways.
 * A 340px list pane has nowhere to fly a second panel to, and a hover-out
 * fly-out is unusable on touch. Going "into" Mute and back out is one clear
 * gesture at any width.
 */

export type MenuEntry =
  | {
      kind?: 'item';
      label: string;
      onClick: () => void;
      danger?: boolean;
      /** Right-aligned muted text — a current value, a duration, a shortcut. */
      hint?: string;
      /** Ticked, for options that describe a state rather than an action. */
      selected?: boolean;
    }
  | { kind: 'sub'; label: string; hint?: string; items: MenuEntry[] }
  | { kind: 'sep' };

export function Menu({
  label,
  children,
  entries,
  align = 'right',
  className = '',
  triggerClassName = 'h-7 w-7',
  style,
  onOpenChange,
}: {
  /** Accessible name of the trigger. */
  label: string;
  /** The trigger's contents — normally one icon. */
  children: ReactNode;
  entries: MenuEntry[];
  align?: 'left' | 'right';
  className?: string;
  /** Sizing for the trigger button — a row's ⋯ is smaller than a header's. */
  triggerClassName?: string;
  style?: CSSProperties;
  /** Lets a hover-revealed parent stay visible while the menu is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [subIndex, setSubIndex] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    setSubIndex(null);
  };

  useEffect(() => {
    onOpenChange?.(open);
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Escape backs out of a submenu first, then closes — the same two-step the
      // panel's own Back row offers, for people who never take their hands off
      // the keyboard.
      if (subIndex !== null) setSubIndex(null);
      else close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subIndex]);

  const sub = subIndex !== null ? entries[subIndex] : null;
  const shown = sub && sub.kind === 'sub' ? sub.items : entries;

  return (
    <div className={`relative ${className}`} ref={ref} style={style}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setSubIndex(null);
          setOpen((v) => !v);
        }}
        className={`press grid place-items-center rounded-full transition-colors ${triggerClassName}`}
        style={{ color: 'var(--voice-2)' }}
      >
        {children}
      </button>

      {/*
        AN INVISIBLE FULL-SCREEN BACKDROP, and it is not optional.
        The panel hangs below its row and overlaps the NEXT conversation in the
        list. Relying on z-index alone to keep clicks off that row is a bet on
        every ancestor's stacking context staying as it is today — and when the
        bet loses, a click meant for "Archive" opens somebody else's chat, which
        is about the worst possible way for it to fail. A backdrop cannot be
        clicked through. It also gives touch users an outside-tap target, which
        the document-level mousedown listener never did.
      */}
      {open && <div className="fixed inset-0 z-40" onMouseDown={close} aria-hidden="true" />}

      {open && (
        <div
          className="cx-pop absolute z-50 w-56 overflow-hidden rounded-[var(--radius-md)] py-1"
          style={{
            border: '1px solid var(--wire-2)',
            top: '100%',
            marginTop: 6,
            ...(align === 'right' ? { right: 0 } : { left: 0 }),
          }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          {sub && sub.kind === 'sub' && (
            <>
              <button
                type="button"
                onClick={() => setSubIndex(null)}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] transition-colors hover:bg-[var(--room-3)]"
                style={{ color: 'var(--voice-2)' }}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                {sub.label}
              </button>
              <span className="my-1 block h-px" style={{ background: 'var(--wire)' }} />
            </>
          )}

          {shown.map((entry, i) => {
            if (entry.kind === 'sep') {
              // eslint-disable-next-line react/no-array-index-key
              return <span key={`sep-${i}`} className="my-1 block h-px" style={{ background: 'var(--wire)' }} />;
            }
            if (entry.kind === 'sub') {
              return (
                <button
                  key={entry.label}
                  type="button"
                  role="menuitem"
                  onClick={() => setSubIndex(i)}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--room-3)]"
                  style={{ color: 'var(--voice)' }}
                >
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint && (
                    <span className="shrink-0 text-[11px]" style={{ color: 'var(--voice-3)' }}>
                      {entry.hint}
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--voice-3)' }} />
                </button>
              );
            }
            return (
              <button
                key={entry.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  entry.onClick();
                }}
                className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px] transition-colors hover:bg-[var(--room-3)]"
                style={{ color: entry.danger ? 'var(--danger)' : 'var(--voice)' }}
              >
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.selected && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--live)' }} />}
                {entry.hint && (
                  <span className="shrink-0 text-[11px]" style={{ color: 'var(--voice-3)' }}>
                    {entry.hint}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The Mute submenu, built once for every surface that offers it.
 *
 * `current` is the live `muted_until`; when it is set the entry list collapses to
 * a single Unmute, because offering "For 8 hours" to someone who is already muted
 * asks them to do arithmetic to find out what it would mean.
 */
export function muteEntry(
  current: { isMuted: boolean; mutedUntil: Date | string | null },
  options: readonly { key: string; label: string; until: () => Date }[],
  onMute: (until: Date | null) => void,
  liveLabel: string,
): MenuEntry {
  if (current.isMuted) {
    return { label: 'Unmute', hint: liveLabel, onClick: () => onMute(null) };
  }
  return {
    kind: 'sub',
    label: 'Mute',
    items: options.map((o) => ({ label: o.label, onClick: () => onMute(o.until()) })),
  };
}
