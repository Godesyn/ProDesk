-- Outreach — the four tables behind the super-admin cold-email cockpit.
--
-- Smartlead is the system of record for mailboxes, campaigns, sequences,
-- schedules, message bodies and deliverability; those are read live and cached
-- in Redis, never mirrored here. Each table below earns its place by one of:
-- Smartlead has no field for it, it must be queried across all campaigns at
-- once, or losing it loses work.
--
-- See docs/agents/outreach.md §5 and docs/agents/outreach-api-findings.md.

-- ── Prospect state ────────────────────────────────────────────────────────────
-- One row per prospected address, keyed by the NORMALISED (lowercased, trimmed)
-- email. This is the table the Prospects tab paginates and filters on; the
-- conversation itself is joined in per-row from Smartlead at open time.
CREATE TABLE IF NOT EXISTS "outreach_prospect_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  -- From the list-build scrape. `category` is what Maps called the business;
  -- `vertical` is the campaign bucket WE chose, and drives which campaign the
  -- prospect is pushed into (one campaign per vertical).
  "business_name" text,
  "website" text,
  "category" text,
  "vertical" text,
  -- The one concrete detail the personalisation pass extracted. NULL is a
  -- first-class value: a blocked or detail-less site keeps the contact, and
  -- every template must degrade gracefully when this is missing.
  "personalisation_detail" text,
  "source" text,
  -- Which of the four sending domains this prospect was contacted from. Reply
  -- routing keys off this, so it is recorded rather than inferred.
  "sending_domain" text,
  -- Smartlead handles. `smartlead_lead_id` comes back from the lead upload
  -- (settings.return_lead_ids) and is what the thread fetch needs.
  "smartlead_campaign_id" bigint,
  "smartlead_lead_id" text,
  -- Model classification. NULL until a reply arrives and is classified.
  "classification" text,
  "classification_reasoning" text,
  "classification_confidence" numeric(4, 3),
  "classified_at" timestamp with time zone,
  -- Human override of the model. Kept separate from `classification` so the
  -- model's original call is never destroyed by a correction.
  "manual_classification" text,
  "manual_classification_by_user_id" uuid,
  "manual_classification_at" timestamp with time zone,
  -- Fulfilment: the `yes` → Verdiict account handoff.
  "fulfilment_status" text DEFAULT 'none' NOT NULL,
  "fulfilment_at" timestamp with time zone,
  -- The account is created against the address that REPLIED, which is not
  -- always the address we prospected.
  "fulfilment_email" text,
  "fulfilment_brand_id" uuid,
  -- Maintained from webhooks so the list can sort and filter on them without
  -- fanning out across every campaign in Smartlead.
  "last_sent_at" timestamp with time zone,
  "replied_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_prospect_state_classification_ck" CHECK (
    "outreach_prospect_state"."classification" IS NULL
    OR "outreach_prospect_state"."classification" IN ('yes', 'question', 'not_now', 'never', 'other')
  ),
  CONSTRAINT "outreach_prospect_state_manual_classification_ck" CHECK (
    "outreach_prospect_state"."manual_classification" IS NULL
    OR "outreach_prospect_state"."manual_classification" IN ('yes', 'question', 'not_now', 'never', 'other')
  ),
  CONSTRAINT "outreach_prospect_state_fulfilment_ck" CHECK (
    "outreach_prospect_state"."fulfilment_status" IN ('none', 'pending', 'created', 'existing', 'failed')
  )
);--> statement-breakpoint

ALTER TABLE "outreach_prospect_state" ADD CONSTRAINT "outreach_prospect_state_manual_classification_by_user_id_users_id_fk" FOREIGN KEY ("manual_classification_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_prospect_state" ADD CONSTRAINT "outreach_prospect_state_fulfilment_brand_id_brands_id_fk" FOREIGN KEY ("fulfilment_brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The normalised email is the identity of a prospect: dedupe at list-build time
-- and the webhook upsert both depend on this being unique.
CREATE UNIQUE INDEX IF NOT EXISTS "outreach_prospect_state_email_uq" ON "outreach_prospect_state" USING btree ("email");--> statement-breakpoint
-- Keyset pagination for the Prospects list (newest first, id as the tiebreak).
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_created_idx" ON "outreach_prospect_state" USING btree ("created_at" DESC, "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_classification_idx" ON "outreach_prospect_state" USING btree ("classification");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_vertical_idx" ON "outreach_prospect_state" USING btree ("vertical");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_sending_domain_idx" ON "outreach_prospect_state" USING btree ("sending_domain");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_prospect_state_campaign_idx" ON "outreach_prospect_state" USING btree ("smartlead_campaign_id");--> statement-breakpoint

-- ── Reply drafts ──────────────────────────────────────────────────────────────
-- The human-approval queue. Sent drafts are KEPT — this is the record of what we
-- actually said, which Smartlead's thread view alone doesn't attribute to an
-- approver.
CREATE TABLE IF NOT EXISTS "outreach_reply_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "prospect_id" uuid,
  -- Denormalised so a draft is still readable if the prospect row is rebuilt.
  "email" text NOT NULL,
  -- Where the reply goes back to. `smartlead_email_stats_id` is the only
  -- identifier reply-email-thread actually requires.
  "smartlead_campaign_id" bigint,
  "smartlead_email_stats_id" text,
  "smartlead_message_id" text,
  -- What the model wrote, preserved verbatim even after a human edits it.
  "draft_body" text NOT NULL,
  -- What actually went out. NULL until sent.
  "sent_body" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "discarded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_reply_drafts_status_ck" CHECK (
    "outreach_reply_drafts"."status" IN ('pending', 'approved', 'edited', 'sent', 'discarded')
  )
);--> statement-breakpoint

ALTER TABLE "outreach_reply_drafts" ADD CONSTRAINT "outreach_reply_drafts_prospect_id_outreach_prospect_state_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."outreach_prospect_state"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_reply_drafts" ADD CONSTRAINT "outreach_reply_drafts_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The queue reads "pending first, oldest first" — that ordering is the index.
CREATE INDEX IF NOT EXISTS "outreach_reply_drafts_status_idx" ON "outreach_reply_drafts" USING btree ("status", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_reply_drafts_email_idx" ON "outreach_reply_drafts" USING btree ("email");--> statement-breakpoint

-- ── Suppression ───────────────────────────────────────────────────────────────
-- The global master across all 4 domains and 20 mailboxes. Written here FIRST,
-- then pushed to Smartlead; `pushed_at` is what tells the two apart, because a
-- row that never reached Smartlead is a row that can still be emailed.
CREATE TABLE IF NOT EXISTS "outreach_suppression" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- A normalised email address, or a bare domain.
  "value" text NOT NULL,
  "kind" text NOT NULL,
  "reason" text,
  "source" text,
  "added_by_user_id" uuid,
  "pushed_at" timestamp with time zone,
  "push_error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_suppression_kind_ck" CHECK ("outreach_suppression"."kind" IN ('email', 'domain'))
);--> statement-breakpoint

ALTER TABLE "outreach_suppression" ADD CONSTRAINT "outreach_suppression_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_suppression_value_uq" ON "outreach_suppression" USING btree ("value");--> statement-breakpoint
-- The sweep that retries un-pushed entries.
CREATE INDEX IF NOT EXISTS "outreach_suppression_pushed_idx" ON "outreach_suppression" USING btree ("pushed_at");--> statement-breakpoint

-- ── Webhook events ────────────────────────────────────────────────────────────
-- Receipts only, for idempotency and replay — not reporting. Trimmed on a
-- retention window.
--
-- Smartlead's webhook payloads carry NO unique event id and NO signature (see
-- outreach-api-findings.md ⚠️2), so idempotency runs off a SYNTHETIC key we
-- derive: a hash of event type + campaign + recipient + event timestamp.
-- `smartlead_event_id` is kept nullable in case they ever start sending one.
CREATE TABLE IF NOT EXISTS "outreach_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" text NOT NULL,
  "smartlead_event_id" text,
  "event_type" text NOT NULL,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "process_error" text
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "outreach_events_idempotency_key_uq" ON "outreach_events" USING btree ("idempotency_key");--> statement-breakpoint
-- Drives both the retention trim and the "unprocessed events" reconcile cron.
CREATE INDEX IF NOT EXISTS "outreach_events_received_idx" ON "outreach_events" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_events_unprocessed_idx" ON "outreach_events" USING btree ("processed_at") WHERE "processed_at" IS NULL;
