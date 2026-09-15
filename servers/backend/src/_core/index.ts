import express from 'express';
import cors from 'cors';
import * as Sentry from '@sentry/node';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appRouter } from '@prodesk/server-shared/trpc/router';
import { createContext } from '@prodesk/server-shared/trpc/context';
import { env, isDev, isBackendHostedSeperately } from '@prodesk/server-shared/lib/env';
import { runMigrations } from '@prodesk/server-shared/db/auto-migrate';
import { applyRls } from '@prodesk/server-shared/db/apply-rls';
import { runInitialization } from '../scripts/initialize-core.js';
import { stripeWebhookHandler } from '@prodesk/server-shared/modules/stripe/webhook';
import { mountBullBoard } from '@prodesk/server-shared/jobs/board';
import { mountPartnerApi } from '@prodesk/server-shared/modules/partner/api';
import { mountAiApi } from '@prodesk/server-shared/modules/ai/http';
import { mountOutreachWebhook } from '@prodesk/server-shared/modules/outreach/webhook';
import { finalizeSoftDelete, finalizeCompletion } from '@prodesk/server-shared/routers/projects';
import { handleUnsubscribe } from '@prodesk/server-shared/modules/email/unsubscribe';
import { mountReviewPublicRoutes } from '@prodesk/server-shared/modules/reviews/public-routes';
import { mountPaymentsRoutes } from '@prodesk/server-shared/modules/payments/http';
import {
  paypalPayoutWebhook,
  wisePayoutWebhook,
} from '@prodesk/server-shared/modules/billing/payout-webhooks';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

if (env.SENTRY_DSN)
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV });

const app = express();
// Reflect the request's Origin header (effectively "allow all origins") so
// preview/dev hosts (tunnels, Manus/Onlook sandboxes, etc.) can reach the API.
// `origin: true` echoes the caller's origin back in Access-Control-Allow-Origin,
// which — unlike `origin: '*'` — stays compatible with `credentials: true`.
app.use(cors({ origin: true, credentials: true }));

// Webhooks need the raw body for signature verification — mount BEFORE json().
const raw = express.raw({ type: '*/*' });
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  stripeWebhookHandler,
);
app.post('/webhooks/paypal', raw, paypalPayoutWebhook);
app.post('/webhooks/wise', raw, wisePayoutWebhook);

// 10mb (not the 100kb default): base64 image uploads (member photos, brand
// logos) ride the tRPC JSON body. A 2mb file inflates to ~2.7mb base64, and the
// default limit made Express return a plaintext 413 that the tRPC client then
// failed to JSON.parse ("unexpected character at line 1 column 1").
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, env: env.NODE_ENV }));

// Public partner REST API (X-API-Key gated).
mountPartnerApi(app);

// Public Reviews (Verdiict) embed widget + directory badge (framed anywhere).
mountReviewPublicRoutes(app);

// Payments (EziQuotes) HTTP surface: proposal PDFs/receipts, asset uploads,
// Twilio + Postmark webhooks, Stripe Connect / Xero / MYOB / Pipedrive OAuth.
mountPaymentsRoutes(app);

// Per-brand AI assistant — streamed (SSE) replies. Auth via Bearer (Supabase JWT)
// inside the handler. Mounted before tRPC; the SPA fallback skips `/api`.
mountAiApi(app);

// Outreach — Smartlead event callbacks. Smartlead does not sign its webhooks,
// so the URL itself carries the shared secret (OUTREACH_WEBHOOK_SECRET) and is
// treated as a credential. Idempotent on a synthetic event key.
mountOutreachWebhook(app);

// Brand confirms a project cancellation/refund from an emailed link
// (brandConfirmSoftDeleteProject). Token-authenticated; no login required.
app.get('/confirm/soft-delete', async (req, res) => {
  const projectId = String(req.query.projectId ?? '');
  const token = String(req.query.token ?? '');
  const ok =
    projectId && token
      ? await finalizeSoftDelete(projectId, token).catch(() => false)
      : false;
  res.redirect(
    `${env.SERVER_ORIGIN}/?cancellation=${ok ? 'confirmed' : 'invalid'}`,
  );
});

// Brand approves project completion ("Complete & Release") from an emailed link.
// Token-authenticated; no login required. On success the brand lands on a
// standalone public confirmation page (NOT the app) — see /confirm/result.
app.get('/confirm/complete', async (req, res) => {
  const projectId = String(req.query.projectId ?? '');
  const token = String(req.query.token ?? '');
  const ok =
    projectId && token
      ? await finalizeCompletion(projectId, token).catch(() => false)
      : false;
  // Redirect (not render) so the one-time token drops out of the address bar.
  res.redirect(`/confirm/result?status=${ok ? 'success' : 'invalid'}`);
});

// Standalone public confirmation page shown after a brand approves completion
// from the emailed link. Self-contained HTML — never loads the SPA.
app.get('/confirm/result', (req, res) => {
  const ok = String(req.query.status ?? '') === 'success';
  const heading = ok ? 'Payment Successful' : 'Link Invalid or Expired';
  const message = ok
    ? 'Thank you. The project has been marked complete and the payment has been released to the agency. You can safely close this window.'
    : 'This confirmation link is no longer valid — it may have already been used or expired. Please contact the agency if you need help.';
  const accent = ok ? '#16A34A' : '#DC2626';
  const icon = ok ? '&#10003;' : '&#33;';
  res.status(ok ? 200 : 410).type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#F5F6FA;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F5F6FA;min-height:100vh;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #E5E7EB;">
          <tr>
            <td style="padding:48px 40px;text-align:center;">
              <div style="width:72px;height:72px;border-radius:50%;background:${accent};color:#ffffff;font-size:36px;line-height:72px;margin:0 auto 24px;">${icon}</div>
              <h1 style="margin:0 0 12px;font-size:24px;font-weight:700;color:#111827;">${heading}</h1>
              <p style="margin:0;font-size:15px;color:#6B7280;line-height:1.6;">${message}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`);
});

// Recipient opts out of an email channel from an emailed footer link
// (ports functions `unsubscribe`). Token-less; only ever adds a suppression.
app.get('/unsubscribe', handleUnsubscribe);

// BullMQ dashboard (guard behind auth/admin in production).
mountBullBoard(app, '/admin/queues');

app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: isDev
      ? ({ path, error }) => {
          console.error(`tRPC error on ${path ?? '<no-path>'}:`, error.message);
          // error.message is often just a wrapper (e.g. drizzle's "Failed query:
          // …"); the real reason lives on the cause chain — the driver error with
          // the Postgres message + code/detail/hint. Walk it so the log says WHY.
          let cause: unknown = error.cause;
          for (let depth = 0; cause && depth < 5; depth++) {
            const c = cause as { message?: string; code?: string; detail?: string; hint?: string; cause?: unknown };
            const parts = [c.message, c.code && `[${c.code}]`, c.detail, c.hint && `hint: ${c.hint}`].filter(Boolean);
            if (parts.length) console.error('  ↳ caused by:', parts.join(' '));
            cause = c.cause;
          }
        }
      : undefined,
  }),
);

if (env.SENTRY_DSN) Sentry.setupExpressErrorHandler(app);

if (!isBackendHostedSeperately) {
  const clientDist = path.resolve(__dirname, '../../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/trpc') ||
      req.path.startsWith('/api') ||
      req.path.startsWith('/webhooks') ||
      req.path.startsWith('/confirm') ||
      req.path.startsWith('/unsubscribe') ||
      req.path.startsWith('/admin') ||
      req.path.startsWith('/embed') ||
      req.path.startsWith('/badge') ||
      req.path.startsWith('/health')
    ) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Bring the schema up to date before accepting traffic. Fail fast on error —
// serving against a stale/partial schema is worse than not starting.
if (env.AUTO_MIGRATE) {
  try {
    await runMigrations();
  } catch (err) {
    console.error('✖ Database migration failed — aborting startup.');
    console.error(err);
    process.exit(1);
  }
  // RLS / realtime / storage policies (Drizzle doesn't manage these). Idempotent,
  // so it runs every boot. Non-fatal: a failure degrades realtime/storage but
  // shouldn't take the API down — log loudly and carry on.
  try {
    await applyRls();
  } catch (err) {
    console.error(
      '⚠ Failed to apply RLS/realtime policies (sql/rls.sql) — realtime may be inactive until applied manually. Continuing startup.',
    );
    console.error(err);
  }
  // Seed/repair the baseline rows the app can't run without — super-admin, global
  // settings, and the built-in feature-subscription products (Growth Strategy, URL
  // Shortener) with an active price each. Runs AFTER migrations so the tables it
  // writes to already exist. Idempotent by contract (see scripts/initialize-core.ts),
  // so running it on every boot is safe. Non-fatal: a Supabase/DB hiccup here must
  // not keep the API down — log and carry on, the same policy as applyRls.
  try {
    await runInitialization();
  } catch (err) {
    console.error(
      '⚠ Stack initialization (scripts/initialize-core.ts) failed — baseline data may be incomplete. Continuing startup.',
    );
    console.error(err);
  }
}

app.listen(env.PORT, () => {
  console.log(`▸ Prodesk API on http://localhost:${env.PORT}  (tRPC: /trpc)`);
  console.log(`Maybe client on  ➜  Local:   http://localhost:5173/`);
});
