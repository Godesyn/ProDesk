-- Unify signature brand-kits with Prodesk tenant brands. The signature "brand" is
-- now the Prodesk brand: one 1:1 signature_brands satellite per brand, gated by
-- brands.signatures_enabled_at, billed owner-level per-unit (first brand free).
--
-- Fresh start: the signatures app was only just scaffolded, and the old model
-- allowed many kits per brand — which would violate the new UNIQUE(brand_id).
-- Wipe all signature data so the 1:1 constraint is safe to create.
TRUNCATE TABLE
  "signature_analytics_events",
  "signature_campaign_banners",
  "signature_campaigns",
  "signature_members",
  "signature_brands",
  "saved_signatures"
RESTART IDENTITY CASCADE;--> statement-breakpoint
DROP INDEX "signature_brands_brand_idx";--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "signatures_enabled_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "signature_brands_brand_unique" ON "signature_brands" USING btree ("brand_id");
