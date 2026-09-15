# Proposals

A proposal is a structured, multi-phase quote an agency builds and sends to a client (brand). It carries line items (catalog services, packages, and custom items) organized into phases, terms, attachments, a discussion thread, and a billing breakdown (pay-in-full or instalment plans). The brand reviews it, negotiates optional/removable items, accepts by paying, requests changes, or declines. Acceptance is recorded only once payment succeeds.

## Source files

- Server router: `server/src/routers/proposals.ts`
- Client list: `client/src/pages/proposals.tsx`
- Client detail / brand view: `client/src/pages/proposal-detail.tsx`
- Client builder (3-pane): `client/src/pages/proposals/builder.tsx`
- Catalog panel: `client/src/pages/proposals/catalog-panel.tsx`
- Custom-item dialog: `client/src/pages/proposals/custom-item-dialog.tsx`
- Phases editor: `client/src/pages/proposals/phases-editor.tsx`
- Billing engine (client mirror): `client/src/pages/proposals/billing.ts`
- Billing sidebar: `client/src/pages/proposals/billing-sidebar.tsx`
- Public (tokenized) view: `client/src/pages/proposals/public-proposal.tsx`
- Status labels: `client/src/lib/proposal-status.ts`
- Email/PDF HTML: `server/src/modules/email/proposal-html.ts`
- Expiry scheduling: `server/src/modules/proposals/expiry.ts`
- Server-side billing math: `server/src/modules/billing/pricing.ts`
- Schema: `server/src/db/schema.ts` (`proposals`, `proposalPhases`, `proposalItems`, `proposalDocuments`, `proposalComments`)

## Lifecycle and statuses

The proposal `status` enum is `draft | sent | viewed | accepted | rejected | expired | changeRequested`, plus the non-billable terminal `internal` (`proposals.ts:89`, schema `proposals.ts:640`). There is no `paid` status: a proposal is terminal at `accepted`, which means the brand has paid. Payment state lives on the purchase, not the proposal (`proposals.ts:87-88`).

| Status | Meaning | Set by |
| --- | --- | --- |
| `draft` | Being built; only the agency sees it | `create` |
| `sent` | Delivered to the client; awaiting open | `send` / `resend` |
| `viewed` | Client opened the sent proposal | `markViewed`, `publicByToken` side effect |
| `changeRequested` | Client asked for changes (note + per-item removal proposals) | `respond` (`requestChange`) |
| `accepted` | Client paid; proposal is closed | payment fulfillment (`fulfillPurchase`) |
| `rejected` | Client declined | `respond` (`reject`) |
| `expired` | Validity window elapsed before a decision | `expireProposal` / scheduled job |
| `internal` | Non-billable; projects created internally instead of sent | `submitInternal` |

## A. Building a proposal

### A1. The 3-pane builder

The builder (`builder.tsx:44`, route `/proposal/:id/edit`) is a three-column desktop layout (`grid lg:grid-cols-[280px_minmax(0,1fr)_320px]`, `builder.tsx:408`):

- **Left** — `CatalogPanel`: the agency's services + packages with "added" badges and an "Add custom item" entry (`builder.tsx:411-420`).
- **Middle** — `ClientDetailsSection` (client picker, title, description, validity-days), then the `PhasesEditor` (phases with reorderable line items), then `TermsSection` (terms & client notes).
- **Right** — `DocumentsSection` (attachments) above the `BillingSidebar`.

On mobile the columns collapse to a single scroll column. A top syncing bar reflects in-flight edits/refetches (`builder.tsx:371-379`).

Edits are optimistic: every mutation updates the `byId` cache immediately, rolls back on error, and reconciles via a debounced refetch (`builder.tsx:90-105`, `61-64`). Network writes are serialized into a FIFO chain so a follow-up edit can never reach the server before the INSERT it depends on (`builder.tsx:72-81`). Client-minted UUIDs are passed on create so optimistic rows share the eventual DB id (`addItem`/`addPhase` honor an optional `id` input — `proposals.ts:560`, `:497`).

Creating a proposal opens only a title dialog (`proposals.tsx:140`); on success it navigates straight into the builder (`proposals.tsx:152`).

### A2. Adding catalog services

`addItem` (`proposals.ts:554`) inserts a line item; `serviceId`, `agencyId`, `serviceType`, `billingCycle`, `isRecurring`, `upfrontFee`, variant/option/addon selections, and per-item config are all accepted. The builder passes them from the catalog:

- A service **without** options/addons is added directly (`handleAddService`, `builder.tsx:266-278`).
- A service **with** options/addons opens the shared `ServiceDetailDialog` to capture the configuration and resolved price first, then adds with `selectedVariantId` / `selectedOptions` / `selectedAddons` (`handleConfirmConfig`, `builder.tsx:282-309`).

When no `phaseId` is supplied, the item defaults to the last phase (`proposals.ts:594-601`), mirroring the builder, which always passes `lastPhaseId`.

### A3. Adding packages

`addPackage` (`proposals.ts:621`) expands a package's stored items into individual proposal items, each tagged with the package's `packageId` and `agencyId` (`:636-650`). The detail and builder views group a package's contiguous items under a single bundled header showing name, item count, and total (`groupItemEntries` + `PackageGroupView`, `proposal-detail.tsx:35-52`, `:388-405`).

### A4. Custom items

`CustomItemDialog` (opened from the catalog) collects a full custom service definition — name, description, service type, price / upfront fee / recurring fee, delivery fees, commissions, and upfront/recurring project config — and adds it as a `type: 'custom'` item (`handleAddCustom`, `builder.tsx:311-335`). Commissions are folded into the `commissions` jsonb (`productionManager` / `briefingManager` / `internalApproval`); `upfrontProjectConfig` and `recurringProjectConfig` are persisted as jsonb columns (`proposals.ts:585-586`, schema `proposals.ts:728-729`).

### A5. Phases

Proposals are organized into `proposalPhases` (name, `sortOrder`, `startDelayDays`). On `create`, a default "Phase 1" with `startDelayDays: 0` is seeded (`proposals.ts:442`). The router exposes:

- `addPhase` — defaults `startDelayDays` to 14 and names `Phase {n}` (`proposals.ts:488`).
- `updatePhase` — rename, change start delay, or re-sort (`proposals.ts:507`).
- `removePhase` — deletes the phase and reassigns its items to the first remaining phase (`proposals.ts:519-530`).
- `reorder` — persists a full flat reorder of phases + items (including item phase reassignment) in one call (`proposals.ts:533-550`).

A phase's `startDelayDays` defers **only** the recurring weekly retainer of that phase; one-off prices and setup fees are always charged at checkout (see Billing).

### A6. Section headings

`addItem` supports `type: 'heading'` with `headingText` (`builder.tsx:337-338`, default text "Section Heading"). Headings group items within a phase and are excluded from all totals (`computeSubtotals` filters `type === 'heading'`, `proposals.ts:94-98`; `recomputeTotal`, `:1359`). The detail view renders a heading as an uppercase divider row (`proposal-detail.tsx:411-413`).

### A7. Client (brand) selection and details

`ClientDetailsSection` (`builder.tsx:491`) provides a `BrandSelection` picker that selects an existing client or creates a new referral brand inline; the resolved `brandId` is persisted via `update` (`handlePickBrand`, `builder.tsx:235-243`). It also edits title, description, and validity-days. On `create`/`update`, agency and brand details are snapshotted into `agencySnapshot` / `brandSnapshot` jsonb (name, email, phone, address, logo) for the rendered document (`proposals.ts:436-437`, `:466-471`; `agencySnapshot`/`brandSnapshot` helpers `:1336-1348`).

### A8. Terms and notes

On `create`, `termsAndConditions` is pre-filled with a 7-clause default template parameterized by validity days (`DEFAULT_TERMS`, `proposals.ts:153-160`, applied at `:432`). `TermsSection` (`builder.tsx:545`) edits terms and `clientNotes`; `update` accepts `termsAndConditions`, `paymentTerms`, `clientNotes`, `internalNotes`, and `validityDays` (`proposals.ts:446-460`). The detail view renders terms when present (`proposal-detail.tsx:295-300`).

### A9. Documents / attachments

`DocumentsSection` (`builder.tsx:565`) uploads a file (or pastes a URL), lets the buyer rename it, and adds via `addDocument` (`proposals.ts:699`). Each added document is also mirrored into the brand's locker (Agency Documents) when the proposal has a brand + agency (`recordLockerFile`, `proposals.ts:714-729`). `removeDocument` deletes it (`:733`). `byId` and `publicByToken` both fetch documents (`:248`, `:300`); the detail view shows them as an "Attachments" card (`proposal-detail.tsx:302-316`).

### A10. Validity and expiry

`validityDays` defaults to 30 (`create`, `proposals.ts:407`). On `send`/`resend`, `expiresAt` is set to now + validity days and an expiry job is scheduled (`scheduleProposalExpiry`, `proposals.ts:777-782`, `:901-906`). `convertToPurchase` lapses a past-due proposal before allowing payment (`expireProposal`, `:1110-1112`).

## B. Sending, responding, accepting, converting

### B1. Send

`send` (`proposals.ts:762`) requires a brand and at least one non-heading item, otherwise it throws (`:764-768`). It recomputes the total, sets `status: 'sent'`, `sentAt`, clears any `changeRequestNote`, sets `expiresAt`, enqueues the `proposal-sent` email, schedules expiry, and fires task generation (`:769-784`). The builder's Send button is disabled until a brand and ≥1 non-heading item exist (`builder.tsx:401`).

### B2. Non-billable submit

When a proposal is toggled non-billable (`isBillable: false`, `builder.tsx:388-397`), the action becomes "Create projects": `submitInternal` (`proposals.ts:797`) creates one internal purchase (written PAID) plus one internal project per item-quantity unit, seeded at `brief`, and marks the proposal `internal` (`:875-880`). No client charge occurs; the agency pays contractors during fulfillment.

### B3. Mark as viewed

A brand opening a `sent` proposal auto-marks it `viewed`. The detail page calls `markViewed` on open (`proposal-detail.tsx:115-118`), and `markViewed` (`proposals.ts:912`) flips `sent → viewed`, setting `viewedAt`. The public tokenized fetch does the same as a side effect (`publicByToken`, `:309-315`).

### B4. Brand negotiation (optional exclusions and removal proposals)

The brand view is interactive when the proposal is `sent`/`viewed` (`brandEditable`, `proposal-detail.tsx:112`):

- **Optional items** can be toggled off (a checkbox); excluded items dim and drop out of the sidebar total (`toggleExclusion`, `proposal-detail.tsx:135-138`; `effectiveItems` reflects local exclusions, `:127-131`).
- **Non-optional items** can be flagged "Propose removal" (`toggleRemoval`, `:139-142`), shown struck-through with a "Removal proposed" badge.

A hint reads "Toggle off optional items or propose removal of others" (`proposal-detail.tsx:274`). Exclusions are persisted at payment (`convertToPurchase` `excludedItemIds`, `proposals.ts:1117-1128`); removal proposals are persisted on a change request (below). Schema columns: `isOptional`, `isExcludedByBrand`, `removalProposedByBrand` (`proposals.ts` schema items).

### B5. Request changes

The brand opens a "Request changes" dialog (`proposal-detail.tsx:373-383`) and submits a note plus any proposed removals. `respond` with `action: 'requestChange'` (`proposals.ts:935`) persists `removalProposedByBrand` per item, sets `status: 'changeRequested'` + `changeRequestNote`, posts the note as a `brand` comment, enqueues `proposal-change-requested`, and fires task generation (`:975-1000`). The agency sees a change-request banner with "Resend as-is" and an "Edit & resend" action (`proposal-detail.tsx:254-262`, `:249`). `resend` (`proposals.ts:885`) clears the brand negotiation flags, clears the note, and re-sends.

### B6. Decline

`respond` with `action: 'reject'` (`proposals.ts:964-972`) sets `status: 'rejected'`, `decidedAt`, enqueues `proposal-rejected`, and fires task generation. The brand confirms via a destructive dialog (`decline`, `proposal-detail.tsx:216-225`).

### B7. Accept → payment → conversion

Acceptance is **not** a status flip; the brand "accepts" by paying. The detail page's Accept flow (`accept`, `proposal-detail.tsx:178-215`):

1. `convertToPurchase` (`proposals.ts:1093`) persists optional-item exclusions, builds payable amounts from the kept (non-excluded, non-heading) items applying any selected payment plan, discards any stale unpaid pending purchase for this proposal, snapshots platform commission rates, and writes a `pending_purchases` row.
2. `checkoutPurchase` returns the Stripe hosted-checkout URL; the tab redirects there. In dev without Stripe it fulfils immediately and routes to `/payment-success`.
3. The proposal flips to `accepted` only when payment succeeds (`fulfillPurchase`).

`convertToPurchase` is idempotent for the brand: re-clicking Accept rebuilds the pending purchase rather than orphaning one (`proposals.ts:1196-1199`). It gates on an open (`sent`/`viewed`) proposal and lapses an expired one first (`:1110-1115`).

### B8. Payment-plan selection

The billing sidebar lets either the building agency or the reviewing brand pick a payment plan. `setPaymentPlan` (`proposals.ts:1294`) persists `selectedPaymentPlan` on the proposal (allowing either party), so the choice survives navigation/refresh and is carried into `convertToPurchase` (`:1141`, `:1219-1222`). Pass `null` for pay-in-full.

### B9. Duplicate

`duplicate` (`proposals.ts:1004`) clones a proposal with a "(Copy)" title as a fresh `draft`, deep-copying phases (with id remapping) and items (resetting brand negotiation flags), then recomputes the total (`:1058-1071`). Available from both detail and builder (`proposal-detail.tsx:247`, `builder.tsx:398`).

### B10. Delete draft

`delete` (`proposals.ts:1076`) removes a proposal. The builder shows a "Delete draft" button (with confirm) only for `draft` status (`builder.tsx:399`).

## C. Data model

### C1. Comment author roles

`addComment` (`proposals.ts:743`) accepts `authorRole` of `brand | agency | sales`; the column is `proposalComments.authorRole`, typed by the `party_side` pgEnum which is `['brand', 'agency', 'sales']` (schema `proposals.ts:170`, `:759`). The detail view posts `agency` or `brand` based on the viewer (`proposal-detail.tsx:333`).

### C2. Item fields

`proposalItems` carries the full custom/service shape: `serviceId`, `packageId`, `agencyId`, `serviceType`, `deliverableFrequency`, `repeatsEvery`, `projectDurationDays`, `upfrontFee`, `upfrontDeliveryFee`, `recurringDeliveryFee`, `isRecurring`, `billingCycle`, variant/option/addon selections, a `commissions` jsonb, and `upfrontProjectConfig` / `recurringProjectConfig` jsonb (schema `proposals.ts:696-735`). These are frozen onto pending-purchase items and internal projects at conversion (`proposals.ts:1271-1278`, `:849-860`).

### C3. Sales / inter-agency proposals

A sales agency can build a proposal spanning services from multiple agencies. `create` stamps `createdBySalesAgencyId` if the building agency has `isSalesAgency` (`proposals.ts:410`, `:422`, `:435`). Each item carries its source `agencyId`; `recomputeTotal` keeps `agencyIds[]` in sync (`:1366-1371`). In the builder, only the sales agency's own items are price-editable; partner lines display their source agency's name + logo (`withAgencyInfo`, `proposals.ts:56-61`; `salesMode`, `builder.tsx:261`). There is no per-proposal toggle — it's purely the building agency's status.

### C4. Money handling

`amount` / `totalAmount` / fee columns are Postgres `money`; the router converts inputs via `toMoney` and reads via `Number(...)` (`proposals.ts:608-611`). `recomputeTotal` stores `totalAmount` as the one-off subtotal of non-heading items; `convertToPurchase` overwrites it with the true due-today figure (`:1194`).

### C5. Invoice numbers

`generateInvoiceNumber` produces a per-agency sequential `INV-{year}-{0001}` (`proposals.ts:1381-1387`), stamped when a proposal is accepted on payment. The detail header shows `invoiceNumber` when present (`proposal-detail.tsx:240`).

## D. List views

`proposals.tsx` pulls a full page (limit 100) and groups rows client-side into status sections, differing for agency vs brand views (`:57-102`):

- **Changes Requested** (warn), shown to both.
- **Drafts** — agency only.
- **Pending** (sent + viewed) — brand only.
- **Sent**, **Viewed** — agency only.
- **Accepted & Paid** (success), shown to both.
- **Internal (Non-billable)** — agency only.
- **Declined / Expired**, shown to both.

Each row is a card with a status badge and a `$upfront + $weekly per week` price summary derived from the line items (`proposalRowPrice`, `:36-38`). The server-side `list` (`proposals.ts:164`) enriches each row with `upfrontTotal` / `weeklyTotal` from its items (`:192-209`) and never returns drafts to brands (`:181-183`). `attentionCount` (`:219`) powers the nav badge: for brands, `sent` proposals; for agencies, `changeRequested` proposals.

## E. Real-time and tokenized access

Updates reconcile through React Query invalidation on mutation (no live subscription). A proposal can be opened publicly via a signed token embedded in the "View & Accept Proposal" email link: `publicByToken` (`proposals.ts:292`) returns the proposal read-only to a recipient who may not yet have an account, flips `sent → viewed`, and reports whether the referral brand is still claimable. `connectViaToken` (`:340`) attaches the proposal to the signed-in recipient — either claiming the agency's referral brand or re-pointing it at a brand the user already controls — gated so a decided proposal can't be re-attached.

## F. Notifications

- `send` / `resend` enqueue `proposal-sent` (`proposals.ts:781`, `:905`).
- `respond` enqueues `proposal-rejected` (`:970`) or `proposal-change-requested` (`:998`).
- Every status change (`sent`, `viewed`, `rejected`, `changeRequested`, `internal`) fires `notifyProposalStatus` → `onProposalStatusChanged` for in-app task generation, best-effort (`proposals.ts:63-85`, `onProposalStatusChanged` in `tasks.ts`).

## G. Document rendering (PDF / email)

`pdf` (`proposals.ts:264`) returns the rendered proposal HTML — the exact same document the `proposal-sent` email sends, since both call `generateProposalEmailHtml` (`server/src/modules/email/proposal-html.ts`). The rendered HTML embeds the same signed "View & Accept Proposal" link the email carries. The client renders it in a print window via `printHtmlDocument` so the browser saves it as PDF (`pdf` mutation, `proposal-detail.tsx:89-93`, `:246`). Agency/brand snapshot fields populate the document header.

## Billing engine

The billing math is mirrored on both sides — client (`client/src/pages/proposals/billing.ts`) for the live sidebar, server (`server/src/modules/billing/pricing.ts` + `proposals.ts`) for the charged totals — so what the brand sees can't drift from what Stripe charges.

- **Subtotals** (`computeSubtotals`): excludes headings (and optionally brand-excluded items) and splits items into one-off subtotal, recurring upfront (setup) total, and recurring weekly total (`billing.ts:46-56`, `proposals.ts:93-109`).
- **Pay-in-full** (`computePayInFull`): upfront = recurring setup + one-off total; weekly-after = recurring weekly (`billing.ts:77-79`).
- **Payment plan** (`computePaymentPlan`): one-off total accrues flat interest, splits into a deposit (`upfrontPercentage`) plus equal weekly instalments over `durationWeeks`; recurring items ignore the plan (`billing.ts:81-101`).
- **Phase-aware schedule** (`computePaymentSchedule`, `billing.ts:149-226`): produces "due today" with labelled parts and a collapsed weekly timeline. Recurring items bill weekly from their phase's start week (immediate phase = week 1; a phase delayed by `d` days first bills in `round(d/7)+1`). One-off instalments run for `durationWeeks`. A delayed phase defers only its recurring weekly — its one-off price and setup fee are still due today.
- **Conversion** (`proposalItemAmount` + `convertToPurchase`, `proposals.ts:134-151`, `:1093`): each item gets a rich one-off-vs-recurring `amount` snapshot (the same shape the marketplace writes), so recurring items become Stripe subscription lines and one-off items under a plan split into a deposit + weekly instalments. Due-today and weekly totals are summed from these per-item amounts so the stored figures and Stripe lines stay consistent.
- **Settings** (`billingSettings`, `proposals.ts:391`): exposes `defaultPaymentPlans` and the agency/affiliate/sales-agency commission rates to the sidebar, which also summarizes the agency's earnings/commission for a sales proposal (`computeAgencyCommissionPct`, `billing.ts:230`).

The proposal's stored `totalAmount` reflects the full pay-in-full one-off subtotal until conversion, at which point it is set to the amount due today; the selected plan only changes the deposit/schedule, not the full proposal value.
