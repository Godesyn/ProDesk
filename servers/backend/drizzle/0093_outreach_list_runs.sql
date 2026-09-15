-- The Apify list-build stage: a run ledger, and a stable business identity.
--
-- See docs/agents/outreach-apify.md §7.
--
-- Two problems, both of which cost real money if left alone:
--
--  1. Apify has no idempotency key on run start. A Worker that dies between
--     "start the run" and "write down the run id" pays for the entire scrape a
--     second time on retry. The fix is a durable row written BEFORE the call,
--     which gives the resume path something to recognise an orphan run by.
--
--  2. Email is a bad identity for a business. A practice that moves from
--     info@ to hello@ reads as a brand-new prospect and gets cold-emailed
--     twice. Google's `placeId` is the only identity Maps gives us that
--     doesn't move.

-- ── 1. Business identity + the free personalisation hook ────────────────────

ALTER TABLE "outreach_prospect_state"
  ADD COLUMN IF NOT EXISTS "place_id" text,
  -- `reviewsCount` and `totalScore` arrive in the Apify base item at no extra
  -- cost, and for a reviews product they are a sharper opener than anything a
  -- homepage crawl produces. Stored structured rather than flattened into
  -- `personalisation_detail`, because the review count is also the best
  -- prospect SCORE we get: a business on 8 reviews needs the product, one on
  -- 900 doesn't.
  ADD COLUMN IF NOT EXISTS "reviews_count" integer,
  ADD COLUMN IF NOT EXISTS "rating" numeric(3, 2),
  -- The composed opener, stored the same way `personalisation_detail` is.
  -- It has to be stored rather than recomputed, because it compares this
  -- business against the median of the run that scraped it — a number that
  -- exists nowhere else once the run is gone. Recomputing it later would
  -- produce a different sentence from the one the prospect actually received,
  -- which would make the template preview a lie.
  ADD COLUMN IF NOT EXISTS "review_hook" text;

-- Partial: rows scraped before this migration have no place id, and neither
-- does anything Outscraper returns. NULLs are already distinct in a unique
-- index; the predicate is here to say so out loud.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_prospect_state_place_id_uq"
  ON "outreach_prospect_state" ("place_id")
  WHERE "place_id" IS NOT NULL;

-- ── 2. The run ledger — a deliberate fifth outreach table ───────────────────

CREATE TABLE IF NOT EXISTS "outreach_list_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" text NOT NULL,
  -- Pinned per row: changing APIFY_MAPS_ACTOR_ID later must not rewrite history.
  "actor_id" text,
  "vertical" text NOT NULL,
  -- An LGA, or a whole metro. Never a suburb: the actor tiles a geocoded
  -- bounding box itself and dedupes by placeId before billing, so splitting a
  -- city into suburbs buys no coverage and pays twice wherever the boxes overlap.
  "region_key" text NOT NULL,
  "search_term" text NOT NULL,
  -- Hash of the actor input. On resume this is what lets us recognise a run we
  -- already paid for instead of starting a second one.
  "input_hash" text NOT NULL,
  "run_id" text,
  "dataset_id" text,
  "status" text NOT NULL DEFAULT 'starting',
  "stage" text NOT NULL DEFAULT 'starting',
  "max_records" integer NOT NULL,
  "personalise" boolean NOT NULL DEFAULT false,
  "campaign_id" bigint,
  "sending_domain" text,
  "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cost_estimate_usd" numeric(10, 4),
  "cost_actual_usd" numeric(10, 4),
  "error" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE "outreach_list_runs"
  DROP CONSTRAINT IF EXISTS "outreach_list_runs_status_ck";
ALTER TABLE "outreach_list_runs"
  ADD CONSTRAINT "outreach_list_runs_status_ck"
  CHECK ("status" IN ('starting', 'running', 'review', 'pushing', 'done', 'failed', 'superseded'));

-- Rule 1 of the cost model — never scrape the same (vertical, region) twice —
-- enforced here rather than by discipline, because the only way to genuinely
-- waste money on this pipeline is to forget that you already ran it.
--
-- Partial on purpose. A `failed` run bought nothing worth protecting, so a
-- retry needs no ceremony. A `superseded` row is one an operator explicitly
-- retired to run the ~1–2%/month top-up that a stale region eventually wants.
-- Every other status — including a run still `starting` — refuses the repeat.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_list_runs_vertical_region_uq"
  ON "outreach_list_runs" ("vertical", "region_key")
  WHERE "status" NOT IN ('failed', 'superseded');

-- One ledger row per Apify run, so orphan adoption can never bind the same
-- paid-for run to two rows.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_list_runs_run_id_uq"
  ON "outreach_list_runs" ("run_id")
  WHERE "run_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "outreach_list_runs_status_idx"
  ON "outreach_list_runs" ("status");
CREATE INDEX IF NOT EXISTS "outreach_list_runs_created_idx"
  ON "outreach_list_runs" ("created_at" DESC, "id" DESC);

-- Deny-by-default, matching every other non-realtime table: the backend
-- connects as the owning role and bypasses RLS, so this only shuts the
-- PostgREST door. rls.sql re-asserts it on every boot.
ALTER TABLE "outreach_list_runs" ENABLE ROW LEVEL SECURITY;
