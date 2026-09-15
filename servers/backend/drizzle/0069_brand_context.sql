-- Standing brand context the owner writes once and the AI assistant always
-- attaches (like an identity), so they needn't repeat it every message.
ALTER TABLE "brand_notes" ADD COLUMN IF NOT EXISTS "context" text DEFAULT '' NOT NULL;
