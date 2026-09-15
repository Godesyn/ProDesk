ALTER TABLE "invoices" ADD COLUMN "from_is_prodesk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "from_agency_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "from_brand_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "from_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "to_is_prodesk" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "to_agency_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "to_brand_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "to_user_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_agency_id_agencies_id_fk" FOREIGN KEY ("from_agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_brand_id_brands_id_fk" FOREIGN KEY ("from_brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_user_id_users_id_fk" FOREIGN KEY ("from_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_agency_id_agencies_id_fk" FOREIGN KEY ("to_agency_id") REFERENCES "public"."agencies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_brand_id_brands_id_fk" FOREIGN KEY ("to_brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_user_id_users_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_from_user_idx" ON "invoices" USING btree ("from_user_id");--> statement-breakpoint
CREATE INDEX "invoices_to_user_idx" ON "invoices" USING btree ("to_user_id");--> statement-breakpoint
CREATE INDEX "invoices_from_agency_idx" ON "invoices" USING btree ("from_agency_id");--> statement-breakpoint
CREATE INDEX "invoices_to_agency_idx" ON "invoices" USING btree ("to_agency_id");