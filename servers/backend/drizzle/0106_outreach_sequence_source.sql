-- The authored source of a sequence step, and the address behind {{location}}.
--
-- WHY A SOURCE TABLE
-- Sequence bodies now go to Smartlead as designed HTML — the letter shell,
-- built in modules/outreach/email-shell.ts — instead of as the raw contents of
-- a textarea. That is a one-way transform: you cannot read a rendered letter
-- back out of Smartlead and recover the plain note someone typed, and if the
-- editor tried, every save would degrade the copy a little more until the
-- operator was editing markup.
--
-- So the plain body is OURS and the rendered letter is Smartlead's. This table
-- holds the former, keyed by the campaign and the step's position in it. On
-- load the editor prefers what is here; a step with no row falls back to the
-- HTML Smartlead has, which is how sequences written before this migration keep
-- opening.
--
-- Keyed on (campaign_id, seq_number) rather than Smartlead's own sequence id
-- because a step that is deleted and re-added comes back with a new id but the
-- same position, and the position is what the operator is actually editing.
CREATE TABLE IF NOT EXISTS "outreach_sequence_source" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "campaign_id" bigint NOT NULL,
  "seq_number" integer NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  -- The plain body, in the small markup email-shell.ts documents. Never HTML.
  "body" text NOT NULL DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- One row per step. The save upserts on this, so re-saving a sequence replaces
-- the source rather than accumulating a history of it — the history that
-- matters is the letter that went out, and that is in Smartlead.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_sequence_source_step_idx"
  ON "outreach_sequence_source" ("campaign_id", "seq_number");

-- The scraped street address, which Smartlead is given as `location` and which
-- {{location}} resolves to.
--
-- It was already being uploaded and never stored, so the template preview had
-- nothing to render and hardcoded an empty string — the one tag whose preview
-- was blank while the real send was fine, the exact mirror of {{first_name}},
-- whose preview invented a name while the real send was blank. Storing it makes
-- the preview true for both.
ALTER TABLE "outreach_prospect_state"
  ADD COLUMN IF NOT EXISTS "address" text;
