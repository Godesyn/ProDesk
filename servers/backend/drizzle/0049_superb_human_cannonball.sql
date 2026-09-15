CREATE TYPE "public"."signature_event_type" AS ENUM('banner_click', 'cta_click', 'proofmatic_review_click', 'proofmatic_reviews_click', 'social_click', 'email_click', 'phone_click', 'website_click');--> statement-breakpoint
CREATE TYPE "public"."signature_rotation_mode" AS ENUM('sequential', 'random');--> statement-breakpoint
ALTER TYPE "public"."staff_permission" ADD VALUE 'signatures';--> statement-breakpoint
ALTER TYPE "public"."staff_permission" ADD VALUE 'signaturesViewer';--> statement-breakpoint
CREATE TABLE "saved_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" text NOT NULL,
	"data" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"signature_brand_id" uuid,
	"member_id" uuid,
	"campaign_id" uuid,
	"event_type" "signature_event_type" NOT NULL,
	"label" text,
	"ip_hash" text,
	"user_agent" text,
	"referer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"created_by_user_id" uuid,
	"name" text NOT NULL,
	"collection_name" text,
	"website" text,
	"address" text,
	"primary_color" text DEFAULT '#4A7C59',
	"secondary_color" text DEFAULT '#2D3748',
	"font_family" text DEFAULT 'Arial, sans-serif',
	"bar_color" text DEFAULT '#E07B39',
	"bar_text_color" text DEFAULT '#1A1A2E',
	"bar_logo_key" text,
	"bar_logo_url" text,
	"brand_display_name" text,
	"brand_tagline" text,
	"logo_key" text,
	"logo_url" text,
	"logo_width" integer DEFAULT 120,
	"powered_by_logo_key" text,
	"powered_by_logo_url" text,
	"powered_by_label" text DEFAULT 'POWERED BY',
	"logo_link_url" text,
	"bar_logo_link_url" text,
	"powered_by_link_url" text,
	"proofmatic_url" text,
	"proofmatic_reviews_url" text,
	"rendered_icon_urls" text,
	"disclaimer" text,
	"default_template" text DEFAULT 'classic',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_campaign_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"image_key" text NOT NULL,
	"image_url" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_brand_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"link_url" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"rotation_mode" "signature_rotation_mode" DEFAULT 'sequential' NOT NULL,
	"rotation_counter" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signature_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signature_brand_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text,
	"department" text,
	"email" text,
	"phone" text,
	"mobile" text,
	"photo_key" text,
	"photo_url" text,
	"photo_link_url" text,
	"linkedin" text,
	"twitter" text,
	"instagram" text,
	"facebook" text,
	"youtube" text,
	"github" text,
	"spotify" text,
	"pinterest" text,
	"tiktok" text,
	"google_maps" text,
	"google_reviews" text,
	"trustpilot" text,
	"tripadvisor" text,
	"uber_eats" text,
	"deliveroo" text,
	"expedia" text,
	"rss" text,
	"amazon" text,
	"website_link" text,
	"proofmatic_url" text,
	"proofmatic_reviews_url" text,
	"rendered_icon_urls" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "saved_signatures" ADD CONSTRAINT "saved_signatures_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_signatures" ADD CONSTRAINT "saved_signatures_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_analytics_events" ADD CONSTRAINT "signature_analytics_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_analytics_events" ADD CONSTRAINT "signature_analytics_events_signature_brand_id_signature_brands_id_fk" FOREIGN KEY ("signature_brand_id") REFERENCES "public"."signature_brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_analytics_events" ADD CONSTRAINT "signature_analytics_events_member_id_signature_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."signature_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_analytics_events" ADD CONSTRAINT "signature_analytics_events_campaign_id_signature_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."signature_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_brands" ADD CONSTRAINT "signature_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_brands" ADD CONSTRAINT "signature_brands_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_campaign_banners" ADD CONSTRAINT "signature_campaign_banners_campaign_id_signature_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."signature_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_campaigns" ADD CONSTRAINT "signature_campaigns_signature_brand_id_signature_brands_id_fk" FOREIGN KEY ("signature_brand_id") REFERENCES "public"."signature_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_campaigns" ADD CONSTRAINT "signature_campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_campaigns" ADD CONSTRAINT "signature_campaigns_member_id_signature_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."signature_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_members" ADD CONSTRAINT "signature_members_signature_brand_id_signature_brands_id_fk" FOREIGN KEY ("signature_brand_id") REFERENCES "public"."signature_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signature_members" ADD CONSTRAINT "signature_members_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_signatures_brand_idx" ON "saved_signatures" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "signature_analytics_events_brand_idx" ON "signature_analytics_events" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "signature_analytics_events_sig_brand_idx" ON "signature_analytics_events" USING btree ("signature_brand_id");--> statement-breakpoint
CREATE INDEX "signature_brands_brand_idx" ON "signature_brands" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "signature_campaign_banners_campaign_idx" ON "signature_campaign_banners" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "signature_campaigns_sig_brand_idx" ON "signature_campaigns" USING btree ("signature_brand_id");--> statement-breakpoint
CREATE INDEX "signature_members_sig_brand_idx" ON "signature_members" USING btree ("signature_brand_id");--> statement-breakpoint
CREATE INDEX "signature_members_brand_idx" ON "signature_members" USING btree ("brand_id");