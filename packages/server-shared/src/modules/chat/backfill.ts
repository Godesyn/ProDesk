/**
 * ONE-TIME (per database): give every EXISTING user their personal notes thread.
 *
 * The `you` self-thread is created on signup (`ensurePlatformAdminThread`), so
 * going forward nobody is missing one. Accounts that predate that hook — or that
 * were provisioned by a path which skipped it, or whose chat tables were rebuilt
 * — have none, and until the messenger started ensuring it on boot there was no
 * gesture in any app that could create one. This closes that historical gap in a
 * single pass instead of waiting for each of those users to open the messenger.
 *
 * Idempotent twice over: it only looks at users who have no `you` membership, and
 * `ensureNotesThread` re-checks (and adopts an orphaned thread rather than adding
 * a second) for each one. Safe to run again at any time — `runOnce` only spares it
 * the scan.
 */
import { sql } from 'drizzle-orm';
import { users } from '../../db/schema.js';
import type { DB } from '../../db/index.js';
import { ensureNotesThread } from './threads.js';

/** Bump this to make the next boot re-run the pass. */
export const CHAT_NOTES_BACKFILL_KEY = 'chat_notes_threads_backfill_v1';

export interface NotesBackfillResult {
  /** Users found without a notes thread. */
  candidates: number;
  /** Threads created. */
  created: number;
  /** Existing orphan threads adopted by adding the missing member row. */
  adopted: number;
  /** Users whose ensure threw — reported, never fatal. */
  failed: number;
}

export async function backfillNotesThreads(db: DB): Promise<NotesBackfillResult> {
  // One indexed anti-join rather than "every user, then ensure": on a database
  // where the gap is already closed this reads no rows and does no writes, which
  // is what makes the pass cheap enough to leave on the boot path.
  const missing = await db
    .select({ id: users.id })
    .from(users)
    .where(
      sql`not exists (
        select 1
          from chat_thread_members m
          join chat_threads t on t.id = m.thread_id
         where m.user_id = ${users.id} and t.type = 'you'
      )`,
    );

  const result: NotesBackfillResult = {
    candidates: missing.length,
    created: 0,
    adopted: 0,
    failed: 0,
  };

  // Sequential on purpose. This runs during boot next to the other seed steps,
  // and a fan-out over every user in the database would spike the connection pool
  // to save a second on a pass that happens once.
  for (const u of missing) {
    try {
      const { created } = await ensureNotesThread(u.id, db);
      if (created) result.created++;
      else result.adopted++;
    } catch {
      // One bad user (e.g. a row whose auth account is half-deleted) must not
      // abandon the rest of the pass.
      result.failed++;
    }
  }
  return result;
}
