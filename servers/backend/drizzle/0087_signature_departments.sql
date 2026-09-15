-- Signature DEPARTMENTS — brand_kits goes 1:1 → 1:many per brand.
--
-- A brand can now hold several signature designs ("departments": Sales, Support,
-- Execs…). Each department is a full, independently-editable signature design
-- that shares the brand's members, campaigns and analytics — one person is one
-- billable seat however many departments render them — and each gets its own
-- public share page.
--
-- Exactly ONE kit per brand carries is_default. That row is the brand kit the
-- rest of the suite reads and writes (AI brand context, Logo Studio logo slots,
-- the Document Locker backfill, the dashboard Brand Kit editor), so the 1:many
-- change stays invisible outside SIGKITT. The partial unique index below is what
-- guarantees that "exactly one" — never rely on application code alone.

ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "department_name" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- Every pre-existing kit was its brand's only one, so it becomes the default.
-- Guarded on the old 1:1 index still being present: on a re-run (the index is
-- already gone) this must not promote a second kit and break the new unique.
UPDATE "brand_kits" SET "is_default" = true
WHERE NOT "is_default"
  AND EXISTS (SELECT 1 FROM pg_class WHERE relname = 'brand_kits_brand_unique');--> statement-breakpoint

-- Drop the 1:1 constraint; a plain lookup index replaces it.
DROP INDEX IF EXISTS "brand_kits_brand_unique";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "brand_kits_brand_idx" ON "brand_kits" USING btree ("brand_id");--> statement-breakpoint

-- Exactly one default kit per brand.
CREATE UNIQUE INDEX IF NOT EXISTS "brand_kits_brand_default_unique"
  ON "brand_kits" USING btree ("brand_id") WHERE "is_default";--> statement-breakpoint

-- Per-department identity/palette/font OVERRIDES.
--
-- Migration 0061 dropped these from brand_kits to make `brands` the single source
-- of truth. They come back NULLABLE and purely as overrides: NULL means "inherit
-- from `brands`", which is what the default department always does. Only a
-- non-default department that deliberately diverges stores its own value, so the
-- single-source-of-truth rule is intact — the brand still owns the identity, a
-- department merely re-skins its own signature.
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "address" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "logo_url" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "logo_key" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "primary_color" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "secondary_color" text;--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "font_family" text;
