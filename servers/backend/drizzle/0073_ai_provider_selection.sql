-- Multi-provider AI: let a brand choose which provider family powers its
-- assistant, and let super-admin turn families OFF (exclusion-based).
--
-- brand_notes.selected_ai_provider: the family the brand picked ('anthropic' |
-- 'gemini' | …). Null = default (first enabled family). Only honoured when more
-- than one family is enabled.
ALTER TABLE "brand_notes" ADD COLUMN IF NOT EXISTS "selected_ai_provider" text;

-- global_settings.disabled_ai_providers: families the super-admin disabled.
-- Null/empty = every configured family is available (default-on, like skills).
ALTER TABLE "global_settings" ADD COLUMN IF NOT EXISTS "disabled_ai_providers" text[];
