-- Make `brands.signature_slug` nullable.
--
-- 0090 originally shipped with `SET NOT NULL` and was applied to an environment
-- in that form before the constraint was reconsidered. It has to go: `brands` is
-- written by billing, onboarding, the marketplace and several test factories,
-- none of which know or should know about a signatures URL — a NOT NULL column
-- there turns every one of those inserts into a compile error and, worse, a
-- runtime not-null violation for any caller not yet updated.
--
-- NULL now means "not minted yet"; `ensureBrandSignatureSlug` mints on first use,
-- exactly as `ensureBrandKit` already provisions the brand kit. 0090's backfill
-- means no brand that already existed is ever NULL, and the unique index still
-- holds because Postgres permits many NULLs in a unique index.
--
-- No-op on any environment where 0090 ran in its current (nullable) form.

ALTER TABLE "brands" ALTER COLUMN "signature_slug" DROP NOT NULL;
