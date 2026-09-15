import { useEffect, useRef } from 'react';
import { cn } from '../../../lib/utils';
import { useReducedMotion } from './motion';

/**
 * Pieces shared by the Prospects list and the Reply Queue — the two
 * high-repetition surfaces, which have to behave identically or the muscle
 * memory built on one actively works against the other.
 */

export type Classification = 'yes' | 'question' | 'not_now' | 'never' | 'other';

/** Day and month, or an em dash. The date format every Outreach list uses. */
export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Named the way the operator thinks, not the way the column is spelled. */
export const CLASSIFICATION_LABEL: Record<Classification, string> = {
  yes: 'Yes',
  question: 'Question',
  not_now: 'Not now',
  never: 'Never',
  other: 'Other',
};

/**
 * The classification, as a mark rather than a badge.
 *
 * Only two of the five earn ink: `yes`, because it is the one that pays, and
 * `never`, because acting on it wrongly is the expensive mistake. Colouring all
 * five would make the list a fruit salad and the two that matter invisible.
 */
export function ClassificationMark({ value }: { value: Classification | null | undefined }) {
  if (!value) return <span className="text-ui-xs text-ink-20">—</span>;
  return (
    <span
      className={cn(
        'text-ui-xs shrink-0 whitespace-nowrap',
        value === 'yes'
          ? 'text-ink-100'
          : value === 'never'
            ? 'text-danger'
            : 'text-ink-40',
      )}
    >
      {value === 'yes' && (
        <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle" />
      )}
      {CLASSIFICATION_LABEL[value]}
    </span>
  );
}

/**
 * The shared keyboard contract for list surfaces.
 *
 * Bindings are ignored while the user is typing in a field — otherwise `j` in a
 * search box moves the selection instead of typing a letter, which feels broken
 * in a way that is hard to diagnose. `Escape` is the exception: it fires
 * everywhere, including out of an input, because backing out is the one thing
 * that must always work.
 */
export function useListKeys(handlers: {
  onNext?: () => void;
  onPrev?: () => void;
  /**
   * Page flips, on `[` and `]`.
   *
   * Only the paginated surfaces pass these. They sit next to each other under
   * one finger and carry no meaning of their own, which is what a control you
   * press fifteen times in a row while reading should feel like.
   */
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onSearch?: () => void;
  onEscape?: () => void;
  onApprove?: () => void;
  onEdit?: () => void;
  onSuppress?: () => void;
  onHelp?: () => void;
  /** Set while a modal owns the keyboard. */
  disabled?: boolean;
}) {
  useEffect(() => {
    if (handlers.disabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);

      if (e.key === 'Escape') {
        if (typing) target?.blur();
        handlers.onEscape?.();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j':
          e.preventDefault();
          handlers.onNext?.();
          break;
        case 'k':
          e.preventDefault();
          handlers.onPrev?.();
          break;
        case '[':
          if (handlers.onPrevPage) {
            e.preventDefault();
            handlers.onPrevPage();
          }
          break;
        case ']':
          if (handlers.onNextPage) {
            e.preventDefault();
            handlers.onNextPage();
          }
          break;
        case '/':
          e.preventDefault();
          handlers.onSearch?.();
          break;
        case 'a':
          if (handlers.onApprove) {
            e.preventDefault();
            handlers.onApprove();
          }
          break;
        case 'e':
          if (handlers.onEdit) {
            e.preventDefault();
            handlers.onEdit();
          }
          break;
        case 'x':
          if (handlers.onSuppress) {
            e.preventDefault();
            handlers.onSuppress();
          }
          break;
        case '?':
          if (handlers.onHelp) {
            e.preventDefault();
            handlers.onHelp();
          }
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handlers]);
}

/**
 * Keeps the keyboard-selected row on screen.
 *
 * Both list surfaces move the selection with `j`/`k`, and both used to let it
 * walk straight out of the viewport — press `j` eight times and the thing you
 * are acting on is somewhere above the fold, which makes the shortcut that was
 * meant to be the fast path feel like it has lost your place.
 *
 * Attach the returned ref to whichever row is currently selected and pass the
 * value that identifies it. `block: 'nearest'` means a row already in view is
 * left exactly where it is — the list only moves when it has to.
 */
export function useKeepInView<T extends HTMLElement>(selection: string | number | null) {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (selection === null) return;
    ref.current?.scrollIntoView({
      block: 'nearest',
      behavior: reduced ? 'auto' : 'smooth',
    });
  }, [selection, reduced]);

  return ref;
}

/** The `?` overlay. Rendered by the surfaces that bind more than j/k. */
export function ShortcutHelp({
  open,
  onClose,
  shortcuts,
}: {
  open: boolean;
  onClose: () => void;
  shortcuts: { keys: string; label: string }[];
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-100/30 p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-5 shadow-[var(--shadow-3)]"
      >
        <h2 className="text-panel-title text-ink-100">Shortcuts</h2>
        <dl className="mt-4 flex flex-col gap-2">
          {shortcuts.map((s) => (
            <div key={s.keys} className="flex items-baseline justify-between gap-4">
              <dt className="mono text-[12px] text-ink-100">{s.keys}</dt>
              <dd className="text-ui-xs text-ink-60">{s.label}</dd>
            </div>
          ))}
        </dl>
        <p className="text-ui-xs mt-4 text-ink-40">Press Esc to close.</p>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * The conversation
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * What was sent and what came back, in order.
 *
 * Smartlead owns the thread — we hold no copy of a sent email — so this always
 * renders a live read that can fail, and a failure must never take the record
 * it is attached to off the screen. Hence three states rather than two: an
 * error, an empty history, and messages.
 *
 * Outbound sits on the page, inbound sits in an inset box, which is the only
 * signal here: at a glance you can see whether anyone wrote back without
 * reading a word. The HTML is stripped rather than rendered — this is a
 * transcript, not a preview of the letter, and the letter is already previewable
 * on the Sending Email tab.
 */
export function ConversationThread({
  messages,
  error,
  empty = 'Nothing sent yet, or Smartlead has no history for this lead.',
}: {
  messages: unknown[];
  error?: string | null;
  empty?: string;
}) {
  if (error) {
    return (
      <p className="text-ui-xs mt-2 text-danger">Smartlead could not return the thread: {error}</p>
    );
  }
  if (messages.length === 0) return <p className="text-ui-xs mt-2 text-ink-40">{empty}</p>;

  return (
    <ol className="mt-3 flex flex-col gap-4">
      {(messages as Record<string, unknown>[]).map((m, i) => {
        const inbound = String(m.type ?? '')
          .toUpperCase()
          .includes('REPLY');
        const body = String(m.email_body ?? '')
          .replace(/<[^>]+>/g, ' ')
          .trim();
        return (
          <li
            key={i}
            className={cn(
              'rounded-[var(--radius-sm)] border px-4 py-3',
              inbound
                ? 'border-[color:var(--color-border-default)] bg-inset'
                : 'border-[color:var(--color-border-hairline)] bg-paper',
            )}
          >
            <div className="text-ui-xs flex items-baseline justify-between gap-3 text-ink-40">
              <span>{inbound ? 'They wrote' : 'We sent'}</span>
              <span className="tnum">{fmtDate(String(m.time ?? m.sent_time ?? ''))}</span>
            </div>
            {!!m.subject && <div className="text-ui-sm mt-1 text-ink-100">{String(m.subject)}</div>}
            <p className="text-body mt-2 whitespace-pre-wrap text-ink-80">{body || '—'}</p>
          </li>
        );
      })}
    </ol>
  );
}
