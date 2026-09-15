ALTER TABLE "invoices" DROP CONSTRAINT "invoices_from_one_party";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_to_one_party";--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "from_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "to_contact_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "payment_transaction_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_contact_id_payment_clients_id_fk" FOREIGN KEY ("from_contact_id") REFERENCES "public"."payment_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_contact_id_payment_clients_id_fk" FOREIGN KEY ("to_contact_id") REFERENCES "public"."payment_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."payment_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_to_contact_idx" ON "invoices" USING btree ("to_contact_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_transaction_id_unique" UNIQUE("payment_transaction_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_one_party" CHECK (("invoices"."from_is_prodesk")::int + num_nonnulls("invoices"."from_agency_id", "invoices"."from_brand_id", "invoices"."from_user_id", "invoices"."from_contact_id") = 1);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_one_party" CHECK (("invoices"."to_is_prodesk")::int + num_nonnulls("invoices"."to_agency_id", "invoices"."to_brand_id", "invoices"."to_user_id", "invoices"."to_contact_id") = 1);