ALTER TABLE "link_events" ADD COLUMN "source" text DEFAULT 'link';
ALTER TABLE "link_events" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;
ALTER TABLE "link_events" ADD COLUMN "ip_hash" text;
ALTER TABLE "signature_analytics_events" ADD COLUMN "is_bot" boolean DEFAULT false NOT NULL;
