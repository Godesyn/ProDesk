import type { Request, Response } from 'express';
import * as crypto from 'node:crypto';
import { env, isProd, WISE_WEBHOOK_PUBLIC_KEY } from '../../lib/env.js';
import { markPayoutReceived, markPayoutFailed } from './dispatch.js';

/**
 * Verified payout-provider webhooks (PayPal / Wise). Each route is
 * mounted with a raw body so signatures can be checked, then maps the provider
 * event to markPayoutReceived / markPayoutFailed by transaction id. Ports
 * functions/src/modules/billing/payout_webhooks.ts.
 */

function rawText(req: Request): string {
  return Buffer.isBuffer(req.body) ? req.body.toString('utf8') : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
}

/* ── PayPal ─────────────────────────────────────────────────────────────── */
const PAYPAL_BASE = isProd ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

async function verifyPaypal(req: Request, body: unknown): Promise<boolean> {
  const id = env.PAYPAL_CLIENT_ID;
  const secret = env.PAYPAL_CLIENT_SECRET;
  const webhookId = env.PAYPAL_WEBHOOK_ID;
  if (!id || !secret || !webhookId) return false; // cannot verify → reject
  const tokenRes = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!tokenRes.ok) return false;
  const token = ((await tokenRes.json()) as { access_token: string }).access_token;
  const verifyRes = await fetch(`${PAYPAL_BASE}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: req.headers['paypal-auth-algo'],
      cert_url: req.headers['paypal-cert-url'],
      transmission_id: req.headers['paypal-transmission-id'],
      transmission_sig: req.headers['paypal-transmission-sig'],
      transmission_time: req.headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: body,
    }),
  });
  if (!verifyRes.ok) return false;
  return ((await verifyRes.json()) as { verification_status?: string }).verification_status === 'SUCCESS';
}

export async function paypalPayoutWebhook(req: Request, res: Response): Promise<void> {
  try {
    const body = JSON.parse(rawText(req)) as { event_type?: string; resource?: { batch_header?: { payout_batch_id?: string }; payout_batch_id?: string } };
    if (!(await verifyPaypal(req, body))) { res.status(401).send('Invalid signature'); return; }
    const batchId = body.resource?.batch_header?.payout_batch_id ?? body.resource?.payout_batch_id;
    if (!batchId) { res.status(400).send('No payout_batch_id'); return; }
    const e = body.event_type ?? '';
    if (e === 'PAYMENT.PAYOUTSBATCH.SUCCESS' || e === 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED') await markPayoutReceived(batchId);
    else if (/FAILED|DENIED|CANCELED|RETURNED/.test(e)) await markPayoutFailed(batchId);
    res.json({ received: true });
  } catch (err) {
    res.status(500).send((err as Error).message);
  }
}

/* ── Wise (RSA signature with the Wise public key) ──────────────────────── */
export async function wisePayoutWebhook(req: Request, res: Response): Promise<void> {
  try {
    if (req.headers['x-test-notification'] === 'true') { res.status(200).send('OK'); return; }
    const signature = req.headers['x-signature-sha256'] as string | undefined;
    const publicKey = WISE_WEBHOOK_PUBLIC_KEY; // Wise public key (PEM)
    const raw = rawText(req);
    if (!signature || !publicKey) { res.status(401).send('Missing signature/key'); return; }
    const verified = crypto.verify('sha256', Buffer.from(raw), publicKey, Buffer.from(signature, 'base64'));
    if (!verified) { res.status(401).send('Invalid signature'); return; }

    const body = JSON.parse(raw) as { data?: { resource?: { id?: number | string }; current_state?: string } };
    const transferId = body.data?.resource?.id != null ? String(body.data.resource.id) : null;
    const state = body.data?.current_state;
    if (transferId) {
      if (state === 'outgoing_payment_sent') await markPayoutReceived(transferId);
      else if (state === 'cancelled' || state === 'refunded') await markPayoutFailed(transferId);
    }
    res.json({ received: true });
  } catch (err) {
    res.status(500).send((err as Error).message);
  }
}
