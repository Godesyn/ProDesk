-- Backfill the typed party FK columns (added in 0010) from the legacy
-- `from_party` / `to_party` JSON, THEN enforce the one-party CHECKs, THEN drop
-- the JSON. Order matters: the UPDATE must read the JSON before it is dropped,
-- and the CHECKs must run only once the columns are populated.
--
-- PREREQUISITE: the embedded party ids must already be valid UUIDs — run
-- `src/scripts/backfill-invoice-party-ids.ts` against this environment first.
-- Any non-UUID id (e.g. a leftover Firebase uid) makes the ::uuid cast abort the
-- whole migration (it runs in one transaction), which is the intended safety net.
UPDATE "invoices" SET
  "from_is_prodesk" = COALESCE(("from_party"->>'isProdesk')::boolean, false),
  "from_agency_id"  = NULLIF("from_party"->>'agencyId', '')::uuid,
  "from_brand_id"   = NULLIF("from_party"->>'brandId', '')::uuid,
  "from_user_id"    = NULLIF("from_party"->>'userId', '')::uuid,
  "to_is_prodesk"   = COALESCE(("to_party"->>'isProdesk')::boolean, false),
  "to_agency_id"    = NULLIF("to_party"->>'agencyId', '')::uuid,
  "to_brand_id"     = NULLIF("to_party"->>'brandId', '')::uuid,
  "to_user_id"      = NULLIF("to_party"->>'userId', '')::uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_from_one_party" CHECK (("invoices"."from_is_prodesk")::int + num_nonnulls("invoices"."from_agency_id", "invoices"."from_brand_id", "invoices"."from_user_id") = 1);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_to_one_party" CHECK (("invoices"."to_is_prodesk")::int + num_nonnulls("invoices"."to_agency_id", "invoices"."to_brand_id", "invoices"."to_user_id") = 1);--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "from_party";--> statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "to_party";
