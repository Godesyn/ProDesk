import express from 'express';
import type { Request } from 'express';
import { db, eq, sql, and } from '@prodesk/server-shared/db';
import {
  shortLinks,
  linkDestinationWindows,
  reviewLocations,
} from '@prodesk/server-shared/db/schema';
import { env } from '@prodesk/server-shared/lib/env';
import { recordLinkEvent } from '@prodesk/server-shared/modules/short-links/events';
import {
  nextScheduleChange,
  resolveCampaignDestination,
  type CampaignResolution,
} from '@prodesk/server-shared/modules/short-links/campaign-schedule';
import { recordSignatureEvent } from '@prodesk/server-shared/modules/signatures/events';
import {
  detectBot,
  visitorHash,
  utcDayStamp,
} from '@prodesk/server-shared/modules/analytics/capture';
import { lookup } from 'fast-geoip';
import { landingHtml, sharedAsset } from './landing.js';
import { hasSupabaseSession } from './session.js';

const app = express();
app.set('trust proxy', true);

/** First forwarded client IP (or Express's resolved req.ip). */
function clientIp(req: Request): string | undefined {
  const ipHeader = req.get('x-forwarded-for');
  return ipHeader ? ipHeader.split(',')[0].trim() : req.ip;
}

/**
 * Per-hit capture signals shared by both redirect routes: whether the request
 * is automated/prefetch (`isBot`) and a privacy-preserving unique-visitor
 * fingerprint (`ipHash`). The salt is a stable server secret; the hash rotates
 * daily so it can't track a visitor across days.
 */
function captureSignals(req: Request): {
  isBot: boolean;
  ipHash: string | null;
} {
  const ua = req.get('user-agent');
  return {
    isBot: detectBot(ua, (name: string) => req.get(name)),
    ipHash: visitorHash(
      clientIp(req),
      ua,
      utcDayStamp(),
      env.SUPABASE_JWT_SECRET,
    ),
  };
}

/**
 * Resolve the visitor country: prefer the edge proxy header when present
 * (Cloudflare / Vercel / generic), otherwise fall back to a local GeoIP lookup
 * on the forwarded IP. Never throws.
 */
async function getCountry(req: Request): Promise<string | null> {
  const edgeCountry =
    req.get('cf-ipcountry') ??
    req.get('x-vercel-ip-country') ??
    req.get('x-country');
  if (edgeCountry) return edgeCountry;

  try {
    const ipHeader = req.get('x-forwarded-for');
    const ip = ipHeader ? ipHeader.split(',')[0].trim() : req.ip;
    if (ip && ip !== '127.0.0.1' && ip !== '::1') {
      const geo = await lookup(ip);
      return geo?.country ?? null;
    }
  } catch (err) {
    console.error('[Redirector] Local GeoIP lookup failed:', err);
  }
  return null;
}

/** Event types accepted by the signature analytics enum. */
const SIGNATURE_EVENT_TYPES = new Set([
  'banner_click',
  'cta_click',
  'verdiict_review_click',
  'verdiict_reviews_click',
  'social_click',
  'email_click',
  'phone_click',
  'website_click',
]);

/**
 * Resolve an origin host to a full URL (including http/https protocol).
 */
function getOriginUrl(host: string): string {
  if (host.startsWith('http://') || host.startsWith('https://')) {
    return host;
  }
  const proto = host.includes('localhost') || host.includes('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

/** Absolute origin of the Links app — where a signed-in visitor belongs. */
function appOrigin(): string {
  return getOriginUrl(env.VITE_LINKS_PRODESK_ORIGIN);
}

function getNotFoundHtml(path = '/'): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const targetUrl = `${appOrigin()}${cleanPath}`;
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Link Not Found</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background-color: #f9fafb; color: #111827; }
        h1 { margin-bottom: 8px; font-size: 24px; font-weight: 600; }
        p { color: #6b7280; margin-bottom: 24px; text-align: center; max-width: 400px; line-height: 1.5; }
        a { color: #000; font-weight: 500; text-decoration: none; padding: 8px 16px; border-radius: 6px; background-color: #fff; border: 1px solid #d1d5db; transition: background-color 0.2s; }
        a:hover { background-color: #f3f4f6; }
      </style>
    </head>
    <body>
      <h1>Link Not Found</h1>
      <p>The link you are trying to access does not exist or has been disabled by the owner.</p>
      <a href="${targetUrl}">Go to Adeyy</a>
    </body>
    </html>
`;
}
/**
 * The page a CAMPAIGN shows when no window is in effect and its fallback is TEXT
 * rather than a URL — e.g. "No promotions right now".
 *
 * This is the standard "not live yet, come back" pattern rather than a bare
 * sentence on a page: a status dot so the state reads at a glance, the owner's
 * message as the only real content, and — when the schedule says when the link
 * starts working again — the return time plus a countdown. The chrome stays
 * deliberately quiet; the message is the campaign owner's, not ours.
 *
 * `nextChangeAt` is rendered as a machine-readable ISO instant and formatted in
 * the VISITOR's timezone by the inline script: the server has no idea where they
 * are, and "back at 9am" in the wrong zone is worse than no time at all. With JS
 * off, the `<time>` element's server-rendered UTC text stands in. When the
 * countdown reaches the switch-over the page reloads itself once, so someone
 * waiting on a launch lands on the real destination without touching anything.
 *
 * The message is user-authored, so it is HTML-escaped — a campaign fallback must
 * never be able to inject markup or script into a page we serve. It is also kept
 * out of the script entirely (the only value the script reads is the ISO date,
 * via a data attribute), so there is no JS string context to escape for.
 */
function getCampaignMessageHtml(message: string, nextChangeAt?: Date | null): string {
  const iso = nextChangeAt ? nextChangeAt.toISOString() : '';
  const utcLabel = nextChangeAt
    ? `${nextChangeAt.toUTCString().replace(/:\d\d GMT$/, ' UTC')}`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(message.slice(0, 60))}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --card: #ffffff;
      --ink: #111827;
      --ink-60: #6b7280;
      --ink-40: #9ca3af;
      --line: #e7e9ee;
      --dot: #f59e0b;
      --shadow: 0 1px 2px rgba(17, 24, 39, 0.04), 0 12px 32px -12px rgba(17, 24, 39, 0.12);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0c0d10;
        --card: #15171c;
        --ink: #f3f4f6;
        --ink-60: #9ca3af;
        --ink-40: #6b7280;
        --line: #24272f;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 12px 32px -12px rgba(0, 0, 0, 0.6);
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; margin: 0; padding: 24px;
      background: var(--bg); color: var(--ink);
      -webkit-font-smoothing: antialiased;
    }
    main {
      width: 100%; max-width: 30rem;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: var(--shadow);
      padding: 30px 28px 24px;
      text-align: center;
      /* A fallback message is user-authored and may contain a long unbroken
         string; wrap it rather than let it widen the card off-screen. */
      overflow-wrap: anywhere;
    }
    .status {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--ink-60); margin-bottom: 18px;
    }
    .dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: var(--dot); flex: 0 0 auto;
      box-shadow: 0 0 0 0 var(--dot);
      animation: pulse 2.4s ease-out infinite;
    }
    /* Decorative only — a visitor who asked for less motion just gets a dot. */
    @media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.5); }
      70%, 100% { box-shadow: 0 0 0 7px rgba(245, 158, 11, 0); }
    }
    .message {
      font-size: 19px; line-height: 1.55; margin: 0;
      white-space: pre-line; text-wrap: pretty;
    }
    .back {
      margin: 22px 0 0; padding-top: 18px;
      border-top: 1px solid var(--line);
      font-size: 13.5px; color: var(--ink-60);
    }
    .back strong { color: var(--ink); font-weight: 600; }
    .countdown { display: block; margin-top: 3px; font-size: 12px; color: var(--ink-40); }
    footer { margin-top: 22px; font-size: 11px; color: var(--ink-40); }
    footer a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--line); }
    footer a:hover { color: var(--ink-60); }
  </style>
</head>
<body>
  <main>
    <span class="status"><span class="dot"></span>Not running right now</span>
    <p class="message">${escapeHtml(message)}</p>
    ${
      iso
        ? `<p class="back" id="back">Back on <strong><time datetime="${escapeHtml(iso)}" id="at">${escapeHtml(utcLabel)}</time></strong><span class="countdown" id="in"></span></p>`
        : ''
    }
    <footer><a href="${appOrigin()}">Powered by Adeyy</a></footer>
  </main>
  ${
    iso
      ? `<script>
    (function () {
      var el = document.getElementById('at');
      var at = new Date(el.getAttribute('datetime'));
      if (isNaN(at.getTime())) return;
      try {
        el.textContent = at.toLocaleString(undefined, {
          weekday: 'long', day: 'numeric', month: 'long',
          hour: 'numeric', minute: '2-digit',
        });
      } catch (e) { /* keep the server-rendered UTC text */ }

      var out = document.getElementById('in');
      var reloaded = false;
      function tick() {
        var ms = at.getTime() - Date.now();
        if (ms <= 0) {
          // The schedule has moved on — ask the server again, once, and the
          // visitor lands wherever the link now points.
          out.textContent = 'Opening…';
          if (!reloaded) { reloaded = true; location.reload(); }
          return;
        }
        var mins = Math.floor(ms / 60000);
        var hours = Math.floor(mins / 60);
        var days = Math.floor(hours / 24);
        out.textContent =
          days > 0 ? 'in ' + days + (days === 1 ? ' day' : ' days')
          : hours > 0 ? 'in ' + hours + (hours === 1 ? ' hour' : ' hours')
          : mins > 0 ? 'in ' + mins + (mins === 1 ? ' minute' : ' minutes')
          : 'in under a minute';
        // Coarse remaining time needs coarse updates; only the last hour ticks
        // every second, so a page left open overnight costs ~nothing.
        setTimeout(tick, hours > 0 ? 60000 : 1000);
      }
      tick();
    })();
  </script>`
      : ''
  }
</body>
</html>
`;
}

/** Escape the five characters that matter for HTML text/attribute contexts. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, env: env.NODE_ENV });
});

app.get('/favicon.ico', (_req, res) => {
  res.type('image/svg+xml');
  res.send(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  );
});

/**
 * Static assets behind the landing page (its CSS, motion script, logos), served
 * from packages/shared/public — the very files the Links frontend publishes at
 * these same URLs, so the page needs no host-specific rewriting. Registered
 * before `/:slug` so `/adeyy/...` can never be mistaken for a short link.
 */
app.get('/adeyy/*', (req, res) => {
  const asset = sharedAsset(req.path, appOrigin());
  if (!asset) return res.status(404).send(getNotFoundHtml(req.originalUrl));
  res.setHeader('Content-Type', asset.contentType);
  res.setHeader('Cache-Control', 'public, max-age=600');
  return res.send(asset.body);
});

/**
 * Root of the redirector host (url.adeyy.com) — a real front door rather than an
 * unconditional bounce:
 *  - signed in (the `.adeyy.com` session cookie reaches us, see ./session) →
 *    straight to the Links app, in this same window. Both hosts sit under
 *    adeyy.com, so it boots signed in off the very same cookie — no hand-off,
 *    no round-trip, nothing to mint.
 *  - signed out → the SAME marketing page the app domain would show, so the
 *    visitor stays here instead of being handed a login screen on another host.
 *
 * The response therefore depends on a cookie: `Vary` says so and `no-store`
 * keeps any proxy from serving one visitor's outcome to another — a cached 302
 * would send signed-out visitors into the app, and a cached landing page would
 * strand signed-in ones.
 */
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (hasSupabaseSession(req.get('cookie'), req.get('host'))) {
    return res.redirect(302, appOrigin());
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(landingHtml(appOrigin()));
});

/**
 * Email-signature click tracking. Exported signatures wrap every clickable link
 * through `/s/?url=<dest>&brand=<id>&event=<type>&sb=&member=&campaign=&label=`
 * (see clients/signatures signatureGenerator.wrapTrackingUrl). We record the
 * click fire-and-forget, then 302 to the real destination.
 */
app.get('/s', async (req, res) => {
  const destination = typeof req.query.url === 'string' ? req.query.url : '';
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : '';

  // Only http(s) destinations are safe to 302 to; anything else → home.
  let parsed: URL | null = null;
  try {
    parsed = new URL(destination);
  } catch {
    parsed = null;
  }
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return res.redirect(appOrigin());
  }

  const eventType = typeof req.query.event === 'string' ? req.query.event : '';

  // Record the click without blocking the redirect. Requires a brand id and a
  // known event type; unknown/missing → skip recording but still redirect.
  if (brandId && SIGNATURE_EVENT_TYPES.has(eventType)) {
    const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
    const { isBot, ipHash } = captureSignals(req);
    getCountry(req)
      .then((country) =>
        recordSignatureEvent(db, {
          brandId,
          eventType: eventType as Parameters<
            typeof recordSignatureEvent
          >[1]['eventType'],
          signatureBrandId: str(req.query.sb) ?? null,
          memberId: str(req.query.member) ?? null,
          campaignId: str(req.query.campaign) ?? null,
          label: str(req.query.label) ?? null,
          userAgent: req.get('user-agent'),
          referer: req.get('referer') ?? req.get('referrer'),
          country,
          isBot,
          ipHash,
        }),
      )
      .catch((err: unknown) =>
        console.error('Failed to record signature event', err),
      );
  }

  return res.redirect(302, parsed.toString());
});

/**
 * Verdiict review-page hop. QR codes encode this URL with the location's
 * immutable id, so a printed code survives any number of review-link (slug)
 * renames — each scan resolves the CURRENT slug and 302s to the Verdiict
 * frontend. Query params are passed through (e.g. a future ?rr= read receipt).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.get('/v/:locationId', async (req, res) => {
  const { locationId } = req.params;
  const reviewsOrigin = env.VITE_REVIEWS_PRODESK_ORIGIN;
  const proto = reviewsOrigin.includes('localhost') ? 'http' : 'https';
  if (!UUID_RE.test(locationId)) {
    return res.status(404).send(getNotFoundHtml(req.originalUrl));
  }
  try {
    const [loc] = await db
      .select({ slug: reviewLocations.slug })
      .from(reviewLocations)
      .where(eq(reviewLocations.id, locationId))
      .limit(1);
    if (loc) {
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return res.redirect(302, `${proto}://${reviewsOrigin}/r/${loc.slug}${qs}`);
    }
  } catch (error) {
    console.error('Error resolving review location:', error);
  }
  return res.status(404).send(getNotFoundHtml(req.originalUrl));
});

app.get('/:slug', async (req, res) => {
  const { slug } = req.params;
  if (!slug) {
    return res.redirect(appOrigin());
  }

  try {
    const [link] = await db
      .select({
        id: shortLinks.id,
        kind: shortLinks.kind,
        destinationUrl: shortLinks.destinationUrl,
        fallbackText: shortLinks.fallbackText,
        brandId: shortLinks.brandId,
      })
      .from(shortLinks)
      .where(
        and(
          sql`lower(${shortLinks.slug}) = ${slug.toLowerCase()}`,
          eq(shortLinks.isActive, true),
        ),
      )
      .limit(1);

    if (link) {
      // A CAMPAIGN's destination depends on the date: its windows override the
      // default while they're in effect. Resolved with the same shared pure rule
      // the dashboard previews with (campaign-schedule.ts), so what we serve and
      // what the user was shown can never drift. Plain links skip this query.
      let resolution: CampaignResolution | null = null;
      /* When a text fallback is being shown, the next window boundary is what the
         page tells the visitor to come back for. Only meaningful for campaigns. */
      let nextChangeAt: Date | null = null;
      if (link.kind === 'campaign') {
        const windows = await db
          .select({
            id: linkDestinationWindows.id,
            destinationUrl: linkDestinationWindows.destinationUrl,
            startsAt: linkDestinationWindows.startsAt,
            endsAt: linkDestinationWindows.endsAt,
            createdAt: linkDestinationWindows.createdAt,
            label: linkDestinationWindows.label,
          })
          .from(linkDestinationWindows)
          .where(eq(linkDestinationWindows.linkId, link.id));
        const now = new Date();
        resolution = resolveCampaignDestination(link, windows, now);
        nextChangeAt = nextScheduleChange(windows, now);
        // Misconfigured campaign (no window in effect, no fallback of either
        // kind) — nothing to serve, so treat it as a dead slug.
        if (!resolution) {
          return res.status(404).send(getNotFoundHtml(req.originalUrl));
        }
      }

      // Fire and forget click count increment (denormalized fast counter).
      db.update(shortLinks)
        .set({ clickCount: sql`${shortLinks.clickCount} + 1` })
        .where(eq(shortLinks.id, link.id))
        .execute()
        .catch((err: any) =>
          console.error('Failed to increment click count for slug', slug, err),
        );

      // Fire and forget analytics event (device/referrer/country/time-series).
      // Country comes from the edge proxy header when present (Cloudflare /
      // Vercel / generic); absent on plain Railway → local GeoIP lookup fallback.
      // A `?qr=1` marker (set on QR-encoded URLs) distinguishes scans from clicks.
      const source = req.query.qr === '1' ? 'qr' : 'link';
      const { isBot, ipHash } = captureSignals(req);
      getCountry(req)
        .then((country) =>
          recordLinkEvent(db, {
            linkId: link.id,
            brandId: link.brandId,
            userAgent: req.get('user-agent'),
            referer: req.get('referer') ?? req.get('referrer'),
            country,
            source,
            isBot,
            ipHash,
          }),
        )
        .catch((err: unknown) =>
          console.error('Failed to record link event for slug', slug, err),
        );

      // A campaign whose fallback is TEXT has nowhere to send the visitor, so we
      // render the message itself. Clicks are still counted above — the hit
      // happened, it just didn't go anywhere.
      if (resolution?.type === 'text') {
        return res
          .status(200)
          .set('Cache-Control', 'no-store')
          .send(getCampaignMessageHtml(resolution.text, nextChangeAt));
      }

      const target = resolution?.url ?? link.destinationUrl;
      // Unreachable for a plain link (destination_url is NOT NULL for kind='link'
      // per short_links_destination_ck) and handled above for campaigns; this is
      // the belt-and-braces guard so a bad row 404s instead of crashing.
      if (!target) {
        return res.status(404).send(getNotFoundHtml(req.originalUrl));
      }
      // A campaign's answer changes on a schedule, so it must never be cached by
      // the browser or an intermediary the way a permanent link could be.
      if (link.kind === 'campaign') res.set('Cache-Control', 'no-store');
      return res.redirect(302, target);
    }
  } catch (error: any) {
    if (error?.code === '42P01' || error?.cause?.code === '42P01') {
      console.warn(
        `[Redirector] Warning: "short_links" table does not exist. Skipping DB lookup.`,
      );
    } else {
      console.error('Error resolving short link:', error);
    }
  }

  // Not found or error
  res.status(404).send(getNotFoundHtml(req.originalUrl));
});

// Catch-all for any other unmatched routes (e.g. /foo/bar)
app.use((req, res) => {
  res.status(404).send(getNotFoundHtml(req.originalUrl));
});

const port = process.env.PORT || 4001; // Default to a different port than main backend
app.listen(port, () => {
  console.log(`▸ Redirector service on http://localhost:${port}`);
});
