import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../lib/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The file is a batch of `ALTER TABLE … ENABLE RLS` / `REPLICA IDENTITY FULL` /
// publication adds, each taking an AccessExclusiveLock. During a Railway rolling
// deploy the OLD instance is still serving reads (AccessShareLock) while the NEW
// instance boots and runs this — a classic recipe for a deadlock (40P01). We cap
// how long any single statement will wait for a lock so it fails fast (55P03)
// instead of sitting long enough to deadlock, then retry the whole (idempotent)
// file after a short backoff — by which point the old instance has usually drained.
const LOCK_TIMEOUT_MS = 5_000;
const RETRY_BACKOFF_MS = 1_000;
const MAX_ATTEMPTS = 5;
// deadlock_detected, lock_not_available — both mean "couldn't get the lock right
// now"; a retry once the old instance drains is the fix.
const RETRYABLE_CODES = new Set(['40P01', '55P03']);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Applies `server/sql/rls.sql` — Row-Level Security policies, Realtime publication
 * membership, and Storage policies — which Drizzle does NOT manage (the migrator
 * only runs the `drizzle/` journal). The file is written to be **idempotent**
 * (drop-if-exists policies, create-or-replace functions, guarded publication
 * adds, replica-identity is a no-op when unchanged), so it is safe to run on
 * every boot — and safe to re-run after a partial apply, which is what makes the
 * lock-contention retry below correct. Like the migrator it uses the direct
 * session-mode connection.
 *
 * The `sql/` folder is never compiled, so it sits at `server/sql` in both dev
 * (tsx, src/db) and prod (node, dist/db) — two levels up from this module.
 */
export async function applyRls(): Promise<void> {
  const url = env.DIRECT_URL ?? env.DATABASE_URL;
  const file = path.resolve(__dirname, '../../../../servers/backend/sql/rls.sql');
  const sqlText = await readFile(file, 'utf8');

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Fresh connection per attempt — a statement that timed out mid-batch leaves
    // no partial txn to reason about (each runs autocommit), so a clean client is
    // simplest and cheapest here.
    const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
    try {
      console.log(
        attempt === 1
          ? '▸ Applying RLS / realtime policies (sql/rls.sql)…'
          : `▸ Applying RLS / realtime policies (sql/rls.sql)… (attempt ${attempt}/${MAX_ATTEMPTS})`,
      );
      await client.unsafe(`SET lock_timeout = '${LOCK_TIMEOUT_MS}ms'`);
      await client.unsafe(sqlText);
      console.log('✔ RLS / realtime policies applied.');
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code && RETRYABLE_CODES.has(code) && attempt < MAX_ATTEMPTS) {
        const delay = RETRY_BACKOFF_MS * attempt;
        console.warn(
          `⚠ RLS apply hit ${code} (lock contention, likely a concurrent deploy) — retrying in ${delay}ms (attempt ${attempt}/${MAX_ATTEMPTS}).`,
        );
        await sleep(delay);
        continue;
      }
      throw err;
    } finally {
      await client.end();
    }
  }
}
