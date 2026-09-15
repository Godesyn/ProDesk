CREATE TABLE "project_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"brief_context" text,
	"brief_documents" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "project_cycles" ADD CONSTRAINT "project_cycles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_cycles_project_cycle_uniq" ON "project_cycles" USING btree ("project_id","cycle_number");--> statement-breakpoint
ALTER TABLE "project_deliverables" ADD COLUMN "cycle" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "project_deliverables" ALTER COLUMN "cycle" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "project_revisions" ADD COLUMN "cycle" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "project_revisions" ALTER COLUMN "cycle" DROP DEFAULT;
