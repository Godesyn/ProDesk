/**
 * Merge duplicate brands. For each (survivor, loser) pair: re-point every child
 * row from loser→survivor, de-dupe rows that would collide, handle chat threads
 * and brand↔agency connections, optionally add a full-access staff member, then
 * delete the loser brand. Transactional on --commit; dry-run otherwise.
 *
 * IDs are derived at runtime from the live DB — only brand ids are fixed (they
 * match across envs; owners/threads/connections do NOT, so never hardcode them).
 *
 * Usage:
 *   npx tsx src/scripts/merge-brands.ts --env .env.stage            # dry-run
 *   npx tsx src/scripts/merge-brands.ts --env .env.stage --commit   # execute
 */

/* ── 1. Env ────────────────────────────────────────────────────────────── */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const commit = process.argv.includes('--commit');
function getEnvFile(): string {
  const idx = process.argv.indexOf('--env');
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : '.env';
}
const envFile = getEnvFile();
const cands = [resolve(process.cwd(), envFile), resolve(here, '../../../..', envFile)];
const envPath = cands.find((p) => existsSync(p)) ?? cands[0];
loadEnv({ path: envPath, override: true });
console.log(`[merge-brands] env: ${envPath} | mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`);

/* ── 2. Imports ────────────────────────────────────────────────────────── */
const { sql } = await import('drizzle-orm');
const { db } = await import('@prodesk/server-shared/db/index');
const { createConnectionThreads, ensureBrandAiThread } = await import(
  '@prodesk/server-shared/modules/chat/threads'
);
type Client = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db;

/* ── 3. Config ─────────────────────────────────────────────────────────── */
// Full brand-scoped permission set (= "full access" for a brand staff member).
const BRAND_PERMS = [
  'brandDashboard', 'brandBusinessInfo', 'businessInfo', 'brandProjects',
  'projectBoard', 'brandGuidelines', 'documents', 'resources', 'proposals',
  'infin8', 'agencies', 'staffManagement', 'payments', 'subscriptions',
  'links', 'chat', 'chatWithStaffs', 'chatWithBrands', 'chatWithContractors',
];

interface MergeSpec {
  name: string;
  survivor: string;
  loser: string;
  /** email of a user to add as a full-access ACTIVE brand-staff member of the survivor. */
  addStaffEmail?: string;
  addStaffDisplay?: string;
}

const MERGES: MergeSpec[] = [
  {
    name: "Daddy's Book Club",
    survivor: 'cfa65751-d0bb-4ea8-8909-458e6c33cbf8', // Christopher Henry's brand
    loser: 'fdb7f328-2d95-4685-a06a-bba4067d715d', // Zacchaeus Burrell's brand
    addStaffEmail: 'zacch.b@noize.com.au',
    addStaffDisplay: 'Zacchaeus Burrell',
  },
  {
    name: 'Luxia Pools',
    survivor: 'b846b0a1-6615-446f-83cf-88f6cbfa93f4', // newer, has the staff member
    loser: 'cc7f0cd1-b979-4da0-b182-904f88c6e06b', // older
  },
];

// FK columns referencing brands(id) that get SPECIAL handling (not the generic repoint).
const SPECIAL = new Set([
  'user_brands.brand_id',
  'staff.brand_id',
  'brand_agency_connections.brand_id',
  'chat_threads.brand_id',
  'users.selected_brand_id',
  'agencies.derived_from_brand_id',
]);

/* ── 4. Helpers ────────────────────────────────────────────────────────── */
async function scalar(c: Client, q: ReturnType<typeof sql>): Promise<number> {
  const r = (await c.execute(q)) as unknown as Array<{ n: number }>;
  return Number(r[0]?.n ?? 0);
}

/** Count rows the op would affect, log it, and execute it when committing. */
async function step(c: Client, label: string, countQ: ReturnType<typeof sql>, writeQ: ReturnType<typeof sql>): Promise<void> {
  const n = await scalar(c, countQ);
  console.log(`    ${commit ? 'EXEC' : 'PLAN'}  ${label.padEnd(52)} ${n} row(s)`);
  if (commit && n > 0) await c.execute(writeQ);
}

/* ── 5. Per-pair merge ─────────────────────────────────────────────────── */
async function runPair(
  c: Client,
  m: MergeSpec,
  fks: Array<{ child_table: string; child_column: string }>,
): Promise<void> {
  const S = m.survivor;
  const L = m.loser;
  console.log(`\n=== ${m.name}: ${L.slice(0, 8)} → ${S.slice(0, 8)} ===`);

  // 5a. Chat threads: delete ALL threads for both brands. Fresh connection
  // threads + the AI thread are rebuilt post-commit via the app's own
  // createConnectionThreads / ensureBrandAiThread (see rebuildThreads).
  await step(
    c, 'delete ALL chat_threads (survivor + loser)',
    sql`SELECT count(*)::int AS n FROM chat_threads WHERE brand_id IN (${S}, ${L})`,
    sql`DELETE FROM chat_threads WHERE brand_id IN (${S}, ${L})`,
  );

  // 5b. brand↔agency connections: drop loser's where survivor already connects
  // to that agency, else repoint.
  await step(
    c, 'drop loser brand_agency_connections dup w/ survivor',
    sql`SELECT count(*)::int AS n FROM brand_agency_connections
        WHERE brand_id = ${L} AND agency_id IN (SELECT agency_id FROM brand_agency_connections WHERE brand_id = ${S})`,
    sql`DELETE FROM brand_agency_connections
        WHERE brand_id = ${L} AND agency_id IN (SELECT agency_id FROM brand_agency_connections WHERE brand_id = ${S})`,
  );
  await step(
    c, 'repoint remaining brand_agency_connections → survivor',
    sql`SELECT count(*)::int AS n FROM brand_agency_connections WHERE brand_id = ${L}`,
    sql`UPDATE brand_agency_connections SET brand_id = ${S} WHERE brand_id = ${L}`,
  );

  // 5c. user_brands: drop dup memberships, repoint the rest.
  await step(
    c, 'drop user_brands dup memberships',
    sql`SELECT count(*)::int AS n FROM user_brands WHERE brand_id = ${L} AND user_id IN (SELECT user_id FROM user_brands WHERE brand_id = ${S})`,
    sql`DELETE FROM user_brands WHERE brand_id = ${L} AND user_id IN (SELECT user_id FROM user_brands WHERE brand_id = ${S})`,
  );
  await step(
    c, 'repoint user_brands → survivor',
    sql`SELECT count(*)::int AS n FROM user_brands WHERE brand_id = ${L}`,
    sql`UPDATE user_brands SET brand_id = ${S} WHERE brand_id = ${L}`,
  );

  // 5d. staff: drop dup (same user already staff of survivor), repoint the rest.
  await step(
    c, 'drop staff dup rows',
    sql`SELECT count(*)::int AS n FROM staff WHERE brand_id = ${L} AND user_id IN (SELECT user_id FROM staff WHERE brand_id = ${S})`,
    sql`DELETE FROM staff WHERE brand_id = ${L} AND user_id IN (SELECT user_id FROM staff WHERE brand_id = ${S})`,
  );
  await step(
    c, 'repoint staff → survivor',
    sql`SELECT count(*)::int AS n FROM staff WHERE brand_id = ${L}`,
    sql`UPDATE staff SET brand_id = ${S} WHERE brand_id = ${L}`,
  );

  // 5e. users.selected_brand_id.
  await step(
    c, 'repoint users.selected_brand_id → survivor',
    sql`SELECT count(*)::int AS n FROM users WHERE selected_brand_id = ${L}`,
    sql`UPDATE users SET selected_brand_id = ${S} WHERE selected_brand_id = ${L}`,
  );

  // 5f. Generic repoint of every other FK referencing brands(id).
  for (const fk of fks) {
    if (SPECIAL.has(`${fk.child_table}.${fk.child_column}`)) continue;
    await step(
      c, `repoint ${fk.child_table}.${fk.child_column}`,
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(fk.child_table)} WHERE ${sql.identifier(fk.child_column)} = ${L}`,
      sql`UPDATE ${sql.identifier(fk.child_table)} SET ${sql.identifier(fk.child_column)} = ${S} WHERE ${sql.identifier(fk.child_column)} = ${L}`,
    );
  }

  // 5g. Add full-access staff member to survivor (idempotent).
  if (m.addStaffEmail) {
    const permsArr = sql.raw(`ARRAY[${BRAND_PERMS.map((p) => `'${p}'`).join(',')}]::staff_permission[]`);
    await step(
      c, `add full-access staff ${m.addStaffEmail}`,
      sql`SELECT count(*)::int AS n FROM users u
          WHERE u.email = ${m.addStaffEmail}
            AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.brand_id = ${S} AND s.user_id = u.id)`,
      sql`INSERT INTO staff (email, type, brand_id, user_id, display_name, permissions, status, invited_by, invited_at, accepted_at)
          SELECT ${m.addStaffEmail}, 'brand', ${S}, u.id, ${m.addStaffDisplay ?? null}, ${permsArr}, 'active', b.owner_id, now(), now()
          FROM users u CROSS JOIN brands b
          WHERE u.email = ${m.addStaffEmail} AND b.id = ${S}
            AND NOT EXISTS (SELECT 1 FROM staff s WHERE s.brand_id = ${S} AND s.user_id = u.id)`,
    );
  }

  // 5h. Safety: any remaining references to the loser across all FKs?
  let remaining = 0;
  for (const fk of fks) {
    remaining += await scalar(
      c,
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(fk.child_table)} WHERE ${sql.identifier(fk.child_column)} = ${L}`,
    );
  }
  console.log(`    ${commit ? 'EXEC' : 'PLAN'}  ${'remaining refs to loser (must be 0 to delete)'.padEnd(52)} ${remaining}`);

  // 5i. Delete the loser brand.
  if (commit && remaining > 0) {
    throw new Error(`Refusing to delete loser ${L}: ${remaining} dangling reference(s) remain.`);
  }
  await step(
    c, 'DELETE loser brand row',
    sql`SELECT count(*)::int AS n FROM brands WHERE id = ${L}`,
    sql`DELETE FROM brands WHERE id = ${L}`,
  );
}

/* ── 5j. Rebuild fresh threads for a survivor (post-commit) ────────────────
 * Uses the app's own logic so the rebuilt threads match what the product
 * creates: one `all` group thread + per-member staff threads per connection,
 * plus the brand AI assistant thread. */
async function rebuildThreads(survivor: string, name: string): Promise<void> {
  const conns = (await db.execute(
    sql`SELECT id, agency_id AS "agencyId" FROM brand_agency_connections WHERE brand_id = ${survivor}`,
  )) as unknown as Array<{ id: string; agencyId: string }>;
  if (commit) {
    for (const conn of conns) {
      await createConnectionThreads(conn.id, survivor, conn.agencyId, db);
    }
    await ensureBrandAiThread(survivor, db);
    console.log(`    EXEC  rebuild threads for ${name}: ${conns.length} connection(s) + AI thread`);
  } else {
    console.log(`    PLAN  rebuild threads for ${name}: ${conns.length} connection(s) + AI thread`);
  }
}

/* ── 6. Main ───────────────────────────────────────────────────────────── */
async function run(): Promise<void> {
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

  if (commit) {
    await db.transaction(async (tx) => {
      for (const m of MERGES) await runPair(tx, m, fks);
    });
  } else {
    for (const m of MERGES) await runPair(db, m, fks);
  }

  // Rebuild chat threads from the merged state (post-commit, app logic).
  console.log('\n=== Rebuild threads ===');
  for (const m of MERGES) await rebuildThreads(m.survivor, m.name);

  console.log(`\n[merge-brands] ${commit ? 'COMMITTED' : 'DRY-RUN complete — re-run with --commit'}.`);
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[merge-brands] fatal', err);
    process.exit(1);
  });
