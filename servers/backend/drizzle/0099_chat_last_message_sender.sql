-- `chat_threads.last_message_sender_id`, for databases that already ran 0097.
--
-- The column is declared in 0097 as well, which is correct for a fresh database.
-- This file exists because 0097 had already been recorded as applied on the
-- development database by the time the column was added to it, and the migrator
-- gates on the journal watermark — so an edit to an applied file is silently
-- never replayed. Editing 0097 and hoping is the failure mode this avoids.
--
-- Both declarations are `IF NOT EXISTS`, so a fresh database gets the column from
-- 0097 and this is a no-op, while an already-migrated one gets it here.
--
-- What it is for: the messenger inbox's Owed / Waiting / Settled split is decided
-- by who spoke last, and by nothing else. Unread is the wrong signal — a message
-- you READ and did not answer is still owed, which is exactly the case every
-- other messenger loses.
ALTER TABLE "chat_threads"
  ADD COLUMN IF NOT EXISTS "last_message_sender_id" uuid
  REFERENCES "users" ("id") ON DELETE SET NULL;
