# Super Admin Console

The super-admin console is the platform-operator surface: a set of pages gated to users with `isSuperAdmin = true`. It exposes user management and impersonation, agency moderation and configuration, brand operations, global commission/payment-plan settings, the disciplines and Infin8 taxonomies, resource moderation, platform-wide payouts/invoices, and basic diagnostics.

## Implementation map

- **Pages:** `client/src/pages/super-admin.tsx` (Users, Agencies, Brands list pages + the brand-files dialog) and the `client/src/pages/super-admin/` folder:
  - `settings.tsx` — Global Settings (commissions + default payment plans)
  - `disciplines.tsx` — disciplines management + discipline-request queue (embeds the Infin8 manager)
  - `infin8-manager.tsx` — Infin8 stage/substage taxonomy manager
  - `resources.tsx` — global resource upload + 4-tab moderation
  - `payouts.tsx` — platform-wide payouts table
  - `invoices.tsx` — platform-wide invoices table
  - `info-hub-templates.tsx` — global Info Hub section templates
  - `components.tsx` — shared `PillToggle`, `Switch`, `StatCard`, `SearchBar`, `SectionCard`
- **Server:** `server/src/routers/superAdmin.ts` (most procedures), `server/src/routers/resources.ts` (resource moderation), `server/src/routers/files.ts` (brand file reads).
- **Authorization:** `superAdminProcedure` in `server/src/trpc/trpc.ts:56-57` — extends `protectedProcedure` and throws `FORBIDDEN` unless `ctx.user.isSuperAdmin`. A single boolean gates the entire console; there is no separate lighter "admin" role.
- **Routes:** registered in `client/src/App.tsx:292-302` under `/super-admin/*`. Super-admin users skip role selection and land directly in this workspace (`App.tsx:161-171`).
- **Navigation:** the super-admin sidebar group is defined in `client/src/components/layout/nav-items.ts:120-128`: Users, Brands, Agencies, Payouts, Invoices, Disciplines, Resources, Info Hub Templates, Settings.
- **Schema:** `server/src/db/schema.ts` — `globalSettings` (singleton, `id = 1`, `:1431-1452`), `disciplineRequests` (`:1511-1520`), `agencies` operator flags (`:344-349`), `resources` (`acceptedAt` at `:1402`).

---

## Users

`AdminUsersPage` (`super-admin.tsx:55`). Paginated table (`LIMIT = 15`), newest-first by `createdAt`. Columns: **User** (avatar + first+last name, falling back to "Unknown User"), **Email**, **Agencies**, **Actions**.

- **Search** matches email OR `firstName` OR `lastName`, case-insensitive (`superAdmin.ts:46-53`).
- **Agencies column** shows chips for every agency the user owns: up to 5 `businessName` badges plus a `+N more` badge. Backed by `superAdmin.userAgencies` (`superAdmin.ts:65-78`), which returns a `userId → agencies[]` map keyed on `agencies.ownerId`; queried only when there is at least one user row.
- **Login (impersonation)** — the Actions column has a "Login" button. After a destructive confirmation, it calls `superAdmin.loginAsUser` (`superAdmin.ts:85-101`), which generates a one-time Supabase magic-link token (`supabaseAdmin.auth.admin.generateLink`) for the target user and returns its `hashed_token`. The client redeems it with `supabase.auth.verifyOtp({ type: 'magiclink', token_hash })`, establishing a session as that user, then redirects to `/`. Impersonating another super admin is rejected (`FORBIDDEN`, `superAdmin.ts:90`).

## Agencies

`AdminAgenciesPage` (`super-admin.tsx:137`). Paginated table; soft-deleted agencies (username tombstone `'deleted'`) are filtered out client-side (`super-admin.tsx:161`). Columns: **Agency** (logo avatar + `businessName`), **Email** (`businessEmail`), **Phone**, **Actions** (toggles), and a trailing delete cell.

- **Stat summary cards** above the table — Total / Verified / Pending — from `superAdmin.agencyStats` (`superAdmin.ts:201-207`); pending is computed as total minus verified.
- **Search** matches `businessName`, case-insensitive (`superAdmin.ts:190`). The list also accepts an optional `verified` filter.
- **Three per-agency toggles** (`PillToggle`), each a dedicated mutation. While a toggle's mutation is in flight, the switch shows the chosen value and locks (the `pendingToggle` helper, `super-admin.tsx:36-47`) so it doesn't snap back before the refetch lands:

  | Toggle | Column | Mutation |
  |---|---|---|
  | Verified | `agencies.emailVerified` (`schema.ts:343`) | `setAgencyVerified` (`superAdmin.ts:222`) |
  | Sales Agency | `agencies.isSalesAgency` (`schema.ts:344`) | `setAgencySalesAgency` (`superAdmin.ts:227`) |
  | Default Agency | `agencies.platformVerified` (`is_default` column, `schema.ts:347`) | `setAgencyDefault` (`superAdmin.ts:232`) |

- **Verify side effects** — `setAgencyVerified` clears `rejectionReason` when verifying (and stores it when un-verifying with a reason), and calls `onAgencyVerified` to resolve the pending agency-approval tasks for admins (`superAdmin.ts:209-220`).
- **Delete** — shown only for unverified agencies. A confirmation dialog explains it marks the agency deleted and unverified; `deleteAgency` (`superAdmin.ts:258-267`) soft-deletes by setting `username = 'deleted'` and `emailVerified = false`. The tombstone is what the list filter excludes.

## Brands

`AdminBrandsPage` (`super-admin.tsx:229`). Paginated table. Columns: **Brand** (logo avatar + `businessName` + created date), **Industry**, **Actions**.

- **Search** matches `businessName` OR `industry`, case-insensitive (`superAdmin.ts:107-110`).
- **Three actions per row:**
  - **Files** — opens `BrandFilesDialog` (`super-admin.tsx:280`), a read-only list of the brand's document-locker files via `superAdmin.brandFiles` (`superAdmin.ts:460-468`), which bypasses brand membership and returns non-deleted `files` for the brand, newest first. Each file links out to its URL.
  - **Billing** — navigates to `/super-admin/brands/:id/billing` (`AdminBrandBillingPage`).
  - **Info Hub** — navigates to `/super-admin/brands/:id/info-hub` (`AdminBrandInfoHubPage`).

## Global Settings

`GlobalSettingsPage` (`settings.tsx`). Operates on the `globalSettings` singleton (`getSettings` / `updateSettings`, `superAdmin.ts:269-326`). Two cards plus a full-width Save.

- **Global Commissions card** — four percent fields: `prodeskCommission`, `affiliateCommission`, `agencyCommission`, `salesAgencyCommission`. Each field shows "Current: x%" and the card displays a live running total. **The four commissions must sum to exactly 100%**; `updateSettings` enforces this whenever any commission is written (`superAdmin.ts:286-294`, tolerance `0.0001`) and rejects otherwise with "Global commissions must add up to 100%".
- **Default Payment Plans card** — add/remove plans; each plan has a name, an active `Switch`, an upfront %, a duration in weeks, and an interest rate, persisted to `globalSettings.defaultPaymentPlans` (JSON). On save, each plan is validated against the agency commission: a plan is rejected if `agencyCommission > maxAgencyCommission(plan)`, where (`superAdmin.ts:33-39`):

  ```
  upfrontWithInterest      = upfront + (interestRate * upfront) / 100
  earningPerWeekPercent    = (100 + interestRate - upfrontWithInterest) / durationWeeks
  maxAgencyCommission      = upfrontWithInterest + 4 * earningPerWeekPercent
  ```

  This ensures the agency commission is reachable within the 4th subscription payment. A failing plan returns "&lt;name&gt; plan does not reach agency commission within 4th subscription payment…" with the computed maximum.
- `updateSettings` also accepts `disciplines` and `services` arrays. Every write stamps `updatedBy = ctx.user.id` and `updatedAt`.

## Taxonomy — Disciplines & Infin8

`DisciplinesPage` (`disciplines.tsx`) titled "Taxonomy". Three sections: Disciplines, Discipline Requests (shown only when requests exist), and the embedded Infin8 manager.

### Disciplines

The global discipline list lives in `globalSettings.disciplines` (`text[]`). The page seeds local state once from `getSettings`, keeps it sorted case-insensitively, and writes the whole resulting array back. Operations:

- **Add / Remove** — edit the array and persist via `updateDisciplines` (`superAdmin.ts:333-342`). Remove is confirmed.
- **Rename** — `renameDiscipline` (`superAdmin.ts:387-392`) cascades the new name everywhere the old name is stored: the global list AND every agency's, service's, and package's `disciplines` array, deduped (`renameDisciplineEverywhere`, `superAdmin.ts:499-514`).
- **Merge** — a multi-step flow (select sources → choose target → confirm). `mergeDisciplines` (`superAdmin.ts:398-406`) re-points each source to the target via the same cascade.

### Discipline Requests

Agencies suggest custom disciplines, stored in the `disciplineRequests` table (`schema.ts:1511-1520`: `discipline`, `agencyId`, `createdAt`). Pending requests render as tappable chips:

- **`disciplineRequests`** (`superAdmin.ts:345`) lists pending requests, newest first.
- **Approve** — `approveDisciplineRequest` (`superAdmin.ts:363-381`) deletes the request and adds its discipline to the global list (idempotent, re-sorted), then calls `onDisciplineResolved` to clear the related tasks.
- **Reject** — `deleteDisciplineRequest` (`superAdmin.ts:350-356`) removes the request without adding it, also resolving tasks.

### Infin8 taxonomy

`Infin8Manager` (`infin8-manager.tsx`), embedded in the disciplines page. Manages the ordered `globalSettings.infin8Stages` (`{ stage, substages[] }[]`, `schema.ts:1447`). Structural edits that don't rename (add/remove/reorder a stage, add/remove a substage) persist the whole array via `updateInfin8Stages` (`superAdmin.ts:414-423`). Renames and merges use dedicated cascading endpoints:

- **`renameInfin8Substage`** / **`mergeInfin8Substages`** (`superAdmin.ts:426-442`) — update the taxonomy AND every agency's `infin8Substages` selection AND every service's scalar `sub_stage` column (`renameInfin8SubstageEverywhere`, `:521-545`).
- **`renameInfin8Stage`** (`superAdmin.ts:450-455`) — updates the stage label in the taxonomy AND every service's scalar `stage` column (`renameInfin8StageEverywhere`, `:553-567`). Agencies store only substages, so there is no agency cascade for stages.

## Resources

`ResourcesManagementPage` (`resources.tsx`). An upload card, a search field, and a four-tab moderation view.

- **Upload** — title, optional description, multi-select category chips (8 fixed: Templates, White Papers, Checklists, Guides, Legal, Financial, Marketing, Operations), and a File-or-Link radio. Files upload to the Resources storage bucket; the resulting URL (or the link URL) is sent to `resources.createGlobal` (`resources.ts:64-72`), which always sets `agencyId = null` and `acceptedAt = now()` — admin-authored resources need no moderation.
- **Four tabs** filter the full list client-side (`resources.ts:adminList`, `:30-41`, returns all resources, search on title OR description):
  - **Pending** — `acceptedAt == null`
  - **Accepted** — `acceptedAt != null`
  - **Global** — accepted with no `agencyId`
  - **Agency** — accepted with an `agencyId`
- **Per-resource actions:**
  - Pending rows show **Accept** (`resources.accept`, `:75-83`, stamps `acceptedAt` and calls `onResourceApproved`) and **Reject** (`resources.reject`, `:89-93`, deletes the request and resolves the approval tasks — confirmed, irreversible).
  - Accepted rows show **Delete** (`resources.remove`, `:95-98`, confirmed).
  - Any row with a URL or link shows **Open**, viewed via the file viewer.
- Agency-uploaded resources start pending (`resources.create` sets `acceptedAt = null` when an `agencyId` is present, `:43-58`); once accepted they become visible to brands through `resources.brandList` (`:110-134`, only `acceptedAt != null`).

## Payouts

`AdminPayoutsPage` (`payouts.tsx`). Paginated platform-wide payouts table, sorted by `toPayAt` descending (`superAdmin.payouts`, `superAdmin.ts:126-158`). Each row carries:

- The beneficiary and agency (joined).
- The same disbursement-readiness checkpoints the earnings views use (bank linked / payout date / project completed), surfaced via a status badge hover tooltip (`readinessForPayoutIds`).
- A per-row commission `breakdown` (from `payoutBreakdowns`). Rows expand to reveal the same Brand/Service/Reason/Week/Take/GST breakdown table used by the earnings payout tiles; multiple rows may be expanded at once.

## Invoices

`AdminInvoicesPage` (`invoices.tsx`). Paginated platform-wide invoices table, newest first (`superAdmin.invoices`, `superAdmin.ts:166-184`). Each row resolves **both** parties (from → to) via `buildPartyResolver`, shows a formatted invoice number, and — when the invoice has a connected payout — exposes that payout's readiness checkpoints on the status badge hover (null otherwise).

## Info Hub Templates

`GlobalInfoHubTemplatesPage` (`info-hub-templates.tsx`), routed at `/super-admin/info-hub-templates`. Manages the platform-wide default Info Hub section templates (`spotForms` with no `agencyId`/`brandId`).

## Diagnostics

Server-side diagnostic procedures on `superAdminRouter`:

- **`collectionCounts`** (`superAdmin.ts:471-479`) — platform-wide row counts across the core tables (users, agencies, brands, projects, purchases, proposals, payouts, invoices, tasks, services, staff).
- **`exportData`** (`superAdmin.ts:482-489`) — JSON export of an allowlisted table (users / agencies / brands / projects / purchases / proposals / payouts / invoices), capped at 5000 rows.

## Search & pagination conventions

All list pages use server-side pagination via `paginationInput` / `page` (`server/src/lib/pagination.ts`) with a page size of 15 (resources uses 100 and filters client-side across the four tabs). Search is case-insensitive `ilike` and applied per the columns noted in each section above; the search box resets the offset to 0 on change.
