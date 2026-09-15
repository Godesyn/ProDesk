/**
 * Payments (EziQuotes) outbound webhook dispatcher.
 *
 * Delivers lifecycle events to vendor-configured HTTP endpoints.
 * Signs each payload with HMAC-SHA256 using the endpoint's secret.
 * Implements exponential back-off with up to 5 retry attempts, logging every
 * attempt to payment_outbound_webhook_deliveries.
 *
 * Ported from the Manus export's server/webhookDispatcher.ts (ids → uuid,
 * accountId → brandId; the wire headers keep the X-EziQuotes-* names so
 * existing vendor integrations continue to verify signatures).
 *
 * Usage:
 *   import { dispatchLifecycleEvent } from './webhook-dispatcher.js';
 *   await dispatchLifecycleEvent(db, { brandId, eventType, proposalId, data });
 */
import crypto from 'crypto';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { db as sharedDb } from '../../db/index.js';
import {
  paymentOutboundWebhookDeliveries,
  paymentWebhookEndpoints,
} from '../../db/schema.js';

type AnyDb = typeof sharedDb;

// ─── Types ──────────────────────────────────────────────────────────────────

export type LifecycleWebhookPayload = {
  id: string; // delivery UUID for idempotency
  event: string; // e.g. "lifecycle.defer_requested"
  proposalId: string | null;
  brandId: string;
  occurredAt: string; // ISO-8601
  data: Record<string, unknown>;
};

// ─── Retry schedule (seconds) ────────────────────────────────────────────────
// Attempt 1: immediate, 2: 30s, 3: 5min, 4: 30min, 5: 2h
const RETRY_DELAYS_SECONDS = [0, 30, 300, 1800, 7200];
const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length;

// ─── HMAC signing ────────────────────────────────────────────────────────────

function signPayload(secret: string, body: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── Core dispatch ───────────────────────────────────────────────────────────

/**
 * Fan-out a lifecycle event to all matching endpoints for a brand.
 * Each delivery is logged to payment_outbound_webhook_deliveries.
 * Runs fire-and-forget — caller does not await individual HTTP calls.
 */
export async function dispatchLifecycleEvent(
  db: AnyDb,
  opts: {
    brandId: string;
    eventType: string;
    proposalId?: string | null;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  const endpoints = await db
    .select()
    .from(paymentWebhookEndpoints)
    .where(
      and(
        eq(paymentWebhookEndpoints.brandId, opts.brandId),
        eq(paymentWebhookEndpoints.enabled, true),
      ),
    );

  if (endpoints.length === 0) return;

  const eventName = `lifecycle.${opts.eventType}`;
  const occurredAt = new Date().toISOString();

  for (const endpoint of endpoints) {
    // Check event filter
    if (endpoint.eventFilter) {
      const allowed = endpoint.eventFilter.split(',').map((s: string) => s.trim());
      if (!allowed.includes(opts.eventType) && !allowed.includes(eventName)) continue;
    }

    const deliveryId = crypto.randomUUID();
    const payload: LifecycleWebhookPayload = {
      id: deliveryId,
      event: eventName,
      proposalId: opts.proposalId ?? null,
      brandId: opts.brandId,
      occurredAt,
      data: opts.data ?? {},
    };

    // Insert delivery record
    const [delivery] = await db
      .insert(paymentOutboundWebhookDeliveries)
      .values({
        endpointId: endpoint.id,
        brandId: opts.brandId,
        eventType: opts.eventType,
        proposalId: opts.proposalId ?? null,
        payload,
        attempt: 1,
        status: 'pending',
      })
      .returning({ id: paymentOutboundWebhookDeliveries.id });

    // Fire async — do not block the tRPC response
    attemptDelivery(db, delivery.id, endpoint.url, endpoint.secret, payload, 1).catch((err) =>
      console.error(`[Webhook] Delivery ${delivery.id} failed:`, err),
    );
  }
}

// ─── HTTP attempt ────────────────────────────────────────────────────────────

async function attemptDelivery(
  db: AnyDb,
  deliveryId: string,
  url: string,
  secret: string,
  payload: LifecycleWebhookPayload,
  attempt: number,
): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  let httpStatus: number | null = null;
  let responseBody: string | null = null;
  let errorMessage: string | null = null;
  let success = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-EziQuotes-Signature': signature,
        'X-EziQuotes-Event': payload.event,
        'X-EziQuotes-Delivery': payload.id,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    httpStatus = res.status;
    responseBody = await res.text().catch(() => null);
    success = res.status >= 200 && res.status < 300;
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
  }

  if (success) {
    await db
      .update(paymentOutboundWebhookDeliveries)
      .set({
        status: 'success',
        httpStatus: httpStatus ?? undefined,
        responseBody: responseBody ?? undefined,
        deliveredAt: new Date(),
        attempt,
      })
      .where(eq(paymentOutboundWebhookDeliveries.id, deliveryId));
    return;
  }

  // Failed — schedule retry or abandon
  const nextAttempt = attempt + 1;
  if (nextAttempt > MAX_ATTEMPTS) {
    await db
      .update(paymentOutboundWebhookDeliveries)
      .set({
        status: 'abandoned',
        httpStatus: httpStatus ?? undefined,
        responseBody: responseBody ?? undefined,
        errorMessage: errorMessage ?? `HTTP ${httpStatus}`,
        attempt,
      })
      .where(eq(paymentOutboundWebhookDeliveries.id, deliveryId));
    return;
  }

  const delaySecs = RETRY_DELAYS_SECONDS[nextAttempt - 1] ?? 30;
  const nextRetryAt = new Date(Date.now() + delaySecs * 1000);

  await db
    .update(paymentOutboundWebhookDeliveries)
    .set({
      status: 'failed',
      httpStatus: httpStatus ?? undefined,
      responseBody: responseBody ?? undefined,
      errorMessage: errorMessage ?? `HTTP ${httpStatus}`,
      attempt,
      nextRetryAt,
    })
    .where(eq(paymentOutboundWebhookDeliveries.id, deliveryId));

  // Schedule retry (in-process fast path; retryPendingDeliveries is the durable
  // sweep that catches anything lost to a worker restart)
  setTimeout(() => {
    attemptDelivery(db, deliveryId, url, secret, payload, nextAttempt).catch((err) =>
      console.error(`[Webhook] Retry ${nextAttempt} for delivery ${deliveryId} failed:`, err),
    );
  }, delaySecs * 1000);
}

// ─── Retry pending deliveries (called by the scheduled sweep) ─────────────────

export async function retryPendingDeliveries(db: AnyDb): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(paymentOutboundWebhookDeliveries)
    .where(
      and(
        // 'pending' included so a manual retryDelivery (which resets the row to
        // pending) is picked up by the sweep — the export only swept 'failed',
        // leaving manual retries stranded.
        inArray(paymentOutboundWebhookDeliveries.status, ['pending', 'failed']),
        or(
          isNull(paymentOutboundWebhookDeliveries.nextRetryAt),
          lte(paymentOutboundWebhookDeliveries.nextRetryAt, now),
        ),
      ),
    )
    .limit(50);

  for (const delivery of due) {
    const endpoint = await db
      .select()
      .from(paymentWebhookEndpoints)
      .where(eq(paymentWebhookEndpoints.id, delivery.endpointId))
      .then((rows) => rows[0]);

    if (!endpoint) continue;

    const payload = delivery.payload as LifecycleWebhookPayload;
    attemptDelivery(db, delivery.id, endpoint.url, endpoint.secret, payload, delivery.attempt + 1).catch(
      (err) => console.error(`[Webhook] Retry for delivery ${delivery.id} failed:`, err),
    );
  }

  return due.length;
}
