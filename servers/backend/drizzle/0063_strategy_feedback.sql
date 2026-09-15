ALTER TABLE "chat_messages" ADD COLUMN "ai_rated_by" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "ai_feedback_resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_ai_rated_by_users_id_fk" FOREIGN KEY ("ai_rated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
