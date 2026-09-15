# Prodesk Web — React + tRPC + Drizzle + Supabase

Greenfield rebuild of the Flutter/Dart + Firebase app (`../lib`) onto the new stack.
This is a feature-parity reimplementation, **not** an in-place migration — the Flutter
app keeps running until this reaches parity.

## Stack

| Layer      | Tech                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend   | React 18 + TypeScript, Vite, Tailwind CSS 4, Radix + shadcn-style (cva/clsx/tailwind-merge), **wouter**, **TanStack Query**, react-hook-form + zod, framer-motion, lucide-react, recharts, sonner, embla, dnd-kit, Stripe.js |
| API        | Node + Express 4 (ESM), **tRPC 11** + superjson                                                                                                                                                                              |
| DB         | **Drizzle ORM** + drizzle-kit → Supabase Postgres (Supavisor pooler, `postgres` driver)                                                                                                                                      |
| Auth       | Supabase Auth (GoTrue); server verifies JWTs with `jose` against `SUPABASE_JWT_SECRET`                                                                                                                                       |
| Storage    | Supabase Storage (replaces Firebase Storage / S3)                                                                                                                                                                            |
| Jobs       | BullMQ + ioredis + bull-board (replaces Firebase scheduled functions & Firestore triggers)                                                                                                                                   |
| Payments   | Stripe SDK + PayPal/Wise (port from `../functions/src/modules/billing`)                                                                                                                                                      |
| Email      | nodemailer (port templates from `../functions/src/modules/email`)                                                                                                                                                            |
| Monitoring | Sentry                                                                                                                                                                                                                       |

## Layout

```
prodesk-web/
├── server/                       # Express + tRPC + Drizzle
│   ├── src/_core/index.ts        # entry: tRPC adapter, CORS, Stripe webhook, bull-board
│   ├── src/db/schema.ts          # ★ relational schema (Firestore → Postgres)
│   ├── src/trpc/                 # context (Supabase JWT), procedures, root router
│   ├── src/routers/              # per-feature tRPC routers
│   ├── src/modules/              # stripe / payouts / email (ported from ../functions)
│   └── src/jobs/                 # BullMQ queues, worker, dashboard
└── client/                       # Vite React app
    ├── src/lib/                  # trpc client, supabase, queryClient, utils(cn)
    ├── src/auth/                 # session context + auth.me
    ├── src/components/ui/        # shadcn-style primitives (design tokens in index.css)
    └── src/pages/                # screens
```

## Getting started

```bash
cd prodesk-web
cp .env.example .env          # fill Supabase + DB creds
npm install
npm run db:push               # push Drizzle schema to Supabase Postgres
npm run dev                   # server :4000 + client :5173
npm run worker --workspace server   # background jobs (separate process)
```

## ✅ Done (foundation + auth slice)

- Monorepo, TS configs, env validation (zod)
- **Drizzle schema** for the backbone: users, contractors, agencies, brands, user↔org
  memberships, staff, all three connection types, services, packages, proposals,
  purchases, projects, invoices, payouts, chat threads/messages, tasks, files,
  folders, resources, meetings, global settings (+ pgEnums for every Dart enum)
- tRPC server (superjson, Supabase-JWT context, `protected`/`superAdmin` procedures)
- Routers: `auth`, `users`, `agencies`, `brands`, `services`, `packages`, `staff`, `connections`
  (all list endpoints paginated via shared `paginationInput`/`page()` helper + permission checks)
- **App shell**: role-aware sidebar + header (avatar menu, workspace badge), `useActiveContext`
- **Feature pages** (paginated, polished): Catalog (services CRUD + create dialog), Clients
  (connected brands), Staff (list + invite + permission picker); workspace Dashboard with stat cards
- Shared UI: badge, skeleton, dialog, dropdown-menu, avatar, table, pagination, page-header, empty-state
- Express entry: tRPC, CORS, Stripe webhook (raw body), bull-board, Sentry
- BullMQ queues + worker + dashboard scaffolding
- Client: Tailwind 4 with **ported Prodesk brand tokens**, tRPC+TanStack Query wiring,
  Supabase auth context, base UI (button/card/input/label)
- **Working vertical slice:** signup → email confirm → role selection → dashboard,
  with `auth.me` provisioning the app user row (replaces Firebase `on_user_created`)

### Remaining `TODO(by ai)` — all external-credential or infra-bound (grep `TODO(by ai)`)

- **Google Calendar** event/Meet creation on meeting booking (needs Google OAuth).
- **ffmpeg** video transcode in the video worker (needs ffmpeg dep + Storage wiring).

### Post-`db:push` step

Run `psql "$DIRECT_URL" -f server/sql/rls.sql` to enable chat RLS + Realtime replication.

## Tests

Vitest, in `server/`. Run `npm test -w server` (23 tests). Covers the migration
transforms/enum-remap, pagination envelope, staff permission logic (legacy `chat`
expansion), subdomain tenant parsing, payout-date math, and email-template rendering
(ported from `functions/test/test_emails`). The old Firestore-backed integration tests
in `../functions/test` are **not** ported — they target the retired backend. DB-integration
tests need a throwaway Postgres (`TODO(by ai)`).

## Firestore → Postgres migration

One-off, in `server/src/scripts/migrate/`. IDs are **regenerated** (deterministic uuid v5
of `collection:oldId`) so foreign keys remap consistently; `users` ids come from Supabase Auth.

```bash
# 0. point .env at the NEW Supabase, set FIREBASE_SERVICE_ACCOUNT + FIRESTORE_ENV, run db:push
gcloud auth application-default login            # for Firestore read access
npm run migrate:auth -w server                   # Firebase Auth → Supabase Auth (+ id map)
npm run migrate:data -w server                   # backfill all collections
# or: npm run migrate -w server   (both)
```

- **Auth:** passwords can't transfer (Firebase scrypt); users are created email-confirmed
  with no password → they sign in via Google or a password reset. The Firebase-uid →
  Supabase-uid map persists to `server/migration-state/` for re-runnable data backfill.
- **Idempotent:** deterministic uuids + `onConflictDoNothing`; re-run safely.
- Rows whose required parent didn't migrate (e.g. an agency whose owner is missing) are
  skipped rather than inserted with a dangling FK.

## Pulling functions secrets (Google Secret Manager)

```bash
node scripts/pull-secrets.mjs <gcp-project-id>   # e.g. crew-prodesk
```

Writes `functions-secrets.json` (gitignored) and prints a suggested `.env` mapping of the
`PROD_*` secrets onto this project's variable names. Requires your authenticated `gcloud`.

## Notes / decisions

- **Money is `numeric`, never float.** Every currency amount uses `numeric(14,2)` and every
  commission uses `numeric(6,3)` — exact decimal, no rounding drift.
- **Normalized the high-value embedded arrays into tables:** `proposal_items` / `_phases` /
  `_documents` / `_comments`, `purchase_items`, `invoice_items`, `payout_breakdowns`,
  `project_deliverables` / `_revisions` / `_notes`. This enables revenue-by-service reporting,
  status queries (e.g. deliverables pending review), and append-without-row-rewrite.
- **Kept as `jsonb`** only true config/value-objects always read as a unit: service
  variants/options/add-ons, custom fields, project configs, payment plans, amount breakdowns,
  and immutable party snapshots.
- **Chat membership normalized** into `chat_thread_members` (per-user unread count + last-read
  pointer), replacing the `memberIds` array and `unreadCounts`/`lastReadMessageId` maps; dropped
  per-message `readBy` in favour of the last-read pointer.
- **Staff integrity:** typed `staff_permission` enum array; polymorphic org reference replaced by
  nullable `agency_id`/`brand_id` FKs + a CHECK enforcing exactly one.
- **Indexing:** GIN on array-containment columns, partial indexes excluding soft-deleted rows,
  and composite indexes on hot paths (payout cron `(status,to_pay_at)`, task board
  `(assignee,category)`, chat list `(user)`). Case-insensitive unique on `agencies.username`.
- `UserModel.agencyIds/brandIds` arrays → `user_agencies` / `user_brands` junction tables.
- Result: **36 tables, 25 enums, 104 FKs, 3 CHECK constraints** (`server/drizzle/0000_init.sql`).
- ⚠️ `docs/DATA_MODEL_DETAILED.md` predates this normalization — several entries still say
  "Embedded (list)" for proposal/purchase items, deliverables, and chat membership. Refresh
  before re-sending externally.
- The existing `../functions/src` TypeScript (Stripe, payouts, email, calendar, ffmpeg) is
  directly portable into `server/src/modules` — reuse it rather than rewriting.
- Migrations run over the **direct** (`:5432`) connection; the app uses the **transaction
  pooler** (`:6543`, `prepare:false`).

# Deploying

## Branch → environment model

Hosting is **Railway**, which auto-builds and redeploys whenever a branch is
pushed. One branch = one environment:

| Branch        | Environment                                          | Promote from  |
| ------------- | ---------------------------------------------------- | ------------- |
| `development` | dev / local work — all feature work lands here first | —             |
| `staging`     | staging                                              | `development` |
| `main`        | **production**                                       | `staging`     |

Changes only ever flow **forward**: `development → staging → main`. Never commit
straight to `staging`/`main`; promote with the merge flows below so the
environments stay ancestors of each other (every merge is a clean fast-forward /
no-conflict merge).

## Railway services

Each environment runs **two** Railway services off the same branch, built with
NIXPACKS + Bun:

| Service | Config file           | Build                             | Start                  | Notes                                                                  |
| ------- | --------------------- | --------------------------------- | ---------------------- | ---------------------------------------------------------------------- |
| web     | `railway.json`        | `bun run build` (server + client) | `bun run start`        | Serves the tRPC API **and** the built SPA. Healthcheck: `GET /health`. |
| worker  | `railway.worker.json` | `bun run --filter server build`   | `bun run start:worker` | BullMQ job runner (email, payouts, recurring billing). No HTTP.        |

The start command must run the **compiled** server (`bun run start` →
`dist/_core/index.js`), never the `tsx`/dev watcher.

## How the web service serves the SPA (important)

The web service serves the built client itself **only when the client was built
without a separate API origin**:

- `VITE_API_URL` **unset** → the SPA calls its own origin (`/trpc`), and the
  server serves `client/dist` at `/` (see `server/src/lib/env.ts` →
  `isBackendHostedSeperately`). This is the normal single-service prod setup.
- `VITE_API_URL` **set** → the client is built to talk to that separate API host,
  so the server skips static serving. Hitting `/` then returns `Cannot GET /`.

So for the standard single-service deploy, **leave `VITE_API_URL` unset** on the
web service. `SERVER_ORIGIN` is _not_ the toggle for this — it always has a value
(Railway injects `RAILWAY_PUBLIC_DOMAIN`, else it defaults to localhost).

## Required env (per Railway service)

- `DATABASE_URL` (transaction pooler, `:6543`), `DIRECT_URL` (`:5432`, for migrations)
- `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`
- `REDIS_URL` (shared by web + worker)
- `NODE_ENV` = `production` (prod) / `staging` (staging)
- `AUTO_MIGRATE` = `true` to run pending Drizzle migrations on boot (default; the
  web service fails fast and aborts startup if a migration fails)
- Provider/secret keys come from `functions-secrets.json` (gitignored) or real env
  vars — see **Pulling functions secrets** above.
- After a schema change that touches RLS/Realtime, also apply
  `server/sql/rls.sql` against `DIRECT_URL` (it's re-run idempotently on boot via
  `applyRls()`, but apply manually if you've changed it: see local helpers).

# Local helpers

```powershell
# Free port 4000 if a stale dev server is holding it (PowerShell):
Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# Apply RLS / Realtime / storage policies manually (also runs on boot):
psql "$DIRECT_URL" -f server/sql/rls.sql
```

Setting a secret in the old Firebase project (legacy):
`firebase functions:secrets:set SECRET_NAME` —
https://support.google.com/cloud/answer/13804963

powershell -ExecutionPolicy Bypass -File .\.railway\sync.ps1 -e staging

IF YOU ADD NEW DOMAINS THEN
Add in packages/shared/vite/allowed-hosts.ts — only if it's a brand-new apex domain. .prodesk.com, .railway.app, .adeyy.com, .verdiict.com, .manus.computer, sigkitt.com are already wildcarded. A new _.prodesk.com subdomain needs nothing here.
Add PRODESK_ORIGINS in packages/shared/src/lib/env.ts (+ the shared client.env) — if this domain is a new frontend service that other apps hand off to.
Add email links (email/branding.ts:78) — emailBaseUrl only embeds _.prodesk.com origins; anything else silently falls back to app.prodesk.com. So if the new domain is not \*.prodesk.com (e.g. a white-label apex), email action links won't point back to it unless you extend that allow-list.
Add in Supabase Auth (dashboard, not code) — add the domain to the Site URL / Redirect allow-list, or magic-link and OAuth sign-in from the new domain will be rejected. The cross-app /auth/handoff cookie domain is derived from hostname, so a non-prodesk.com domain won't share the session cookie.
Add Railway custom domain + DNS for the service.
