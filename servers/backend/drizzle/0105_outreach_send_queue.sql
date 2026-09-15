-- The send queue.
--
-- Scraping stays parallel — several regions can be billing at once, and there
-- is no reason to make the operator wait on one to start the next. SENDING is
-- what gets a queue: a finished run is a few hundred strangers about to receive
-- an email, they all land in the one campaign, and which region goes first is a
-- decision worth being able to make and change.
--
-- `queue_position` is that order. It spans every run, not just the waiting ones,
-- so a run's place is stable: a run that has already sent keeps the position it
-- sent in, which is what makes the list readable as a history as well as a plan.
--
-- `skipped_at` is the escape hatch the order needs. The queue is STRICT — a run
-- that is still scraping holds up the ones behind it, because otherwise the
-- order is a suggestion rather than a decision — so there has to be a way to say
-- "not this one" without deleting it or letting it block. Skipping parks a run
-- out of the queue; it keeps its position, so unskipping puts it back exactly
-- where it was rather than at the end.
ALTER TABLE "outreach_list_runs"
  ADD COLUMN IF NOT EXISTS "queue_position" integer,
  ADD COLUMN IF NOT EXISTS "skipped_at" timestamp with time zone;

-- Existing rows get their position from the order they were created in, which
-- is the order they sent in — so the ledger reads the same after this migration
-- as it did before it.
WITH ordered AS (
  SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS "pos"
  FROM "outreach_list_runs"
)
UPDATE "outreach_list_runs" r
SET "queue_position" = ordered."pos"
FROM ordered
WHERE r."id" = ordered."id" AND r."queue_position" IS NULL;

-- Every run has a place from here on. `createRun` fills it from max+1, and the
-- NOT NULL is what lets the gate compare positions without a null branch — a
-- null position compares as neither ahead of nor behind anything, so the run
-- holding it would be invisible to the queue and send out of turn.
ALTER TABLE "outreach_list_runs"
  ALTER COLUMN "queue_position" SET DEFAULT 0;
ALTER TABLE "outreach_list_runs"
  ALTER COLUMN "queue_position" SET NOT NULL;

-- The gate reads "is there anything ahead of me that hasn't sent", on every
-- tick of every waiting run, so it is worth an index. Not unique: two runs
-- swapping places would have to violate it mid-transaction.
CREATE INDEX IF NOT EXISTS "outreach_list_runs_queue_position_idx"
  ON "outreach_list_runs" ("queue_position");
