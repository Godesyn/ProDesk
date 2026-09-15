import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.js';
import type { DB } from '../db/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../../../../servers/backend/drizzle');

/**
 * Spin up a hermetic, in-process Postgres (PGlite) with the REAL Drizzle
 * migrations applied — the schema is byte-for-byte what production runs, so an
 * integration test exercises the same DDL (enums, checks, identity columns,
 * the `payouts_one_beneficiary` constraint, …) as the live database.
 *
 * No external Postgres, no Docker, no network: the migration `.sql` files in
 * `server/drizzle/` are replayed statement-by-statement (split on Drizzle's
 * `--> statement-breakpoint` so `ALTER TYPE … ADD VALUE` runs on its own).
 *
 * The returned `db` is the SAME drizzle surface as `db/index.ts`, so any engine
 * function that accepts an injectable `db = defaultDb` (fulfillPurchase,
 * computePayoutSplit, …) can be driven against it. Caller must `close()`.
 *
 * ── THE ONE THING PGLITE CANNOT DO ─────────────────────────────────────────
 * PGlite ships without `pg_trgm`, so migration 0044 — the trigram indexes behind
 * the fuzzy project-board search — cannot be replayed. It used to take the whole
 * harness down with it: `makeTestDb()` threw, every `beforeAll` using it failed,
 * and roughly ten integration tests could not run locally at all. Tests about
 * payouts and billing were being skipped over an index on `projects.title`.
 *
 * So a statement that fails for want of trigram support is skipped and named,
 * and NOTHING else is. A missing column, a broken constraint, a genuine DDL
 * error still throws — the value of this harness is that the schema is
 * byte-for-byte production's, and swallowing migration errors generally would
 * quietly trade that away. Anything that needs trigram matching has to be tested
 * against a real Postgres; nothing does today.
 */

/** A failure that means "PGlite has no pg_trgm", and nothing else. */
function isTrigramGap(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('pg_trgm') ||
    m.includes('gin_trgm_ops') ||
    // What the GIN index creations report once the extension is missing.
    (m.includes('operator class') && m.includes('gin'))
  );
}

export async function makeTestDb(): Promise<{ db: DB; close: () => Promise<void> }> {
  const client = new PGlite();
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const skipped: string[] = [];
  for (const file of files) {
    const text = readFileSync(resolve(migrationsDir, file), 'utf8');
    for (const stmt of text.split('--> statement-breakpoint')) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await client.exec(trimmed);
      } catch (e) {
        const message = (e as Error).message ?? String(e);
        if (!isTrigramGap(message)) {
          throw new Error(`Migration ${file} failed in PGlite: ${message}`);
        }
        skipped.push(`${file}: ${trimmed.split('\n')[0].slice(0, 80)}`);
      }
    }
  }
  if (skipped.length > 0) {
    // Named rather than silent: a test asserting on trigram search would pass
    // here for the wrong reason, and this is the only warning it would get.
    console.warn(
      `[test/db] PGlite has no pg_trgm; skipped ${skipped.length} trigram statement(s):\n  ` +
        skipped.join('\n  '),
    );
  }
  const db = drizzle(client, { schema, casing: 'snake_case' }) as unknown as DB;
  return { db, close: () => client.close() };
}
