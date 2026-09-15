CREATE TABLE "link_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"campaign_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"referrer_host" text,
	"device" text,
	"browser" text,
	"os" text,
	"country" text
);
--> statement-breakpoint
ALTER TABLE "link_events" ADD CONSTRAINT "link_events_link_id_short_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."short_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_events" ADD CONSTRAINT "link_events_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_events" ADD CONSTRAINT "link_events_campaign_id_link_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."link_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_events_brand_time_idx" ON "link_events" USING btree ("brand_id","occurred_at");--> statement-breakpoint
CREATE INDEX "link_events_link_time_idx" ON "link_events" USING btree ("link_id","occurred_at");