ALTER TABLE "chat_messages" ADD COLUMN "action_edits" jsonb;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "await_settlement_followup" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "settlement_followup_fired_at" timestamp with time zone;
