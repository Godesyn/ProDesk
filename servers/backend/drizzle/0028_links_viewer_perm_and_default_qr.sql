ALTER TYPE "public"."staff_permission" ADD VALUE 'linksViewer';--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "default_link_qr_config" jsonb;