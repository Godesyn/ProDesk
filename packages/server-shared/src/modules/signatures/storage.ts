/**
 * Server-side asset storage for the SIGKITT signature builder. Replaces the
 * Manus export's Forge presigned-S3 `storagePut` with a direct Supabase Storage
 * upload (secret key, bypasses RLS) into the shared `brand-files` bucket under a
 * `signatures/<brandId>/…` key prefix. Returns the public URL — the same
 * `{ key, url }` contract the export used, so callers are unchanged.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';

const BUCKET = 'brand-files';

/** Strip a leading slash and append a short random suffix before the extension. */
function buildKey(brandId: string, relKey: string): string {
  const clean = relKey.replace(/^\/+/, '');
  const hash = randomUUID().replace(/-/g, '').slice(0, 8);
  const lastDot = clean.lastIndexOf('.');
  const withHash =
    lastDot === -1
      ? `${clean}_${hash}`
      : `${clean.slice(0, lastDot)}_${hash}${clean.slice(lastDot)}`;
  return `signatures/${brandId}/${withHash}`;
}

/**
 * Upload a buffer and return its public URL. `relKey` is a caller-friendly
 * relative path (e.g. `logos/acme.png`); it is namespaced under the brand and
 * given a random suffix so re-uploads never collide.
 */
export async function storagePut(
  brandId: string,
  relKey: string,
  data: Buffer | Uint8Array,
  contentType = 'application/octet-stream',
): Promise<{ key: string; url: string }> {
  const key = buildKey(brandId, relKey);
  const res = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, data, { contentType, upsert: true });
  if (res.error) throw res.error;
  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(key);
  return { key, url: pub.publicUrl };
}
