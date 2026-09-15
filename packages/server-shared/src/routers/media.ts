import { z } from 'zod';
import { router, protectedProcedure } from '../trpc/trpc.js';
import { videoQueue } from '../jobs/queues.js';
import { supabaseAdmin } from '../lib/supabase.js';

/** The fixed set of storage buckets the app uses (must match the client StorageBucket enum). */
const KNOWN_BUCKETS = ['project-files', 'brand-files', 'chat-files', 'resources', 'uploads'] as const;

/**
 * Media post-processing + storage provisioning. Uploads go directly from the
 * client to Supabase Storage; the client calls `enqueueVideoTranscode` so the
 * worker can faststart-optimize videos, and `ensureBucket` (secret key) to
 * create a missing bucket on demand — the client can't create buckets itself.
 */
export const mediaRouter = router({
  /** Idempotently create a known storage bucket (public). Called by the client when an upload hits "Bucket not found". */
  ensureBucket: protectedProcedure
    .input(z.object({ bucket: z.enum(KNOWN_BUCKETS) }))
    .mutation(async ({ input }) => {
      const { error } = await supabaseAdmin.storage.createBucket(input.bucket, { public: true });
      // "already exists" is the success path (idempotent).
      if (error && !/exist/i.test(error.message)) {
        console.error('[media] ensureBucket failed', input.bucket, error.message);
        return { ok: false as const, error: error.message };
      }
      return { ok: true as const, error: null };
    }),

  enqueueVideoTranscode: protectedProcedure
    .input(z.object({ bucket: z.string().min(1), path: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        await videoQueue.add('transcode', input, { removeOnComplete: true, attempts: 2 });
      } catch (err) {
        console.error('[media] failed to enqueue transcode', (err as Error).message);
      }
      return { ok: true };
    }),
});
