-- Per-action "Regenerate" history on AI action cards, keyed by toolUseId → an
-- ordered list of reimagined payloads (gen1, gen2, …). Persisted so the gen
-- chips survive reloads / are shared across the team, and so each new generation
-- can be made to differ from every prior one. Capped at 5 per card in app code.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "action_regenerations" jsonb;
