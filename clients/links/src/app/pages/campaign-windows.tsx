/* Shared editor for a campaign's destination windows.
 *
 * The CREATE screen edits a local draft array (nothing exists server-side yet);
 * the DETAIL screen persists each row through addWindow/updateWindow/removeWindow.
 * Both render the same rows and run the same client-side validation from here, so
 * the two forms can't drift apart on what counts as a valid window. */
import { Icon } from '../components';

/** A window being edited in the browser. Dates are `datetime-local` strings. */
export interface DraftWindow {
  /** Present once persisted; absent for a row the user just added. */
  id?: string;
  label: string;
  destinationUrl: string;
  startsAt: string;
  endsAt: string;
}

/** `datetime-local` wants "YYYY-MM-DDTHH:mm" in LOCAL time, not an ISO string. */
export function toLocalInput(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A fresh row: MIDNIGHT (00:00) local time tomorrow through midnight the day
 * after — i.e. one clean whole day that hasn't started yet.
 *
 * Midnight-aligned because campaigns are scheduled in whole days ("all of 1
 * January"), and because the window end is EXCLUSIVE: 1 Jan 00:00 → 2 Jan 00:00
 * is exactly that day with no gap or overlap against the next window. Defaulting
 * to the next whole HOUR instead meant every window the user typed carried an
 * arbitrary time they then had to clear by hand.
 *
 * Local time, not UTC — the user schedules in their own day, and the input is a
 * `datetime-local` (see toLocalInput). The server stores timestamptz, so the
 * offset is preserved on the way through.
 */
export function blankWindow(): DraftWindow {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  const end = new Date(start);
  // setDate (not +86_400_000) so the span stays one calendar day across a
  // daylight-saving boundary, where a day is 23 or 25 hours.
  end.setDate(end.getDate() + 1);
  return {
    label: '',
    destinationUrl: '',
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
  };
}

/**
 * Why this window is invalid, or null when it's fine. Mirrors the server's
 * windowInputSchema (a valid URL, and an end strictly after the start) so the user
 * sees the problem before a round-trip.
 */
export function windowDraftError(w: DraftWindow): string | null {
  if (!w.destinationUrl.trim()) return 'Add the destination for this window.';
  try {
    const u = new URL(w.destinationUrl.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return 'The destination must be an http(s) URL.';
    }
  } catch {
    return 'That destination is not a valid URL.';
  }
  if (!w.startsAt || !w.endsAt) return 'Set both a start and an end.';
  const start = new Date(w.startsAt);
  const end = new Date(w.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 'Those dates could not be read.';
  }
  if (end <= start) return 'The window must end after it starts.';
  return null;
}

/**
 * The editable list of windows. `onChange` receives the whole next array — the
 * caller decides whether that's local state (create) or a save (detail).
 *
 * `activeWindowId` highlights whichever window the server says is live right now,
 * so the user can see which row visitors are currently getting.
 */
export function WindowRows({
  windows,
  onChange,
  onRemove,
  activeWindowId,
  emptyHint,
  readOnly,
}: {
  windows: DraftWindow[];
  onChange: (next: DraftWindow[]) => void;
  /** Detail screen only: delete a PERSISTED row instead of splicing the array. */
  onRemove?: (w: DraftWindow, index: number) => void;
  activeWindowId?: string | null;
  emptyHint?: string;
  readOnly?: boolean;
}) {
  if (windows.length === 0) {
    return (
      <span className="mutetext" style={{ fontSize: 13 }}>
        {emptyHint ?? 'No windows scheduled.'}
      </span>
    );
  }

  const patch = (i: number, field: keyof DraftWindow, value: string) => {
    onChange(windows.map((w, j) => (i === j ? { ...w, [field]: value } : w)));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {windows.map((w, i) => {
        const err = windowDraftError(w);
        const isLive = !!w.id && w.id === activeWindowId;
        return (
          <div
            key={w.id ?? `draft-${i}`}
            className="dcard"
            style={{
              padding: '12px 14px',
              borderColor: isLive ? 'var(--adeyy-ink)' : undefined,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
              }}
            >
              <input
                className="ainput"
                style={{ maxWidth: 220 }}
                placeholder="Window name (optional)"
                value={w.label}
                disabled={readOnly}
                onChange={(e) => patch(i, 'label', e.target.value)}
              />
              {isLive && <span className="achip active">Live now</span>}
              <span className="spacer" style={{ flex: 1 }} />
              {!readOnly && (
                <button
                  className="abtn abtn-quiet abtn-sm"
                  title="Remove window"
                  onClick={() =>
                    onRemove
                      ? onRemove(w, i)
                      : onChange(windows.filter((_, j) => j !== i))
                  }
                >
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)',
                gap: 8,
              }}
            >
              <input
                className={'ainput' + (err && w.destinationUrl ? ' err' : '')}
                placeholder="https://example.com/happy-new-year"
                value={w.destinationUrl}
                disabled={readOnly}
                onChange={(e) => patch(i, 'destinationUrl', e.target.value)}
              />
              <input
                className="ainput"
                type="datetime-local"
                value={w.startsAt}
                disabled={readOnly}
                onChange={(e) => patch(i, 'startsAt', e.target.value)}
              />
              <input
                className="ainput"
                type="datetime-local"
                value={w.endsAt}
                disabled={readOnly}
                onChange={(e) => patch(i, 'endsAt', e.target.value)}
              />
            </div>

            {err && (
              <span className="hint" style={{ color: 'var(--danger)', marginTop: 6 }}>
                {err}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
