# Migrating a Manus Project into Prodesk

How to take a project exported from **Manus** (`manus.im` web-app builder) and
fold it into this monorepo: the UI becomes a new frontend under `clients/`, and
the backend logic moves into `packages/server-shared`. We do this often enough
that it deserves a repeatable playbook.

> **First contact:** a Manus export usually lands as a single self-contained
> folder at the repo root (e.g. `adeyy/`, the QR/link-shortener that this guide
> was written against). It is **not yet wired into the monorepo** — it has its
> own `pnpm-lock.yaml`, its own Express server, its own auth, its own MySQL
> schema. Nothing in it builds against our workspaces until you migrate it.

Read this together with:
- [`architecture.md`](./architecture.md) — how `clients/`, `packages/shared`, and `packages/server-shared` fit together.
- [`clients/_template/README.md`](../../clients/_template/README.md) — the canonical "new frontend" procedure. **Migration always starts by copying the template.**
- [`deployment.md`](./deployment.md) — Railway service setup.

---

## ⚠️ Step 0 — Security triage (do this before anything else)

A Manus export ships with **live platform credentials baked into the repo**.
Treat the export as compromised-by-default and clean it before the first commit.

Files that contain secrets (verify each one in the export you're handed):

| File | What's in it |
|------|--------------|
| `.project-config.json` | **Live `DATABASE_URL` with password**, **temporary AWS access keys** (`access_key_id` / `secret_access_key` / `session_token`), Manus app secrets, JWT secret, Forge/OAuth keys |
| `template.json` | App metadata + secret scaffolding |
| `.env*` | Runtime secrets |

Actions:
1. **Do not commit these.** Add the export folder (or at least these files) to `.gitignore` until cleaned. They are likely already exposed in the Manus S3 git remote referenced in `.project-config.json` — assume the keys are burned.
2. **Rotate anything real.** The Stripe key, any DB you actually intend to keep, etc. The AWS session token is short-lived (it has an `expiration`) and usually dead on arrival — ignore it.
3. **Strip secrets out** as you migrate. None of them survive: our config comes from the root `.env` / Railway, not per-project JSON. See [Step 6](#step-6--platform-services) and our env conventions.

---

## Part 1 — Anatomy of a Manus export

Every Manus "web-db-user" project (`template_id: web-db-user` in
`.project-config.json`) has the same shape. Knowing the shape tells you what to
keep, what to rewrite, and what to delete.

### Directory layout

```
<project>/
├── client/                 # React SPA (Vite)
│   ├── src/
│   │   ├── pages/          # route components       → PORT to clients/<name>/src/pages
│   │   ├── components/     # app components         → PORT (selectively)
│   │   │   └── ui/         # ~50 shadcn/Radix prims → mostly DROP (we have shared equivalents)
│   │   ├── contexts/       # ThemeContext etc.      → DROP (shared Providers handle this)
│   │   ├── hooks/          # app hooks              → PORT (selectively)
│   │   ├── lib/            # trpc.ts, utils.ts      → REWRITE against @shared
│   │   └── _core/          # Manus client glue      → DROP (useAuth, etc.)
│   └── public/
├── server/                 # Express + tRPC backend
│   ├── routers.ts          # appRouter root         → MERGE into our router.ts
│   ├── routers/            # feature routers        → PORT to server-shared
│   ├── db.ts               # drizzle query helpers  → PORT (rewrite for pg + tenancy)
│   ├── *.ts                # billing, analytics…    → PORT to server-shared/modules
│   └── _core/              # Manus platform glue    → DROP / remap (see Part 1 services)
├── shared/                 # cross-cutting types/const
│   ├── types.ts, const.ts  → PORT (selectively)
│   └── _core/              → DROP
├── drizzle/
│   ├── schema.ts           # MySQL schema           → PORT to pg, drop auth tables
│   └── *.sql, meta/        # MySQL migrations       → DROP (regenerate against pg)
├── .project-config.json    # ⚠️ secrets             → DELETE
├── template.json           # ⚠️ secrets/metadata    → DELETE
├── package.json            # pnpm, own deps         → DELETE (use workspace deps)
└── pnpm-lock.yaml          → DELETE (repo uses npm workspaces + bun.lock)
```

The `_core/` folders (both client and server) are the **Manus platform boundary**.
Anything under `_core` is glue to Manus' hosted services and is *always* replaced
by our equivalents — never ported verbatim.

### Stack as shipped by Manus

| Layer | Manus uses | Notes |
|-------|-----------|-------|
| Runtime | React 19, Vite 7, TS 5.9 | We're on React 18 / Vite 5 — **downgrade JSX-only code is usually a no-op, but check React 19-only APIs** (`use()`, `useFormStatus`, ref-as-prop). |
| Routing | `wouter` | ✅ Same as us. |
| Data | `@trpc/*` v11 + `@tanstack/react-query` v5 + `superjson` | ✅ Same stack; client wiring differs (see Step 3). |
| Styling | Tailwind v4 + `tailwindcss-animate` + shadcn/Radix UI | ✅ Tailwind v4 same; their `components/ui` is generic shadcn — we have our own design system in `@shared`. |
| Forms | `react-hook-form` + `zod` + `@hookform/resolvers` | Zod **v4** (we use v3 in shared, v4 in server — check per package). |
| Misc UI | `framer-motion`, `recharts`, `sonner`, `lucide-react`, `cmdk`, `vaul`, `embla` | Add per-frontend as needed; `sonner`/`lucide` already in shared. |
| Server | Express + `@trpc/server` v11 adapter | ✅ Our backend is also Express + tRPC. |
| ORM | `drizzle-orm` + **`mysql2`** (TiDB Cloud) | ❗ **We are Postgres** (`drizzle-orm/pg-core`). Schema must be re-dialected. |
| Auth | **Manus OAuth** (`api.manus.im`) → openId → app-signed session cookie (jose JWT) | ❌ Fully replaced by our Supabase auth. |
| AI/LLM | Manus **Forge** proxy (`forge.manus.ai`) | Remap to our `modules/ai` (Anthropic) or drop. |
| Storage | S3 (`@aws-sdk/client-s3`) + Manus `dataApi` | Remap to our Supabase storage (`@shared/lib/storage`). |
| Other platform | image-gen, voice transcription, Google Maps, owner notifications, cron "heartbeat" | Remap or drop — see [Step 6](#step-6--platform-services). |
| Billing | `stripe` SDK, per-vendor subscription + trials/promo codes | ❗ We already have a full billing system — **reconcile, don't re-import** (Step 7). |

### Manus auth model (what you're ripping out)

- Login is **Manus-hosted OAuth**: browser → `manus.im` portal → `/api/oauth/callback` (`server/_core/oauth.ts`) → exchange code via Forge SDK (`server/_core/sdk.ts`) → upsert a `users` row keyed by **`openId`** → set an app-signed HS256 **session cookie** (jose).
- Every request: `createContext` (`server/_core/context.ts`) calls `sdk.authenticateRequest(req)`, which verifies the cookie and loads the user by `openId`.
- Roles are a flat enum: `user | admin`. The "owner" is whoever matches `OWNER_OPEN_ID`.
- Client side: `_core/hooks/useAuth.ts` just wraps a `trpc.auth.me` query.

**None of this survives.** Our auth is Supabase GoTrue (Bearer JWT in the
`Authorization` header, verified in `packages/server-shared/src/trpc/context.ts`),
with a rich role model (`brandOwner | agencyOwner | individualContractor |
agencyStaff | brandStaff | superAdmin`) and full login/signup/verify/reset pages
already provided by `@shared`.

### Manus multi-tenancy model (what maps onto our tenancy)

Manus apps invent their own tenancy. In `adeyy` it's:

- **`vendors`** — the tenant/org (owns links, campaigns, billing, trials).
- **`vendor_users`** — team membership: `{ vendorId, userId, email, role: owner|editor|viewer, status: active|invited, inviteToken }`. **This is Manus reinventing teams + staff invitations.**

We already have this and more. Map onto our existing model (see Step 5) — do
**not** port `vendors`/`vendor_users`.

---

## Part 2 — Target architecture (where things land)

| Manus piece | Lands in | Why |
|-------------|----------|-----|
| `client/` UI | `clients/<name>/` (copied from `clients/_template`) | A new frontend, deployed as its own Railway service. |
| Feature routers + server logic | `packages/server-shared/src/routers/` + `…/modules/<feature>/` | Shared backend — all services import from here. |
| Domain DB tables | `packages/server-shared/src/db/schema.ts` (as pg tables) | One schema for the whole platform. |
| Auth / context / theming | already in `@prodesk/shared` | Never reimplemented per-frontend. |

Read `architecture.md` → "Conventions" for the exact meaning of frontend /
shared-frontend / shared-backend / backend-entrypoint.

---

## Part 3 — The migration playbook

Work in this order. Frontend-first lets you stub the backend with our existing
procedures; backend-first lets you typecheck routers in isolation. Either works —
the ordering below is the low-friction path.

### Step 1 — Inventory & triage the domain

Before touching code, write down (in the PR description or a scratch `todo.md`):

1. **The domain tables** in `drizzle/schema.ts` and which are *real domain* vs *Manus plumbing*. Plumbing = `users` (auth), the tenant table (`vendors`), the membership table (`vendor_users`). Everything else (`links`, `qr_codes`, `events`, `campaigns`, …) is the domain you're actually migrating.
2. **The feature routers** in `server/routers/` and what each one does.
3. **Overlap with what we already have.** Critically — *we may already own this domain*. Example: `adeyy` is a link shortener and we already ship `packages/server-shared/src/routers/shortLinks.ts`. Decide per-feature: extend ours, or add a new router. Don't blindly duplicate.
4. **Which Manus platform services it actually uses** (grep `server/_core` imports): LLM? storage? maps? voice? Each one is a remap decision in Step 6.

### Step 2 — Create the frontend from the template

Follow `clients/_template/README.md` exactly. In short:

```bash
cp -r clients/_template clients/<name>
```

Then personalize: `package.json` name, `vite.config.ts` `__PRODESK_CLIENT__` +
unique dev port, `index.html` title, `src/App.tsx` routes (the main-app fallback
is env-driven via `mainAppUrl()` / `@shared/lib/origins`), root `package.json`
`dev:<name>` + `build`/`typecheck` scripts.

**Leave the auth/context/theming scaffolding in `App.tsx`/`main.tsx` alone.** That
is the whole point of the template — login, signup, verify, reset, context
switcher, profile, and accent theming are already wired from `@shared`. You only
replace `<LandingPage />` with the migrated app's authenticated routes.

### Step 3 — Port the frontend UI

Port **inside-out**: routes/pages first, then the components they need.

1. **Pages** (`client/src/pages/*` → `clients/<name>/src/pages/*`). Drop Manus' own auth-ish pages (anything doing login/OAuth) — those are handled by `@shared`. Mount the real pages as routes inside the authenticated `<Switch>` in `App.tsx`.
2. **Components** (`client/src/components/*`). Port feature components. **Skip `components/ui/`** unless a primitive genuinely has no equivalent — prefer our `@shared` components and design tokens so the frontend inherits white-labeling/theming. Manus' `ui/` is stock shadcn and will fight our token system.
3. **Drop `client/src/_core/` and `contexts/`.** `useAuth` → replace with `@shared/auth/auth-context` (`useCurrentUser`, `signOut`). `ThemeContext` → handled by shared `Providers` + `applyStoredAccent()`.
4. **Rewire tRPC.** Manus' `client/src/lib/trpc.ts` does `createTRPCReact<AppRouter>()` pointing at *its own* server. Replace with our shared client setup (see `packages/shared/src/lib/trpc.ts` and how existing frontends like `clients/dashboard` consume it). Calls change from `trpc.links.list.useQuery()` (Manus router) to the equivalent on our merged `AppRouter`.
5. **Tokens & styling.** Replace hardcoded colors with our token classes (`bg-paper`, `text-ink-100`, `text-accent`, `border-ink-4`, …). Never hardcode the accent — see `architecture.md` → Theming. This is what makes the migrated UI themeable per-agency.
6. **React 19 → 18.** Most JSX ports cleanly. Watch for `use()`, `useFormStatus`, the new `ref` prop, and `<form action={fn}>` server-action-style usage.

### Step 4 — Port the backend routers

1. **Move feature routers** `server/routers/<feature>.ts` → `packages/server-shared/src/routers/<feature>.ts`. Heavy business logic (billing math, fulfillment, analytics aggregation) goes under `…/modules/<feature>/` per our convention.
2. **Rewire the tRPC primitives.** Manus routers import from `server/_core/trpc.ts` (`publicProcedure`, `protectedProcedure`, `adminProcedure`). Repoint to ours (`packages/server-shared/src/trpc/trpc.ts`):
   - `publicProcedure` → `publicProcedure` ✅
   - `protectedProcedure` → `protectedProcedure` (note: **ours requires a real app-user row**; `sessionProcedure` is the looser "valid session, row may not exist yet" variant)
   - `adminProcedure` (role === 'admin') → `superAdminProcedure`
   - Add tenant/permission checks — see `trpc/permissions.ts` and `trpc/tenant.test.ts`. Manus had none of this granularity.
3. **Fix `ctx`.** Manus ctx is `{ req, res, user }` where `user` is the `openId` row. Ours is `{ db, auth, user, tenant, clientOrigin }` where `user` is our app-user row and `auth` is the Supabase identity. Update every `ctx.user.id` / `ctx.user.role` reference accordingly (our ids are `uuid`, not autoincrement `int`).
4. **Register the routers** in `packages/server-shared/src/trpc/router.ts` (the equivalent of Manus' `server/routers.ts` `appRouter`). Drop Manus' `auth` sub-router (`me`/`logout`) — we have our own.
5. **Port `db.ts` helpers.** Manus uses a hand-rolled query layer with a `getDb()` that silently returns `null`. Ours imports a live `db` from `db/index.js`. Rewrite helpers to use our `db`, our pg column types, and **scope every query to the tenant** (Step 5) — Manus scoped by `vendorId`; you scope by our `agencyId`/`brandId`.
6. **Raw-body webhooks** (Stripe etc.) are registered on the Express app in `server/_core/index.ts`. We already mount Stripe webhooks in `servers/backend` — fold any new webhook handling there, don't stand up a second Express app.

### Step 5 — Replace auth & remap tenancy

This is the highest-value part: **delete Manus auth entirely** and re-express the
app's tenancy in our model.

| Manus concept | Prodesk equivalent |
|---------------|--------------------|
| `users` table (openId, role user/admin) | our `users` table (uuid id, `userRole` enum) — **drop Manus' table** |
| `openId` foreign keys | our `users.id` (uuid) |
| OAuth callback + session cookie + `sdk.ts` | Supabase GoTrue; nothing to port — handled by `@shared` + `trpc/context.ts` |
| `role: 'admin'` / `OWNER_OPEN_ID` | `users.isSuperAdmin` / `superAdminProcedure` |
| `vendors` (tenant/org) | `agencies` or `brands` (pick the right one for the product) |
| `vendor_users` (membership w/ owner/editor/viewer + invites) | our `staff` table + existing invite/redemption flow (`@shared/auth/use-invite-redemption`) |
| trial / promo-code fields on `vendors` | our `featureSubscriptions` / billing — **don't re-add trial columns**, use the platform's |

Concretely: every domain table that had `vendorId int` becomes scoped by an
`agencyId`/`brandId` `uuid` FK into our schema, and every query that filtered
`eq(x.vendorId, ctx.user.vendorId)` becomes a tenant-scoped query using `ctx`
(`ctx.tenant`, the active agency/brand) and our permission helpers.

### Step 6 — Platform services

Each `server/_core` service is a Manus-hosted capability. Decide remap-or-drop:

| Manus `_core` service | Decision |
|-----------------------|----------|
| `sdk.ts`, `oauth.ts`, `context.ts`, `cookies.ts`, `trpc.ts`, `systemRouter.ts` | **Drop** — replaced by our auth + tRPC setup. |
| `llm.ts` (Forge LLM proxy) | Remap to `packages/server-shared/src/modules/ai` (Anthropic). If the feature doesn't need AI, drop. |
| `imageGeneration.ts`, `voiceTranscription.ts` | Remap to a real provider or drop. No Prodesk equivalent yet — flag in the PR if needed. |
| `map.ts` (Google Maps) | Keep only if the feature needs maps; bring your own key via root `.env`, not the baked Manus key. We have `routers/places.ts` for place search. |
| `storageProxy.ts`, `dataApi.ts`, `storage.ts` (S3) | Remap to Supabase storage — `@shared/lib/storage` + `storage-buckets.ts`. |
| `notification.ts` (owner notifications) | Remap to our email layer (`modules/email`) or drop. |
| `heartbeat.ts` (Manus cron) | Remap to our jobs/worker (`packages/server-shared/src/jobs`). See `references/periodic-updates.md` in the export for what it expected. |
| `env.ts` | Drop — use our env loading. |

### Step 7 — Reconcile billing

Manus apps commonly hand-roll Stripe (per-tenant `stripeCustomerId`,
subscription items, trials, promo codes). **We already have a comprehensive
billing system** (`modules/billing`, `modules/stripe`, `modules/feature-subscriptions`,
`routers/billing.ts`, `routers/invoices.ts`, `routers/payouts.ts`).

Do **not** import Manus' billing. Instead, express the product's paid features as
**feature subscriptions** / packages in our system. Drop the Stripe columns from
the ported tenant table; our billing owns the Stripe customer/subscription
linkage. See `docs/feature-subscriptions.md` and `docs/commissions.md`.

### Step 8 — Database migration

1. Re-dialect `drizzle/schema.ts` from `mysqlTable` → `pgTable` in `packages/server-shared/src/db/schema.ts`. Match our column helpers (`money`, `pct`, `createdAt`, `updatedAt` at the top of `schema.ts`), `uuid` PKs (not `int autoincrement`), `timestamp({ withTimezone: true })`, and pg enums via `pgEnum`.
2. **Drop** the auth/tenant tables (`users`, `vendors`, `vendor_users`) — keep only domain tables, re-FK'd to our `users`/`agencies`/`brands`.
3. **Delete** Manus' `drizzle/*.sql` + `meta/` — they're MySQL migrations. Generate fresh pg migrations through our flow (`servers/backend` owns drizzle config; see `db/auto-migrate.ts` / `run-pending-migrations.ts`). Beware snapshot drift — see the project memory on drizzle snapshots.
4. Watch for MySQL-isms in ported `db.ts`: `onDuplicateKeyUpdate` → pg `onConflictDoUpdate`; `insertId` → pg `.returning()`; raw `sql` MySQL date formatting (`toMySQLDatetime`) → pg `timestamptz` (drop the manual formatting).

### Step 9 — Deployment & wiring

1. Root `package.json`: add `dev:<name>`, and add the frontend to the root `build`/`typecheck` scripts.
2. `.railway/configs/clients/<name>.json` + create the Railway service + custom domain (see `deployment.md`).
3. Add the frontend to the table in `architecture.md` and `.agents/AGENTS.md`.
4. Delete the original export folder once everything's ported.

### Step 10 — Verify

- `node node_modules/typescript/bin/tsc --noEmit` per affected package (we use npm workspaces, not pnpm — see the local-typecheck memory).
- Run the affected vitest suites with `NODE_ENV=development`.
- Manually: log in through our auth, switch context, hit the migrated routes, confirm tenant scoping (user A can't see user B's data).

---

## Part 4 — File disposition cheat-sheet

| Path in export | Disposition |
|----------------|-------------|
| `client/src/pages/**` | **Port** → `clients/<name>/src/pages` |
| `client/src/components/**` (not `ui/`) | **Port selectively** |
| `client/src/components/ui/**` | **Drop** — prefer `@shared` components |
| `client/src/lib/trpc.ts`, `utils.ts` | **Rewrite** against `@shared` |
| `client/src/_core/**`, `contexts/**` | **Drop** |
| `server/routers/**` | **Port** → `server-shared/routers` + `modules` |
| `server/db.ts`, domain `*.ts` | **Port + rewrite** (pg, tenancy) |
| `server/_core/**` | **Drop / remap** (Step 6) |
| `shared/types.ts`, `const.ts` | **Port selectively** |
| `shared/_core/**` | **Drop** |
| `drizzle/schema.ts` | **Port** domain tables → pg; drop auth tables |
| `drizzle/*.sql`, `meta/`, `relations.ts` | **Drop** — regenerate |
| `.project-config.json`, `template.json` | **Delete** (⚠️ secrets) |
| `package.json`, `pnpm-lock.yaml`, `drizzle.config.ts`, `vite.config.ts`, `tsconfig.json` | **Delete** — use workspace equivalents |
| `README.md` (the long Manus template doc) | Skim for feature intent, then delete |
| `gen_test_session.mjs`, `patches/`, `components.json` | **Delete** |

---

## Part 5 — Manus-specific gotchas

- **Secrets in the repo.** Covered in Step 0. The single most important thing.
- **`getDb()` returns `null` silently.** Manus' `db.ts` tolerates a missing DB by returning empty results. Our `db` is always present; don't carry over the `if (!db) return []` pattern — it hides bugs.
- **openId everywhere.** Search the whole export for `openId`, `OWNER_OPEN_ID`, `sdk.`, `manus`, `forge`, `Forge` before declaring auth removed.
- **MySQL int PKs vs our uuids.** Every FK type changes. Autoincrement assumptions (`insertId`, sequential ids in UI) break.
- **React 19 / Zod 4 version skew.** Mostly fine, but check `use()`/form actions and Zod v4 API differences against our package versions.
- **They reinvented teams/billing/trials.** The biggest waste is porting `vendor_users`, trial columns, and a second Stripe integration. We have all three — map onto them.
- **Their `ui/` fights our theming.** Stock shadcn components hardcode colors; our token system (`ink`/`paper`/`accent`) is what gives per-agency white-labeling. Prefer `@shared`.
- **One Express app.** Don't stand up the Manus Express server beside `servers/backend`. Fold webhooks/routes into the existing entrypoint.

---

## Appendix — `adeyy` as the worked example

The first migration (this doc's reference case): a QR-code + short-link platform.

- **Domain to keep:** `links`, `link_destination_history`, `qr_codes`,
  `qr_activation_log`, `events` (analytics), `campaigns`, `reserved_slugs`,
  `promo_codes`. Routers: `links`, `qr`, `analytics`, `campaigns`.
- **Drop:** `users`, `vendors`, `vendor_users` (auth/tenancy); `billing`/`vendor`/`admin`
  routers (reconcile with ours); all of `server/_core` and `client/_core`.
- **Overlap alert:** we already have `routers/shortLinks.ts` — decide whether the
  Manus link engine extends it or replaces it *before* porting, not after.
- **Tenancy remap:** `vendor` → likely `brand` (a brand owns its links/QRs);
  `vendor_users` → `staff` + invites.
</content>
</invoke>
