CREATE TABLE "review_admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_admin_audit" ADD CONSTRAINT "review_admin_audit_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_admin_audit_created_idx" ON "review_admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "review_admin_audit_target_idx" ON "review_admin_audit" USING btree ("target_type","target_id");