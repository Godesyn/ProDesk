ALTER TABLE "agencies" ADD COLUMN "derived_from_brand_id" uuid;--> statement-breakpoint
ALTER TABLE "brands" ADD COLUMN "derived_to_agency_id" uuid;--> statement-breakpoint
ALTER TABLE "agencies" ADD CONSTRAINT "agencies_derived_from_brand_id_brands_id_fk" FOREIGN KEY ("derived_from_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_derived_to_agency_id_agencies_id_fk" FOREIGN KEY ("derived_to_agency_id") REFERENCES "public"."agencies"("id") ON DELETE set null ON UPDATE no action;