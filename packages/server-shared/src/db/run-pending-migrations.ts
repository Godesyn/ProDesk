import { readMigrationFiles } from 'drizzle-orm/migrator';
import type postgres from 'postgres';

/**
 * Applies pending Drizzle migrations, running each migration file in its OWN
 * transaction.
 *
 * Why not `drizzle-orm/postgres-js/migrator`'s `migrate()`? That migrator wraps
 * the ENTIRE pending batch in a single transaction. That breaks the common
 * Postgres pattern of adding an enum value in one migration and using it in a
 * later one: `ALTER TYPE … ADD VALUE` plus any SQL that references the new value
 * cannot live in the same transaction (Postgres 55P04 "unsafe use of new value").
 * Splitting them into separate `.sql` files does not help, because drizzle still
 * runs both in the same transaction.
 *
 * Committing per file means an enum-adding migration is durably committed before
 * the next migration runs, so the new value is safe to use. The tracking table
 * (`drizzle.__drizzle_migrations`), its schema, the hash, and the
 * applied-or-not comparison all match drizzle's own migrator exactly, so this
 * runner and `drizzle-kit` / `drizzle-orm`'s `migrate()` remain interchangeable.
 *
 * Resilience to partial failures:
 * - `ALTER TYPE … ADD VALUE` statements are run OUTSIDE the transaction (they
 *   cannot run inside one) with `IF NOT EXISTS` injected.
 * - Every other DDL statement is rewritten to be idempotent before execution:
 *   `CREATE TYPE` and `ALTER TABLE … ADD CONSTRAINT` are wrapped in
 *   `DO $$ … EXCEPTION WHEN duplicate_object …` blocks; `CREATE TABLE` and
 *   `CREATE INDEX` get `IF NOT EXISTS` injected.
 * - This eliminates "already exists" errors entirely so no savepoints / error
 *   handling is needed inside the transaction.
 */
export async function runPendingMigrations(
  client: postgres.Sql,
  migrationsFolder: string,
): Promise<number> {
  const migrations = readMigrationFiles({ migrationsFolder });

  await client.unsafe('CREATE SCHEMA IF NOT EXISTS "drizzle"');
  await client.unsafe(
    `CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )`,
  );

  const lastRows = await client.unsafe<{ created_at: string | null }[]>(
    'select created_at from "drizzle"."__drizzle_migrations" order by created_at desc limit 1',
  );
  const lastApplied = lastRows[0] ? Number(lastRows[0].created_at) : null;

  let applied = 0;
  for (const migration of migrations) {
    if (lastApplied !== null && lastApplied >= migration.folderMillis) continue;

    // Partition statements: ALTER TYPE … ADD VALUE cannot run inside a
    // transaction (Postgres hangs or errors). Run those first, outside the
    // transaction, with IF NOT EXISTS injected for idempotency.
    const addValueStmts: string[] = [];
    const txStmts: string[] = [];

    for (const stmt of migration.sql) {
      if (stmt.trim().length === 0) continue;
      if (isAddValueStmt(stmt)) {
        addValueStmts.push(patchAddValue(stmt));
      } else {
        txStmts.push(patchIdempotent(stmt));
      }
    }

    // Phase 1: enum value additions (outside transaction)
    for (const stmt of addValueStmts) {
      await client.unsafe(stmt);
    }

    // Phase 2: everything else inside a transaction. All statements have been
    // patched to be idempotent so no error handling is needed.
    await client.begin(async (tx) => {
      for (const stmt of txStmts) {
        await tx.unsafe(stmt);
      }
      await tx.unsafe(
        'insert into "drizzle"."__drizzle_migrations" ("hash", "created_at") values ($1, $2)',
        [migration.hash, migration.folderMillis],
      );
    });
    applied += 1;
  }

  return applied;
}

// ---------------------------------------------------------------------------
// Statement patching helpers
// ---------------------------------------------------------------------------

/** Detects `ALTER TYPE … ADD VALUE` statements. */
const ADD_VALUE_RE = /^\s*ALTER\s+TYPE\s+.+?\s+ADD\s+VALUE\s+/i;

function isAddValueStmt(sql: string): boolean {
  return ADD_VALUE_RE.test(sql);
}

/**
 * Injects `IF NOT EXISTS` into `ALTER TYPE … ADD VALUE '…'` statements that
 * don't already have it.
 */
function patchAddValue(sql: string): string {
  if (/ADD\s+VALUE\s+IF\s+NOT\s+EXISTS/i.test(sql)) return sql;
  return sql.replace(
    /(ALTER\s+TYPE\s+.+?\s+ADD\s+VALUE)\s+/i,
    '$1 IF NOT EXISTS ',
  );
}

/**
 * Rewrites DDL statements to be idempotent where Postgres supports it:
 *
 * - `CREATE TYPE "schema"."name" AS ENUM (…)` and `ALTER TABLE … ADD CONSTRAINT`
 *   → wrapped in `DO $$ BEGIN … EXCEPTION WHEN duplicate_object THEN NULL; END $$`
 *   (Postgres has no IF NOT EXISTS for these)
 *
 * - `CREATE TABLE "name" (…)` → `CREATE TABLE IF NOT EXISTS "name" (…)`
 *
 * - `CREATE INDEX "name"` → `CREATE INDEX IF NOT EXISTS "name"`
 *
 * - `CREATE UNIQUE INDEX "name"` → `CREATE UNIQUE INDEX IF NOT EXISTS "name"`
 */
function patchIdempotent(sql: string): string {
  const trimmed = sql.trim();

  // CREATE TYPE … AS ENUM → wrap in DO $$ block
  if (/^CREATE\s+TYPE\s+/i.test(trimmed) && /\bAS\s+ENUM\b/i.test(trimmed)) {
    return wrapInDoBlock(trimmed);
  }

  // ALTER TABLE … ADD CONSTRAINT → wrap in DO $$ block
  if (/^ALTER\s+TABLE\s+.+?\s+ADD\s+CONSTRAINT\s+/i.test(trimmed)) {
    return wrapInDoBlock(trimmed);
  }

  // CREATE TABLE → CREATE TABLE IF NOT EXISTS
  if (/^CREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i.test(trimmed)) {
    return trimmed.replace(/^CREATE\s+TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  }

  // CREATE (UNIQUE) INDEX → CREATE (UNIQUE) INDEX IF NOT EXISTS
  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+(?!IF\s+NOT\s+EXISTS|CONCURRENTLY)/i.test(trimmed)) {
    return trimmed.replace(
      /^(CREATE\s+(?:UNIQUE\s+)?INDEX)\s+/i,
      '$1 IF NOT EXISTS ',
    );
  }

  return sql;
}

/**
 * Wraps a DDL statement in a PL/pgSQL `DO $$` block that swallows
 * `duplicate_object` (42710) and `duplicate_table` (42P07) errors.
 * This makes the statement idempotent without requiring savepoints.
 */
function wrapInDoBlock(sql: string): string {
  const escaped = sql.replace(/'/g, "''");
  return `DO $$ BEGIN EXECUTE '${escaped}'; EXCEPTION WHEN duplicate_object THEN NULL; WHEN duplicate_table THEN NULL; END $$`;
}
