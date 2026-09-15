-- Bound the webhook reconcile sweep, and give it something to trim.
--
-- WHY AN ATTEMPT COUNTER
-- `reconcileUnprocessedEvents` picks up every receipt with no `processed_at`
-- and re-runs its effects. It had no upper bound, so an event that can never
-- succeed — a malformed timestamp, a prospect row that has since been deleted,
-- a classifier the account has no key for — was replayed every fifteen minutes
-- forever. For EMAIL_REPLY that replay is an LLM call, so a single poisoned
-- receipt quietly billed ~96 classifications a day for as long as the row
-- existed. The counter stops it after a handful of honest tries and leaves the
-- row on file with its reason, which is the state an operator can act on.
ALTER TABLE "outreach_events"
  ADD COLUMN IF NOT EXISTS "process_attempts" integer NOT NULL DEFAULT 0;

-- The sweep reads exactly this predicate: unprocessed, still within its tries.
-- Partial, because processed receipts are the overwhelming majority and none of
-- them is ever a candidate.
CREATE INDEX IF NOT EXISTS "outreach_events_retryable_idx"
  ON "outreach_events" ("received_at")
  WHERE "processed_at" IS NULL;
