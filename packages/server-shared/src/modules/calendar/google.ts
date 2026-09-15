import { eq } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { env } from '../../lib/env.js';

type Db = typeof defaultDb;

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CAL_BASE = 'https://www.googleapis.com/calendar/v3';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];

/** Whether Google OAuth is configured in this environment. */
export function calendarConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

/** Build the Google consent URL (offline access → refresh token). */
export function buildAuthUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

/** Exchange an auth code for tokens (linkGoogleCalendar). */
export async function exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken?: string; expiryDate: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiryDate: Date.now() + data.expires_in * 1000 };
}

/** Refresh an access token from a stored refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiryDate: number }> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  const data = (await res.json()) as GoogleTokenResponse;
  return { accessToken: data.access_token, expiryDate: Date.now() + data.expires_in * 1000 };
}

/**
 * Return a valid access token for a user's linked calendar, refreshing (and
 * persisting) it when it's within 60s of expiry. Returns null if not linked.
 */
export async function getValidAccessToken(userId: string, db: Db = defaultDb): Promise<string | null> {
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  const tok = user?.googleCalendarToken;
  if (!tok?.refreshToken) return tok?.accessToken ?? null;
  if (tok.accessToken && tok.expiryDate && tok.expiryDate - Date.now() > 60_000) return tok.accessToken;
  const refreshed = await refreshAccessToken(tok.refreshToken);
  await db
    .update(users)
    .set({ googleCalendarToken: { ...tok, accessToken: refreshed.accessToken, expiryDate: refreshed.expiryDate } })
    .where(eq(users.id, userId));
  return refreshed.accessToken;
}

export interface BusyInterval { start: string; end: string }

/** Query a calendar's busy intervals (freebusy). */
export async function queryFreeBusy(accessToken: string, timeMin: string, timeMax: string, timeZone = 'UTC'): Promise<BusyInterval[]> {
  const res = await fetch(`${CAL_BASE}/freeBusy`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ timeMin, timeMax, timeZone, items: [{ id: 'primary' }] }),
  });
  if (!res.ok) throw new Error(`freeBusy failed (${res.status})`);
  const data = (await res.json()) as { calendars?: { primary?: { busy?: BusyInterval[] } } };
  return data.calendars?.primary?.busy ?? [];
}

/** Insert a calendar event with a Google Meet link. Returns the event id + meet url. */
export async function insertMeetingEvent(
  accessToken: string,
  opts: { summary: string; description: string; startIso: string; endIso: string; timeZone: string; attendeeEmail?: string; attendeeName?: string },
): Promise<{ eventId: string | null; meetUrl: string | null }> {
  const res = await fetch(`${CAL_BASE}/calendars/primary/events?conferenceDataVersion=1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: opts.summary,
      description: opts.description,
      start: { dateTime: opts.startIso, timeZone: opts.timeZone },
      end: { dateTime: opts.endIso, timeZone: opts.timeZone },
      attendees: opts.attendeeEmail ? [{ email: opts.attendeeEmail, displayName: opts.attendeeName }] : [],
      conferenceData: { createRequest: { requestId: `prodesk-${crypto.randomUUID()}`, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    }),
  });
  if (!res.ok) throw new Error(`event insert failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { id?: string; conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] } };
  const meetUrl = data.conferenceData?.entryPoints?.find((e) => e.entryPointType === 'video')?.uri ?? null;
  return { eventId: data.id ?? null, meetUrl };
}

/** Revoke a refresh token (best-effort) when unlinking. */
export async function revokeToken(token: string): Promise<void> {
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}
