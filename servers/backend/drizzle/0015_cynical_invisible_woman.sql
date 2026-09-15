ALTER TABLE "brands" ADD COLUMN "gst_registered" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "policies" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "locations" jsonb DEFAULT '[]'::jsonb NOT NULL;