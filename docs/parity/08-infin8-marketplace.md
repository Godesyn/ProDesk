# infin8 Marketplace

The infin8 Marketplace is Prodesk's services marketplace, where a brand discovers
and buys agency services along the **infin8 8-stage framework**. This document is
the authoritative specification of its behaviour across the client (React + wouter
+ TanStack Query), the tRPC API, and the Drizzle/Postgres data model.

---

## Core concepts

- **infin8 framework** — a taxonomy of stages, each with sub-steps (disciplines).
  The taxonomy is admin-editable and stored as `globalSettings.infin8Stages`
  (`jsonb`, shape `{ stage: string; substages: string[] }[]`,
  `server/src/db/schema.ts:1447`), making it the single source of truth for stage
  ordering. Every `services` row carries a `stage` and `subStage`; the marketplace
  groups services into `stage → subStage`, so a brand "incubates → creates →
  fabricates" its business by buying services along the framework.
- **Services** — individual purchasable units (one-off or recurring/weekly billed),
  grouped by stage/sub-stage, sold by agencies. Configurable via variants, options,
  and add-ons.
- **Packages** — curated bundles of services (`packages` table), surfaced as a
  horizontally-scrolling "Featured Packages" rail. Adding a package adds each of
  its component services to the cart as a grouped line sharing a `packageId` /
  `packageName`, each pre-configured with the package author's chosen
  variant/options/add-ons.
- **Referred / default agency visibility** — a brand sees its **referred agency**'s
  services plus the platform **default ("verified") agency**'s services first.
  The referral lives on the brand **owner**'s user (`users.referredByAgencyId`),
  never on the brand itself.

---

## Routes (`client/src/App.tsx:278-290`)

| Path | Component | Purpose |
| --- | --- | --- |
| `/marketplace` | `MarketplacePage` (`client/src/pages/marketplace.tsx`) | Stage-grouped browse, favourites, order history |
| `/marketplace/checkout` | `MarketplaceCheckoutPage` (`client/src/pages/marketplace/checkout-page.tsx`) | Itemised cart + billing sidebar |
| `/marketplace/agency/:agencyId` | `AgencyStorefrontPage` (`client/src/pages/marketplace/agency-storefront.tsx`) | Single-agency storefront |
| `/checkout/:id` | `CheckoutPage` (`client/src/pages/checkout.tsx`) | Kick off payment for an existing pending purchase |
| `/payment-success` | `PaymentResultPage` (`client/src/pages/checkout.tsx`) | Status-aware landing; polls until fulfilled |
| `/post-checkout/:purchaseId` | `PostCheckoutStepperPage` (`client/src/pages/marketplace/post-checkout-stepper.tsx`) | Per-project brief stepper |

---

## Browse screen (`client/src/pages/marketplace.tsx`)

A `PageHeader` titled **"infin8 Marketplace"**, a row of view chips
(Services / Favourites(+count) / Order history) with a Cart button on the right, a
full-width search field, and a Filters popover (discipline + sort, plus an "Invite
Agency" action).

### Stage-grouped IA

When not searching, the Services view renders the framework IA
(`marketplace.tsx:313-356`):

1. **Featured Packages rail** — a card with a purple accent bar and a horizontal
   `CardRail` of `PackageCard`s (`marketplace.tsx:316-328`), shown when packages
   exist.
2. **One section per stage** — a white, rounded, shadowed card per stage. The
   header shows the stage name, an "N Services" pill, and a rotating chevron.
   Expanding reveals one row per sub-stage, each a horizontal `CardRail` of
   `ServiceCard`s. Stage open/closed state is tracked in `expandedStages`.

While searching, the view collapses to a flat responsive result grid
(`grid sm:grid-cols-2 lg:grid-cols-3`, `marketplace.tsx:303-311`).

### `marketplace.browse` (`server/src/routers/marketplace.ts:66-203`)

Public query returning active, buyable services across verified agencies.

- **Filters:** `isNull(deletedAt)`, `isActive`, `allowBuyNow`, agency
  `emailVerified`. Optional `search` (ILIKE across service name, service
  description, and agency `businessName` — `marketplace.ts:90-98`), `discipline`
  (matches the `services.disciplines` array via `= ANY`), `stage`, `subStage`,
  `agencyId`.
- **Referred / default visibility** (`marketplace.ts:104-124`): with a `brandId`
  and no explicit `agencyId`, the brand sees only its referred agency's services
  plus `platformVerified` agencies' services. With no referred agency, the view
  is the default (`platformVerified`) agencies alone.
- **Sort** (`marketplace.ts:128-148`): `custom` (referred agency first, then
  default agency, then `sortOrder`, then name), `priceAsc`, `priceDesc`, `name`,
  `newest`.
- **Response:** flat paginated `items` (each annotated with `agencyName`,
  `agencyLogo`, `isReferredAgency`, `isPlatformVerifiedAgency`) **plus** a
  `stages` roll-up (`stage → { count, subStages[] }`, ordered by the
  `globalSettings.infin8Stages` index, unknown stages last) so the client renders
  the grouped grid without a second round-trip, plus `referredAgencyId`.

### Supporting queries

- `marketplace.framework` (`marketplace.ts:44-47`) — the live stage→substage
  taxonomy from `globalSettings.infin8Stages`.
- `marketplace.disciplines` (`marketplace.ts:50-53`) — platform disciplines for
  the filter dropdown, from `globalSettings.disciplines`.
- `marketplace.packages` (`marketplace.ts:220-234`) — active "Featured Packages"
  across verified agencies (optionally one agency).

---

## Agencies & storefront

- `marketplace.agencies` (`marketplace.ts:283-330`) — verified-agency listing
  honouring the same referred/default visibility as `browse`: the brand sees only
  the default agencies plus its referred agency, ordered referred-first then
  default-first then alphabetical. Each card carries `platformVerified`,
  `isReferredAgency`, and a live `serviceCount`.
- **Agency storefront** (`AgencyStorefrontPage`,
  `client/src/pages/marketplace/agency-storefront.tsx`) — the drill-down for one
  agency: its searchable + sortable service grid (via `browse` scoped by
  `agencyId`) plus its featured packages, sharing the cart and service-detail
  dialog.
- **Invite Agency** (`InviteAgencyDialog`, `marketplace.tsx:365-409`) — emails a
  prospective agency an invitation via `auth.sendAgencyInvite`, with a success
  state once enqueued.

---

## Service detail (`client/src/pages/marketplace/service-detail-dialog.tsx`)

A full-screen modal (`ServiceDetailDialog`) with a media panel sized to the
cover's aspect ratio on the left (image / inline video / placeholder via
`DetailMedia`) and a scrollable right column: header badges (agency, type),
name, description, a "What's Included" disciplines list, a price box, option
dropdowns, add-on tiles, and a quantity stepper.

- **Variants / options / add-ons:** `service.options` render as dropdowns;
  the selected variant is resolved by matching its option map
  (`service-detail-dialog.tsx:85-91`). `service.addons` render as selectable
  tiles showing signed price deltas (`+$100 and +$10 / wk`). Price recalculates
  live via `priceLine` (`client/src/pages/marketplace/pricing.ts`).
- **Validation:** every option must be chosen before Buy / Add to cart / Confirm
  (`validateOptions`, `service-detail-dialog.tsx:120-128`).
- **Action bar**, gated on service flags:
  - `allowBuyNow` → **Purchase Now** (buy a single configured line, skipping the
    cart) and **Add to cart**.
  - `allowBookMeeting` → **Book Sales Meeting** (`BookMeetingDialog`).
  - `onSelectConfiguration` (proposal/config flow) → **Confirm Configuration**,
    which replaces the purchase CTAs.
  - When opened from the agency catalog (`isFromCatalog`), purchase CTAs are
    suppressed and a "Copy integration prompt" action is exposed.
- `marketplace.serviceById` (`marketplace.ts:206-217`) supplies full detail
  (variants / options / add-ons / gallery) when needed.

---

## Cart (`client/src/pages/marketplace/cart-store.tsx`)

The cart is persisted **client-side in `localStorage`, keyed per brand**
(`prodesk.cart.{brandId}`). It supports add / remove / update-quantity,
configurable de-duplication, package grouping, and per-item minimum quantity.

- **De-duplication key** (`lineKey`, `cart-store.tsx:37-53`): a line is identified
  by `serviceId | selectedVariantId | sorted options | sorted addon ids |
  packageId`. Adding a matching configuration increments quantity; a different
  configuration is a new line.
- **Minimum quantity:** package items can enforce a floor; `add` and `setQuantity`
  clamp to `minQuantity` (`cart-store.tsx:143,163`).
- **Persistence:** write-through — every mutation updates state and `localStorage`
  in one step (no lagging `useEffect`, which previously wiped the saved cart on
  refresh under StrictMode — `cart-store.tsx:101-119`).
- **Cross-tab sync:** a `storage` listener reflects changes from other tabs
  (notably the payment-success tab clearing the cart after a confirmed payment —
  `cart-store.tsx:87-99`).
- Adding from a card pops the cart drawer open (`CartDrawer`), mirroring the
  auto-opening cart panel UX (`marketplace.tsx:72-76`).
- `removePackage` removes all lines sharing a `packageId`.
- `useCartOptional` returns `null` outside a `CartProvider`, so cart-aware
  components (cards, the detail dialog) can be reused on non-buying pages (e.g. the
  agency catalog) with their add paths guarded.

---

## Checkout (`client/src/pages/marketplace/checkout-page.tsx`)

`MarketplaceCheckoutPage` renders a two-column layout: an itemised cart on the
left and a **billing sidebar** on the right.

- **Itemised cart:** each line shows the service image, name, package/recurring
  badges, agency, quantity, and its one-off + recurring-upfront total (plus a
  `/wk` line for recurring items).
- **Billing summary** (`checkout-page.tsx:137-177`): one-off subtotal, recurring
  setup, recurring weekly, then payment-plan chips, then a "Due today" total with
  weekly-during / weekly-after-plan rows. Computed client-side from the cart via
  `computeSubtotals` / `computePayInFull` / `computePaymentPlan`
  (`client/src/pages/marketplace/pricing.ts`).
- **Payment plans:** `marketplace.paymentPlans` (`marketplace.ts:333-337`) returns
  the active plans from `globalSettings.defaultPaymentPlans`. The chips offer
  "Pay in full" plus each plan; the selected plan is sent with the purchase.
- **Submit** fires `purchases.checkoutServices`, reserving the Stripe tab against
  the click (`reserveNewTab`) so the popup blocker allows it. The cart is **never**
  cleared here — only a confirmed payment clears it.

### `purchases.checkoutServices` (`server/src/routers/purchases.ts:96-210`)

Buys a cart of services (with variants / options / add-ons / quantity / package
grouping) under an optional payment plan.

1. Resolves each item's service, builds `CartLineInput`s, and computes split
   billing via `computeSubtotals` (one-off subtotal, recurring upfront total,
   recurring weekly total) and either `computePaymentPlan` or `computePayInFull`
   (`purchases.ts:121-123`).
2. Computes per-item amount snapshots (`computeLineAmount`) as the source of truth
   for what Stripe charges; the purchase-level `dueToday` and `weekly` are summed
   from them so the stored totals and Stripe lines can never drift
   (`purchases.ts:129-131`).
3. Snapshots the platform commission rates (`globalSettings`) at purchase time so a
   later rate change can't retroactively alter this order's payouts
   (`purchases.ts:135`).
4. Writes a **pending** purchase + items to `pending_purchases` (NOT `purchases`),
   each item carrying a frozen snapshot of its service config, the rich one-off /
   recurring amount split, selected variant/options/add-ons, per-role commissions,
   delivery fees, and project configs (`purchases.ts:139-207`).
5. Calls `startCheckout`.

### `startCheckout` (`purchases.ts:233-246`)

- **With Stripe:** `createCheckoutSession` returns a hosted checkout URL.
- **Without Stripe (dev):** promotes the pending purchase into `purchases` and
  fulfils it immediately, so the flow is testable end-to-end.

`purchases.checkoutPurchase` (`purchases.ts:213-224`) starts payment for an
existing pending purchase (e.g. one created from an accepted proposal), surfacing
its status idempotently if it was already paid.

### Stripe session (`server/src/modules/billing/recurring.ts`)

`createCheckoutSession` builds the line items per purchase item from the frozen
`amount` snapshot via `buildCheckoutLineItems`
(`server/src/modules/billing/subscription.ts`):

- **Pure one-off orders** → `mode: 'payment'` (single charge of the one-time
  lines).
- **Orders with any weekly component** (forever retainer OR payment-plan
  instalment) → `mode: 'subscription'`: each weekly fee becomes its own recurring
  subscription item (its own metadata-tagged product, so a single project can be
  cancelled later without killing the subscription), while the one-time
  (upfront/setup/deposit) lines ride along on the first invoice. A **7-day trial**
  defers the first weekly charge a week, so checkout collects only the one-time
  amount; later weekly invoices fire `invoice.payment_succeeded` →
  `advanceRecurringCycle`. Instalment plans auto-cancel after `durationWeeks`
  renewals (`recurring.ts:13-21,48-49`).

---

## Payment result & brief stepper

### Payment result (`PaymentResultPage`, `client/src/pages/checkout.tsx:44-106`)

On success, polls `marketplace.briefProjects` every ~1.5s until the purchase is
fulfilled (`ready`), showing a "Verifying payment…" → "Payment successful" →
forward state. Once `ready`, it clears the brand's cart (`clearCartStorage`) and
navigates to `/post-checkout/:purchaseId`. On cancel, shows "Payment cancelled · No
charge was made."

### Brief stepper (`PostCheckoutStepperPage`, `client/src/pages/marketplace/post-checkout-stepper.tsx`)

Polls `marketplace.briefProjects` until projects exist, then walks the buyer
through each project's custom-field brief in a step list. If no project needs a
brief, it forwards straight to projects.

- Each project's fields render via the Info Hub field renderer
  (`SpotComponentView` + `briefFieldDef`/`toSpotQuestion`), honouring every
  configured type (selects, dates, uploads, colour palettes, addresses).
- Required-field validation, Save & continue / Back / Skip-for-now, per-step
  progress chips. Each step submits via `projects.submitBrief`
  (`post-checkout-stepper.tsx:83-103`).

### `marketplace.briefProjects` (`marketplace.ts:374-400`)

Poll-until-ready endpoint: returns the purchase `status`, a `ready` flag
(`completed` or projects exist), and the projects still in `clientBrief` status
with their custom fields. Treats a momentarily-missing purchase as "still being set
up" rather than throwing. Access is allowed to the buyer (including an agency that
bought on behalf of a connected brand) and otherwise gated via
`assertBrandViewAccess`.

---

## Favourites

- `marketplace.favourites` (`marketplace.ts:342-346`) — the brand's favourite
  service ids (`brands.favouriteServiceIds`, `uuid[]`).
- `marketplace.toggleFavourite` (`marketplace.ts:353-365`) — toggles a service in
  the list, returning the resulting ids.
- `marketplace.favouriteServices` (`marketplace.ts:403-414`) — the full service
  rows for the favourites view.
- The Favourites view (`marketplace.tsx:411-444`) renders a grid of `ServiceCard`s
  with heart toggles; the chip shows a live count. A brand must be selected to save
  favourites.

---

## Order history (`client/src/pages/marketplace/order-history.tsx`)

The Order history view lists the brand's **completed** purchases. Each card shows a
MARKETPLACE / PROPOSAL badge, date, a status badge (status → colour map at
`order-history.tsx:10-18`), per-item lines, and a total. A recurring item shows its
one-time setup plus `/wk` (e.g. `$100 setup + $10/wk`), since the weekly is billed
separately each cycle.

- `purchases.list` (`server/src/routers/purchases.ts:53-79`) — paginated history
  for a brand, **excluding** internal purchases (`isInternal`) and purchases not
  `viewableToBrand`; attaches each purchase's item lines.
- `purchases.byId` (`purchases.ts:81-87`) — a single purchase with its items,
  gated by `assertBrandAccess`.

---

## Fulfilment & payouts (`server/src/modules/billing/fulfillment.ts`)

### `fulfillPurchase` (`fulfillment.ts:1180-1328`)

Fulfils a paid purchase, idempotently (no-op if already `completed` or if projects
already exist):

1. Spawns one project per non-heading, non-excluded line item. Quantity → one
   project per unit for marketplace buys (`projectsPerItem`); proposals spawn one.
2. A service carrying custom fields lands its project in `clientBrief` (routing the
   buyer to the brief stepper); otherwise `upcoming`. Brief answers are frozen onto
   the project.
3. Digital products auto-deliver: the file is attached as an approved deliverable
   and emailed (`fulfillment.ts:1266-1284`).
4. Delayed phases are scheduled to activate exactly at their phase start
   (`scheduleProjectCycle`).
5. Connects the brand to every agency it transacted with (each service's agency
   plus the proposal sender), provisioning each agency's Info Hub sections.
6. Marks the purchase `completed`, generates payouts, and (for proposal purchases)
   marks the proposal accepted.

### Commission split (`computePayoutSplit` / `runPayoutSplit`)

Each item's gross is split by global rates (prodesk / agency / affiliate / sales),
service-level manager percentages (production / briefing / internal-approval), and
agency salesperson percentage, with full per-scenario routing
(self-sent proposal vs different-agency proposal vs marketplace) defined in
`docs/commissions.md` as the single source of truth. Each role resolves to a
beneficiary (designee staff → owner fallback; affiliate → referring user; sales →
sender / referred-by agency; prodesk → super admin as the remainder), and
breakdowns are grouped into one payout per beneficiary **per project**. The split
function is pure (no DB writes) and is shared by the live writer and the
future-earnings predictor, so a forecast can never drift from a real payout.

- **Payout dates** (`payoutFriday`, `fulfillment.ts:73-89`): every tier waits a
  14-day refund buffer, then the first Friday on/after, anchored to 00:00 Brisbane.
- **Recurring cycles** (`generateCyclePayouts`, `fulfillment.ts:312-338`): each
  weekly subscription renewal splits that week's recurring fee, driven by
  `advanceRecurringCycle` from the `invoice.payment_succeeded` webhook.
- **Payment-plan reimbursement** (`generateReimbursementPayouts` +
  `reimbursementGrossForItem`, `fulfillment.ts:228-305`): a payment-plan one-off
  defers the non-priority (platform/affiliate/sales) cut to the reimbursement
  cycles, spread across instalments starting at `REIMBURSEMENT_CYCLE` (5); the
  total non-priority paid equals the single-lump amount, only the timing spreads.
- **Invoices:** the split also emits commission invoices (brand→prodesk charge,
  agency-retained, per-designee, sales/affiliate legs), each gated so every
  document is written exactly once over the lifecycle (`fulfillment.ts:899-1003`).
- Internal purchases (`isInternal`) generate no payouts or commission invoices —
  the single chokepoint for every payout writer (`fulfillment.ts:401`).

---

## Data model (`server/src/db/schema.ts`)

| Field | Location | Purpose |
| --- | --- | --- |
| `globalSettings.infin8Stages` | `schema.ts:1447` | The stage→substage framework taxonomy (`jsonb`) |
| `globalSettings.disciplines` | `globalSettings` | Platform disciplines for the filter |
| `globalSettings.defaultPaymentPlans` | `globalSettings` | Active payment-plan configs |
| `agencies.platformVerified` | `schema.ts:347` | Default/verified agency → verified mark + ordering |
| `agencies.rejectionReason` | `schema.ts:347` | Reason given when a super-admin denies agency verification |
| `users.referredByAgencyId` | `schema.ts:270` | Brand owner's referred agency (drives visibility + sales cut) |
| `brands.favouriteServiceIds` | `schema.ts:412` | Brand's favourited service ids (`uuid[]`) |
| `services.allowBuyNow` / `allowBookMeeting` | `schema.ts:558-559` | Gate the detail-dialog action bar |
| `packages.allowBuyNow` / `allowBookMeeting` | `schema.ts:623-624` | Package buy/book gating |
| `services.stage` / `subStage` | `services` | The framework slot a service occupies |
| `purchaseItems.selectedVariantId` / `selectedOptions` / `selectedAddons` | `purchase_items` | Frozen configuration per line |
| `purchaseItems.amount` | `purchase_items` | Frozen one-off/recurring split snapshot (drives Stripe lines + cycle payouts) |
| `purchaseItems.commissions` / `salesPersonCommissions` | `purchase_items` | Frozen per-role commission snapshot |

The shopping cart has no DB table; it is persisted client-side per brand
(see Cart above).
