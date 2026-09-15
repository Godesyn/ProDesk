# Future Earnings (prediction)

Source of truth for the **Earnings → Future** tab: how prodesk-web forecasts the
upcoming payouts for agency owners, agency staff, and contractors. Read this
together with [`commissions.md`](./commissions.md) (the live split rules) and
[`services-projects.md`](./services-projects.md) (recurring lifecycle).

> The forecast is computed by **simulating the real, non-mutating payout
> calculator** over future cycles — it does not re-implement the money math. So a
> prediction can never drift from what is actually paid. To change *what is paid*,
> change the split; the forecast follows automatically.

## The core rule: two cadences

| Role | Cadence | Beneficiary ("last assigned") | Speculative? |
|------|---------|-------------------------------|--------------|
| **Contractor** | **deliverable cycle** (monthly / every N months / …) | `project.productionAssigneeId` (current assignee) | Yes — depends on staying assigned |
| Agency (owner cut) | weekly billing cycle | the **producing agency itself** (`beneficiaryAgencyId`, `as: 'agency'`) | Recurring: yes · Plan: **guaranteed** |
| Briefing / Allocation(production) / Approval managers | weekly billing cycle | `agency.briefingDesigneeId` / `allocationDesigneeId` / `approvalDesigneeId` (→ the agency itself if a redirect flag is set) | as above |
| Sales person | weekly billing cycle | `project.proposalSentById` (→ the agency itself if redirected) | as above |
| Sales agency / Affiliate / Platform | weekly billing cycle (non-priority) | proposal-sender / referred-by **agency** (`beneficiaryAgencyId`) / referring user / super-admin | as above |

**Only the contractor is stored per project.** Every other role is resolved at
forecast time from the agency's workspace settings (the designee fields) — exactly
as the live split does — so "the person in charge" always follows the current
agency configuration. There are no per-role "last manager" columns and none are
needed; nothing to reset on those roles.

> **Forecast cadence ≠ dispatch timing.** This table is when each cut is *earned/
> forecast* against the billing cadence. *Actual* dispatch is completion-gated: no
> payout (any role, any type) settles until its funding work completes — see
> `docs/delete-projects-subscriptions.md §6`. The forecast deliberately shows the
> gross schedule, not the held/settled state.

## Recurring vs payment plan (what gets forecast)

- **Recurring subscription** (`isBillingCycleWeekly(serviceType)` →
  `subscription` / `recurringService` / `recurringProductShips`): billed weekly.
  - Non-contractor roles: forecast the next `WEEKLY_RECURRING_HORIZON` (8) weekly
    splits. **Speculative** — excluded once the subscription is cancelled.
  - Contractor: forecast the recurring contractor budget for the next
    `CONTRACTOR_CYCLE_HORIZON` (6) **deliverable** cycles (only `recurringService`
    / `recurringProductShips` re-cycle a deliverable — `hasDeliverableCycle`).
- **Payment plan** (`purchase.selectedPaymentPlan`, a one-off paid in installments):
  the priority cut (agency owner + designees) is paid upfront at fulfillment; the
  **non-priority cut (sales agency / affiliate / platform) is deferred** and
  reimbursed **spread across the installment cycles** (see below). These are
  **GUARANTEED** — independent of any future assignment — so they always appear in
  Future Earnings for their whole remaining schedule.

## Amounts

- **Contractor (per deliverable cycle):** `recurringContractorBudget(recurringProjectConfig, amount)`
  — `contractorDefaultBudgetInPercentage × amount.recurring.weeklyAfter`, else the
  flat `contractorDefaultBudget`. (The FIRST cycle uses `upfrontProjectConfig` at
  fulfillment; the forecast is about *future* cycles, hence the recurring config.)
- **Everyone else (per weekly cycle):** the exact per-role split from
  `computePayoutSplit` on that cycle's gross. Recurring gross =
  `amount.recurring.weeklyAfter`; payment-plan reimbursement gross =
  `reimbursementGrossForItem` (below). Owner = remainder after the manager / sales /
  affiliate / platform cuts (see commissions.md).

## Payment-plan reimbursement (spread)

Deferred non-priority is released across installments (Flutter parity), not as one
cycle-5 lump:

- `REIMBURSEMENT_CYCLE = 5`.
- `reimbursementGrossForItem(item, cycle)`:
  - `< 5` → `0`
  - `= 5` → `upfront + (5−1) × weeklyAfter` (clears the backlog collected so far)
  - `6 … numberOfWeeks+1` → `weeklyAfter` (that installment)
  - `> numberOfWeeks+1` → `0`
- **Total-preserving:** the sum over cycles `5 … n+1` equals
  `upfront + n × weeklyAfter` = the full one-off total, i.e. the same total
  non-priority that the old single-lump paid — only the *timing* is spread.
- Live path: `advanceRecurringCycle` calls `generateReimbursementPayouts` on every
  cycle `≥ 5` (self-bounds, since the gross is `0` past plan end).

This is safe because **payment plans cannot be cancelled** (next section), so every
reimbursement cycle is guaranteed to fire and the full total is always realised.

## Cancellation

- **Recurring subscriptions can be cancelled** — `projects.cancelSubscription` sets
  `projects.cancelledAt` and removes the Stripe subscription item. The predictor
  **excludes** cancelled / soft-deleted recurring projects: Track A filters
  `cancelledAt`/`deletedAt`; Track B passes `excludeCancelledProjects: true` to
  `computePayoutSplit`, which drops items whose project is cancelled.

> ⚠️ **Coupled change — this exclusion only holds while cancellation is *immediate*.**
> It assumes `cancelledAt` ⇒ no more earnings, which is true for today's immediate-cancel
> web code. Under the authoritative cancellation spec
> ([`delete-projects-subscriptions.md`](./delete-projects-subscriptions.md) §3) a cancel is
> **scheduled**: `cancelledAt` becomes a **future** date and the subscription keeps billing
> and paying out **until** then (the locked cycle + minimum term — those payouts are
> **guaranteed**). When scheduled cancellation lands (that doc's §9.1), this predictor must
> change from *"drop if `cancelledAt` is set"* to **"forecast through `cancelledAt`, then
> stop"**, and treat the pre-`cancelledAt` tail as **guaranteed** (like payment-plan
> reimbursement), not speculative — otherwise it under-forecasts the committed remainder.
> Delete is unaffected: a deleted project is genuinely gone (the refund/claw-back is the
> payout recompute, not a forward forecast).
- **Payment plans cannot be cancelled** — they are a fixed installment commitment.
  `projects.cancelSubscription` rejects with `BAD_REQUEST` when the project is a
  payment-plan one-off (not a genuine recurring/subscription service type). This
  guarantees the reimbursement schedule above always completes.

## Completion reset

When a **recurring** project completes, `completeProject` clears
`productionAssigneeId` / `assigneeType` (Flutter parity). The next cycle starts
unassigned, so the contractor forecast stops attributing it to the previous
contractor until someone is re-allocated. Manager designees are agency-level, so
they need no reset — they already "retract to the agency model" by reference.

## Architecture

```
computePayoutSplit(purchaseId, opts, db)   ← pure split (no writes), single source of truth
   ├─ runPayoutSplit(...)                  ← live: persists payouts + breakdowns + invoices
   └─ predict-earnings.ts                  ← forecast: simulates cycles, never writes
        predictContractorCycles(project)        Track A (deliverable cycle)
        predictWeeklyForPurchase(purchase)      Track B (weekly; recurring + reimbursement)
        predictForViewer(db, scope)             orchestrates + scopes to the viewer
                ▲
   payouts.predictFutureEarnings (tRPC)     ← resolves scope, returns forecast rows
```

`computePayoutSplit` is the behavior-preserving extraction of the old
`runPayoutSplit` (its split math is unchanged; only the DB-write tail moved into a
thin `runPayoutSplit` wrapper). `PayoutSplitOpts.excludeCancelledProjects` is the
only forecast-specific addition.

### Viewer scoping (mirrors the Past tab)
- super-admin `everyone` → all rows
- agency owner → rows the agency itself receives (`as === 'agency'` && `beneficiaryAgencyId === the agency`)
- agency staff → rows with `as === 'staff'`
- contractor → their own assigned projects only (Track A; `beneficiaryId === me`)

### Horizons (constants in `predict-earnings.ts`)
- `CONTRACTOR_CYCLE_HORIZON = 6` deliverable cycles
- `WEEKLY_RECURRING_HORIZON = 8` weeks (open-ended subscriptions)
- payment-plan reimbursement → the full remaining plan (`5 … durationWeeks+1`)

## Key files

| File | Role |
|------|------|
| `server/src/modules/billing/predict-earnings.ts` | the predictor (both tracks + orchestration) |
| `server/src/modules/billing/fulfillment.ts` | `computePayoutSplit` / `runPayoutSplit`, `reimbursementGrossForItem`, `REIMBURSEMENT_CYCLE`, `advanceRecurringCycle` |
| `server/src/modules/projects/recurring-schedule.ts` | `recurringContractorBudget`, recurring reset |
| `server/src/modules/projects/fulfillment-core.ts` | `projectNextCycleAt` (deliverable cadence) |
| `server/src/routers/payouts.ts` | `predictFutureEarnings` tRPC procedure |
| `server/src/routers/projects.ts` | `cancelSubscription` (payment-plan guard), `completeProject` (contractor reset) |
| `client/src/pages/earnings/*` | Past/Future tabs, payout tile + breakdown (`reasonLabel`) |

## Tests
`server/src/modules/billing/predict-earnings.test.ts` (+ `fulfillment.test.ts`):
reimbursement spread is total-preserving, recurring contractor budget, and the
6-cycle contractor forecast (incl. no-assignee / non-recurring → empty).

## Known approximations / to verify against a live Stripe run
- The reimbursement **total** is preserved by construction; the exact installment
  **cycle index** each payment lands on depends on the Stripe subscription /
  `maybeCancelInstalment` lifecycle and should be sanity-checked end-to-end.
- Agency vs contractor netting across the two cadences (weekly agency split vs
  per-deliverable-cycle contractor budget) is approximate; the live
  `applyContractorFee` deducts the contractor budget from the agency cut at allocation.
