-- Public share link for a Logo Studio project's brand guidelines.
--
-- DESIGN.md 05 calls for the rulebook to be shareable as a link. The token is an
-- opaque, revocable secret (NULL = sharing off) and is the ONLY credential the
-- public guidelines page needs, so it must be unguessable and unique.
ALTER TABLE "logo_projects" ADD COLUMN IF NOT EXISTS "share_token" text;

CREATE UNIQUE INDEX IF NOT EXISTS "logo_projects_share_token_idx"
  ON "logo_projects" ("share_token")
  WHERE "share_token" IS NOT NULL;
