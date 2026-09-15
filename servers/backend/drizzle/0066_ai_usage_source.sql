-- Attribute each ai_usage row to the AI feature that spent the tokens, so the
-- super-admin AI-spend report can break cost down by feature, not just by brand.
ALTER TABLE "ai_usage" ADD COLUMN IF NOT EXISTS "source" text;
CREATE INDEX IF NOT EXISTS "ai_usage_source_idx" ON "ai_usage" ("source","created_at");
