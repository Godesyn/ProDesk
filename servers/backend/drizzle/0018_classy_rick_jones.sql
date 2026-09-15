CREATE TYPE "public"."feature_subscription_interval" AS ENUM('week', 'month');--> statement-breakpoint
CREATE TYPE "public"."feature_subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'incomplete', 'unpaid');--> statement-breakpoint
CREATE TABLE "feature_subscription_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" uuid NOT NULL,
	"interval" "feature_subscription_interval" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"stripe_price_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_subscription_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"feature_key" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"card_title" text,
	"card_subtitle" text,
	"card_description" text,
	"card_button_label" text,
	"stripe_product_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_subscription_products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "feature_subscription_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"features" jsonb DEFAULT '[]'::jsonb,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"tier_id" uuid,
	"price_id" uuid,
	"status" "feature_subscription_status" DEFAULT 'incomplete' NOT NULL,
	"interval" "feature_subscription_interval" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'AUD' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_for_brand_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "feature_subscription_prices" ADD CONSTRAINT "feature_subscription_prices_tier_id_feature_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."feature_subscription_tiers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscription_tiers" ADD CONSTRAINT "feature_subscription_tiers_product_id_feature_subscription_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."feature_subscription_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_product_id_feature_subscription_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."feature_subscription_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_tier_id_feature_subscription_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."feature_subscription_tiers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_price_id_feature_subscription_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."feature_subscription_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD CONSTRAINT "feature_subscriptions_created_for_brand_id_brands_id_fk" FOREIGN KEY ("created_for_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_sub_prices_tier_idx" ON "feature_subscription_prices" USING btree ("tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_sub_prices_tier_interval_active_uniq" ON "feature_subscription_prices" USING btree ("tier_id","interval") WHERE "feature_subscription_prices"."active";--> statement-breakpoint
CREATE INDEX "feature_sub_products_feature_idx" ON "feature_subscription_products" USING btree ("feature_key");--> statement-breakpoint
CREATE INDEX "feature_sub_tiers_product_idx" ON "feature_subscription_tiers" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "feature_subs_user_idx" ON "feature_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feature_subs_user_product_idx" ON "feature_subscriptions" USING btree ("user_id","product_id");