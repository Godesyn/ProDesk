-- Department share links: /team/<brand>/<department>.
--
-- Until now a department's public URL was DERIVED from its name on every
-- request ("<brand-name>-<department-name>" squashed into one segment). Two
-- problems with that, both of which bite email signatures specifically — the
-- links live in real inboxes for years:
--
--   1. A rename silently 404s every signature already sent.
--   2. One flat segment puts every department in a global namespace, so the
--      "Sales" department of one brand and a brand literally named "… Sales"
--      collide and resolve arbitrarily. With brands named
--      "Avenue Property | Browns Plains | Support Staff" that is not academic.
--
-- So the slug becomes a PERSISTED column, unique per brand, and the URL gains a
-- second segment. `/team/<brand>` keeps resolving to whichever department is
-- currently the default, so every link already in the wild still works and
-- promoting a new default doesn't break anything.
--
-- Mirrors the review-directory precedent (0085): persisted slug, uniqueness on
-- lower(slug).

ALTER TABLE "brand_kits" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint

-- Backfill from the department name ("Main" for a brand's default), slugified
-- the same way the app does, then de-duplicated WITHIN each brand by appending
-- the row's rank. Deterministic ordering (default first, then the user's own
-- order) so a re-run cannot reshuffle which department owns the bare slug.
WITH base AS (
  SELECT
    id,
    brand_id,
    is_default,
    sort_order,
    created_at,
    NULLIF(
      trim(BOTH '-' FROM regexp_replace(
        lower(COALESCE(NULLIF(department_name, ''), CASE WHEN is_default THEN 'main' ELSE 'department' END)),
        '[^a-z0-9]+', '-', 'g'
      )),
      ''
    ) AS raw
  FROM "brand_kits"
), named AS (
  SELECT id, brand_id, is_default, sort_order, created_at, COALESCE(raw, 'department') AS s
  FROM base
), ranked AS (
  SELECT
    id,
    s,
    row_number() OVER (
      PARTITION BY brand_id, s
      ORDER BY is_default DESC, sort_order, created_at, id
    ) AS rn
  FROM named
)
UPDATE "brand_kits" k
   SET "slug" = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || r.rn END
  FROM ranked r
 WHERE r.id = k.id AND k."slug" IS NULL;--> statement-breakpoint

ALTER TABLE "brand_kits" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint

-- Unique PER BRAND, case-insensitively — two brands may both have a "sales".
CREATE UNIQUE INDEX IF NOT EXISTS "brand_kits_brand_slug_unique"
  ON "brand_kits" ("brand_id", lower("slug"));
