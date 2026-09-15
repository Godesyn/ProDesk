ALTER TABLE "tasks" ALTER COLUMN "sort_order" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "sort_order" SET DEFAULT 'a0';--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "sort_order" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "sort_order" text DEFAULT 'a0' NOT NULL;