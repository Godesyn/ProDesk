import { ChevronDown, Unplug } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { useMounted, useReducedMotion, useTickingInt } from './motion';

/**
 * One mailbox, as a row.
 *
 * This was a vertical capacity column in a five-across grid, and the grid was
 * the wrong container for it. Five columns to a row meant every label was
 * truncated to a stub, the risk reason — the one thing that decides whether you
 * touch a mailbox — had nowhere to go at all, and a domain with three mailboxes
 * left two dead cells. A list gives each mailbox the full width of the block, so
 * the name, the meter, the count and *why* it reads the way it does all fit on
 * one line, and adding a mailbox lengthens the list instead of reflowing it.
 *
 * The two variables the column carried survive the rotation. Throughput is the
 * meter; reputation is the rail down the left edge, because throughput rests on
 * reputation — if the footing goes bad everything beside it is worthless.
 *
 * Colour is still spent on exactly two things: a mailbox close to its cap, and
 * one whose reputation is sliding. A healthy floor is a quiet stack of neutral
 * rows, which is what makes an unhealthy one obvious.
 */

export interface MailboxLike {
  id: number;
  email: string;
  cap: number;
  sentToday: number;
  remaining: number;
  stopped: boolean;
  suspended: boolean;
  connected: boolean;
  lastSentAt: string | null;
  warmup: {
    status: string | null;
    reputation: number | null;
    spamRate: number | null;
    blockedReason: string | null;
  };
}

export type Risk = 'ok' | 'watch' | 'risk' | 'unknown';

/** Smartlead's own guidance: warmup spam should stay under 2% of warmup sends. */
const SPAM_CEILING = 0.02;
const REPUTATION_OK = 85;
const REPUTATION_WATCH = 60;
/** A meter this close to its cap is worth colour — the mailbox is nearly spent. */
const NEAR_CAP = 0.9;

/** How a mailbox's footing reads, and the one-line reason for it. */
export function mailboxRisk(m: MailboxLike): { level: Risk; reason: string } {
  if (!m.connected) return { level: 'risk', reason: 'Smartlead cannot reach this mailbox' };
  if (m.warmup.blockedReason) return { level: 'risk', reason: m.warmup.blockedReason };
  if (m.warmup.spamRate !== null && m.warmup.spamRate > SPAM_CEILING) {
    return { level: 'risk', reason: `${(m.warmup.spamRate * 100).toFixed(1)}% of warmup marked spam` };
  }
  if (m.warmup.reputation === null) return { level: 'unknown', reason: 'No warmup data yet' };
  if (m.warmup.reputation < REPUTATION_WATCH) {
    return { level: 'risk', reason: `Reputation ${Math.round(m.warmup.reputation)}` };
  }
  if (m.warmup.reputation < REPUTATION_OK) {
    return { level: 'watch', reason: `Reputation ${Math.round(m.warmup.reputation)}` };
  }
  return { level: 'ok', reason: `Reputation ${Math.round(m.warmup.reputation)}` };
}

/** The reputation rail — the plinth the column used to stand on, stood on its end. */
const RAIL: Record<Risk, string> = {
  ok: 'bg-ink-20',
  watch: 'bg-warn',
  risk: 'bg-danger',
  unknown: 'bg-ink-10',
};

const RISK_TEXT: Record<Risk, string> = {
  ok: 'text-ink-40',
  watch: 'text-warn',
  risk: 'text-danger',
  unknown: 'text-ink-40',
};

/** The local part — the domain is already the block heading, so repeating it is noise. */
export function localPart(email: string): string {
  const at = email.indexOf('@');
  return at === -1 ? email : email.slice(0, at);
}

export function MailboxRow({
  mailbox,
  index,
  selected,
  onSelect,
}: {
  mailbox: MailboxLike;
  /** Position in the domain block — staggers the meters so the list fills top-down. */
  index: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const reduced = useReducedMotion();
  const mounted = useMounted();
  const sent = useTickingInt(mailbox.sentToday);

  const fraction = mailbox.cap > 0 ? Math.min(1, mailbox.sentToday / mailbox.cap) : 0;
  const nearCap = !mailbox.stopped && fraction >= NEAR_CAP;
  const risk = mailboxRisk(mailbox);

  const label = mailbox.stopped
    ? `${mailbox.email}, stopped${mailbox.suspended ? ' and suspended in Smartlead' : ''}`
    : `${mailbox.email}, ${mailbox.sentToday} of ${mailbox.cap} sent today. ${risk.reason}.`;

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-expanded={selected}
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2.5 text-left sm:gap-4 sm:px-4',
        'focus-visible:outline-none focus-visible:-outline-offset-2 focus-visible:outline-2',
        'focus-visible:outline-[color:var(--color-accent-ring)]',
        'transition-colors duration-[var(--duration-quick)]',
        selected ? 'bg-inset' : 'hover:bg-inset/60',
      )}
    >
      {/* The footing. */}
      <span
        aria-hidden
        className={cn('h-7 w-[3px] shrink-0 rounded-full', RAIL[risk.level])}
      />

      {/* Content-sized on a phone where the meter is hidden; a fixed column from
          `sm` up, so the meters start on the same edge down the whole list. */}
      <span className="mono flex min-w-0 flex-1 items-center gap-1.5 text-[12px] text-ink-60 group-hover:text-ink-100 sm:w-40 sm:flex-none">
        {!mailbox.connected && <Unplug className="h-3 w-3 shrink-0 text-danger" aria-hidden />}
        <span className="truncate">{localPart(mailbox.email)}</span>
      </span>

      {/* The well, on its side. A stopped mailbox is drawn hollow and dashed
          rather than greyed — dormant equipment, not disabled UI. */}
      <span
        className={cn(
          'hidden h-[6px] min-w-0 flex-1 overflow-hidden rounded-full sm:block',
          mailbox.stopped
            ? 'border border-dashed border-[color:var(--color-ink-20)]'
            : 'bg-inset group-hover:bg-ink-10',
        )}
      >
        {!mailbox.stopped && (
          <span
            className={cn(
              'block h-full rounded-full',
              nearCap ? 'bg-warn' : 'bg-ink-80',
              !reduced && 'transition-[width] duration-[480ms] ease-[var(--ease-click)]',
            )}
            style={{
              width: `${(reduced || mounted ? fraction : 0) * 100}%`,
              transitionDelay: reduced ? undefined : `${index * 45}ms`,
            }}
          />
        )}
      </span>

      <span className="tnum text-ui-xs ml-auto w-[3.5rem] shrink-0 text-right sm:ml-0">
        {mailbox.stopped ? (
          <span className="text-ink-40">Stopped</span>
        ) : (
          <>
            <span className="text-ink-100">{sent}</span>
            <span className="text-ink-40">/{mailbox.cap}</span>
          </>
        )}
      </span>

      {/* The reason, which the grid had no room for at all. */}
      <span
        className={cn(
          'text-ui-xs hidden w-[13rem] shrink-0 truncate text-right md:block',
          RISK_TEXT[risk.level],
        )}
      >
        {risk.reason}
      </span>

      <ChevronDown
        aria-hidden
        className={cn(
          'h-4 w-4 shrink-0 text-ink-20 transition-transform duration-[var(--duration-quick)]',
          'group-hover:text-ink-40',
          selected && 'rotate-180',
        )}
      />
    </button>
  );
}

/** Loading placeholder — same box model as the real row, so nothing shifts. */
export function MailboxRowSkeleton() {
  return (
    <div className="flex w-full items-center gap-3 px-3 py-2.5 sm:gap-4 sm:px-4">
      <span className="h-7 w-[3px] shrink-0 rounded-full bg-ink-10" />
      <span className="pd-shimmer h-[12px] w-28 shrink-0 rounded-full sm:w-40" />
      <span className="pd-shimmer hidden h-[6px] min-w-0 flex-1 rounded-full sm:block" />
      <span className="pd-shimmer ml-auto h-[12px] w-[3.5rem] shrink-0 rounded-full sm:ml-0" />
      <span className="pd-shimmer hidden h-[12px] w-[13rem] shrink-0 rounded-full md:block" />
      <span className="h-4 w-4 shrink-0" />
    </div>
  );
}
