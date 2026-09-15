/**
 * CLI entrypoint for the satellite-app Document Locker backfill:
 * `bun run db:backfill-locker-app-uploads [--force] [--stage|--prod]`.
 *
 * You normally do NOT need this. The same pass runs automatically as a one-time
 * initialization step (scripts/initialize-core.ts `ensureAppUploadLockerRows`),
 * guarded by `runOnce` so it executes exactly once per database and is skipped on
 * every later boot. Going forward the locker hooks keep things current.
 *
 * This wrapper exists to:
 *   • run it against an environment you are not restarting, and
 *   • re-run it deliberately with `--force`, which clears the `init_task_runs`
 *     marker first (use after adding a new source to the backfill).
 *
 * Without `--force` this respects the marker and reports that it already ran, so
 * it will not re-scan a database that is already done.
 *
 * The work itself — and the idempotency contract — lives in
 * packages/server-shared/src/modules/locker/backfill.ts.
 *
 * Run from servers/backend. `--conditions development` is required or tsx
 * resolves the stale server-shared dist and the backfill silently no-ops.
 */
import './env-setup.js';
import { db } from '@prodesk/server-shared/db/index';
import { hasRunOnce, resetRunOnce, runOnce } from '@prodesk/server-shared/modules/init/once';
import {
  backfillAppUploadLocker,
  LOCKER_APP_UPLOAD_BACKFILL_KEY,
} from '@prodesk/server-shared/modules/locker/backfill';

const TAG = '[backfill-locker-app-uploads]';
const force = process.argv.includes('--force');

async function run(): Promise<void> {
  if (force) {
    await resetRunOnce(db, LOCKER_APP_UPLOAD_BACKFILL_KEY);
    console.log(`${TAG} --force: cleared the one-time marker, re-running.`);
  } else if (await hasRunOnce(db, LOCKER_APP_UPLOAD_BACKFILL_KEY)) {
    console.log(
      `${TAG} already ran against this database — nothing to do. ` +
        `Pass --force to run it again (e.g. after adding a source).`,
    );
    return;
  }

  const outcome = await runOnce(
    db,
    LOCKER_APP_UPLOAD_BACKFILL_KEY,
    () => backfillAppUploadLocker(db),
    (r) => ({ ...r }),
  );
  if (outcome.status === 'failed') throw outcome.error;
  if (outcome.status === 'skipped') {
    // Another process claimed it between our check and the claim.
    console.log(`${TAG} another process is running it (or just finished) — skipped.`);
    return;
  }

  const r = outcome.result!;
  const per = Object.entries(r.bySource)
    .map(([k, n]) => `${k}=${n}`)
    .join(', ');
  console.log(`${TAG} ${r.candidates} candidate file(s) — ${per}`);
  console.log(
    `${TAG} done — ${r.inserted} mirrored into ${r.brands} brand locker(s), ` +
      `${r.skipped} already present.`,
  );
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`${TAG} fatal`, err);
    process.exit(1);
  });
