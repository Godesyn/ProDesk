-- One DM per unordered pair of people.
--
-- The first file allowed to name the 'direct' literal — 0096 added it and had to
-- commit first (Postgres 55P04).
--
-- least()/greatest() normalise the ordering so (A,B) and (B,A) collide. Both are
-- IMMUTABLE over uuid, so the expression is indexable. `createDirect` leans on
-- this for race-safety: two people pressing "message" at the same instant both
-- INSERT, one wins, the loser's onConflictDoNothing returns nothing and it
-- re-selects the winner's row. Without the index they would each get a thread and
-- neither would see the other's messages.
CREATE UNIQUE INDEX IF NOT EXISTS "chat_threads_direct_pair_uq"
  ON "chat_threads" (
    least("participant_a_id", "participant_b_id"),
    greatest("participant_a_id", "participant_b_id")
  )
  WHERE "type" = 'direct'
    AND "participant_a_id" IS NOT NULL
    AND "participant_b_id" IS NOT NULL;
