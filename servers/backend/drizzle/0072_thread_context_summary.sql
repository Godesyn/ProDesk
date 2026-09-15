-- Running conversation summary produced by the AI thread's `/compact` command.
-- Set alongside ai_context_reset_at so the model keeps the gist of earlier
-- messages after they drop out of its replay window. Cleared by `/clear`.
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "ai_context_summary" text;
