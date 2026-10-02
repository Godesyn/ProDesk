import { supabaseAdmin } from './supabase.js';

/** The fixed set of storage buckets the app uses (must match the client StorageBucket enum). */
export const KNOWN_BUCKETS = ['project-files', 'brand-files', 'chat-files', 'resources', 'uploads'] as const;
export type KnownBucket = (typeof KNOWN_BUCKETS)[number];

/** Idempotently create a storage bucket (public). "Already exists" counts as success. */
export async function ensureBucket(bucket: KnownBucket): Promise<string | null> {
  const { error } = await supabaseAdmin.storage.createBucket(bucket, { public: true });
  return error && !/exist/i.test(error.message) ? error.message : null;
}

/**
 * Create every known bucket. Called at backend boot: server-side uploads
 * (brand kit, signatures, logo, payments) write straight to a bucket and fail
 * with "Bucket not found" on a fresh Supabase project otherwise.
 */
export async function ensureKnownBuckets(): Promise<void> {
  const errors = await Promise.all(KNOWN_BUCKETS.map(ensureBucket));
  errors.forEach((e, i) => e && console.error('[storage] ensureBucket failed', KNOWN_BUCKETS[i], e));
}
