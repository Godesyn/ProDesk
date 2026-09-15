ALTER TABLE "short_links" ADD COLUMN "disabled_at" timestamp;--> statement-breakpoint
UPDATE "short_links" SET "disabled_at" = NOW() WHERE "is_active" = false AND "disabled_at" IS NULL;
