-- Beta program — time-boxed, self-serve beta cohorts.
--
-- A "beta version" is an admin-defined cohort (v1 / v2 / v3 …) carrying a
-- DURATION in days. Signing up via `/signup?beta=<code>` stamps the new user
-- with that version and a personal `beta_ends_at = signup + duration_days`, so
-- two users on the same version can have different deadlines (and an admin can
-- extend one of them without touching the cohort).
--
-- `users.is_beta_user` keeps its original meaning — the entitlement bypass that
-- makes every feature subscription free (see modules/feature-subscriptions/
-- entitlements.ts). What's new is that the bypass can EXPIRE: a NULL
-- `beta_ends_at` is the legacy "unlimited" grant a super-admin toggles by hand,
-- while a non-NULL value ends the bypass at that instant. Nothing else needed
-- changing for access to stop working — every paid gate already funnels through
-- the same entitlement check.
--
-- Also adds `support_tickets.source`, which splits the one ticket table into the
-- Support surface and the in-app Feedback surface. Feedback IS a ticket
-- internally (same triage console, same threading, same emails) but is never
-- presented as one to the user.

CREATE TYPE "public"."beta_notice_kind" AS ENUM ('day_7', 'day_3', 'day_0');--> statement-breakpoint
CREATE TYPE "public"."support_ticket_source" AS ENUM ('support', 'feedback');--> statement-breakpoint

-- An admin-defined beta cohort. `code` is what appears in the signup URL.
CREATE TABLE IF NOT EXISTS "beta_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "code" text NOT NULL,
  "label" text,
  "description" text,
  "duration_days" integer NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "signup_limit" integer,
  "created_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- Audit of every per-user extension, so "why is this user still on beta?" has an
-- answer. The authoritative deadline stays on users.beta_ends_at.
CREATE TABLE IF NOT EXISTS "beta_extensions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "days" integer NOT NULL,
  "reason" text,
  "previous_ends_at" timestamp with time zone,
  "new_ends_at" timestamp with time zone NOT NULL,
  "extended_by_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

-- One row per (user, milestone, deadline) reminder actually sent. Keying on the
-- DEADLINE — not just the milestone — is what makes an extension re-arm all
-- three notices for the new date instead of silently suppressing them.
CREATE TABLE IF NOT EXISTS "beta_notices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" "beta_notice_kind" NOT NULL,
  "beta_ends_at" timestamp with time zone NOT NULL,
  "sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_version_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "beta_expiry_acknowledged_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "source" "support_ticket_source" DEFAULT 'support' NOT NULL;--> statement-breakpoint

-- Foreign keys (guarded so re-running the migration is idempotent).
DO $$ BEGIN
  ALTER TABLE "beta_versions" ADD CONSTRAINT "beta_versions_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "beta_extensions" ADD CONSTRAINT "beta_extensions_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "beta_extensions" ADD CONSTRAINT "beta_extensions_extended_by_user_id_users_id_fk"
    FOREIGN KEY ("extended_by_user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "beta_notices" ADD CONSTRAINT "beta_notices_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_beta_version_id_beta_versions_id_fk"
    FOREIGN KEY ("beta_version_id") REFERENCES "beta_versions"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint

-- One cohort per code, case-insensitively: `?beta=V1` and `?beta=v1` are the
-- same cohort, and the resolver lowercases before looking up.
CREATE UNIQUE INDEX IF NOT EXISTS "beta_versions_code_uniq" ON "beta_versions" (lower("code"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beta_extensions_user_idx" ON "beta_extensions" ("user_id", "created_at" DESC);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "beta_notices_user_kind_deadline_uniq" ON "beta_notices" ("user_id", "kind", "beta_ends_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_beta_version_idx" ON "users" ("beta_version_id");--> statement-breakpoint

-- The reminder sweep scans "beta users whose deadline is near". A PARTIAL index
-- on the deadline keeps that scan proportional to the number of beta users
-- rather than the whole users table.
CREATE INDEX IF NOT EXISTS "users_beta_ends_at_idx" ON "users" ("beta_ends_at") WHERE "is_beta_user";--> statement-breakpoint

-- The feedback panel lists "my feedback, newest first" on every page load, and
-- the admin console filters by source. Both are covered here.
CREATE INDEX IF NOT EXISTS "support_tickets_user_source_idx" ON "support_tickets" ("user_id", "source", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "support_tickets_source_idx" ON "support_tickets" ("source");
