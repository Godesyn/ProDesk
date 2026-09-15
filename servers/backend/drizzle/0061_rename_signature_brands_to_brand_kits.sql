-- Rename the signature_brands satellite to brand_kits and make `brands` the
-- SINGLE SOURCE OF TRUTH for the overlapping identity/design fields.
--
-- Step 1 promotes any value that lives ONLY on the satellite up into `brands`
-- (decided from the prod merge-conflict report: "promote all orphans"), so no
-- data is lost and signatures keep rendering once reads switch to `brands`.
-- Step 2 renames the table + its unique index/pkey. Step 3 drops the now
-- duplicated columns. Step 4 adds the new brand-kit-only columns.
--
-- Note: FK column names on children stay `signature_brand_id` (renaming them is
-- extra churn for no functional gain); only the table/model symbol is renamed.

-- ── Step 1: promote satellite-only values into brands (only where brands empty) ──
UPDATE "brands" b
SET "website" = sb."website"
FROM "signature_brands" sb
WHERE sb."brand_id" = b."id"
  AND (b."website" IS NULL OR b."website" = '')
  AND sb."website" IS NOT NULL AND sb."website" <> '';
--> statement-breakpoint
UPDATE "brands" b
SET "address" = sb."address"
FROM "signature_brands" sb
WHERE sb."brand_id" = b."id"
  AND (b."address" IS NULL OR b."address" = '')
  AND sb."address" IS NOT NULL AND sb."address" <> '';
--> statement-breakpoint
UPDATE "brands" b
SET "logo_url" = sb."logo_url"
FROM "signature_brands" sb
WHERE sb."brand_id" = b."id"
  AND (b."logo_url" IS NULL OR b."logo_url" = '')
  AND sb."logo_url" IS NOT NULL AND sb."logo_url" <> '';
--> statement-breakpoint
-- Palette → brands.colors in token order [primary, accent, ink, ...]. The
-- signature primary → primary; the signature secondary (dark text) → ink slot,
-- with a default accent kept in between (signatures don't define an accent).
UPDATE "brands" b
SET "colors" = ARRAY[sb."primary_color", '#8a8a82', sb."secondary_color"]
FROM "signature_brands" sb
WHERE sb."brand_id" = b."id"
  AND (b."colors" IS NULL OR array_length(b."colors", 1) IS NULL)
  AND sb."primary_color" IS NOT NULL;
--> statement-breakpoint
-- Font → brands.typography in order [Heading, Body, Mono]. Seed the existing
-- single font as both Heading and Body (the brand currently uses one font).
UPDATE "brands" b
SET "typography" = ARRAY[sb."font_family", sb."font_family"]
FROM "signature_brands" sb
WHERE sb."brand_id" = b."id"
  AND (b."typography" IS NULL OR array_length(b."typography", 1) IS NULL)
  AND sb."font_family" IS NOT NULL;
--> statement-breakpoint

-- ── Step 2: rename the table + its own index/constraint ──
ALTER TABLE "signature_brands" RENAME TO "brand_kits";
--> statement-breakpoint
ALTER INDEX "signature_brands_brand_unique" RENAME TO "brand_kits_brand_unique";
--> statement-breakpoint
ALTER TABLE "brand_kits" RENAME CONSTRAINT "signature_brands_pkey" TO "brand_kits_pkey";
--> statement-breakpoint

-- ── Step 3: drop the columns now owned by brands ──
-- NOTE: `name` is intentionally KEPT — the signature/brand-kit has its own
-- business name, separate from brands.businessName, so it can't rename the brand.
ALTER TABLE "brand_kits" DROP COLUMN "website";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "address";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "primary_color";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "secondary_color";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "font_family";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "logo_key";
--> statement-breakpoint
ALTER TABLE "brand_kits" DROP COLUMN "logo_url";
--> statement-breakpoint

-- ── Step 4: add the new brand-kit-only columns ──
ALTER TABLE "brand_kits" ADD COLUMN "voice" jsonb;
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "logo_slots" jsonb;
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "kit_version" integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE "brand_kits" ADD COLUMN "kit_version_date" text;
