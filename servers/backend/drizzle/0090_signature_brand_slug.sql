-- Persist the BRAND segment of a signature share link.
--
-- 0089 made the department segment of `/team/<brand>/<department>` a stored
-- column, so renaming a department no longer 404s signatures already sitting in
-- inboxes. The brand segment was still DERIVED from the default brand kit's
-- `name` on every request, which left the same hole one level up: editing that
-- name in the design form silently broke every department's link at once.
--
-- So the brand segment becomes a column too. Backfilled from exactly what the
-- derivation produced, so every link already in the wild keeps resolving.
--
-- It lives on `brands` rather than on a kit because it identifies the BRAND — a
-- brand has many departments and they must all share one prefix. Unique GLOBALLY
-- (unlike the department slug, which is only unique within its brand) because it
-- is the first path segment of a public URL.

ALTER TABLE "brands" ADD COLUMN IF NOT EXISTS "signature_slug" text;--> statement-breakpoint

-- Backfill from the DEFAULT kit's name — the exact input the old derivation
-- used — slugified identically, then de-duplicated globally by rank. Brands with
-- no kit fall back to their business name so they have a usable slug the moment
-- signatures is opened. Deterministic ordering so a re-run cannot reshuffle.
WITH base AS (
  SELECT
    b.id,
    b.created_at,
    NULLIF(
      trim(BOTH '-' FROM regexp_replace(
        lower(COALESCE(NULLIF(k.name, ''), b.business_name, '')),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ) AS raw
  FROM "brands" b
  LEFT JOIN "brand_kits" k ON k.brand_id = b.id AND k.is_default
), named AS (
  SELECT id, created_at, COALESCE(raw, 'brand') AS s FROM base
), ranked AS (
  SELECT
    id,
    s,
    row_number() OVER (PARTITION BY s ORDER BY created_at, id) AS rn
  FROM named
)
UPDATE "brands" b
   SET "signature_slug" = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || r.rn END
  FROM ranked r
 WHERE r.id = b.id AND b."signature_slug" IS NULL;--> statement-breakpoint

-- Deliberately left NULLABLE. `brands` is a core table written by billing, the
-- marketplace, onboarding and half a dozen test factories; making a
-- signatures-only column mandatory would force every one of them to invent a
-- slug. Instead NULL means "not minted yet" and the signatures app mints it on
-- first use, exactly as it already provisions the brand kit itself
-- (ensureBrandKit). The backfill above means no EXISTING brand is ever NULL.
--
-- Unique index still applies: Postgres allows many NULLs in a unique index, so
-- unminted brands don't collide with each other while every minted slug stays
-- globally unique.
CREATE UNIQUE INDEX IF NOT EXISTS "brands_signature_slug_unique"
  ON "brands" (lower("signature_slug"));
