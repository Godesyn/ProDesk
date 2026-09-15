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
  arrives with an *agency* context selected is switched into their first brand
  instead of dead-ending. Keep `useAutoSelectContext()` (already wired) for
  role-less users.

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

## Creating a new frontend from this template

1. **Copy the directory** — `cp -r clients/_template clients/<name>`
2. **`package.json`** — set `"name"` to `<name>`.
3. **`vite.config.ts`** — set `__PRODESK_CLIENT__` to `<name>` and pick a unique
   dev `port` (prodesk = 5173, dashboard = 5174, links = 5175).
4. **`index.html`** — set the `<title>`.
5. **`src/App.tsx`** — replace `<LandingPage />` with the frontend's routes. The
   unknown-route fallback is already wired — nothing to edit.

   **Not-found rule** (see the `NOT-FOUND RULE` comment in the template's
   `App.tsx`): every frontend sends an unmatched route to its **own root** (`/`);
   none renders a 404 screen. There is exactly **one** implementation —
   `<UnknownRouteRedirect>` from `@shared/components/unknown-route-redirect`.
   **Never** hand-roll a local copy or add a `NotFound`/404 page — SIGKITT used
   to ship both and they have been removed. Mount it **last** in every `Switch` a
   user-typed URL can reach — authenticated *and* public (here, the
   `/team/:slug` + `/share/:brandId` share switch) — because a `<Route>` with no
   `path` matches everything. For an account/feature screen you don't own
   (profile, staff, invoices, …), **mount the shared page in-app** instead — copy
   the `/profile` block (`@shared/pages/*` use the same auth + brand/agency
   context, so they just work) and navigate to it with wouter; otherwise the URL
   silently bounces to the root.
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
