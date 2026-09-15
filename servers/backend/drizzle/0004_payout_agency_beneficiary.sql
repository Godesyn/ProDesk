ALTER TYPE "public"."payout_as" ADD VALUE IF NOT EXISTS 'agency';--> statement-breakpoint
ALTER TABLE "payouts" ADD COLUMN "beneficiary_agency_id" uuid;--> statement-breakpoint
ALTER TABLE "payouts" ALTER COLUMN "beneficiary_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_beneficiary_agency_id_agencies_id_fk" FOREIGN KEY ("beneficiary_agency_id") REFERENCES "public"."agencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_one_beneficiary" CHECK (num_nonnulls("payouts"."beneficiary_id", "payouts"."beneficiary_agency_id") = 1);--> statement-breakpoint
CREATE INDEX "payouts_beneficiary_agency_idx" ON "payouts" USING btree ("beneficiary_agency_id");
