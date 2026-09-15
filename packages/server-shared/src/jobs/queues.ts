import { Queue, type ConnectionOptions } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../lib/env.js';

// Shared ioredis instance. Cast to BullMQ's ConnectionOptions to sidestep the
// dual-package type clash between our ioredis and BullMQ's nested copy
// (identical at runtime).
const redisClient = new IORedis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
});
/** Raw ioredis client for ad-hoc keys (e.g. chat-digest debounce/rate-limit state). */
export const redis = redisClient;
export const connection = redisClient as unknown as ConnectionOptions;

/** Job queues — replace the Firebase scheduled functions & Firestore triggers. */
export const emailQueue = new Queue('email', { connection });
export const payoutQueue = new Queue('payout', { connection });
export const videoQueue = new Queue('video', { connection });
export const chatDigestQueue = new Queue('chat-digest', { connection });
export const kanbanQueue = new Queue('kanban', { connection });
export const proposalQueue = new Queue('proposal', { connection });
export const pendingPurchasesQueue = new Queue('pending-purchases', { connection });
/** Beta programme — the daily sweep that sends the 7/3/0-day "beta ending" notices. */
export const betaQueue = new Queue('beta', { connection });
export const shortLinksQueue = new Queue('short-links', { connection });
/** Outreach — bulk Smartlead operations (cap fan-out, lead upload) never run inline. */
export const outreachQueue = new Queue('outreach', { connection });

export const queues = [emailQueue, payoutQueue, videoQueue, chatDigestQueue, kanbanQueue, proposalQueue, pendingPurchasesQueue, betaQueue, shortLinksQueue, outreachQueue];
