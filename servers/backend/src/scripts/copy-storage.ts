/**
 * Copy ALL Supabase Storage objects from one project to another.
 *
 * Standalone / self-contained: reads OLD_* and NEW_* creds straight from the
 * environment (not the app env module), so the source and destination projects
 * are kept explicit and separate. Buckets are recreated on the destination with
 * the same name + public/private setting before objects are copied. Idempotent:
 * uploads use upsert, so re-running resumes/repairs a partial copy.
 *
 * Usage (PowerShell):
 *   $env:OLD_SUPABASE_URL="https://fqukgfxmzocnbjmbxflp.supabase.co"
 *   $env:OLD_SUPABASE_SECRET_KEY="sb_secret_..."
 *   $env:NEW_SUPABASE_URL="https://<NEWREF>.supabase.co"
 *   $env:NEW_SUPABASE_SECRET_KEY="sb_secret_..."
 *   bun run servers/backend/src/scripts/copy-storage.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const OLD_URL = process.env.OLD_SUPABASE_URL!;
const OLD_KEY = process.env.OLD_SUPABASE_SECRET_KEY!;
const NEW_URL = process.env.NEW_SUPABASE_URL!;
const NEW_KEY = process.env.NEW_SUPABASE_SECRET_KEY!;

for (const [k, v] of Object.entries({ OLD_URL, OLD_KEY, NEW_URL, NEW_KEY })) {
  if (!v) {
    console.error(`Missing env: ${k}`);
    process.exit(1);
  }
}

const auth = { persistSession: false, autoRefreshToken: false } as const;
const oldClient = createClient(OLD_URL, OLD_KEY, { auth });
const newClient = createClient(NEW_URL, NEW_KEY, { auth });

// Recursively list every object path in a bucket (supabase `.list()` is one
// folder level at a time; folder entries come back with a null `id`).
async function listAll(client: SupabaseClient, bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  const limit = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) out.push(...(await listAll(client, bucket, path)));
      else out.push(path);
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

const { data: buckets, error: bErr } = await oldClient.storage.listBuckets();
if (bErr) throw new Error(`listBuckets: ${bErr.message}`);

console.log(`Found ${buckets.length} bucket(s) on OLD project: ${buckets.map((b) => b.name).join(', ')}`);

let grandCopied = 0;
let grandFailed = 0;

for (const b of buckets) {
  console.log(`\n=== Bucket: ${b.name} (public=${b.public}) ===`);
  const { error: createErr } = await newClient.storage.createBucket(b.name, {
    public: b.public,
    fileSizeLimit: b.file_size_limit ?? undefined,
    allowedMimeTypes: b.allowed_mime_types ?? undefined,
  });
  if (createErr && !/already exists/i.test(createErr.message)) {
    console.error(`  createBucket failed: ${createErr.message}`);
  }

  const paths = await listAll(oldClient, b.name);
  console.log(`  ${paths.length} object(s)`);
  let copied = 0;
  let failed = 0;
  for (const path of paths) {
    const { data: blob, error: dErr } = await oldClient.storage.from(b.name).download(path);
    if (dErr || !blob) {
      console.error(`  ✗ download ${path}: ${dErr?.message ?? 'no data'}`);
      failed++;
      continue;
    }
    const buf = Buffer.from(await blob.arrayBuffer());
    const { error: uErr } = await newClient.storage.from(b.name).upload(path, buf, {
      contentType: blob.type || 'application/octet-stream',
      upsert: true,
    });
    if (uErr) {
      console.error(`  ✗ upload ${path}: ${uErr.message}`);
      failed++;
      continue;
    }
    copied++;
    if (copied % 50 === 0) console.log(`  ...${copied}/${paths.length}`);
  }
  console.log(`  done: ${copied} copied, ${failed} failed`);
  grandCopied += copied;
  grandFailed += failed;
}

console.log(`\n✅ storage copy complete — ${grandCopied} copied, ${grandFailed} failed`);
process.exit(grandFailed > 0 ? 1 : 0);
