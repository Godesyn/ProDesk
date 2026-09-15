/**
 * The floating feedback panel — mounted on EVERY frontend.
 *
 * Shape (matching the dashboard suite's strategist dock): a slim vertical tab
 * pinned to the right edge of the viewport, which opens a drawer. The drawer leads
 * with the compose field and a submit button — the point of the whole feature is
 * that giving feedback takes one thought and one click — with the person's own
 * history beneath it.
 *
 * Below the history, beta members get the **Beta access** expandable tile — an
 * inline summary of their countdown and, when expanded, the full price report.
 * This replaced the old floating `BetaPill` that sat on the viewport edge: keeping
 * beta info inside the feedback drawer reduces floating-UI clutter and ties the two
 * halves of the beta bargain (access ↔ feedback) together visually.
 *
 * Deliberate choices:
 *  • Beta members only (`onlyForBeta`, the default). Beta access is granted in
 *    exchange for feedback, so the panel is part of that bargain rather than a
 *    permanent fixture for every customer.
 *  • Nothing is fetched until the drawer is opened, so an app-wide mount costs no
 *    request on page load.
 *  • It never says "ticket". Internally each entry IS a support ticket, but the
 *    user is giving feedback and gets a reply — see use-feedback.ts.
 *  • Rendered in a portal at the document body so it can't be clipped by a
 *    frontend's own transformed/overflow-hidden layout.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  ChevronDown,
  MessageSquarePlus,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { cn, formatPrice } from '../lib/utils';
import { useTRPC } from '../lib/trpc';
import { toastError } from '../lib/errors';
import { BetaReport } from '../beta/beta-report';
import {
  betaCountdownLabel,
  formatBetaDate,
  useBetaStatus,
} from '../beta/use-beta-status';
import {
  feedbackPayload,
  feedbackState,
  feedbackTime,
  useMyFeedback,
  useSubmitFeedback,
  type FeedbackEntry,
} from './use-feedback';

const MAX_LENGTH = 10_000;

/* ── Dismissal ──────────────────────────────────────────────────────────────
 * The tab is pinned to the right edge of every screen in every frontend, which
 * means it sits on top of whatever a frontend puts there — a scrollbar, a
 * right-hand rail, a sheet's close control. Sending it away has to be possible
 * without also opting out of the beta bargain, so this is a DISMISSAL, not a
 * preference: it lives in module memory and nowhere else, so a refresh brings
 * the tab back and nobody loses the channel permanently by tidying their screen
 * once. (localStorage here would quietly end feedback for that browser.)
 *
 * Module-level rather than component state because the panel is mounted once
 * per app but React may remount it across a route swap, and a tab that
 * reappears mid-session is exactly what was being complained about.
 */
let dismissed = false;
const dismissListeners = new Set<() => void>();

function subscribeDismissed(fn: () => void): () => void {
  dismissListeners.add(fn);
  return () => dismissListeners.delete(fn);
}

function dismissForSession(): void {
  if (dismissed) return;
  dismissed = true;
  for (const fn of dismissListeners) fn();
}

export function FeedbackPanel({
  /**
   * Restrict the panel to beta members (the default). Pass `false` to offer it to
   * everyone — e.g. if the programme is later opened up.
   */
  onlyForBeta = true,
}: {
  onlyForBeta?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);
  const beta = useBetaStatus();
  const isDismissed = useSyncExternalStore(
    subscribeDismissed,
    () => dismissed,
    () => false,
  );

  // Beta members keep the panel after their beta lapses: someone whose access just
  // ended is precisely the person with something to say about it.
  const eligible = !onlyForBeta || beta.enrolled;
  if (!eligible) return null;
  // Dismissed for this page load — see `dismissForSession`. The drawer is still
  // rendered if it happens to be open, so dismissing never yanks a half-typed
  // note out from under someone; the tab is what goes.
  if (isDismissed && !open) return null;

  return (
    <>
      {!open && <FeedbackTab onClick={() => setOpen(true)} onDismiss={dismissForSession} />}
      {open && <FeedbackDrawer onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * The always-visible edge tab. Fixed to the right edge, vertically centred, with a
 * rounded-left profile so it reads as a pull-out — the same affordance as the
 * dashboard's strategist reopen tab.
 *
 * It carries its own dismiss control, because the tab is the only piece of this
 * feature that is on screen whether or not you want it, and on a narrow viewport
 * it lands on top of whatever the frontend put against the right edge. The X
 * hides it for this page load only (see `dismissForSession`).
 */
function FeedbackTab({ onClick, onDismiss }: { onClick: () => void; onDismiss: () => void }) {
  if (typeof document === 'undefined') return null;
  return createPortal(
    // A wrapper, not a nested button: the dismiss control has to be its own
    // click target, and a <button> inside a <button> is invalid HTML that
    // browsers resolve by dropping one of them.
    <div
      className={cn(
        // pd-beta-scope: this is portalled to <body>, so it must carry its own
        // tokens — see packages/shared/src/styles/beta-scope.css.
        'pd-beta-scope group fixed right-0 z-[70]',
        // Sits just below the app bar rather than vertically centred: centred, it
        // landed over whatever a frontend puts mid-canvas, and every frontend's
        // header is a different height. The offset is a token so a frontend with
        // taller chrome can move it without forking the component.
        'top-[var(--pd-beta-tab-top)]',
      )}
    >
      <button
        type="button"
        onClick={onClick}
        aria-label="Give feedback"
        title="Give feedback"
        className={cn(
          'flex h-auto w-10 flex-col items-center gap-2 py-4',
          'rounded-l-[var(--radius-md)] border border-r-0 border-[color:var(--color-border-hairline)]',
          // White on near-black, not the paper token: paper is a warm off-white that
          // reads as dimmed grey at this icon stroke width and 10px type size.
          'bg-ink-100 text-white shadow-2',
          'transition-[width,background-color] duration-[var(--duration-quick)]',
          'hover:w-11 hover:bg-ink-80',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
        )}
      >
        <MessageSquarePlus className="h-[18px] w-[18px] shrink-0" />
        {/* Vertical wordmark — upright glyphs read better than a rotated line at
            this width. Bold, not semibold: 10px letterforms under 0.18em tracking
            need the extra weight to hold up. Colour comes from the tab. */}
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] [writing-mode:vertical-rl]">
          Feedback
        </span>
      </button>

      {/* Hidden until the tab is hovered or holds focus, so the resting design is
          unchanged — but ALWAYS visible where there is no hover to reveal it
          with, which is every touch device and the case the complaint came
          from. */}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Hide feedback until you reload"
        title="Hide until you reload"
        className={cn(
          'absolute -left-2.5 -top-2.5 grid h-6 w-6 place-items-center rounded-full',
          'border border-[color:var(--color-border-hairline)] bg-ink-100 text-white shadow-2',
          'opacity-0 transition-opacity duration-[var(--duration-quick)]',
          'group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-ink-80',
          '[@media(hover:none)]:opacity-100',
          'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
        )}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  );
}

function FeedbackDrawer({ onClose }: { onClose: () => void }) {
  const [body, setBody] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submit = useSubmitFeedback();
  // Only fetched now that the drawer is open — see the module header.
  const history = useMyFeedback();
  const entries = (history.data?.items ?? []) as FeedbackEntry[];

  // Land the caret in the field: the panel exists to be typed into.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Escape closes, like every other overlay in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !submit.isPending;

  async function send() {
    if (!canSubmit) return;
    try {
      await submit.mutateAsync(feedbackPayload(trimmed));
      setBody('');
      toast.success('Thanks — your feedback is with the team.');
      textareaRef.current?.focus();
    } catch (err) {
      toastError(err);
    }
  }

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pd-beta-scope fixed inset-0 z-[70] flex justify-end">
      {/* Scrim — click-away closes. Kept subtle: the drawer is a side panel, not a
          modal that should black out the work behind it. */}
      <button
        type="button"
        aria-label="Close feedback"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-ink-100/20"
      />

      <aside
        role="dialog"
        aria-label="Feedback"
        className={cn(
          'relative flex h-full w-[min(420px,100vw)] flex-col',
          'border-l border-[color:var(--color-border-hairline)] bg-paper shadow-3',
          'animate-[reveal_var(--duration-standard)_var(--ease-click)]',
        )}
      >
        <header className="flex items-start gap-3 border-b border-[color:var(--color-border-hairline)] px-5 py-4">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent/12 text-accent">
            <MessageSquarePlus className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-tight text-ink-100">
              Tell us what's missing
            </h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-60">
              Anything that would make this better — a gap, a rough edge, an
              idea. It goes straight to the team.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ink-40 transition-colors hover:bg-inset hover:text-ink-100"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Compose — first thing in the panel, always visible without scrolling. */}
        <div className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
          <textarea
            ref={textareaRef}
            value={body}
            maxLength={MAX_LENGTH}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              // ⌘/Ctrl+Enter submits; plain Enter stays a newline so a long thought
              // isn't sent half-written.
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                void send();
              }
            }}
            rows={5}
            placeholder="What would you change or add?"
            className={cn(
              'w-full resize-none rounded-[var(--radius-sm)] px-3 py-2.5',
              'border border-[color:var(--color-border-default)] bg-card',
              'text-sm leading-relaxed text-ink-100 placeholder:text-ink-40',
              'focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent-ring)]',
            )}
          />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <span className="text-[11px] text-ink-40">
              {trimmed.length > 0
                ? `${trimmed.length.toLocaleString()} / ${MAX_LENGTH.toLocaleString()}`
                : 'Press ⌘↵ to send'}
            </span>
            <button
              type="button"
              onClick={() => void send()}
              disabled={!canSubmit}
              className={cn(
                'press inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] px-4',
                // Ink label, not white: white on the Forest accent is ~3.2:1, which
                // fails AA for 14px text. Ink-on-accent is ~6.4:1 and is already the
                // repo's pattern for solid accent buttons (growth-upsell-card,
                // floating-message-panel).
                'bg-accent text-sm font-semibold text-ink-100 transition-colors hover:bg-accent-hover',
                'disabled:pointer-events-none disabled:opacity-40',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
              )}
            >
              <Send className="h-3.5 w-3.5" />
              {submit.isPending ? 'Sending…' : 'Send feedback'}
            </button>
          </div>
        </div>

        {/* History */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-40">
            Your feedback
          </h3>
          {history.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-[var(--radius-sm)] bg-inset"
                />
              ))}
            </div>
          ) : entries.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border-default)] px-4 py-6 text-center text-xs leading-relaxed text-ink-40">
              Nothing yet. Everything you send will be listed here, along with
              any reply from the team.
            </p>
          ) : (
            <ul className="space-y-3">
              {entries.map((entry) => (
                <FeedbackHistoryItem key={entry.id} entry={entry} />
              ))}
            </ul>
          )}
        </div>

        {/* Beta access tile — pinned footer, outside scroll */}
        <BetaAccessTile />
      </aside>
    </div>,
    document.body,
  );
}

/**
 * Expandable beta-access tile pinned to the bottom of the feedback drawer,
 * outside the scrollable area. Shows the countdown label and per-month price
 * summary; expanding it reveals the full `BetaReport` inline.
 *
 * Self-suppresses for non-beta users — safe to mount unconditionally.
 */
function BetaAccessTile() {
  const beta = useBetaStatus();
  const trpc = useTRPC();
  const [expanded, setExpanded] = useState(false);

  // Fetch the report only when expanded to avoid unnecessary requests.
  // When collapsed we still need the total, so we fetch eagerly for beta members.
  const report = useQuery({
    ...trpc.beta.myReport.queryOptions(),
    enabled: beta.enrolled,
    staleTime: 5 * 60_000,
  });

  if (!beta.ready || !beta.enrolled) return null;

  const lines = (report.data?.lines ?? []) as {
    monthlyAmount: number;
    alreadySubscribed: boolean;
  }[];
  const billable = lines.filter((l) => !l.alreadySubscribed);
  const monthlyTotal = billable.reduce((s, l) => s + l.monthlyAmount, 0);
  const currency = report.data?.currency ?? 'AUD';

  // Build the subtitle line for the collapsed state — show price summary.
  let subtitle: string;
  if (beta.expired) {
    subtitle = beta.endsAt
      ? `Free access ran until ${formatBetaDate(beta.endsAt)}`
      : 'Your beta has ended';
  } else if (report.isLoading) {
    subtitle = beta.endsAt
      ? `Free until ${formatBetaDate(beta.endsAt)}`
      : 'Loading…';
  } else if (billable.length > 0) {
    subtitle = `${formatPrice(monthlyTotal, currency)}/mo after beta`;
  } else {
    subtitle = beta.endsAt
      ? `Free until ${formatBetaDate(beta.endsAt)}`
      : 'No billable tools yet';
  }

  return (
    <div className="shrink-0 border-t border-[color:var(--color-border-hairline)]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className={cn(
          'flex w-full items-center gap-3 px-5 py-3.5',
          'text-left transition-colors hover:bg-inset/60',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent-ring)]',
        )}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent/12 text-accent">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight text-ink-100">
            {beta.expired
              ? 'Beta ended'
              : betaCountdownLabel(beta.daysRemaining)}
          </p>
          {/* ink-60, not ink-50: theme.css has no --color-ink-50, so `text-ink-50`
              generated no rule at all and this line inherited its colour. */}
          <p className="mt-0.5 text-[11px] leading-snug text-ink-60">
            {subtitle}
          </p>
        </div>
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-ink-40 transition-transform duration-200',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="max-h-[50vh] overflow-y-auto border-t border-[color:var(--color-border-hairline)] px-5 py-4 animate-[reveal_var(--duration-quick)_var(--ease-click)]">
          <BetaReport endsAt={beta.endsAt} expired={beta.expired} />
        </div>
      )}
    </div>
  );
}

function FeedbackHistoryItem({ entry }: { entry: FeedbackEntry }) {
  const state = feedbackState(entry);
  return (
    <li className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)] bg-card p-3.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-40">
          {feedbackTime(entry.createdAt)}
        </span>
        <span
          className={cn(
            'rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
            state.tone === 'accent'
              ? 'bg-accent/12 text-accent'
              : 'bg-inset text-ink-60',
          )}
        >
          {state.label}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-80">
        {entry.body}
      </p>
      {entry.replies.map((reply, i) => (
        <div
          key={i}
          className="mt-3 rounded-[var(--radius-sm)] border-l-2 border-accent bg-inset px-3 py-2.5"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-40">
            Prodesk replied · {feedbackTime(reply.createdAt)}
          </p>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-80">
            {reply.body}
          </p>
        </div>
      ))}
    </li>
  );
}
