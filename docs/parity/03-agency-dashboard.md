# Agency Workspace — Specification

The agency workspace is the largest functional area in the product. It spans the
agency dashboard, clients (CRM), catalog (services + packages), contractors,
staff/roles/commissions, agency profile & branding, billing/finance, and
projects. This document is the authoritative description of its canonical
behavior and the React/tRPC/Drizzle code that implements it.

Surface map:

- **Dashboard** — `client/src/pages/dashboard.tsx` (`AgencyDashboard`)
- **Clients (CRM)** — `client/src/pages/clients.tsx`, `client/src/pages/agency/client-detail.tsx`
- **Catalog** — `client/src/pages/catalog.tsx` + `client/src/pages/agency/{service-editor,package-editor,organize-services,catalog-grouping,constants}.{ts,tsx}`
- **Contractors** — `client/src/pages/agency-contractors.tsx`
- **Staff / roles / commissions** — `client/src/pages/staff.tsx`, `client/src/pages/agency/workflow-settings.tsx`
- **Agency profile / branding** — `client/src/pages/agency/{create-agency,edit-agency,agency-profile-form}.tsx`
- **Billing / finance** — `client/src/pages/agency/{agency-bank-account,agency-subscriptions,agency-affiliate}.tsx`, `client/src/pages/invoices.tsx`
- **Info Hub / SPOT forms** — `client/src/pages/agency/{info-hub-setup,info-hub-template-manager}.tsx`, `client/src/pages/brand/{spot-view,spot-questions-editor,section-library}.tsx`, `server/src/routers/spot.ts`
- **Routers** — `server/src/routers/{agencies,staff,connections,contractor,services,packages,invoices,payouts,spot}.ts`
- **Navigation** — `client/src/components/layout/nav-items.ts`, `client/src/components/layout/sidebar.tsx`
- **Routes** — `client/src/App.tsx`

---

## Navigation & access control

Agency nav is built by `buildNavItems` (`client/src/components/layout/nav-items.ts:41`).
Owners (`agencyOwner`) see every tab; staff (`agencyStaff`) see only the tabs
their granular `StaffPermission` set unlocks (`has()` at line 44). The agency
rail renders Dashboard, Clients, Info Hub Setup, Proposals, Projects, Catalog,
Team, Contractors, Roles & Commissions, Manage Resources, Earnings, Invoice,
Subscriptions, Bank Account, Agency Info, and Affiliate (lines 53–73).

**Verification gate.** When an agency is not yet verified
(`ctx.agencyVerified === false`) and not deleted, `buildNavItems` returns a
single `{ kind: 'pending' }` entry (`nav-items.ts:47`), and the sidebar replaces
the entire tab list with `PendingVerificationRail`
(`client/src/components/layout/sidebar.tsx:35`). A newly created agency is
unverified until a super-admin approves it (see Agency creation).

Server-side, every agency-scoped procedure enforces access through
`assertAgencyAccess(ctx, agencyId, <permission>)` (e.g. `connections.ts:36`,
`staff.ts:48`, `services.ts:135`, `agencies.ts:440`). The permission strings are
the canonical set in `staff.ts:13` (`PERMISSIONS`).

---

## Dashboard

`AgencyDashboard` (`client/src/pages/dashboard.tsx:45`) renders a greeting
header, a "New proposal" action, and a stat grid. Stats come from
`agencies.dashboardStats` (`server/src/routers/agencies.ts:166`), which returns
six counts computed in parallel:

| Stat | Source |
| --- | --- |
| Active projects | non-completed, non-deleted `projects` for the agency |
| Pending actions | `agencyContractorConnections` in `pendingApplication` |
| Clients | `brandAgencyConnections` for the agency |
| Services | non-deleted `services` for the agency |
| Team members | `active` `staff` for the agency |
| Proposals | `proposals` for the agency |

`agencies.recentProjects` (`agencies.ts:218`) returns the most-recently-updated
active projects (default 6) for an active-projects section.

When the user has no agency selected (`!agencyId`) the dashboard shows a
no-agency state prompting the user to create one (`dashboard.tsx:50`).

---

## Agency creation & profile

### Creation wizard

`CreateAgencyPage` (`client/src/pages/agency/create-agency.tsx:19`) renders the
shared `AgencyProfileForm` (`client/src/pages/agency/agency-profile-form.tsx`)
and submits to `agencies.create` (`server/src/routers/agencies.ts:368`).

The profile schema (`profileInput`, `agencies.ts:86`) collects: `businessName`,
`legalName`, `businessEmail`, `username` (subdomain), `website`, `phone`,
`address`, `abn`, `description`, `shortDescription`, `disciplines`,
`infin8Substages`, `social` (facebook/x/instagram URLs), and `uiPreferences`
(theme accent color and other branding). Logo is set separately via
`agencies.updateLogo` (`agencies.ts:473`).

On create, `agencies.create`:

1. Validates the username (format/blacklist + uniqueness) when supplied.
2. Inserts the agency and a `userAgencies` membership row.
3. Promotes the user to `agencyOwner` and sets `selectedAgencyId`
   (`agencies.ts:412`).
4. Files `disciplineRequests` for any custom (non-standard) disciplines via
   `fileCustomDisciplineRequests` (`agencies.ts:417`, helper at `agencies.ts:911`),
   notifying super-admins per request.
5. Enqueues a super-admin approval task (`onAgencyPendingApproval`,
   `agencies.ts:424`). The agency stays unverified — and gated behind the pending
   rail — until approved.

Stripe Connect onboarding is launched separately from the bank-account screen
post-create (see Billing).

### Username / subdomain availability

Multi-tenant routing keys off `agencies.username` as the subdomain
(`agencies.byUsername`, `agencies.ts:294`). `usernameFormatError`
(`agencies.ts:49`) enforces: lowercase letters only, length 3–20, and a reserved
blacklist (`BLACKLIST_SUBDOMAINS`, `agencies.ts:33`: `prodesk`, `prod`,
`staging`, `stage`, `app`, `dev`, `www`, `admin`, `support`, `help`, `deleted`,
`test`).

Live availability is served by `agencies.checkUsername` (`agencies.ts:314`,
debounced client-side) and `agencies.checkBusinessName` (`agencies.ts:340`),
both case-insensitive and both accepting an `excludeAgencyId` so the edit screen
can keep its own current value. Both `create` and `update` re-validate
authoritatively before writing.

### Editing & branding

`EditAgencyPage` (`client/src/pages/agency/edit-agency.tsx`) reuses
`AgencyProfileForm` and submits to `agencies.update` (`agencies.ts:437`), which
re-validates the username, persists profile + `uiPreferences`, and re-files
custom discipline requests. `agencies.updateLogo` (`agencies.ts:473`) updates
only the logo. The Infin8 substage picker and discipline picker are seeded from
`agencies.infin8Stages` (`agencies.ts:110`) and `agencies.disciplines`
(`agencies.ts:129`), both sourced from `globalSettings` so an approved
discipline becomes immediately selectable for every agency.

---

## Workflow settings (roles & commissions)

`WorkflowSettingsPage` (`client/src/pages/agency/workflow-settings.tsx:27`)
configures the agency's revenue-split model. It loads the agency
(`agencies.byId`) and its members (`agencies.members`, `agencies.ts:574` — owner
+ active staff, each carrying `bankAccountLinked` to gate redirect toggles), and
saves via `agencies.saveWorkflowSettings` (`agencies.ts:496`).

Configurable fields:

| Field | Meaning |
| --- | --- |
| `briefingDesigneeId` / `allocationDesigneeId` / `approvalDesigneeId` | The staff member assigned each workflow role |
| `salesStaffIds` | Members eligible for sales commission |
| `salesPersonCommissions` | Per-staff sales commission percent (map) |
| `productionManagerCommission` | Production commission percent |
| `briefingManagerCommission` | Briefing commission percent |
| `internalApprovalCommission` | Internal-approval commission percent |
| `redirect*CommissionToBankAccount` (×4) | Redirect each commission to the agency bank account |

**Commission cap.** On save, the server computes
`production + briefing + internalApproval + max(salesPersonCommissions)` and
rejects the write if the total reaches or exceeds the platform's
`globalSettings.agencyCommission` cap (falling back to 100 when unset)
(`agencies.ts:520`). The UI renders a live commission summary mirroring this
calculation. `agencies.commissionDefaults` (`agencies.ts:262`) supplies the
seed values and the cap for the service/proposal/custom-item forms.

Access requires the `rolesAndCommissions` permission.

---

## Catalog (services + packages)

`CatalogPage` (`client/src/pages/catalog.tsx:36`) renders services and packages
as the same marketplace cards a brand sees. Services and packages are loaded
with `includeInactive: true` (`catalog.tsx:55`) via `services.list`
(`server/src/routers/services.ts:99`) and `packages.list` (`packages.ts:33`);
section headings come from `services.headings` (`services.ts:178`).

### Sorting & grouping

The sort selector (`CATALOG_SORTS`, `client/src/pages/agency/constants.ts`)
offers eight modes implemented in `sortServices` (`catalog.tsx:335`): `infin8`,
`organized`, `newest`, `oldest`, `nameAsc`, `nameDesc`, `priceAsc`, `priceDesc`.

- **Infin8** (default): groups services by Infin8 stage → substage, rendered as
  per-stage card rails (`catalogGroups` + `sortByInfin8`,
  `client/src/pages/agency/catalog-grouping.ts`).
- **Organized**: interleaves services with first-class section headings in the
  agency's manual `sortOrder` sequence (`organizedGroups`), editable via the
  Organize dialog.
- All other modes render a flat responsive grid.

On mobile each titled section becomes a collapsible accordion (`CatalogSection`,
`catalog.tsx:306`). Search filters on service/package name **and** description
(`catalog.tsx:88`), matching the server-side `services.list` search which scans
name and description (`services.ts:107`).

### Organize / reorder

`OrganizeServicesDialog` (`client/src/pages/agency/organize-services.tsx`) lets
the agency drag services and headings into a single ordered list, persisted by
`services.reorder` (`services.ts:229`), which writes the new `sortOrder` back to
the matching table per item `kind`. Headings are managed by
`services.addHeading` / `updateHeading` / `deleteHeading` (`services.ts:189`,
`:203`, `:214`); a new heading is appended after the current last catalog item
(`services.ts:197`).

### Service editor

`ServiceEditorDialog` (`client/src/pages/agency/service-editor.tsx`, opened from
the New Service button and each card's Edit action) drives the full service
model. `services.create` / `services.update` (`services.ts:122`, `:141`) accept
the `upsertInput` schema (`services.ts:31`):

| Group | Fields |
| --- | --- |
| Core | `name`, `description` (required short description), `type`, `disciplines`, `imageUrl`/`imagePath`/`imageAspectRatio`, `videoUrl`/`videoPath` |
| Pricing | `price`, `upfrontFee`, `recurringFee`, `upfrontDeliveryFee`, `recurringDeliveryFee` |
| Flags | `isActive`, `allowBuyNow`, `allowBookMeeting`, `allowSalesProposal` |
| Infin8 | `stage`, `subStage` |
| Recurring | `deliverableFrequency`, `repeatsEvery` |
| Digital product | `digitalProductFileUrl`, `digitalProductFileName` |
| Rich (jsonb) | `variants`, `options`, `addons`, `assignedStaff`, `customFields`, `upfrontProjectConfig`, `recurringProjectConfig` |
| Commissions | `salesPersonCommissions`, `productionManagerCommission`, `briefingManagerCommission`, `internalApprovalCommission` |
| Ordering | `sortOrder` |

`variants` are option-combination rows with per-variant price differences (no
`name` field; the combo is described by `options`) (`services.ts:18`).
`assignedStaff` carries booking/meeting config per member (`services.ts:27`).
On create, price is mandatory: recurring-billed types require `recurringFee > 0`,
all others require `price > 0` (`services.ts:127`).

Visibility is toggled by `services.setActive` (`services.ts:153`, supports
un-archive), and `services.archive` (`services.ts:164`) soft-deletes
(`deletedAt`). Both are surfaced from the editor.

### Packages

`PackageEditorDialog` (`client/src/pages/agency/package-editor.tsx`, plus
`package-services-section.tsx`, `package-meeting-config.tsx`) builds a package
from catalog services. `packages.create` / `update` (`packages.ts:52`, `:61`)
accept the `upsertInput` schema (`packages.ts:13`): `name`, `description`,
media, `disciplines`, the buy/meeting/proposal flags, `items` (referenced
services with optional quantity/variant), `assignedStaff`,
`salesPersonCommissions`, and `sortOrder`. Packages have `setActive`
(`packages.ts:81`) and `archive` (`packages.ts:72`). They render in the catalog
as a "Packages" rail (`catalog.tsx:212`).

---

## Contractors

`AgencyContractorsPage` (`client/src/pages/agency-contractors.tsx:31`) has Active
and Pending tabs, plus an Explore Contractors rail. The list comes from
`connections.agencyContractors` (`server/src/routers/connections.ts:73`), which
joins the contractor's profile (including `profileUrl` from the linked `users`
row) and supports filtering by status (`pendingInvite`, `pendingApplication`,
`active`, `rejected`, `revoked`).

### Inviting

The Invite dialog (`InviteContractorDialog`, `agency-contractors.tsx:341`) calls
`connections.inviteContractor` (`connections.ts:108`), which supports two paths:

- **By existing user** (`contractorId`): upserts a `pendingInvite` connection,
  files a connection task (`onContractorConnectionRequest`), and emails the
  invite. A previously rejected/revoked row is re-armed to `pendingInvite`; an
  active or still-pending row is left untouched.
- **By email** (`email`, person without an account): persists an email-only
  `pendingInvite` row (`pendingEmail` set) so it appears in the pending list,
  then emails a signed sign-up link. The row is reconciled when the invitee
  signs up and redeems the link (`contractor.create`).

### Approving / responding

`connections.respondToApplication` (`connections.ts:256`) lets the agency
approve or reject a contractor's application; `connections.respondToContractorInvite`
(`connections.ts:222`) is the contractor's accept/reject of an invite. On accept,
a 1:1 chat thread is created via `createContractorThread`
(`connections.ts:233`, `:268`) and the connection task is completed.

### Removing / revoking

`connections.removeContractor` (`connections.ts:281`) sets the connection status
to `revoked`, runs `handleContractorRemovedFromAgency` to archive the
agency↔contractor chat threads, clears any open connection task, and drops the
contractor back to role-selection if this was their only identity
(`maybeResetUserRole`). Email-only invite placeholders (no account yet) are
simply deleted (`connections.ts:290`). The UI exposes this as "Remove from
agency" (active) and "Cancel invite" (pendingInvite) (`agency-contractors.tsx:200`,
`:218`).

### Explore Contractors (default agencies only)

`connections.exploreContractors` (`connections.ts:192`) is gated on
`agency.platformVerified` — only platform **default** agencies may browse the
full contractor directory (`connections.ts:197`). Each row carries this agency's
current connection status so the card renders Invite / Invited / Connected /
Accept-application. The rail is rendered only for default agencies
(`agency-contractors.tsx:154`).

---

## Staff & permissions

`StaffPage` (`client/src/pages/staff.tsx:28`) serves both agency and brand staff
(driven by the active workspace). It lists, invites, edits permissions, and
removes members. The permission picker is grouped and labeled
(`groupedPermissionsForOrg`, `permissionLabel` in
`client/src/pages/agency/constants.ts`) and shows only the permissions valid for
the org type.

The canonical permission set is `PERMISSIONS` (`server/src/routers/staff.ts:13`),
including the three granular chat permissions (`chatWithContractors`,
`chatWithStaffs`, `chatWithBrands`) and the kanban workflow permissions
(`addBrief`, `allocatePeople`, `approveDeliverable`).

### Lifecycle & chat-thread side effects

- **Invite** (`staff.invite`, `staff.ts:64`): creates a `pending` row, links
  `userId` immediately if the invitee already has an account, emails the invite,
  and files an invitation task for the invitee.
- **Accept** (`staff.accept`, `staff.ts:113`): links `userId`, flips to
  `active`, completes the invitation task, and runs the chat-thread fan-out for
  any granted chat permissions (`handleStaffPermissionGranted`, `staff.ts:128`).
- **Update permissions** (`staff.updatePermissions`, `staff.ts:137`): when a
  chat permission changed for an active member, creates threads for newly
  granted chat perms and archives memberships for revoked ones
  (`handleStaffPermissionGranted` + `handleStaffPermissionRevoked`,
  `staff.ts:154`). `chatPermsChanged` (`staff.ts:31`) limits this to actual chat
  changes.
- **Remove** (`staff.remove`, `staff.ts:162`): sets status `removed`, clears the
  pending invite task, revokes all chat threads, and resets the user's role if
  this was their only identity.
- **Resend** (`staff.resend`, `staff.ts:180`): re-emails a still-pending invite.

---

## Clients (CRM)

`ClientsPage` (`client/src/pages/clients.tsx:25`) lists connected brands from
`connections.agencyClients` (`connections.ts:33`), and each row navigates to the
client detail screen (`/clients/:id`). The page also exposes a Chat action per
client.

### Connecting to a brand

The "Connect a brand" dialog (`ConnectBrandDialog`, `clients.tsx:154`) ports the
brand-search flow with a default/non-default split:

- **Default agencies** search the full brand directory by name or email
  (`connections.searchBrands`, `connections.ts:319`) and send a connection
  request (`connections.requestBrandConnection`, `connections.ts:390`), which
  files an approval task for the brand owner.
- **Non-default agencies** can only resolve a brand by its exact email; if none
  exists, they send an email invitation that stamps the agency as referrer
  (`connections.sendBrandReferralInvite`, `connections.ts:379`).

Brands accept agency requests via `connections.acceptBrandRequest`
(`connections.ts:414`), which establishes the connection, opens chat threads,
and provisions the agency's default Info Hub sections through the shared
`connectBrandToAgency` chokepoint.

### Client detail

`ClientDetailPage` (`client/src/pages/agency/client-detail.tsx:36`,
route `/clients/:id` in `App.tsx:248`) presents a tabbed brand view: Overview,
Projects, Billing, Subscriptions, Info Hub, and Files (`TABS`,
`client-detail.tsx:26`). The Files tab is a file explorer (`LockerGrid` +
file viewer); Billing/Subscriptions/Info Hub reuse the brand-side views.

### SPOT forms / Info Hub

The SPOT form/Info Hub system is implemented across `server/src/routers/spot.ts`,
`server/src/modules/spot/provision.ts`, and the client pages
`client/src/pages/agency/{info-hub-setup,info-hub-template-manager}.tsx` and
`client/src/pages/brand/{spot-view,spot-questions-editor,section-library}.tsx`.
Agencies edit their Info Hub section template library (Info Hub Setup), and the
agency's default sections are provisioned for a brand when the connection is
established.

---

## Billing & finance

### Bank account / payout methods

`AgencyBankAccountPage` (`client/src/pages/agency/agency-bank-account.tsx`,
route `/agency-bank-account`) manages the agency's payout methods, scoped to the
agency row (distinct from a member's personal account). All of the following are
gated on the `bankAccount` permission:

- **Stripe Connect**: `agencies.createStripeConnectLink` (`agencies.ts:676`)
  creates (or reuses) an Express Connect account and returns an onboarding link;
  `agencies.stripeAccountStatus` (`agencies.ts:720`) reports
  charges/payouts/details status.
- **Wire (Wise)**: `agencies.linkWiseRecipient` (`agencies.ts:757`) creates a
  Wise recipient, stores its id on the agency, marks it payout-ready, and sets
  the active method to `wire`.
- **Active method**: `agencies.setActivePayoutMethod` (`agencies.ts:809`) and
  `agencies.removePayoutMethod` (`agencies.ts:831`) set/clear the active method;
  removing wire/stripe also clears `bankAccountLinked`.

### Invoices

The Invoice tab (`/agency-invoices`, `App.tsx:287`) renders `InvoicesPage`
(`client/src/pages/invoices.tsx`) backed by `server/src/routers/invoices.ts`. It
is present in the agency rail for owners and staff with the `invoice` permission
(`nav-items.ts:68`).

### Subscriptions

`AgencySubscriptionsPage` (`client/src/pages/agency/agency-subscriptions.tsx:22`,
route `/agency-subscriptions`) lists recurring (non one-time) projects with a
cancel-subscription flow. Gated on the `subscriptions` permission
(`nav-items.ts:69`).

### Affiliate / referrals

`AgencyAffiliatePage` (`client/src/pages/agency/agency-affiliate.tsx`,
route `/agency-affiliate`) surfaces the affiliate link and referred brands.
`agencies.referredBrands` (`agencies.ts:639`) returns brands whose owner was
referred by this agency (`users.referredByAgencyId`); the referral attribution
lives on the user, never the brand.

---

## Projects

The Projects tab (`/agency-projects`, gated on the `agencyProjects` permission,
`nav-items.ts:60`) routes to the kanban board `ProjectsBoardPage`
(`App.tsx:274`). Board transitions for an agency's owned projects are gated by
the kanban workflow permissions (`addBrief`, `allocatePeople`,
`approveDeliverable`); see `docs/kanban-permissions.md`.

---

## Brand-side surfaces

The brand workspace consumes several of these flows from the other side:

- `connections.browseAgencies` (`connections.ts:437`) — brand discovery of
  verified default agencies (by name/description/email/discipline, UNION any
  agency owning a matching service).
- `connections.recommendedAgencies` (`connections.ts:506`) — default agencies
  ranked by amortized project volume for the empty-state rail.
- `connections.requestAgencyConnection` (`connections.ts:540`) — brand
  self-connect (auto-accept), opening threads and provisioning Info Hub
  sections.
- `connections.brandAgenciesWithStats` (`connections.ts:562`) — connected
  agencies with per-agency project stats for the brand's Agencies table.
