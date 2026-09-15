ALTER TABLE "chat_messages" ADD COLUMN "pending_actions" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "resolved_action_ids" text[];