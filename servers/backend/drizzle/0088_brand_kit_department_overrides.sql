-- Per-department identity/palette/font OVERRIDES on brand_kits.
--
-- These belong to 0087_signature_departments and are declared in schema.ts, but
-- 0087 was stamped as applied on an environment while it still held only its
-- first half (the department columns + indexes). An applied migration never
-- re-runs, so the columns never landed and every `select` against brand_kits
-- failed with `column "website" does not exist`. Fixing forward rather than
-- editing 0087, which is already recorded as applied.
--
-- Every statement is IF NOT EXISTS, so this is a no-op on any environment where
-- 0087 ran in full.
--
-- Semantics (see modules/signatures/brand-kit-view.ts): NULL means "inherit from
-- `brands`", which is what the default department always does. Only a non-default
-- department that deliberately diverges stores its own value, so `brands` remains
-- the single source of truth for the brand's identity — a department merely
-- re-skins its own signature.

ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "logo_key" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "primary_color" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "secondary_color" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "font_family" text;
