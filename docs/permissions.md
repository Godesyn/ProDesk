# Staff permissions — catalog & rules

Staff members of an **agency** or a **brand** hold a granular permission set
(`staff.permissions`, a Postgres `staff_permission[]`). **Owners** of an org and
**super-admins** bypass all permission checks; only active _staff_ are gated.

## The one rule: permissions are context-scoped

Every permission belongs to exactly one org context — **agency** or **brand**.
A check always runs against the caller's staff row in _that_ org:

- `assertAgencyAccess(ctx, agencyId, perm)` — `perm: AgencyPermission`
- `assertBrandAccess(ctx, brandId, perm)` — `perm: BrandPermission`
- `assertBrandViewAccess(ctx, brandId, { brandPermission, agencyPermission })` —
  admits the brand owner/staff (checked vs `brandPermission`) **or** a connected
  agency's owner/staff (checked vs `agencyPermission`). Used where a connected
  agency may also act on a brand (Info Hub, billing screens).

  This is an **either/or** gate, and it is critical that it behaves as one: the
  user is granted if **any** of their identities qualifies, and a failing identity
  **falls through** to the next — it never short-circuits. (A previous bug threw on
  the brand-staff branch when that staffer lacked the brand permission, so a user
  who was both brand staff _and_ the connected agency's owner was denied before the
  agency identity was ever considered. Any new shared brand/agency endpoint must
  follow the same "try every identity, deny only if none qualify" rule — either via
  this helper or a try-one-then-the-other fallback, as `projects.byId` and the
  proposal viewer do.)

`AgencyPermission` and `BrandPermission` are distinct **TypeScript unions**
(`server/src/trpc/permissions.ts`). This is a structural guard: a brand check can
only be handed a brand permission and an agency check only an agency permission —
passing the wrong context's permission is a **compile error**. This is what keeps
the classes of bug below from recurring.

> Some permission _names_ appear in both unions (`documents`, `resources`,
> `proposals`, `subscriptions`, `staffManagement`, `infin8`, `chatWithStaffs`).
> That is fine: each means "this capability for THIS org's own data", and the
> check runs against the correct org's staff row. Only genuinely different
> capabilities get different names (see the `businessInfo` split below).

## Derived (shadow) agencies inherit the brand's members

Every brand has a hidden **derived "shadow" agency** (`agencies.derived_from_brand_id`
→ the brand; `brands.derived_to_agency_id` → the agency). It is the vehicle a brand
uses to publish its own services (dashboard → Products & Services → Services tab),
and it has no separate staff of its own.

So `assertAgencyAccess` has a fallback: when the target agency is derived
(`derivedFromBrandId` set) and the caller is **not** an agency owner/staff, the
check delegates to `assertBrandAccess(ctx, derivedFromBrandId)`. The brand owner
already matches as the derived agency's owner; this admits **active brand staff**
too. No agency-level permission is required — brand membership alone gates the
brand's own catalogue on the shadow agency. This keeps a single
chokepoint: every `services.*` procedure routes through `assertAgencyAccess`, so
brand members get catalog access on the shadow agency without per-procedure logic.

Note the fallback is **not** scoped to `catalog` — a brand member satisfies
`assertAgencyAccess` for the shadow agency regardless of the requested permission.
In practice only `services.*` is ever called against a shadow agency; the sensitive
agency surfaces (bank account, Stripe, workflow settings) are never exposed for a
derived agency. If that changes, scope the fallback to `permission === 'catalog'`.

## Agency permissions

| Permission                                                  | Gates (screens / APIs)                                                                                                                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agencyDashboard`                                           | Agency dashboard (`/agency-dashboard`)                                                                                                                                                                         |
| `agencyProjects`                                            | View Projects board (`/agency-projects`); implied by any workflow perm or role designee                                                                                                                        |
| `addBrief`                                                  | Kanban: Briefing transitions                                                                                                                                                                                   |
| `allocatePeople`                                            | Kanban: Manage Allocations transitions                                                                                                                                                                         |
| `approveDeliverable`                                        | Kanban: Approval Manager transitions                                                                                                                                                                           |
| `catalog`                                                   | Services & packages catalog (`/catalog`; `services`, `packages` routers). For a brand's **derived (shadow) agency**, brand owner/staff get this without the permission — see "Derived (shadow) agencies" above |
| `clients`                                                   | Manage connected clients (`/clients`, `/clients/:id`) — incl. **a client's Info Hub sections**, client files, connection requests                                                                              |
| `proposals`                                                 | Agency proposals (`/proposals`; `proposals` router, agency side)                                                                                                                                               |
| `manageResources`                                           | Agency resource library (`/manage-resources`; `resources` router)                                                                                                                                              |
| `manageContractors`                                         | Contractors (`/agency-contractors`; contractor connection ops)                                                                                                                                                 |
| `staffManagement`                                           | Agency Team (`/staff`; `staff` router, agency side)                                                                                                                                                            |
| `documents`                                                 | Agency documents                                                                                                                                                                                               |
| `resources`                                                 | View agency resources/templates                                                                                                                                                                                |
| `chatWithContractors` / `chatWithStaffs` / `chatWithBrands` | Chat scope (which counterpart identities the staffer may message)                                                                                                                                              |
| `rolesAndCommissions`                                       | Roles & Commissions (`/workflow-settings`; designees + commission splits)                                                                                                                                      |
| `invoice`                                                   | Agency invoices (`/agency-invoices`)                                                                                                                                                                           |
| `subscriptions`                                             | Agency subscriptions (`/agency-subscriptions`)                                                                                                                                                                 |
| `bankAccount`                                               | Bank account & payouts (`/agency-bank-account`; `payouts` router)                                                                                                                                              |
| `agencyInfo`                                                | Agency profile (`/edit-agency`; `agencies.updateProfile`)                                                                                                                                                      |
| `agencyBusinessInfo`                                        | The agency's **own Info Hub template library** (`/section-library`; `spot.listForms`/`createForm`/`updateForm`/`deleteForm` for the agency's templates)                                                        |

## Brand permissions

| Permission                    | Gates (screens / APIs)                                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brandDashboard`              | Brand dashboard (`/brand-dashboard`)                                                                                                                                                                                                        |
| `brandProjects`               | Brand projects (`/brand-projects`; `projects` router, brand side)                                                                                                                                                                           |
| `infin8`                      | Marketplace (`/marketplace`)                                                                                                                                                                                                                |
| `brandBusinessInfo`           | The brand's **own Info Hub** + Brand Profile (`/info-hub`, `/brand-profile`; `spot` component ops on the brand's own sections)                                                                                                              |
| `brandGuidelines`             | Brand guidelines (`/brand-guidelines`; `brands` router)                                                                                                                                                                                     |
| `documents`                   | Brand documents (`/documents`; `files` router, brand side)                                                                                                                                                                                  |
| `resources`                   | Resources & templates (`/resources`)                                                                                                                                                                                                        |
| `links` / `linksViewer`       | **Links & QR** tool (`clients/links`). `links` = editor (create/edit/enable/delete links + campaigns and their schedules); `linksViewer` = read-only                                                                                                          |
| `reviews` / `reviewsViewer`   | **Reviews** tool (`clients/reviews`, Verdiict). `reviews` = editor (manage locations, platforms, embeds, requests, directory); `reviewsViewer` = read-only                                                                                  |
| `payments` / `paymentsViewer` | **Payments** tool (`clients/payments`, EziQuotes). `payments` = editor (create/send proposals, take payments, refunds); `paymentsViewer` = read-only. `payments` also gates the brand payments tab (`/payments`) in Prodesk                 |
| `signatures`                  | **Email Signatures** tool (`clients/signatures`, SIGKITT). Single **manage** role — there is no viewer (the enum's `signaturesViewer` is DEPRECATED: never granted, accepted by no gate; kept only because Postgres can't drop enum values) |
| `subscriptions`               | Brand subscriptions tab (`/subscriptions`)                                                                                                                                                                                                  |
| `staffManagement`             | Brand Team & connected Agencies (`/staff`, `/agencies`) — and every tool's own scoped Team panel                                                                                                                                            |
| `proposals`                   | Brand proposals (`/proposals`; `proposals` router, brand side)                                                                                                                                                                              |
| `chatWithStaffs`              | Chat with the connected agency's staff                                                                                                                                                                                                      |

## Cross-frontend team (one team, per-tool access)

A brand's staff are **one team**. There is a single `staff` row per teammate per
brand, and it is visible in **every** frontend — someone invited from the Links
app is the same staff member the Reviews app sees. What varies per frontend is
**which tool permission** that teammate holds. The per-tool brand permissions are:

| Tool (frontend)                         | Editor       | Viewer                 |
| --------------------------------------- | ------------ | ---------------------- |
| Links & QR (`clients/links`)            | `links`      | `linksViewer`          |
| Reviews (`clients/reviews`)             | `reviews`    | `reviewsViewer`        |
| Payments (`clients/payments`)           | `payments`   | `paymentsViewer`       |
| Email Signatures (`clients/signatures`) | `signatures` | _(none — manage-only)_ |

**Two ways to manage this team, both editing the same `staff.permissions`:**

1. **Core Prodesk** (`clients/prodesk` → `/staff`, the shared `StaffPage`) shows
   the **full** permission matrix. The brand permissions are grouped **by the
   frontend they unlock** — "Links & QR", "Reviews", "Payments", "Email
   Signatures" each get their own section (`PERMISSION_GROUPS.brand` in
   `packages/shared/src/pages/agency/constants.ts`) — so this screen reads as a
   per-app access grid across the whole team.

2. **Each tool's own scoped Team panel** (links `SettingsTeam.tsx`, reviews
   `Team.tsx`, payments Settings → Team tab, signatures `/team`) manages **only
   its own** permission. These panels list **every** active brand teammate — not
   just those who already have the tool's access — so a manager landing in, say,
   Reviews can see a teammate who was added from Links but has **no Reviews
   access yet**, and grant it with one click. The controls per row:
   - has access → role control (Editor/Viewer; Signatures shows just "Can manage")
     - **Revoke access** (strips only this tool's permission, keeps the rest);
   - no access → **Grant access** (adds this tool's permission);
   - plus **Invite** (seeds a brand-new teammate with this tool's permission).

   Grant/revoke go through `staff.updatePermissions` with the _full_ desired
   permission list (add or filter out just the tool's key); revoking access is
   **not** the same as removing the teammate (`staff.remove`, which drops them
   from the brand entirely). All panels gate on `staffManagement` (owners always
   qualify).

**Adding a permission for a new tool:** it must exist in the Postgres
`staff_permission` enum (`db/schema.ts`), the `PERMISSIONS` allow-list
(`routers/staff.ts` — the zod gate for invite/update), and the labels +
per-frontend group (`agency/constants.ts`). The DB enum can hold values the
allow-list/labels don't expose (e.g. the deprecated `signaturesViewer`);
a value is only _usable_ once it's in all three. New satellite
frontends should ship a scoped Team panel — see `clients/_template/README.md`.

## The `businessInfo` split (why three concepts, not one)

`businessInfo` used to be one permission used in **both** contexts, and the Info
Hub mutations gated the agency side on it. But an agency staffer who manages
clients holds `clients`, not the agency's own `businessInfo`, so they were wrongly
denied when editing a client's Info Hub (owners bypassed, hiding it). It is now
three clearly separate things:

| Capability                                                   | Permission                    |
| ------------------------------------------------------------ | ----------------------------- |
| A brand editing its **own** Info Hub                         | `brandBusinessInfo` (brand)   |
| An agency managing its **own** Info Hub **template library** | `agencyBusinessInfo` (agency) |
| An agency managing a **client's** Info Hub sections          | `clients` (agency)            |

So `spot` brand-component mutations use
`{ brandPermission: 'brandBusinessInfo', agencyPermission: 'clients' }`, while the
agency template-library APIs use `agencyBusinessInfo`.

The legacy `businessInfo` enum value is retained in `staff_permission` (Postgres
can't cleanly drop an enum value) but is never produced or honored — existing rows
were migrated by org type in `0021`/`0022` (`agency → agencyBusinessInfo`,
`brand → brandBusinessInfo`).

> Related earlier fix: `invoices.list` for a brand previously checked the agency
> `invoice` permission; a brand viewing its own invoices is now gated by brand
> membership only (matching the route, which has no brand invoice permission).
