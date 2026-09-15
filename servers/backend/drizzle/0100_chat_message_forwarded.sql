-- Mark a message that arrived via Forward, so the destination thread can say so.
ALTER TABLE "chat_messages" ADD COLUMN IF NOT EXISTS "is_forwarded" boolean DEFAULT false NOT NULL;
