-- Persist the latest out-of-band "continuation" suggestions (next-prompt chips)
-- for an AI thread, so the Strategy starter-chip bar rehydrates them on reload.
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "ai_continuations" jsonb;
