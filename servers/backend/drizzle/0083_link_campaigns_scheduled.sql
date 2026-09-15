-- Campaigns, rebuilt: a short link whose destination CHANGES ON A SCHEDULE.
--
-- A campaign is a short_links row with kind='campaign'. Its destination_url (or
-- fallback_text) is the default served outside every window, and each
-- link_destination_windows row overrides that default for a date range.
--
-- Campaigns bill at their own per-unit rate, so feature_subscription_tiers gains
-- `unit_kind` — which billable unit a tier prices — letting the URL Shortener
-- product carry both the $1/link and $3/campaign rates in one subscription.

ALTER TABLE "feature_subscription_tiers" ADD COLUMN IF NOT EXISTS "unit_kind" text;--> statement-breakpoint

ALTER TABLE "short_links" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "short_links" ADD COLUMN IF NOT EXISTS "fallback_text" text;--> statement-breakpoint

-- A campaign that shows fallback TEXT has no default URL at all, so the column
-- can no longer be NOT NULL. The check constraint below keeps it required for
-- every plain link, which is the invariant that actually mattered.
ALTER TABLE "short_links" ALTER COLUMN "destination_url" DROP NOT NULL;--> statement-breakpoint

ALTER TABLE "short_links" DROP CONSTRAINT IF EXISTS "short_links_destination_ck";--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_destination_ck" CHECK (
  ("short_links"."kind" = 'link' AND "short_links"."destination_url" IS NOT NULL)
  OR ("short_links"."kind" = 'campaign' AND ("short_links"."destination_url" IS NOT NULL OR "short_links"."fallback_text" IS NOT NULL))
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "short_links_brand_kind_idx" ON "short_links" USING btree ("brand_id","kind");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "link_destination_windows" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "link_id" uuid NOT NULL,
  "label" text,
  "destination_url" text NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone NOT NULL,
  "created_by_user_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "link_destination_windows_range_ck" CHECK ("link_destination_windows"."ends_at" > "link_destination_windows"."starts_at")
);--> statement-breakpoint

ALTER TABLE "link_destination_windows" ADD CONSTRAINT "link_destination_windows_link_id_short_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_destination_windows" ADD CONSTRAINT "link_destination_windows_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "link_destination_windows_link_idx" ON "link_destination_windows" USING btree ("link_id","starts_at");--> statement-breakpoint

-- Label the existing URL-shortener tier as the per-LINK rate so the campaign tier
-- ($3) can be told apart from it. Only touches the seeded per-unit product.
UPDATE "feature_subscription_tiers" t
   SET "unit_kind" = 'link'
  FROM "feature_subscription_products" p
 WHERE t."product_id" = p."id"
   AND p."per_unit" = true
   AND p."feature_key" = 'url_shortener'
   AND t."unit_kind" IS NULL;
