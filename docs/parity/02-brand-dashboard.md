# Brand Owner Experience

This is the canonical specification for the brand-owner surface: the dashboard,
projects board, connected agencies, resources, brand guidelines, info hub, public
profile, and the create/update-brand flows. It describes how the system behaves
and where each behavior lives in the React (client) / tRPC + Drizzle (server)
stack.

## Workspace & brand resolution

The active workspace is derived from the signed-in user's role
(`client/src/hooks/use-active-context.ts`):

- `agencyOwner | agencyStaff` → `agency`
- `brandOwner | brandStaff` → `brand`
- `individualContractor` → `contractor`
- super admins → `admin`

For a brand workspace, the **active brand** is `user.selectedBrandId`, falling
back to the first membership returned by `brands.mine` when no explicit selection
is stored (`use-active-context.ts:25,45`). `brands.mine`
(`server/src/routers/brands.ts:37`) joins `userBrands → brands` for the current
user, so the same path serves both brand owners and brand staff. `activeBrand`
exposes the full brand record (colors, logos, typography, contact fields) to the
brand screens.

The sidebar's brand navigation is assembled in
`client/src/components/layout/nav-items.ts:82-97`: Dashboard, Proposals,
Marketplace, Brand Profile, Info Hub, Projects, My Documents, Resources &
Templates, Payments, Subscriptions, Team, Agencies. Visibility is gated by role
and staff permissions (`brandDashboard`, `brandProjects`, `brandBusinessInfo`,
`documents`, `resources`, `staffManagement`, etc.).

Routes are registered in `client/src/App.tsx` (brand-scoped routes at lines
244–303; public routes at 106–110).

---

## 1. Brand Dashboard (home screen)

Route `/brand-dashboard` → `DashboardPage` (`client/src/pages/dashboard.tsx`).
`DashboardPage` branches on workspace and renders `BrandDashboard` for brands
(`dashboard.tsx:41,77`). Stat data comes from `brands.dashboardStats`
(`server/src/routers/brands.ts:47`); the project rails come from `projects.list`
(`dashboard.tsx:80-85`).

Layout (top to bottom):

- **Header** — `PageHeader` "Welcome back, {firstName}" / "Here's a snapshot of
  your brand." with a primary **"Purchase a service"** action linking to
  `/marketplace` (`dashboard.tsx:110-114`).
- **Stats grid** — four cards (`dashboard.tsx:115-120`):
  - **Active projects** (rocket icon) — count of non-completed projects; links to
    `/brand-projects`.
  - **Pending actions** (bell icon) — unanswered proposals (`sent`/`viewed`) plus
    projects in `clientApproval`; highlighted when `> 0`; links to `/tasks`
    (`brands.ts:51-64`).
  - **Connected agencies** (building icon) — count of brand↔agency connections;
    links to `/agencies`.
  - **Team members** (group icon) — count of active brand staff; links to
    `/staff`.
- **Active Projects rail** (`dashboard.tsx:123-149`) — section header with
  "View All" → `/brand-projects`; a horizontal scroll of up to 4 non-completed
  projects as 280px cards. Each card shows a color-coded status pill (mapped via
  `PROJECT_STATUS`, `dashboard.tsx:20-31`), the project title (2-line clamp), and
  "Created {date}". Tapping a card opens `/project/{id}`. Empty state: "No active
  projects yet."
- **Recent Activity** (`dashboard.tsx:151-176`) — up to 5 most-recent projects as
  a list ("Status: {label}", activity icon), each linking to `/project/{id}`.
  Empty state: "No recent activity."
- **No-brand state** (`dashboard.tsx:88-100`) — when no brand is selected, an
  `EmptyState` ("No Brand Selected") with a **Create Brand** action → `/create-brand`.

Loading states render skeletons for the stat cards and both rails.

| Element | Spec | Source |
|---|---|---|
| Header CTA | "Purchase a service" → `/marketplace` | `dashboard.tsx:110-114` |
| Stats grid | Active projects / Pending actions / Connected agencies / Team members | `dashboard.tsx:115-120`, `brands.ts:47-65` |
| Active Projects rail | up to 4 non-completed, 280px cards, status pill | `dashboard.tsx:123-149` |
| Recent Activity | up to 5 most-recent projects | `dashboard.tsx:151-176` |
| No-brand state | EmptyState + Create Brand | `dashboard.tsx:88-100` |

---

## 2. Brand Projects (Kanban board)

Route `/brand-projects` → `ProjectsBoardPage`
(`client/src/pages/projects-board.tsx`), the shared board used by both brand and
agency workspaces. Scope is chosen from the active context: brands query by
`brandId`, agencies by `agencyId` (`projects-board.tsx:117,124`). Board data is
served by `projects.board` (`server/src/routers/projects.ts:388`); filter facets
come from `projects.boardFacets` (`projects.ts:496`).

- **Nine-stage pipeline** — Client Brief, Future Phases, Brief, Allocate,
  Production, Internal Approval, Revision, Client Approval, Completed
  (`projects-board.tsx:30-40`). Drag-and-drop uses `@dnd-kit` with optimistic
  status updates via `projects.setStatus` (`projects-board.tsx:220-243`).
- **Drag gating** — a card is draggable only when the server granted at least one
  `allowedTransitions` entry; valid/invalid drop targets are highlighted while
  dragging (`projects-board.tsx:266-267,425-432,459`). The server re-validates
  every transition and runs its side effects regardless of the client gate.
- **Client Approval flow** — dropping into a stage that requires confirmation
  resolves to a workflow action (`resolveDropAction`) and opens
  `WorkflowTransitionHost` (`projects-board.tsx:269-286,399-407`). The client
  approval decision (approve / reject with reason) calls
  `projects.clientApprovalDecision` (`workflow-transition-dialogs.tsx:99`;
  `projects.ts:1159`). Direct transitions (e.g. start revision, move to client
  brief) bypass the dialog.
- **Search & filters** — debounced server-side full-text search plus filter
  dropdowns (`projects-board.tsx:122-195`): a brand filters by **agency** and
  **service type**; an agency filters by **brand**, **service**, and **type**.
  Facet option lists are derived server-side from the unfiltered scope so they
  stay stable as the board narrows.
- **Column visibility** — a "Columns" picker hides/shows stages and persists the
  selection to `user.uiPreferences.hiddenKanbanColumns` via
  `users.updateUiPreference` (`projects-board.tsx:204-210,296,535-570`).
- **Mobile** — search stays inline; filters and the column picker collapse into a
  single "Filters" sheet (`projects-board.tsx:152,322-361`).
- **Card open** — tapping a card navigates to the full project detail page
  `/project/{id}` (`projects-board.tsx:384,467`).
- **Empty states** — "No matching projects" when filters are active, otherwise
  "No projects yet" (`projects-board.tsx:365-370`).

| Element | Spec | Source |
|---|---|---|
| Client Approval | reject-with-reason / approve via workflow dialog | `projects-board.tsx:269-286`, `workflow-transition-dialogs.tsx:99` |
| Agency / Service-Type / Sort filters | server-side facets + filters | `projects-board.tsx:122-195`, `projects.ts:496` |
| Column visibility | hide stages, persisted to uiPreferences | `projects-board.tsx:204-210,535-570` |
| Open project | navigate `/project/{id}` | `projects-board.tsx:384,467` |
| Mobile filters | "Filters" sheet | `projects-board.tsx:322-361` |

---

## 3. Agencies (connected agencies)

Route `/agencies` → `BrandAgenciesPage` (`client/src/pages/agencies.tsx`).

- **Header** — "Agencies" / "All your top verified agencies in one place." with an
  **"Add New Agency"** action that opens the search-and-connect dialog
  (`agencies.tsx:88-97`).
- **Pending Requests** — when `connections.brandPendingRequests`
  (`server/src/routers/connections.ts:243`) returns incoming requests, each is
  shown with avatar, name, "Wants to connect", a **View details** dialog
  (full agency profile via `AgencyProfileView`), and an **Accept Request** button
  calling `connections.acceptBrandRequest` (`connections.ts:414`;
  `agencies.tsx:99-120`).
- **Search + sort** — client-side search by name or discipline and a sort selector
  (Unverified first / Alphabetical / Recently connected)
  (`agencies.tsx:62-75,122-133`).
- **Agencies table** — backed by `connections.brandAgenciesWithStats`
  (`connections.ts:562`). Columns: **Agency** (logo + name + disciplines),
  **Status** (platform-verified mark via `AgencyVerifiedBadge`), **Purchases**,
  **Active**, **Done** (per-agency project counts), and **Actions** = **Chat**
  (opens the brand↔agency thread via `navigateToChat`) + **View Details**
  (`agencies.tsx:172-214`). On mobile the table collapses to stacked cards
  (`agencies.tsx:143-169`).
- **Agency Details dialog** — logo, name, email; **Purchase statistics** (Total /
  Active / Completed); **Active projects breakdown** chips (Brief / Allocate /
  Production / Approval); About; Disciplines (`agencies.tsx:244-296`).
- **Recommended Agencies empty state** — when the brand has no connections or
  requests, the table area renders `RecommendedAgencies`, a grid of platform
  default agencies (`connections.recommendedAgencies`, `connections.ts:506`) with
  per-card **Add Agency** buttons (`agencies.tsx:307-347`).
- **Add New Agency dialog** — live search over `connections.browseAgencies`
  (`connections.ts:437`); each row shows logo, name, email, and a per-row state
  (Connecting… / Connected / Add Agency) and connects via
  `connections.requestAgencyConnection` (`connections.ts:540`;
  `agencies.tsx:349-410`). Brand-initiated connections auto-accept.

| Element | Spec | Source |
|---|---|---|
| Add New Agency | search-and-connect dialog, brand self-initiates | `agencies.tsx:349-410`, `connections.ts:437,540` |
| Recommended agencies | platform-default grid empty state | `agencies.tsx:307-347`, `connections.ts:506` |
| Per-agency stats | Purchases / Active / Done columns | `agencies.tsx:172-214`, `connections.ts:562` |
| Agency Details dialog | stats + breakdown + about + disciplines | `agencies.tsx:244-296` |
| Chat action | open brand↔agency thread | `agencies.tsx:79-82,206` |
| Verified badge | platform-verified mark | `components/agency-verified-badge` |
| Search + sort | name/discipline search, 3 sort modes | `agencies.tsx:62-75,122-133` |

---

## 4. Resources & Templates

Route `/resources` → `BrandResourcesPage`
(`client/src/pages/brand/resources.tsx`). Browse data is served by
`resources.brandList` (`server/src/routers/resources.ts:110`), which returns every
**accepted** resource — platform (admin) resources plus any super-admin-approved
agency upload — each carrying the uploading agency's name for attribution. Pending
agency uploads stay hidden until approved.

- **Toolbar** — full-text search (title or description, server-side) and a **Sort**
  selector (Newest / Oldest / Title A–Z / Z–A) (`resources.tsx:54-66`).
- **Category filter** — multi-select chip bar: All, Templates, White Papers,
  Checklists, Guides, Legal, Financial, Marketing, Operations, AI Prompts
  (`resources.tsx:21,68-72`).
- **Resource grid** — cards show title, a **Platform** badge or a clickable agency
  chip (opening that agency's profile), description, category chips, upload date,
  and an **Open** button that launches the link or opens the file viewer
  (`resources.tsx:80-114`). Paginated via `Pagination` (`resources.tsx:115`).
- **Empty state** — "No resources found."

**Upload / management & moderation.** Resource creation is `resources.create`
(`resources.ts:43`), accepting either an uploaded file `url` or a `linkUrl` (both
URL-validated by zod), plus title, description, and categories. Brand-owned
resources (no `agencyId`) are auto-accepted (`acceptedAt` stamped immediately);
agency uploads stay pending and notify moderators
(`onResourcePendingApproval`). Super admins moderate via `resources.adminList`,
`accept`, `reject`, `remove`, and author global resources via `createGlobal`
(`resources.ts:30-98`).

| Element | Spec | Source |
|---|---|---|
| Browse screen | accepted platform + agency resources | `resources.tsx:25`, `resources.ts:110` |
| Sort | newest/oldest/A–Z/Z–A | `resources.tsx:60-65` |
| Category filter | multi-select chips | `resources.tsx:68-72` |
| Accept / pending workflow | brand auto-accept, agency pending → admin accept | `resources.ts:43-58,75-83` |
| Link-vs-file + URL validation | `url` or `linkUrl`, both validated | `resources.ts:44` |

---

## 5. Document Locker

The Document Locker is fully specified in
**[`docs/document-locker.md`](../document-locker.md)** — the source-of-truth for
that feature. Route `/documents` → `BrandDocumentsPage`
(`client/src/pages/brand/documents.tsx`), backed by `server/src/routers/files.ts`.

It provides three tabs (Agency / Public Brand Assets / Private), folders with
breadcrumbs, recursive delete, OS-style drag reorder/move, upload, agency filter
chips, cross-tab search by name + project + agency, and in-app file viewing.
Documents are auto-populated from chat, logos, deliverables, Info Hub, proposals,
project briefs and questionnaires (insert-only hooks in
`server/src/modules/locker/record.ts`). Agencies get a read-only, content-gated
view (`files.clientView`), and a document may be associated with many agencies
(`agencyIds`). See the feature doc for the full model.

---

## 6. Brand Guidelines

Route `/brand-guidelines` → `BrandGuidelinesPage`
(`client/src/pages/brand/brand-guidelines.tsx`). Form state seeds from
`activeBrand` and persists via `brands.update` (`server/src/routers/brands.ts:119`,
guarded by `assertBrandAccess(..., 'brandGuidelines')`).

A centered card (max 1000px) titled "Brand Guidelines" with a **Save Changes**
header action (`brand-guidelines.tsx:78-87`). Sections:

- **Brand Colors** — add via a color dialog (name + preset/custom picker); colors
  persist as `"Name|#HEX"` entries with removable swatch chips
  (`brand-guidelines.tsx:90-104,186-211`).
- **Logos** — upload to storage (`uploadBrandFile(brandId, 'logos', file)`,
  `client/src/pages/brand/storage.ts`), shown as an image grid with remove and an
  uploading spinner; clicking opens the file viewer (`brand-guidelines.tsx:61-72,107-124`).
- **Typography** — add a font with a nickname; persists as `"Nickname|FontFamily"`
  entries with removable chips (`brand-guidelines.tsx:127-141,216-236`).
- **Tone of Voice** and **Key Messaging** — large multiline text fields
  (`brand-guidelines.tsx:144-161`).

Saving sends `colors`, `logoUrls`, `typography`, `toneOfVoice`, `keyMessaging` to
`brands.update`, which also mirrors logo URLs into the locker's Public Brand
Assets (`brands.ts:16-34,144-154`). A dedicated `brands.updateLogo` mutation
(`brands.ts:161`) persists logos and the primary `logoUrl` after upload.

| Element | Spec | Source |
|---|---|---|
| Guidelines editor | colors / logos / typography / tone / messaging | `brand-guidelines.tsx:27` |
| Persist mutation | `brands.update` (+ `brands.updateLogo`) | `brands.ts:119,161` |
| Logo storage upload | `uploadBrandFile` → storage, mirrored to locker | `storage.ts`, `brands.ts:16-34` |

---

## 7. Business Info / Info Hub Forms

Route `/info-hub` → `InfoHubPage` → `InfoHubManager`
(`client/src/pages/brand/info-hub.tsx`). The same manager backs the super-admin
per-brand view at `/super-admin/brands/:id/info-hub` (`AdminBrandInfoHubPage`).

- **Header** — "Info Hub Forms" with **Share Profile** (copies
  `{origin}/public/brand/{brandId}` to the clipboard) and **Create Section**
  (`info-hub.tsx:139-150,106-110`).
- **Sections list** — the brand's SPOT components from `spot.listComponents`
  rendered as cards with public/private/secret badges, per-section answer editing
  (`spot.updateAnswers`), publish toggle (`spot.toggleVisibility`), a per-section
  public share link (`/public/brand/form/{componentId}`), and remove
  (`spot.deleteComponent`) (`info-hub.tsx:206-323`).
- **Reorder** — the brand owner drags sections to reorder; order persists via
  `spot.reorderComponents` (`info-hub.tsx:119-120,172-188`).
- **Create Section** — a dialog with two modes: **From template** (the section
  library, server-scoped so a brand only sees platform/global templates) and
  **Add new** (a custom section builder). A plain brand owner builds a
  template-less section with questions stored inline; agencies and super admins
  build reusable templates (`info-hub.tsx:327-433`).
- **Empty state** — "No sections yet" with a Create Section action.
- **Agency-managed scope** — when an agency manages a connected brand's hub
  (`actingAgencyId`), it may only edit/reorder the sections it owns; everything
  else is read-only ("Managed elsewhere").

| Element | Spec | Source |
|---|---|---|
| Info Hub screen | SPOT components manager | `info-hub.tsx:28,67` |
| Create Section + reorder | template/custom builder, drag reorder | `info-hub.tsx:172-188,327-433` |
| Share Profile | copy `/public/brand/{id}` | `info-hub.tsx:106-110` |

---

## 8. Public Brand Profile

Public, unauthenticated routes (`client/src/App.tsx:106-110`):

- `/public/brand/:id` → `PublicBrandProfilePage`
- `/public/brand/form/:componentId` → `PublicBrandFormPage`

Both live in `client/src/pages/brand/public-brand-profile.tsx`.

- **Full profile** — `spot.publicProfile` returns the brand banner (logo or
  initial avatar + name + website link) and its public, non-secret sections,
  rendered read-only via `SpotComponentView` (`public-brand-profile.tsx:132-164`).
  Empty/error: "No public information available." / "Info Hub not found".
- **Single shared section** — `spot.publicComponent` renders one public section
  under the same banner (`public-brand-profile.tsx:168-190`). Error: "Section not
  found".

`brands.byId` is a `publicProcedure` (`brands.ts:67`) so brand identity is
fetchable without authentication.

| Element | Spec | Source |
|---|---|---|
| Public profile page | `/public/brand/:id`, public sections | `public-brand-profile.tsx:132`, `spot.publicProfile` |
| Public single-form page | `/public/brand/form/:id` | `public-brand-profile.tsx:168`, `spot.publicComponent` |

---

## 9. Create / Update Brand & multi-brand

- **Create Brand** — route `/create-brand` → `CreateBrandPage`
  (`client/src/pages/brand/create-brand.tsx`). Form fields: Business Name
  (required), Website (URL-validated, normalized), Business Phone. Supports
  `?ref=<token>` (seeds the brand id + `referralToken`), `?name=` prefill, and
  `?proposalToken=` (connects a proposal after creation). Submitting calls
  `brands.create` (`server/src/routers/brands.ts:78`), which inserts the brand,
  links it via `userBrands`, sets `selectedBrandId`, promotes the user to
  `brandOwner` if they have no role yet (never downgrading), seeds default Info
  Hub sections, and routes to `/brand-dashboard` (`create-brand.tsx:39-70`).
- **Update Brand Profile** — route `/brand-profile` → `BrandProfilePage`
  (`client/src/pages/brand/brand-profile.tsx`). A Business Information form
  (Business Name, Contact Name, Email, Phone, Website, Industry, Address, ABN)
  seeded from `activeBrand` and saved via `brands.update` (`brands.ts:119`), with a
  **Share Profile** action and quick links into Brand Guidelines, Info Hub,
  Document Locker, and Resources (`brand-profile.tsx:29,75-127`). Website is
  normalized (bare domains get an `https://` scheme) before saving.
- **Multi-brand** — the active brand resolves from `user.selectedBrandId` with a
  first-membership fallback (`use-active-context.ts:25`). `brands.create` and
  `brands.claimBrand` both set `selectedBrandId` (`brands.ts:104-107,254-257`).
  `brands.mine` serves both brand owners and brand staff.

| Element | Spec | Source |
|---|---|---|
| Create Brand flow | name/website/phone, role assign, select, referral, proposal token | `create-brand.tsx`, `brands.ts:78` |
| Update Brand Profile | full business-info form + quick links | `brand-profile.tsx:29` |
| Multi-brand resolution | `selectedBrandId` + first-membership fallback | `use-active-context.ts:25`, `brands.ts:104-107` |

---

## 10. Cross-cutting brand behaviors

- **Page chrome** — brand screens use the shared `PageHeader` (title / description
  / action). The brand dashboard supplies a "Purchase a service" action; Info Hub
  and Brand Profile supply Share Profile / Create Section / Save actions.
- **Loading states** — brand screens render skeletons while data loads.
- **Verification** — connected and recommended agencies display the
  platform-verified mark (`AgencyVerifiedBadge`), and the Agencies list can sort
  unverified-first.
- **Branding** — colors, logos, typography, tone of voice, and key messaging are
  editable on the Brand Guidelines screen and persisted via `brands.update`.
- **Backend coverage** — `files`, `resources`, `brands`, `connections`, and `spot`
  routers all back live brand UI: the locker, resource browse + moderation, brand
  create/update + guidelines, brand-initiated agency connection (auto-accept), and
  the Info Hub / public profile.

---

## Appendix — Brand routes

| Screen | Route | Page component |
|---|---|---|
| Brand Dashboard | `/brand-dashboard` | `DashboardPage` → `BrandDashboard` (`pages/dashboard.tsx`) |
| Brand Projects | `/brand-projects` | `ProjectsBoardPage` (`pages/projects-board.tsx`) |
| Agencies | `/agencies` | `BrandAgenciesPage` (`pages/agencies.tsx`) |
| Resources & Templates | `/resources` | `BrandResourcesPage` (`pages/brand/resources.tsx`) |
| Document Locker | `/documents` | `BrandDocumentsPage` (`pages/brand/documents.tsx`) |
| Brand Guidelines | `/brand-guidelines` | `BrandGuidelinesPage` (`pages/brand/brand-guidelines.tsx`) |
| Info Hub Forms | `/info-hub` | `InfoHubPage` (`pages/brand/info-hub.tsx`) |
| Brand Profile | `/brand-profile` | `BrandProfilePage` (`pages/brand/brand-profile.tsx`) |
| Public Brand Profile | `/public/brand/:id` | `PublicBrandProfilePage` (`pages/brand/public-brand-profile.tsx`) |
| Public Brand Section | `/public/brand/form/:componentId` | `PublicBrandFormPage` (`pages/brand/public-brand-profile.tsx`) |
| Create Brand | `/create-brand` | `CreateBrandPage` (`pages/brand/create-brand.tsx`) |
