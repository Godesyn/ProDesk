ALTER TYPE "public"."review_milestone_status" ADD VALUE 'delivered';--> statement-breakpoint
ALTER TABLE "review_milestone_rewards" ADD COLUMN "delivered_at" timestamp with time zone;