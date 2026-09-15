-- One-time initialization tasks: a ledger so a task that must run ONCE PER
-- DATABASE can record that it did, and be skipped on every later boot.
--
-- initialize-core.ts runs on every server start, so its steps are normally
-- written check-then-write against the rows they seed. That pattern does not fit
-- a data backfill, which has no single row to check and would otherwise re-scan
-- its whole source set on every boot. Such a step claims a key here instead.
--
-- `key` is the natural primary key: claiming a task is an INSERT ... ON CONFLICT
-- DO NOTHING, so two servers booting at once cannot both run the same task.
CREATE TABLE IF NOT EXISTS "init_task_runs" (
  "key" text PRIMARY KEY NOT NULL,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  -- Whatever the task wants to keep for audit (counts, summary, error).
  "detail" jsonb
);
