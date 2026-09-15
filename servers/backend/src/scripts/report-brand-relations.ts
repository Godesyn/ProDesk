/**
 * Read-only merge-prep report for a set of brands. Introspects EVERY foreign key
 * that references brands(id) via the live Postgres catalog (so no relation is
 * missed even if the ORM schema drifts), counts child rows per brand for each
 * referencing table/column, and dumps the brand rows + owners side by side.
 *
 * Usage:
 *   npx tsx src/scripts/report-brand-relations.ts --env .env.prod <brandId> <brandId> ...
 *   npm run db:report-brand-relations -- --env .env.prod <id> <id>
 *
 * If no brand ids are passed it falls back to the known colliding pairs.
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
console.log(`[report-brand-relations] env: ${envPath}`);

/* ── 2. Collect brand ids from argv (uuid-shaped tokens) ──────────────── */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const argIds = process.argv.slice(2).filter((a) => UUID.test(a));
const DEFAULT_IDS = [
  'cfa65751-d0bb-4ea8-8909-458e6c33cbf8', // Daddy's Book Club
  'fdb7f328-2d95-4685-a06a-bba4067d715d', // Daddy's Book Club
  'b846b0a1-6615-446f-83cf-88f6cbfa93f4', // Luxia Pools
  'cc7f0cd1-b979-4da0-b182-904f88c6e06b', // Luxia Pools
];
const ids = argIds.length ? argIds : DEFAULT_IDS;

/* ── 3. Dynamic imports (AFTER env is loaded) ─────────────────────────── */
const { sql } = await import('drizzle-orm');
const { db } = await import('@prodesk/server-shared/db/index');

/* ── 4. Report ────────────────────────────────────────────────────────── */
const short = (id: string) => id.slice(0, 8);

async function run(): Promise<void> {
  // 4a. Brand rows + owner, side by side.
  const brandRows = (await db.execute(sql`
    SELECT b.id, b.business_name, b.owner_id, b.email, b.website, b.phone,
           b.legal_name, b.abn, b.industry, b.referral_token,
           b.chatbot_thread_id, b.derived_to_agency_id,
           b.created_at, b.updated_at,
           coalesce(array_length(b.logo_urls, 1), 0)        AS logo_count,
           coalesce(jsonb_array_length(b.policies), 0)      AS policy_count,
           coalesce(jsonb_array_length(b.locations), 0)     AS location_count,
           coalesce(array_length(b.favourite_service_ids, 1), 0) AS fav_count,
           u.email      AS owner_email,
           trim(concat_ws(' ', u.first_name, u.last_name)) AS owner_name,
           u.role       AS owner_role
    FROM brands b
    LEFT JOIN users u ON u.id = b.owner_id
    WHERE b.id IN ${ids}
  `)) as unknown as Array<Record<string, unknown>>;

  const byId = new Map(brandRows.map((r) => [String(r.id), r]));

  console.log('\n=== BRAND ROWS (survivor-selection comparison) ===');
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) {
      console.log(`\n  ${id} — ⚠️ NOT FOUND`);
      continue;
    }
    console.log(`\n  ${r.business_name}  [${id}]`);
    console.log(`    owner         : ${r.owner_name ?? '—'} <${r.owner_email ?? '—'}> (${r.owner_role ?? '—'}) ${r.owner_id}`);
    console.log(`    email/web/phone: ${r.email ?? '—'} | ${r.website ?? '—'} | ${r.phone ?? '—'}`);
    console.log(`    legal/abn/ind : ${r.legal_name ?? '—'} | ${r.abn ?? '—'} | ${r.industry ?? '—'}`);
    console.log(`    referralToken : ${r.referral_token ?? '—'}`);
    console.log(`    chatThread/derivedAgency: ${r.chatbot_thread_id ?? '—'} | ${r.derived_to_agency_id ?? '—'}`);
    console.log(`    content counts: logos=${r.logo_count} policies=${r.policy_count} locations=${r.location_count} favs=${r.fav_count}`);
    console.log(`    created/updated: ${(r.created_at as Date)?.toISOString?.() ?? r.created_at} | ${(r.updated_at as Date)?.toISOString?.() ?? r.updated_at}`);
  }

  // 4b. Every FK that references brands(id).
  const fks = (await db.execute(sql`
    SELECT tc.table_name AS child_table, kcu.column_name AS child_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'brands' AND ccu.column_name = 'id'
    ORDER BY tc.table_name, kcu.column_name
  `)) as unknown as Array<{ child_table: string; child_column: string }>;

  console.log(`\n=== FOREIGN KEYS REFERENCING brands(id) — ${fks.length} ===`);
  for (const fk of fks) console.log(`    ${fk.child_table}.${fk.child_column}`);

  // 4c. Per-relation row counts per brand id.
  console.log('\n=== RELATION ROW COUNTS PER BRAND ===');
  const header = ['relation'.padEnd(48), ...ids.map((id) => short(id).padStart(10))].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  const totals = new Map(ids.map((id) => [id, 0]));
  const nonEmpty: Array<{ child_table: string; child_column: string }> = [];
  for (const fk of fks) {
    const rows = (await db.execute(sql`
      SELECT ${sql.identifier(fk.child_column)}::text AS bid, count(*)::int AS n
      FROM ${sql.identifier(fk.child_table)}
      WHERE ${sql.identifier(fk.child_column)} IN ${ids}
      GROUP BY 1
    `)) as unknown as Array<{ bid: string; n: number }>;
    const counts = new Map(rows.map((r) => [r.bid, Number(r.n)]));
    if ([...counts.values()].every((n) => !n)) continue; // skip all-zero relations
    nonEmpty.push(fk);
    const label = `${fk.child_table}.${fk.child_column}`.padEnd(48);
    const cells = ids
      .map((id) => {
        const n = counts.get(id) ?? 0;
        totals.set(id, (totals.get(id) ?? 0) + n);
        return String(n).padStart(10);
      })
      .join(' ');
    console.log(`${label} ${cells}`);
  }
  console.log('-'.repeat(header.length));
  console.log(`${'TOTAL referencing rows'.padEnd(48)} ${ids.map((id) => String(totals.get(id) ?? 0).padStart(10)).join(' ')}`);

  // 4d. Actual row data for every non-empty relation (non-null columns only).
  const fmt = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (v instanceof Date) s = v.toISOString();
    else if (typeof v === 'object') s = JSON.stringify(v);
    else s = String(v);
    return s.length > 120 ? s.slice(0, 117) + '…' : s;
  };
  const isEmpty = (v: unknown) =>
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date) && Object.keys(v).length === 0);

  console.log('\n=== RELATION DATA (non-null columns per row, grouped by brand) ===');
  for (const fk of nonEmpty) {
    console.log(`\n----- ${fk.child_table}.${fk.child_column} -----`);
    const rows = (await db.execute(sql`
      SELECT * FROM ${sql.identifier(fk.child_table)}
      WHERE ${sql.identifier(fk.child_column)} IN ${ids}
      ORDER BY ${sql.identifier(fk.child_column)}
    `)) as unknown as Array<Record<string, unknown>>;
    for (const id of ids) {
      const mine = rows.filter((r) => String(r[fk.child_column]) === id);
      if (!mine.length) continue;
      console.log(`  [${short(id)}] ${byId.get(id)?.business_name ?? ''} — ${mine.length} row(s)`);
      for (const row of mine) {
        const fields = Object.entries(row)
          .filter(([, v]) => !isEmpty(v))
          .map(([k, v]) => `${k}=${fmt(v)}`)
          .join('  ');
        console.log(`      • ${fields}`);
      }
    }
  }

  // 4e. Chat message volume per brand (via its threads), excluding system msgs.
  console.log('\n=== CHAT MESSAGES PER BRAND (via chat_threads.brand_id) ===');
  const msgRows = (await db.execute(sql`
    SELECT t.brand_id::text AS bid,
           count(*)::int AS total,
           count(*) FILTER (WHERE m.type = 'system')::int AS system,
           count(*) FILTER (WHERE m.type <> 'system')::int AS non_system,
           count(*) FILTER (WHERE m.type <> 'system' AND m.is_ai)::int AS non_system_ai,
           count(*) FILTER (WHERE m.type <> 'system' AND NOT m.is_ai)::int AS non_system_human
    FROM chat_messages m
    JOIN chat_threads t ON t.id = m.thread_id
    WHERE t.brand_id IN ${ids}
    GROUP BY 1
  `)) as unknown as Array<Record<string, number | string>>;
  const msgById = new Map(msgRows.map((r) => [String(r.bid), r]));
  const mh = ['brand'.padEnd(14), 'total', 'system', 'non-system', 'ns-AI', 'ns-human'].join('  ');
  console.log(mh);
  console.log('-'.repeat(mh.length));
  for (const id of ids) {
    const r = msgById.get(id);
    const cells = [
      short(id).padEnd(14),
      String(r?.total ?? 0).padStart(5),
      String(r?.system ?? 0).padStart(6),
      String(r?.non_system ?? 0).padStart(10),
      String(r?.non_system_ai ?? 0).padStart(5),
      String(r?.non_system_human ?? 0).padStart(8),
    ].join('  ');
    console.log(`${cells}   ${byId.get(id)?.business_name ?? ''}`);
  }

  console.log('\n[report-brand-relations] done.');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[report-brand-relations] fatal', err);
    process.exit(1);
  });
