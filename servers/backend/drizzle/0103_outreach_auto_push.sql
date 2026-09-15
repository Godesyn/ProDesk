-- The review stop becomes a hold, not a gate.
--
-- A run that finished verifying parked in `review` until a human clicked Push,
-- and in practice the answer was always yes — the contacts have already been
-- scraped, paid for, deduped and verified by the time anyone sees them, and the
-- one decision left is one nobody was actually making. A gate that is always
-- opened isn't a gate; it's a queue of runs waiting for someone to remember.
--
-- So the run now schedules its own push and says when: `auto_push_at` is
-- stamped five minutes ahead the moment the run reaches review, and the tick
-- that finds `now() >= auto_push_at` moves it to `pushing` on its own.
--
-- NULL is the held state, and it means two different things depending on how it
-- got there — both of which want the same behaviour:
--
--   * an operator pressed Hold, and the run waits for them indefinitely
--   * the row predates this column, and its run is long finished
--
-- Either way a NULL never auto-pushes, which is the safe direction for a column
-- that ends in email being sent to strangers.
ALTER TABLE "outreach_list_runs" ADD COLUMN IF NOT EXISTS "auto_push_at" timestamptz;

-- Which run a prospect came in on.
--
-- Already recorded, as `source = 'list-build:<run id>'`, and that string stays
-- the identity — it is written by the push and read by nothing else, so there
-- is no drift to worry about. What it lacked was an index, and it needs one now
-- for the same reason the column suddenly matters: a run's prospects can be
-- counted and deleted as a set, and both of those scan by source.
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_source_idx"
  ON "outreach_prospect_state" ("source");
