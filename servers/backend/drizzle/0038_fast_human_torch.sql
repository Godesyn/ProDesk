CREATE TYPE "public"."proposal_kind" AS ENUM('marketplace', 'payer');--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'engaged';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'archived';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'active';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'past_due';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'disputed';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'refunded';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'partially_refunded';--> statement-breakpoint
ALTER TYPE "public"."proposal_status" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "kind" "proposal_kind" DEFAULT 'marketplace' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "recipient_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "builder_mode" "payment_builder_mode" DEFAULT 'blocks' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "quick_set_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "personalised_intro" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "internal_note" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "structure" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "payment_model" "payment_model" DEFAULT 'one_off' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "payment_config" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "total_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "subtotal_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "tax_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "currency" "payment_currency" DEFAULT 'AUD' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "fx_rate_at_send" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "stripe_payment_method_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "stripe_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "pipedrive_deal_id" integer;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "assigned_user_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "chase_token" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "chase_token_expiry" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "engaged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "last_viewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "max_scroll_depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "win_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "signature_data" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "signature_ip" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "signed_pdf_url" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "signed_pdf_key" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "applied_fee_percentage" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "applied_tier" "payment_tier";--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "rate_lock_reason" "payment_rate_lock_reason";--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "in_conversation_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "sequences_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "commercial_intent" "payment_commercial_intent" DEFAULT 'ongoing_service' NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "commercial_intent_label" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_payer_cancel" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_payer_pause" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_payer_payout_full" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_payer_skip" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "allow_payer_card_update" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "min_term_completion_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "commitment_period_months" integer;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "early_payout_discount_pct" numeric(4, 2);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "max_skips_per_year" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "max_pause_days_per_year" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "max_deferrals_per_plan" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "content_overrides" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "dual_option_discount_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "dual_option_discount_label" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "accepted_option" text;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_recipient_contact_id_payment_clients_id_fk" FOREIGN KEY ("recipient_contact_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_template_id_payment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."payment_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_quick_set_id_payment_quick_sets_id_fk" FOREIGN KEY ("quick_set_id") REFERENCES "public"."payment_quick_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proposals_kind_idx" ON "proposals" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "proposals_recipient_contact_idx" ON "proposals" USING btree ("recipient_contact_id");--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_slug_unique" UNIQUE("slug");