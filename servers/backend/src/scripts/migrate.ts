import './env-setup.js';
import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPendingMigrations } from '@prodesk/server-shared/db/run-pending-migrations';

/**
 * Runs pending Drizzle migrations via the programmatic postgres-js migrator
 * (the same one server startup uses) rather than shelling out to
 * `drizzle-kit migrate`.
 *
 * The CLI swallows the underlying Postgres error and exits abruptly on any
 * connection/auth failure, which is why this script previously could only guess
 * ("terminated abruptly due to a connection issue"). Running the migrator
 * in-process lets us surface the real error — its message, Postgres error
 * `code`, and the failing host — so the cause is obvious.
 *
 * Reads the connection URL straight from the environment (no full env-schema
 * validation) so it stays runnable with only DB credentials present.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// `drizzle/` SQL is never compiled, so it lives at server/drizzle in both dev
// (tsx, src/scripts) and prod (node, dist/scripts) — two levels up either way.
const migrationsFolder = path.resolve(__dirname, '../../drizzle');

// Migrations need the direct session-mode (:5432) connection: the Supabase
// transaction pooler (:6543) does not support the prepared statements / DDL the
// migrator issues.
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;

type PgErrorish = {
  message?: string;
  code?: string;
  hint?: string;
  detail?: string;
  address?: string;
  port?: number;
  cause?: unknown;
};

/**
 * Drizzle wraps the driver error in a `DrizzleQueryError`, so the Postgres
 * `code`/`hint` live on `.cause`. Walk the cause chain and return the first link
 * that actually carries a Postgres error code.
 */
function rootPgError(err: unknown): PgErrorish {
  let cur = err as PgErrorish | undefined;
  while (cur) {
    if (cur.code) return cur;
    cur = cur.cause as PgErrorish | undefined;
  }
  return (err ?? {}) as PgErrorish;
}

/** Pull the postgres-js error fields that actually explain the failure. */
function describeError(err: unknown): void {
  console.error('\n✖ Migration failed!\n');
  console.error(err);

  const e = rootPgError(err);
  const code = e.code ?? '';
  if (e.hint) console.error(`\n💡 Postgres hint: ${e.hint}`);

  if (code === '28P01' || /password authentication failed/i.test(e.message ?? '')) {
    console.error('\n👉 Cause: Database password authentication failed (Postgres 28P01).');
    console.error(
      '👉 Action: Verify the password in DIRECT_URL / DATABASE_URL inside prodesk-web/.env matches your Supabase project.',
    );
  } else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    console.error(
      `\n👉 Cause: Could not resolve the database host${e.address ? ` "${e.address}"` : ''}.`,
    );
    console.error(
      '👉 Action: Check the host in DIRECT_URL / DATABASE_URL — a wrong/typo project ref fails DNS.',
    );
  } else if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'CONNECT_TIMEOUT') {
    console.error(
      `\n👉 Cause: Could not reach the database${e.address ? ` at ${e.address}:${e.port}` : ''} (${code}).`,
    );
    console.error(
      '👉 Action: Confirm the host/port is reachable. Migrations need the direct session-mode connection (:5432, DIRECT_URL), not the :6543 pooler.',
    );
  } else if (code === '3D000') {
    console.error('\n👉 Cause: The target database does not exist (Postgres 3D000).');
    console.error('👉 Action: Check the database name in your connection URL.');
  } else if (code === '42P07' || code === '42701') {
    console.error(`\n👉 Cause: A schema object already exists (Postgres ${code}).`);
    console.error(
      '👉 Action: The migration journal is likely out of sync with the live schema. Inspect __drizzle_migrations and the conflicting migration SQL.',
    );
  } else if (code === '55P04') {
    console.error(
      '\n👉 Cause: A migration uses an enum value that was ADDED earlier in the SAME transaction (Postgres 55P04).',
    );
    console.error(
      '👉 Action: Each migration file runs in its own transaction, so `ALTER TYPE … ADD VALUE` and the SQL that uses the new value must be in SEPARATE migration files (the ADD VALUE commits first). Split them, or rewrite the consumer to avoid the new enum literal (e.g. compare via ::text).',
    );
  } else {
    console.error('\n👉 See the full error above for the Postgres message and code.');
  }
}

if (!url) {
  console.error('\n✖ Migration failed!');
  console.error(
    '\n👉 Cause: Neither DIRECT_URL nor DATABASE_URL is set.',
    '\n👉 Action: Add a database connection URL to prodesk-web/.env.',
  );
  process.exit(1);
}

console.log('▸ Applying pending database migrations…');
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
let ok = false;
try {
  const applied = await runPendingMigrations(client, migrationsFolder);
  console.log(
    applied > 0
      ? `\n✔ Applied ${applied} migration${applied === 1 ? '' : 's'} successfully. 🎉`
      : '\n✔ No pending migrations; schema is already up to date.',
  );
  ok = true;
} catch (err) {
  describeError(err);
} finally {
  await client.end();
}
process.exit(ok ? 0 : 1);
