/**
 * Feature flags — compile-time constants shared by the server AND the client
 * (the client imports them via the `@server/*` path alias, same as
 * `service-type.ts`). Dependency-free on purpose: no server-only imports here.
 *
 * A flag is flipped by editing this file and redeploying BOTH tiers, which
 * guarantees the front end and back end can never disagree on a flag's value.
 */

/**
 * Are recurring (weekly-billed) projects refundable?
 *
 * **TRUE** (default — current behaviour): a weekly project's payments are
 * refundable until the deliverable cycle they fund completes. So every payout —
 * priority and non-priority alike — is held by the dispatch completion gate
 * (`dispatch.eligibleBreakdowns`) until completion, and projects can be deleted
 * (with a refund).
 *
 * **FALSE**: weekly-billed projects (`isBillingCycleWeekly`) cannot be refunded.
 * With no claw-back risk:
 *  - the external **non-priority** cuts (platform / affiliate / sales-agency) are
 *    dispatched EARLY — without waiting for the project to complete; and
 *  - the front end **disables the refund-issuing delete** action on any
 *    weekly-billing-cycle project (no-refund subscription *cancellation* stays
 *    available, since it issues no refund).
 *
 * Priority cuts remain completion-gated regardless of this flag.
 */
export const IS_RECURRING_PROJECTS_REFUNDABLE = false;
