# Outreach — Smartlead API verification (step zero)

Verified 2026-08-10 against `https://api.smartlead.ai` (sitemap-derived reference index).
This resolves "Step zero" in [outreach.md](./outreach.md) §14. Read the three **⚠️** items
before implementing — they change what §5 and §2 assumed.

**Base URL:** `https://server.smartlead.ai/api/v1`
**Auth:** `?api_key=…` query parameter on every request (POST/PATCH may also carry it in the body).
There is no bearer-header form. Keep the key server-side only; it is password-equivalent.

---

## The scope question — resolved, scope does not move

**Mailboxes can be connected entirely via API.** No one-time job in Smartlead's UI.

- `POST /email-accounts/save` — SMTP/IMAP credentials. Required: `from_name`, `from_email`,
  `user_name`, `password`, `smtp_host`, `smtp_port`, `imap_host`, `imap_port`, `warmup_enabled`.
  Optional: `max_email_per_day`, `time_to_wait_in_mins`, `total_warmup_per_day`, `daily_rampup`,
  `imap_user_name`, `imap_password`, `type` (`GMAIL|OUTLOOK|SMTP`), `signature`,
  `different_reply_to_address`.
- `POST /email-accounts/save-oauth` — takes pre-obtained OAuth tokens and completes headlessly.
  It does **not** return a consent URL; the Google consent step happens in our own OAuth flow first.

**Setup-day caveat, outside the API:** Google Workspace SMTP needs an app password per mailbox,
which requires 2FA enabled on each of the 20 users. The alternative is minting tokens through our
own Google OAuth client and using `save-oauth`. Either way it is a Workspace-admin task, not a
Smartlead-UI task.

## The key-scoping question — one key covers all 20

`client_id` exists only for white-label **sub-accounts** (agencies reselling Smartlead). All four
domains sit under our own single Smartlead account, so **one master key covers all 20 mailboxes**
and the passthrough layer needs no multi-key fan-out.

`POST /api/v1/client/api-key` provisions per-client keys, and a master key does *not* transparently
act across client sub-accounts. We aren't using clients — but carry an optional `clientId` through
the client seam anyway; it is nearly free now and expensive to retrofit.

---

## ✅ 1. Locked decision #5 ("Stop = cap 0") — CONFIRMED against the live API

Tested 2026-08-10 against `hello@useprodesk.com` with a real key:

```
POST /email-accounts/22225122   {"max_email_per_day": 0}
→ 200 {"ok":true,"message":"Email account details updated successfully!"}
GET  /email-accounts/22225122   → message_per_day = 0      (persisted)
```

Restored to 15 immediately after. **Decision #5 stands exactly as written** — a zero cap is
accepted, immediate, reversible, one field, and it leaves warmup running.

`PUT /email-accounts/suspend/{id}` (and unsuspend) exists and is kept in the client as a defensive
fallback in case Smartlead tightens that validation later. It should never fire. If it ever does,
the operator must be told, because suspension **also pauses warmup** — the one thing cap-0 avoids.
`stopMailbox` returns which mechanism ran so the toast can say so.

The UI reads "stopped" from either signal (`message_per_day === 0` **or** `is_suspended`), so the
distinction never leaks into the screen.

## ⚠️ 2. Webhooks have no event id and no signature — §5's `outreach_events` needs a change

The docs list no unique event id on the payload, and explicitly recommend deduplicating on
`campaign_id + to_email + event_type + timestamp`. There is also **no HMAC signing or secret
verification** documented.

Consequences for the plan:

- `outreach_events` cannot key on "Smartlead event id (unique)". Use a **synthetic** idempotency key:
  a hash of `event_type + campaign_id + to_email + event timestamp`, unique-indexed. Same guarantee,
  derived rather than given.
- The endpoint must authenticate itself, since Smartlead won't. Put an unguessable secret in the
  webhook URL (path segment or query token) held in env, and reject anything else. Anyone who learns
  the URL can forge events, so the URL *is* the credential — treat it like one.

**Event types (verbatim):** `EMAIL_SENT`, `FIRST_EMAIL_SENT`, `EMAIL_OPEN`, `EMAIL_LINK_CLICK`,
`EMAIL_REPLY`, `EMAIL_BOUNCE`, `LEAD_UNSUBSCRIBED`, `LEAD_CATEGORY_UPDATED`, `CAMPAIGN_STATUS_CHANGED`,
`UNTRACKED_REPLIES`, `MANUAL_STEP_REACHED`, `EMAIL_ACCOUNT_DISCONNECTED`, `LINKEDIN_DISCONNECTED`.

`EMAIL_ACCOUNT_DISCONNECTED` wasn't in the plan's list and matters a lot — a silently disconnected
mailbox is invisible lost throughput. Surface it on the Sending Floor.

**Registration:** `POST /webhook/create` with `webhook_url`, `association_type` (user | client |
campaign), optional `name`, `event_type_map` (event → boolean), `category_id_map`, `force_create`.
Register once at **user level** and it covers every campaign — no per-campaign wiring.

## ⚠️ 3. Sequences cannot be edited while a campaign is ACTIVE

"Cannot modify sequences while campaign is ACTIVE. Pause campaign first, make changes, then resume."

§8 lets the operator author sequences and start/pause independently, which will fail mid-edit on a
running campaign. The Sending Email tab must either pause → save → resume behind one action (with the
state visible, since a paused campaign isn't sending), or refuse the edit with a clear reason and an
explicit "Pause and edit" affordance. Decide this before building §8; don't let it surface as a raw
API error.

---

## Rate limits — documented, with headers

| Tier | Per minute | Per hour | Burst |
|---|---|---|---|
| Standard | 60 | 1,000 | 10 req/s |
| Pro | 120 | 3,000 | 20 req/s |

Limits are **per API key across all endpoints combined**. Responses carry `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, `X-RateLimit-Reset`; a 429 carries `Retry-After` and a
`RATE_LIMIT_EXCEEDED` body. Docs recommend exponential backoff with jitter and self-limiting to 80%
of the ceiling.

The plan's "roughly 10 requests / 2 seconds" was conservative — the real Pro ceiling is 120/min.
Keep the conservative posture anyway (§1's safety-over-throughput rule), but read the headers rather
than guessing, and back off on `Retry-After` when present.

---

## Endpoint map for the build

### Mailboxes / Sending Floor (§6)
- `GET /email-accounts/` — `limit` (max 100), `offset`, `emailWarmupStatus`, `isSmtpSuccess`,
  `isInUse`, `esp`, `fetch_campaigns`. Returns per account: `id`, `from_email`, `from_name`,
  `type`, **`message_per_day`**, **`daily_sent_count`**, `minTimeToWaitInMins`, `smtp_host/port`,
  `is_smtp_success`, `imap_host/port`, `is_imap_success`, `campaign_count`, `tags`, and a nested
  `warmup_details` { `status`, `total_sent_count`, `total_spam_count`, `warmup_reputation`,
  `reply_rate`, `blocked_reason` }.

  This one call feeds the entire Sending Floor: `daily_sent_count / message_per_day` **is** the
  capacity meter, and `warmup_details` is the health strip. 20 accounts fit in a single page.
- `GET /email-accounts/{id}` · `POST /email-accounts/{id}` (update) · `GET /email-accounts/{id}/warmup-stats`
  (7-day window: `total_sent`, `spam_count`, `reputation_score`, plus a daily breakdown).
- `PUT /email-accounts/suspend/{id}` · unsuspend.

### Monitoring panel (§6)
- `GET /analytics/mailbox/domain-wise-health-metrics` — `start_date`, `end_date` (YYYY-MM-DD),
  optional `timezone`, `client_ids`, `campaign_ids`, `full_data`, `limit`, `offset`.
  Returns **sent / opened / replied / bounced per domain**.

  Note against §6's honest limitation: this endpoint takes an arbitrary date range, so
  week-over-week trending **is** available without a snapshot table — query two windows and diff.
  Better than the plan assumed. There is also `email-wise-health` and `mailbox-health` for per-account.

### Campaigns / sequences (§8)
- `POST /campaigns/create` — `name`, optional `client_id`. Starts in `DRAFTED`.
- `PATCH /campaigns/{id}/status` — `ACTIVE | PAUSED | STOPPED`.
- `POST /campaigns/{id}/schedule` — **flat body, every field required** (corrected 2026-08-12
  against the live API; the published reference is wrong — see "Corrections" below):
  `timezone` (IANA), `days_of_the_week` (0=Sun…6=Sat), `start_hour`/`end_hour` ("09:00"),
  `min_time_btw_emails` (minutes), `max_new_leads_per_day`.

  It reads back under **different names**: `GET /campaigns/{id}` returns
  `scheduler_cron_value: { tz, days, startHour, endHour }`, `min_time_btwn_emails` (note the
  spelling) and `max_leads_per_day`. Write-names ≠ read-names; don't unify them.

  There is **no max-delay** on the schedule — the per-mailbox spacing lever is
  `time_to_wait_in_mins` on the account. But a max-new-leads-per-day *does* exist and is
  mandatory, so §6's earlier note that it doesn't is wrong.
- `POST /campaigns/{id}/sequences` — `sequences[]` of `{ id (null = new), seq_number, subject,
  email_body (HTML), seq_delay_details: { delay_in_days } }`. Merge tags are `{{first_name}}`,
  `{{company_name}}`, `{{website}}`, `{{location}}`, and any `custom_fields` key.
  Omitting `subject` on a follow-up threads it as "Re:".
- `POST /campaigns/{id}/email-accounts` · `POST /campaigns/{id}/leads` · `POST /campaigns/duplicate`.
- **`DELETE /campaigns/{id}/email-accounts`** — same body (`email_account_ids`), returns
  `{ok:true, result:<count>}`. Verified live 2026-08-13, so the campaign screen's mailbox
  checkboxes are a genuine sync (add + detach), not an append-only list.
- **Region search reuses `GOOGLE_MAPS_API_KEY`** — the key `routers/places.ts` already proxies
  address autocomplete with. Both Places (New) calls verified server-side with it; no separate
  key. Unset → the List Builder falls back to OpenStreetMap, which needs no key at all.

### Leads / prospects (§7, §11)
- `POST /campaigns/{id}/leads` — **max 400 leads per request** (chunk size for the Worker push).
  Lead: `email` (required), `first_name`, `last_name`, `company_name`, `phone_number`, `website`,
  `location`, `linkedin_profile`, `company_url`, `custom_fields` (≤200 keys — this is where the
  scraped personalisation detail goes). `settings`: `ignore_global_block_list`,
  `ignore_unsubscribe_list`, `ignore_duplicate_leads_in_other_campaign`,
  `ignore_community_bounce_list`, `return_lead_ids`.

  Leave every `ignore_*` false. They exist to bypass exactly the protections §1 is built around.
  Set `return_lead_ids: true` so we can store the Smartlead lead id against our prospect row.
- `GET /leads/by-email` · `GET /campaigns/{id}/leads/{lead_id}/message-history`.

### Suppression (§9)
- `POST /leads/add-domain-block-list` — `domain_block_list[]` accepts **both** bare domains and full
  email addresses despite the field name; optional `client_id`.
- `GET /leads/get-domain-block-list` (paginated) · `DELETE /leads/delete-domain-block-list` (by entry id).

### Reply Queue (§9)
- `POST /campaigns/{id}/reply-email-thread` — required: `email_stats_id`, `email_body`.
  Optional: `reply_message_id`, `reply_email_time`, `cc`, `bcc`, `to_email`, `to_first_name`,
  `to_last_name`, `add_signature`, attachments, and **`scheduled_time`** (ISO 8601).

  `scheduled_time` is a genuine bonus: an approved reply can be queued to land in business hours
  rather than at 2am, without us building a scheduler.

---

## Corrections from the live API (docs were wrong)

- **No account-level webhook list.** `GET /webhook` 404s, and `/webhook/{anything}` validates the
  segment as a numeric id — so the only account-level read is `GET /webhook/{webhook_id}`. Record the
  id when registering the user-level webhook; you cannot discover it afterwards. (Per-campaign
  listing via `/campaigns/{id}/webhooks` still exists.)
- **Error bodies are `{statusCode, error, message, validation}`**, not the `{error:{code,message}}`
  shape the rate-limit guide shows. The client's `extractMessage` handles both.
- **The campaign-schedule body is flat, not wrapped** (found 2026-08-12: every schedule save 400'd).
  `api.smartlead.ai/reference/update-campaign-schedule` documents `{ schedule: { timezone, days,
  … } }` with `min_time_btw_emails` optional. All three of those are wrong. Probed live against a
  DRAFTED campaign:

  | body | result |
  |---|---|
  | `{schedule:{timezone, days, …}}` (the documented shape) | 400 `"timezone" is required` |
  | flat + `days` | 400 `"days_of_the_week" is required` |
  | flat + `days_of_the_week`, no leads cap | 400 `"max_new_leads_per_day" is required` |
  | flat + `days_of_the_week` + `max_leads_per_day` | 400 `"max_new_leads_per_day" is required` |
  | flat + `days_of_the_week` + `max_new_leads_per_day` | **200 `{ok:true}`** |

  The `validation.keys` array in the 400 names the offending field — that is the fastest way to
  probe any other endpoint whose documented body is suspect.

  **`min_time_btw_emails` has a floor of 3.** `"must be larger than or equal to 3"`. Undocumented;
  found by sending 1. Both the zod input and the schedule panel enforce it.
- **Apify's `website` filter is `"withWebsite"`, not `"only"`.** The actor refuses the whole run:
  `Field input.website must be equal to one of the allowed values: "allPlaces", "withWebsite",
  "withoutWebsite"`. Every other field we send was then validated against the actor's live input
  schema (`GET /v2/acts/{actor}/builds/default`) — all 16 pass, nothing missing. Worth re-running
  that check whenever the actor version moves; it is free and catches this class of error before
  a run is attempted.

## Still to verify at runtime

**Message-history completeness.** Cannot be tested yet — the account has zero campaigns, and the
endpoint is campaign-and-lead scoped. The documented sample shows message id, subject, direction and
timestamps but does not demonstrate **full message bodies** or the sequence step number. Locked
decision #4 (trust Smartlead, no Gmail API in v1) and §7's "render a real thread" both depend on
bodies being present. If it proves thin, the `/inbox/get-messages` family is the richer fallback —
check that before concluding the thread view is impossible.

Run this the moment the first campaign has a lead with a reply, and before building §7 and §9.

---

## Live account state, 2026-08-10

First read of the real account (user_id 618155). Recorded because it differs from the plan:

| | Plan (§1) | Actual |
|---|---|---|
| Domains | 4 | **2** — `useprodesk.com`, `tryprodesk.com`. No `usenoize.com` / `trynoize.com`. |
| Mailboxes | 20 (5 × 4) | **9** — 3 on useprodesk, 6 on tryprodesk |
| Connection | OAuth or SMTP | **All `type: GMAIL` via OAuth** — no stored passwords |
| Daily cap | 20 (range 20–25) | **15** on every mailbox |
| Warmup | running on all | **not running on any** — see below |
| Campaigns | — | none |
| Global block list | — | empty |

**Warmup is the blocking problem.** Eight of the nine mailboxes have `warmup_details: null` — warmup
was never configured. The ninth (`admin@tryprodesk.com`) has warmup present but
`status: "INACTIVE"`, `warmup_reputation: "0%"`, `total_sent_count: 0`.

> **`warmup_reputation` is a percentage STRING, not a number** — `"0%"`, `"98%"`. `Number("98%")`
> is NaN, so a plain parse yields null and the Sending Floor renders "No warmup data yet" for a
> mailbox that is warming perfectly well. This hid behind a true statement for as long as nothing
> was warming. `toNumber()` in `sending-floor.ts` strips the sign and keeps the 0–100 scale, and
> treats `""` as absent rather than as a reputation of zero. Covered by `sending-floor.test.ts`.

§14 gates go-live on warmup being confirmed healthy across all four domains. Nothing is warming, so
that clock has not started. Warmup takes weeks and everything else waits on it — it is the first
thing to fix, ahead of any further build work.
