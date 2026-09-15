/**
 * Payments (EziQuotes) webhook queue worker — delivers ad-hoc outbound webhooks
 * with retry (BullMQ backoff drives the retries; a non-2xx response throws so
 * the job is retried). Ported from the Manus export's server/webhookWorker.ts.
 * Called by the BullMQ worker registered in modules/payments/queues.ts.
 */

interface WebhookPayload {
  url: string;
  event: string;
  data: Record<string, unknown>;
  brandId: string;
  attemptNumber?: number;
}

export async function deliverWebhook(payload: WebhookPayload): Promise<void> {
  const { url, event, data } = payload;

  const body = JSON.stringify({ event, data, timestamp: new Date().toISOString() });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-EziQuotes-Event': event,
      'User-Agent': 'EziQuotes-Webhooks/1.0',
    },
    body,
    signal: AbortSignal.timeout(10_000), // 10s timeout
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status} ${response.statusText} → ${url}`);
  }
}
