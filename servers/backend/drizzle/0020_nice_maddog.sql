ALTER TABLE "feature_subscription_products" ADD COLUMN "feature_keys" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
-- Backfill: existing products grant exactly their primary feature key.
UPDATE "feature_subscription_products" SET "feature_keys" = ARRAY["feature_key"] WHERE "feature_keys" = '{}'::text[];