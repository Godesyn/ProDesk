/**
 * Read-only merge-prep report for the signature_brands → brand_kits
 * consolidation. For every brand that has a signature_brands row, compares each
 * OVERLAPPING column against its canonical `brands` counterpart and flags every
 * divergence. `brands` is planned to become the single source of truth; this
 * report is what we use to decide, per conflict, which value survives before the
 * duplicated columns are dropped from signature_brands.
 *
 * Overlapping pairs compared:
 *   signature_brands.name          ↔ brands.business_name
 *   signature_brands.website       ↔ brands.website
 *   signature_brands.address       ↔ brands.address
 *   signature_brands.logo_url      ↔ brands.logo_url
 *   signature_brands.primary_color ↔ brands.colors[1]   (token: primary)
 *   signature_brands.secondary_color ↔ brands.colors[2] (token: accent)
 *   signature_brands.font_family   ↔ brands.typography[2] (Body) / [1] (Heading)
 *
 * Usage (READ ONLY — only SELECTs):
 *   npx tsx src/scripts/report-brandkit-merge-conflicts.ts --env .railway/envs/shared.production.env
 */

/* ── 1. Load environment BEFORE any app import ─────────────────────────── */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
function getEnvFile(): string {
  const idx = process.argv.indexOf('--env');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : '.env';
}
const envFile = getEnvFile();
const candidates = [
  resolve(process.cwd(), envFile),
  resolve(here, '../../../..', envFile),
];
const envPath = candidates.find((p) => existsSync(p)) ?? candidates[0];
loadEnv({ path: envPath, override: true });
const baseEnv = [
  resolve(process.cwd(), '.env'),
  resolve(here, '../../../..', '.env'),
].find((p) => existsSync(p));
if (envFile !== '.env' && baseEnv) loadEnv({ path: baseEnv });
console.log(`[report-brandkit-merge-conflicts] env: ${envPath}`);

/* ── 2. Dynamic imports (AFTER env is loaded) ─────────────────────────── */
const { sql } = await import('drizzle-orm');
const { db } = await import('@prodesk/server-shared/db/index');

/* ── 3. Report ────────────────────────────────────────────────────────── */
const short = (id: string) => String(id).slice(0, 8);
const norm = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  return String(v).trim();
};
const show = (v: unknown): string => {
  const s = norm(v);
  return s === '' ? '∅' : s.length > 80 ? s.slice(0, 77) + '…' : s;
};

interface Row {
  sb_id: string;
  brand_id: string;
  business_name: string | null;
  sb_name: string | null;
  b_website: string | null;
  sb_website: string | null;
  b_address: string | null;
  sb_address: string | null;
  b_logo_url: string | null;
  sb_logo_url: string | null;
  b_colors: string[] | null;
  sb_primary_color: string | null;
  sb_secondary_color: string | null;
  b_typography: string[] | null;
  sb_font_family: string | null;
}

async function run(): Promise<void> {
  const rows = (await db.execute(sql`
    SELECT
      sb.id                AS sb_id,
      sb.brand_id          AS brand_id,
      b.business_name      AS business_name,
      sb.name              AS sb_name,
      b.website            AS b_website,
      sb.website           AS sb_website,
      b.address            AS b_address,
      sb.address           AS sb_address,
      b.logo_url           AS b_logo_url,
      sb.logo_url          AS sb_logo_url,
      b.colors             AS b_colors,
      sb.primary_color     AS sb_primary_color,
      sb.secondary_color   AS sb_secondary_color,
      b.typography         AS b_typography,
      sb.font_family       AS sb_font_family
    FROM signature_brands sb
    JOIN brands b ON b.id = sb.brand_id
    ORDER BY b.business_name
  `)) as unknown as Row[];

  console.log(`\n=== signature_brands rows joined to brands: ${rows.length} ===\n`);

  // Field comparisons: label, canonical(brands) getter, satellite getter.
  const fields: Array<{
    label: string;
    canonical: (r: Row) => unknown;
    satellite: (r: Row) => unknown;
  }> = [
    { label: 'name ↔ business_name', canonical: (r) => r.business_name, satellite: (r) => r.sb_name },
    { label: 'website', canonical: (r) => r.b_website, satellite: (r) => r.sb_website },
    { label: 'address', canonical: (r) => r.b_address, satellite: (r) => r.sb_address },
    { label: 'logo_url', canonical: (r) => r.b_logo_url, satellite: (r) => r.sb_logo_url },
    { label: 'primary_color ↔ colors[0]', canonical: (r) => (r.b_colors ?? [])[0], satellite: (r) => r.sb_primary_color },
    { label: 'secondary_color ↔ colors[1]', canonical: (r) => (r.b_colors ?? [])[1], satellite: (r) => r.sb_secondary_color },
    { label: 'font_family ↔ typography[1](Body)', canonical: (r) => (r.b_typography ?? [])[1], satellite: (r) => r.sb_font_family },
  ];

  let totalConflicts = 0;
  const perField = new Map<string, number>();

  for (const r of rows) {
    const conflicts = fields.filter((f) => {
      const a = norm(f.canonical(r));
      const b = norm(f.satellite(r));
      // A conflict is only interesting when BOTH sides have a value and they differ.
      return a !== '' && b !== '' && a !== b;
    });

    const headline = `${r.business_name ?? '(no name)'}  [brand ${short(r.brand_id)} · sb ${short(r.sb_id)}]`;
    if (conflicts.length === 0) {
      console.log(`  ✅ ${headline} — no conflicts`);
      continue;
    }
    console.log(`\n  ⚠️  ${headline} — ${conflicts.length} conflict(s)`);
    for (const f of conflicts) {
      totalConflicts++;
      perField.set(f.label, (perField.get(f.label) ?? 0) + 1);
      console.log(`       ${f.label}`);
      console.log(`         brands (canonical): ${show(f.canonical(r))}`);
      console.log(`         signature satellite: ${show(f.satellite(r))}`);
    }
    // Also surface the full colour/typography arrays for context.
    console.log(`         · brands.colors     = [${(r.b_colors ?? []).map(show).join(', ')}]`);
    console.log(`         · brands.typography = [${(r.b_typography ?? []).map(show).join(', ')}]`);
    console.log(`         · sb colours        = primary:${show(r.sb_primary_color)} secondary:${show(r.sb_secondary_color)} font:${show(r.sb_font_family)}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  signature_brands rows: ${rows.length}`);
  console.log(`  total field conflicts: ${totalConflicts}`);
  if (perField.size) {
    console.log('  conflicts by field:');
    for (const [label, n] of [...perField.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${label}: ${n}`);
    }
  }

  // Satellite-only values worth promoting even when brands is empty (no conflict,
  // but data would be LOST on drop). These are informational for the migration.
  console.log('\n=== SATELLITE-ONLY VALUES (brands empty, would be lost on drop) ===');
  let orphanCount = 0;
  for (const r of rows) {
    const orphans = fields.filter((f) => norm(f.canonical(r)) === '' && norm(f.satellite(r)) !== '');
    if (!orphans.length) continue;
    orphanCount++;
    console.log(`  ${r.business_name ?? '(no name)'} [${short(r.brand_id)}]`);
    for (const f of orphans) console.log(`     ${f.label}: ${show(f.satellite(r))}  (brands side empty)`);
  }
  if (!orphanCount) console.log('  (none)');

  console.log('\n[report-brandkit-merge-conflicts] done.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[report-brandkit-merge-conflicts] fatal', err);
    process.exit(1);
  });
