ALTER TABLE "users" ADD COLUMN "reset_otp_hash" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_otp_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reset_otp_attempts" integer DEFAULT 0 NOT NULL;