-- Repair: ensure brand_kits.name exists, is backfilled, and is NOT NULL.
--
-- `brand_kits.name` (the brand-kit's OWN display name, seeded from
-- brands.business_name) is created by 0049 and explicitly KEPT by 0061, so a DB
-- migrated cleanly through the chain already has it — for those this migration is
-- a no-op. It exists to self-heal environments where the column was dropped out
-- of band (observed on a shared DB, most likely a stray `drizzle-kit push`
-- against a schema snapshot that lacked it). Its absence breaks EVERY brand-kit
-- provision, because `ensureBrandKit` inserts `name` as NOT NULL.
--
-- Every statement is idempotent, so re-running against a healthy DB is safe:
-- ADD COLUMN IF NOT EXISTS is a no-op, the backfill UPDATEs match no rows once
-- `name` is populated, and SET NOT NULL is a no-op on an already-NOT NULL column.

ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
-- Backfill from the parent brand's business name — matching how `ensureBrandKit`
-- seeds it (brands.businessName, else 'My Brand').
UPDATE "brand_kits" bk
SET "name" = COALESCE(b."business_name", 'My Brand')
FROM "brands" b
WHERE b."id" = bk."brand_id" AND bk."name" IS NULL;
--> statement-breakpoint
-- Safety net for any kit whose brand row is somehow missing (FK cascade should
-- make this impossible) so the NOT NULL constraint can be applied.
UPDATE "brand_kits" SET "name" = 'My Brand' WHERE "name" IS NULL;
--> statement-breakpoint
ALTER TABLE "brand_kits" ALTER COLUMN "name" SET NOT NULL;
