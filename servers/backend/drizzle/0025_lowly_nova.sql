ALTER TABLE "feature_subscription_products" ADD COLUMN "per_unit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD COLUMN "stripe_subscription_item_id" text;--> statement-breakpoint
ALTER TABLE "feature_subscriptions" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;