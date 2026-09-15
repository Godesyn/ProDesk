-- Migration 0012: Drop vestigial invoice `status` column.
--
-- Status is now fully derived at read time from the linked payout
-- (docs/invoices.md §7):
--   - No payout (brand charge) → 'paid'
--   - Payout exists → map payout.status onto invoice status
--
-- Data fixes for legacy invoices ($0 totals, orphaned payoutIds) are handled
-- separately by `server/src/scripts/fix-invoice-data.ts`.
DROP INDEX IF EXISTS "invoices_status_idx";-->statement-breakpoint
ALTER TABLE "invoices" DROP COLUMN "status";
