-- Region identity for list runs: a Google Place ID, and a display label.
--
-- The region dropdown was 38 hand-written names, which made two things true:
-- Melbourne could not be broken into councils without someone hand-verifying
-- 31 of them, and the uniqueness key was a STRING an operator could spell more
-- than one way. "Inner West" and "inner-west" are the same council and two
-- different ledger rows — and a second ledger row for a council already
-- scraped is a second Apify bill for the same businesses.
--
-- Three changes, in the order they have to happen:

-- ── 1. Normalise what is already there ──────────────────────────────────────
--
-- `region_key` was written verbatim (`input.region.trim()`) while `vertical`
-- was normalised, so the uniqueness index was only ever case-sensitive on half
-- its key. Existing rows are canonical strings from the dropdown, so this is a
-- no-op for them today — but it must run BEFORE any lowercased key is written,
-- or 'Sydney' and 'sydney' would coexist and the pair would be scraped twice.
-- `country_code` belongs with these two and is added in 0095 instead — this
-- file had already been applied by the time it was needed, and an applied
-- migration is never re-read.
ALTER TABLE "outreach_list_runs"
  ADD COLUMN IF NOT EXISTS "region_label" text,
  ADD COLUMN IF NOT EXISTS "place_id" text;

UPDATE "outreach_list_runs"
  SET "region_label" = COALESCE("region_label", "region_key");

UPDATE "outreach_list_runs"
  SET "region_key" = regexp_replace(lower(trim("region_key")), '\s+', ' ', 'g')
  WHERE "region_key" <> regexp_replace(lower(trim("region_key")), '\s+', ' ', 'g');

-- ── 2. Place ID as a second, stronger uniqueness key ────────────────────────
--
-- The name key stays as the primary guard, because it covers every row ever
-- written and every row Outscraper will write. This one catches what a name
-- cannot: two different names for the same place ("Inner West" vs "Inner West
-- Council" vs "Inner West Council, NSW"), which Google resolves to one id.
--
-- Partial for the same reason as the name index — a `failed` run bought
-- nothing, and a `superseded` row was retired on purpose for the top-up run
-- §8 calls for. NULLs are already distinct in a unique index; rows scraped
-- before this migration, and anything picked off the curated list without
-- resolving it, simply aren't covered by it.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_list_runs_vertical_place_uq"
  ON "outreach_list_runs" ("vertical", "place_id")
  WHERE "place_id" IS NOT NULL AND "status" NOT IN ('failed', 'superseded');
