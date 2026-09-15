-- The scraped phone number, kept instead of thrown away.
--
-- Exactly the gap 0106 closed for the street address, and for the same reason:
-- `push()` maps this straight into Smartlead's `phone_number` field and then
-- drops the value, so the number the campaign holds is one we cannot read back.
-- It costs nothing to keep — it arrives in the Apify base item alongside the
-- rating and the review count — and when someone opens a business to decide
-- whether we should be emailing them at all, a phone number is the one contact
-- detail an email address cannot stand in for.
--
-- Rows pushed before this migration keep a NULL, and there is no backfill: the
-- candidate set a run was built from is dropped the moment the run is done, so
-- the value is genuinely gone for anything already sent. Nothing reads this
-- column as required.
ALTER TABLE "outreach_prospect_state"
  ADD COLUMN IF NOT EXISTS "phone" text;
