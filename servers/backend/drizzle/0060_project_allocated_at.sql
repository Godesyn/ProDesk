ALTER TABLE "projects" ADD COLUMN "allocated_at" timestamp with time zone;--> statement-breakpoint
UPDATE "projects" SET "allocated_at" = "updated_at" WHERE "production_assignee_id" IS NOT NULL;
