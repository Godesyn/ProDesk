/**
 * Compare Supabase Auth users vs Postgres `users` table by email,
 * and report whether the UIDs (auth.users.id vs users.id) match.
 *
 * Usage:
 *   npx tsx src/scripts/compare-uids.ts --env .env.prod
 */

import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');

function getEnvFile(): string {
  const idx = process.argv.indexOf('--env');
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return '.env.prod';
}

const envFile = getEnvFile();
loadEnv({ path: resolve(root, envFile), override: true });

const { createClient } = await import('@supabase/supabase-js');
const postgres = (await import('postgres')).default;

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY!;
const dbUrl = process.env.DATABASE_URL!;

console.log(`\n🔌 Environment: ${envFile}`);
console.log(`   Supabase URL: ${supabaseUrl}`);
console.log(`   DB: ${dbUrl.replace(/\/\/.*:.*@/, '//***@')}\n`);

// ── 1. Fetch all Supabase Auth users ──────────────────────────────────────
const supabaseAdmin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const authUsers: { id: string; email: string }[] = [];
let page = 1;
while (true) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw new Error(`Supabase listUsers failed: ${error.message}`);
  if (!data.users.length) break;
  for (const u of data.users) {
    if (u.email) authUsers.push({ id: u.id, email: u.email.toLowerCase() });
  }
  if (data.users.length < 1000) break;
  page++;
}

// ── 2. Fetch all DB users ─────────────────────────────────────────────────
const sql = postgres(dbUrl, { prepare: false });
const dbRows = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users`;
const dbUsers = dbRows.map((r) => ({ id: r.id, email: r.email.toLowerCase() }));

// ── 3. Compare by email ───────────────────────────────────────────────────
const authByEmail = new Map(authUsers.map((u) => [u.email, u]));
const dbByEmail = new Map(dbUsers.map((u) => [u.email, u]));

const allEmails = new Set([...authByEmail.keys(), ...dbByEmail.keys()]);

const matched: { email: string; uid: string }[] = [];
const mismatched: { email: string; authId: string; dbId: string }[] = [];
const onlyAuth: { email: string; id: string }[] = [];
const onlyDb: { email: string; id: string }[] = [];

for (const email of [...allEmails].sort()) {
  const a = authByEmail.get(email);
  const d = dbByEmail.get(email);
  if (a && d) {
    if (a.id === d.id) matched.push({ email, uid: a.id });
    else mismatched.push({ email, authId: a.id, dbId: d.id });
  } else if (a) {
    onlyAuth.push({ email, id: a.id });
  } else if (d) {
    onlyDb.push({ email, id: d.id });
  }
}

// ── 4. Report ─────────────────────────────────────────────────────────────
console.log(`Supabase Auth users: ${authUsers.length}`);
console.log(`Postgres DB users:   ${dbUsers.length}\n`);

console.log('═══════════════════════════════════════════════════════════════');
console.log(`✅ MATCHING UIDs (same email, same id): ${matched.length}`);
console.log('═══════════════════════════════════════════════════════════════');
for (const m of matched) console.log(`  ${m.email}  →  ${m.uid}`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`❌ MISMATCHED UIDs (same email, DIFFERENT id): ${mismatched.length}`);
console.log('═══════════════════════════════════════════════════════════════');
for (const m of mismatched) {
  console.log(`  ${m.email}`);
  console.log(`     auth.users.id: ${m.authId}`);
  console.log(`     users.id:      ${m.dbId}`);
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`⚠️  ONLY in Supabase Auth (no DB row): ${onlyAuth.length}`);
console.log('═══════════════════════════════════════════════════════════════');
for (const u of onlyAuth) console.log(`  ${u.email}  →  ${u.id}`);

console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`⚠️  ONLY in DB (no Supabase Auth user): ${onlyDb.length}`);
console.log('═══════════════════════════════════════════════════════════════');
for (const u of onlyDb) console.log(`  ${u.email}  →  ${u.id}`);

console.log('');
await sql.end();
process.exit(0);
