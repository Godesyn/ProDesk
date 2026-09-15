# Beta Programme

Time-boxed free access to the **whole Prodesk Suite** in exchange for feedback.

A prospect signs up through `/signup?beta=<code>`, gets every paid feature free for
a fixed number of days, is warned three times before it ends, and on the day it
ends sees an itemised report of exactly what each tool they used would cost — with
a card form to keep the ones they want.

---

## 1. The one mechanism that makes it work

There is **no beta gating code**. Access rides entirely on the single entitlement
bypass that already existed:

```ts
// modules/feature-subscriptions/entitlements.ts
export async function isBetaUser(db, userId) {
  // …
  if (!row?.isBetaUser) return false;
  return row.betaEndsAt == null || row.betaEndsAt.getTime() > Date.now();
}
```

`userHasFeature()` short-circuits through `isBetaUser()`, and **every** paid gate on
the platform funnels through `userHasFeature` / `brandHasFeature`. Adding the
`betaEndsAt` clause is therefore the entire "beta access stops working"
implementation: the moment the deadline passes, short links, review capture,
signatures, the AI assistant, logo export and payments all lock at once — and any
feature added in future inherits the behaviour for free.

Two consequences worth internalising:

- **Do not add per-feature beta checks.** If a new paid feature gates on
  `brandHasFeature`, it is already correct for beta members.
- **The app becomes read-only by itself.** A lapsed member's existing data still
  renders; only the paid actions refuse. The UI in `packages/shared/src/beta`
  _explains_ that state — it does not implement it.

`betaEndsAt = NULL` is the legacy unlimited grant a super-admin toggles by hand on
`/super-admin/users`. It never expires and is never warned about.

---

## 2. Model

```
beta_versions        a cohort: code, label, durationDays, active, signupLimit
  └─ users.betaVersionId / betaStartedAt / betaEndsAt / betaExpiryAcknowledgedAt
beta_extensions      audit of every per-user extension
beta_notices         one row per (user, milestone, deadline) reminder sent
```

Migration `0079_beta_program.sql`.

**The deadline lives on the USER, not the cohort.** A version supplies only the
duration; joining stamps `betaEndsAt = signup + durationDays`. This is what lets an
admin extend one member without moving anyone else, and guarantees a member's
promised end date can never shift under them when the cohort is edited.

Indexes that matter at scale:

- `users_beta_ends_at_idx` — **partial** (`WHERE is_beta_user`). The daily reminder
  sweep scans deadlines, so this keeps it proportional to the number of beta users
  rather than the whole `users` table.
- `beta_notices_user_kind_deadline_uniq` — the dedup key. See §5.
- `support_tickets_user_source_idx` — the feedback panel's history query.

---

## 3. Joining (`/signup?beta=<code>`)

1. The signup screen calls `captureBetaCode()` (`packages/shared/src/beta/beta-code.ts`),
   which stashes the code in `localStorage`. It **must** survive the Google OAuth
   round-trip and the email-verification hop, so reading the URL later is not an
   option — same technique as the invite token.
2. It calls `beta.versionByCode` to describe the offer on the form. An unknown,
   closed or full code returns `{ joinable: false }` — never an error. A bad beta
   link must still produce a working (non-beta) account.
3. `AuthProvider` passes the code to `auth.ensureUser`, which stamps the grant.
   **This is the only stamping point**, because Google signups never call
   `auth.signUp` — stamping there would silently miss every OAuth user.
4. `markEmailVerified` can provision the `users` row first (the user redeems the
   verification link on a second device). `ensureUser` therefore also redeems the
   code against an EXISTING row, via `joinBetaOnProvisioning`, bounded by
   `BETA_JOIN_WINDOW_MS` (10 minutes) and refused if already enrolled. That window
   is what stops an established account granting itself free access by appending
   `?beta=…` to a URL.

A **lapsed** member's `betaVersionId` stays set, so re-visiting the signup link
cannot restart their beta. Reviving someone is an admin extension.

---

## 4. The price report

`modules/beta/report.ts` → `buildBetaBillingReport(db, ownerId)` is the **single
source** for:

- the 7 / 3 / 0-day reminder emails,
- the in-app post-beta screen,
- the activation that actually subscribes them,
- and the figure support sees in the admin drawer.

Rules:

- **Only tools they actually used.** `modules/beta/usage.ts` holds one probe per
  feature key (active short links, signature seats, review locations, `ai_usage`
  rows, payer proposals, logo projects). A feature key with **no probe is omitted**,
  never guessed — we don't put a line on a bill we can't evidence.
- **Live quantities.** A per-unit line reads `$1.00 × 3 active links = $3.00`,
  matching what Stripe would meter the instant they subscribe.
- **No monthly price → no line.** A product with no active monthly price is skipped
  rather than quoted at zero.
- **Already-paid tools are shown as covered** and excluded from the total, so
  nobody is double-charged for something they subscribed to mid-beta.

> **Adding a product to the report** = add a probe to `USAGE_PROBES`. That's all.

Prices, quantities and totals are **re-derived server-side** from the product ids
the client sends. Nothing about the money is trusted from the browser.

---

## 5. The reminder emails (7 days, 3 days, day-of)

`betaQueue` runs `reminders` daily at 08:00 UTC → `sweepBetaReminders`.

Each milestone selects deadlines inside a **half-open day bucket** —
`(now + (L-1)d, now + L d]` — chosen so the bucket agrees with `daysUntil()`: a
deadline in the day_7 bucket reads "7 days left" in-app too, so the email and the
UI can never contradict each other. `day_0` is the special case, meaning "the next
24 hours" (`(now, now + 1d]`); the literal formula would point at the past and the
day-of notice would never fire. The buckets don't overlap, so one daily run sends at
most one notice per member. See `modules/beta/dates.ts` (dependency-free and
unit-tested — `beta.test.ts`).

**Dedup:** the sweep inserts into `beta_notices` with `ON CONFLICT DO NOTHING`
**before** enqueueing, and only the caller that wins the insert sends. Two
overlapping sweeps (a retry, two workers) therefore cannot double-notify.

**The deadline is part of that unique key.** That is deliberate: an extension is a
new deadline, hence a new key, so all three reminders re-arm for it. Keying on
`(user, kind)` alone would silently suppress every future warning for anyone ever
extended.

The email carries the full itemised table and is sent **without an unsubscribe
channel** — it announces money about to leave the customer's account, which is
transactional, not marketing.

---

## 6. After the beta ends

`<BetaProgram />` (`@shared/beta/beta-program`) is mounted in the authenticated
branch of **every** frontend's `App.tsx`. `scripts/check-frontend-wiring.mjs` fails
the typecheck if one drops it.

**It costs non-members nothing.** `useBetaStatus` derives enrolment, the deadline and
the acknowledgement from `auth.me`, which every frontend already fetches — the beta
columns are on the `users` row. Only an actual member additionally requests
`beta.myStatus` (for the cohort label). Since `<BetaProgram />` is mounted on every
page of every frontend, an unconditional extra query would have been a platform-wide
cost paid for a feature most users never see.

It renders exactly one thing at a time:

| State                    | Surface                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| not a member             | nothing                                                                                                 |
| live, > 7 days           | quiet countdown pill (bottom-left — the right edge belongs to the feedback tab and the strategist dock) |
| live, final week         | top banner + report one click away                                                                      |
| lapsed, not acknowledged | **full-screen report takeover**                                                                         |
| lapsed, acknowledged     | persistent top banner                                                                                   |

The takeover is the "logs in after the beta finished" moment. It is not dismissible
by scrim or Escape, but always offers _"Not now — continue with paid tools locked"_,
so nobody is trapped. Acknowledging sets `betaExpiryAcknowledgedAt`; an extension
clears it, so a second expiry is announced properly.

**Activation** (`modules/beta/activate.ts`) runs each picked line through
`subscribeToPrice` — the _same_ path `featureSubscriptions.checkout` uses, extracted
to `modules/feature-subscriptions/subscribe.ts` for exactly this reason. Activation
therefore inherits the card-on-file charge, the hosted-Checkout fallback for
declines/SCA, the no-double-subscribe guard, per-unit quantity seeding, and
`recordFeatureSubscription`'s side effects. Lines are activated **independently** and
reported per line: if the card covers two of three tools, the member keeps the two
and sees which one needs attention.

Card procedures are on the `beta` router rather than reusing `shortLinks.*` because
the post-beta moment is **account-level** — the payer is the account holder, who may
have no brand context selected — while those procedures require a `brandId` and the
`payments` permission. Same Stripe customer, same default payment method, no second
place cards are stored.

---

## 7. The feedback panel

Beta access is granted in exchange for feedback, so the two ship together in
`<BetaProgram />`.

A slim tab pinned to the right edge opens a drawer: **compose field and submit
button first**, history beneath. Nothing is fetched until it's opened, so an
app-wide mount costs no request on page load.

Internally each entry is a **support ticket** with `source = 'feedback'`
(`supportTicketSource`): same table, same triage console, same threading, same
emails. What differs is the contract with the user — the UI never says "ticket",
"status" or "priority"; it says _your feedback_ and _our reply_. The translation
lives in `packages/shared/src/feedback/use-feedback.ts` (`feedbackState`).

- `support.submitFeedback` / `support.feedbackList` — the panel's two procedures.
  One field only; the ticket subject is synthesized from the first line
  (`feedbackHeadline`) so the admin console still has a scannable headline.
- `support.list` is scoped to `source = 'support'`, so feedback never shows up on a
  frontend's Support screen as a ticket.
- `support.adminList` / `adminOpenCount` take a `source` filter; the console has
  **Support** and **Feedback** tabs so feature requests don't inflate the support
  badge.
- Feedback enters triage as `category: 'feature_request'`, `priority: 'low'` — a
  product signal, not an incident competing with real support load.

---

## 8. Admin (`/super-admin/beta`, Prodesk only)

`packages/shared/src/pages/super-admin/beta.tsx`.

- **Versions** — create/edit cohorts (code, name, description, length in days,
  open/closed, optional signup cap) and copy the shareable signup link. The code is
  **immutable**: a link already in the wild must not start meaning different terms.
  Editing a duration affects only future signups.
- **Members** — open a cohort for everyone in it with days remaining, soonest
  deadline first, searchable.
- **Extend** — add N days to one member (presets 7/14/30/60/90, or any 1–730), with
  a reason recorded in `beta_extensions`. The drawer also shows their live report
  total, which reminders they've had, and their extension history.

Extension semantics (`modules/beta/extensions.ts`):

- Counted from **the later of** their current deadline or now. Counting from a stale
  deadline would hand a lapsed member an extension that is itself already expired.
- Re-grants `isBetaUser`, so extending **revives** a lapsed member — access is the
  same deadline every gate reads.
- Clears `betaExpiryAcknowledgedAt` and re-arms all three reminders.
- A member with unlimited access (`betaEndsAt = NULL`) is refused: stamping a date
  would _remove_ access they currently have.

---

## 9. Files

| Area                  | Path                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Migration             | `servers/backend/drizzle/0079_beta_program.sql`                                                                                   |
| Schema                | `packages/server-shared/src/db/schema.ts` (`betaVersions`, `betaExtensions`, `betaNotices`, `users.beta*`, `supportTicketSource`) |
| Expiry rule           | `modules/feature-subscriptions/entitlements.ts` → `isBetaUser`                                                                    |
| Arithmetic (pure)     | `modules/beta/dates.ts` + `modules/beta/beta.test.ts`                                                                             |
| Cohorts / joining     | `modules/beta/versions.ts`                                                                                                        |
| Status                | `modules/beta/status.ts`                                                                                                          |
| Usage probes          | `modules/beta/usage.ts`                                                                                                           |
| Report                | `modules/beta/report.ts`                                                                                                          |
| Activation            | `modules/beta/activate.ts`                                                                                                        |
| Extensions            | `modules/beta/extensions.ts`                                                                                                      |
| Reminder sweep        | `modules/beta/reminders.ts`                                                                                                       |
| Shared subscribe path | `modules/feature-subscriptions/subscribe.ts`                                                                                      |
| Router                | `routers/beta.ts`                                                                                                                 |
| Email                 | `modules/email/templates.ts` → `betaEnding`                                                                                       |
| Worker + cron         | `jobs/worker.ts` (`beta-ending` case, `beta` worker, daily repeatable)                                                            |
| Frontend mount        | `packages/shared/src/beta/beta-program.tsx`                                                                                       |
| Overlays / report UI  | `packages/shared/src/beta/beta-overlays.tsx`, `beta-report.tsx`, `use-beta-status.ts`                                             |
| Signup capture        | `packages/shared/src/beta/beta-code.ts`                                                                                           |
| Feedback panel        | `packages/shared/src/feedback/`                                                                                                   |
| Admin                 | `packages/shared/src/pages/super-admin/beta.tsx`                                                                                  |

---

## 10. Operating it

1. `/super-admin/beta` → **New version** (e.g. `v1`, 90 days).
2. Copy the signup link and send it out.
3. Members sign up, get everything free, and see the countdown + feedback tab on
   every frontend.
4. Reminders go out automatically at 7 days, 3 days and on the day, each with the
   full price report.
5. On expiry every paid feature locks itself and the report takes over their screen.
6. Extend individuals from the cohort's member list as needed.

**Prerequisite:** each tool needs an active Feature Subscription product with a
monthly price in `/super-admin/feature-subscriptions`. A product without one is
omitted from the report entirely — so the member would be shown nothing to pay for
a tool they used.
