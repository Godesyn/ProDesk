/**
 * One-time backfill: restore the legacy SIGKITT social-icon PNGs that the Manus
 * export MISSED.
 *
 * Old email signatures embed absolute `<img src>` URLs of the form
 *   https://signatures.noize.com.au/manus-storage/icons/<key>_<hex>_<suffix>.png
 * (e.g. `.../icons/facebook_ffffff_087a63c3.png`). The signatures frontend's
 * legacyStorageRedirect() plugin 301s `/manus-storage/<key>` to
 *   brand-files/signatures/legacy/<key>
 * in Supabase Storage — but the migration script only mirrored files that were
 * physically present in the export. The rendered social-icon PNGs were NOT
 * exported (see db-export/migration-report.md §3), so `signatures/legacy/icons/*`
 * 404s and those icons are broken in every already-sent email.
 *
 * The icons are, however, fully reproducible: each legacy filename encodes its
 * icon key + hex colour (`<key>_<hex>_<suffix>.png`), and the content is just the
 * bundled SVG (icons.ts / ICON_SVGS) recoloured to that hex and rasterised to a
 * 32×32 PNG — identical to the legacy iconColorizer. The trailing `<suffix>` is
 * an arbitrary storage-unique hash, so many filenames share one rendered image —
 * and emails in the wild reference suffixes that this DB export never captured
 * (e.g. facebook_ffffff_087a63c3.png isn't in all-tables.json at all).
 *
 * So we don't chase suffixes. legacyStorageRedirect() now collapses every
 * `icons/<key>_<hex>_<suffix>.png` to a canonical `icons/<key>_<hex>.png`, and
 * this script uploads exactly ONE render per (key, colour) combo found in the
 * export under `signatures/legacy/icons/<key>_<hex>.png` (upsert, idempotent).
 * After both land, every old icon URL — any suffix, past or future — resolves.
 *
 * Usage (run from servers/backend):
 *   npx tsx src/scripts/regenerate-legacy-icons.ts --prod            # dry run
 *   npx tsx src/scripts/regenerate-legacy-icons.ts --prod --apply    # execute
 */
import './env-setup.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { supabaseAdmin } from '@prodesk/server-shared/lib/supabase';
import { renderColoredIconPng } from '@prodesk/server-shared/modules/signatures/iconColorizer';
import {
  ICON_KEYS,
  type IconKey,
} from '@prodesk/server-shared/modules/signatures/icons';

const APPLY = process.argv.includes('--apply');
const BUCKET = 'brand-files';
const LEGACY_ICON_PREFIX = 'signatures/legacy/icons';

// Parsed legacy filename: `<key>_<hex>_<suffix>.png`.
interface LegacyIcon {
  file: string; // e.g. "facebook_ffffff_087a63c3.png"
  key: IconKey;
  hex: string; // normalised 6-digit lowercase
}

function isIconKey(key: string): key is IconKey {
  return (ICON_KEYS as readonly string[]).includes(key);
}

/**
 * Collect every distinct `icons/<file>.png` referenced by the export. Primary
 * source is db-export/missing-icons.txt (the migration's authoritative list of
 * un-mirrored icons); we also scan all-tables.json so a stale txt can't cause us
 * to skip a referenced icon. Returns basenames (without the `icons/` prefix).
 */
function collectReferencedFiles(): string[] {
  const roots = [resolve(process.cwd(), 'db-export'), resolve(process.cwd(), '../../db-export')];
  const root = roots.find((r) => existsSync(r));
  if (!root) {
    throw new Error(`Could not find db-export (looked in: ${roots.join(', ')})`);
  }

  const files = new Set<string>();

  const missingTxt = resolve(root, 'missing-icons.txt');
  if (existsSync(missingTxt)) {
    for (const raw of readFileSync(missingTxt, 'utf8').split(/\r?\n/)) {
      const m = raw.trim().match(/(?:^|\/)icons\/([^/\s]+\.png)$/i);
      if (m) files.add(m[1]);
    }
  }

  const allTables = resolve(root, 'db-export', 'all-tables.json');
  if (existsSync(allTables)) {
    const text = readFileSync(allTables, 'utf8');
    for (const m of text.matchAll(/manus-storage\/icons\/([A-Za-z0-9._-]+\.png)/g)) {
      files.add(m[1]);
    }
  }

  return [...files];
}

/** Split `facebook_ffffff_087a63c3.png` → { key, hex }. */
function parseLegacyIcon(file: string): LegacyIcon | null {
  const base = file.replace(/\.png$/i, '');
  const parts = base.split('_');
  if (parts.length < 2) return null;
  const [key, hex] = parts;
  if (!isIconKey(key)) return null;
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  return { file, key, hex: hex.toLowerCase() };
}

async function main(): Promise<void> {
  console.log(`# Legacy icon backfill ${APPLY ? 'RUN (uploading)' : 'DRY-RUN (no writes)'}`);

  // Sanity: the target bucket must be reachable before we render anything.
  const { data: bucket, error: bucketErr } = await supabaseAdmin.storage.getBucket(BUCKET);
  if (bucketErr || !bucket) {
    throw new Error(`Storage bucket "${BUCKET}" not reachable: ${bucketErr?.message}`);
  }
  console.log(`- Bucket \`${BUCKET}\` OK (public: ${bucket.public})`);

  const referenced = collectReferencedFiles();
  const parsed: LegacyIcon[] = [];
  const skipped: string[] = [];
  for (const file of referenced) {
    const p = parseLegacyIcon(file);
    if (p) parsed.push(p);
    else skipped.push(file);
  }

  // Collapse to distinct (key, colour) combos, counting how many suffixed
  // filenames each covers. We upload ONE canonical `icons/<key>_<hex>.png` per
  // combo; legacyStorageRedirect() strips the arbitrary suffix so every legacy
  // URL — including suffixes never captured in this export — resolves to it.
  const combos = new Map<string, { key: IconKey; hex: string; refs: number }>();
  for (const p of parsed) {
    const k = `${p.key}_${p.hex}`;
    const existing = combos.get(k);
    if (existing) existing.refs += 1;
    else combos.set(k, { key: p.key, hex: p.hex, refs: 1 });
  }

  console.log(
    `- ${referenced.length} referenced icon files → ${parsed.length} parseable, ` +
      `${combos.size} canonical (key,colour) renders`,
  );
  if (skipped.length) {
    console.log(`- ⚠️  ${skipped.length} unrecognised filenames skipped: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}`);
  }

  if (!APPLY) {
    for (const [combo, { refs }] of [...combos].sort()) {
      console.log(`    icons/${combo}.png  ← ${refs} legacy filename(s)`);
    }
    console.log(`\nWould upload ${combos.size} canonical objects to ${LEGACY_ICON_PREFIX}/`);
    console.log('Re-run with --apply to execute.');
    return;
  }

  let uploaded = 0;
  for (const [combo, { key, hex }] of combos) {
    const buf = await renderColoredIconPng(key, hex);
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(`${LEGACY_ICON_PREFIX}/${combo}.png`, buf, {
        contentType: 'image/png',
        upsert: true,
      });
    if (error) throw new Error(`upload failed for icons/${combo}.png: ${error.message}`);
    uploaded += 1;
    console.log(`  ✓ icons/${combo}.png`);
  }
  console.log(`- ✅ uploaded ${uploaded} canonical legacy icon PNGs under ${LEGACY_ICON_PREFIX}/`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
