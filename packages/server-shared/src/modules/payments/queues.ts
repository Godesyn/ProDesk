/**
 * Payments (EziQuotes) BullMQ queue definitions and worker registration.
 *
 * Ported from the Manus export's server/queues.ts, re-expressed on the
 * platform's shared Redis connection (jobs/queues.ts). Unlike the export,
 * Redis is always configured here, so the queues are always live (no null
 * no-op mode). Queue names carry a `payments-` prefix to avoid colliding
 * with the platform's own queues.
 *
 * Queue names:
 *   payments-sms       — outbound SMS (quiet-hours scheduling, opt-out checks)
 *   payments-email     — transactional email (per-account Postmark)
 *   payments-chase     — automated payment chase sequences
 *   payments-webhook   — outbound webhook delivery with retry
 *   payments-sequence  — cold/engagement/missed_payment touchpoints
 *
 * Usage from tRPC procedures / webhook handlers:
 *   import { smsQueue, emailQueue, chaseQueue, webhookQueue } from '../../modules/payments/queues.js';
 *   await smsQueue.add('send', payload, { delay: msUntil8am });
 *
 * `startPaymentsWorkers()` (rename of the export's startWorkers) registers the
 * BullMQ Workers — the backend worker process calls it once at boot.
 */
import { Queue, QueueEvents, Worker } from 'bullmq';
import { connection } from '../../jobs/queues.js';
import { attachWorkerLogging } from '../../lib/errors.js';

// ── Queues ────────────────────────────────────────────────────────────────────

export const smsQueue = new Queue('payments-sms', { connection });
export const emailQueue = new Queue('payments-email', { connection });
export const chaseQueue = new Queue('payments-chase', { connection });
export const webhookQueue = new Queue('payments-webhook', { connection });
export const sequenceQueue = new Queue('payments-sequence', { connection });

// ── Queue events (for health reporting) ──────────────────────────────────────

export const queueEvents: Record<string, QueueEvents | null> = {
  smsQueue: new QueueEvents('payments-sms', { connection }),
  emailQueue: new QueueEvents('payments-email', { connection }),
  chaseQueue: new QueueEvents('payments-chase', { connection }),
  webhookQueue: new QueueEvents('payments-webhook', { connection }),
  sequenceQueue: new QueueEvents('payments-sequence', { connection }),
};

// ── Health snapshot ───────────────────────────────────────────────────────────

export async function getQueueHealth() {
  const snapshot = async (q: Queue, name: string) => {
    const [waiting, active, failed, completed] = await Promise.all([
      q.getWaitingCount(),
      q.getActiveCount(),
      q.getFailedCount(),
      q.getCompletedCount(),
    ]);
    return { name, waiting, active, failed, completed };
  };

  const [sm, em, ch, wh, sq] = await Promise.all([
    snapshot(smsQueue, 'payments-sms'),
    snapshot(emailQueue, 'payments-email'),
    snapshot(chaseQueue, 'payments-chase'),
    snapshot(webhookQueue, 'payments-webhook'),
    snapshot(sequenceQueue, 'payments-sequence'),
  ]);

  return {
    configured: true,
    redisStatus: 'Redis connected',
    smsQueue: sm,
    emailQueue: em,
    chaseQueue: ch,
    webhookQueue: wh,
    sequenceQueue: sq,
  };
}

// ── Workers ───────────────────────────────────────────────────────────────────

let workersStarted = false;

export function startPaymentsWorkers() {
  if (workersStarted) return;
  workersStarted = true;

  // SMS worker — sends queued SMS messages
  attachWorkerLogging(new Worker(
    'payments-sms',
    async (job) => {
      if (job.name === 'send') {
        const { sendSms } = await import('./sms.js');
        const { to, body, brandId } = job.data as { to: string; body: string; brandId: string };
        await sendSms({ to, body, brandId });
      }
    },
    { connection, concurrency: 5 },
  ), 'payments-sms');

  // Email worker — sends queued emails via the payments mailer (per-account Postmark)
  attachWorkerLogging(new Worker(
    'payments-email',
    async (job) => {
      if (job.name === 'send') {
        const { sendEmail } = await import('./email.js');
        await sendEmail(job.data);
      }
    },
    { connection, concurrency: 10 },
  ), 'payments-email');

  // Chase worker — processes payment chase sequence steps
  attachWorkerLogging(new Worker(
    'payments-chase',
    async (job) => {
      if (job.name === 'step') {
        const { processChaseStep } = await import('./chase-worker.js');
        await processChaseStep(job.data);
      }
    },
    { connection, concurrency: 3 },
  ), 'payments-chase');

  // Webhook worker — delivers outbound webhooks with exponential backoff
  attachWorkerLogging(new Worker(
    'payments-webhook',
    async (job) => {
      if (job.name === 'deliver') {
        const { deliverWebhook } = await import('./webhook-worker.js');
        await deliverWebhook(job.data);
      }
    },
    {
      connection,
      concurrency: 5,
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      settings: {
        backoffStrategy: (attemptsMade) => Math.min(1000 * Math.pow(2, attemptsMade), 30000),
      },
    },
  ), 'payments-webhook');

  // Sequence worker — processes cold/engagement/missed_payment touchpoints
  attachWorkerLogging(new Worker(
    'payments-sequence',
    async (job) => {
      if (job.name === 'fire_touchpoint') {
        const { fireTouchpoint } = await import('./sequence-worker.js');
        await fireTouchpoint(job.data);
      } else if (job.name === 'schedule_cold') {
        const { scheduleColdSequence } = await import('./sequence-worker.js');
        await scheduleColdSequence(job.data);
      } else if (job.name === 'evaluate_engagement') {
        const { evaluateEngagement } = await import('./sequence-worker.js');
        await evaluateEngagement(job.data);
      } else if (job.name === 'handle_missed_payment') {
        const { handleMissedPayment } = await import('./sequence-worker.js');
        await handleMissedPayment(job.data);
      }
    },
    { connection, concurrency: 3 },
  ), 'payments-sequence');

  // Scheduled sweeps — replaces the export's Manus heartbeat crons
  // (references/periodic-updates.md). Job names map 1:1 to modules/payments/scheduled.ts.
  attachWorkerLogging(new Worker(
    'payments-scheduled',
    async (job) => {
      const scheduled = await import('./scheduled.js');
      switch (job.name) {
        case 'installment-reminders':
          return scheduled.runInstallmentReminders();
        case 'installment-auto-charge':
          return scheduled.runInstallmentAutoCharge();
        case 'auto-chase':
          return scheduled.runAutoChase();
        case 'recurring-invoices':
          return scheduled.runRecurringInvoiceSender();
        case 'webhook-retries':
          return scheduled.runWebhookRetries();
        case 'sequence-sweep':
          return scheduled.runSequenceSweep();
        default:
          return;
      }
    },
    { connection, concurrency: 1 },
  ), 'payments-scheduled');

  console.log(
    '[BullMQ] Payments workers started: payments-sms, payments-email, payments-chase, payments-webhook, payments-sequence, payments-scheduled',
  );
}

// ── Repeatable schedules ──────────────────────────────────────────────────────

export const scheduledQueue = new Queue('payments-scheduled', { connection });

/**
 * Register the payments cron repeatables (idempotent on jobId — BullMQ upserts
 * repeatables by name+pattern). Cadences follow the export's heartbeat crons:
 * auto-chase daily 09:00 UTC, recurring invoices daily 08:00 UTC, installment
 * reminders + auto-charge daily; the two sweeps the export lacked run every
 * 5–10 minutes. Called once at worker boot.
 */
export async function registerPaymentsRepeatables() {
  await scheduledQueue.add('auto-chase', {}, { repeat: { pattern: '0 9 * * *' }, jobId: 'payments-auto-chase' });
  await scheduledQueue.add('recurring-invoices', {}, { repeat: { pattern: '0 8 * * *' }, jobId: 'payments-recurring-invoices' });
  await scheduledQueue.add('installment-reminders', {}, { repeat: { pattern: '30 8 * * *' }, jobId: 'payments-installment-reminders' });
  await scheduledQueue.add('installment-auto-charge', {}, { repeat: { pattern: '0 10 * * *' }, jobId: 'payments-installment-auto-charge' });
  await scheduledQueue.add('webhook-retries', {}, { repeat: { pattern: '*/10 * * * *' }, jobId: 'payments-webhook-retries' });
  await scheduledQueue.add('sequence-sweep', {}, { repeat: { pattern: '*/5 * * * *' }, jobId: 'payments-sequence-sweep' });
}
