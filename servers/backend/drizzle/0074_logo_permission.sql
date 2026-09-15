-- Add the `logo` staff permission (Logo Studio — the AI logo builder + brand-
-- genesis engine at clients/logo). Single MANAGE permission; brand owners and
-- super-admins always pass regardless.
--
-- NOTE: `ALTER TYPE … ADD VALUE` must commit before any SQL that *uses* the new
-- value. The migrator runs each file in its own transaction, so this add lives
-- alone in 0074; nothing here consumes the literal. See servers/backend/src/
-- scripts/migrate.ts (Postgres 55P04 guidance).
ALTER TYPE "staff_permission" ADD VALUE IF NOT EXISTS 'logo';
