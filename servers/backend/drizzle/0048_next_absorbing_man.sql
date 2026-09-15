ALTER TABLE "chat_messages" ADD COLUMN "action_outcomes" jsonb;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "ai_context_reset_at" timestamp with time zone;