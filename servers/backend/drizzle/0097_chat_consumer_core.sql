-- Consumer messenger — the columns and tables behind chat.prodesk.com.
--
-- Nothing in this file uses the 'direct' / 'group' enum literals added in 0096;
-- the index that does is 0098.

-- ── Threads ─────────────────────────────────────────────────────────────────
-- A group's avatar. DMs derive theirs from the counterparty, so this is only
-- ever set on `group` threads.
ALTER TABLE "chat_threads" ADD COLUMN IF NOT EXISTS "photo_url" text;
--> statement-breakpoint

-- Who sent the message currently previewed in `last_message`.
--
-- This one column is what makes the messenger's inbox possible. Its sections are
-- Owed / Waiting / Settled — "the ball is in your court" vs "you've replied" —
-- and deciding that needs to know who spoke last, not merely whether anything is
-- unread. Unread is the wrong signal: a message you READ and did not answer is
-- still owed, and that is exactly the case every other messenger loses.
--
-- Computing it per row instead would need a lateral join to the newest
-- chat_messages row for every thread on every inbox page. `send` already updates
-- this row for the preview, so maintaining it is free.
--
-- Deliberately not backfilled: workspace threads never appear in the messenger,
-- and a messenger thread has it from its first message onward.
ALTER TABLE "chat_threads"
  ADD COLUMN IF NOT EXISTS "last_message_sender_id" uuid
  REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ── Membership ──────────────────────────────────────────────────────────────
-- These ride on the EXISTING (thread_id, user_id) primary-key row, so there is
-- no new RLS surface and no new realtime table: chat_thread_members is already
-- published with `replica identity full`.
--
-- `is_admin` is a NEW column and deliberately NOT the existing `role` column.
-- routers/chat/threads.ts#unreadByIdentity reads role='admin' as PLATFORM admin
-- and buckets that member's unread into the `platformAdmin_app` badge — so using
-- `role` for group admins would dump group unread counts into the super-admin
-- badge. Consumer members always keep role='user'.
--
-- `request_state` is the anti-spam gate, and it is mandatory rather than nice to
-- have: the moment anyone can be found by email address, an unsolicited DM is one
-- request away. A first message from a stranger lands 'pending' for the RECIPIENT
-- only — the sender's own row is always 'accepted'.
ALTER TABLE "chat_thread_members"
  ADD COLUMN IF NOT EXISTS "is_admin" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "request_state" text DEFAULT 'accepted' NOT NULL,
  ADD COLUMN IF NOT EXISTS "muted_until" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "is_pinned" boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS "pinned_at" timestamp with time zone;
--> statement-breakpoint

ALTER TABLE "chat_thread_members"
  DROP CONSTRAINT IF EXISTS "chat_thread_members_request_state_ck";
--> statement-breakpoint
ALTER TABLE "chat_thread_members"
  ADD CONSTRAINT "chat_thread_members_request_state_ck"
  CHECK ("request_state" IN ('accepted', 'pending', 'declined'));
--> statement-breakpoint

-- Serves the Requests inbox ("my pending threads") and, just as importantly, the
-- digest worker's exclusion of pending threads.
CREATE INDEX IF NOT EXISTS "chat_thread_members_requests_idx"
  ON "chat_thread_members" ("user_id", "request_state");
--> statement-breakpoint

-- ── Messages: soft edit + soft delete ───────────────────────────────────────
-- Both are UPDATEs, so the existing chat_messages postgres_changes UPDATE
-- subscription delivers them with no new broadcast, and chat_messages already
-- has `replica identity full`.
--
-- Delete is SOFT and always will be. The Document Locker mirror
-- (routers/chat/messages.ts) and every reply chain (`reply_to_id`) point at the
-- row, and a hard DELETE ships only the primary key to realtime — subscribers
-- would have no way to know which thread lost a message. A tombstone in the
-- transcript is also simply better than a hole.
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "edited_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deleted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "deleted_by" uuid REFERENCES "users" ("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ── Discoverability ─────────────────────────────────────────────────────────
-- Default true = exactly today's behaviour: staff.invite and
-- connections.inviteContractor already resolve users by email address. This makes
-- that resolvable-ness a setting the person owns rather than an assumption.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "discoverable_by_email" boolean DEFAULT true NOT NULL;
--> statement-breakpoint

-- ── Reactions ───────────────────────────────────────────────────────────────
-- thread_id is DENORMALISED on purpose. Supabase realtime can only filter
-- postgres_changes on a column of the CHANGED row, and the client subscribes per
-- thread (`filter: thread_id=eq.<id>`). Without it, every browser would receive
-- every reaction on the platform and discard almost all of them.
CREATE TABLE IF NOT EXISTS "chat_message_reactions" (
  "message_id" uuid NOT NULL REFERENCES "chat_messages" ("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "emoji" text NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "chat_threads" ("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_message_reactions_pk" PRIMARY KEY ("message_id", "user_id", "emoji")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_message_reactions_thread_idx"
  ON "chat_message_reactions" ("thread_id");
--> statement-breakpoint

-- ── Blocks ──────────────────────────────────────────────────────────────────
-- Checked in BOTH directions before a DM is created or a message is sent, and
-- consulted by discovery so a blocked person cannot tell they were blocked.
CREATE TABLE IF NOT EXISTS "chat_user_blocks" (
  "blocker_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "blocked_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_user_blocks_pk" PRIMARY KEY ("blocker_id", "blocked_id"),
  CONSTRAINT "chat_user_blocks_not_self" CHECK ("blocker_id" <> "blocked_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_user_blocks_blocked_idx"
  ON "chat_user_blocks" ("blocked_id");
--> statement-breakpoint

-- ── Invites to addresses with no account ────────────────────────────────────
-- Mirrors the pendingInvite shape of agency_contractor_connections: the row
-- exists before the user does and is claimed at signup.
--
-- It has to be its own table rather than a member row, because
-- chat_thread_members.user_id is a NOT NULL foreign key to users — a person
-- without an account is not representable there. No thread is created until they
-- sign up.
CREATE TABLE IF NOT EXISTS "chat_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "invited_by" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "claimed_by" uuid REFERENCES "users" ("id") ON DELETE SET NULL,
  "claimed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_invites_status_ck" CHECK ("status" IN ('pending', 'claimed', 'revoked'))
);
--> statement-breakpoint
-- One live invite per (inviter, address) — a second "invite them" is a no-op
-- rather than a second email.
CREATE UNIQUE INDEX IF NOT EXISTS "chat_invites_pending_uq"
  ON "chat_invites" ("email", "invited_by") WHERE "status" = 'pending';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_invites_email_idx" ON "chat_invites" ("email");
