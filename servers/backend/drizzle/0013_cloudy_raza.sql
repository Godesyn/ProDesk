ALTER TYPE "public"."thread_type" ADD VALUE 'ai';--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"thread_id" uuid,
	"message_id" uuid,
	"user_id" uuid,
	"client" text,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "sender_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "chatbot_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "is_ai" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "ai_compaction_state" jsonb;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN "ai_actions_enabled_prodesk" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "global_settings" ADD COLUMN "ai_actions_enabled_dashboard" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_thread_id_chat_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage" ADD CONSTRAINT "ai_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_brand_idx" ON "ai_usage" USING btree ("brand_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_created_idx" ON "ai_usage" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_chatbot_thread_id_chat_threads_id_fk" FOREIGN KEY ("chatbot_thread_id") REFERENCES "public"."chat_threads"("id") ON DELETE set null ON UPDATE no action;