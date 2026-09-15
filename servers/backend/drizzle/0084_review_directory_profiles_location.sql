ALTER TABLE "review_directory_profiles" DROP CONSTRAINT IF EXISTS "review_directory_profiles_pkey";
ALTER TABLE "review_directory_profiles" DROP CONSTRAINT IF EXISTS "review_directory_profiles_brand_id_brands_id_fk";

ALTER TABLE "review_directory_profiles" ADD COLUMN IF NOT EXISTS "location_id" uuid;

-- Populate location_id for existing rows by joining review_locations
UPDATE "review_directory_profiles" dp
SET "location_id" = rl.id
FROM "review_locations" rl
WHERE dp.location_id IS NULL AND rl.brand_id = dp.brand_id;

-- Delete any unmapped rows
DELETE FROM "review_directory_profiles" WHERE "location_id" IS NULL;

ALTER TABLE "review_directory_profiles" ALTER COLUMN "location_id" SET NOT NULL;
ALTER TABLE "review_directory_profiles" ADD CONSTRAINT "review_directory_profiles_pkey" PRIMARY KEY ("location_id");
ALTER TABLE "review_directory_profiles" ADD CONSTRAINT "review_directory_profiles_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "review_directory_profiles" ADD CONSTRAINT "review_directory_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "review_directory_profiles_brand_idx" ON "review_directory_profiles" USING btree ("brand_id");
