# Commissions & Payout Splits — Single Source of Truth

This document defines how a purchase's gross is split between the platform, the
producing agency, referrers, and agency staff. It is the canonical reference for
any work touching pricing, payouts, invoices, or the proposal/earnings UI. If code
and this document disagree, treat the discrepancy as a bug and reconcile here.

**Code that implements this:**

- Backend split: `server/src/modules/billing/fulfillment.ts` → `runPayoutSplit`
  (initial/upfront payout, recurring cycles, payment-plan reimbursement all route
  through it). Per-project frozen rates: `server/src/modules/projects/fulfillment-core.ts` → `buildProjectValues`.
- Rates: `global_settings` (seed in `server/src/scripts/initialize_data/global_settings.json`).
- Frontend earnings/billing display: `client/src/pages/proposals/billing.ts` +
  `billing-sidebar.tsx`.

---

## 0. Directional rounding — charge UP, pay out DOWN

Every money amount is rounded to whole cents with a **direction that guarantees the
platform never disburses more than it collected**:

- **Charges / collections round UP** (`Math.ceil` to cents): Stripe checkout line
  items, payment-plan deposit + instalments (`splitOneOffByPlan`), recurring weekly
  fees, the internal-project budget + processing-fee, and the brand→prodesk invoice.
- **Payouts / disbursements round DOWN** (`Math.floor` to cents): every commission
  payout row (`computePayoutSplit`'s `row()`), commission invoices, the dispatched
  provider amount (Stripe/PayPal/Wise transfers + Wise funding), brand refunds, and
  the contractor fee (with the same floored figure deducted from the agency owner).

Helpers live in `server/src/lib/num.ts`: `roundChargeUp` / `roundPayoutDown` (dollars)
and `chargeCents` / `payoutCents` (integer cents for Stripe), each float-artifact-safe
(`(n*100).toFixed(6)` before ceil/floor). Net effect for any line: **collected ≥ Σ
disbursed** — a few cents of rounding may stay unspent with the platform, but a payout
can never exceed what was charged. Guarded by `num.test.ts` and the billing integration
suite. (This supersedes the earlier round-half-up behaviour; payout-related test
tolerances assert *underspend only*, i.e. leak ≥ 0.)

---

## 1. The rates (global defaults)

| Rate                          | Default | Notes                                                |
| ----------------------------- | ------- | ---------------------------------------------------- |
| Agency commission             | **50%** | The producing agency's base share.                   |
| Sales-agency commission       | **30%** | Paid to whoever _sold_ the order (see scenarios).    |
| Affiliate commission          | **7%**  | Paid to whoever _brought the buyer to the platform_. |
| Prodesk (platform) commission | **13%** | The platform's cut. **Always taken.**                |

> ### ⚠️ Two different "sales" commissions — do not conflate them
>
> | | **Agency-sales commission** | **Salesperson commission** |
> | --- | --- | --- |
> | What | The 30% rate above | A per-staff % carved **out of** the producing agency's 50% |
> | Who is paid | A **separate agency** (the proposal sender / referred-by agency) | A **staff member of the producing agency** who sent the proposal → their own bank account |
> | On top, or inside? | **On top** of the producing agency's share | **Inside** the producing agency's 50% |
> | Tier | Non-priority | Priority |
> | Global rate | `globalSettings.salesAgencyCommission` (`sales_agency_commission`) | n/a — per-staff in `agencies.salesPersonCommissions` |
> | Code identifiers | `salesAgencyRate` / `salesAgencyAmt` / `salesAgencyBeneficiaryId` / `keptSalesAgencyRate`; commissionType `'agencySalesCommission'` | `salesPersonPct` / `salesPersonAmt` / `salesPersonId`; commissionType `'salesPersonCommission'` |
> | Redirect-to-bank flag | _none_ (it always goes to the other agency) | `agencies.redirectSalesPersonCommissionToBankAccount` — when on, the salesperson cut falls back to the **agency** (its own bank account, `beneficiaryAgencyId` / `as: 'agency'`), **not** the owner user |
>
> The `redirect…ToBankAccount` flag named "sales" redirects the **salesperson** commission, **not** the 30% agency-sales commission.

These sum to **100%**. Prodesk is computed as the **remainder** after every other
role is paid, so it absorbs any cut that has no eligible recipient (the fallback).

> **Rates are frozen at checkout.** The three global rates (agency / sales-agency /
> affiliate) are snapshotted onto the purchase row (`purchases.agencyCommission` etc.)
> when the buyer transacts. Every later split for that purchase — recurring cycles and
> payment-plan reimbursement included — reads the **frozen** purchase rates, falling
> back to live `global_settings` only for purchases that predate the freeze. If the
> platform changes a global rate mid-plan, the buyer's payouts (and the reimbursement
> priority base `agencyRate × lineTotal`) still reflect what they actually paid under,
> so the reimbursement interest math can't drift. (`computePayoutSplit`.)

## 2. Priority vs non-priority

This only affects **payment-plan deferral and the payout date**, not amounts — and it is
**subordinate to the completion gate** (see below).

- **Priority** (for payment plans, the non-deferred half emitted at fulfilment):
  agency (owner), salesperson, briefing manager, internal approval, production manager.
- **Non-priority** (for payment plans, deferred to the reimbursement cycle):
  agency-sales, Prodesk, affiliate.

**🔒 Completion gate (overriding rule): nobody is paid until the work that funds the payout
is complete** — every tier, every service type. Payouts are *created* at fulfilment/cycle,
but `dispatch.eligibleBreakdowns` holds each one `pending` until its project completes
(recurring deliverables: per-cycle via `isDeliverableCycleComplete`; non-cycling types:
`status === 'completed'`). The platform's own cut is gated too and settled internally. So
"priority" no longer means *paid sooner than completion* — it only governs which payment-plan
**reimbursement cycle** a cut is emitted in. See `docs/delete-projects-subscriptions.md §6`.

**Payout date = the first Friday on/after now + 14 days, for EVERY tier** (`payoutFriday`) —
the brand's **refund window**. A payout therefore dispatches at `max(date, completion)`: the
14-day buffer and the completion gate are independent, and whichever is later wins.
⚠️ This **diverges from the Flutter `payout_helper`** (which settled non-priority on the
*upcoming* Friday, i.e. sooner); the refund-safety + completion rules are the newer,
authoritative behaviour.

**⚡ Internal projects are the exception — they pay out immediately, never on the 14-day
window.** An internal project (`project.isInternal`, from an `is_internal` purchase) carries
**no client revenue and no claw-back risk** — the agency funds the contractor fee up front at
allocate — so there is no refund window to wait on. Its payout's **`toPayAt` is always its
creation time (`= createdAt`), never `payoutFriday('priority')`** (`applyContractorFee`). The
completion gate still applies (dispatch never pays before the work is `completed`), but the
moment the project is marked complete, `completeProject` calls
`dispatch.dispatchProjectPayoutsNow` to pull each of that project's still-`pending` payouts
forward to `toPayAt = createdAt` and dispatch them on the spot — so an internal payout settles
on completion **without waiting for the weekly payout cron**. (Only the contractor payout
exists for an internal project: `computePayoutSplit` returns `null` for internal purchases, so
there is no commission split.)

**Delayed proposal phases anchor the date to the phase start.** A proposal item in a
phase with `startDelayDays > 0` doesn't begin (and isn't refund-eligible) until its
phase starts, so its **initial** payout is dated from `fulfilment + startDelayDays`
*then* the 14-day buffer — e.g. a phase-2 item delayed 14 days settles ~28 days out,
while the immediate phase-1 item settles ~14 days out. Implemented via
`computePayoutSplit`'s `anchorToPhaseStart` opt (set only on the fulfilment run;
recurring/reimbursement cycles fire after the phase has already started, so they
anchor to "now"). The delay is read from `purchase_items.startDelayDays`.

The agency's base share is further carved up among its staff designees
(salesperson / production / briefing / internal-approval), each of which can be
redirected back to the agency's own bank account. The **agency keeps the
remainder** of its share after those designee cuts (paid to the agency itself —
`beneficiaryAgencyId`, `as: 'agency'`; see §7).

### 2a. Payment-plan reimbursement — the "week-5" model

A payment plan is a deposit (e.g. 25%) + weekly installments. The deposit plus the
first four weekly installments mean **≥ 50% of the contract is collected by week
five** (`REIMBURSEMENT_CYCLE = 5`). That is what makes the model work:

- **Priority (agency owner + designees) is paid first, in full, with NO interest
  and no waiting** — exactly their base % of the principal, settled at fulfilment.
  Guaranteed because the deposit alone already covers a large slice of it, and
  plans cannot be cancelled.
- **Non-priority (agency-sales, affiliate, Prodesk) waits until week 5** — that is
  why it is deferred: the cash to cover it only exists by then. In exchange for
  waiting, **the non-priority trio BEARS (and receives) ALL the plan interest.**

So the week-5 split is **NOT** "each role takes its flat % of the collected total."
It is: **subtract the fixed priority amount from the summation first; the remaining
amount (principal not paid to priority + ALL the interest) is then divided among
the three non-priority roles.** Net effect: priority gets its exact base; the
interest rides entirely on the non-priority pool. (This refines §2's "timing, not
amounts" note — for *payment plans*, the deferral also routes the interest.)

**Implementation (`computePayoutSplit`, `opts.reimbursement`):** the trio's
**cumulative** pool through cycle _w_ is `max(0, collected-through-w − priorityBase)`,
where `priorityBase = agencyRate × item.lineTotal`; **this cycle's** pool is the
increment over the previous cycle (`reimbursementCollectedThrough` gives the
collected-so-far, zero before cycle 5). Splitting the pool among the trio uses each
role's share of the non-priority rate (`rate ÷ (1 − agencyRate)`), Prodesk being the
remainder. Worked example ($100 one-off, 5% over 12 weeks; collected $105.09, priority
base $50): cycle 5 backlog $52.53 − $50 = **$2.53** to the trio; cycles 6–13 pay each
$6.57 installment to the trio in full. Trio total = **$55.09 = collected − priority
base** (sales $33.05 / affiliate $7.71 / Prodesk $14.33), **zero leak**. The priority
(agency) keeps exactly $50 — its base, no interest.

> **Carry-forward base (small-deposit safety).** Subtracting the base from the running
> *cumulative* total (not all-at-once at cycle 5) keeps the common case identical —
> when the cycle-5 backlog already exceeds the base, cycle 5 pays backlog−base and
> later cycles pay full installments — but when a **small deposit** makes the cycle-5
> backlog *below* the base, the remainder is absorbed across the following cycles
> (trio gets $0 until collected overtakes the base) instead of clamping to $0 and then
> **overpaying** the trio. Either way the trio total is exactly `collected − base`.
>
> **Cent rounding (directional — see §0).** Each role's cut is **floored** to whole
> cents independently per cycle. A few cents (~$0.18 over a 12-week plan) therefore stay
> unspent with the platform rather than being disbursed — a one-directional artifact: the
> trio is paid *at most* `collected − base` and never a cent more, never touching the
> agency base. (We deliberately under-distribute rather than risk overspending.)

Guarded by `reimbursement.integration.test.ts` (zero-leak + small-deposit) and the
end-to-end `lifecycle.integration.test.ts` (fulfilment → `advanceRecurringCycle` →
reimbursement reconciliation).

> The earlier behaviour leaked the owner's interest (~$2.58): it priced each role at
> its flat % of the interest-inclusive gross and subtracted an owner row at 50% of
> that gross, while the owner was only paid 50% of the bare principal. Fixed
> 2026-06-22.

### 2b. The plan defers ONLY one-off items — recurring setup fees split in full

A payment plan only ever defers **one-off** items. A **recurring item's setup fee**
(`recurring.upfront`, carried as the item's `lineTotal`) is collected in full at
checkout and is **never** on the plan, so at fulfilment it splits across **all**
roles immediately — owner (priority, +14d) **and** sales-agency / affiliate / Prodesk
(non-priority, upcoming Friday). This mirrors the Flutter subscription calculator:
`billing_service.getAmountByProjectAndCycle` returns `recurring.upfront` at cycle ≤ 1
and the subscription calculator splits it across every role — the recurring upfront
never enters the one-off payment-plan reimbursement. In `computePayoutSplit` the
deferral `tier` is therefore decided **per item**: recurring items force `tier: 'all'`,
one-off items honour `opts.tier`. Without this, a payment-plan purchase that also has
a recurring item deferred the recurring setup's non-priority cut to the reimbursement
cycle — which only revisits one-off items — so that cut (e.g. $60 sales + $14
affiliate + $26 Prodesk on a $200 setup) was **orphaned**: invoiced to the brand but
paid to nobody. Guarded by `fulfillment.integration.test.ts`. Fixed 2026-06-22.

### 2c. Each commission invoice is written exactly once over the lifecycle

The split also emits the commission **invoice** documents (brand→Prodesk/sales-agency
PAID; agency-retained + designee UNPAID; sales/affiliate non-priority UNPAID). Each
must be written **once** across the purchase's lifecycle, gated to the run that
actually pays that cut — mirroring the Flutter `invoices_calculator`, where the
priority commissions are **zeroed** on cycles ≥ 5 so their invoices never regenerate:

- **Brand→Prodesk/sales-agency (PAID)** — emitted at fulfilment (and per recurring
  weekly cycle), for the gross charged. **Not** re-emitted on a reimbursement cycle,
  which only releases an already-charged item's deferred commission.
- **Agency-retained + designee (priority, UNPAID)** — emitted only on a run that pays
  the priority cut (fulfilment / recurring cycle); **not** on a reimbursement cycle.
- **Sales-agency + affiliate (non-priority, UNPAID)** — emitted only on a run that
  pays the non-priority cut. A payment-plan one-off therefore emits these **once, at
  the reimbursement cycle**, never at fulfilment.

In `computePayoutSplit` this is `emitBrandInvoice = !opts.reimbursement`,
`emitPriorityInvoices = tier !== 'nonPriority'`, `emitNonPriorityInvoices = tier !==
'priority'` (same per-item `tier` that gates the payouts). Without it, a payment-plan
purchase re-emitted the brand and agency-retained/designee invoices on **every**
reimbursement cycle (5..n+1) and emitted the sales/affiliate legs at **both**
fulfilment and reimbursement — duplicate, confusing ledger rows. Guarded by
`fulfillment.integration.test.ts`. Fixed 2026-06-22.

> **Legacy data note:** purchases fulfilled before 2026-06-22 (e.g. the test purchase
> `68485e80`) keep the pre-fix shape — a single merged agency payout, the recurring
> setup's non-priority cut orphaned, and the one-off's sales/affiliate invoices emitted
> at cycle 1. The fix is forward-only; remediating a stale purchase means deleting and
> re-fulfilling it (or a targeted backfill), not a code change.

## 3. Who is who

- **Producing agency** — the agency that owns the service (`purchaseItems.agencyId`).
- **Sender agency** — the agency that sent the proposal (`purchase.proposalSentByAgencyId`).
  Absent on marketplace buys.
- **Affiliate** — the user who referred the buyer to the platform
  (`brandOwner.referredByUserId`). An individual (e.g. a contractor) affiliate.
- **Referred-by agency** — the agency the buyer was referred by
  (`brandOwner.referredByAgencyId`, stamped at signup from the `?ref=`/subdomain).

> **A referral always lives on the buyer's USER, never on the brand.** Anything that needs a brand's referred agency reads it through the brand owner's `users.referredByAgencyId`.
> The tenant subdomain is a user concept, not a brand one.

## 4. Scenarios (the producing agency's gross take)

### Scenario 1 — Marketplace purchase (no proposal)

| Cut              | %      | Recipient                                     | Fallback |
| ---------------- | ------ | --------------------------------------------- | -------- |
| Sales            | 30     | referred-by **agency** (`referredByAgencyId`) | Prodesk  |
| Affiliate        | 7      | referred-by **user** (`referredByUserId`)     | Prodesk  |
| Prodesk          | 13     | platform                                      | —        |
| **Agency keeps** | **50** | producing agency                              | —        |

A referred-by agency that _is_ the producing agency is skipped (its sales cut
folds into Prodesk's remainder), since an agency can't pay itself a sales cut.

### Scenario 2 — Proposal sent by the service owner (self-sent) ⭐

The producing agency **is** the sender. The buyer pays **no** third-party sales
cut and **no** affiliate cut — the agency keeps both. The affiliate is **dropped
entirely, even when the buyer was referred by someone** (that person is not paid).

| Cut              | %      | Recipient                                                    |
| ---------------- | ------ | ------------------------------------------------------------ |
| Prodesk          | 13     | platform                                                     |
| **Agency keeps** | **87** | producing agency (= 50 + freed 30 sales + freed 7 affiliate) |

This is the defining rule: **a self-sold proposal nets the agency 100% − Prodesk = 87%.**

### Scenario 3 — Proposal sent by a _different_ agency

| Cut                        | %      | Recipient             |
| -------------------------- | ------ | --------------------- |
| Sales                      | 30     | the **sender** agency |
| Affiliate                  | 7      | referred-by **user**  |
| Prodesk                    | 13     | platform              |
| **Producing agency keeps** | **50** | producing agency      |

The sender agency earns the 30% sales commission **on top** (it is a separate
beneficiary). The word "referrer" here means: for _sales_ → the sender agency; for
_affiliate_ → still the referred-by user.

## 5. Worked example

Buyer purchases two services, one-off gross $1,000 each.

- **Self-sent proposal** (agency sells its own): agency $1,740 (87%), Prodesk $260 (13%).
- **Different-agency proposal**: producing agency $1,000 (50%), sender agency $600
  (30% sales), affiliate user $140 (7%), Prodesk $260 (13%).
- **Marketplace, brand referred by an agency + a user**: producing agency $1,000
  (50%), referred-by agency $600 (sales), referred-by user $140 (affiliate),
  Prodesk $260 (13%). With no referrers, the sales + affiliate fall back to
  Prodesk.

## 6. Implementation status & known gaps

- ✅ **Scenario 2 (self-sent)** — implemented in `runPayoutSplit`: when the order
  is a proposal whose sender is the producing agency, the freed sales + affiliate
  rates fold into the owner share (`keptSalesAgencyRate` / `keptAffiliateRate`) and the
  affiliate is suppressed. Frontend earnings show **87%** for own-service proposals.
- ✅ **Scenario 3 (different agency)** — sender earns sales; affiliate → referred-by user.
- ✅ **Scenario 1 (marketplace)** — sales → the buyer's referred-by agency
  (`referredByAgencyId`), falling back to Prodesk when there's none (or it is the
  producing agency). Affiliate → referred-by user only, else Prodesk.
- ✅ **Priority/non-priority tiering & payout dates** — see `payoutFriday`.

## 7. Where each cut lands at payout (the receiving bank account)

> **Payouts are split PER PROJECT.** A purchase spanning several projects produces
> one payout **per (beneficiary, project)** — never a single payout merged across
> projects. Each payout carries the commission lines for exactly one project (the
> link lives on `payout_breakdowns.projectId`; payouts have no `projectId` column).
> This is what lets a **completed** project's share dispatch immediately while a
> stuck sibling project waits: `dispatch.eligibleBreakdowns` gates each breakdown on
> its own project's completion, and per-project payouts keep that boundary clean for
> every provider (not just Stripe's partial settlement). `runPayoutSplit` keys its
> beneficiary buckets by `<beneficiary>:<projectId>`; the contractor-fee
> deduction/refund (`agencyPayoutsForProject`) targets only the allocated project's
> payout. The future-earnings predictor mirrors this (one forecast row per
> beneficiary+project+week).

> **A missing payout account never fails and never reroutes — the payout WAITS.**
> If a beneficiary (user *or* agency) has not linked a destination for the chosen
> method, `dispatchPayout` leaves the payout `pending` and retries on the next cron
> run once an account is connected. There is no fall-back to any other party.

A payout has **exactly one beneficiary**, recorded in one of two mutually-exclusive
columns (enforced by the `payouts_one_beneficiary` check —
`num_nonnulls(beneficiary_id, beneficiary_agency_id) = 1`):

- **`beneficiaryId`** (a USER) — staff member, affiliate, contractor, or the
  super-admin. Dispatch pays that user's connected account.
- **`beneficiaryAgencyId`** (an AGENCY) — the agency itself receives the money in
  its **own** bank account. Dispatch pays the agency's connected account
  (`agencies.stripeAccountId` / `payoutMethods`) and **only** that: if the agency
  has not linked a payout account, the payout is **left pending** until it does —
  there is **no fall-back to the agency owner**. `as: 'agency'`.

> ⚠️ **Two different agency links — do not conflate.** Every payout also carries a
> separate **`agencyId`** = the SOURCE/owning agency of the services (context:
> "whose work generated this"). That is *not* the payee: the beneficiary of a
> source agency's services may be a staff member, a sales/affiliate user, or the
> super-admin. Only `beneficiaryAgencyId` says the **agency itself** is paid.

### Non-priority cuts (settle the upcoming Friday)

| Cut | Lands on | Beneficiary column | `as` |
| --- | --- | --- | --- |
| **Agency-sales (30%)** | the **sales agency's** own bank account (sender / referred-by agency) | `beneficiaryAgencyId` = sales agency | `agency` |
| **Affiliate (7%)** | the **affiliate user's** own bank account | `beneficiaryId` = affiliate user | `staff`* |
| **Prodesk (13%)** | the platform (super-admin account) | `beneficiaryId` = super admin | `admin` |

\* The affiliate row's commission `role` is `contractor`, but the grouped payout is
labelled `as: 'staff'` (legacy parity); scope it by `beneficiaryId`, not `as`.

### Priority cuts — carved out of the producing agency's 50% (settle +14 days)

> ⚠️ **"Agency-owner cut" never pays the owner *user*.** Despite the name (and the
> `agencyOwnerCommission` commissionType), this cut — and every designee cut that falls
> back — is paid to the **agency entity** (`beneficiaryAgencyId`, `as: 'agency'`, into
> the agency's own bank account), **never** to `agency.ownerId`. The agency owner as a
> person never receives a payout and is never an invoice party. `agency.ownerId` is used
> in code only as a **comparison** ("is this designee a distinct person, or just the
> agency itself?"), not as a payee.

The **agency-owner cut** is always paid to the **producing agency itself**
(`beneficiaryAgencyId` = producing agency, `as: 'agency'`). Each **designee cut**
lands on **that staff member's own account** — *unless* its
`redirect…CommissionToBankAccount` flag is on, or no designee is assigned, in which
case it **falls back to the producing agency** (also `as: 'agency'`).

| Cut | Lands on (default) | Falls back to the agency when |
| --- | --- | --- |
| **Agency owner** = the **remainder of the 50%** after the four designee cuts below | the **producing agency's** own account (`beneficiaryAgencyId`, `as: 'agency'`) | — (this *is* the agency cut) |
| **Salesperson** | the salesperson staff member's own account (`beneficiaryId` = `salesPersonId`, `as: 'staff'`) | `redirectSalesPersonCommissionToBankAccount` on, or no salesperson |
| **Briefing manager** | the briefing designee's own account | `redirectBriefingCommissionToBankAccount` on, or no `briefingDesigneeId` |
| **Internal approval** | the approval designee's own account | `redirectInternalApprovalCommissionToBankAccount` on, or no `approvalDesigneeId` |
| **Production manager** | the production designee's own account | `redirectProductionCommissionToBankAccount` on, or no `allocationDesigneeId` |

### Contractor fee — deducted from the agency cut, paid to the contractor

When a project with a contractor assignee enters **production**, `applyContractorFee`
(`routers/projects.ts`) **deducts the contractor's budget (`project.contractorBudget`)
from the producing agency's priority payout** (located by
`beneficiaryAgencyId = project.agencyId`) and creates a separate payout to the
**contractor's own bank account** (`beneficiaryId` = contractor, `as: 'contractor'`).
The fee is capped at the agency's available net (`contractorBudgetCeiling`) so the
agency cut never goes negative; if it consumes the whole agency net, the agency
payout is removed (recreated by `reverseContractorFee` if the project is later
cancelled/refunded).

For an **internal** project the agency-cut deduction is skipped (there is no client-funded
agency payout to deduct from) and the contractor payout is dated to settle **immediately** —
`toPayAt = new Date()` (its `createdAt`) rather than `payoutFriday('priority')` — then
released the instant the project completes via `dispatchProjectPayoutsNow`, bypassing the
weekly cron. See the payout-date rule above.

### Worked split of the producing agency's 50% (one-off gross, designees @ 3% each)

- Agency share = **50%** of gross.
- Designee cuts: salesperson 3 + briefing 3 + internal approval 3 + production 3 = **12%** → land on those staff members' own accounts (or the agency if redirected).
- Agency net so far = 50 − 12 = **38%**.
- Contractor fee (e.g. 8% of gross via `contractorBudget`) → the **contractor's own account**.
- Remaining **30%** → the **producing agency's** own bank account (`beneficiaryAgencyId`).

> **Percentages in this doc are the seeded defaults.** Code never hard-codes them —
> the split reads the live `global_settings` rates (`agencyRate`, `salesAgencyRate`,
> `affiliateRate`; Prodesk is the remainder). Change the rates in settings, not code.
