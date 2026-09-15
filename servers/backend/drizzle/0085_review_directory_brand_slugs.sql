-- Directory identity, split into its two real levels.
--
-- 0084 moved review_directory_profiles from the brand to the LOCATION but left
-- the URL slug on that per-location row, so every location minted a combined
-- "<brand>-<location>" slug and the public URL stayed one segment. The result
-- was /directory/acme-acme-sydney instead of /directory/acme/sydney.
--
-- The canonical directory URL is now TWO segments:
--     /directory/:brandSlug/:locationSlug
-- brandSlug lives in review_directory_brands (one row per brand), locationSlug
-- is review_locations.slug — the slug the location already owns for /r/:slug,
-- already globally unique and already covered by rename history.
--
-- Every slug that was ever public (the legacy brand-level /directory/:slug and
-- the combined slugs 0084 produced) is copied into review_directory_slug_aliases
-- so old links, embeds, badges and QR codes keep resolving; the resolver
-- redirects them to the canonical two-segment URL.

-- ─── Brand-level directory slug (URL segment 1) ──────────────────────────────
CREATE TABLE IF NOT EXISTS "review_directory_brands" (
  "brand_id" uuid PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "review_directory_brands"
    ADD CONSTRAINT "review_directory_brands_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "review_directory_brands_slug_lower_idx"
  ON "review_directory_brands" (lower("slug"));--> statement-breakpoint

-- ─── Permanent slug aliases (legacy URLs → canonical) ────────────────────────
CREATE TABLE IF NOT EXISTS "review_directory_slug_aliases" (
  "slug" text PRIMARY KEY NOT NULL,
  "brand_id" uuid NOT NULL,
  -- NULL = a brand-level alias: resolves to the brand's primary location.
  "location_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "review_directory_slug_aliases"
    ADD CONSTRAINT "review_directory_aliases_brand_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "review_directory_slug_aliases"
    ADD CONSTRAINT "review_directory_aliases_location_id_fk"
    FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "review_directory_slug_aliases_lower_idx"
  ON "review_directory_slug_aliases" (lower("slug"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "review_directory_slug_aliases_brand_idx"
  ON "review_directory_slug_aliases" ("brand_id");--> statement-breakpoint

-- ─── Preserve every currently-public slug as an alias ────────────────────────
-- Done BEFORE the column is dropped. DISTINCT ON guards the (impossible in
-- theory, cheap in practice) case of two rows differing only by slug casing.
INSERT INTO "review_directory_slug_aliases" ("slug", "brand_id", "location_id")
SELECT DISTINCT ON (lower(dp."slug")) dp."slug", dp."brand_id", dp."location_id"
FROM "review_directory_profiles" dp
WHERE dp."slug" IS NOT NULL AND dp."slug" <> ''
ORDER BY lower(dp."slug"), dp."location_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- ─── Seed a brand slug for every brand that has a directory presence ─────────
-- Base slug = slugified business name; collisions get a -2, -3 … suffix, which
-- matches how the application mints them from here on.
WITH bases AS (
  SELECT
    b."id" AS brand_id,
    b."created_at" AS created_at,
    COALESCE(
      NULLIF(trim(both '-' from lower(regexp_replace(b."business_name", '[^a-zA-Z0-9]+', '-', 'g'))), ''),
      'business-' || left(b."id"::text, 8)
    ) AS base_slug
  FROM "brands" b
  WHERE EXISTS (SELECT 1 FROM "review_directory_profiles" dp WHERE dp."brand_id" = b."id")
), numbered AS (
  SELECT brand_id, base_slug,
         row_number() OVER (PARTITION BY base_slug ORDER BY created_at, brand_id) AS rn
  FROM bases
)
INSERT INTO "review_directory_brands" ("brand_id", "slug")
SELECT brand_id, CASE WHEN rn = 1 THEN base_slug ELSE base_slug || '-' || rn END
FROM numbered
ON CONFLICT ("brand_id") DO NOTHING;--> statement-breakpoint

-- A seeded brand slug can collide with a legacy alias that belongs to a
-- DIFFERENT brand. The brand table wins at resolution time, so such an alias
-- could never be reached again — drop it rather than leave a dead row.
DELETE FROM "review_directory_slug_aliases" a
USING "review_directory_brands" db
WHERE lower(a."slug") = lower(db."slug") AND a."brand_id" <> db."brand_id";--> statement-breakpoint

-- ─── The per-location slug is gone; the URL is (brand slug, location slug) ───
-- Dropped BEFORE the backfill below: while it exists it is NOT NULL UNIQUE, so
-- inserting a profile row without one would fail.
ALTER TABLE "review_directory_profiles" DROP COLUMN IF EXISTS "slug";--> statement-breakpoint

-- ─── Backfill the locations 0084 left without a profile row ──────────────────
-- 0084 mapped ONE arbitrary location per brand and dropped the rest, so every
-- other location of a multi-location brand silently vanished from the
-- directory. Restore them, inheriting the brand's existing listing settings —
-- notably opt_in, so this never publishes a business that had opted out.
INSERT INTO "review_directory_profiles" ("location_id", "brand_id", "opt_in", "website_url", "description", "city")
SELECT rl."id", rl."brand_id", src."opt_in", src."website_url", src."description", src."city"
FROM "review_locations" rl
JOIN LATERAL (
  SELECT dp."opt_in", dp."website_url", dp."description", dp."city"
  FROM "review_directory_profiles" dp
  WHERE dp."brand_id" = rl."brand_id"
  ORDER BY dp."created_at"
  LIMIT 1
) src ON true
WHERE rl."deleted_at" IS NULL
ON CONFLICT ("location_id") DO NOTHING;
