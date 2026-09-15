CREATE TABLE "service_headings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agency_id" uuid NOT NULL,
	"text" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "service_headings" ADD CONSTRAINT "service_headings_agency_id_agencies_id_fk" FOREIGN KEY ("agency_id") REFERENCES "public"."agencies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_headings_agency_idx" ON "service_headings" USING btree ("agency_id","sort_order") WHERE "service_headings"."deleted_at" is null;--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "is_heading";--> statement-breakpoint
ALTER TABLE "services" DROP COLUMN "heading_text";