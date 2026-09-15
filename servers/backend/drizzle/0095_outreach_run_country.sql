-- The country a list run was scraped in.
--
-- Belongs in 0094 with the rest of the region-identity work, and isn't there
-- for a boring reason worth writing down: 0094 had already been applied when
-- this column turned out to be needed, and drizzle records a migration as done
-- and never re-reads the file. Editing an applied migration changes nothing but
-- the diff. So it gets its own file.
--
-- Why it has to exist at all: `countryCode` was hardcoded to 'au' in both
-- `createRun` and `specOf`, which was invisible while the region list was 38
-- Australian names. Now that a region can be searched, it can be anywhere — and
-- the country is part of the actor input whose hash the resume path uses to
-- recognise an orphan run it has already paid for. A country that isn't on the
-- row is a hash that can't be rebuilt, and a scrape that gets billed twice.
--
-- 'au' as the default is right for every existing row: they were all scraped
-- against the hardcoded value.
ALTER TABLE "outreach_list_runs"
  ADD COLUMN IF NOT EXISTS "country_code" text NOT NULL DEFAULT 'au';
