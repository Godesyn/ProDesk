-- Inspector edit journal for a Logo Studio mark.
--
-- The editor's inspector (scale / weight / gap / clearspace / typography /
-- hidden elements) refines ONE mark in place rather than minting a new
-- generation row, so before this column there was nothing for the version
-- history to show and nothing for undo to step back through. Each entry records
-- the before AND after of every field it touched, which is also what the API
-- hands back when the AI copilot drives the inspector.
ALTER TABLE "logo_generations"
  ADD COLUMN IF NOT EXISTS "edits" jsonb NOT NULL DEFAULT '[]'::jsonb;
