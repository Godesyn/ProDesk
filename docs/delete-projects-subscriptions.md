# Delete Projects & Cancel Subscriptions — Authoritative Spec

This is the **canonical product spec** for deleting a project and cancelling a
subscription. **It is the source of truth.** The web codebase (`prodesk-web`) must
conform to it; where the code diverges, that is a bug to fix (flagged ⚠️ **Web gap**).

> **The Flutter cloud functions are prior art only and are NOT authoritative** — they
> are known to be incomplete (emails not always sent, `cancel_at` misaligned, etc.).
> **Ignore the Flutter implementation** where it diverges from this spec. Function names
> are cited occasionally only as orientation, never as the definition of correct behaviour.

> **Web files to build to this spec:** `server/src/routers/projects.ts`,
> `server/src/modules/billing/subscription.ts`, `server/src/modules/billing/fulfillment.ts`,
> `server/src/modules/projects/recurring-schedule.ts` + `fulfillment-core.ts`,
> `server/src/routers/billing.ts`, `server/src/jobs/worker.ts`,
> `client/src/pages/projects/project-detail.tsx`, `.../brand|agency-subscriptions.tsx`.

---

## 0. Decision log & open flags

All behavioural decisions are **resolved** and baked into the spec below:

1. ✅ Non-internal delete/cancel is **agency-proposed, brand-confirmed** via an emailed link (§4).
2. ✅ Minimum-term floor = `minimumTermBeforeCancellation × repeatsEvery` **weekly payments**; payment 1 is the upfront (§3).
3. ✅ The upfront is always **payment 1** (§3).
4. ✅ **Delayed phases** re-anchor all counting to the phase start (§3.3).
5. ✅ Internal vs non-internal delete differ only in refund destination & confirmation (§4).
6. ✅ Any **non-internal** cancel/delete **always emails the brand** (§7).
7. ✅ **Delete is always available to the agency** (even mid-minimum-term); the minimum
   term governs **cancel only** (§3 vs §4).
8. ✅ The refundable amount on a delete is the **current cycle's pool** (§5).
9. ✅ Recurring non-priority payouts get a **completion gate** (§6).
10. ✅ Delete removes only **that project's** subscription item; the whole Stripe sub is
    cancelled only when it is the **last** recurring item with **no future phases** (§4.3).

**Open implementation flag:**

- **§0.6 — a refund may have to span multiple Stripe payments.** A cycle's refundable
  pool can cover several weekly invoices, each with its own `payment_intent`. Issuing the
  refund therefore may require refunding **multiple** Stripe payments, not one. This is the
  one unsolved *mechanism* (not a logic gap) and must be built for any recurring refund to work.

---

## 1. Key concepts

- **Nothing is hard-deleted.** A "deleted" project is a *soft delete* — the row stays,
  `deletedAt` is stamped, and every list query filters it out. Data remains for audit.

- **Two different actions — Cancel vs Delete:**
  | | **Cancel** | **Delete** |
  |---|---|---|
  | Effect | Stops *future* billing; current/committed cycle still delivered & charged | Removes the project; refunds the **current cycle's pool** |
  | Refund | **Never** | Yes — the current (undelivered) cycle's collected payments |
  | Min term | **Honoured** (cancel can't take effect before it) | **Ignored** — delete is always available |
  | Timing | **Scheduled** to a cycle boundary (§3) | Effective on action (after brand confirm, for non-internal) |
  | Who | **Brand or agency** | **Agency only** (brand can never delete) |

- **A brand can only Cancel; it can never Delete and never gets a refund on its own.** To
  get money back a brand must ask the **agency** to delete — because the agency may first
  need to settle/reverse the contractor and other payouts.

- **Non-internal actions are brand-confirmed.** The agency *proposes* a non-internal
  cancel/delete; the brand must click an **emailed confirm link** before anything happens
  (§4.2). **Internal** projects have no brand, so the agency acts directly (§4.1).

- **Delete is blocked only while the project's status is `completed`.** For a recurring
  project (which re-enters `completed` at the end of every cycle before resetting to
  brief), delete is allowed any time **except** during that `completed` window. How much
  is refundable is always the **current cycle pool** (§5).

- **"Paid" vs "unpaid" = whether a Stripe checkout session exists.** A project is **paid**
  if its purchase has a Stripe session / payment intent. The **only unpaid case** is an
  **internal project with contractor budget `0`** — `payInternalProject` returns early
  (`chargeAmount <= 0`) and no session is created. Only that case deletes with **no refund**.

- **One Stripe subscription per purchase; one subscription *item* per recurring
  project/phase.** Cancel/delete of one project removes **only that project's item**; the
  whole Stripe subscription is cancelled only when it is the **last** recurring item **and
  no future phases remain** (§4.3) — so a delete never kills a sibling project's or a
  future phase's billing.

- **Billing is always weekly.** The **deliverable cycle** (how often the Kanban project
  resets to brief) can be any length — a number of weeks, or a calendar period (e.g. a
  month). Payments are counted by which weekly charges fall **within** the cycle's period.

### Relevant `projects` fields

| Field | Meaning |
|---|---|
| `deletedAt` | Soft-delete tombstone. Set ⇒ hidden everywhere. |
| `cancelledAt` | Cancellation effective date (may be a **future** date — §3). |
| `cycleCount` | Current deliverable-cycle number. `cycleCount = 3` ⇒ cycles 1 & 2 are done (locked, non-refundable); cycle 3 is current/refundable. |
| `nextCycleAt` | Next billing/delivery date. |
| `softDeleteToken` / `softDeleteExpiry` | Brand confirm-link token + expiry (§4.2). |
| `proposedRefundAmount` / `proposedDispatchAmounts` | Agency's proposed brand refund + per-stage payout split, pending brand confirm. |
| `recurringProjectConfig.minimumTermBeforeCancellation` | Minimum number of deliverable cycles before a **cancel** can take effect. |

---

## 2. Eligibility

- **Delete** — available to the **agency at any time except while status == `completed`**.
  Not gated by the minimum term. (A completed cycle's money is already earned and
  non-refundable.)
- **Cancel** — only for genuine recurring subscriptions (`hasDeliverableCycle`: Recurring
  Service, Recurring Product / "Ships"). One-offs, digital products, payment-plan
  instalments, and the flat `subscription` type are not "cancellable" (they're either
  one-offs you delete, or fixed commitments). Brand or agency may cancel.

---

## 3. Cancel — when it takes effect (no refund)

Cancel stops **future** billing but lets the currently-committed cycle finish (delivered
and fully charged). It is **scheduled**, never an immediate stop, and never refunds.

### 3.1 The two governing factors

**(a) Minimum term** (`minimumTermBeforeCancellation`) — a floor of paid weeks before a
cancel can land. Floor in weekly payments = **`minTerm × repeatsEvery`** (payment 1 = the
upfront). The payment numbered `(minTerm × repeatsEvery) + 1` is the first **not** charged.

> *Example — `repeatsEvery` = 4, min term = 2.* Floor = `2 × 4 = 8` weekly payments → the
> brand is charged **8 payments (1 upfront + 7 recurring)**; the **9th is not charged**.

**(b) Deliverable-cycle boundary & the lock rule** — even past the minimum term, a cancel
only takes effect at a **cycle boundary**, completing the cycle in flight. A cycle becomes
**locked** (committed: it will be charged in full and worked on) the moment the **previous
cycle's last payment lands** — because that means the agency has started the next cycle.

**Tie-break (boundary):**
- Cancel **before** the current cycle's last payment → complete the current cycle, stop the next. *(e.g. 4-week cycle, cancel when the 3rd payment landed → 4th charged, **5th not charged**.)*
- Cancel **once the current cycle's last payment has landed** → the next cycle is already locked → complete it too, stop the one after. *(e.g. cancel once the 4th payment landed → 5–8 charged, **9th not charged**.)*

**Combined:** the cancel lands at the **later** of the minimum-term floor and the end of
the currently-locked cycle, **after that cycle's last weekly payment and strictly before
the next weekly charge**.

> **Invariant — cancel before the next charge.** The scheduled cancellation (`cancel_at`,
> or a deferred per-item removal) must take effect **before** the weekly charge that would
> fund the next, uncommitted cycle. The brand pays through the locked cycle + minimum term,
> never one cycle more.

### 3.2 Mechanics

1. Compute the effective cancel date per §3.1; if in the future it is a **scheduled**
   cancel, else immediate.
2. Remove **only this project's** subscription item (§4.3) — at the scheduled time, not now.
3. Stamp `cancelledAt` (the effective date). Keep delivering/charging until then.
4. **Delete or recalculate the affected payouts and invoices** for the cycles that will no
   longer happen (§5.3).
5. **Email** the brand (and notify the agency) — §7.

### 3.3 Delayed phases re-anchor the counting

A purchase can contain a **delayed phase** — a recurring project that starts later (via
`startDelayDays`). Its **upfront is still taken at checkout (payment 1)**, but its recurring
charges begin at **phase activation** (its subscription item is added then, with a 7-day
trial so the first weekly charge is one week after the phase starts; the first week is
covered by the recurring upfront). Therefore the minimum-term floor, cycle boundaries, and
`cancel_at` for a delayed phase are all measured from the **phase start / its first
payment**, not from purchase `createdAt`. A brand cancel of a delayed phase takes effect
after its first deliverable cycle at the earliest (plus any minimum term).

---

## 4. Delete — remove the project & refund the current cycle

Delete is **agency-only** and **always available except while status == `completed`**. It
removes the project (soft delete), cancels **that project's** subscription item (§4.3), and
refunds the **current cycle pool** (§5). The minimum term does **not** restrict it.

### 4.1 Internal projects (agency-paid)

No brand, so the agency acts directly (no confirm link) and any refund goes **straight to
the agency's account**.

| Case | Behaviour |
|---|---|
| **One-off, nothing paid** (budget `0`, no Stripe session) | Delete, **no refund**. |
| **One-off, paid** (budget > 0) | Delete **+ full upfront refund** to the agency. |
| **Recurring** | Delete is **always available, even mid-minimum-term**. Refund the **current cycle pool in full to the agency** (no split). Removes that project's subscription item (§4.3). |

### 4.2 Non-internal projects (brand purchases) — brand-confirmed

The agency *proposes*; the **brand confirms via an emailed link** before anything is
deleted or refunded. The agency can never delete a non-internal project outright, and the
brand can never initiate a delete.

1. The agency initiates the delete, filling in **form fields that distribute the refund
   pool** between a **brand refund** and the **payout stages** (contractor / briefing /
   allocate / approval) — stored as `proposedRefundAmount` + `proposedDispatchAmounts`.
2. The system stamps `softDeleteToken` and **emails the brand a confirm link**.
   - **The link expires at the next charge date.** If the brand is next charged Monday, the
     link expires Monday — stated in the email **and** shown to the agency when proposing.
   - **If the brand doesn't confirm before expiry**, the next charge goes through, the
     request lapses, and the agency must re-propose (the pool is then recomputed).
3. On **brand confirm** → run the refund + payout/invoice recompute (§5) → soft-delete the
   project → remove its subscription item (§4.3).

> The same brand-confirm-link gate applies to a non-internal **cancel** (the agency
> proposing to stop future billing) — see §3 / §7. A **brand-initiated** cancel needs no
> confirm link (the brand is acting) and just notifies both parties.

### 4.3 Per-item removal — never kill siblings or future phases

A purchase has **one** Stripe subscription ("one Stripe link") with **one item per
recurring project/phase**. A delete (and a cancel) **always cancels the subscription for
its own project** by removing **only that project's subscription item**. The whole Stripe
subscription is cancelled **only when** this is the **last active recurring item** *and*
**no future phases remain** on the purchase. This guarantees a delete never stops a sibling
project's or an upcoming phase's billing.

---

## 5. Refund pool, split & payout/invoice recompute

### 5.1 The pool (how much is refundable)

The refundable pool on a delete = the payments collected into the **current deliverable
cycle** (`cycleCount`) — the cycle that is in progress and **not yet completed**. All prior
cycles are locked/earned and never refundable. The pool **resets to zero at each cycle
boundary**.

- A cycle's payments stay refundable until that cycle is done; once the next cycle begins
  (`cycleCount` advances), the previous cycle's payments are locked.
- **In cycle 1, the upfront (payment 1) is part of the pool.**
- For a calendar-period cycle (e.g. a month), the pool = all weekly payments whose date
  falls within the **current** period.

> *Examples — 4-week cycle, \$20/wk.* Delete when the **7th** payment is done → refund
> 5+6+7 (cycle 2's collected payments). Delete when the **8th** is done → refund 5+6+7+8.
> By the **10th** payment → only 9+10 are refundable (cycles 1 & 2 locked) = \$40.

### 5.2 The split (non-internal)

The agency's proposed `proposedDispatchAmounts` split the pool between a **brand refund**
and the **payout stages** (contractor / designees / agency / affiliate / Prodesk). Internal
deletes have no split — the whole pool refunds to the agency.

### 5.3 Payouts & invoices must be deleted or recalculated

Whenever a cancel or delete reduces what is owed, the **related payouts and invoices are
deleted or recalculated to the new amounts** — they must never be left stale:

- The cancelled/deleted cycle's **pending payouts are reversed/removed** (contractor,
  designees, agency, and the held non-priority cuts). A payout left with no breakdown is
  deleted; a partially-reduced payout is updated to its new amount.
- The corresponding **commission invoices** are deleted or adjusted to match.
- Because the contractor (and other stage payouts) are only paid **after** cycle completion
  (§6), a pre-completion delete simply reverses those still-pending payouts — nothing has
  been disbursed yet.

---

## 6. Payout timing — the completion gate (ALL cuts, ALL service types)

**Nobody is paid until the work that funds the payout is complete.** The gate applies to
**every** commission cut (priority *and* non-priority) and **every** service type — one-off,
recurring (Recurring Service, Recurring Product, Ships) and flat subscriptions alike. Payouts
are still *created* at fulfilment/cycle, but none *dispatch* until completion.

- **The completion gate** (`dispatch.eligibleBreakdowns`): at payout time, a breakdown is
  eligible only once its project is complete. If not, the payout is held `pending` and
  re-checked on the **next** payout run.
- **Do not change the payout date** — keep the existing "first Friday ≥ now + 14 days". The
  gate is in addition to the date: a payout dispatches at `max(toPayAt, completion)`.
- **Non-cycling types** (one-off, flat subscription, digital) gate on
  **`project.status === 'completed'`**. (digitalProduct auto-completes at fulfilment.)
- **Recurring deliverable cycles** are judged **per-cycle** by `cycleCount`
  (`isDeliverableCycleComplete`): a cycle-K payout releases once cycle K is complete —
  detected by **`cycleCount > K`** (the next cycle has begun), **or** by the project reaching
  **`completed` while still at `cycleCount == K`** (the *terminal* cycle, after a cancellation
  with no further cycle coming). The second trigger is essential: without it the final cycle's
  held payout would sit `pending` forever. `cycleCount = 3` ⇒ cycles 1 & 2 are complete. This
  is sound because **`cycleCount` only ever advances out of a `completed` status**
  (`recurring-schedule.ts`), so "advanced past cycle K" really does prove cycle K finished.
- The **first cycle's** setup/upfront cut is gated the same way — held until cycle 1 completes.
- **Priority cuts** (agency owner, designees, contractor) and the **platform's own cut** are
  gated identically. The platform cut (`as: 'admin'`) has no external account, so it is
  settled **internally** in `dispatchPayout` once eligible rather than transferred.
- Any cut still `pending`/`upcoming` when a cycle is deleted before completing is **reversed**.

---

## 7. Emails

**Any non-internal cancel or delete ALWAYS emails the brand** (internal projects have no
brand, so never). For an **agency-initiated** non-internal action the email **is the
confirmation gate** (§4.2) — nothing happens until the brand clicks. A **brand-initiated**
cancel needs no confirm but notifies **both** brand and agency.

- **Cancel/delete request (agency → brand, the confirm link)** — `cancellation_request`
  (recurring) / `partial_refund` (one-off). The email states the **link expiry = next
  charge date**.
- **Cancelled notice** — `cancel_subscription`, agency-branded, to both parties.

---

## 8. Quick reference

Delete is blocked only while status == `completed`. Internal projects act immediately;
non-internal projects are **agency-proposed, brand-confirmed**.

| Action | Who | Brand confirm? | Soft-delete? | Stops billing | Refund | Min term |
|---|---|---|---|---|---|---|
| **Cancel** — recurring (brand) | Brand | No (brand acts) | ❌ | scheduled at cycle boundary | ❌ | honoured |
| **Cancel** — recurring (agency) | Agency | **Yes — email gate** | ❌ | scheduled at cycle boundary | ❌ | honoured |
| **Delete** — internal one-off, budget 0 | Agency | No | ✅ | — | none | n/a |
| **Delete** — internal one-off, budget > 0 | Agency | No | ✅ | — | full upfront → agency | n/a |
| **Delete** — internal recurring | Agency | No | ✅ | that item now | current-cycle pool → agency (full) | **ignored** |
| **Delete** — non-internal one-off | Agency (brand can't) | **Yes — email gate** | on confirm | (cancels plan if any) | pool, agency-split brand ↔ stages | n/a |
| **Delete** — non-internal recurring | Agency (brand can't) | **Yes — email gate** | on confirm | that item now | current-cycle pool, agency-split | **ignored** |

Removing a project's billing always removes **only its** subscription item; the whole
Stripe sub is cancelled only when it is the last recurring item with no future phases (§4.3).

---

## 9. Web gaps to close

The web must converge on the spec above. Outstanding gaps:

1. ✅ **DONE — Cancel is now scheduled** (`cancelSubscription` + `scheduledCancellationDate`
   + `cancelProjectSubscription`'s `cancelAt` / deferred `cancel-item` job). `cancelledAt`
   is the future effective date; `nextCycleAt` kept. *(Multi-item deferred-removal timing vs
   Stripe's billing anchor still needs live-Stripe validation — see §0.6.)*
2. ✅ **DONE — Delete (refund) path** — `softDelete` is now INTERNAL-only (immediate, refund
   to the agency, incl. recurring → current-cycle pool + item removal); non-internal goes
   through `finalizeSoftDelete`, which cancels the item, voids the cycle's pending payouts,
   and refunds the current-cycle pool (`currentCycleRefundPool`).
3. ✅ **DONE — non-internal delete is brand-confirmed** — the project-detail button routes
   internal → `softDelete`, non-internal → `requestSoftDeleteConfirmation` → `/confirm/soft-delete`
   → `finalizeSoftDelete` (which now does the full refund + payout/invoice reversal).
4. ✅ **Helper DONE — current-cycle pool** (`refundableCyclePoolCount`), now wired via
   `currentCycleRefundPool` into the delete flows as the default refund.
5. ✅ **DONE — payouts & invoices recomputed** — `voidProjectPendingPayouts` drops the
   deleted cycle's pending payout lines (failing/reducing the payout); invoice status is
   derived from the payout, so invoices follow. *(Granular per-stage `proposedDispatchAmounts`
   redistribution is deferred — needs a schema column + form fields; today the default
   refunds the full pool and voids the cycle's payouts.)*
6. ✅ **DONE — universal completion gate** (`dispatch.eligibleBreakdowns`): **no** payout
   dispatches before its work completes — every cut (priority + non-priority) and every
   service type. Recurring deliverable cycles gate per-cycle on `isDeliverableCycleComplete`;
   non-cycling types (one-off, flat subscription, digital) gate on `status === 'completed'`.
   The platform's own cut is completion-gated and settled internally (no external transfer).
7. ✅ **DONE — confirm link expiry tied to the next charge** (`requestSoftDeleteConfirmation`
   → `nextChargeDate`); one-offs fall back to a 10-day window.
8. ✅ **DONE — always email the brand** — non-internal delete routes through
   `requestSoftDeleteConfirmation` (sends the confirm-link email); cancel sends
   `subscription-cancelled`. *(A post-confirmation "deleted" notice is a nice-to-have follow-up.)*
9. ✅ **DONE (by §9.1) — per-item removal spares future phases** — the "last item?" count
   includes not-yet-started recurring phases, so the whole Stripe sub is only cancelled when
   none remain.
10. ⚠️ **§0.6 mechanism — best-effort, needs live Stripe.** `refundProjectPool` now walks the
    subscription's paid invoices newest-first and refunds each `payment_intent` until the pool
    is covered (falling back to the stored one-off intent). The exact invoice/intent
    coverage **must be validated against a live Stripe subscription.**
11. ✅ **DONE — future-earnings forecasts through `cancelledAt`** (`predict-earnings.ts` keeps
    future-cancelled projects and clamps both tracks at the committed tail;
    `excludeCancelledProjects` now drops only past/effective cancels).
