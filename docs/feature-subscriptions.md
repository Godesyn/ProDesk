# Feature Subscriptions

Feature Subscriptions are admin-defined, recurring subscription **products that unlock product
features**. They are a self-contained system, entirely separate from **Marketplace Subscriptions**
(the per-purchase Stripe billing under `server/src/modules/billing/*` and `routers/billing.ts`, where
a brand pays an agency for recurring services). The two never share tables or code paths.

The first Feature Subscription is **Growth Strategy** — it gates the brand AI assistant chat.

---

## 1. Model

```
feature_subscription_products   (a feature subscription, e.g. "Growth Strategy")
  └─ feature_subscription_tiers  (Bronze / Silver / Gold … Growth Strategy has one: "Standard")
       └─ feature_subscription_prices (interval = week|month, dynamic amount, currency)

feature_subscriptions            (a subscription a USER holds — always a brand OWNER)
```

Defined in `server/src/db/schema.ts`. Money is `numeric(14,2)`; the interval enum is
`feature_subscription_interval ('week','month')`; status enum `feature_subscription_status` mirrors the
Stripe subset we track (`trialing, active, past_due, canceled, incomplete, unpaid`).

A **product** carries a `featureKey` (the gate, see below) and the in-app **upsell card** copy
(`cardTitle`, `cardSubtitle`, `cardDescription`, `cardButtonLabel`). A **price** is immutable once
synced to Stripe (see §4). A **subscription** snapshots `interval`/`amount`/`currency` at purchase so
later price edits don't rewrite history.

---

> **One shared subscribe path.** Everything after the authorization check in
> `featureSubscriptions.checkout` lives in
> `modules/feature-subscriptions/subscribe.ts` (`subscribeToPrice`): price/tier/product
> resolution, the no-double-subscribe rule, per-unit quantity seeding, the
> card-on-file → hosted-Checkout fallback, and the dev activation. The beta
> post-expiry activation (`modules/beta/activate.ts`) is the second caller. Add a
> subscribe rule THERE, not in the router, so both stay in lockstep.

---

## 2. Owner-scoped entitlement (the key rule)

`feature_subscriptions.userId` is **always the brand OWNER**. When **any staff member of a brand**
subscribes "for the brand", the subscription attaches to that brand's owner — `createdByUserId` records
who actually checked out, `createdForBrandId` records the originating brand, but the **subscriber of
record is the owner**.

Because entitlement lives on the owner, the unlocked feature is available across **every brand that
owner owns**. Gating therefore always resolves: `brand → brand.ownerId → does the owner hold an active
subscription whose product.featureKey matches?`

Helpers: `server/src/modules/feature-subscriptions/entitlements.ts`

- `userHasFeature(db, userId, featureKey)` — active (`active`/`trialing`) and not lapsed.
- `brandHasFeature(db, brandId, featureKey)` — resolves the owner, then `userHasFeature`.
- `brandOwnerId(db, brandId)`.
- `isBetaUser(db, userId)` — the **beta bypass**, checked first inside
  `userHasFeature`. A beta member is entitled to every feature (including ones added
  later) with nothing to bill, until `users.betaEndsAt` passes. Because this is the
  one choke point, a lapsing beta closes every paid gate on the platform at once —
  which is the whole enforcement mechanism of the beta programme. Do **not** add
  per-feature beta checks. See [`beta-program.md`](./beta-program.md).

---

## 3. Feature keys (gating)

A `featureKey` ties a product to real gating code. Keys live in
`server/src/modules/feature-subscriptions/feature-keys.ts`:

- `FEATURE_KEYS` — the constants gating code references.
- `KNOWN_FEATURES` — the labeled list surfaced to the super-admin product form (a dropdown, so a
  product is always tied to a real gate rather than a free-text key that gates nothing).

Current gates:

- `ai_growth_strategy` → sending messages to the brand AI assistant chat.

---

## 4. Stripe sync

`server/src/modules/feature-subscriptions/stripe.ts`:

- `ensureStripeCustomerForUser` — one reusable Stripe **customer per user**, stored on
  `users.stripeCustomerId` (distinct from `users.stripeAccountId`, which is a Connect _payout_
  account).
- `ensureStripeProduct` / `ensureStripePrice` — lazily create the Stripe Product/Price the first time a
  price is needed (on checkout, or best-effort on admin save), storing `stripeProductId` /
  `stripePriceId`.
- `createFeatureCheckoutSession` — a `mode: 'subscription'` Checkout Session, `line_items` referencing
  the Stripe price, all objects tagged with `withEnvTag({ kind: 'feature_subscription', … })`.

**Stripe Prices are immutable.** An admin amount/interval change does **not** mutate a price; it
deactivates the existing `feature_subscription_prices` row and inserts a new active one (with a fresh
Stripe price minted lazily). Existing subscriptions keep billing their original price until migrated.

All objects we create are stamped with the deployment env (`modules/stripe/env-tag.ts`), so the shared
Stripe account's webhook fan-out is filtered to this environment.

---

## 5. Checkout & webhook lifecycle

Router: `server/src/routers/featureSubscriptions.ts`

- `checkout({ brandId, priceId, successUrl?, cancelUrl? })` — any brand staff member may call;
  resolves the owner as subscriber and returns a Stripe Checkout url. **Dev fallback**: with no Stripe
  key configured it inserts an `active` row directly so the flow is testable end-to-end.
- `cancel({ subscriptionId })` — sets Stripe `cancel_at_period_end` (or cancels immediately in dev).

Webhook: `server/src/modules/feature-subscriptions/webhook.ts`, dispatched from
`server/src/modules/stripe/webhook.ts` (the shared `/webhooks/stripe` endpoint):

- `checkout.session.completed` with `metadata.kind === 'feature_subscription'` →
  `handleFeatureCheckoutCompleted`: upserts the `feature_subscriptions` row (idempotent on
  `stripeSubscriptionId`) and mirrors the customer onto `users.stripeCustomerId`. This branch runs
  **before** the marketplace-purchase branch and returns early.
- `customer.subscription.updated` / `customer.subscription.deleted` (feature-tagged only) →
  `handleFeatureSubscriptionLifecycle`: updates `status`, `currentPeriodEnd`, `cancelAtPeriodEnd`,
  `canceledAt`.

---

## 6. Surfaces

- **AI gate** — `server/src/modules/ai/http.ts` (`POST /api/ai/chat`) returns `402
{ error: 'subscription_required', feature: 'ai_growth_strategy' }` when the brand owner isn't
  entitled; `routers/chat.ts#sendMessage` blocks AI-thread posts with `FORBIDDEN` (defense in depth).
- **Upsell card + composer gate** — `packages/shared/src/pages/chat/message-panel.tsx` queries
  `featureSubscriptions.aiAccess({ threadId })`; when not entitled it shows the product's upsell card
  and disables the composer. "Generate my strategy" opens the subscribe view.
- **Subscribe view** — `packages/shared/src/pages/subscribe/feature-subscribe.tsx` (`/subscribe/:slug`)
  → `featureSubscriptions.checkout` → Stripe.
- **Brand Subscriptions tab** — `packages/shared/src/pages/brand/brand-subscriptions.tsx` shows a
  "Prodesk Subscriptions" section fed by `featureSubscriptions.myForBrand({ brandId })` (the owner's
  feature subscriptions).
- **Super-admin CRUD** — `packages/shared/src/pages/super-admin/feature-subscriptions.tsx`
  (`/super-admin/feature-subscriptions`): manage products / tiers / prices.

---

## 7. Seeding

`server/src/scripts/initialize.ts` seeds **Growth Strategy** (idempotent by slug `growth-strategy`):
product (`featureKey: ai_growth_strategy` + card copy), one **Standard** tier, one **$299/month** price.

---

## 8. How to add a new feature subscription

1. Add a key to `FEATURE_KEYS` + `KNOWN_FEATURES` in `feature-keys.ts`.
2. Gate the feature on it with `brandHasFeature(db, brandId, FEATURE_KEYS.YOUR_KEY)` (or
   `userHasFeature`) wherever the feature is served.
3. In `/super-admin/feature-subscriptions`, create a product with that feature key, add tier(s) and
   price(s) (weekly and/or monthly).
4. (Optional) Add an upsell surface like the AI thread's card, reading the product's card copy.
5. **If the product is per-unit** (quantity-scaled — see §9), also add its owner-scoped quantity
   sync and wire it into `recordFeatureSubscription`. **Its zero-unit case MUST cancel via
   `cancelEmptyPerUnitSubscription` — never leave a subscription metering zero units.**

No schema change is required to add a new feature subscription.

---

## 9. Per-unit (quantity-scaled) subscriptions

Most feature subscriptions are flat (one seat, one price). A **per-unit** product
(`feature_subscription_products.perUnit = true`) instead bills `$price × quantity`, where `quantity`
is a live count the owner controls. Current per-unit products:

- **URL Shortener** (`url_shortener`) — $1 / **active short link** / month.
  `modules/feature-subscriptions/per-unit.ts`.
- **Email Signatures / SIGKITT** (`email_signatures`) — per **brand added to SIGKITT beyond the first
  (free)** / month. `modules/signatures/per-unit.ts`.

**Owner-scoped, recompute-and-set.** An owner holds at most one subscription per per-unit product; its
Stripe `quantity` equals the true billable count across **all** their brands. After any change that
moves the count (create/enable/disable/remove), the product's `sync…Quantity(db, ownerId)` **recomputes
the true count and SETs it** (never increment/decrement — that drifts). Quantity changes push to Stripe
with `proration_behavior: 'create_prorations'`, so mid-cycle increases/decreases prorate.

### The zero-unit rule (MUST follow)

Stripe **licensed prices cannot be quantity 0**, and a subscription metering zero units has nothing to
bill. So when a sync computes a billable count of **0**, it MUST **cancel the subscription** via
`cancelEmptyPerUnitSubscription(db, sub)` (in `modules/feature-subscriptions/stripe.ts`) rather than
clamp to 1 or early-return. That helper cancels in Stripe and flips our row to `canceled` immediately.

> Historical bug: the URL shortener used to early-return at zero active links, leaving a $1/mo
> subscription **billing against no links**. Fixed by routing the zero case through
> `cancelEmptyPerUnitSubscription`; the repair script below cleans up any left-over from before the fix.

**Cancel with proration — the unused days become a credit.** `cancelEmptyPerUnitSubscription` cancels
with `{ prorate: true, invoice_now: true }`. The owner paid the current month up front, so Stripe credits
the unused days as a proration; the resulting net-negative invoice lands on the owner's **Stripe customer
balance** — a store credit on `users.stripeCustomerId` (native to Stripe, currency-scoped, **no DB state
of ours**, and it survives cancellation because it lives on the Customer, not the subscription).

When they re-subscribe, Stripe **auto-applies that balance** to the first invoice. Re-subscribing is a
one-click **card-on-file** charge (`featureSubscriptions.checkout` prefers `createFeatureSubscriptionOnFile`,
which draws the credit down before charging the card) — no hosted Checkout redirect unless the card is
declined / needs SCA.

> Caveats: it's a **store credit, not a cash refund**, and the customer balance is **single-currency** — a
> credit only offsets a future invoice in the same currency (an owner is effectively always one currency,
> so this is a low-risk edge). The credit is **not shown in our UI** today; surfacing it would mean reading
> `customer.balance` on the billing page. **Verify once in Stripe test mode** that the hosted-**Checkout**
> path applies the customer balance to the first invoice — the on-file path does so by default; Checkout is
> the historically fiddly spot.

### Repair script

`server/src/scripts/cancel-empty-per-unit-subscriptions.ts` — finds active subscriptions metering zero
units and cancels them. DRY-RUN by default; `--apply` to execute. Idempotent.
