ALTER TABLE "review_locations" ADD COLUMN "slug_change_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "review_location_slug_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "review_location_slug_history" ADD CONSTRAINT "review_location_slug_history_location_id_review_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."review_locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_loc_slug_history_lower_idx" ON "review_location_slug_history" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "review_loc_slug_history_location_idx" ON "review_location_slug_history" USING btree ("location_id");
