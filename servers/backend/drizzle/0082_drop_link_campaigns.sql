-- Drop the original link-campaigns feature outright. Campaigns are being rebuilt
-- from scratch as scheduled-destination links (a fallback URL plus dated windows
-- that override it), which shares nothing with this grouping-label model — so the
-- old table and both FK columns go rather than being migrated.

-- Realtime publication + replica identity are managed by sql/rls.sql; dropping
-- the table removes it from the publication automatically.
DROP POLICY IF EXISTS "link_campaigns_visible" ON "link_campaigns";

ALTER TABLE "short_links" DROP COLUMN IF EXISTS "campaign_id";
ALTER TABLE "link_events" DROP COLUMN IF EXISTS "campaign_id";

DROP TABLE IF EXISTS "link_campaigns" CASCADE;
