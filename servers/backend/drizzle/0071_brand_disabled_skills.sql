-- Per-brand AI skill opt-outs. Stores the ids of skills the brand has DISABLED
-- (so an empty/absent value means every skill is on — new skills default enabled).
ALTER TABLE "brand_notes" ADD COLUMN IF NOT EXISTS "disabled_skills" text[];
