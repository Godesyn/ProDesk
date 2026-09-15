# Multi-Frontend Architecture

> **This is the source of truth for the Prodesk platform architecture.**
> All architectural decisions, conventions, and rules for the multi-frontend monorepo are documented here.

## Overview

Prodesk is a **multi-frontend platform**. One backend serves multiple independent frontend applications, each hosted on its own domain. Each frontend focuses on a specific feature area of the platform.

```
┌─────────────────────────────────────────────────────────────┐
│                     Shared Backend                          │
│          Express + tRPC + Drizzle + Supabase                │
│              api.prodesk.com (Railway)                      │
└──────────┬──────────┬──────────┬──────────┬─────────────────┘
           │          │          │          │
     ┌─────┴───┐ ┌────┴────┐ ┌──┴───┐ ┌───┴───┐
     │ Prodesk │ │Dashboard│ │ App  │ │  ...  │
     │  (main) │ │(dashbo.)│ │  C   │ │(~10)  │
     └─────────┘ └─────────┘ └──────┘ └───────┘
      app.        dashboard.    c.
      prodesk.com prodesk.com  prodesk.com
```

### Frontends

| Frontend           | Domain                  | Scope                                                    |
| ------------------ | ----------------------- | -------------------------------------------------------- |
| **Prodesk** (main) | `app.prodesk.com`       | The full platform — all features                         |
| **Dashboard**      | `dashboard.prodesk.com` | Dashboard — set of tools for brand                       |
| **Links** (Adeyy)  | `links.prodesk.com`     | Short-link + QR tool for brands (migrated from `adeyy/`) |
| **Reviews** (Verdiict) | `reviews.prodesk.com` | Review-capture, public directory + embeds for brands (migrated from `verdiict-review-tool/`) |
| **Payments** (EziQuotes) | `payments.prodesk.com` | Proposals/quotes + Stripe Connect payments, chase sequences, payer portals for brands (migrated from `prodesk-payments/`) |
| **Signatures** (SIGKITT) | `signatures.prodesk.com` | Email-signature builder for brands (migrated from `email-signature-builder/`) |
| **Jobs**           | `jobs.prodesk.com`      | Multi-role jobs tool (scaffold — shell only, no backend yet) |
| **Websites**       | `websites.prodesk.com`  | Brand-only websites tool (scaffold — shell only, no backend yet) |
| **Design**         | `design.prodesk.com`    | User-level design tool (scaffold — shell only, no backend yet) |
| **Logo**           | `logo.prodesk.com`      | Brand-only logo tool (scaffold — shell only, no backend yet) |
| **Passwords** (KEYMASTR) | `keymastr.prodesk.com` | User-level password vault across every brand — access map, offboarding, Send/Intake (skeleton — mock data, no backend yet) |
| **Chat**           | `chat.prodesk.com`      | User-level consumer messenger — DMs found by email address, arbitrary groups, realtime, reactions, read receipts. Sits BESIDE the org-derived workspace chat: it adds the `direct` and `group` thread types and never appears in the workspace thread list |
| _…more planned_    | `*.prodesk.com`         | Each extracts one feature area into a standalone product |

### What's shared across all frontends

- **Auth** — Same Supabase project, same JWT, same user accounts
- **Database** — Same Postgres database, same Drizzle schema
- **API** — One tRPC server, one set of routers — each frontend calls the subset it needs
- **UI components** — Shared design system (buttons, dialogs, tables, etc.)
- **Hooks & utilities** — Auth context, tRPC client, storage helpers, validators

### What's unique per frontend

- **Pages & routing** — Each frontend has its own `App.tsx` and route tree
- **Theme & branding** — Frontends share a single design-token base; each can override static tokens locally (see [Theming](#theming))
- **Entry point** — Each frontend has its own `index.html`, title, and favicon

---

## Monorepo Structure

```
prodesk-web/
├── servers/
│   └── backend/                ← Main backend: entrypoint, migration scripts, drizzle config
│       └── src/
│           ├── _core/          ← Express + tRPC entrypoint
│           ├── scripts/        ← Migration, backfill, and utility scripts
│           └── jobs/           ← Worker entrypoint (re-exports from server-shared)
│
├── packages/
│   ├── server-shared/          ← Shared backend logic (used by ALL backend services)
│   │   └── src/
│   │       ├── routers/        ← All tRPC routers (proposals, projects, etc.)
│   │       ├── trpc/           ← Router, context, permissions
│   │       ├── modules/        ← Stripe, email, billing, etc.
│   │       ├── db/             ← Drizzle schema & DB client
│   │       ├── lib/            ← Env, helpers, utilities
│   │       ├── jobs/           ← BullMQ worker & queues
│   │       └── test/           ← Test utilities
│   │
│   └── shared/                 ← Shared frontend code (used by ALL frontends)
│       └── src/
│           ├── lib/            ← tRPC client, supabase, utils, validators, storage
│           ├── auth/           ← AuthProvider, AuthShell, route-access
│           ├── hooks/          ← Reusable React hooks
│           ├── components/     ← Shared UI (buttons, dialogs, tables, etc.)
│           └── pages/          ← Reusable page components
│
├── clients/
│   ├── _template/              ← Starting template for new frontends (NOT deployed)
│   ├── prodesk/                ← Main frontend (the full platform)
│   │   ├── src/
│   │   │   ├── App.tsx         ← Full route tree
│   │   │   ├── pages/          ← Prodesk-only pages (or overrides)
│   │   │   └── components/     ← Prodesk-only components (or overrides)
│   │   ├── vite.config.ts
│   │   └── index.html
│   │
│   ├── dashboard/               ← Dashboard frontend
│   │   ├── src/
│   │   │   ├── App.tsx         ← Dashboard-focused routes
│   │   │   ├── pages/          ← Dashboard-only pages
│   │   │   └── components/     ← Dashboard-only components
│   │   ├── vite.config.ts
│   │   └── index.html
│   │
│   └── .../                    ← Future frontends follow the same pattern
│
├── .railway/
│   ├── configs/
│   │   ├── servers/            ← Railway configs for backend services
│   │   │   ├── backend.json
│   │   │   └── worker.json
│   │   └── clients/            ← Railway configs for frontend services
│   │       ├── prodesk.json
│   │       ├── dashboard.json
│   │       └── links.json
│   ├── envs/                   ← Railway env variable files
│   └── sync.ps1                ← Railway env sync script
│
├── package.json                ← workspaces: ["servers/*", "packages/*", "clients/*"]
├── tsconfig.base.json
├── .env                        ← Shared env vars (Supabase, Stripe, DB, etc.)
└── docs/agents/architecture.md ← THIS FILE
```

---

## How Code Sharing Works

All frontends import shared code from `@prodesk/shared`:

```tsx
// Any frontend can import shared auth, hooks, components, and pages
import { useCurrentUser } from '@prodesk/shared/auth/auth-context';
import { Button } from '@prodesk/shared/components/ui/button';
import { ProposalDetailPage } from '@prodesk/shared/pages/proposal-detail';
```

### Overrides

Any frontend can **override** a shared component by placing its own version locally:

```tsx
// clients/dashboard/src/components/proposal-card.tsx
// This is Dashboard's custom version — it doesn't touch the shared one
export function ProposalCard({ proposal }) {
  // Enhanced UI specific to the Dashboard frontend
}
```

### When to put code where

| Scenario                                        | Location                                          |
| ----------------------------------------------- | ------------------------------------------------- |
| Used by multiple frontends                      | `packages/shared/src/`                            |
| Used by multiple backend services               | `packages/server-shared/src/`                     |
| Only used by one frontend                       | `clients/<frontend>/src/`                         |
| Backend entrypoint / migration scripts          | `server/src/`                                     |
| Started in one frontend, now needed everywhere  | **Promote** from `clients/` to `packages/shared/` |
| Shared version doesn't fit one frontend's needs | **Override** locally in `clients/<frontend>/src/` |

---

## Theming

All frontends share one design-token base so the brand stays consistent and edits don't drift between apps.

- **Shared base** — `packages/shared/src/styles/theme.css` defines the full `@theme` block (ink scale, surfaces, accent, status, borders, fonts, radii, shadows, motion) plus the keyframes, base layer, and typography/utility classes.
- **Per-client entry** — each `clients/<name>/src/index.css` keeps the Tailwind setup that must be entry-local (`@import 'tailwindcss'`, `@source`, `@plugin`), then `@import`s the shared base, then has a trailing `@theme { … }` block for that frontend's overrides. Tailwind v4 merges `@theme` blocks and the **last** declaration of a token wins, so the override block silently takes precedence over the shared base.
- **Safe to override per client**: static tokens — radii, fonts, shadows, ink scale, surface tints, motion.
- **Do NOT hardcode per client**: `--color-accent` and the `--accent-h/s/l` channels. These are rewritten on `:root` at runtime by `theme-accent.ts` / `applyStoredAccent()` to drive **agency white-labeling** — a referred user is themed by their agency's accent. Hardcoding the accent breaks white-labeling.

### Runtime accent (white-labeling)

The accent is resolved live, not baked into CSS. `packages/shared/src/theme/accent-theme.tsx` (`AccentThemeProvider`, mounted via shared `providers.tsx`) resolves the accent in order: **active agency → tenant subdomain's agency → user's `referredByAgencyId` → Forest default**. The resolved hex is converted to HSL channels and written to `:root` (`--accent-h/s/l`); every accent-derived token in the shared `@theme` recomputes from those channels. `applyStoredAccent()` applies the last-cached accent (keyed by subdomain in `localStorage`) **before React mounts** to avoid a flash of the default theme. This pairs with the subdomain redirect (`use-subdomain-redirect.ts`) that hands a referred user off to their agency's branded subdomain. All frontends get this for free through shared `Providers` — no per-frontend wiring.

---

## Deployment (Railway)

All services live in one Railway project, all pointing at the same Git repo:

| Railway Service    | Config File                               | Domain                  | Purpose                     |
| ------------------ | ----------------------------------------- | ----------------------- | --------------------------- |
| **api**            | `.railway/configs/servers/backend.json`   | `api.prodesk.com`       | Express server (API-only)   |
| **worker**         | `.railway/configs/servers/worker.json`    | _(internal)_            | BullMQ job processor        |
| **prodesk-client** | `.railway/configs/clients/prodesk.json`   | `app.prodesk.com`       | Main frontend (static)      |
| **dashboard**      | `.railway/configs/clients/dashboard.json` | `dashboard.prodesk.com` | Proposals frontend (static) |
| _…more_            | `.railway/configs/clients/<name>.json`    | `<name>.prodesk.com`    | Future frontends            |

Each client service builds and serves its own Vite bundle. The API server is shared — all frontends point `VITE_API_URL` at `https://api.prodesk.com`.

---

## Adding a New Frontend

**Always start by copying the template — do not hand-assemble a new frontend.**
`clients/_template/` is a minimal working frontend with the shared auth, context,
and theming scaffolding already wired and no UI/design opinions of its own. It is
not deployed and is excluded from the root `build`/`typecheck` scripts.

> Migrating an app exported from **Manus** into a new frontend? Follow
> [`manus-migration.md`](./manus-migration.md) — it covers the full export →
> frontend + `server-shared` migration (auth/tenancy remap, MySQL→Postgres,
> platform-service remap) on top of the template steps below.

1. Copy the template: `cp -r clients/_template clients/<name>`. It already contains:
   - `package.json` — depends on `@prodesk/shared`
   - `vite.config.ts` — aliases for `@shared` and `@server`
   - `index.html` — app title and favicon
   - `src/main.tsx` — entry point using shared `Providers` (applies the cached accent)
   - `src/App.tsx` — auth + context scaffolding with a placeholder `<LandingPage />`
   - `src/index.css` — Tailwind setup + `@import` of the shared base (`packages/shared/src/styles/theme.css`) + an `@theme {}` override block (see [Theming](#theming))
2. Personalize the copy (full checklist in `clients/_template/README.md`):
   - `package.json` → set `"name"`
   - `vite.config.ts` → set `__PRODESK_CLIENT__` and a unique dev `port`
   - `index.html` → set the `<title>`
   - `src/App.tsx` → replace `<LandingPage />` with the frontend's routes (the unknown-route fallback to the main app is env-driven via `mainAppUrl()` / `@shared/lib/origins` — no per-frontend URLs)
   - `src/index.css` → add design-token overrides if needed (never hardcode the accent)
3. Add dev script to root `package.json`: `"dev:<name>": "concurrently ..."`, and add the frontend to the root `build` / `typecheck` scripts
4. Add `.railway/configs/clients/<name>.json` for deployment
5. Nothing to update in `.githooks/*` — the pre-commit (affected type-check) and pre-push (full build) derive the workspace list automatically via `scripts/affected.mjs` / `scripts/run-all.mjs`
6. Ask user to create a Railway service pointing at the new config file once committed
7. Ask user to assign a custom domain once deployed
8. Add the frontend to the table in this doc and in `.agents/AGENTS.md`

---

## Conventions

- **"Frontend"** refers to each app in `clients/`. Use this term in communication — not "client" (which is a technical directory name).
- **Shared frontend code** = `packages/shared/`. Changes here affect all frontends.
- **Shared backend code** = `packages/server-shared/`. Changes here affect all backend services. DB schema, tRPC routers, modules, jobs, and utilities live here.
- **Backend entrypoint** = `servers/backend/`. Thin shell that imports from `@prodesk/server-shared`. Owns migration scripts, drizzle config, and the Express/worker entrypoints.
- **Frontend-specific code** = `clients/<name>/src/`. Changes here only affect that one frontend.
- **Promote** = move code from a frontend to shared so all frontends can use it.
- **Override** = create a frontend-local version of a shared component.
- **Railway configs** = `.railway/configs/servers/` and `.railway/configs/clients/`. Each service has its own JSON config.
