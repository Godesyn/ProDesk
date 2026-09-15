-- Logo Studio working-state tables (clients/logo).
--
-- Brand identity itself stays on `brands` (logoUrl/logoUrls/colors/typography)
-- and `brand_kits.logoSlots`; these tables only hold the session working state so
-- a design effort has history, versions, and an iteration lineage.
--
-- logo_projects.chosen_generation_id and logo_generations.parent_id are circular
-- with logo_generations, so both tables are created first and the FKs are added
-- afterwards via ALTER.

CREATE TABLE IF NOT EXISTS "logo_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "brand_id" uuid NOT NULL,
  "created_by_user_id" uuid,
  "name" text NOT NULL,
  "status" text DEFAULT 'brief' NOT NULL,
  "brief" jsonb,
  "chosen_generation_id" uuid,
  "style_lock" jsonb,
  "rights_assigned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "logo_generations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "brand_id" uuid NOT NULL,
  "parent_id" uuid,
  "provider" text DEFAULT 'claude' NOT NULL,
  "kind" text DEFAULT 'geometric' NOT NULL,
  "name" text DEFAULT 'Untitled mark' NOT NULL,
  "note" text DEFAULT '',
  "svg" text NOT NULL,
  "spec" jsonb,
  "uniqueness" integer,
  "thumb_key" text,
  "thumb_url" text,
  "saved" boolean DEFAULT false NOT NULL,
  "prompt" text DEFAULT '',
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign keys (guarded so re-running the migration is idempotent).
DO $$ BEGIN
  ALTER TABLE "logo_projects" ADD CONSTRAINT "logo_projects_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "logo_projects" ADD CONSTRAINT "logo_projects_created_by_user_id_users_id_fk"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "logo_generations" ADD CONSTRAINT "logo_generations_project_id_logo_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "logo_projects"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "logo_generations" ADD CONSTRAINT "logo_generations_brand_id_brands_id_fk"
    FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "logo_generations" ADD CONSTRAINT "logo_generations_parent_id_logo_generations_id_fk"
    FOREIGN KEY ("parent_id") REFERENCES "logo_generations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "logo_projects" ADD CONSTRAINT "logo_projects_chosen_generation_id_logo_generations_id_fk"
    FOREIGN KEY ("chosen_generation_id") REFERENCES "logo_generations"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "logo_projects_brand_idx" ON "logo_projects" ("brand_id");
CREATE INDEX IF NOT EXISTS "logo_generations_project_idx" ON "logo_generations" ("project_id");
CREATE INDEX IF NOT EXISTS "logo_generations_brand_idx" ON "logo_generations" ("brand_id");
