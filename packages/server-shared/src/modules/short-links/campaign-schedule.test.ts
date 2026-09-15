import { describe, expect, it } from 'vitest';
import {
  activeWindow,
  nextScheduleChange,
  resolveCampaignDestination,
  windowContains,
  type ScheduleWindow,
} from './campaign-schedule.js';

const at = (iso: string) => new Date(iso);

/** Terse window builder — id doubles as the label in assertions. */
function w(
  id: string,
  startsAt: string,
  endsAt: string,
  extra: Partial<ScheduleWindow> = {},
): ScheduleWindow {
  return {
    id,
    destinationUrl: `https://example.com/${id}`,
    startsAt: at(startsAt),
    endsAt: at(endsAt),
    ...extra,
  };
}

const NEW_YEAR = w('new-year', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z');

describe('windowContains', () => {
  it('is half-open: includes the start instant, excludes the end', () => {
    expect(windowContains(NEW_YEAR, at('2027-01-01T00:00:00Z'))).toBe(true);
    expect(windowContains(NEW_YEAR, at('2027-01-01T12:00:00Z'))).toBe(true);
    // The end instant belongs to whatever comes next, so back-to-back windows
    // never both match.
    expect(windowContains(NEW_YEAR, at('2027-01-02T00:00:00Z'))).toBe(false);
    expect(windowContains(NEW_YEAR, at('2026-12-31T23:59:59Z'))).toBe(false);
  });
});

describe('activeWindow', () => {
  it('returns null when no window covers the instant', () => {
    expect(activeWindow([NEW_YEAR], at('2027-06-01T00:00:00Z'))).toBeNull();
  });

  it('picks the only matching window, ignoring non-matching ones', () => {
    const easter = w('easter', '2027-04-01T00:00:00Z', '2027-04-05T00:00:00Z');
    expect(activeWindow([NEW_YEAR, easter], at('2027-04-02T00:00:00Z'))?.id).toBe('easter');
  });

  it('breaks overlaps by LATEST start — the most recently begun promo wins', () => {
    const monthLong = w('month', '2027-01-01T00:00:00Z', '2027-02-01T00:00:00Z');
    const oneDay = w('one-day', '2027-01-15T00:00:00Z', '2027-01-16T00:00:00Z');
    // Both cover Jan 15; the narrower promo started later so it takes precedence.
    expect(activeWindow([monthLong, oneDay], at('2027-01-15T09:00:00Z'))?.id).toBe('one-day');
    // Order of the input array must not matter.
    expect(activeWindow([oneDay, monthLong], at('2027-01-15T09:00:00Z'))?.id).toBe('one-day');
    // Outside the narrow one, the long promo is back in effect.
    expect(activeWindow([monthLong, oneDay], at('2027-01-20T00:00:00Z'))?.id).toBe('month');
  });

  it('breaks identical starts by newest createdAt', () => {
    const older = w('older', '2027-03-01T00:00:00Z', '2027-03-10T00:00:00Z', {
      createdAt: at('2027-01-01T00:00:00Z'),
    });
    const newer = w('newer', '2027-03-01T00:00:00Z', '2027-03-10T00:00:00Z', {
      createdAt: at('2027-02-01T00:00:00Z'),
    });
    expect(activeWindow([older, newer], at('2027-03-05T00:00:00Z'))?.id).toBe('newer');
    expect(activeWindow([newer, older], at('2027-03-05T00:00:00Z'))?.id).toBe('newer');
  });

  it('is deterministic when start AND createdAt tie', () => {
    const a = w('aaa', '2027-03-01T00:00:00Z', '2027-03-10T00:00:00Z');
    const b = w('bbb', '2027-03-01T00:00:00Z', '2027-03-10T00:00:00Z');
    const pick = (ws: ScheduleWindow[]) =>
      activeWindow(ws, at('2027-03-05T00:00:00Z'))?.id;
    expect(pick([a, b])).toBe(pick([b, a]));
  });
});

describe('resolveCampaignDestination', () => {
  const withUrl = { destinationUrl: 'https://example.com/no-promos', fallbackText: null };
  const withText = { destinationUrl: null, fallbackText: 'No promotions right now.' };

  it('serves the active window over the default', () => {
    const r = resolveCampaignDestination(withUrl, [NEW_YEAR], at('2027-01-01T10:00:00Z'));
    expect(r).toEqual({
      type: 'redirect',
      url: 'https://example.com/new-year',
      windowId: 'new-year',
      label: null,
    });
  });

  it('falls back to the default URL outside every window', () => {
    const r = resolveCampaignDestination(withUrl, [NEW_YEAR], at('2027-05-01T00:00:00Z'));
    expect(r).toEqual({
      type: 'redirect',
      url: 'https://example.com/no-promos',
      windowId: null,
      label: null,
    });
  });

  it('falls back to text when there is no default URL', () => {
    const r = resolveCampaignDestination(withText, [NEW_YEAR], at('2027-05-01T00:00:00Z'));
    expect(r).toEqual({ type: 'text', text: 'No promotions right now.' });
  });

  it('still redirects inside a window even when the fallback is text', () => {
    const r = resolveCampaignDestination(withText, [NEW_YEAR], at('2027-01-01T06:00:00Z'));
    expect(r?.type).toBe('redirect');
  });

  it('carries the window label through for analytics/UI', () => {
    const labelled = w('ny', '2027-01-01T00:00:00Z', '2027-01-02T00:00:00Z', {
      label: 'Happy New Year',
    });
    const r = resolveCampaignDestination(withUrl, [labelled], at('2027-01-01T01:00:00Z'));
    expect(r).toMatchObject({ label: 'Happy New Year' });
  });

  it('returns null when nothing at all is configured (check-constraint violation)', () => {
    expect(
      resolveCampaignDestination(
        { destinationUrl: null, fallbackText: null },
        [],
        at('2027-01-01T00:00:00Z'),
      ),
    ).toBeNull();
  });

  it('serves the default when the campaign has no windows yet', () => {
    expect(resolveCampaignDestination(withUrl, [], at('2027-01-01T00:00:00Z'))).toMatchObject({
      url: 'https://example.com/no-promos',
    });
  });
});

describe('nextScheduleChange', () => {
  it('returns the soonest upcoming boundary', () => {
    const later = w('later', '2027-02-01T00:00:00Z', '2027-02-02T00:00:00Z');
    expect(nextScheduleChange([NEW_YEAR, later], at('2026-12-01T00:00:00Z'))).toEqual(
      at('2027-01-01T00:00:00Z'),
    );
  });

  it('returns the END of the window while one is active', () => {
    expect(nextScheduleChange([NEW_YEAR], at('2027-01-01T10:00:00Z'))).toEqual(
      at('2027-01-02T00:00:00Z'),
    );
  });

  it('returns null once every window is in the past', () => {
    expect(nextScheduleChange([NEW_YEAR], at('2028-01-01T00:00:00Z'))).toBeNull();
    expect(nextScheduleChange([], at('2027-01-01T00:00:00Z'))).toBeNull();
  });
});
