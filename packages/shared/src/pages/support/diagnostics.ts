/**
 * Client-side diagnostic capture for support tickets.
 *
 * `collectSupportDiagnostics()` snapshots the exact page URL the ticket is being
 * raised from plus the caller's device/browser fingerprint and a tail of the
 * browser console (see `@shared/lib/console-capture`). It is injected
 * automatically into every `support.create` call by `useCreateSupportTicket`, so
 * individual frontends don't have to wire it up. The server enriches this with
 * the trusted `ip`/`userAgent`/`client` from the request headers and stores the
 * merged bundle on `supportTickets.metadata` for the admin triage console.
 *
 * The shape intentionally mirrors (a subset of) `SupportTicketMetadata` on the
 * server — only the fields the browser can supply.
 */

import { getCapturedConsoleLog } from '../../lib/console-capture';

export type SupportDiagnostics = {
  pageUrl?: string;
  origin?: string;
  referrer?: string;
  userAgent?: string;
  platform?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  timezoneOffsetMinutes?: number;
  screen?: { width: number; height: number };
  viewport?: { width: number; height: number };
  devicePixelRatio?: number;
  console?: { level: string; message: string; at: string }[];
};

/** Snapshot the current browser environment for attaching to a new ticket. */
export function collectSupportDiagnostics(): SupportDiagnostics | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const nav = window.navigator;
    const tz = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        return undefined;
      }
    })();
    return {
      pageUrl: window.location.href,
      origin: window.location.origin,
      referrer: document.referrer || undefined,
      userAgent: nav.userAgent,
      platform: nav.platform || undefined,
      language: nav.language || undefined,
      languages: nav.languages ? Array.from(nav.languages) : undefined,
      timezone: tz,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      screen: window.screen
        ? { width: window.screen.width, height: window.screen.height }
        : undefined,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      console: getCapturedConsoleLog(),
    };
  } catch {
    // Diagnostics are best-effort — never block ticket creation on them.
    return undefined;
  }
}
