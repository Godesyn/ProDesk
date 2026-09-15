import type { CSSProperties, ReactNode } from 'react';
import { PageHeader } from '../../../components/layout/page-header';
import { OutreachTabs } from './tabs';

/**
 * The frame every Outreach surface sits in.
 *
 * All five screens are long — the floor runs to four domain blocks plus limits
 * plus monitoring, the list builder to a coverage map plus a ledger — so the
 * navigation between them has to survive scrolling. It is sticky, and this shell
 * is the one place that knows how tall it is: `--rail` is published on the
 * wrapper so the two-pane screens can park a column directly underneath it
 * without hard-coding the same number in five files.
 */

/** Nav height (44px) plus the gap under it. Consumed via `--rail`. */
const RAIL_OFFSET = '3.75rem';

/**
 * A column that stops under the sticky rail and scrolls on its own.
 *
 * Only from `lg` up: below that the panes are stacked, and a pane with its own
 * scrollbar inside a scrolling page is a trap on a touch screen.
 */
export const railColumn =
  'lg:sticky lg:top-[var(--rail)] lg:max-h-[calc(100vh_-_var(--rail)_-_1.5rem)] lg:overflow-y-auto';

export function OutreachShell({
  title,
  description,
  action,
  pendingReplies,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  /**
   * The Reply Queue's own count, when the queue itself is on screen — it is
   * fresher than the shared counter and updates the instant a reply is cleared.
   */
  pendingReplies?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ '--rail': RAIL_OFFSET } as CSSProperties}>
      <PageHeader title={title} description={description} action={action} />
      <OutreachTabs pendingReplies={pendingReplies} />
      {children}
    </div>
  );
}

/**
 * A section heading with its aside on the same baseline.
 *
 * Coverage, Runs and Monitoring all needed the same title-left / note-right
 * row, and all three had drifted to slightly different gaps.
 */
export function SectionHeading({
  title,
  note,
  action,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-panel-title text-ink-100">{title}</h2>
      {note && <p className="text-ui-xs text-ink-40">{note}</p>}
      {action}
    </div>
  );
}
