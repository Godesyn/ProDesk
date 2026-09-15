# Outreach — build plan

**Status:** steps 1–8 built (2026-08-11). All five sub-tabs exist and every package typechecks;
migration 0086 is applied to dev. **Nothing has run end to end** — no campaign has sent, so the
webhook → classifier → queue → handoff chain has never carried a real event.

**End-to-end audit, 2026-08-18.** A sweep for things that would have failed on the first real
send. Four of them made the chain above impossible rather than merely wrong, and none was
visible from any screen:

1. **Smartlead was never told where to post.** `createWebhook` existed in the client and was
   called from nowhere, and `OUTREACH_WEBHOOK_SECRET` was set in no deployed environment, so
   the endpoint 404'd every callback it would never have received. Now `outreach.registerWebhook`
   plus a panel at the top of the Reply Queue, and a per-environment secret in
   `.railway/envs/shared.*.env`. **Register it from each environment after deploying.**
2. **No conversation ever rendered.** `smartlead_lead_id` was only written on the withdraw path,
   so §7's thread view and the thread above every draft were permanently empty. Resolved lazily
   from the address and written back — one call per prospect, ever.
3. **The brand pre-create could not work.** `brands.owner_id` is a foreign key to `users.id`, and
   the handoff created a GoTrue identity without the app row, so every insert failed its FK into
   a catch that exists for name clashes. Every `yes` landed on an empty form — the opposite of
   §10's whole argument.
4. **A run that failed after its scrape was billed released its region**, so the honest next move
   paid ~$15 again for a dataset still sitting on the provider. Fixed by `hasBeenBilled` (the
   line is `run_id`, not `status`) plus a free `retryListRun`.

Money leaks closed alongside them: the reconcile sweep replaying the classifier on a poisoned
receipt forever (migration 0107, `process_attempts`); the resume sweep handing every in-flight
run a fresh polling chain every ten minutes; the optional homepage crawl re-paying for details it
had already stored; and two worker replicas being able to start two paid scrapes for one run.
Suppression is now re-checked immediately before a push, not only at dedupe.
API verification lives in [outreach-api-findings.md](./outreach-api-findings.md); read it before
touching §5, §8 or §12.
The Apify list-build stage is specced in [outreach-apify.md](./outreach-apify.md); read it before
touching §5 or §11 — **it supersedes §11 and the built List Builder only partly reflects it**
(see §14).
See [§14 Build order](#14-build-order) for what is and isn't built.
**Surface:** ProDesk super-admin only (`/super-admin/outreach/*`).
**Audience for the UI:** the founder and, later, CEOs. Treat the design bar as the primary requirement, not a finishing pass. See [The design mandate](#the-design-mandate) — read that section before writing a single component.

---

## 1. What this feature is

Outbound cold email for our own agency, run at scale across 4 domains × 5 Google Workspace mailboxes (20 total), using **Smartlead** as the sending backend.

- `useprodesk.com` / `tryprodesk.com` → free-listing first-touch campaigns.
- `usenoize.com` / `trynoize.com` → anything further down the ladder that speaks as the agency.

Keep that split consistent: reply routing keys off the sending domain.

The feature is the **cockpit**. It builds prospect lists, runs campaigns, classifies replies with an LLM, queues human-approved responses, and converts a "yes" into a live Verdiict account — all without anyone opening Smartlead after initial setup.

The governing constraint behind every decision below: **do not get the domains flagged as spam.** Domain reputation drops fast and recovers slowly. When a design choice trades throughput for safety, take safety.

---

## 2. Locked decisions — do not relitigate

These were argued through and settled. A fresh session should implement them, not re-propose alternatives.

1. **Smartlead is headless.** After the API key is in place, every action happens in our admin: connect mailboxes, set caps, create campaigns, author sequences, set schedules, upload leads, start/pause, read analytics, read message history. Nobody opens Smartlead again.
2. **Smartlead owns sending.** No SMTP queue, no scheduler, no rotation logic in our code. Rotation across the 5 mailboxes per domain, warmup, intra-day spacing and sequence execution are Smartlead's.
3. **Almost nothing is stored.** Anything Smartlead is the system of record for is fetched live and cached in Redis with a short TTL (30–60s), so one page view is one API call rather than a burst. Only four tables exist (§5), and each earns its place by one of: *Smartlead has no field for it*, *it must be queried across all campaigns at once*, or *losing it loses work*.
4. **Message history is trusted from Smartlead.** No direct Gmail API connection in v1.
5. **"Stop" on a mailbox = set its Smartlead daily cap to 0.** Immediate, reversible, single field, doesn't disturb warmup or campaign associations. A mailbox whose cap reads 0 renders as stopped.
6. **Daily cap: default 20, allowed range 20–25, per mailbox, with per-mailbox override.** Set centrally, fanned out to all 20 accounts through the Worker.
7. **List building buys the Maps scrape** (Apify) rather than running our own Puppeteer crawler. Behind a provider seam so Outscraper is a drop-in swap.
8. **Email verification is mandatory** before any address reaches Smartlead. Bounces are the fastest way to burn a domain.
9. **Every outgoing reply needs human approval in v1**, except suppression actions, which are instant and automatic.
10. **A `yes` creates a Verdiict account in-repo**, via the existing signup machinery — not an outbound webhook to an external system.

---

## 3. The design mandate

**This is the part of the brief that matters most. It is not decoration and it is not a polish phase — it is the deliverable.**

CEOs will use this. It must not look like an internal tool, an admin CRUD screen, or a dashboard template. It must outperform any comparable product on the market — Smartlead's own UI, Instantly, Apollo, Clay — and it must be obvious within three seconds of loading that it does. If a screen could be swapped into any other SaaS admin panel without anyone noticing, it has failed and must be redesigned.

### Where the boldness goes

Spend the risk in **one** place per screen and keep everything around it disciplined. The signature of this feature is:

> **The Sending Floor** — the Mailboxes screen is not a table. It is a live view of 20 mailboxes across 4 domains, each one a capacity meter filling through the day, grouped into domain blocks whose collective health is legible at a glance. It should feel like watching a controlled system operate: calm and quiet when things are healthy, unmistakably urgent when a domain's reputation starts sliding.

Everything else in the feature stays quiet and precise so this lands. Do not add a second competing hero.

### Non-negotiable qualities

- **Motion with intent.** Orchestrated over scattered. A page-load sequence that reveals structure in a deliberate order beats a dozen unrelated fade-ins. Capacity meters animate from empty to their current value once on load, never on every poll. Numbers tick rather than snap. Rows stagger in on first paint, not on refetch. `prefers-reduced-motion` is honoured everywhere — this is a hard requirement, not a nicety.
- **Optimistic, never janky.** Every mutation — pause a mailbox, change a cap, override a classification, approve a reply — updates instantly with a rollback on failure. No spinner-on-button-then-refetch. No layout shift when data arrives: skeletons match the shape and dimensions of what replaces them.
- **Keyboard-first where volume lives.** The reply queue and prospect list are high-repetition surfaces. `j`/`k` to move, `a` to approve, `e` to edit, `x` to suppress, `/` to search, `Esc` to back out. Show a shortcut hint on first visit and a `?` overlay thereafter. A CEO who learns the shortcuts should be able to clear a queue without touching the mouse.
- **Undo over confirm, where reversible.** An undo toast beats a modal for anything we can take back. Use `useConfirm` (never native `confirm`) for the genuinely irreversible: sending a reply, pushing leads into a campaign, starting a campaign.
- **Density with air.** These screens carry a lot of data. Resist both extremes — the cramped enterprise table and the oversized marketing-page card. Tight, deliberate rhythm; generous space around the things that matter; nothing decorative competing with the numbers.
- **Empty and failure states are directed, not sad.** An empty prospect list invites a list-build run. A failed Smartlead call says exactly what broke and what to do — there is no other surface to go check, so our error copy is the only error surface that exists.
- **Copy is design material.** Active voice, sentence case, plain verbs. A button that says "Stop sending" produces a toast that says "Stopped sending." Name things the way the operator thinks about them — "mailbox", "prospect", "reply" — never "account entity" or "webhook payload".

### Visual direction

Inherit the existing suite design tokens (`clients/dashboard/src/suite`, shared shadcn tokens). **Do not invent a competing palette** — this lives inside ProDesk and must feel native to it. The distinctiveness comes from *composition, motion and information design*, not from a new brand.

Within that constraint, be opinionated:

- **State is carried by colour used sparingly.** Healthy is the absence of colour, not a green badge on everything. Reserve saturated colour for the two things that matter: capacity nearing its cap, and reputation trending down. If every row is coloured, nothing reads.
- **Typography does real work.** Numbers are the content here — set them in a tabular-figure treatment so columns align and ticking digits don't reflow. Establish a clear scale: the big number, the label, the metadata. Don't let everything sit at 14px.
- **Structure encodes meaning.** Group by domain because domain reputation is the unit of risk — not because grouping looks tidy. Any divider, eyebrow or numbering must be true about the data underneath it. No `01 / 02 / 03` markers on things that aren't a sequence.

### Explicitly avoid

The three looks that read as machine-generated: cream background with high-contrast serif and terracotta accent; near-black with a single acid-green accent; broadsheet hairline-rule columns. Also avoid: gradient-filled stat cards, emoji as UI iconography, a big number with a small label as the default answer to every panel, and card grids where a dense list would serve better.

### Before you build each screen

Sketch the layout, then ask: *would I have produced this exact screen for any other admin feature?* If yes, it's a default rather than a choice — revise it and note what changed and why. Do this in thinking; show the user the result, not the deliberation.

When building the monitoring charts, load the **`dataviz` skill** first. When designing any screen from scratch, load **`frontend-design`** first.

---

## 4. Sub-tab structure

`Outreach` is a category in the super-admin left sidebar (add to `packages/shared/src/components/layout/nav-items.ts`), with these children:

| Route | Name | Purpose |
|---|---|---|
| `/super-admin/outreach/mailboxes` | Mailboxes | The Sending Floor — accounts, domains, caps, health |
| `/super-admin/outreach/campaigns` | Sending Email | The one campaign: sequence, template, schedule |
| `/super-admin/outreach/lists` | List Builder | Run and review list-building jobs |
| `/super-admin/outreach/prospects` | Prospects | The contact database, replies, classifications |
| `/super-admin/outreach/replies` | Reply Queue | Human approval of drafted responses |

Tab order is the order of the work: the Sending Floor sits apart (it is the infrastructure, not a step), then Sending Email → List Builder → Prospects → Reply Queue. Sending Email leads the pipeline because the campaign is what a list is scraped into.

Monitoring lives as a panel on Mailboxes rather than a sixth tab — deliverability belongs next to the mailboxes it describes.

---

## 5. Data model

Four tables. Hand-write `drizzle/NNNN_outreach.sql` plus its `meta/_journal.json` entry — never `db:generate`, never `db:push`.

**`outreach_prospect_state`** — keyed by normalised email. Classification (`yes | question | not_now | never | other`), model reasoning, confidence, classified-at, manual override + who/when, fulfilment status + timestamp, business name, website, category, the scraped personalisation detail, source, and the sending domain used. This is the table the Prospects tab paginates and filters on; Smartlead is joined in per-row for the thread.

**`outreach_reply_drafts`** — prospect email, source reply reference, draft body, status (`pending | approved | edited | sent | discarded`), approver, timestamps. Keep sent drafts for history.

**`outreach_suppression`** — normalised email or domain, reason, source, added-at. Global master across all 4 domains and 20 mailboxes. Written here first, then pushed to Smartlead. Checked at list-build time *and* before any approved reply is sent.

**`outreach_list_runs`** — a fifth table, added by [outreach-apify.md](./outreach-apify.md) §7. Provider, vertical, region key, search term, Apify run + dataset id, stage, per-stage counts, cost estimate vs actual, `unique(vertical, region_key)`. It earns its place on the *losing it loses work* criterion: without it a Worker restart re-pays for a scrape and re-emails the same businesses. It also doubles as the coverage map — which regions are still unworked. `outreach_prospect_state` gains a unique `place_id` for cross-run dedupe.

**`outreach_events`** — webhook receipts only: Smartlead event id (unique), type, received-at, payload, processed state. Exists for idempotency and replay, not reporting. Trim on a retention window.

Everything else — mailboxes, domains, warmup health, sent-today, campaigns, schedules, sequences, message bodies, deliverability stats — is a live Smartlead read.

---

## 6. Sub-tab: Mailboxes (The Sending Floor)

**Data:** live from Smartlead's email-account endpoints, cached briefly in Redis. Nothing mirrored.

**Layout:** four domain blocks, each containing its 5 mailboxes. The domain block is the primary unit — it carries the aggregate: mailboxes active, sent today vs. today's ceiling, deliverability, spam-complaint rate, warmup health, and a trend indicator. Domain reputation is the unit of risk, so it gets the visual weight.

Each mailbox row shows: address, sent today as a filling capacity meter against its cap, remaining, warmup status, bounce signal, last send, and its brand assignment (ProDesk vs NOIZE — this drives reply routing).

**Interactions:**
- **Stop sending** on a mailbox → sets its Smartlead cap to 0, optimistically, with an undo toast. A stopped mailbox reads as visibly dormant rather than merely greyed.
- **Connect mailbox** → adds the account in Smartlead via API. Surface Smartlead's error verbatim if it rejects: there is no other surface to check.
- **Click a mailbox** → detail view of every email it has sent, live-paginated from Smartlead: recipient, campaign, sequence step, sent time, reply state. Deep-link each row into the prospect's thread.
- **Limits panel** — global cap (default 20, range 20–25), per-mailbox override, and the schedule policy (Mon–Fri, business hours, recipient timezone, min/max delay). Changing the global cap fans out an update across all 20 accounts **through the Worker**, never inline from a click. Show the fan-out progressing.

**Monitoring panel** — per domain, not just aggregate: deliverability, spam-complaint rate, warmup health, send volume, reply rate. Flag anything trending down prominently. Note the honest limitation: with no snapshot table, week-over-week trending is limited to what Smartlead's own reporting exposes.

---

## 7. Sub-tab: Prospects

**Data:** cursor-paginated over `outreach_prospect_state`. Opening a row fetches the thread live from Smartlead.

Cursor pagination on an infinite query — remember that invalidating an infinite query with `queryKey()` silently matches nothing; use `pathFilter()`.

**List:** business name, email, website, vertical, campaign, sending domain, source, last sent, replied, classification, suppression state. Filter by every one of those. Search is instant and keyboard-accessible via `/`.

**Row detail:** the full conversation — every sequence step we sent and every reply, in order, rendered as a real thread rather than a log table. The classification sits at the top as a decisive control: current value, the model's reasoning and confidence, and a one-click override that records who changed it and when.

Classification runs through the existing AI provider abstraction and **must call `recordAiUsage`** with an outreach-specific source so cost is attributable per feature. The classification prompt is deliberately left to iterate on later — build the seam, not a final prompt.

---

## 8. Sub-tab: Sending Email (campaign, sequence, template)

**ONE campaign per environment**, named by `OUTREACH_CAMPAIGN_NAME` and created on the first visit to this tab if Smartlead doesn't already have it. There is no campaign list, no "new campaign" form and no campaign picker anywhere in the feature — verticals are how a list is scraped and how a prospect is filed, not how sending is organised.

> Superseded: the original spec said *one campaign per vertical*, with the vertical AS the campaign name. That made every new vertical a campaign with no sequence, no mailboxes and no schedule, all of which had to be rebuilt by hand. The vertical still travels with the ledger row and the prospect; it no longer decides who sends.

Because the campaign is the thing a list is scraped *into*, this tab comes **before** List Builder in the tab row: a list built before the sequence exists is contacts sitting in a campaign that cannot send.

- **Mailboxes:** every mailbox on the Sending Floor is attached automatically, on every visit to this tab and before any list run starts. There is no picker — with one campaign the honest answer is "all of them", and the only failure that question ever produced was a campaign attached to nothing, which reports ACTIVE and sends precisely nothing. Stopping a *mailbox* is still per-mailbox, on the Sending Floor, where its cap goes to zero.
- **Sequence authoring:** first touch + 2–3 follow-ups, spaced 4–7 days apart, all queued at campaign start.
- **Template input:** accept both pasted raw HTML and rich text, whichever round-trips faithfully — support both if practical. Merge tags for business name and the one scraped personalisation detail. **The template must degrade gracefully when the personalisation detail is null** — write the fallback into the template model, don't leave it to chance.
- **Preview** against a real prospect row, not lorem ipsum.
- **Schedule:** Mon–Fri, business hours, recipient timezone — set on the Smartlead campaign.
- **Import:** file or paste. (Not "duplicate an existing campaign" — there is only one.)
- **Start / pause** the campaign, with `useConfirm` on start.

---

## 9. Sub-tab: Reply Queue

The highest-craft screen after the Sending Floor, and the one where keyboard-first matters most.

Every reply arrives here with its classification and, for `yes` / `yes-with-question`, an LLM-drafted response built from approved reply templates. One item in focus at a time, with the full thread visible above the draft.

- **Approve / edit / send** in-tab. `useConfirm` on send — it's irreversible.
- **`never` or unsubscribe language → instant automatic suppression**, no human step, no queue entry. Add to `outreach_suppression`, push to Smartlead. This one must be fast and unambiguous.
- **Resend account link** button for prospects who lost theirs.
- Clearing the queue should feel like triage: fast, rhythmic, with a satisfying completion state rather than an empty table.

---

## 10. The fulfilment handoff — `yes` → Verdiict account

On an approved `yes`, create the prospect a Verdiict account using the existing signup machinery. The pieces already exist:

- `clients/reviews` already routes `/auth/confirm` (`AuthConfirmPage`) and `/auth/handoff`.
- The backend already uses `inviteUserByEmail` / `generateLink` / `admin.createUser` in `packages/server-shared/src/routers/auth.ts` and `superAdmin.ts`.

**Flow:**
1. Generate the confirmation link server-side and **suppress the automatic Supabase email**.
2. **Embed that link in the approved reply** that goes out through Smartlead — one email, from the human they just replied to, on the warmed sending domain. This converts far better than a disconnected system email arriving from a different identity at the moment of highest intent.
3. The link lands on Verdiict's `/auth/confirm` → password creation screen → they're in.
4. Build the link with the existing `emailBaseUrl` origin allow-list against the **Verdiict origin**, or the confirmation lands in ProDesk instead of Verdiict.

**Decided details:**
- **Pre-create the brand and a draft directory profile** from the list-builder data — business name, website, category, scraped detail. They log in to something already built, not an empty form. This is the whole point of the offer landing well.
- **Create the account against the reply address**, not the prospected address — that's the person who said yes.
- **Idempotent:** if an account already exists for that address, don't create a second one; resend the link and record the handoff as satisfied.
- Record handoff status and timestamp on `outreach_prospect_state`.
- Keep the standard Supabase email available as a **resend** action from the Reply Queue.

---

## 11. List Builder

Built. Runs in the Worker as a resumable state machine behind a provider seam (`apify` | `outscraper`), in `modules/outreach/list-builder/`.

**The Apify stage is specced in full in [outreach-apify.md](./outreach-apify.md) — read it before touching this.** It corrects two assumptions below, and its §10 records what shipped: a fifth table (`outreach_list_runs`), a `place_id` column, orphan adoption, and a coverage map. A probe run to settle six billing questions is still outstanding.

**Input:** vertical + **one region** (an LGA, or a whole metro — *not* a suburb list, and *not* a list of regions: the actor tiles internally and dedupes by `placeId`, so in-run duplicates are free while cross-run duplicates are billed twice), a max-records ceiling, and an estimated cost shown before the run starts. The ~120-result cap applies only to a bare search string with no structured location; with a real location the actor grid-searches to ~17k per term. `unique(vertical, region_key)` refuses a repeat outright.

**Pipeline** — each step is one Worker tick that ends in a durable state and says when to be called back:
1. **Scrape** — insert the ledger row as `starting`, then start the actor run and stamp its id. A row found in `starting` on resume **adopts an orphan run** before it may start a new one; Apify has no idempotency key, so this is the difference between a restart being free and costing the whole scrape again.
2. **Collect** — page the dataset once the run succeeds. Free and repeatable, which is what makes everything downstream genuinely resumable.
3. **Dedupe** — against `outreach_prospect_state` (by `place_id` *and* email), existing ProDesk brands, and `outreach_suppression`. Drop anything with no email; **never guess at `info@`**.
4. **Verify** — MillionVerifier; keep only `valid`. `catch_all` is not valid, and a transport failure is recorded as `unknown` rather than being mistaken for a verdict. The deliverability gate, and it runs *before* enrichment so we don't pay to enrich dead addresses.
5. **Hook** — `reviewsCount` and `totalScore` arrive free in the base item, and the opener is composed against the median of the run's own scrape, so the comparison is true by construction. Stored on the prospect so the preview shows what was sent. The Haiku homepage crawl is a per-run opt-in, off by default.
6. **Review** — counts: found / no-email / duplicate / suppressed / undeliverable / no-verdict / with-opener, list previewable in push order. A human gate sits between a scrape and hundreds of strangers getting email.
7. **Push** — on confirm, create `outreach_prospect_state` rows and upload leads in chunks, **fewest reviews first** — a daily cap means push order is the prioritisation.

A run that dies anywhere after step 1 re-reads the dataset for free rather than re-paying for it. The ledger doubles as a coverage map: Greater Sydney is 6–9 months of runway, so which (vertical × region) pairs remain is a surface on the page, not a report.

---

## 12. Plumbing

- **Webhooks:** endpoint for Smartlead events (sent, reply, bounce, unsubscribe), idempotent by a synthetic key on `outreach_events`, registered from our UI at setup — `outreach.registerWebhook`, driven by the panel at the top of the Reply Queue. `OUTREACH_WEBHOOK_SECRET` is per environment; without it the endpoint refuses every callback and nothing downstream of a reply ever runs. Reconcile cron every 15 min, bounded by `process_attempts` so a poisoned receipt cannot replay the classifier forever.
- **Rate limits:** Smartlead is roughly 10 requests / 2 seconds per key — verify current docs. Every bulk operation (cap fan-out, lead upload) goes through the Worker, never inline.
- **Env:** Smartlead API key, Apify token + actor id, verifier key, Places key if the fallback path is ever used. Env files are the sole config source.
- **Router:** new `packages/server-shared/src/routers/outreach.ts`. Avoid `then` / `call` / `apply` as router keys — they break tRPC at construction.

---

## 13. Repo conventions to obey

- Super-admin screens live in ProDesk only — never in satellite frontends.
- Pages under `packages/shared/src/pages/super-admin/outreach/`; routes registered in `clients/prodesk/src/App.tsx`; nav in `packages/shared/src/components/layout/nav-items.ts`.
- Migrations: hand-written SQL + journal entry. No `db:generate`, no `db:push`.
- Never `confirm()` / `alert()` / `prompt()` — use `useConfirm`. Prices in UI must be dynamic.
- Every Anthropic call site calls `recordAiUsage` with its own `source`.
- No JS `Date` inside raw drizzle `sql`` ` fragments.
- Repo isn't prettier-managed — match single-quote style by hand.
- Backend scripts need `--conditions development`.
- Typecheck **every** package when verifying, not just the one edited: `bun run typecheck` and `bun run test` at root.
- Grid overflow: prefer `minmax(0,Nfr)` over `grid-cols-[Nfr]` when a child truncates.
- Use `@shared/components/ui/color-picker`, never a native colour input.

---

## 14. Build order

**Step zero — verify the Smartlead API surface.** Read the current docs and confirm: per-account daily cap field (`max_email_per_day` / `message_per_day`) and `time_to_wait_in_mins`; campaign create/update/schedule/sequence; lead upload; global block list; message history; reply-from-master-inbox; analytics; webhook registration. **The one thing that could move scope:** whether the 20 Workspace mailboxes can be connected via API with SMTP/IMAP credentials, or whether that first connection stays a one-time job in Smartlead's UI. Setup-day only either way. Also confirm whether one API key covers all 20 mailboxes or whether ProDesk and NOIZE domains land under separate Smartlead clients/keys — if split, the passthrough layer must fan out across keys.

**Step zero is DONE** — see [outreach-api-findings.md](./outreach-api-findings.md). Mailboxes can be
connected headlessly via the API (scope did not move), and one key covers all 20. Two behaviours
still need a live key to confirm: whether `max_email_per_day: 0` is accepted, and whether
message-history returns full bodies.

Then:

1. ~~Router + four tables + Smartlead client with Redis caching and Worker-queued bulk ops.~~ **Done.**
   - `drizzle/0086_outreach.sql` + schema definitions
   - `modules/outreach/{smartlead,cache,sending-floor,caps}.ts`
   - `routers/outreach.ts`, mounted at `trpc.outreach.*`
   - `outreach` BullMQ queue + worker handler
2. ~~**Mailboxes / Sending Floor** — the design centrepiece.~~ **Done.**
   `pages/super-admin/outreach/{mailboxes,mailbox-row,motion,monitoring}.tsx`. The screen is two
   views behind a switch: **Emails** (every mailbox, live) and **Monitoring** (deliverability and
   volume over weeks). A mailbox is a list row — a capacity meter with a reputation rail down its
   left edge, expanding in place to its detail panel; colour is spent only on a meter near its cap
   and a mailbox whose footing is bad. The Monitoring tab carries an alarm dot when a domain is
   sliding (`slidingDomains`), so the split never hides the number that has to interrupt.
   Reuse `motion.ts` for every later screen — entrance motion happens once, never on a poll, and
   reduced motion is honoured.
   **Not yet built on this screen:** the connect-mailbox dialog (`outreach.connectMailbox` exists
   and is unused), and the per-mailbox sent-email log (§6) — that needs campaign-scoped Smartlead
   reads that land with step 4.
3. Limits policy + schedule + cap fan-out. *(Cap policy and fan-out are done — the panel under the
   Emails view of the Sending Floor. Campaign SCHEDULE is set per campaign in Smartlead, so it
   belongs with step 4, not the limits panel.)*
4. ~~Campaigns / sequences / templates.~~ **Done.** `pages/…/outreach/campaigns.tsx` +
   `modules/outreach/campaigns.ts`. ONE campaign per environment, named by
   `OUTREACH_CAMPAIGN_NAME` and created by `ensureCampaign()` on first read — so the invariant is
   structural (there is no procedure that can create a second) and setup is one env var.
   `attachAllMailboxes()` keeps every mailbox on it. Saving a sequence on a running campaign
   pauses → saves → resumes, and reports loudly if the resume fails (a silently-paused campaign
   costs a day of sending).
   *Not built:* file import and duplicate-campaign (paste works — the body is a textarea).
5. ~~Webhooks + classification + Prospects tab.~~ **Done.** `modules/outreach/webhook.ts`
   (mounted at `/api/outreach/webhook/:secret` — the URL is the credential),
   `classify.ts`, `pages/…/outreach/prospects.tsx`. Reconcile cron every 15 min retries
   unprocessed events and unpushed suppressions, and trims receipts past 90 days.
   *Note:* classification runs on the family the AI registry resolves (one model per family) —
   not Haiku specifically, which would break that abstraction.
   *Fixed 2026-08-18, and it was the whole chain:* the endpoint existed and Smartlead had
   never been told about it — `createWebhook` was in the client and called from nowhere, and
   `OUTREACH_WEBHOOK_SECRET` was set in no deployed environment, so the URL 404'd everything
   anyway. `outreach.registerWebhook` / `webhookStatus` and the panel at the top of the Reply
   Queue close both halves; the panel reports the SECRET, the REGISTRATION and whether an event
   has ever actually arrived, because only the third proves anything. The reconcile sweep also
   had no attempt bound, so a receipt that could never be applied replayed the classifier four
   times an hour forever (migration 0107 adds `process_attempts`).
6. ~~Reply Queue + suppression + Verdiict handoff.~~ **Done.** `replies.ts`, `suppression.ts`,
   `fulfilment.ts`, `pages/…/outreach/replies.tsx`. Keyboard-first (`j/k/a/e/x/?`), `useConfirm`
   on send, suppression checked again immediately before sending. A `yes` creates the account
   first and appends its link — if creation fails, nothing is sent.
7. **List Builder — built against §11, PARTLY superseded.** `list-build.ts`, `providers.ts`,
   `pages/…/outreach/lists.tsx`. Resumable stages, human review gate, 400-lead push chunks.
   Reconciled with [outreach-apify.md](./outreach-apify.md): async run → poll → dataset paging
   (the sync endpoint times out and still bills), structured `city`/`countryCode` rather than a
   bare search string, `website: "only"`, every optional event off, LGA-level regions, and the
   `terms × cap × $3/1000` estimate.
   **Still owed from that doc:** the `outreach_list_runs` ledger table + `place_id` column (its
   §7) — without them a Worker crash between `startRun` and persisting the run id re-pays for a
   whole scrape, and there is no `unique(vertical, region_key)` to refuse a repeat scrape. Also
   not done: the free `reviewsCount`/`totalScore` personalisation hook, which that doc argues
   should replace the Haiku homepage crawl.
8. ~~Monitoring panel.~~ **Done.** `pages/…/outreach/monitoring.tsx`, on the Mailboxes screen.
   One measure charted (daily volume, with bounced as a stacked segment of the same unit) —
   deliberately not a second axis. Per-domain figures are window aggregates, because Smartlead
   exposes a daily series only for the account as a whole.

Prerequisites outside the repo, in order, before go-live: register `usenoize.com` / `trynoize.com` in GoDaddy; SPF/DKIM/DMARC on all four; 20 Workspace mailboxes; warmup running on all 20; **go live only once warmup is confirmed healthy across all four domains.** Build 1–8 in parallel while warming runs.

---

## 15. Defaults applied (change only if asked)

- No audit table for limit changes.
- Vertical/region as free text, not a managed taxonomy.
- Crawler: ~1 req/sec per host, honest user-agent, respect robots, no email guessing.
- Cap range 20–25/day, default 20.
- Apify over Outscraper, behind a swappable seam.
- ClickHouse / Airbyte warehouse sync is **out of scope** here; the four tables plus live reads are what the tab uses.

## 16. Cost model at planned volume

~8,600 emails/month ≈ 2,000 new contacts/month ≈ 6,000 businesses pulled.

| Item | Monthly |
|---|---|
| Apify Maps scrape | ~$15–20 (base + contacts @ $3/1k, Starter $29/mo on top) |
| Email verification | ~$2–20 |
| LLM personalisation (Haiku 4.5) | ~$8–10 |
| Reply classification + drafting | ~$2–5 |
| Google Workspace, 20 mailboxes | ~$140–170 |
| Smartlead (Pro tier) | ~$94 |
| 4 domains | ~$5 |

Data acquisition is a rounding error against Workspace and Smartlead. Don't optimise it at the cost of quality or safety. Figures are estimates — verify current pricing before committing.
