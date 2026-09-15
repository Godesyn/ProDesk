# Earnings, Payouts, Invoices & Account Settings

Canonical behavior for the money-facing surfaces a member sees: their earnings/payout
history, the invoices they are billed or owed against, and the account-settings screen
where they manage identity, security, payout methods, and integrations.

Surfaces:

- **Earnings** — `client/src/pages/earnings.tsx` + `client/src/pages/earnings/*`
- **Invoices** — `client/src/pages/invoices.tsx`, `client/src/pages/invoices/invoice-detail.tsx`
- **Account settings** — `client/src/pages/profile.tsx` + `client/src/pages/profile/*`
- **Routers** — `server/src/routers/{payouts,invoices,users}.ts`
- **Billing modules** — `server/src/modules/billing/{payout-readiness,predict-earnings,invoice-parties,wise,payout-providers}.ts`
- **Schema** — `server/src/db/schema.ts`

Routes (`client/src/App.tsx`): `/earnings` → `EarningsPage`; `/invoices` and
`/agency-invoices` → `InvoicesPage`; `/invoices/:id` → `InvoiceDetailPage`;
`/super-admin/invoices` → `AdminInvoicesPage`; `/profile` → `ProfilePage`.

---

# Earnings / Payouts

`EarningsPage` (`earnings.tsx`) is the member's view of their disbursements, split into
**Past Earnings** and **Future Earnings** tabs. The page header reads "Earnings
Overview" with the description "Your payouts and disbursement history." (`earnings.tsx:69-70`).

## Data scope and role resolution

Payout queries are role-scoped server-side by `scopeForUser` (`payouts.ts:36-55`), which
resolves the filter set from the current user's role plus the optional `agencyId`:

| Viewer | Scope filter | `payouts.as` |
| --- | --- | --- |
| Super-admin (own payouts) | all rows where `as = 'admin'` | `admin` |
| Individual contractor | `beneficiaryId = me` | `contractor` |
| Agency staff | `agencyId = selected` (else `beneficiaryId = me`) | `staff` |
| Agency owner | `beneficiaryAgencyId = selected` (else `beneficiaryId = me`) | — |
| Brand / fallback | `beneficiaryId = me` | — |

Agency receipts land on the agency itself (`beneficiaryAgencyId`), not the owner user, so
owner scope keys on the agency. When an `agencyId` is supplied it is validated with
`assertAgencyAccess(ctx, agencyId, 'bankAccount')` (`payouts.ts:73`).

Super-admins instead see the platform-wide set via `payouts.allList` (a
`superAdminProcedure`, `payouts.ts:90-110`) and may filter by a single beneficiary. The
client selects `allList` when `user.isSuperAdmin`, otherwise the role-scoped `list`
(`earnings.tsx:27-33`). Both fetch up to 500 rows (no server pagination UI) and the
client splits past/future locally.

## Past vs Future split

The client derives the two tabs from one fetch plus a prediction (`earnings.tsx:39-50`):

- **Past** = rows with status `paid` or `received`.
- **Future** = unpaid past rows (status rewritten to `upcoming`) merged with the
  predicted future payouts, sorted ascending by `toPayAt ?? createdAt`.

The default tab is **Future** (`earnings.tsx:22`).

### Future-earnings prediction

`payouts.predictFutureEarnings` (`payouts.ts:186-215`) forecasts upcoming earnings,
delegating to `predictForViewer` (`server/src/modules/billing/predict-earnings.ts`). It
runs two tracks (see `docs/future-earnings.md`): a contractor budget per deliverable
cycle, and every other role per weekly billing cycle simulated through the real
commission calculator so the forecast tracks live payouts (including payment-plan
deferral and spread reimbursement). Scope mirrors `list`:

- Super-admin with `everyone: true` → `mode: 'everyone'`.
- Agency owner/staff with an agency → `mode: 'agency'`, `viewerFilter` owner/staff
  (gated by `assertAgencyAccess`).
- Contractor / fallback → `mode: 'contractor'` (assigned recurring projects).

## Tab body (`EarningsContent`, `earnings-content.tsx`)

Each tab renders three stat cards, an Earnings Trend chart, and the day-grouped payout
history. Desktop puts stats and chart side-by-side (1:3 / 2:3); narrower viewports stack
them.

**Stat cards** (`earnings-content.tsx:73-123`) — time-windowed totals over the tab's rows:

| Card | Window (past tab) | Window (future tab) | Icon / color |
| --- | --- | --- | --- |
| Weekly | last 7 days | next 7 days | `CalendarRange` / `--color-ink-100` |
| Monthly | last 30 days | next 30 days | `CalendarDays` / `#00D2FF` |
| All Time | all rows | all rows | `Wallet` / `#34E89E` |

**Earnings Trend chart** (`earnings-trend-chart.tsx`) — a Recharts area chart of 9 weekly
buckets with a gradient fill and point markers. Buckets run backwards (past tab) or
forwards (future tab) from now; index 8 is the current/nearest week.

**Payout history** (`earnings-content.tsx:97-145`) — payouts grouped into collapsible
per-day cards (`DailyGroup`) keyed on `toPayAt ?? createdAt`, with a "Today" / "Yesterday"
/ medium-date header and a per-day subtotal. Groups sort descending (past) or ascending
(future); the section title is "Payout History" or "Future Earnings". Empty state:
`Wallet` icon with tab-appropriate copy.

## Payout tile (`PayoutTile`, `payout-tile.tsx`)

Each payout renders as a row with a status icon chip, service names, an amount, a status
badge, and (when present) an expandable breakdown:

- **Status icon chip** — colored icon from `statusMeta` (`payout-status.ts`).
- **Service names** — joined `serviceName`s from the breakdown, falling back to
  `sourceBrandName`.
- **Beneficiary chip** — when the payout is *not* incoming to the viewer and a beneficiary
  is known, an avatar + name with the email on hover (`payout-tile.tsx:137-148`). "Incoming"
  means the viewer is the beneficiary user, or the viewer is acting as the recipient agency
  (`payout-tile.tsx:117-119`).
- **Dates** — created date plus an "Expected to be paid at {toPayAt}" badge.
- **Amount** — `formatCurrency(amount, currency)`.
- **Status badge** — label from `statusMeta(...).label(incoming, wiseFunding.status)`. For
  unpaid statuses (`upcoming`, `pending`) the badge is wrapped in a `ReadinessTooltip`.

### Payout status set (`payout-status.ts`)

The `payout_status` enum (`schema.ts:183-194`) and the client `PAYOUT_STATUS` map carry:

| Status | Icon / color | Badge label |
| --- | --- | --- |
| `paid` / `received` | `CheckCircle2` / success | "Paid" |
| `upcoming` | `CalendarDays` / muted | "Unpaid (In)" / "Unpaid (Out)" by direction |
| `pending` | `Clock` / accent | "Unpaid (In)" / "Unpaid (Out)" by direction |
| `dispatched` | `Rocket` / accent | "Dispatched" |
| `processing` | `Hourglass` / warn | "Processing" |
| `processingByStripe` | `RefreshCw` / accent | "Proc (Stripe)" |
| `processingByPaypal` | `RefreshCw` / accent | "Proc (PayPal)" |
| `processingByWire` | `RefreshCw` / accent | money-flow label from `wiseFunding.status` |
| `failed` | `XCircle` / danger | "Failed" |

Unknown statuses fall back to `upcoming`. For an in-flight wire payout, the label reflects
the Wise two-leg funding sub-state (`wiseFunding.status`): `funding` → "Processing (Stripe
→ Wise)", `paying_out` → "Processing (Stripe → Bank)", `funded`/`transferring` →
"Processing (Wise → Bank)", else "Processing (Wire)" (`payout-status.ts:35-47`).

### Breakdown drill-down

When a payout has breakdown rows it is clickable and expands to a 6-column table — Brand
name, Service name, Payment reason, Week, Take, GST (`PayoutBreakdownTable`,
`payout-tile.tsx:72-101`). "Take" is `amount − gst`; "Payment reason" maps the
`commissionType` to a human label (Platform, Affiliate, Sales agency, Agency, Sales,
Production manager, Briefing manager, Approval manager, Contractor). Breakdown rows come
from `payouts.detail` (`payouts.ts:171-176`), backed by the `payout_breakdowns` table.

### Disbursement-readiness checkpoints

`enrichReadiness` (`payout-readiness.ts:26-84`) attaches three checkpoints to each payout
row, surfaced in the `ReadinessTooltip` (`components/ui/readiness-tooltip.tsx`) on the
status badge:

1. **Bank account linked** — the beneficiary user (`users.bankAccountLinked`) or, for an
   agency-received payout, the agency itself (`agencies.bankAccountLinked` or
   `stripeAccountId`) has a linked payout account.
2. **Payout date reached** — now is past `toPayAt` (the date is shown in the label).
3. **Respective project completed** — the payout's first breakdown project is `completed`.

These are the same conditions the payout cron checks before disbursing, so the payee sees
exactly what gates a payout.

## Super-admin "everyone" view

When `user.isSuperAdmin`, the page header exposes a filter-by-user action
(`earnings.tsx:72-77`). `payouts.beneficiaries` and `payouts.beneficiaryAgencies`
(`payouts.ts:116-144`) return the distinct payees (users and agencies) that appear in the
payout set, shaped into one display map. The `UserFilterDialog`
(`earnings/user-filter-dialog.tsx`) lets the admin scope the list to a single beneficiary;
the selection filters rows client-side by `beneficiaryId`.

## Earnings summary endpoint

`payouts.summary` (`payouts.ts:147-169`) returns aggregate totals for the current scope:
`totalEarned` (sum of `paid` + `received`), `pending` (`pending` + `processing`),
`upcoming`, and the full `byStatus` map.

---

# Invoices

Invoices are billing documents tied to purchases (`invoice_items` carry the line detail).
`InvoicesPage` (`invoices.tsx`) lists them; `InvoiceDetailPage`
(`invoices/invoice-detail.tsx`) shows the full document with line items, parties, totals,
and PDF export.

## List (`invoices.list`, `invoices.ts:46-109`)

Two scopes:

- **Brand workspace** (`workspace === 'brand'` and a `brandId`): invoices joined through
  the brand's purchases, gated by `assertBrandAccess`.
- **Beneficiary side** (no `brandId`): invoices that involve the current user — where the
  connected payout's beneficiary is the user, or either `fromParty`/`toParty` points at the
  user (`userId`) or, for agency owners/staff, their selected agency (`agencyId`). Payouts
  are left-joined so invoices without a connected payout still surface. Contractors are
  strictly personal (user-type matches only).

The list table shows Invoice (display number), Status, Issued date, and Total
(`invoices.tsx:49-69`). Rows are clickable and navigate to `/invoices/:id`. Each invoice
is decorated with `displayNumber` (`formatInvoiceNumber`) and, when it has a connected
payout, `payoutReadiness` checkpoints (`invoices.ts:20-27`), so the status badge shows the
same readiness tooltip as payouts. Status styling (`invoices.tsx:18-27`) covers `paid`,
`received`, `unpaid`, `processing`, `processingByStripe/Paypal/Wire`, and `dispatched`;
unmapped statuses fall back to `muted`.

The `invoice_status` enum (`schema.ts:172-181`): `unpaid`, `paid`, `dispatched`,
`processing`, `processingByPaypal`, `processingByWire`, `processingByStripe`, `received`.

## Detail (`invoices.byId`, `invoices.ts:111-135`)

Returns the invoice plus its `items`, the resolved `fromParty`/`toParty` identity blocks
(`resolveParties` expands the stored id refs into name/email/address/ABN/phone), the
`displayNumber`, and `payoutReadiness` for the connected payout. `InvoiceDetailPage`
renders:

- Header with the display number, issued date, and the status badge (with the readiness
  tooltip when a connected payout exists — shown for every status, paid and unpaid alike).
- From / To party blocks.
- A line-item table (Item — with selected options and addons inline — optional Package
  column, Qty, Total).
- A totals block treating the stored `total` as GST-inclusive: subtotal = 90%, GST = 10%,
  amount due = total (Australian tax-invoice basis).

## PDF / printable export

The **Export PDF** action calls `invoices.pdf` (`invoices.ts:144-181`), which returns a
structured `document` (number, status, issued date, billing basis "Service Duration",
resolved parties, AU tax totals, line items) plus a `url`. When a `url` is present the
client opens it; otherwise it renders a clean printable invoice in-browser via
`printInvoice` and lets the browser save it as PDF (`invoice-detail.tsx:55-80`). A rendered
PDF binary is produced by an external renderer when one is configured.

A second generator, `invoices.generateForPurchaseCycle` (`invoices.ts:193-285`), builds a
client-facing tax invoice on the fly for a brand from a purchase + billing cycle (From =
the sales agency or Prodesk, To = the brand). It returns the same `document` shape and
reuses the print path; nothing is persisted. Internal purchases are non-billable and
rejected.

---

# Account Settings

`ProfilePage` (`profile.tsx`) is a single user-scoped settings screen (`max-w-3xl`). What
it shows derives from the identities the user *holds* — computed from
`auth.contextOptions`, not the currently selected context (`profile.tsx:40-57`):

- `hasAgencyRole` — holds an agency (owner or staff) identity anywhere.
- `hasContractorRole` — holds a contractor identity or `hasContractorProfile`.
- `hasBrandRole` — holds a brand identity.
- `isBrandOnly` — brand-only (and not super-admin); the personal payout panel is hidden
  for these users only.

Sections, in order:

1. **Header** — eyebrow "Your account", title "Account settings", back button.
2. **Profile hero** (`profile/profile-hero.tsx`) — a 112px avatar with a camera overlay
   that picks an image, uploads it to the `Uploads` storage bucket under
   `profiles/{userId}`, and saves the public URL via `users.updateProfile({ profileUrl })`.
   Display name, email, and an "Active Member" pill.
3. **Personal Information** — first name, last name (editable, saved via
   `users.updateProfile`), and email (disabled, "Email cannot be changed."). A
   Save/Discard footer appears only when the name is dirty.
4. **Security** (`profile/security-card.tsx`) — a "Password / Update" row opening a
   change-password dialog. The dialog reauthenticates by signing in with the current
   password (`supabase.auth.signInWithPassword`), validates the new password (≥ 8 chars,
   matching confirmation), then calls `users.changePassword`, which updates the GoTrue user
   via the Supabase admin API (`users.ts:120-126`).
5. **Email preferences** (`profile/email-preferences-card.tsx`) — channel unsubscribe
   toggles backed by `users.unsubscribedChannels` / `users.toggleUnsubscribeChannel`.
6. **Payout Settings** (`WithdrawMethodsPanel`) — hidden only for brand-only users.
7. **Contractor Settings** — shown when `hasContractorRole`: an "Edit Profile" entry into
   the freelancer profile editor.
8. **Integrations** (`CalendarCard`) — shown when `hasAgencyRole`: Google Calendar link /
   unlink.
9. **Affiliate Program** (`AffiliateCard`).

## Payout methods (`WithdrawMethodsPanel`, `profile/withdraw-methods.tsx`)

A panel with an "one active method at a time" info banner and one card per supported
method: **Stripe** and **Wire transfer**. (The `payout_method` enum is
`['stripe', 'paypal', 'wire']` (`schema.ts:199`), but the settings UI offers only Stripe
and Wire.)

**Active method** — the effective active method is the explicit `activePayoutMethod`, else
the first connected method (Stripe preferred), and is cleared if its underlying connection
is gone (`withdraw-methods.tsx:152-155`). The active card shows an **ACTIVE** badge, a
left accent border, and masked details (`••••1234`).

**Switch / disconnect** — connecting a new method while one is active prompts a confirm
dialog (`confirmSwitch`) that disconnects the current method then starts connecting the
new one. Disconnect prompts a destructive confirm (`confirmDisconnect`). These map to
`users.setActivePayoutMethod`, `users.removePayoutMethod`, and the per-method connect
flows.

`users.removePayoutMethod` (`users.ts:175-187`) deletes the method's stored details and,
if it was active, demotes `activePayoutMethod` to null; removing `wire` or `stripe` also
clears `bankAccountLinked`, and removing `stripe` clears `stripeAccountId`.

### Stripe Connect

**Connect / Update** opens onboarding in a reserved new tab via
`users.createStripeConnectLink` (`users.ts:283-310`), which creates (or reuses) an Express
Connect account for the user and returns an `accountLinks` onboarding URL with
`refresh_url`/`return_url` back to `/profile`. `users.stripeAccountStatus`
(`users.ts:313-327`) reports `chargesEnabled` / `payoutsEnabled` / `detailsSubmitted`; the
card shows an "Incomplete setup." warning when an account exists but payouts aren't yet
enabled. When Stripe isn't configured the link is null and the UI shows an "unavailable in
this environment" message.

### Wire transfer (Wise recipient)

**Connect / Update** opens the `WireDialog` — a full international bank-detail form
prefilled from the stored record on update. Fields: account holder, country (full ISO
picker), bank name (major-bank dropdown per country with a custom "Other" option), account
number / IBAN, routing number / BSB / sort code, SWIFT/BIC, and (for US/CA or any
SWIFT-routed account) account type plus a recipient residential address.

Client validation (`withdraw-methods.tsx:853-931`) enforces:

- Account holder ≥ 2 chars.
- Account number / IBAN 4–34 chars, charset `[A-Za-z0-9 \-]`.
- SWIFT/BIC matches `^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$` when provided.
- AU: 6-digit BSB required. US: 9-digit ABA routing required. CA: 8–9 digit routing
  required. (Wise's domestic account types for these countries reject SWIFT, so the
  routing code can't be substituted.)
- At least one of SWIFT or routing/BSB/sort must be present.
- When an address is required (US/CA or SWIFT-routed): line 1, city, post code, and state
  are required; US/CA states must be the 2-letter code.

On save the form calls `users.linkWiseRecipient` (`users.ts:194-240`), which creates a
Wise recipient (`createWiseRecipient`), stores its id under `payoutMethods.wire`, sets
`activePayoutMethod = 'wire'`, and marks `bankAccountLinked = true`. Wise failures are
surfaced as the precise human-readable reason. In dev (Wise unconfigured) details are
stored with a null recipient id. `users.validateWireDetails` (`users.ts:247-276`) validates
the same shape against Wise before save without persisting.

A Wise OAuth import path also exists (`users.getWiseAuthUrl` →
`users.exchangeWiseCode`, `users.ts:333-387`): connect opens the Wise authorization URL,
the `?wise_callback` redirect exchanges the code for the user's existing Wise recipient
accounts, and the user picks one to link (`withdraw-methods.tsx:196-239, 411-453`). The
"Connect with Wise" entry inside the wire dialog is currently commented out; the manual
wire form is the primary path.

## Google Calendar integration (`CalendarCard`, `profile/calendar-card.tsx`)

Shown for users with an agency identity. Reads `user.googleCalendarLinked`
(`schema.ts:289`). **Connect** runs the Google OAuth consent redirect from
`meetings.calendarAuthUrl`; the `?calendar_callback` redirect exchanges the code via
`meetings.linkCalendar`. **Unlink** (with a destructive confirm) calls
`meetings.unlinkCalendar`. When calendar integration isn't configured the card shows an
"not configured in this environment" note and disables Connect.

## Affiliate program (`AffiliateCard`, `profile/affiliate-card.tsx`)

Builds a referral link `{origin}/signup?ref_user_id={userId}` with copy-to-clipboard. When
the user was referred by an agency (`referredByAgencyId`, `schema.ts:270`), a note explains
that their own referrals may be attributed to that agency.

---

# Data model reference

User payout/profile columns (`users` table, `schema.ts`): `profileUrl` (266),
`referredByAgencyId` (270), `stripeAccountId` (283), `bankAccountLinked` (284),
`activePayoutMethod` (285), `payoutMethods` jsonb (286), `uiPreferences` jsonb (287),
`googleCalendarLinked` (289). The `agencies` table mirrors the payout columns (369–373).

Payouts carry `status` (`payout_status`), `as` (`payout_as`: admin/owner/staff/contractor/
agency), `method` (`payout_method`), `beneficiaryId`/`beneficiaryAgencyId`, `toPayAt`, and
a `wiseFunding` jsonb sub-state (`schema.ts:1068-1075`). `payout_breakdowns` holds the
per-line commission detail (brand, service, payment reason / commissionType, week, amount,
GST, project ref). `invoices` carry `status`, `number`, `payoutId`, `fromParty`/`toParty`,
`commissionType`, and `total`; `invoice_items` carry name, qty, totalPrice, packageName,
selectedOptions, selectedAddons.
