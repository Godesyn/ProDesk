# Info Hub (SPOT) — templates, components & default provisioning

The **Info Hub** (internally **SPOT**) is the brand-profile custom-form system: a
brand answers structured sections (brand basics, guidelines, assets, …) that an
agency can read, that flow into the Document Locker, and that can be published to
the brand's public profile.

Server: `server/src/routers/spot.ts` (+ `modules/spot/provision.ts`).
Client: `client/src/pages/brand/info-hub.tsx`, `pages/agency/info-hub-template-manager.tsx`,
`pages/super-admin/info-hub-templates.tsx`.

## Two layers: templates vs components

- **Template** (`spot_forms`) — a reusable *definition*: a name + a list of
  questions. Owned by an agency or the platform — **never a brand**.
- **Component** (`spot_components`) — a section as it actually renders on one
  brand's Info Hub (its answers, order, public/secret flags). A component either
  references a template (`templateId` set — it snapshots the template's id + name
  and reads questions from it) **or** is template-less (`templateId` null — a
  brand's own section, with its questions stored inline in `spot_components.questions`).

Reorder/visibility/answers always live on the component. Questions live on the
template for template-backed sections, or inline on the component for brand-own
sections.

## Templates belong to agencies or the platform — never brands

This is a hard rule: **no `spot_forms` row is ever scoped to a brand**, and **a
brand never even sees another party's templates**.

| `agencyId` | `brandId` | Scope | Can be default? |
|------------|-----------|-------|-----------------|
| set | null | **Agency** template — reusable across all the agency's brands | ✅ |
| null | null | **Global** template — platform-wide (super-admin only) | ✅ |
| ~~set~~ | ~~set~~ | **Brand templates do not exist.** | — |

Who creates templates:
- An **agency** — from its Info Hub setup (`/section-library`), or when it builds a
  section on a client's hub (`createForm` / `createCustomSection` with an agency).
- A **super-admin** — global templates (`/super-admin/info-hub-templates`).

A plain **brand owner** cannot create a template. When a brand builds its own
section, `createCustomSection` writes a **template-less component** (questions
inline) — nothing lands in `spot_forms`. `createForm` has no `brandId` input at all.

Permission gate: `assertFormOwnership` — agency templates need agency
`businessInfo`, global templates are super-admin only. (The legacy brand branch is
retained only to let any pre-existing brand-scoped row be edited/cleaned up.)

## Who sees which templates (visibility)

`spot.listFormsForBrand({ brandId, agencyId? })` powers the "From template" picker
and is deliberately scoped server-side so a brand can never view an agency's templates:

- **Brand self-service** (no `agencyId`) → **global/platform templates only**.
- **Agency managing a client's hub** (passes its `agencyId`) → **that agency's own
  templates only**.

Rendering existing sections never goes through this picker: `spot.listComponents`
returns each component with its **resolved questions** already attached (from its
template, or inline for a brand-own section), so a brand can render and fill an
agency-added section without ever being handed the agency's template
(`resolveComponentQuestions`).

## Brand-own custom sections (template-less)

When a plain brand owner uses the Info Hub "Add new" builder, the section is a
`spot_components` row with `templateId = null` and its questions stored inline in
`spot_components.questions` (added in migration `0020_spot_component_inline_questions`,
which also drops the `template_id NOT NULL` constraint). No `spot_forms` row is
created, so the section never leaks into any picker and never becomes a template.

- **Create**: `createCustomSection` (brand branch) inserts the template-less component.
- **Fill / publish / reorder / delete**: identical to template-backed components.
- **Question editing after creation**: not offered (matching the prior brand flow —
  only agency-owned sections expose an "Edit template" affordance).

Question resolution everywhere (`resolveComponentQuestions`, used by
`listComponents`, `publicProfile`, `publicComponent`, the locker feed, and the
backfill script): template-backed → read from `spot_forms`; template-less → read
the component's inline `questions`.

## The `isDefault` flag — auto-attach to brands

Marking an **agency** or **global** template as default means: *every brand it
applies to automatically gets this section in their Info Hub* (created empty,
ready to fill). Brand-own sections are template-less, so they can never be default.

Fan-out targets (`brandsForDefaultForm`):
- **Agency default** → every brand currently CONNECTED to that agency.
- **Global default** → EVERY brand on the platform.

Lifecycle (all in `modules/spot/provision.ts`, ported from the Firestore
`on_form_written` / `on_brand_written` triggers):

- **Flag turned ON / default created** → `provisionDefaultForm` materialises an
  empty component on every target brand that doesn't already have one
  (`ensureComponentForBrand` is idempotent — it skips brands that already have a
  component for that template).
- **Flag turned OFF** → `deprovisionDefaultForm` deletes the auto-created
  components **only if still empty** (`componentIsEmpty`). Any brand that already
  answered keeps its section and data — default-off never destroys real answers.
- **A new brand is created** → global defaults are applied (`brands` router →
  `applyDefaultFormsToBrand({ brandId })`, no agency).
- **A brand becomes connected to an agency** → that agency's defaults are applied
  (see chokepoint below).

`applyDefaultFormsToBrand` is **idempotent** and safe to call on every connection
event, new link or not.

> Provisioning is a one-time fan-out, not a live link. Toggling default only
> adds/removes components. When a default template's *questions* later change,
> answers for deleted questions are pruned from existing components — but only
> when that answer is empty (`pruneRemovedQuestionAnswers`), so client data is
> never silently discarded.

## The connection chokepoint — `connectBrandToAgency`

Default provisioning on connect must happen **however** a brand becomes linked to
an agency. To guarantee that, every linking path funnels through one helper:

`server/src/modules/connections/connect.ts` → `connectBrandToAgency(brandId, agencyId, db)`
1. Ensure the `brand_agency_connections` row (idempotent).
2. Open the brand↔agency chat threads on first creation (`ensureChatConnection`).
3. `applyDefaultFormsToBrand` — **always** (idempotent), because the row may
   already exist (e.g. created earlier by a contractor allocation) before the
   brand formally "connects", and the defaults must still land.

It returns `{ connection, created }` so callers can gate one-time side effects
(e.g. the agency-notification email) on `created`.

Every connection-creation path routes through it:

| Path | Location |
|------|----------|
| Brand accepts an agency's request (explicit) | `connections.ts` → `acceptBrandRequest` |
| Brand accepts an agency's request (via the task action) | `tasks.ts` `connectionRequest`/`brandAgency` case |
| Brand self-connects (auto-accept) | `connections.ts` → `requestAgencyConnection` |
| Contractor allocated to a brand's project | `projects.ts` allocate → contractor branch |
| Marketplace / proposal **purchase** | `modules/billing/fulfillment.ts` → `fulfillPurchase` |

### Purchase → connections (multi-agency)

A single purchase can contain services owned by **multiple** agencies, and a
proposal also has a **sales agency** (the agency that sent it,
`proposalSentByAgencyId`). On fulfilment, the brand is connected to the union of:
- every distinct service-owning agency on the purchase items, **plus**
- the proposal's sales agency.

Each connection provisions that agency's default Info Hub sections. The block is
best-effort (a failure is logged, never fails fulfilment) and runs once
(`fulfillPurchase` early-returns if the purchase already spawned projects).

## Why this design (the bug it fixed)

Previously each path provisioned defaults independently, and two paths missed it:
the **task-action accept** (`tasks.ts`) and **contractor allocation**
(`projects.ts`) called `ensureChatConnection` directly (no provisioning), and the
explicit accept only provisioned inside an `if (connection)` guard that was
skipped whenever the connection row already existed. Marketplace/proposal
purchases created no connection at all. Centralising on `connectBrandToAgency`
removes that divergence by construction.
