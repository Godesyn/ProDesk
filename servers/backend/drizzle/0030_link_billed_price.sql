ALTER TABLE "short_links" ADD COLUMN "billed_price_id" uuid;--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_billed_price_id_feature_subscription_prices_id_fk" FOREIGN KEY ("billed_price_id") REFERENCES "public"."feature_subscription_prices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: lock every currently-active link to its owner's current URL-shortener
-- subscription price, so existing links keep exactly what they're billed today and
-- only links activated AFTER this migration pick up a later (changed) price. Links
-- whose owner has no active subscription (e.g. beta) stay NULL.
UPDATE "short_links" sl
SET "billed_price_id" = (
  SELECT fs."price_id"
  FROM "feature_subscriptions" fs
  JOIN "brands" b ON b."owner_id" = fs."user_id"
  JOIN "feature_subscription_products" p ON fs."product_id" = p."id"
  WHERE b."id" = sl."brand_id"
    AND (p."feature_key" = 'url_shortener' OR p."per_unit" = true)
    AND fs."status" IN ('active', 'trialing')
  ORDER BY fs."created_at" DESC
  LIMIT 1
)
WHERE sl."is_active" = true AND sl."billed_price_id" IS NULL;
