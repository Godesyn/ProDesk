/**
 * CLI entrypoint for the personal-notes-thread backfill:
 * `bun run db:backfill-notes-threads [--force]`.
 *
 * You normally do NOT need this. The same pass runs automatically as a one-time
 * initialization step (scripts/initialize-core.ts `ensureNotesThreadsForAllUsers`),
 * guarded by `runOnce` so it executes exactly once per database. New accounts get
 * their notes thread on signup, and the messenger ensures it on boot.
 *
 * This wrapper exists to:
 *   • run it against an environment you are not restarting, and
 *   • re-run it deliberately with `--force`, which clears the `init_task_runs`
 *     marker first.
 *
 * Without `--force` this respects the marker and reports that it already ran.
 *
 * The work itself — and the idempotency contract — lives in
 * packages/server-shared/src/modules/chat/backfill.ts.
 *
 * Run from servers/backend. `--conditions development` is required or tsx
 * resolves the stale server-shared dist and the backfill silently no-ops.
 */
import './env-setup.js';
import { db } from '@prodesk/server-shared/db/index';
import { hasRunOnce, resetRunOnce, runOnce } from '@prodesk/server-shared/modules/init/once';
import {
  backfillNotesThreads,
  CHAT_NOTES_BACKFILL_KEY,
} from '@prodesk/server-shared/modules/chat/backfill';

const TAG = '[backfill-notes-threads]';
const force = process.argv.includes('--force');

async function run(): Promise<void> {
  if (force) {
    await resetRunOnce(db, CHAT_NOTES_BACKFILL_KEY);
    console.log(`${TAG} --force: cleared the one-time marker, re-running.`);
  } else if (await hasRunOnce(db, CHAT_NOTES_BACKFILL_KEY)) {
    console.log(
      `${TAG} already ran against this database — nothing to do. Pass --force to run it again.`,
    );
    return;
  }

  const outcome = await runOnce(
    db,
    CHAT_NOTES_BACKFILL_KEY,
    () => backfillNotesThreads(db),
    (r) => ({ ...r }),
  );
  if (outcome.status === 'failed') throw outcome.error;
  if (outcome.status === 'skipped') {
    // Another process claimed it between our check and the claim.
    console.log(`${TAG} another process is running it (or just finished) — skipped.`);
    return;
  }

  const r = outcome.result!;
  console.log(
    `${TAG} done — ${r.candidates} user(s) without a notes thread: ` +
      `${r.created} created, ${r.adopted} adopted, ${r.failed} failed.`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TAG} fatal`, err);
    process.exit(1);
  });
