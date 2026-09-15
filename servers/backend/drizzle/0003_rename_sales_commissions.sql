-- Disambiguate the two "sales" commissions:
--   • agency-sales commission (30%, paid to the sender/referred-by agency)
--   • salesperson commission   (a producing-agency staff cut, inside the 50%)
-- These are pure column renames; data is preserved.
ALTER TABLE "global_settings" RENAME COLUMN "sales_commission" TO "sales_agency_commission";--> statement-breakpoint
ALTER TABLE "purchases" RENAME COLUMN "sales_commission" TO "sales_agency_commission";--> statement-breakpoint
ALTER TABLE "agencies" RENAME COLUMN "redirect_sales_commission_to_bank_account" TO "redirect_sales_person_commission_to_bank_account";
