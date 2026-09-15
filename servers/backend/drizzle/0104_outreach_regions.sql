-- The gazetteer, discovered rather than authored.
--
-- Coverage used to be computed against a list of 38 region names typed into
-- regions.ts by hand. That list was wrong in three separate ways at once:
--
--   1. It matched on strings. A run on "Sydney" filled exactly one square and
--      left the 33 councils underneath it looking unscraped, because nothing in
--      the map understood that one area can be inside another. The whole-metro
--      run is the CHEAPEST way to cover the city, and the map was built to make
--      it look like the least productive.
--
--   2. The strings didn't match. Region search returns OpenStreetMap's official
--      names — "Inner West Council", not "Inner West" — so a council picked from
--      the search landed in an unnamed bucket while the square bearing its
--      nickname stayed empty.
--
--   3. It claimed things that were false. Our list put Blue Mountains,
--      Hawkesbury and Wollondilly inside "Greater Sydney". OpenStreetMap's
--      Sydney polygon — the thing a Sydney run is actually scraped against —
--      contains none of the three. The map would have reported three councils as
--      bought that no run had ever touched.
--
-- So the region taxonomy now comes from OSM, which is where the boundaries we
-- scrape already come from. This table is the cache of what it told us: for a
-- region we have scraped, the administrative areas found INSIDE it, verified by
-- testing each candidate's own point against the parent's stored polygon rather
-- than trusting the query to have got containment right.
--
-- Vertical-agnostic on purpose. Discovery costs an Overpass round trip and the
-- answer — "these 30 councils are inside Sydney" — is a fact about geography,
-- not about plumbers. One vertical pays for it and every vertical reads it,
-- which is what makes "dentist: 2 of 30 councils" answerable without a dentist
-- run ever having named Sydney.
CREATE TABLE IF NOT EXISTS "outreach_regions" (
  -- OpenStreetMap object identity — "R1251053". Matches
  -- `outreach_list_runs.place_id`, which is how a cell finds its run. NOT
  -- Nominatim's own place_id, which is an internal row id and is not stable.
  "osm_id" text PRIMARY KEY,
  "label" text NOT NULL,
  "country_code" text NOT NULL DEFAULT 'au',
  -- OSM's own hierarchy depth. Null for a region that is not an administrative
  -- boundary at all: "Sydney" is place=city with no admin_level, because
  -- Australia has no metropolitan tier between state (4) and council (6).
  "admin_level" integer,
  -- A point guaranteed to be INSIDE this region — not its centroid, which falls
  -- in the harbour for half the councils on this coast. Every containment test
  -- a child takes part in runs against this, so a child needs no polygon of its
  -- own and the table stays small.
  "point" jsonb NOT NULL,
  -- The region this one was discovered inside. A breadcrumb, not a constraint:
  -- containment is recomputed from geometry, never read off this column.
  "parent_osm_id" text,
  -- Which admin_level the children came back at, and when we last asked. Null
  -- `children_fetched_at` means never asked; a non-null `children_error` means
  -- asked and refused, so a failure shows in the UI instead of looking like a
  -- region that genuinely contains nothing.
  "children_admin_level" integer,
  "children_fetched_at" timestamptz,
  "children_error" text,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- Every read is "the children of this parent".
CREATE INDEX IF NOT EXISTS "outreach_regions_parent_idx"
  ON "outreach_regions" ("parent_osm_id");

-- Coverage walks the parents — the rows that have been asked for children.
CREATE INDEX IF NOT EXISTS "outreach_regions_fetched_idx"
  ON "outreach_regions" ("children_fetched_at")
  WHERE "children_fetched_at" IS NOT NULL;
