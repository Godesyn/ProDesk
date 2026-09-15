# Frontend template

The starting point for every new Prodesk frontend. It is a minimal, working
frontend with **no UI components or design opinions of its own** — just the
shared auth + context + theming scaffolding that all frontends need.

When the request is _"create a new frontend for &lt;feature&gt;"_, **start here** —
copy this directory, then build the feature on top. Do not hand-assemble a new
frontend from scratch.

## What it already wires (all from `@prodesk/shared`)

- Login / Signup / Forgot + Reset password / Email verification
- Auth confirmation + handoff (subdomain cross-auth for agency white-labeling)
- Context selector (agency/brand switcher) and Profile page
- Runtime accent theming via shared `Providers` (`applyStoredAccent()` in `main.tsx`)
- Shared design-token base imported in `index.css`, with a per-frontend
  `@theme {}` override block

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
   **Never** hand-roll a local copy or add a `NotFound`/404 page. Mount it
   **last** in every `Switch` a user-typed URL can reach — authenticated *and*
   public (here, the `/r` + `/directory` visitor switch) — because a `<Route>`
   with no `path` matches everything. For an account/feature screen you don't own
   (profile, staff, invoices, …), **mount the shared page in-app** instead — copy
   the `/profile` block (`@shared/pages/*` use the same auth + brand/agency
   context, so they just work) and navigate to it with wouter; otherwise the URL
   silently bounces to the root.
6. **Origins env** — if the frontend needs a hosted domain, add a
   `VITE_<NAME>_PRODESK_ORIGIN` to the root `.env` / `.env.example` and the
   `.railway/envs/shared.*.env` files, and expose it in `@shared/lib/origins`.
7. **`src/index.css`** — add any design-token overrides in the trailing
   `@theme {}` block. Never hardcode the accent (`--color-accent`, `--accent-h/s/l`).
8. **Root `package.json`** — add a `"dev:<name>"` script (mirror `dev:dashboard`)
   and add the new frontend to the root `build` / `typecheck` scripts.
9. **Deployment** — add `.railway/configs/clients/<name>.json` + env file and
   register the service in `.railway/sync.ps1` (see `docs/agents/architecture.md`
   → Adding a New Frontend). In that config's `deploy` block include
   `"healthcheckPath": "/health"` (and e.g. `"healthcheckTimeout": 60`) — the
   `healthcheck()` plugin already in `vite.config.ts` serves `/health` from
   `vite preview`, so the platform probe has a real endpoint to hit.
10. **Docs** — add the frontend to the table in `.agents/AGENTS.md` and
    `docs/agents/architecture.md`.

`clients/_template` itself is **not deployed** and is intentionally excluded
from the root `build`/`typecheck` scripts.
