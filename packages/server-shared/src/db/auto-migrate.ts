import postgres from 'postgres';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../lib/env.js';
import { runPendingMigrations } from './run-pending-migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Applies any pending Drizzle migrations on startup.
 *
 * The migrator inspects the `__drizzle_migrations` tracking table and the
 * `drizzle/` journal, then runs ONLY the migrations that have not been applied
 * yet — so calling this when the schema is already up to date is a cheap no-op.
 * Each migration file runs in its own transaction (see runPendingMigrations) so
 * an enum value added in one migration can be used by a later one.
 *
 * Migrations use the direct (session-mode, :5432) `DIRECT_URL` connection: the
 * Supabase transaction pooler does not support the prepared statements the
 * migrator issues. The `drizzle/` SQL folder is never compiled, so it lives at
 * `server/drizzle` in both dev (tsx, src/db) and prod (node, dist/db) — two
 * levels up from this module in either case.
 */
export async function runMigrations(): Promise<void> {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  const migrationsFolder = path.resolve(__dirname, '../../../../servers/backend/drizzle');

  const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  try {
    console.log('▸ Checking for pending database migrations…');
    const applied = await runPendingMigrations(client, migrationsFolder);
    console.log(
      applied > 0
        ? `✔ Applied ${applied} migration${applied === 1 ? '' : 's'}; schema is up to date.`
        : '✔ Database schema is up to date.',
    );
  } finally {
    await client.end();
  }
}
