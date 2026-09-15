CREATE TYPE "public"."payment_account_review_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."payment_account_status" AS ENUM('trial', 'active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."payment_affiliate_status" AS ENUM('active', 'inactive', 'pending', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_annotation_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."payment_builder_mode" AS ENUM('blocks', 'classic', 'quick', 'standard');--> statement-breakpoint
CREATE TYPE "public"."payment_commercial_intent" AS ENUM('ongoing_service', 'fixed_engagement', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."payment_currency" AS ENUM('AUD', 'USD', 'GBP', 'EUR', 'NZD', 'CAD', 'SGD');--> statement-breakpoint
CREATE TYPE "public"."payment_email_template_type" AS ENUM('nudge', 'payment_receipt', 'payment_notification', 'proposal_sent', 'portal_link');--> statement-breakpoint
CREATE TYPE "public"."payment_frequency" AS ENUM('weekly', 'fortnightly', 'monthly', 'quarterly', 'annually');--> statement-breakpoint
CREATE TYPE "public"."payment_lifecycle_event_type" AS ENUM('catch_up', 'card_update', 'skip_requested', 'skip_applied', 'pause_started', 'pause_ended', 'payout_full', 'cancel_requested', 'cancel_confirmed', 'defer_requested', 'defer_approved', 'defer_rejected', 'vendor_override', 'plan_resumed');--> statement-breakpoint
CREATE TYPE "public"."payment_lifecycle_initiator" AS ENUM('payer', 'vendor', 'system');--> statement-breakpoint
CREATE TYPE "public"."payment_lifecycle_request_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."payment_lifecycle_request_type" AS ENUM('defer', 'custom_amount_change', 'pause_extension');--> statement-breakpoint
CREATE TYPE "public"."payment_model" AS ENUM('one_off', 'subscription', 'pay_plan', 'payment_plan', 'dual_option');--> statement-breakpoint
CREATE TYPE "public"."payment_proposal_status" AS ENUM('draft', 'sent', 'viewed', 'engaged', 'accepted', 'paid', 'declined', 'expired', 'archived', 'disputed', 'refunded', 'partially_refunded', 'active', 'cancelled', 'past_due');--> statement-breakpoint
CREATE TYPE "public"."payment_rate_lock_reason" AS ENUM('recover_commitment', 'admin_override');--> statement-breakpoint
CREATE TYPE "public"."payment_recover_waitlist_source" AS ENUM('signup', 'upgrade_prompt', 'settings', 'marketing_page');--> statement-breakpoint
CREATE TYPE "public"."payment_reminder_status" AS ENUM('pending', 'sent', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."payment_renewal_type" AS ENUM('renewal', 'anniversary', 'check_in');--> statement-breakpoint
CREATE TYPE "public"."payment_sequence_halt_reason" AS ENUM('accepted', 'declined', 'in_conversation', 'manual_pause', 'max_messages_reached', 'proposal_auto_pause', 'recover_handoff_day14');--> statement-breakpoint
CREATE TYPE "public"."payment_sequence_message_channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."payment_sequence_message_status" AS ENUM('sent', 'failed', 'skipped', 'queued');--> statement-breakpoint
CREATE TYPE "public"."payment_sequence_run_status" AS ENUM('pending', 'running', 'paused', 'completed', 'halted');--> statement-breakpoint
CREATE TYPE "public"."payment_sequence_type" AS ENUM('cold', 'engagement', 'missed_payment');--> statement-breakpoint
CREATE TYPE "public"."payment_sms_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'opted_out');--> statement-breakpoint
CREATE TYPE "public"."payment_sms_trigger" AS ENUM('proposal_sent', 'proposal_viewed', 'proposal_accepted', 'payment_received', 'payment_overdue', 'chase_1', 'chase_2');--> statement-breakpoint
CREATE TYPE "public"."payment_support_ticket_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."payment_support_ticket_status" AS ENUM('open', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."payment_template_category" AS ENUM('general', 'web_design', 'branding', 'photography', 'copywriting', 'consulting', 'marketing', 'development', 'video', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_tier" AS ENUM('send', 'close', 'recover');--> statement-breakpoint
CREATE TYPE "public"."payment_tier_change_initiator" AS ENUM('settings', 'contextual_prompt', 'admin', 'auto');--> statement-breakpoint
CREATE TYPE "public"."payment_txn_status" AS ENUM('pending', 'paid', 'failed', 'refunded', 'disputed', 'due', 'overdue', 'succeeded');--> statement-breakpoint
CREATE TYPE "public"."payment_txn_type" AS ENUM('one_off', 'installment', 'subscription');--> statement-breakpoint
ALTER TYPE "public"."staff_permission" ADD VALUE 'paymentsViewer';--> statement-breakpoint
CREATE TABLE "payment_account_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"reviewed_by_user_id" uuid,
	"status" "payment_account_review_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"business_name" text,
	"trading_name" text,
	"abn" text,
	"industry" text,
	"team_size" text,
	"monthly_volume_estimate" text,
	"email" text,
	"phone" text,
	"website" text,
	"address" text,
	"country" text DEFAULT 'AU' NOT NULL,
	"logo_url" text,
	"logo_key" text,
	"status" "payment_account_status" DEFAULT 'trial' NOT NULL,
	"onboarding_state" text DEFAULT 'signup' NOT NULL,
	"stripe_connect_account_id" text,
	"stripe_connect_status" text DEFAULT 'not_connected' NOT NULL,
	"stripe_connect_onboarded" boolean DEFAULT false NOT NULL,
	"platform_fee_percent" integer DEFAULT 300 NOT NULL,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"review_notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"twilio_from_number" text,
	"twilio_account_sid" text,
	"twilio_auth_token" text,
	"sms_sender_id" text,
	"sms_monthly_cap" integer DEFAULT 500,
	"sms_enabled" boolean DEFAULT false NOT NULL,
	"postmark_server_token" text,
	"postmark_from_email" text,
	"email_enabled" boolean DEFAULT true NOT NULL,
	"pipedrive_api_key" text,
	"pipedrive_connected" boolean DEFAULT false NOT NULL,
	"pipedrive_access_token" text,
	"pipedrive_refresh_token" text,
	"pipedrive_token_expires_at" timestamp with time zone,
	"pipedrive_api_domain" text,
	"pipedrive_connected_at" timestamp with time zone,
	"pipedrive_pipeline_id" integer,
	"pipedrive_stage_id" integer,
	"pipedrive_won_stage_id" integer,
	"xero_access_token" text,
	"xero_refresh_token" text,
	"xero_token_expires_at" timestamp with time zone,
	"xero_tenant_id" text,
	"xero_connected_at" timestamp with time zone,
	"default_currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"default_tax_rate" text DEFAULT '10.00' NOT NULL,
	"tax_label" text DEFAULT 'GST' NOT NULL,
	"tax_behaviour_default" text DEFAULT 'inclusive' NOT NULL,
	"timezone" text DEFAULT 'Australia/Sydney' NOT NULL,
	"auto_chase_enabled" boolean DEFAULT false NOT NULL,
	"chase_delay_days" integer DEFAULT 3 NOT NULL,
	"chase_schedule_task_uid" text,
	"review_conditions" jsonb,
	"proposal_theme" text DEFAULT 'agency',
	"myob_access_token" text,
	"myob_refresh_token" text,
	"myob_token_expires_at" timestamp with time zone,
	"myob_company_file_id" text,
	"myob_connected_at" timestamp with time zone,
	"tier" "payment_tier" DEFAULT 'close' NOT NULL,
	"tier_default_rate" numeric(4, 2) DEFAULT '4.50' NOT NULL,
	"tier_changed_at" timestamp with time zone,
	"tier_change_history" jsonb DEFAULT '[]'::jsonb,
	"recover_committed_until" timestamp with time zone,
	"recover_committed_proposal_ids" jsonb DEFAULT '[]'::jsonb,
	"fee_percentage_override" numeric(4, 2),
	"fee_percentage_override_reason" text,
	"invited_to_recover_at" timestamp with time zone,
	"thank_you_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_accounts_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "payment_activity_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" uuid,
	"proposal_id" uuid,
	"client_id" uuid,
	"action" text NOT NULL,
	"event_type" text,
	"entity_type" text,
	"entity_id" uuid,
	"actor_id" uuid,
	"actor_type" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_addons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"unit" text DEFAULT 'month',
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"applies_to_product_ids" jsonb DEFAULT '[]'::jsonb,
	"type" text DEFAULT 'recurring' NOT NULL,
	"quantity_behaviour" text DEFAULT 'fixed' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_affiliate_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"stripe_transfer_id" text,
	"status" text DEFAULT 'paid' NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_affiliate_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"affiliate_id" uuid NOT NULL,
	"proposal_id" uuid,
	"brand_id" uuid NOT NULL,
	"commission_cents" integer DEFAULT 0 NOT NULL,
	"referred_name" text,
	"referred_email" text,
	"signed_up_at" timestamp with time zone,
	"status" text DEFAULT 'pending' NOT NULL,
	"volume_cents" integer DEFAULT 0 NOT NULL,
	"earned_cents" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_affiliates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"code" text NOT NULL,
	"commission_percent" integer DEFAULT 1000 NOT NULL,
	"status" "payment_affiliate_status" DEFAULT 'pending' NOT NULL,
	"stripe_connect_id" text,
	"total_earned_cents" integer DEFAULT 0 NOT NULL,
	"total_paid_cents" integer DEFAULT 0 NOT NULL,
	"referral_code" text,
	"active_referrals" integer DEFAULT 0 NOT NULL,
	"total_referrals" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_affiliates_code_unique" UNIQUE("code"),
	CONSTRAINT "payment_affiliates_referral_code_unique" UNIQUE("referral_code")
);
--> statement-breakpoint
CREATE TABLE "payment_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"resource" text,
	"resource_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_brand_kits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"logo_light_url" text,
	"logo_light_key" text,
	"logo_dark_url" text,
	"logo_dark_key" text,
	"brand_logo_url" text,
	"brand_logo_key" text,
	"favicon_url" text,
	"primary_color" text DEFAULT '#0E0E0C',
	"accent_color" text DEFAULT '#D9F542',
	"accent_color_2" text DEFAULT '#FFFFFF',
	"background_color" text DEFAULT '#F4F1E8',
	"text_color" text DEFAULT '#0E0E0C',
	"dark_color" text DEFAULT '#0A0A0A',
	"light_color" text DEFAULT '#F4F1E8',
	"heading_font" text DEFAULT 'Inter Tight',
	"body_font" text DEFAULT 'Inter Tight',
	"custom_font_url" text,
	"hero_image_url" text,
	"video_url" text,
	"default_intro_copy" text,
	"default_next_steps_copy" text,
	"default_terms_url" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_brand_kits_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "payment_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"colour_hex" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_by_user_id" uuid,
	"type" text DEFAULT 'note',
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_client_portal_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_client_portal_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payment_client_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_client_id" uuid NOT NULL,
	"referred_client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"reward_cents" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"credit_applied" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_client_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"proposal_id" uuid,
	"client_id" uuid,
	"nps_score" integer,
	"feedback" text,
	"token" text,
	"opened_at" timestamp with time zone,
	"rating" integer,
	"would_refer" boolean,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_client_surveys_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "payment_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"business_name" text,
	"email" text,
	"mobile" text,
	"address" text,
	"abn" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"pipedrive_person_id" text,
	"pipedrive_org_id" text,
	"pipedrive_deal_id" text,
	"internal_notes" text,
	"tags" text,
	"stripe_customer_id" text,
	"do_not_sms" boolean DEFAULT false NOT NULL,
	"do_not_email" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_email_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"proposal_id" uuid,
	"client_id" uuid,
	"to_email" text NOT NULL,
	"subject" text NOT NULL,
	"template_type" "payment_email_template_type",
	"postmark_message_id" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"bounced_at" timestamp with time zone,
	"spam_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"type" "payment_email_template_type" NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"is_custom" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_feature_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"key" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"description" text,
	"rollout_percent" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_feature_flags_name_unique" UNIQUE("name"),
	CONSTRAINT "payment_feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "payment_installment_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"installment_number" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"stripe_payment_intent_id" text,
	"status" "payment_txn_status" DEFAULT 'pending' NOT NULL,
	"brand_id" uuid,
	"client_id" uuid,
	"currency" text DEFAULT 'AUD',
	"total_installments" integer,
	"charge_error" text,
	"auto_charge_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_lifecycle_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"payer_id" uuid,
	"request_type" "payment_lifecycle_request_type" NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_user_id" uuid,
	"status" "payment_lifecycle_request_status" DEFAULT 'pending' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_reason" text,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_outbound_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"proposal_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"http_status" integer,
	"response_body" text,
	"error_message" text,
	"next_retry_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_payer_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"payer_id" uuid,
	"event_type" "payment_lifecycle_event_type" NOT NULL,
	"initiated_by" "payment_lifecycle_initiator" NOT NULL,
	"initiated_by_user_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stripe_object_id" text
);
--> statement-breakpoint
CREATE TABLE "payment_plan_tier_rate_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_key" text NOT NULL,
	"changed_by_user_id" uuid,
	"changed_by_name" text,
	"old_pct" numeric(5, 2) NOT NULL,
	"new_pct" numeric(5, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_plan_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"label" text,
	"tagline" text,
	"blurb" text,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_plan_tiers_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "payment_pricing_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"tiers" jsonb DEFAULT '[]'::jsonb,
	"display_rule" text DEFAULT 'show_all' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"base_price_cents" integer DEFAULT 0 NOT NULL,
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"unit" text DEFAULT 'project',
	"custom_unit_label" text,
	"tax_behaviour" text DEFAULT 'inclusive' NOT NULL,
	"default_payment_model" "payment_model" DEFAULT 'one_off' NOT NULL,
	"cost_cents" integer DEFAULT 0,
	"status" text DEFAULT 'active' NOT NULL,
	"category" text,
	"type_tag" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proposal_annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"block_id" text,
	"anchor_text" text,
	"comment" text NOT NULL,
	"client_name" text,
	"client_email" text,
	"status" "payment_annotation_status" DEFAULT 'open' NOT NULL,
	"owner_reply" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proposal_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"client_name" text,
	"client_email" text,
	"question" text NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"answered_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proposal_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_config" jsonb DEFAULT '{}'::jsonb,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"client_id" uuid,
	"template_id" uuid,
	"builder_mode" "payment_builder_mode" DEFAULT 'blocks' NOT NULL,
	"quick_set_id" uuid,
	"status" "payment_proposal_status" DEFAULT 'draft' NOT NULL,
	"title" text DEFAULT 'Untitled Proposal' NOT NULL,
	"slug" text,
	"personalised_intro" text,
	"internal_note" text,
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payment_model" "payment_model" DEFAULT 'one_off' NOT NULL,
	"payment_config" jsonb DEFAULT '{}'::jsonb,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"fx_rate_at_send" text,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"stripe_subscription_id" text,
	"stripe_payment_intent_id" text,
	"pipedrive_deal_id" integer,
	"assigned_user_id" uuid,
	"created_by_user_id" uuid,
	"chase_token" text,
	"chase_token_expiry" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"viewed_at" timestamp with time zone,
	"engaged_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_viewed_at" timestamp with time zone,
	"max_scroll_depth" integer DEFAULT 0 NOT NULL,
	"win_score" integer DEFAULT 0 NOT NULL,
	"signature_data" text,
	"signature_ip" text,
	"signed_pdf_url" text,
	"signed_pdf_key" text,
	"applied_fee_percentage" numeric(4, 2),
	"applied_tier" "payment_tier",
	"rate_lock_reason" "payment_rate_lock_reason",
	"in_conversation_since" timestamp with time zone,
	"sequences_paused" boolean DEFAULT false NOT NULL,
	"commercial_intent" "payment_commercial_intent" DEFAULT 'ongoing_service' NOT NULL,
	"commercial_intent_label" text,
	"allow_payer_cancel" boolean DEFAULT true NOT NULL,
	"allow_payer_pause" boolean DEFAULT false NOT NULL,
	"allow_payer_payout_full" boolean DEFAULT false NOT NULL,
	"allow_payer_skip" boolean DEFAULT false NOT NULL,
	"allow_payer_card_update" boolean DEFAULT true NOT NULL,
	"min_term_completion_required" boolean DEFAULT false NOT NULL,
	"commitment_period_months" integer,
	"early_payout_discount_pct" numeric(4, 2),
	"max_skips_per_year" integer DEFAULT 2 NOT NULL,
	"max_pause_days_per_year" integer DEFAULT 60 NOT NULL,
	"max_deferrals_per_plan" integer DEFAULT 2 NOT NULL,
	"content_overrides" jsonb DEFAULT 'null'::jsonb,
	"dual_option_discount_pct" numeric(5, 2),
	"dual_option_discount_label" text,
	"accepted_option" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_proposals_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment_quick_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb,
	"payment_models_available" jsonb DEFAULT '[]'::jsonb,
	"default_payment_model" "payment_model" DEFAULT 'one_off' NOT NULL,
	"default_configuration" jsonb DEFAULT '{}'::jsonb,
	"line_items_json" text DEFAULT '[]' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_recover_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" "payment_recover_waitlist_source" NOT NULL,
	"estimated_monthly_missed_cents" integer,
	"preferred_contact" text,
	"notes" text,
	CONSTRAINT "payment_recover_waitlist_brand_id_unique" UNIQUE("brand_id")
);
--> statement-breakpoint
CREATE TABLE "payment_recurring_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"title" text NOT NULL,
	"line_items_json" text DEFAULT '[]' NOT NULL,
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"frequency" "payment_frequency" DEFAULT 'monthly' NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"last_sent_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"schedule_cron_task_uid" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_renewal_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"proposal_id" uuid,
	"type" "payment_renewal_type" DEFAULT 'renewal' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"status" "payment_reminder_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sequence_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"sequence_type" "payment_sequence_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"touchpoints" jsonb DEFAULT '[]'::jsonb,
	"rules" jsonb DEFAULT '{}'::jsonb,
	"last_edited_at" timestamp with time zone,
	"last_edited_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sequence_message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence_run_id" uuid NOT NULL,
	"touchpoint_index" integer NOT NULL,
	"channel" "payment_sequence_message_channel" NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" "payment_sequence_message_status" NOT NULL,
	"skip_reason" text,
	"rendered_body" text,
	"placeholders_used" jsonb DEFAULT '{}'::jsonb,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sequence_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"sequence_type" "payment_sequence_type" NOT NULL,
	"status" "payment_sequence_run_status" DEFAULT 'pending' NOT NULL,
	"halt_reason" "payment_sequence_halt_reason",
	"touchpoints_fired" jsonb DEFAULT '[]'::jsonb,
	"next_fire_at" timestamp with time zone,
	"view_count" integer DEFAULT 0 NOT NULL,
	"last_view_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sms_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"twilio_sid" text,
	"status" text DEFAULT 'sent' NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"proposal_id" uuid,
	"client_id" uuid,
	"to_number" text NOT NULL,
	"body" text NOT NULL,
	"status" "payment_sms_status" DEFAULT 'queued' NOT NULL,
	"trigger" "payment_sms_trigger",
	"twilio_sid" text,
	"error_code" text,
	"error_message" text,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sms_opt_outs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" text NOT NULL,
	"keyword" text DEFAULT 'STOP' NOT NULL,
	"opted_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_sms_opt_outs_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "payment_support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"user_id" uuid,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" "payment_support_ticket_status" DEFAULT 'open' NOT NULL,
	"priority" "payment_support_ticket_priority" DEFAULT 'medium' NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'scratch' NOT NULL,
	"category" "payment_template_category" DEFAULT 'general' NOT NULL,
	"thumbnail_url" text,
	"thumbnail_key" text,
	"structure" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"default_line_items" jsonb DEFAULT '[]'::jsonb,
	"brand_kit_id" uuid,
	"library_template_id" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL,
	"acceptance_rate" text DEFAULT '0.00',
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_tier_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"from_tier" "payment_tier" NOT NULL,
	"to_tier" "payment_tier" NOT NULL,
	"changed_by_user_id" uuid,
	"initiated_via" "payment_tier_change_initiator" NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_plan_count" integer DEFAULT 0 NOT NULL,
	"committed_plan_value_cents" bigint DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"proposal_id" uuid,
	"client_id" uuid,
	"stripe_payment_intent_id" text,
	"stripe_invoice_id" text,
	"stripe_charge_id" text,
	"amount_cents" integer NOT NULL,
	"platform_fee_cents" integer DEFAULT 0 NOT NULL,
	"currency" "payment_currency" DEFAULT 'AUD' NOT NULL,
	"status" "payment_txn_status" DEFAULT 'pending' NOT NULL,
	"type" "payment_txn_type" DEFAULT 'one_off' NOT NULL,
	"installment_number" integer,
	"receipt_url" text,
	"idempotency_key" text,
	"failure_reason" text,
	"application_fee_cents" integer DEFAULT 0 NOT NULL,
	"chase_status" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"stripe_event_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_deliveries_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"description" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"event_filter" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_account_reviews" ADD CONSTRAINT "payment_account_reviews_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_account_reviews" ADD CONSTRAINT "payment_account_reviews_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_activity_log" ADD CONSTRAINT "payment_activity_log_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_activity_log" ADD CONSTRAINT "payment_activity_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_activity_log" ADD CONSTRAINT "payment_activity_log_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_activity_log" ADD CONSTRAINT "payment_activity_log_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_addons" ADD CONSTRAINT "payment_addons_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_payouts" ADD CONSTRAINT "payment_affiliate_payouts_affiliate_id_payment_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."payment_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_payouts" ADD CONSTRAINT "payment_affiliate_payouts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_referrals" ADD CONSTRAINT "payment_affiliate_referrals_affiliate_id_payment_affiliates_id_fk" FOREIGN KEY ("affiliate_id") REFERENCES "public"."payment_affiliates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_referrals" ADD CONSTRAINT "payment_affiliate_referrals_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliate_referrals" ADD CONSTRAINT "payment_affiliate_referrals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_affiliates" ADD CONSTRAINT "payment_affiliates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_audit_logs" ADD CONSTRAINT "payment_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_brand_kits" ADD CONSTRAINT "payment_brand_kits_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_categories" ADD CONSTRAINT "payment_categories_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_notes" ADD CONSTRAINT "payment_client_notes_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_notes" ADD CONSTRAINT "payment_client_notes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_notes" ADD CONSTRAINT "payment_client_notes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_portal_tokens" ADD CONSTRAINT "payment_client_portal_tokens_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_portal_tokens" ADD CONSTRAINT "payment_client_portal_tokens_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_referrals" ADD CONSTRAINT "payment_client_referrals_referrer_client_id_payment_clients_id_fk" FOREIGN KEY ("referrer_client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_referrals" ADD CONSTRAINT "payment_client_referrals_referred_client_id_payment_clients_id_fk" FOREIGN KEY ("referred_client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_referrals" ADD CONSTRAINT "payment_client_referrals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_surveys" ADD CONSTRAINT "payment_client_surveys_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_surveys" ADD CONSTRAINT "payment_client_surveys_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_client_surveys" ADD CONSTRAINT "payment_client_surveys_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_clients" ADD CONSTRAINT "payment_clients_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_email_logs" ADD CONSTRAINT "payment_email_logs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_email_logs" ADD CONSTRAINT "payment_email_logs_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_email_logs" ADD CONSTRAINT "payment_email_logs_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_email_templates" ADD CONSTRAINT "payment_email_templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_schedules" ADD CONSTRAINT "payment_installment_schedules_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_schedules" ADD CONSTRAINT "payment_installment_schedules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_installment_schedules" ADD CONSTRAINT "payment_installment_schedules_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_payer_id_payment_clients_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_lifecycle_requests" ADD CONSTRAINT "payment_lifecycle_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_outbound_webhook_deliveries" ADD CONSTRAINT "payment_outbound_webhook_deliveries_endpoint_id_payment_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."payment_webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_outbound_webhook_deliveries" ADD CONSTRAINT "payment_outbound_webhook_deliveries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_outbound_webhook_deliveries" ADD CONSTRAINT "payment_outbound_webhook_deliveries_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" ADD CONSTRAINT "payment_payer_lifecycle_events_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" ADD CONSTRAINT "payment_payer_lifecycle_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" ADD CONSTRAINT "payment_payer_lifecycle_events_payer_id_payment_clients_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_payer_lifecycle_events" ADD CONSTRAINT "payment_payer_lifecycle_events_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_plan_tier_rate_audit" ADD CONSTRAINT "payment_plan_tier_rate_audit_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_pricing_tables" ADD CONSTRAINT "payment_pricing_tables_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_products" ADD CONSTRAINT "payment_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_annotations" ADD CONSTRAINT "payment_proposal_annotations_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_questions" ADD CONSTRAINT "payment_proposal_questions_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_questions" ADD CONSTRAINT "payment_proposal_questions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_questions" ADD CONSTRAINT "payment_proposal_questions_answered_by_user_id_users_id_fk" FOREIGN KEY ("answered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_revisions" ADD CONSTRAINT "payment_proposal_revisions_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposal_revisions" ADD CONSTRAINT "payment_proposal_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_template_id_payment_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."payment_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_quick_set_id_payment_quick_sets_id_fk" FOREIGN KEY ("quick_set_id") REFERENCES "public"."payment_quick_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_proposals" ADD CONSTRAINT "payment_proposals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_quick_sets" ADD CONSTRAINT "payment_quick_sets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recover_waitlist" ADD CONSTRAINT "payment_recover_waitlist_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recurring_invoices" ADD CONSTRAINT "payment_recurring_invoices_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_recurring_invoices" ADD CONSTRAINT "payment_recurring_invoices_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_renewal_reminders" ADD CONSTRAINT "payment_renewal_reminders_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_renewal_reminders" ADD CONSTRAINT "payment_renewal_reminders_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_renewal_reminders" ADD CONSTRAINT "payment_renewal_reminders_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_definitions" ADD CONSTRAINT "payment_sequence_definitions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_definitions" ADD CONSTRAINT "payment_sequence_definitions_last_edited_by_user_id_users_id_fk" FOREIGN KEY ("last_edited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_message_log" ADD CONSTRAINT "payment_sequence_message_log_sequence_run_id_payment_sequence_runs_id_fk" FOREIGN KEY ("sequence_run_id") REFERENCES "public"."payment_sequence_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_runs" ADD CONSTRAINT "payment_sequence_runs_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sequence_runs" ADD CONSTRAINT "payment_sequence_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sms_logs" ADD CONSTRAINT "payment_sms_logs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sms_messages" ADD CONSTRAINT "payment_sms_messages_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sms_messages" ADD CONSTRAINT "payment_sms_messages_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sms_messages" ADD CONSTRAINT "payment_sms_messages_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_support_tickets" ADD CONSTRAINT "payment_support_tickets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_support_tickets" ADD CONSTRAINT "payment_support_tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_templates" ADD CONSTRAINT "payment_templates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_templates" ADD CONSTRAINT "payment_templates_brand_kit_id_payment_brand_kits_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."payment_brand_kits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_tier_changes" ADD CONSTRAINT "payment_tier_changes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_tier_changes" ADD CONSTRAINT "payment_tier_changes_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_proposal_id_payment_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."payment_proposals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_client_id_payment_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."payment_clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_deliveries" ADD CONSTRAINT "payment_webhook_deliveries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_endpoints" ADD CONSTRAINT "payment_webhook_endpoints_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_account_reviews_brand_idx" ON "payment_account_reviews" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_activity_log_brand_idx" ON "payment_activity_log" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_activity_log_occurred_idx" ON "payment_activity_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "payment_addons_brand_idx" ON "payment_addons" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_affiliate_payouts_brand_idx" ON "payment_affiliate_payouts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_affiliate_referrals_brand_idx" ON "payment_affiliate_referrals" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_affiliates_brand_idx" ON "payment_affiliates" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_audit_logs_brand_idx" ON "payment_audit_logs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_categories_brand_idx" ON "payment_categories" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_client_notes_brand_idx" ON "payment_client_notes" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_client_portal_tokens_brand_idx" ON "payment_client_portal_tokens" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_client_referrals_brand_idx" ON "payment_client_referrals" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_client_surveys_brand_idx" ON "payment_client_surveys" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_clients_brand_idx" ON "payment_clients" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_email_logs_brand_idx" ON "payment_email_logs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_email_templates_brand_idx" ON "payment_email_templates" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_installment_schedules_proposal_idx" ON "payment_installment_schedules" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_installment_schedules_brand_idx" ON "payment_installment_schedules" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_lifecycle_requests_brand_idx" ON "payment_lifecycle_requests" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_outbound_webhook_deliveries_brand_idx" ON "payment_outbound_webhook_deliveries" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_outbound_webhook_deliveries_retry_idx" ON "payment_outbound_webhook_deliveries" USING btree ("next_retry_at");--> statement-breakpoint
CREATE INDEX "payment_payer_lifecycle_events_brand_idx" ON "payment_payer_lifecycle_events" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_payer_lifecycle_events_proposal_idx" ON "payment_payer_lifecycle_events" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_pricing_tables_brand_idx" ON "payment_pricing_tables" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_products_brand_idx" ON "payment_products" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_proposal_annotations_proposal_idx" ON "payment_proposal_annotations" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_proposal_questions_brand_idx" ON "payment_proposal_questions" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_proposal_revisions_proposal_idx" ON "payment_proposal_revisions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_proposals_brand_idx" ON "payment_proposals" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_proposals_client_idx" ON "payment_proposals" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "payment_proposals_status_idx" ON "payment_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payment_quick_sets_brand_idx" ON "payment_quick_sets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_recurring_invoices_brand_idx" ON "payment_recurring_invoices" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_renewal_reminders_brand_idx" ON "payment_renewal_reminders" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_sequence_definitions_brand_idx" ON "payment_sequence_definitions" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_sequence_message_log_run_idx" ON "payment_sequence_message_log" USING btree ("sequence_run_id");--> statement-breakpoint
CREATE INDEX "payment_sequence_runs_brand_idx" ON "payment_sequence_runs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_sequence_runs_proposal_idx" ON "payment_sequence_runs" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_sequence_runs_next_fire_idx" ON "payment_sequence_runs" USING btree ("next_fire_at");--> statement-breakpoint
CREATE INDEX "payment_sms_logs_brand_idx" ON "payment_sms_logs" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_sms_messages_brand_idx" ON "payment_sms_messages" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_support_tickets_brand_idx" ON "payment_support_tickets" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_templates_brand_idx" ON "payment_templates" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_tier_changes_brand_idx" ON "payment_tier_changes" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_brand_idx" ON "payment_transactions" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_transactions_proposal_idx" ON "payment_transactions" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_deliveries_brand_idx" ON "payment_webhook_deliveries" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_endpoints_brand_idx" ON "payment_webhook_endpoints" USING btree ("brand_id");