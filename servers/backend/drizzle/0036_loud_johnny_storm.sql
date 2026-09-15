ALTER TABLE "brand_products" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "brand_products" CASCADE;--> statement-breakpoint
ALTER TABLE "payment_products" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_products" ADD CONSTRAINT "payment_products_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;