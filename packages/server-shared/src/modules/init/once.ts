/**
 * `runOnce` — execute an initialization task ONCE PER DATABASE.
 *
 * scripts/initialize-core.ts runs on every server boot, so its steps are
 * normally written check-then-write against the rows they seed. A data backfill
 * has no single row to check: re-running it is harmless but it re-scans its whole
 * source set every time the server restarts. `runOnce` gives those tasks a
 * durable "already done" marker in `init_task_runs` so the work happens exactly
 * once per database and every later boot is a single indexed lookup.
 *
 * CONCURRENCY — claiming the key is `INSERT ... ON CONFLICT DO NOTHING` and the
 * key is the primary key, so if several servers boot at once exactly one wins the
 * insert and runs the task; the others see the conflict and skip immediately.
 * There is no window where two run it.
 *
 * CRASH RECOVERY — the claim is written BEFORE the task runs, so a process that
 * dies mid-task leaves a row with `completedAt` NULL. That row is treated as
 * RECLAIMABLE: the next boot re-runs the task rather than leaving it permanently
 * half-done. Tasks handed to `runOnce` must therefore still be individually
 * idempotent — the marker is an optimisation that skips redundant work, never the
 * only thing standing between you and duplicate rows.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { initTaskRuns } from '../../db/schema.js';
import type { DB } from '../../db/index.js';

export interface RunOnceOutcome<T> {
  /** 'ran' — this process executed the task. 'skipped' — already done. 'failed' — it threw. */
  status: 'ran' | 'skipped' | 'failed';
  /** The task's return value when it ran. */
  result?: T;
  error?: Error;
}

/**
 * Run `task` only if `key` has never completed against this database.
 *
 * Never throws: a task failure is reported as `{ status: 'failed', error }` and
 * releases the claim so the next boot retries. Callers on the boot path decide
 * how loudly to complain.
 *
 * `detail` maps the task's result into the audit payload stored on the row.
 */
export async function runOnce<T>(
  db: DB,
  key: string,
  task: () => Promise<T>,
  detail?: (result: T) => Record<string, unknown>,
): Promise<RunOnceOutcome<T>> {
  // Claim the key. A row left behind by a crashed run (completedAt NULL) is
  // reclaimed by re-stamping startedAt — the update matches only the unfinished
  // row, so it cannot steal a key from a completed task or a live winner's task
  // that has already finished.
  const claimed = await db
    .insert(initTaskRuns)
    .values({ key })
    .onConflictDoNothing()
    .returning({ key: initTaskRuns.key });

  if (!claimed.length) {
    const reclaimed = await db
      .update(initTaskRuns)
      .set({ startedAt: new Date() })
      .where(and(eq(initTaskRuns.key, key), isNull(initTaskRuns.completedAt)))
      .returning({ key: initTaskRuns.key });
    if (!reclaimed.length) return { status: 'skipped' };
  }

  try {
    const result = await task();
    await db
      .update(initTaskRuns)
      .set({ completedAt: new Date(), detail: detail?.(result) ?? null })
      .where(eq(initTaskRuns.key, key));
    return { status: 'ran', result };
  } catch (err) {
    // Release the claim so the next boot retries, and keep the reason for audit.
    await db
      .update(initTaskRuns)
      .set({ completedAt: null, detail: { error: (err as Error).message } })
      .where(eq(initTaskRuns.key, key))
      .catch(() => {
        /* the task failure is what matters — don't mask it with a bookkeeping error */
      });
    return { status: 'failed', error: err as Error };
  }
}

/** Whether a one-time task has already COMPLETED against this database. */
export async function hasRunOnce(db: DB, key: string): Promise<boolean> {
  const [row] = await db
    .select({ completedAt: initTaskRuns.completedAt })
    .from(initTaskRuns)
    .where(eq(initTaskRuns.key, key))
    .limit(1);
  return !!row?.completedAt;
}

/** Clear a task's marker so the next boot runs it again (for re-running a backfill). */
export async function resetRunOnce(db: DB, key: string): Promise<void> {
  await db.delete(initTaskRuns).where(eq(initTaskRuns.key, key));
}
