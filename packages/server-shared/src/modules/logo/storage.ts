/**
 * Server-side asset storage for Logo Studio — a direct Supabase Storage upload
 * (service key, bypasses RLS) into the shared `brand-files` bucket under a
 * `logos/<brandId>/…` key prefix. Same `{ key, url }` contract as the signatures
 * storage helper. SVGs are stored with `upsert` and their exact bytes.
 */
import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../lib/supabase.js';

const BUCKET = 'brand-files';

function buildKey(brandId: string, relKey: string): string {
  const clean = relKey.replace(/^\/+/, '');
  const hash = randomUUID().replace(/-/g, '').slice(0, 8);
  const lastDot = clean.lastIndexOf('.');
  const withHash =
    lastDot === -1
      ? `${clean}_${hash}`
      : `${clean.slice(0, lastDot)}_${hash}${clean.slice(lastDot)}`;
  return `logos/${brandId}/${withHash}`;
}

/** Upload a buffer under the brand's logo prefix and return its public URL. */
export async function putLogoAsset(
  brandId: string,
  relKey: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<{ key: string; url: string }> {
  const key = buildKey(brandId, relKey);
  const res = await supabaseAdmin.storage
    .from(BUCKET)
    .upload(key, data, { contentType, upsert: true });
  if (res.error) throw res.error;
  const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(key);
  return { key, url: pub.publicUrl };
}
