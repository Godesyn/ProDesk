/**
 * Read-only audit of the shared brand+agency business-name namespace.
 *
 * The platform treats brand and (standalone) agency business names as one
 * case-insensitive namespace: a name may belong to at most one brand OR one
 * standalone agency. Derived agencies (agencies.derived_from_brand_id set)
 * intentionally mirror their parent brand and are excluded from the namespace.
 *
 * This script reports, without changing anything:
 *   1. Collisions — a name used by more than one brand/standalone-agency.
 *   2. Derived-agency name drift — a derived agency whose name no longer matches
 *      its parent brand (brand rename that didn't propagate).
 *   3. Brands with no derived agency yet (candidates for the backfill).
 *
 * Usage:
 *   npx tsx src/scripts/check-business-name-collisions.ts            # dev (.env)
 *   npx tsx src/scripts/check-business-name-collisions.ts --env .env.stage
 *   npx tsx src/scripts/check-business-name-collisions.ts --env .env.prod
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
// Resolve the env file: absolute as-is, else relative to CWD or the monorepo
// root (four levels up from servers/backend/src/scripts).
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
console.log(`[collisions] env: ${envPath}`);

/* ── 2. Dynamic imports (AFTER env is loaded) ─────────────────────────── */
const { db } = await import('@prodesk/server-shared/db/index');
const { agencies, brands } = await import(
  '@prodesk/server-shared/db/schema'
);

/* ── 3. Report ────────────────────────────────────────────────────────── */
const norm = (s: string) => s.trim().toLowerCase();

interface Holder {
  kind: 'brand' | 'agency';
  id: string;
  name: string;
}

async function run(): Promise<void> {
  const [brandRows, agencyRows] = await Promise.all([
    db.select({ id: brands.id, businessName: brands.businessName }).from(brands),
    db
      .select({
        id: agencies.id,
        businessName: agencies.businessName,
        derivedFromBrandId: agencies.derivedFromBrandId,
      })
      .from(agencies),
  ]);

  const derived = agencyRows.filter((a) => a.derivedFromBrandId);
  const standalone = agencyRows.filter((a) => !a.derivedFromBrandId);

  // 1. Namespace collisions (brands ∪ standalone agencies).
  const byName = new Map<string, Holder[]>();
  const add = (h: Holder) => {
    const key = norm(h.name);
    const arr = byName.get(key) ?? [];
    arr.push(h);
    byName.set(key, arr);
  };
  for (const b of brandRows) add({ kind: 'brand', id: b.id, name: b.businessName });
  for (const a of standalone) add({ kind: 'agency', id: a.id, name: a.businessName });

  const collisions = [...byName.entries()]
    .filter(([, holders]) => holders.length > 1)
    .sort((a, b) => a[0].localeCompare(b[0]));

  console.log('\n=== 1. Business-name collisions ===');
  if (!collisions.length) {
    console.log('✅ None — every brand/standalone-agency name is unique.');
  } else {
    console.log(`⚠️  ${collisions.length} colliding name(s):`);
    for (const [name, holders] of collisions) {
      console.log(`\n  "${holders[0].name}" (normalized: ${name})`);
      for (const h of holders) console.log(`    - ${h.kind.padEnd(6)} ${h.id}`);
    }
  }

  // 2. Derived-agency name drift.
  const brandById = new Map(brandRows.map((b) => [b.id, b]));
  const drift = derived.filter((a) => {
    const b = brandById.get(a.derivedFromBrandId as string);
    return b && norm(b.businessName) !== norm(a.businessName);
  });

  console.log('\n=== 2. Derived-agency name drift ===');
  if (!drift.length) {
    console.log('✅ None — every derived agency matches its parent brand name.');
  } else {
    console.log(`⚠️  ${drift.length} derived agency name(s) out of sync:`);
    for (const a of drift) {
      const b = brandById.get(a.derivedFromBrandId as string);
      console.log(
        `    - agency ${a.id} "${a.businessName}" ≠ brand ${b?.id} "${b?.businessName}"`,
      );
    }
  }

  // 3. Brands missing a derived agency.
  const derivedBrandIds = new Set(derived.map((a) => a.derivedFromBrandId));
  const missing = brandRows.filter((b) => !derivedBrandIds.has(b.id));

  console.log('\n=== 3. Brands without a derived agency ===');
  if (!missing.length) {
    console.log('✅ None — every brand has a derived agency.');
  } else {
    console.log(
      `ℹ️  ${missing.length} brand(s) have no derived agency — run backfill-derived-agencies.ts:`,
    );
    for (const b of missing) console.log(`    - brand ${b.id} "${b.businessName}"`);
  }

  console.log(
    `\n[collisions] summary — brands: ${brandRows.length}, standalone agencies: ${standalone.length}, derived agencies: ${derived.length}`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[collisions] fatal', err);
    process.exit(1);
  });
