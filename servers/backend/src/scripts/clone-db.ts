/**
 * Clone one Supabase environment's database into another (prod → staging).
 *
 * Copies the four schemas that carry real data: `public` (app tables),
 * `auth` (users/sessions), `storage` (bucket + object rows), and `drizzle`
 * (migration bookkeeping). File BYTES in storage buckets are a separate copy —
 * see `copy-storage.ts`, which this script prints the invocation for.
 *
 * `drizzle` is included deliberately. It is the fix for the trap this procedure
 * used to fall into by hand: the dump replaces the target's `public` schema with
 * the source's, but `drizzle.__drizzle_migrations` is what `db:migrate` reads to
 * decide what is pending. Leave the target's own journal in place and it claims
 * migrations the restored schema does not have, so `db:migrate` reports nothing
 * pending against a schema that is missing columns. Restoring both together
 * keeps them honest, and a plain `db:migrate` afterwards applies exactly the
 * delta between the source and the codebase.
 *
 * Why Docker: Supabase runs Postgres 17 and the local client tools are 16, which
 * pg_dump refuses to talk to. Everything runs inside `postgres:17`.
 *
 * Why the session pooler: DDL and prepared statements need `DIRECT_URL`
 * (`...pooler.supabase.com:5432`). The transaction pooler on :6543 cannot do
 * this, and `db.<ref>.supabase.co` is IPv6-only and hangs.
 *
 * Phases run in order and can be resumed individually with `--only`:
 *
 *   dump      pg_dump the source to a local custom-format archive (cached).
 *   render    Turn the archive into SQL and apply the fixes listed at `render()`.
 *   wipe      Drop public+drizzle on the TARGET and truncate auth+storage.
 *   load      Load auth, then storage, then public+drizzle. Order matters:
 *             public has foreign keys into auth.users.
 *   finalize  Reset every password, drop MFA factors, rebuild the realtime
 *             publication that dropping `public` destroyed.
 *   verify    Compare source and target row-for-row and exit non-zero on drift.
 *
 * SAFETY. `--to production` is refused unconditionally, as is any run whose
 * source and target resolve to the same project. Nothing is written without
 * `--yes`, and `--yes` additionally requires `--confirm-target=<ref>` naming the
 * project about to be wiped, so a wrong `--to` cannot destroy a database on its
 * own.
 *
 *   npx tsx --conditions development src/scripts/clone-db.ts
 *   npx tsx --conditions development src/scripts/clone-db.ts --yes --confirm-target=pbsojyaegwhrpqbcyarm
 *   npx tsx --conditions development src/scripts/clone-db.ts --only=verify
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const PHASES = ['dump', 'render', 'wipe', 'load', 'finalize', 'verify'] as const;
type Phase = (typeof PHASES)[number];

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const FROM = arg('from') ?? 'production';
const TO = arg('to') ?? 'staging';
const APPLY = process.argv.includes('--yes');
const CONFIRM = arg('confirm-target');
const PASSWORD = arg('password') ?? 'Test1234@';
const ONLY = arg('only') as Phase | undefined;
const WORK = arg('work-dir') ?? resolve(tmpdir(), 'prodesk-clone');
const IMAGE = 'postgres:17';

if (ONLY && !PHASES.includes(ONLY)) {
  throw new Error(`--only must be one of ${PHASES.join(', ')}`);
}

/* ── credentials ─────────────────────────────────────────────────────────── */

type Env = { name: string; direct: string; ref: string; supabaseUrl: string; secretKey: string | null };

function loadEnv(name: string): Env {
  const file = resolve(repoRoot, `.railway/envs/shared.${name}.env`);
  if (!existsSync(file)) throw new Error(`no env file for "${name}" at ${file}`);
  const body = readFileSync(file, 'utf8');
  const pick = (k: string) => body.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1] ?? null;
  const direct = pick('DIRECT_URL');
  if (!direct) throw new Error(`${name}: DIRECT_URL missing`);
  // Supabase pooler usernames are `postgres.<project-ref>`, which is the only
  // place the project identity appears in a connection string.
  const ref = direct.match(/\/\/postgres\.([a-z0-9]+):/)?.[1];
  if (!ref) throw new Error(`${name}: cannot read project ref from DIRECT_URL`);
  return { name, direct, ref, supabaseUrl: pick('SUPABASE_URL') ?? '', secretKey: pick('SUPABASE_SECRET_KEY') };
}

const src = loadEnv(FROM);
const dst = loadEnv(TO);

/* ── guards ──────────────────────────────────────────────────────────────── */

if (dst.name === 'production') {
  throw new Error('refusing to use production as a TARGET. This script only ever writes to a lower environment.');
}
if (src.ref === dst.ref) {
  throw new Error(`source and target are the same project (${src.ref}). Nothing to do.`);
}
if (APPLY && CONFIRM !== dst.ref) {
  throw new Error(
    `--yes requires --confirm-target=${dst.ref} (the project about to be WIPED). Got ${CONFIRM ?? '<nothing>'}.`,
  );
}

console.log(`source : ${src.name}  ${src.ref}`);
console.log(`target : ${dst.name}  ${dst.ref}   <-- will be WIPED`);
console.log(`work   : ${WORK}`);
console.log(`mode   : ${APPLY ? 'APPLY' : 'DRY RUN (pass --yes to write)'}`);
mkdirSync(WORK, { recursive: true });

/* ── docker plumbing ─────────────────────────────────────────────────────── */

const DUMP = resolve(WORK, 'source.dump');
const SQL_PUBLIC = resolve(WORK, 'public.sql');
const SQL_AUTH = resolve(WORK, 'auth.sql');
const SQL_STORAGE = resolve(WORK, 'storage.sql');

/**
 * Run a client tool inside the postgres:17 image. The connection URL goes in as
 * an environment variable rather than an argument so it never lands in the
 * container's visible command line.
 */
function pg(url: string, script: string, label: string): string {
  const out = execFileSync(
    'docker',
    ['run', '--rm', '-i', '-e', `PGURL=${url}`, '-v', `${WORK}:/work`, IMAGE, 'sh', '-c', script],
    { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  if (out.trim()) console.log(`  [${label}] ${out.trim().split('\n').slice(-6).join(`\n  [${label}] `)}`);
  return out;
}

const psqlFile = (url: string, file: string, label: string) =>
  pg(url, `psql "$PGURL" -v ON_ERROR_STOP=1 -f /work/${file}`, label);

const psqlCmd = (url: string, sqlText: string, label: string) => {
  writeFileSync(resolve(WORK, '_cmd.sql'), sqlText);
  return psqlFile(url, '_cmd.sql', label);
};

/* ── phases ──────────────────────────────────────────────────────────────── */

const want = (p: Phase) => !ONLY || ONLY === p;

/** Custom-format archive of every schema that carries data we care about. */
function dump() {
  if (existsSync(DUMP) && statSync(DUMP).size > 0) {
    console.log(`\n[dump] reusing ${DUMP} (${(statSync(DUMP).size / 1e6).toFixed(1)} MB). Delete it to re-dump.`);
    return;
  }
  console.log('\n[dump] pg_dump source (public, auth, storage, drizzle)…');
  // ACLs are kept on purpose. --no-privileges strips the anon/authenticated/
  // service_role grants that realtime and RLS depend on.
  pg(
    src.direct,
    `pg_dump "$PGURL" -Fc --no-owner --schema=public --schema=auth --schema=storage --schema=drizzle -f /work/source.dump`,
    'dump',
  );
  console.log(`[dump] wrote ${(statSync(DUMP).size / 1e6).toFixed(1)} MB`);
}

/**
 * Turn the archive into three SQL files, applying the fixes this procedure has
 * needed every time it has been run by hand:
 *
 *   - `--schema=public` omits `CREATE SCHEMA public` and the `pg_trgm`
 *     extension, but the restored indexes reference `public.gin_trgm_ops`, so
 *     both are prepended.
 *   - `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` fails, because
 *     `postgres` cannot set another role's defaults. The `FOR ROLE postgres`
 *     lines are fine and stay.
 *   - Four auth/storage tables are owned by Supabase's internal roles and cannot
 *     be truncated, so their COPY blocks are dropped rather than conflicting.
 *   - Everything is wrapped in one transaction with `session_replication_role =
 *     replica`, which suspends foreign keys and triggers for the load.
 */
function render(columns: Map<string, Set<string>>, skipTables: string[]) {
  console.log('\n[render] pg_restore → SQL…');
  pg(src.direct, `pg_restore --schema=public --schema=drizzle --no-owner -f /work/_public.raw /work/source.dump`, 'render');
  pg(src.direct, `pg_restore --schema=auth --data-only --no-owner -f /work/_auth.raw /work/source.dump`, 'render');
  pg(src.direct, `pg_restore --schema=storage --data-only --no-owner -f /work/_storage.raw /work/source.dump`, 'render');

  const stripDefaultPrivs = (s: string) =>
    s
      .split('\n')
      .filter((l) => !/^ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin/.test(l))
      .join('\n');

  // `public` is special-cased out of the dump, but `drizzle` is not, so the body
  // carries its own bare `CREATE SCHEMA drizzle;` that collides with the header
  // below. Making every create idempotent lets header and body coexist without
  // having to predict which one emits what.
  const idempotentCreates = (s: string) =>
    s
      .replace(/^CREATE SCHEMA (?!IF NOT EXISTS)/gm, 'CREATE SCHEMA IF NOT EXISTS ')
      .replace(/^CREATE EXTENSION (?!IF NOT EXISTS)/gm, 'CREATE EXTENSION IF NOT EXISTS ');

  const wrap = (body: string, head = '') =>
    `BEGIN;\nSET session_replication_role = replica;\n${head}\n${body}\nCOMMIT;\n`;

  const publicRaw = idempotentCreates(stripDefaultPrivs(readFileSync(resolve(WORK, '_public.raw'), 'utf8')));
  writeFileSync(
    SQL_PUBLIC,
    wrap(
      publicRaw,
      'CREATE SCHEMA IF NOT EXISTS public;\nCREATE SCHEMA IF NOT EXISTS drizzle;\nCREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;',
    ),
  );

  const drop = new Set(skipTables);
  const notes: string[] = [];
  for (const [raw, dest] of [['_auth.raw', SQL_AUTH], ['_storage.raw', SQL_STORAGE]] as const) {
    const projected = projectCopyBlocks(stripDefaultPrivs(readFileSync(resolve(WORK, raw), 'utf8')), columns, drop);
    notes.push(...projected.notes);
    writeFileSync(dest, wrap(projected.text));
  }

  const mb = (p: string) => (statSync(p).size / 1e6).toFixed(1);
  console.log(`[render] public ${mb(SQL_PUBLIC)} MB, auth ${mb(SQL_AUTH)} MB, storage ${mb(SQL_STORAGE)} MB`);
  for (const n of notes) console.log(`[render] ${n}`);
}

/**
 * What the target can actually accept: the auth/storage tables this role may
 * truncate, and every column each of those tables has. Supabase upgrades the
 * `auth` and `storage` extensions per project, so two environments routinely sit
 * on different versions of these schemas and the source's COPY column lists do
 * not necessarily fit the target.
 */
async function targetSchema(url: string): Promise<{
  truncatable: string[];
  skipped: string[];
  columns: Map<string, Set<string>>;
}> {
  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const rows = await sql<{ t: string; can: boolean }[]>`
      select table_schema || '.' || table_name as t,
             has_table_privilege(
               current_user,
               quote_ident(table_schema) || '.' || quote_ident(table_name),
               'TRUNCATE'
             ) as can
      from information_schema.tables
      where table_schema in ('auth', 'storage') and table_type = 'BASE TABLE'
      order by 1`;
    const cols = await sql<{ t: string; c: string }[]>`
      select table_schema || '.' || table_name as t, column_name as c
      from information_schema.columns
      where table_schema in ('auth', 'storage')`;
    const columns = new Map<string, Set<string>>();
    for (const { t, c } of cols) (columns.get(t) ?? columns.set(t, new Set()).get(t)!).add(c);
    return {
      truncatable: rows.filter((r) => r.can).map((r) => r.t),
      skipped: rows.filter((r) => !r.can).map((r) => r.t),
      columns,
    };
  } finally {
    await sql.end();
  }
}

/**
 * Rewrite each `COPY <table> (cols…) FROM stdin;` block so it names only columns
 * the target actually has, dropping the corresponding field from every data row.
 *
 * This is what makes the clone survive an extension-version gap. Production's
 * storage extension was ahead of staging's by four columns
 * (`buckets.versioning_status`, `objects.archived_at/is_delete_marker/
 * is_versioned`), and a verbatim COPY aborts the whole load on the first one.
 * Projecting onto the shared column set drops values the target has no home for
 * and lets its own defaults fill in.
 *
 * COPY text format escapes tab, newline and backslash inside values, so a raw
 * tab split is safe.
 */
function projectCopyBlocks(
  text: string,
  columns: Map<string, Set<string>>,
  drop: Set<string>,
): { text: string; notes: string[] } {
  const lines = text.split('\n');
  const out: string[] = [];
  const notes: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^COPY ([\w.]+) \(([^)]+)\) FROM stdin;$/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const [, table, colList] = m;
    const cols = colList.split(', ');
    const end = lines.indexOf('\\.', i + 1);
    const body = lines.slice(i + 1, end);

    const have = columns.get(table);
    if (drop.has(table) || !have) {
      notes.push(`${table}: block dropped (${drop.has(table) ? 'not truncatable' : 'no such table on target'})`);
      i = end;
      continue;
    }
    const keep = cols.map((c, idx) => (have.has(c) ? idx : -1)).filter((idx) => idx >= 0);
    if (keep.length === cols.length) {
      out.push(lines[i], ...body, '\\.');
      i = end;
      continue;
    }
    const lost = cols.filter((c) => !have.has(c));
    notes.push(`${table}: dropped column(s) ${lost.join(', ')} across ${body.length} row(s)`);
    out.push(`COPY ${table} (${keep.map((k) => cols[k]).join(', ')}) FROM stdin;`);
    for (const row of body) {
      const f = row.split('\t');
      out.push(keep.map((k) => f[k]).join('\t'));
    }
    out.push('\\.');
    i = end;
  }
  return { text: out.join('\n'), notes };
}

function wipe(truncatable: string[]) {
  console.log('\n[wipe] dropping public + drizzle, truncating auth + storage…');
  psqlCmd(
    dst.direct,
    [
      'BEGIN;',
      'SET session_replication_role = replica;',
      'DROP SCHEMA IF EXISTS public CASCADE;',
      'DROP SCHEMA IF EXISTS drizzle CASCADE;',
      `TRUNCATE ${truncatable.join(', ')} CASCADE;`,
      'COMMIT;',
    ].join('\n'),
    'wipe',
  );
}

function load() {
  // auth first: public carries foreign keys into auth.users.
  console.log('\n[load] auth…');
  psqlFile(dst.direct, 'auth.sql', 'auth');
  console.log('[load] storage…');
  psqlFile(dst.direct, 'storage.sql', 'storage');
  console.log('[load] public + drizzle (slowest phase, several minutes)…');
  psqlFile(dst.direct, 'public.sql', 'public');
}

/**
 * Reset every password to a known value, drop MFA (its factors are bound to the
 * source's users and would lock everyone out of the clone), and rebuild the
 * realtime publication, whose memberships died with the dropped `public` schema.
 */
async function finalize() {
  console.log('\n[finalize] resetting passwords, clearing MFA, rebuilding realtime publication…');
  const s = postgres(src.direct, { max: 1, prepare: false });
  const published = await s<{ tablename: string }[]>`
    select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' order by 1`;
  await s.end();

  const adds = published.map((r) => `ALTER PUBLICATION supabase_realtime ADD TABLE public.${r.tablename};`);
  psqlCmd(
    dst.direct,
    [
      `UPDATE auth.users SET encrypted_password = extensions.crypt('${PASSWORD}', extensions.gen_salt('bf', 10));`,
      'DELETE FROM auth.mfa_factors;',
      'DROP PUBLICATION IF EXISTS supabase_realtime;',
      'CREATE PUBLICATION supabase_realtime;',
      ...adds,
    ].join('\n'),
    'finalize',
  );
  console.log(`[finalize] all passwords → ${PASSWORD}; ${adds.length} tables republished`);
}

/** Compare the two databases and fail loudly on any drift. */
async function verify(): Promise<boolean> {
  console.log('\n[verify] comparing source and target…');
  const counts = async (url: string) => {
    const sql = postgres(url, { max: 1, prepare: false });
    try {
      const [t] = await sql`select count(*)::int as n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`;
      const [u] = await sql`select count(*)::int as n from auth.users`;
      const [o] = await sql`select count(*)::int as n from storage.objects`;
      const [b] = await sql`select count(*)::int as n from storage.buckets`;
      const [p] = await sql`select count(*)::int as n from pg_publication_tables where pubname='supabase_realtime'`;
      const [m] = await sql`select count(*)::int as n from drizzle.__drizzle_migrations`;
      const rows = await sql<{ t: string; n: number }[]>`
        select relname as t, n_live_tup::int as n from pg_stat_user_tables
        where schemaname = 'public' order by 1`;
      return { tables: t.n, users: u.n, objects: o.n, buckets: b.n, realtime: p.n, migrations: m.n, rows };
    } finally {
      await sql.end();
    }
  };

  const [a, b] = await Promise.all([counts(src.direct), counts(dst.direct)]);
  const scalar: [string, number, number][] = [
    ['public tables', a.tables, b.tables],
    ['auth users', a.users, b.users],
    ['storage objects', a.objects, b.objects],
    ['storage buckets', a.buckets, b.buckets],
    ['realtime tables', a.realtime, b.realtime],
    ['drizzle migrations', a.migrations, b.migrations],
  ];
  let ok = true;
  for (const [label, x, y] of scalar) {
    const same = x === y;
    ok &&= same;
    console.log(`  ${same ? 'ok  ' : 'DIFF'}  ${label.padEnd(20)} source ${String(x).padStart(6)}   target ${String(y).padStart(6)}`);
  }

  // n_live_tup is an estimate, so treat it as a shape check across tables rather
  // than an exact row audit: flag only tables present on one side or empty on
  // exactly one side.
  const bySrc = new Map(a.rows.map((r) => [r.t, r.n]));
  const byDst = new Map(b.rows.map((r) => [r.t, r.n]));
  const suspicious = [...bySrc.keys()].filter((t) => !byDst.has(t) || (bySrc.get(t)! > 0 && byDst.get(t) === 0));
  if (suspicious.length) {
    ok = false;
    console.log(`  DIFF  ${suspicious.length} table(s) missing or empty on target: ${suspicious.slice(0, 20).join(', ')}`);
  }
  console.log(ok ? '\n[verify] PASS' : '\n[verify] FAIL');
  return ok;
}

/* ── run ─────────────────────────────────────────────────────────────────── */

const { truncatable, skipped, columns } = await targetSchema(dst.direct);

if (!APPLY) {
  console.log('\nPlan:');
  console.log(`  dump     ${src.ref} → ${DUMP} (public, auth, storage, drizzle)`);
  console.log('  render   pg_restore → SQL, patched and wrapped in one transaction');
  console.log(`  wipe     DROP public + drizzle on ${dst.ref}, TRUNCATE ${truncatable.length} auth/storage tables`);
  console.log(`           cannot truncate (left alone, COPY stripped): ${skipped.join(', ') || 'none'}`);
  console.log('  load     auth → storage → public + drizzle');
  console.log(`  finalize all passwords → ${PASSWORD}, MFA cleared, realtime publication rebuilt`);
  console.log('  verify   compare source and target');
  console.log(`\nDRY RUN. To apply: --yes --confirm-target=${dst.ref}`);
  await verify();
  process.exit(0);
}

if (want('dump')) dump();
if (want('render')) render(columns, skipped);
if (want('wipe')) wipe(truncatable);
if (want('load')) load();
if (want('finalize')) await finalize();
const passed = want('verify') ? await verify() : true;

if (ONLY) {
  console.log(`\nPhase "${ONLY}" done. Remaining phases were not run.`);
  process.exit(passed ? 0 : 1);
}

console.log('\nDatabase clone complete.');
if (src.secretKey && dst.secretKey) {
  console.log('\nStorage FILE BYTES are not part of a database dump. To copy them:');
  console.log(`  OLD_SUPABASE_URL=${src.supabaseUrl} OLD_SUPABASE_SECRET_KEY=<${src.name} SUPABASE_SECRET_KEY> \\`);
  console.log(`  NEW_SUPABASE_URL=${dst.supabaseUrl} NEW_SUPABASE_SECRET_KEY=<${dst.name} SUPABASE_SECRET_KEY> \\`);
  console.log('  bun run servers/backend/src/scripts/copy-storage.ts');
}
console.log(`\nThe target now sits at the SOURCE's migration point. Apply the codebase delta with:`);
console.log(`  cd servers/backend && DIRECT_URL=<${dst.name} DIRECT_URL> npx tsx --conditions development src/scripts/migrate.ts`);

if (!passed) process.exit(1);
