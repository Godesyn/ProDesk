ALTER TABLE "review_referral_redemptions" ADD COLUMN "credited_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_referral_redemptions" ADD COLUMN "credit_amount" numeric;--> statement-breakpoint
ALTER TABLE "review_referral_redemptions" ADD COLUMN "credit_currency" text;--> statement-breakpoint
-- Pre-settlement rows already bumped months_earned at redeem time (old semantics):
-- mark them settled so the new activation hook can never credit them again.
UPDATE "review_referral_redemptions" SET "credited_at" = "created_at" WHERE "credited_at" IS NULL;--> statement-breakpoint
-- One redemption per user from now on; keep only each user's earliest redemption.
DELETE FROM "review_referral_redemptions" a USING "review_referral_redemptions" b
  WHERE a."redeemed_by_user_id" = b."redeemed_by_user_id"
    AND (a."created_at" > b."created_at" OR (a."created_at" = b."created_at" AND a."id" > b."id"));--> statement-breakpoint
CREATE UNIQUE INDEX "review_referral_redemptions_user_uniq" ON "review_referral_redemptions" USING btree ("redeemed_by_user_id");