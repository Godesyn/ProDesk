/**
 * Mute durations — the ONE list, shared by the messenger's row menu, the
 * messenger's room menu and the workspace MessagePanel's header menu.
 *
 * Three surfaces offered "Mute for 8 hours" and nothing else, which is the wrong
 * shape for the two things people actually want: silence for the rest of a
 * meeting, and silence until they say otherwise. The list lives here so adding a
 * fourth option changes one file rather than three, and so the label a menu shows
 * always matches the instant it sends.
 *
 * `until` is computed at CLICK time, not at module load, or every option would be
 * measured from whenever the tab happened to open.
 */

/**
 * A mute with no end date. An absurdly far-future timestamp rather than a
 * nullable flag, so `muted_until > now()` remains the single predicate every
 * server-side gate uses (send-side notify filter, digest worker, inbox
 * decoration). Mirrors `MUTE_FOREVER` in routers/chat/consumer.ts.
 */
export const MUTE_FOREVER = '9999-12-31T23:59:59.000Z';

export type MuteOption = {
  /** Stable key, for React lists and tests. */
  key: string;
  label: string;
  /** The instant the mute lapses, resolved when the user picks it. */
  until: () => Date;
};

export const MUTE_OPTIONS: readonly MuteOption[] = [
  { key: '30m', label: 'For 30 minutes', until: () => new Date(Date.now() + 30 * 60_000) },
  { key: '1h', label: 'For 1 hour', until: () => new Date(Date.now() + 3_600_000) },
  { key: '8h', label: 'For 8 hours', until: () => new Date(Date.now() + 8 * 3_600_000) },
  { key: '1d', label: 'For 24 hours', until: () => new Date(Date.now() + 24 * 3_600_000) },
  { key: '1w', label: 'For a week', until: () => new Date(Date.now() + 7 * 24 * 3_600_000) },
  { key: 'forever', label: 'Until I turn it back on', until: () => new Date(MUTE_FOREVER) },
];

/** True when a mute has no practical end (see MUTE_FOREVER). */
export function isForeverMute(until: Date | string | null | undefined): boolean {
  if (!until) return false;
  const d = until instanceof Date ? until : new Date(until);
  return !Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 9999;
}

/**
 * How a live mute reads in a list row or a menu header. Deliberately short —
 * this sits where a timestamp normally does, so it has one line at most.
 */
export function muteLabel(until: Date | string | null | undefined): string {
  if (!until) return 'Muted';
  if (isForeverMute(until)) return 'Muted';
  const d = until instanceof Date ? until : new Date(until);
  if (Number.isNaN(d.getTime())) return 'Muted';
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'Muted';
  const hours = ms / 3_600_000;
  if (hours < 1) return `Muted ${Math.max(1, Math.round(ms / 60_000))}m`;
  if (hours < 24) return `Muted ${Math.round(hours)}h`;
  return `Muted ${Math.round(hours / 24)}d`;
}
