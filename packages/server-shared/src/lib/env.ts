import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

// The .env lives at the monorepo root (prodesk-web/). Resolve it relative to
// this module so env vars load regardless of where the process is started.
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '../../../../.env') });
// Also pick up a server-local .env if one exists (does not override the above).
loadEnv();
// In development, the local Stripe CLI listener (scripts/stripe-listen.mjs)
// writes its device-local webhook signing secret to `.env.stripe.local`. Load
// it with `override` so it WINS over the production STRIPE_WEBHOOK_SECRET in the
// root .env — otherwise locally-forwarded events fail signature verification.
if (process.env.NODE_ENV !== 'production') {
  loadEnv({
    path: resolve(here, '../../../../.env.stripe.local'),
    override: true,
  });
}

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.preprocess(
    // An empty-string NODE_ENV (declared-but-unset in some deploy envs)
    // would bypass `.default()` and fail the enum — treat it as absent.
    (v) => (v === '' ? undefined : v),
    z.enum(['development', 'production', 'staging']).default('development'),
  ),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  STRIPE_SECRET_KEY: z.string().optional(),
  // Publishable (client) key — safe to expose; served to frontends that mount
  // Stripe Elements (e.g. the Links billing card form) via shortLinks.billingConfig.
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  CHECKOUT_SESSION_COMPLETED_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_ACCOUNT_UPDATED_WEBHOOK_SECRET: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  EMAIL_FROM: z.string().default('Prodesk <no-reply@prodesk.com>'),
  EMAIL_DEV_REDIRECT: z.string().optional(),
  // Extra apex domains (comma-separated) trusted as outbound-email link origins,
  // on top of the always-allowed `prodesk.com`. Each entry matches the apex and
  // all its subdomains (`acme.com` → `app.acme.com`, …). Use for white-label
  // frontend domains not under prodesk.com; keep it to real frontend hosts, since
  // the origin comes from the client-controlled `x-client-origin` header.
  EMAIL_ALLOWED_ORIGINS: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  // Implicit TLS (port 465). Unset → the mailer defaults it to true.
  // NOT z.coerce.boolean(): that is `Boolean(value)`, so the string "false" would
  // come through as TRUE. Parse the literal instead.
  SMTP_SECURE: z
    .preprocess(
      (v) => (v === '' ? undefined : v),
      z.enum(['true', 'false']).optional(),
    )
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  // Wise (transfer/payout provider + OAuth recipient linking)
  WISE_API_TOKEN: z.string().optional(),
  WISE_PROFILE_ID: z.string().optional(),
  WISE_CLIENT_ID: z.string().optional(),
  WISE_CLIENT_SECRET: z.string().optional(), // for the OAuth recipient-linking token exchange
  WISE_STRIPE_CONNECT_ACCOUNT_ID: z.string().optional(),
  // NOTE: Wise's webhook-signature public key is NOT an env var — it is published
  // by Wise and pinned in this file. See WISE_WEBHOOK_PUBLIC_KEY below.
  // PayPal (payout provider)
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  // Google (Calendar OAuth + Meet)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Google Maps / Places — server-side key for address autocomplete. Kept on the
  // backend (NOT exposed to the client as VITE_*) so the key is never shipped to
  // the browser; the SPA talks to the `places` tRPC router instead.
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Anthropic (Claude) — powers the per-brand AI assistant. One of the AI provider
  // families; unset → the Anthropic family is unavailable.
  ANTHROPIC_API_KEY: z.string().optional(),
  // Google Gemini — alternative AI provider family. Unset → the Gemini family is
  // unavailable. The assistant is disabled only when NO provider family has a key.
  GEMINI_API_KEY: z.string().optional(),
  // The public origin where both the SPA and the API are reachable. In prod the
  // server serves the built client, so one origin covers everything. In dev the
  // app runs under Vite at :5173 (which proxies API routes to the :4000 server),
  // so this is :5173 — every emailed/redirect link should resolve to the app.
  SERVER_ORIGIN: z.string().default('http://localhost:5173'),
  // Shared secret for the public partner REST API (X-API-Key). Unset → API disabled.
  PARTNER_API_KEY: z.string().optional(),
  // Apply pending Drizzle migrations on server startup. Set AUTO_MIGRATE=false
  // to disable (e.g. if migrations are run manually in your deploy pipeline).
  AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // ── Payments (EziQuotes) integrations — unset → that integration disabled ──
  // Xero / MYOB accounting OAuth.
  XERO_CLIENT_ID: z.string().optional(),
  XERO_CLIENT_SECRET: z.string().optional(),
  MYOB_CLIENT_ID: z.string().optional(),
  MYOB_CLIENT_SECRET: z.string().optional(),
  // Pipedrive CRM OAuth.
  PIPEDRIVE_CLIENT_ID: z.string().optional(),
  PIPEDRIVE_CLIENT_SECRET: z.string().optional(),
  // Stripe Connect (Standard-OAuth) client id for the payments inbound flow.
  STRIPE_CLIENT_ID: z.string().optional(),
  // Twilio (payer SMS): per-account creds override these platform defaults.
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_ALPHA_SENDER: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),
  // Postmark (payments transactional email).
  POSTMARK_SERVER_TOKEN: z.string().optional(),
  POSTMARK_FROM_DOMAIN: z.string().optional(),
  // Origin of the payments frontend, for links generated outside a request
  // context (workers/webhooks). MUST include the scheme — it is fed to
  // `new URL()` by the email origin allow-list, and a bare host silently fails
  // that check and falls back to the main app origin.
  PAYMENTS_ORIGIN: z.string().url().optional(),
  // Same idea for the messenger. The chat digest is fired by a cron worker, so
  // there is no request origin to infer it from, and every link in a chat email
  // has to land in the messenger rather than the main app. In hosted envs this
  // is derived from VITE_CHAT_PRODESK_ORIGIN and this var is unnecessary; set it
  // locally (e.g. http://localhost:5184) to make dev digests clickable.
  CHAT_ORIGIN: z.string().url().optional(),
  // ── Outreach (super-admin cold email) ──────────────────────────────────────
  // Smartlead is the sending backend and the system of record for mailboxes,
  // campaigns and message history. One key covers all 20 mailboxes across the
  // four sending domains — `client_id` is only for white-label sub-accounts,
  // which we don't use. Unset → the Outreach tab renders a setup prompt instead
  // of failing. The key is password-equivalent: server-side only, never VITE_*.
  SMARTLEAD_API_KEY: z.string().optional(),
  // The ONE campaign this environment sends through.
  //
  // Outreach runs a single campaign, not one per vertical: verticals are how a
  // list is scraped and how a prospect is filed, not how sending is organised,
  // and a campaign per vertical meant twenty half-configured campaigns sharing
  // one sequence. The name is the identity — it is matched case- and
  // whitespace-insensitively against Smartlead's campaign list, and created on
  // first visit to the Sending Email page if nothing matches. Changing this
  // value points the environment at a DIFFERENT campaign (creating it if
  // needed); it does not rename the old one.
  //
  // No default on purpose. Dev, staging and prod share one Smartlead key, so a
  // shared default would have a dev list run push scraped businesses into the
  // campaign production is actively sending. Unset → the Sending Email page
  // renders a setup prompt and no list run can start.
  OUTREACH_CAMPAIGN_NAME: z.string().trim().min(1).optional(),
  // Smartlead does NOT sign its webhook callbacks, so the callback URL itself is
  // the credential: /api/outreach/webhook/<secret>. Anyone who learns the URL can
  // forge events. Unset → the webhook endpoint refuses every request.
  OUTREACH_WEBHOOK_SECRET: z.string().optional(),
  // List building — Google Maps scrape, behind a provider seam so Outscraper is
  // a drop-in swap. Unset → the List Builder renders a setup prompt.
  APIFY_TOKEN: z.string().optional(),
  APIFY_MAPS_ACTOR_ID: z.string().default('compass~crawler-google-places'),
  OUTSCRAPER_API_KEY: z.string().optional(),
  // Where to ask "what regions are inside this one" — see region-hierarchy.ts.
  // Comma-separated, tried in order: the public overpass-api.de instance is
  // frequently saturated and answers 504 in under ten seconds, so a mirror
  // leads. No key, no account; the default is deliberately usable as-is.
  OVERPASS_URLS: z
    .string()
    .default(
      'https://overpass.kumi.systems/api/interpreter,' +
        'https://overpass.private.coffee/api/interpreter,' +
        'https://overpass.osm.ch/api/interpreter,' +
        'https://overpass-api.de/api/interpreter',
    ),
  // Email verification. MANDATORY before any address reaches Smartlead —
  // bounces are the fastest way to burn a domain — so an unset key blocks a
  // list run rather than silently skipping the gate.
  MILLIONVERIFIER_API_KEY: z.string().optional(),
  // The outreach twin of EMAIL_DEV_REDIRECT. Set it and EVERY outbound outreach
  // recipient is rewritten to this address on its way to Smartlead, with the
  // intended address logged beside it. That makes the whole pipeline — scrape,
  // verify, push, send, reply — exercisable end to end without a single
  // stranger receiving mail. Unset (the hosted default) → real addresses.
  //
  // Unlike EMAIL_DEV_REDIRECT this is NOT additionally gated on NODE_ENV. The
  // mailer gates because staging and production must reach real users; cold
  // outreach has no such obligation, and if this is ever left set somewhere it
  // shouldn't be, the failure is "our test mail piled into one inbox", which is
  // recoverable. Gating it would make the failure "we thought we were safe and
  // weren't", which is not.
  OUTREACH_DEV_REDIRECT: z.string().email().optional(),
  // ── Hosted frontend origins (bare hosts, no scheme) ───────────────────────
  // Mirror of the client-side list in packages/shared/src/lib/env.ts. Every
  // frontend belongs here: the deploy pushes all of them to the backend and
  // redirector (see .railway/envs/server/*.env), and zod SILENTLY STRIPS any it
  // does not declare — an origin missing here is simply unreadable server-side.
  VITE_APP_PRODESK_ORIGIN: z.string().default('app.prodesk.com'),
  VITE_DASHBOARD_PRODESK_ORIGIN: z.string().default('dashboard.prodesk.com'),
  VITE_LINKS_PRODESK_ORIGIN: z.string().default('links.prodesk.com'),
  VITE_REDIRECTOR_PRODESK_ORIGIN: z.string().default('url.prodesk.com'),
  VITE_REVIEWS_PRODESK_ORIGIN: z.string().default('reviews.prodesk.com'),
  VITE_PAYMENTS_PRODESK_ORIGIN: z.string().default('payments.prodesk.com'),
  VITE_SIGNATURES_PRODESK_ORIGIN: z.string().default('signatures.prodesk.com'),
  VITE_JOBS_PRODESK_ORIGIN: z.string().default('jobs.prodesk.com'),
  VITE_WEBSITES_PRODESK_ORIGIN: z.string().default('websites.prodesk.com'),
  VITE_DESIGN_PRODESK_ORIGIN: z.string().default('design.prodesk.com'),
  VITE_LOGO_PRODESK_ORIGIN: z.string().default('logo.prodesk.com'),
  VITE_CHAT_PRODESK_ORIGIN: z.string().default('chat.prodesk.com'),
});

/**
 * Wise's webhook-signing PUBLIC key (sandbox vs live), used to verify inbound
 * payout webhooks. Not a secret and not configurable — Wise publishes it at
 * https://docs.wise.com/guides/developer/webhooks/event-handling
 */
const getWiseWebhook = (isProd: boolean) =>
  isProd
    ? `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvO8vXV+JksBzZAY6GhSO
XdoTCfhXaaiZ+qAbtaDBiu2AGkGVpmEygFmWP4Li9m5+Ni85BhVvZOodM9epgW3F
bA5Q1SexvAF1PPjX4JpMstak/QhAgl1qMSqEevL8cmUeTgcMuVWCJmlge9h7B1CS
D4rtlimGZozG39rUBDg6Qt2K+P4wBfLblL0k4C4YUdLnpGYEDIth+i8XsRpFlogx
CAFyH9+knYsDbR43UJ9shtc42Ybd40Afihj8KnYKXzchyQ42aC8aZ/h5hyZ28yVy
Oj3Vos0VdBIs/gAyJ/4yyQFCXYte64I7ssrlbGRaco4nKF3HmaNhxwyKyJafz19e
HwIDAQAB
-----END PUBLIC KEY-----
`
    : `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwpb91cEYuyJNQepZAVfP
ZIlPZfNUefH+n6w9SW3fykqKu938cR7WadQv87oF2VuT+fDt7kqeRziTmPSUhqPU
ys/V2Q1rlfJuXbE+Gga37t7zwd0egQ+KyOEHQOpcTwKmtZ81ieGHynAQzsn1We3j
wt760MsCPJ7GMT141ByQM+yW1Bx+4SG3IGjXWyqOWrcXsxAvIXkpUD/jK/L958Cg
nZEgz0BSEh0QxYLITnW1lLokSx/dTianWPFEhMC9BgijempgNXHNfcVirg1lPSyg
z7KqoKUN0oHqWLr2U1A+7kqrl6O2nx3CKs1bj1hToT1+p4kcMoHXA7kA+VBLUpEs
VwIDAQAB
-----END PUBLIC KEY-----
`;
// On Railway, the service's public URL is auto-injected as RAILWAY_PUBLIC_DOMAIN
// (e.g. "prodesk-mono-production.up.railway.app"). Use it as the default origin
// so deploys work — for CORS and emailed redirect links — without having to set
// SERVER_ORIGIN by hand. An explicitly-set value still wins.
if (process.env.RAILWAY_PUBLIC_DOMAIN) {
  const railwayOrigin = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  process.env.SERVER_ORIGIN ??= railwayOrigin;
}

export const isProd = process.env.NODE_ENV === 'production';
export const isDev = process.env.NODE_ENV === 'development';
// The backend is hosted separately from the SPA only when the client was built
// against an explicit API origin (VITE_API_URL). When that's unset the SPA talks
// to its own origin (see client/src/lib/trpc.ts), so this same server must serve
// the built client HTML. SERVER_ORIGIN can't be the signal here — it always has a
// value (Railway domain / localhost default), which would wrongly disable static
// serving and surface "Cannot GET /".
export const isBackendHostedSeperately = !!process.env.VITE_API_URL;
export const env = schema.parse(process.env);
/** Wise's published webhook-signing public key for the current environment. */
export const WISE_WEBHOOK_PUBLIC_KEY = getWiseWebhook(isProd);
