# Services & Projects — How the core flow works (source of truth)

> Canonical reference for the services → purchases → projects → payouts flow in
> `prodesk-web`. Describes how the system **is built to behave**. Keep this in
> sync with the code; it is the doc future contributors should trust. The
> Flutter app (`/lib`, `/functions`) is the historical reference the web was
> ported from — cited only where a rule originated there.

## 1. Service catalog & types

A service has one of **7 `ServiceType`s** (`server/src/lib/service-type.ts`, 1:1 with Flutter):

| type                    | bills weekly? | deliverable re-cycles? | notes                                                   |
| ----------------------- | :-----------: | :--------------------: | ------------------------------------------------------- |
| `subscription`          |      ✅       |           ❌           | weekly billing, single ongoing project                  |
| `recurringService`      |      ✅       |           ✅           | weekly billing, project re-opens each deliverable cycle |
| `recurringProductShips` |      ✅       |           ✅           | as above + shipping/delivery fee                        |
| `oneOffService`         |      ❌       |           ❌           | single charge                                           |
| `oneOffProductShips`    |      ❌       |           ❌           | single charge + shipping                                |
| `digitalProduct`        |      ❌       |           ❌           | auto-delivered by email, never enters the board         |
| `section`               |       —       |           —            | grouping header only                                    |

Helpers: `isBillingCycleWeekly` (subscription/recurring*), `hasDeliverableCycle`
(recurring* only — a subscription bills weekly but its project does **not**
re-cycle), `isDigital`, `hasShipping`, `isSinglePayment`.

**Deliverable cadence** = `deliverableFrequency` (`daily|weekly|monthly|yearly`)
× `repeatsEvery`. There is no `fortnightly`/`quarterly` value — "every 2 weeks" =
`weekly`×2, "quarterly" = `monthly`×3. **Billing is always weekly** regardless of
deliverable cadence.

## 2. How a project is born (the three creation paths)

All paths converge on **`buildProjectValues`** (`server/src/modules/projects/fulfillment-core.ts`),
the single place that freezes a `purchase_items` snapshot onto a new project.
The purchase item carries a complete frozen snapshot (commissions, configs,
delivery fees, `repeatsEvery`, phase delay — migration 0008) so a later change to
the live service never alters an in-flight project.

| path        | entry point                                                       |         quantity         | initial status                       |
| ----------- | ----------------------------------------------------------------- | :----------------------: | ------------------------------------ |
| Marketplace | `purchases.checkoutServices` → `fulfillPurchase` (on Stripe paid) | one project **per unit** | per §3                               |
| Proposal    | `proposals.convertToPurchase` → `fulfillPurchase`                 |     **one per item**     | per §3                               |
| Internal    | `projects.createInternalProject` / `proposals.submitInternal`     |     one **per unit**     | `brief` (then agency pays at allocate) |

`fulfillPurchase` (`server/src/modules/billing/fulfillment.ts`) is idempotent,
spawns projects, increments the agency's amortised project count, auto-delivers
digital products (approved deliverable + email), and generates the cycle-1
payouts. Internal purchases write the purchase as paid immediately (no client
charge), but the **project still starts in `brief`** like every other project —
it must never skip the Brief stage. The agency completes the brief, moves the
card to Allocate, assigns + budgets a contractor, then pays the contractor at
Allocate → Production (the only point where money changes hands for internal
work).

### 3. Initial status (`resolveInitialStatus`)

1. `digitalProduct` → **`completed`** (delivered by email).
2. delayed proposal phase (`startDelayDays > 0`) → **`upcoming`** (activates at phase start).
3. service has custom-field questions → **`clientBrief`** (buyer answers first).
4. otherwise → **`brief`**.

## 4. Project lifecycle (kanban)

Statuses: `clientBrief → upcoming → brief → allocate → production →
internalApproval → revision → clientApproval → completed`. Allowed transitions +
who may perform them live in `getAllowedTransitions` / the transition context in
`server/src/routers/projects.ts` (re-validated server-side).

## 5. Recurring & the deliverable cycle (exact-time, no cron sweep)

`nextCycleAt` is the boundary at which a project should next (re)enter `brief`.
Set at creation to `from + cadence` (anchored to the previous boundary — **no
drift**). Recurring re-cycling is **event + exact-time-job driven** — there is no
hourly sweep:

- `server/src/modules/projects/recurring-schedule.ts` is the engine.
- On completion of a recurring project, `onRecurringProjectCompleted` either
  re-opens it now (next cycle already due) or arms a **BullMQ delayed job at
  `nextCycleAt`**.
- The job (`runProjectCycle`) re-checks the **payment gate**
  (`isPaymentMadeOnTimeForCycle`: every weekly payment due before the boundary
  must have landed — because the weekly **billing** cycle ≠ the **deliverable**
  cycle), then resets the project to `brief`, clears the assignee, bumps
  `cycleCount` **once**, re-applies `recurringProjectConfig`, and arms the next job.
- A delayed phase's `upcoming` project is activated the same way at its phase start.
- The Stripe renewal webhook (`advanceRecurringCycle`) owns **payment state
  only** and nudges any due+completed recurring project — no double-advance.
- A once-daily `reconcile` job is only a backstop for jobs lost to a Redis flush.

## 6. Subscriptions (`server/src/modules/billing/subscription.ts`)

One Stripe subscription per purchase, **one subscription item per recurring
project** (each on its own product carrying `metadata.purchaseItemId`). After
checkout the webhook maps items → projects and stores `stripeSubscriptionItemId`.

- **Delayed recurring phase**: omitted from the checkout subscription; its
  subscription item is **added when the phase activates**, so a "starts in 40
  days" service bills in 40 days (not at checkout).
- **Cancel one project**: removes only that project's subscription item
  (`subscriptionItems.del`); the whole subscription is cancelled **only when the
  last** recurring project is removed. Both `projects.cancelSubscription` and
  `projects.removeRecurringItem` use `cancelProjectSubscription`.

## 7. Completion

- Agency requests completion (`markProjectComplete`) → status `clientApproval` +
  one-click confirm token emailed to the brand (token stripped from API reads).
- Brand confirms (email link → `finalizeCompletion`) or agency completes manually
  → `completeProject`: auto-approves deliverables, copies them to the brand
  locker, sets `completed`, and (if recurring) hands off to the cycle engine (§5).
- Digital products are completed at fulfillment.

## 8. Payouts, invoices, fees

- **Commission split** (`runPayoutSplit` in `fulfillment.ts`): per-role split
  (prodesk / agency owner / production / briefing / approval / salesperson /
  affiliate / sales agency) using the rates frozen on the purchase + the
  designee/redirect config. Grouped into one payout per beneficiary.
- **Payout dates** (`payoutFriday`, Brisbane-anchored): priority/subscription
  settle +14 days, non-priority the upcoming Friday.
- **Dispatch gate** (`server/src/modules/billing/dispatch.ts`): **nobody is paid
  until the work that funds the payout is complete** — every role (priority and
  non-priority) and every service type. A breakdown is eligible only once its
  **project is `completed`**; for a recurring deliverable cycle this is judged
  **per-cycle** via `isDeliverableCycleComplete` (the cycle-K cut releases once
  the project has advanced past cycle K — which only happens out of a `completed`
  status — or it completed as the terminal cycle). The platform's own cut
  (`as: 'admin'`) is completion-gated identically but settled **internally** (it
  has no external account to transfer to). Synchronous Stripe settles partially
  (mark eligible breakdown items paid, accumulate `paidAmount`, `received` when
  fully paid); webhook providers defer until fully eligible.
- **Wise** (`wise.ts`): funded via Stripe in two legs (platform → Wise Connect
  account → its linked Wise bank), then a Wise transfer to the recipient. The
  recipient **bears the transfer/FX fees** (the Wise quote fixes `sourceAmount`,
  so fees come out of what the contractor receives).
- **Stripe surcharge**: internal-purchase payments gross the surcharge onto the
  **agency** (separate fee line); normal brand purchases do **not** gross up
  (Prodesk bears the card fee).
- **Invoices / GST**: AU GST = total × 1/11 on the relevant legs (`routers/invoices.ts`).

## 9. Visibility & redaction

UI hides agency-only data from brands/contractors. The **one server-enforced
rule**: `completionToken`/`softDeleteToken` are stripped from every project read
(`server/src/lib/redact.ts`, applied in `projects.list/byId` + `contractor.*`)
because they are one-click action capabilities, not data.

## 10. Key files

- Creation primitive: `server/src/modules/projects/fulfillment-core.ts`
- Fulfillment: `server/src/modules/billing/fulfillment.ts`
- Recurring engine: `server/src/modules/projects/recurring-schedule.ts`
- Subscriptions: `server/src/modules/billing/subscription.ts`
- Payout dispatch: `server/src/modules/billing/dispatch.ts`, `wise.ts`, `payout-providers.ts`
- Proposal expiry: `server/src/modules/proposals/expiry.ts`
- Project lifecycle + cancellation + completion: `server/src/routers/projects.ts`
- Checkout: `server/src/routers/purchases.ts`, `modules/billing/recurring.ts`
- Proposals: `server/src/routers/proposals.ts`

## 11. Verification status

**Verified against the live Stripe TEST API** (`server/src/scripts/verify-stripe.ts`):
per-item checkout subscription lines (delayed phases excluded), the
product-metadata → `purchaseItemId` mapping, delayed-phase subscription-item add,
single-project cancel leaving the other items billing, and whole-subscription
cancel on the last item. Migrations 0008/0009 applied cleanly to the dev DB.
Core creation logic (initial status, cycle math, payment gate, quantity) is
unit-tested (`fulfillment-core.test.ts`).

**Still needs a fuller staging run** (require a Stripe Connect account / Wise
sandbox recipient, not exercisable from per-item shape checks): payout **dispatch
transfers** (Stripe Connect), the **Wise two-leg funding** end-to-end, and the
brand-facing **Checkout → webhook → fulfilment** round trip.

**Intentional simplification:** the **payment-plan instalment** payout still uses
the simpler "release the non-priority cut at cycle 5" model, not Flutter's
proportional-by-collected formula. Port `oneoff_payout_calculator.ts`'s
cycle 1 / 2–4 / 5 / 6+ proportional math when multi-week instalment plans go live.
