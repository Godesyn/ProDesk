CREATE TYPE "public"."review_milestone_kind" AS ENUM('sticker_pack', 'gold_plaque', 'platinum_plaque');--> statement-breakpoint
CREATE TYPE "public"."review_milestone_status" AS ENUM('unlocked', 'claimed', 'shipped');--> statement-breakpoint
CREATE TYPE "public"."review_platform_kind" AS ENUM('google', 'facebook', 'trustpilot', 'yelp', 'tripadvisor');--> statement-breakpoint
CREATE TYPE "public"."review_request_channel" AS ENUM('email');--> statement-breakpoint
CREATE TYPE "public"."review_request_status" AS ENUM('sent', 'opened', 'completed');--> statement-breakpoint
CREATE TYPE "public"."review_submission_type" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TYPE "public"."staff_permission" ADD VALUE 'reviews';--> statement-breakpoint
ALTER TYPE "public"."staff_permission" ADD VALUE 'reviewsViewer';--> statement-breakpoint
CREATE TABLE "review_directory_profiles" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"opt_in" boolean DEFAULT true NOT NULL,
	"website_url" text,
	"description" text,
	"city" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_directory_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "review_embed_collection_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_embed_collections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"theme" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_embed_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"theme" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_embed_configs_location_id_unique" UNIQUE("location_id")
);
--> statement-breakpoint
CREATE TABLE "review_embed_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid,
	"collection_id" uuid,
	"referrer" varchar(512),
	"ua" varchar(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_industries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_industries_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "review_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"industry" text DEFAULT 'other' NOT NULL,
	"logo_url" text,
	"bad_review_email" text,
	"redirect_url" text,
	"created_by_user_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_milestone_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"location_id" uuid,
	"kind" "review_milestone_kind" NOT NULL,
	"status" "review_milestone_status" DEFAULT 'unlocked' NOT NULL,
	"shipping_address" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"tracking_number" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "review_platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"platform" "review_platform_kind" NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_referral_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"code" text NOT NULL,
	"months_earned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_referral_codes_owner_user_id_unique" UNIQUE("owner_user_id"),
	CONSTRAINT "review_referral_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "review_referral_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"redeemed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"sent_by_user_id" uuid,
	"customer_name" text NOT NULL,
	"customer_email" text,
	"channel" "review_request_channel" DEFAULT 'email' NOT NULL,
	"status" "review_request_status" DEFAULT 'sent' NOT NULL,
	"review_link" text NOT NULL,
	"custom_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"stars" integer NOT NULL,
	"selected_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_review" text,
	"private_feedback" text,
	"platform_clicked" text,
	"submission_type" "review_submission_type" NOT NULL,
	"public_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_tag_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industry_slug" text NOT NULL,
	"tag" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_win_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_directory_profiles" ADD CONSTRAINT "review_directory_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_collection_locations" ADD CONSTRAINT "review_embed_collection_locations_collection_id_review_embed_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."review_embed_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_collection_locations" ADD CONSTRAINT "review_embed_collection_locations_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_collections" ADD CONSTRAINT "review_embed_collections_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_configs" ADD CONSTRAINT "review_embed_configs_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_views" ADD CONSTRAINT "review_embed_views_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_embed_views" ADD CONSTRAINT "review_embed_views_collection_id_review_embed_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."review_embed_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_locations" ADD CONSTRAINT "review_locations_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_locations" ADD CONSTRAINT "review_locations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_milestone_rewards" ADD CONSTRAINT "review_milestone_rewards_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_milestone_rewards" ADD CONSTRAINT "review_milestone_rewards_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_platforms" ADD CONSTRAINT "review_platforms_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_referral_codes" ADD CONSTRAINT "review_referral_codes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_referral_redemptions" ADD CONSTRAINT "review_referral_redemptions_redeemed_by_user_id_users_id_fk" FOREIGN KEY ("redeemed_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_requests" ADD CONSTRAINT "review_requests_sent_by_user_id_users_id_fk" FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_submissions" ADD CONSTRAINT "review_submissions_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_win_tags" ADD CONSTRAINT "review_win_tags_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_embed_col_loc_collection_idx" ON "review_embed_collection_locations" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_embed_collections_slug_idx" ON "review_embed_collections" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "review_embed_collections_brand_idx" ON "review_embed_collections" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_locations_slug_lower_idx" ON "review_locations" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "review_locations_brand_idx" ON "review_locations" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "review_milestone_rewards_brand_idx" ON "review_milestone_rewards" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "review_platforms_location_idx" ON "review_platforms" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_platforms_loc_platform_idx" ON "review_platforms" USING btree ("location_id","platform");--> statement-breakpoint
CREATE INDEX "review_referral_redemptions_code_idx" ON "review_referral_redemptions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "review_requests_location_idx" ON "review_requests" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "review_requests_brand_idx" ON "review_requests" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "review_submissions_location_idx" ON "review_submissions" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "review_submissions_created_idx" ON "review_submissions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "review_tag_presets_industry_idx" ON "review_tag_presets" USING btree ("industry_slug");--> statement-breakpoint
CREATE INDEX "review_win_tags_location_idx" ON "review_win_tags" USING btree ("location_id");