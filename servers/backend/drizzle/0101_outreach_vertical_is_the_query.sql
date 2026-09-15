-- A list run's vertical IS its search term. Collapse the two columns into one.
--
-- `outreach_list_runs` carried both a label ("Cafés & restaurants") and the
-- string actually handed to the scraper ("restaurant"). The pair looked like a
-- display concern and was really a hole in the cost model: the uniqueness
-- indexes are keyed on `vertical`, so two labels resolving to one search term
-- were two ledger rows and two Apify bills for the same set of businesses.
-- Rule 1 — never scrape the same thing twice — can only be enforced on the
-- string Google is actually asked for.
--
-- It also cost nothing to give up. One label mapped to exactly one term in
-- regions.ts, and the (vertical × region) index already refused a second run of
-- the same label, so a label spanning two terms was unreachable anyway.
--
-- BACKFILL FIRST, and in this direction. Existing rows hold the label in
-- `vertical` and the query in `search_term`; leaving them on the label would
-- put old and new rows in two namespaces, and a new "dentist" run over a region
-- already scraped as "dentists" is precisely the double-bill the indexes exist
-- to prevent. Normalised the same way `normaliseKey` does it, because that is
-- what the indexes compare.
--
-- Rows created before the operator could set a term have search_term = the
-- un-normalised vertical, so this is a no-op for them.
UPDATE "outreach_list_runs"
   SET "vertical" = lower(regexp_replace(btrim("search_term"), '\s+', ' ', 'g'))
 WHERE "vertical" IS DISTINCT FROM lower(regexp_replace(btrim("search_term"), '\s+', ' ', 'g'));

-- Prospects copy the vertical down from their run at insert time and are
-- filtered by it on the Prospects screen. Re-derive rather than re-normalise:
-- `source` is the exact link back, so this cannot drift the way a string
-- rewrite on both tables independently could.
UPDATE "outreach_prospect_state" p
   SET "vertical" = r."vertical"
  FROM "outreach_list_runs" r
 WHERE p."source" = 'list-build:' || r."id"::text
   AND p."vertical" IS DISTINCT FROM r."vertical";

ALTER TABLE "outreach_list_runs" DROP COLUMN IF EXISTS "search_term";
