/**
 * Time and text formatting for the transcript and the inbox.
 *
 * The day-divider helpers are RE-EXPORTED from the shared chat module rather than
 * reimplemented: they already encode the repo's rules about when a divider earns
 * its place, and two frontends quietly disagreeing about what counts as
 * "yesterday" is exactly the kind of drift that is impossible to spot in review.
 */
export {
  timeAgoShort,
  shouldShowTimeDivider,
  timeDividerLabel,
  unreadLabel,
} from '@shared/pages/chat/chat-types';

/** `14:32` — the timestamp beside a message. 24-hour, because it is mono and
 *  tabular, and `2:07 pm` is three glyphs of noise in a right-aligned gutter. */
export function clockTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * The inbox row's time: `2m` / `14:32` / `Tue` / `11 Aug`. Never a full
 * timestamp — the row already has one job and the exact second is not it.
 */
export function inboxTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;

  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return clockTime(d);

  const days = Math.floor(diffMs / 86_400_000);
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
}

/** `LAST SEEN 14:02` / `LAST SEEN TUE` for the room header. */
export function lastSeenLabel(value: string | Date | null | undefined): string {
  if (!value) return 'OFFLINE';
  return `LAST SEEN ${inboxTime(value).toUpperCase()}`;
}

/** `2.4 MB`. Mono, tabular, never more precision than anyone wants. */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** First name only — group labels and preview prefixes. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * Do these two messages belong to the same run?
 *
 * A run collapses consecutive messages from one person so the name and avatar
 * print once. Four minutes is the window: long enough that a paragraph typed in
 * three bursts stays one block, short enough that a reply an hour later gets its
 * own header and reads as a separate act.
 */
const RUN_WINDOW_MS = 4 * 60_000;

export function sameRun(
  prev: { senderId: string | null; timestamp: string; type: string } | undefined,
  next: { senderId: string | null; timestamp: string; type: string },
): boolean {
  if (!prev) return false;
  if (prev.type === 'system' || next.type === 'system') return false;
  if (!prev.senderId || prev.senderId !== next.senderId) return false;
  const gap = new Date(next.timestamp).getTime() - new Date(prev.timestamp).getTime();
  return gap >= 0 && gap < RUN_WINDOW_MS;
}
