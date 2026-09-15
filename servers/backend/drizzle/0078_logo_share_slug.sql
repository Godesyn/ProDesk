-- Readable, versioned guidelines share links (`acme-coffee/v1`, `/v2`, …) replace
-- the opaque 32-hex token. The slug is minted by scanning existing tokens for the
-- next free version, so the column has to be genuinely unique or two concurrent
-- "Create share link" presses could both land on the same v-number and the public
-- lookup would resolve to whichever row Postgres returned first.
--
-- NULL means "not shared" and stays permitted: Postgres treats NULLs as distinct
-- in a unique index, so any number of unshared projects coexist.
CREATE UNIQUE INDEX IF NOT EXISTS "logo_projects_share_token_key"
  ON "logo_projects" ("share_token");
