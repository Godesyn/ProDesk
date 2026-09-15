CREATE TABLE "link_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "short_links" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "link_campaigns" ADD CONSTRAINT "link_campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_campaigns" ADD CONSTRAINT "link_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_campaigns_brand_idx" ON "link_campaigns" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "link_campaigns_brand_name_lower_idx" ON "link_campaigns" USING btree ("brand_id",lower("name"));--> statement-breakpoint
ALTER TABLE "short_links" ADD CONSTRAINT "short_links_campaign_id_link_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."link_campaigns"("id") ON DELETE set null ON UPDATE no action;