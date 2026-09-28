# ProDesk — Developer Handover

Everything a new developer needs to get productive on this project. Written September 2026,
after the project was taken over from the original developer and rebuilt onto the client's own
accounts.

For the project's internal rules and conventions, read [`.agents/AGENTS.md`](.agents/AGENTS.md)
and [`docs/agents/architecture.md`](docs/agents/architecture.md) — they are the source of truth for
how the code is organised. This file covers everything those don't: current status, setup, and the
state of the takeover.

---

## 1. What ProDesk is

A multi-tenant business platform for brands and agencies. One backend serves **12 separate frontend
apps**, each one a product in its own right (links, reviews, payments, signatures, chat, and so on).

Today each app is built and deployed separately. **That is changing** — see §9.

| App | Directory | State |
| --- | --- | --- |
| Prodesk (main platform, admin panel) | `clients/prodesk/` | working |
| Dashboard | `clients/dashboard/` | working; app catalogue, strategist chat and KPIs are presentational only |
| Links / ADEYY | `clients/links/` | working |
| Reviews / Verdiict | `clients/reviews/` | working |
| Payments / EziQuotes | `clients/payments/` | working; several features marked "coming soon" |
| Signatures / SIGKITT | `clients/signatures/` | working |
| Chat | `clients/chat/` | working |
| Logo | `clients/logo/` | partially built, has a backend |
| Passwords / KEYMASTR | `clients/passwords/` | **screens only**, mock data, no backend, no encryption |
| Jobs, Websites, Design | `clients/jobs/`, `websites/`, `design/` | **empty shells**, no backend of their own |

`clients/_template/` is the starting template for a new app — not a real app, never deploy it.

---

## 2. Tech stack

| Layer | Tech |
| --- | --- |
| Package manager | **Bun** workspaces (Node 22+) |
| Frontend | React 18, Vite 5, Tailwind CSS 4, Radix UI, wouter (routing), TanStack Query |
| API | Express 4 + **tRPC 11**. No REST layer — frontends call typed procedures directly |
| Database | Supabase Postgres via **Drizzle ORM** (111 migrations, 145 tables) |
| Auth / storage / realtime | Supabase |
| Background jobs | BullMQ + Redis, run as a separate worker process |
| Payments | Stripe (incl. Connect), PayPal, Wise |
| Hosting | Railway |
| Tests | Vitest (backend only — 54 test files; 2 on the frontend) |

---

## 3. Repo layout

```
servers/backend/          Express entry point, worker entry, Drizzle config + migrations
servers/redirector/       Short-link / QR redirect service
packages/server-shared/   ★ Most backend code: DB schema, 39 tRPC routers, modules, jobs
packages/shared/          ★ Most frontend code: auth, UI components, whole pages, theming
clients/<app>/            Each app — mostly routes and app-specific overrides
docs/                     Feature docs, architecture, parity notes
.railway/                 Deploy configs per service
```

Most real code lives in the two `packages/` folders. `clients/prodesk` has only three files because
it reuses shared pages.

---

## 4. Running it locally

**Prerequisites:** Node 22+, [Bun](https://bun.sh), and Redis
(`winget install --id Memurai.MemuraiDeveloper -e` on Windows).

```bash
bun install
bun run dev:prodesk       # backend :4000 + Prodesk app :5173
bun run dev:dashboard     # Dashboard app :5174
```

`bun run dev` starts everything (all 12 apps) — heavy, rarely what you want.

⚠️ Every `dev` command first kills anything listening on ports 4000–4005 and 5173–5190. Stop other
projects on those ports first.

**Ports:** prodesk 5173, dashboard 5174, links 5175, reviews 5176, payments 5177, signatures 5178,
jobs 5179, websites 5180, design 5181, logo 5182, passwords 5183, chat 5184. Backend 4000,
redirector 4001.

**Environment:** copy `.env.example` to `.env` at the repo root. Only six values are required —
`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`SUPABASE_JWT_SECRET`. Everything else switches a feature on when present and disables it when
absent. **Never commit `.env`.**

On first start against an empty database the backend runs all migrations, applies the security
rules, and creates the admin account.

**Admin login:** `admin@prodesk.com` / `Test1234@` — change this; the password is in the old
handover document.

---

## 5. Where the credentials are

**Not in this repo, and never to be committed.** The client (ab.y@noize.com.au) owns every account;
ask the lead developer for the credentials file.

Services in use: **Supabase** (database, auth, storage), **Railway** (hosting + Redis), **Brevo**
(email), **Sentry** (errors). Stripe, Google Cloud and the AI providers are not connected yet.

---

## 6. Deployment

Hosted on Railway, one service per program, all built from this repo with a different build command:

| Service | Build | Start |
| --- | --- | --- |
| backend | `bun run --filter backend build` | `bun run --filter backend start` |
| worker | `bun run --filter backend build` | `bun run start:worker` |
| redirector | `bun run --filter redirector build` | `bun run --filter redirector start` |
| any app | `bun run --filter <app> build` | `bun run --filter <app> preview --host 0.0.0.0 --port $PORT` |

Pushing to `main` deploys automatically.

- Web services need a `PORT` variable matching the port chosen when generating the domain (8080 for apps).
- Frontend settings are baked in **at build time**, so changing `VITE_*` requires a redeploy.
- `VITE_API_URL` must be set on the backend too — it tells the backend it is API-only.
- Railway's **config-as-code is deprecated** (`.railway/configs/*.json` may be ignored on new
  services) — set build and start commands in the dashboard instead.
- `.railway/sync.ps1` and `.railway/envs/` are from the old setup and currently unused.

---

## 7. Working conventions

Full detail in `.agents/AGENTS.md`. The ones that catch people out:

- **Shared vs app-specific:** a change in `packages/shared` affects all 12 apps. App-only changes go
  in `clients/<app>/src`.
- **Backend logic** lives in `packages/server-shared`. Only `servers/backend` owns migrations.
- **Never read `import.meta.env` directly** — import from `@shared/lib/env`.
- **No `alert()` / `confirm()`** — use the shared `useConfirm()`.
- **No `<input type="color">`** — use the shared `ColorPicker`.
- **Never hardcode the accent colour** — it is set at runtime for agency white-labelling.
- **No 404 pages** — every route `Switch` ends with the shared `<UnknownRouteRedirect>`.
- **Money is `numeric`, never float.** Never hardcode prices in the UI.
- Run `bun run typecheck` at the repo root — it checks every app, not just the one you touched.

**Git:** work on `development`, promote to `staging`, then `main`. Git hooks type-check on commit
and build on push.

---

## 8. Known issues and gotchas

- **The migration files are not reliable history.** 19 of them were edited after being applied to
  the original developer's databases. They do apply cleanly to a fresh database — that has now been
  verified — but don't treat the SQL as a record of what those old databases contain.
- **Fresh-install bug (fixed).** `initialize-core.ts` seeded the global settings row and the admin
  user in parallel, but settings reference the admin, so a brand-new database failed with a foreign
  key error. Now sequential. Only ever visible on a first-time install.
- **Nothing runs the tests automatically.** No CI. A push to `main` reaches production unchecked.
  The git hooks are local only, and the documented release flow skips them with `--no-verify`.
- **Don't set `PORT` in the root `.env`.** The redirector reads the same file and would take the
  backend's port 4000. Unset, backend uses 4000 and redirector 4001.
- **Emails don't send without SMTP.** Locally they're printed to the backend log instead.
- **Redis is required** for background jobs. Without it the API still runs, but anything queueing a
  job (emails, notifications) hangs.
- **Documentation drift.** The root `README.md` describes an older folder layout (`server/`,
  `client/`) and lists features as unfinished that now exist (Google Calendar). Trust the code and
  `docs/agents/architecture.md`.
- **Repo visibility:** this repo must be **private**. Check it.

---

## 9. Where the project is going

The client wants **one website**, not twelve. Clicking an app in the dashboard should open it inside
the same page — each app keeping its own sidebar and top bar within the content area — rather than
opening another site. **No standalone sites for any app.**

Planned sequence:

1. Rebuild the dashboard shell from the new wireframes (Figma: sidebar, global search, AI Strategist
   panel, upgrade banner, plans & billing, profile, notifications — 11 screens).
2. Merge **ADEYY (links)** into the shell first, as the proof.
3. Then reviews, signatures, payments, chat — one at a time.

Each merged app becomes a component mounted on a route (`/app/links`), loaded on demand. Expect the
fiddly part to be style and route collisions between apps, not the screens themselves.

Once merged, Railway needs only: backend, worker, redirector, one website, Redis.

Note: features with **public pages** (review request pages and embeds, payer portals for quotes and
invoices, shared signature pages, short links) still need public addresses. They will live under the
single domain instead of separate sites.

---

## 10. Status of the takeover (September 2026)

The project was handed over by the original developer with everything running on his personal
accounts, and with live credentials written in plain text in a handover document. It has been rebuilt
from scratch on accounts the client owns.

**Done**
- New Supabase project — schema built from the migrations, admin account created
- New Railway project — backend and the Prodesk app deployed, Redis running
- New GitHub repo, branch renamed `master` → `main`
- Production chat backup removed from the repo, `.gitignore` corrected
- Local development running against the new database

**Outstanding**
- Brevo (email) and Sentry (error tracking) not yet connected
- Stripe, Google sign-in, Google Maps, AI providers not set up
- Domains still with the client's own contact — nothing points at the new hosting yet
- The old developer's Railway and Supabase accounts should be cancelled by the client
- No automated checks before deploy

Background on the takeover requirements lives in the client's punch list (security, ownership,
documentation, safety nets). Ask the lead developer for it — it is not in this repo, because it
quotes credentials.
