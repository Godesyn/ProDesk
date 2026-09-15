# Frontend template

The starting point for every new Prodesk frontend. It is a minimal, working
frontend with **no UI components or design opinions of its own** — just the
shared auth + context + theming scaffolding that all frontends need.

When the request is _"create a new frontend for &lt;feature&gt;"_, **start here** —
copy this directory, then build the feature on top. Do not hand-assemble a new
frontend from scratch.

## What it already wires (all from `@prodesk/shared`)

- Login / Signup / Forgot + Reset password / Email verification
- Auth confirmation + handoff (subdomain cross-auth for agency white-labeling,
  and cross-frontend sign-in — see below)
- Context selector (agency/brand switcher) and Profile page
- Runtime accent theming via shared `Providers` (`applyStoredAccent()` in `main.tsx`)
- Centralised env access — never read `import.meta.env` directly (enforced by
  the wiring guard); import from `@shared/lib/env` (or `@shared/lib/app-env` /
  `@shared/lib/origins` for deployment-env and cross-frontend hosts)
- Shared design-token base imported in `index.css`, with a per-frontend
  `@theme {}` override block

## Context selector (required in every frontend)

Every frontend must show a **context selector** dropdown so the user can see and
switch the identity they are acting as. The selected context (role +
`selectedAgencyId`/`selectedBrandId`) is persisted **server-side** by
`auth.switchContext` and read back through `auth.me` — it is **shared across all
frontends**: switch brands in one app and every other app follows. Never store
the selection in localStorage or component state.

The rules, maintained canonically by the prodesk frontend and the dashboard
suite:

- **Multi-role frontends** (like prodesk): mount the shared
  `ContextSelector` (`@shared/components/layout/context-selector`) — it lists
  every identity (agencies, brands, contractor, admin), switches via
  `auth.switchContext`, and offers "Add role". This template already mounts it.
- **Brand-only frontends** (dashboard, links, reviews, payments): a
  brand-scoped switcher is fine, but it must (1) resolve the active brand via
  the shared `useActiveContext()` hook (never its own bookkeeping), (2) switch
  through `auth.switchContext` followed by a broad `qc.invalidateQueries()` and
  a navigate home, and (3) call `useEnsureBrandContext()`
  (`@shared/auth/use-ensure-brand-context`) near the top of App so a user who
  arrives with an _agency_ context selected is switched into their first brand
  instead of dead-ending. Keep `useAutoSelectContext()` (already wired) for
  role-less users.

### Filter the switcher to brands this frontend can use (`appPermissions`)

If your tool gates on a brand permission (see "Team & permissions" below), a
staff member should only see the brands where they hold **at least one** of that
tool's permissions — showing a brand they can't do anything with here is a dead
end. Owners always qualify (they bypass permission checks). Wire it in **three
places, all with the SAME permission list** (`brands.mine` supplies each brand's
`isOwner` + `permissions`, so the filtering happens client-side):

1. `useActiveContext({ appPermissions })` — filters the `brands` list and
   resolves `brandId`/`activeBrand` against it.
2. `useEnsureBrandContext({ appPermissions })` — **persists** the fallback
   server-side, so the shared selection (and `auth.me` permissions) stays in
   step with what the switcher shows.
3. `<ContextSelector appPermissions={…} />` — if you mount the shared selector,
   it hides brand options the same way.

Because every `useActiveContext()` call in an app must pass the same list, wrap
it in a **per-app hook** and use that everywhere — e.g. `clients/links`
`useLinksContext()` (`src/app/use-context.ts`) exports both the permission
constant and `useActiveContext({ appPermissions })`. The template shows the
pattern inline via the `APP_BRAND_PERMISSIONS` constant at the top of
`src/App.tsx` (default `undefined` → no filtering; replace it for your tool).

**Edge case — permission revoked while a brand is selected:** if a staffer has
brand X selected and their tool permission for X is removed, the wiring above
falls the initial state back to their first still-accessible brand (persisted by
`useEnsureBrandContext`), or — when no brand qualifies — leaves `brandId` null so
the app lands on its **create-brand** empty state (mirror `CreateBrandOnboarding`
from `clients/links`) instead of a broken screen.

## Cross-frontend navigation & session hand-off

Frontends on sibling `*.prodesk.com` subdomains share the auth session via a
cookie scoped to the registrable domain (`packages/shared/src/lib/supabase.ts`).
A frontend hosted on a **different domain** (e.g. the Links app on `adeyy.com`)
cannot see that cookie — browsers never share cookies across registrable
domains — so the session is carried over with a short-lived, single-use token
instead:

- **Inbound (free with this template):** the `/auth/handoff` route consumes
  `?token_hash=…&next=/path`, redeems the token to establish a session on this
  origin, and routes on to `next`. Nothing to add.
- **Outbound:** to link to another Prodesk frontend, use `useCrossAppOpen()`
  from `@shared/auth/use-cross-app` with a host from `@shared/lib/origins` —
  never a raw `<a href>`. It mints the token (via `auth.createSubdomainHandoff`)
  only when the target can't see this session (different domain, or a different
  localhost port in dev) and opens the plain URL otherwise. Pass
  `{ newWindow: true }` to open in a new window (the convention when leaving a
  launcher-style app, e.g. the dashboard).

Leave everything imported from `@shared` as-is. The only thing you replace to
make it your own is `<LandingPage />` in `src/App.tsx`.

## Side panel (`<AppShell />`, required)

Every frontend wears the **same** side panel — do not hand-roll one.
`src/App.tsx` wraps the authenticated routes in a `Shell` built on
`@shared/components/layout/app-side-panel`. The shared component owns the layout,
the width (one value for all frontends), collapse-to-icons + its persistence, the
mobile drawer, the `BY PRODESK` tag, the **Prodesk Suite row** (→ the dashboard) at the top of
the panel, the Support/Billing tail and Sign out. You supply the logo, the nav
(grouped by category), and exactly one context affordance:

| Your frontend is…                        | Pass                                               | Result                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **brand-level** (most tools)             | `brand={{ brands, activeBrandId, onCreateBrand }}` | Brand dropdown directly under the header. Always clickable — even with one brand — because it's the only route to **New brand**. Reference: `clients/reviews`, `clients/websites`. |
| **multi-role** (agencies _and_ brands)   | `contextSlot={…<ContextSelector/>}`                | The shared context selector in that same slot. Reference: `clients/jobs`.                                                                                                          |
| **user-level** (fans across every brand) | `identity={{ … }}`, neither of the above           | No top dropdown; a plain Profile row above the exit row. Reference: `clients/design`.                                                                                              |

For `onCreateBrand`, either open your own themed modal (`clients/links`,
`clients/reviews`) or mount the shared
`@shared/components/layout/new-brand-dialog` (`clients/websites`, `clients/logo`).

**Colours stay yours.** Never style the panel from a call site: add a
`.psp-theme-<app>` block in your `index.css` (or your kit's stylesheet) that
overrides the `--psp-*` variables, and pass it as `panelClassName`. Light rail
example: `.psp-theme-adeyy` in `clients/links`. Frontends on the base Tailwind
tokens can just use the shared `psp-theme-accent`. The full variable list is
documented at the top of `packages/shared/src/styles/side-panel.css`, which your
`index.css` must `@import` (already wired here).

**Black panel? Pass `psp-ink` too** — `panelClassName="psp-ink psp-theme-<app>"`
(`clients/reviews`, `clients/signatures`, `clients/logo`). That's the shared
dark-rail contract: every light-on-dark wash, the hairlines, the mobile bar and —
the one that used to drift — the **dropdown surface**, which lifts one step off
your `--psp-bg` instead of inverting to white. Your theme block then only has to
supply `--psp-bg` and your accent (`--psp-active` / `--psp-active-fg`). Do not
re-derive those washes per app: that is exactly how Verdiict ended up with a
paper-white brand menu on an ink rail while the other dark panels stayed dark.

## Support (native screen, required)

Every frontend must let users reach customer support from anywhere — and it must
be a **native screen in your app's own look**, not the shared `SupportPage`. That
shared page is styled for the main Prodesk app; dropped into a bespoke skin it
reads as a completely different application. So each tool ships its **own**
`src/pages/Support.tsx` and renders it **inside its normal shell** (sidebar + the
Support nav item highlighted) so support feels like just another screen.

What is shared is the **data layer, not the presentation**:

- `@shared/pages/support/use-support` — the tRPC/query hooks
  (`useSupportTickets`, `useSupportTicket`, `useCreateSupportTicket`,
  `useSupportReply`); they own cache invalidation, you own the toasts/markup.
- `@shared/pages/support/model` — `TicketStatus/Priority/Category` types, the
  `STATUS_LABEL`/`PRIORITY_LABEL`/`CATEGORY_LABEL` + `*_OPTIONS` maps,
  `formatTicketTime`, and `uploadTicketAttachment(pathId, file)`.

The backend router (`trpc.support.*`) is shared and never changes — tickets are
creator-scoped (a user sees only their own).

Build it by **copying this template's `src/pages/Support.tsx`** (a complete
reference: list + "new ticket" form + ticket thread + reply composer, on the
hooks above) and re-skinning the markup with your components/classes. Worked
examples in bespoke kits: `clients/links` (`src/app/pages/Support.tsx`,
`.a*`/`.d*` classes) and `clients/reviews` (`src/app/pages/Support.tsx`, `.v*`
classes). Mount it inside your shell's router (see how `clients/reviews` mounts
`/team`) and add Support to the panel's `tail` — that's where it lives on every
frontend, pinned above the exit row next to Billing (see the side-panel section
above). The reference here uses the shared design tokens only because the template
has no kit of its own.

## Beta programme (`<BetaProgram />`, required)

`src/App.tsx` mounts `<BetaProgram />` (from `@shared/beta/beta-program`) in the
authenticated branch, beside `<PendingInvitePrompt />`. **Keep it.**
`scripts/check-frontend-wiring.mjs` fails the typecheck if a frontend drops it.

It is one mount for the whole beta member experience:

- a countdown while beta access is live, escalating to a banner in the final week;
- the itemised "here's what you'll pay" report once the beta ends — full-screen
  the first time, then reachable from the banner — with per-tool checkboxes, a
  Stripe card form, and activation;
- the floating **Feedback** tab on the right edge (beta access is granted in
  exchange for feedback, so the two ship together).

All of it self-suppresses for users who aren't beta members, and nothing is
fetched until there's a reason to, so mounting it app-wide is free for everyone
else. There is **nothing else to wire**: when a beta lapses, every paid feature
locks on its own because `isBetaUser()` (the one entitlement bypass every gate
funnels through) starts returning false — see `docs/beta-program.md`.

## Team & permissions (one team, per-frontend access)

There is **one shared staff team per brand/agency** — a teammate invited from
_any_ frontend becomes staff of the brand and is visible in **every** frontend's
team screen. What differs per frontend is **which tool permission** they hold.
Each satellite tool gates on its own brand permission(s):

| Tool             | Editor permission | Viewer permission      |
| ---------------- | ----------------- | ---------------------- |
| Links & QR       | `links`           | `linksViewer`          |
| Reviews          | `reviews`         | `reviewsViewer`        |
| Payments         | `payments`        | `paymentsViewer`       |
| Email Signatures | `signatures`      | _(none — manage-only)_ |

So if you build a tool with its own permission, give it a **scoped Team panel**
that behaves like the ones in `clients/links` (`SettingsTeam.tsx`) and
`clients/reviews` (`Team.tsx`):

1. List **every** active teammate of the brand via `trpc.staff.list` — **not**
   only those who already hold your permission. Someone added from another tool
   must be visible here so a manager can grant them access.
2. For each teammate show whether they have **your tool's** access. If they do,
   show a role control (Editor/Viewer) + a **Revoke access** action that strips
   only your permission (keep their other permissions). If they don't, show a
   **Grant access** button that adds your permission.
3. Gate the whole panel on `staffManagement` (owners always qualify).
4. **Invite** seeds a brand-new teammate with your tool's permission.

Grant = `updatePermissions({ id, permissions: [...perms, '<yourPerm>'] })`;
Revoke = `updatePermissions({ id, permissions: perms.filter(p => p !== '<yourPerm>') })`.
Add your permission to the Postgres `staff_permission` enum
(`packages/server-shared/src/db/schema.ts`), the `PERMISSIONS` allow-list
(`routers/staff.ts`), and the labels + **per-frontend group** in
`packages/shared/src/pages/agency/constants.ts` — that group is what the core
**Prodesk** staff editor renders, so your tool gets its own section there. Full
rules: `docs/permissions.md` → "Cross-frontend team".

## Creating a new frontend from this template

1. **Copy the directory** — `cp -r clients/_template clients/<name>`
2. **`package.json`** — set `"name"` to `<name>`.
3. **`vite.config.ts`** — set `__PRODESK_CLIENT__` to `<name>` and pick a unique
   dev `port` (prodesk = 5173, dashboard = 5174, links = 5175).
4. **`index.html`** — set the `<title>`.
5. **`src/App.tsx`** — replace `<LandingPage />` with the frontend's routes. The
   unknown-route fallback is already wired — nothing to edit.

   **Not-found rule** (see the `NOT-FOUND RULE` comment in `App.tsx`): every
   frontend sends an unmatched route to its **own root** (`/`); none renders a
   404 screen. There is exactly **one** implementation —
   `<UnknownRouteRedirect>` from `@shared/components/unknown-route-redirect`.
   **Never** hand-roll a local copy or add a `NotFound`/404 page; changing the
   behaviour everywhere means editing that one file. Mount it **last** in every
   `Switch` a user-typed URL can reach — authenticated _and_ public — because a
   `<Route>` with no `path` matches everything. It fires **automatically** on an
   unmatched route, never from a click. For an account/feature screen you don't
   own (profile, staff, invoices, …), **mount the shared page in-app** instead —
   copy the `/profile` block (`@shared/pages/*` use the same auth + brand/agency
   context, so they just work) and navigate to it with wouter; otherwise the URL
   silently bounces to the root. Auth gating is a separate concern: the
   unauthenticated and role-less catch-alls still redirect to `/login` and
   `/role-selection`, preserving the query string.

6. **Origins env** — if the frontend needs a hosted domain, add a
   `VITE_<NAME>_PRODESK_ORIGIN` to the root `.env` / `.env.example` and the
   `.railway/envs/shared.*.env` files, and expose it in `@shared/lib/origins`.
7. **`src/index.css`** — add any design-token overrides in the trailing
   `@theme {}` block. Never hardcode the accent (`--color-accent`, `--accent-h/s/l`).
8. **Dev wiring (mandatory)** — register the frontend in the `FRONTENDS` table
   of `scripts/dev.mjs` (prefix color + any extra services) and add a
   `"dev:<name>": "node scripts/dev.mjs <name>"` script to the root
   `package.json`. The root `build`/`typecheck` (and the pre-push build) derive
   the workspace list automatically via `scripts/run-all.mjs`; the pre-commit
   hook type-checks only the workspaces the staged files touch — nothing to add
   in either case. `scripts/check-frontend-wiring.mjs` (runs first in
   `bun run typecheck` and pre-commit) fails until this step is done, and
   warns until step 9 (Railway) is done.
9. **Deployment** — add `.railway/configs/clients/<name>.json` and register the
   service in `.railway/sync.ps1` (`"<Service name>" = "client\client"` in the
   `$serviceMap` — all frontends share the single
   `.railway/envs/client/client.env`; do not create a per-frontend env file).
   See `docs/agents/architecture.md` → Adding a New Frontend. In that config's
   `deploy` block include
   `"healthcheckPath": "/health"` (and e.g. `"healthcheckTimeout": 60`) — the
   `healthcheck()` plugin already in `vite.config.ts` serves `/health` from
   `vite preview`, so the platform probe has a real endpoint to hit.
10. **Docs** — add the frontend to the table in `.agents/AGENTS.md` and
    `docs/agents/architecture.md`.

`clients/_template` itself is **not deployed** and is intentionally excluded
from the root `build`/`typecheck` scripts.
