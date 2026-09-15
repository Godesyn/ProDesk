# Project Rules

> Read [architecture.md](../docs/agents/architecture.md) first — it is the source of truth for this project's structure.

## Deployment

See [deployment.md](../docs/agents/deployment.md) for deployment commands.

Promotion path: `development` → `staging` → `main`

1. development — runs the full build (the one real gate)
   git push origin development

2. staging — identical tree, skip the rebuild
   git checkout staging && git reset --hard origin/staging \
    && git merge --no-ff --no-edit development \
    && git push --no-verify origin staging

3. main — identical tree, skip the rebuild
   git checkout main && git reset --hard origin/main \
    && git merge --no-ff --no-edit staging \
    && git push --no-verify origin main

4. back to development
   git checkout development

Verification:

- git rev-list --count origin/staging..origin/development → 0
- git rev-list --count origin/main..origin/staging → 0

## Multi-Frontend Architecture

This monorepo has multiple frontend apps in `clients/` sharing code from `packages/shared/`.

### Communication

- When talking to the user, refer to each app in `clients/` as a **"frontend"** (e.g. "the Dashboard frontend", "the Prodesk frontend"), not "client". The term "client" is a technical directory name only.

### Frontends

Keep this list up to date as new frontends are added. When asking the user which frontend a change applies to, present these as options:

| Frontend                 | Directory             | Description                                                                                                                                     |
| ------------------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Prodesk**              | `clients/prodesk/`    | The main platform — all features                                                                                                                |
| **Dashboard**            | `clients/dashboard/`  | Dashboard — set of tools for brand                                                                                                              |
| **Links** (Adeyy)        | `clients/links/`      | Short-link + QR tool for brands (`url_shortener` feature)                                                                                       |
| **Reviews** (Verdiict)   | `clients/reviews/`    | Review-capture, public directory + embeds for brands (`reviews` feature)                                                                        |
| **Payments** (EziQuotes) | `clients/payments/`   | Proposals/quotes + Stripe Connect payments, chase sequences, payer portals for brands (`payments` feature)                                      |
| **Signatures** (SIGKITT) | `clients/signatures/` | Email-signature builder: signature brand kits, members, campaign banners, analytics, hosted share pages for brands (`email_signatures` feature) |
| **Jobs**                 | `clients/jobs/`       | Multi-role jobs tool (scaffold — shell only, no backend yet)                                                                                    |
| **Websites**             | `clients/websites/`   | Brand-only websites tool (scaffold — shell only, no backend yet)                                                                                |
| **Design**               | `clients/design/`     | User-level design tool (scaffold — shell only, no backend yet)                                                                                  |
| **Logo**                 | `clients/logo/`       | Brand-only logo tool (scaffold — shell only, no backend yet)                                                                                    |
| **Passwords** (KEYMASTR) | `clients/passwords/`  | User-level password vault — keys across every brand, access map, offboarding, Send/Intake (skeleton — mock data, no backend yet; see `clients/passwords/DESIGN.md`) |
| **Chat**                 | `clients/chat/`       | User-level consumer messenger — DMs found by email address, arbitrary groups, realtime, attachments, reactions, read receipts, search. Ungated: every account can open it. Dark-first; see `clients/chat/DESIGN.md` |

> `clients/_template/` is **not** a real frontend — it is the starting template for new ones (see [Creating a new frontend](#creating-a-new-frontend)). Don't list it as a frontend option, don't deploy it, and don't add features to it.

### Rules for UI/behavior changes

1. **Frontend-specific change** — "change X in Dashboard" / "update the navigation panel in Dashboard"
   → Edit or create files in `clients/dashboard/src/` only. Never modify `packages/shared/`.

2. **Shared change** — "change X everywhere" / "update the shared proposal card"
   → Edit files in `packages/shared/src/`. This affects all frontends automatically.

3. **Promote to shared** — "promote this to all frontends" / "make Dashboard's proposal card the default"
   → Move the file from `clients/<app>/src/` to `packages/shared/src/`.
   → Update imports in the originating frontend to point to `@prodesk/shared/...`.
   → Check all other frontends: if they have their own override, leave it. If not, they automatically pick up the promoted version.
   → Delete the old frontend-local file.

4. **Pull back from shared** — "make this frontend-specific" / "only Dashboard should have this"
   → Copy the file from `packages/shared/src/` to `clients/<app>/src/`.
   → Update that frontend's imports to use the local version.
   → If no other frontend uses the shared version, remove it from shared.

### When in doubt

- If the request doesn't specify a frontend, ask which frontend(s) it applies to.
- Always state which files you're modifying and whether the change is shared or frontend-specific.

### UI conventions

- **Never use the native `window.confirm()` / `confirm()` / `alert()` / `prompt()`.** Always use a real in-app dialog box for confirmations and prompts. Use the shared promise-based `useConfirm()` (`@shared/components/ui/confirm-dialog`) in tailwind frontends, or the frontend's local equivalent (e.g. the links/Adeyy app's `useConfirm` in `clients/links/src/app/confirm.tsx`, built on its `Modal`). Destructive actions get `destructive: true`.
- **Prices/amounts must be dynamic** — never hardcode currency amounts in UI copy. Read them from the API (e.g. `entitlement.unitAmount` / `currency`, subscription `amount`) and format with the app's money helper.
- **All super-admin screens live in the Prodesk app only**, under `/super-admin/*`, built from shared pages in `packages/shared/src/pages/super-admin/` and listed in the `superAdmin` branch of `nav-items.ts` (grouped under collapsible headers by area). Satellite frontends (reviews, payments, links, dashboard) must NOT host their own super-admin surface — a tool-specific admin console goes in prodesk as `/super-admin/<tool>` (e.g. `reviews.tsx` → `/super-admin/reviews`, `payments.tsx` → `/super-admin/payments`). The procedures are `superAdminProcedure`-gated server-side, so they work from prodesk regardless of which product they administer. `route-access.ts` already authorizes any `/super-admin/*` path for super-admins.
- **Never use a native `<input type="color">`.** It renders the OS color picker (inconsistent per platform, no brand presets). Always use the shared `ColorPicker` (`@shared/components/ui/color-picker`) — a react-colorful spectrum + hex field + preset swatches, styled with inline styles so it works in any frontend's theme. It takes `value` / `onChange(hex)` and optional `presets`. When a color has a mode-dependent default (e.g. an accent that's black on light / white on dark), compute that same fallback in BOTH the picker's `value` and wherever it's rendered so the preview matches the initial value.
- **Unmatched routes go to the frontend's own root — never a 404 screen.** Every frontend ends its `<Switch>` with the shared `<UnknownRouteRedirect>` (`@shared/components/unknown-route-redirect`), a path-less wouter `<Route>` that client-side redirects to `/`. There is exactly **one** implementation: do not hand-roll a per-app copy and do not add a `NotFound`/404 page (both existed in signatures and payments and have been removed). Mount it **last** in _every_ `Switch` a user-typed URL can reach, including public/unauthenticated ones — a Switch that matches nothing renders null, i.e. a blank screen. Enforced by `scripts/check-frontend-wiring.mjs`, which fails typecheck/pre-commit when a frontend has no fallback or defines a local copy. Auth gating is a separate concern: the unauthenticated and role-less catch-alls still redirect to `/login` and `/role-selection` (query string preserved), and prodesk's authenticated catch-all goes to the role home, which is its root.
- **Satellite frontends must redirect auth routes post-login.** After email/password login the shared `LoginPage` establishes the session in-place **without navigating**, so the URL stays at `/login`. If the authenticated branch of `App.tsx` doesn't intercept `/login` (and `/signup`), the catch-all above fires and bounces the user to the root mid-flow. Always add this guard in `App.tsx` **before** rendering the app shell:
  ```tsx
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }
  ```
- **Every frontend must mount the shared Support pages.** Customer support ticketing is a platform-wide feature: mount the shared `SupportPage` (`@shared/pages/support/support`) at both `/support` (ticket list + create) and `/support/:id` (a single ticket thread) in every frontend's `App.tsx`, mirroring however that frontend mounts `/profile`. `route-access.ts` already allows any `/support` path for authenticated users. The entry point is a "Support tickets" card on the shared `ProfilePage`, so it's automatically discoverable everywhere. `_template` has the canonical (mandatory) block — new frontends inherit it. Super-admins triage tickets from `/super-admin/tickets` in prodesk only.
- **Centralised env access.** Frontend code never reads `import.meta.env` directly — the only module that does is `packages/shared/src/lib/env.ts`. Import the typed constants from `@shared/lib/env` (`STRIPE_PUBLISHABLE_KEY`, `API_URL`, `SUPABASE_URL`, `IS_PROD_BUILD`, …) or its semantic layers: `@shared/lib/app-env` for deployment-environment gating (`IS_PRODUCTION`, `ENV_BADGE`) and `@shared/lib/origins` for cross-frontend hosts (`PRODESK_ORIGINS`, `mainAppUrl()`). A new `VITE_*` var gets added in `env.ts` once and consumed everywhere from there. Enforced by `scripts/check-frontend-wiring.mjs` (fails typecheck/pre-commit on direct reads).

## Backend Architecture

Backend logic is split between `packages/server-shared/` (shared code) and `servers/` (service entrypoints).

### Backends

Keep this list up to date as new backends are added.

| Backend     | Directory          | Description                               |
| ----------- | ------------------ | ----------------------------------------- |
| **Backend** | `servers/backend/` | Main API server — Express + tRPC + BullMQ |

### Rules for backend changes

1. **Shared backend code** — DB schema, tRPC routers, modules (Stripe, email, billing, etc.), jobs, lib utilities
   → Edit files in `packages/server-shared/src/`. This is consumed by all backend services.

2. **Backend-specific code** — Express entrypoint, migration scripts, drizzle config, worker boot
   → Edit files in `servers/backend/src/`. The backend imports from `@prodesk/server-shared/...`.

3. **Migrations** — Only `servers/backend/` owns migrations. The `drizzle/` folder, `drizzle.config.ts`, and `src/scripts/migrate*` stay in `servers/backend/`.

4. **New backend service** — Create a new directory under `servers/`. It depends on `@prodesk/server-shared` for DB/schema/modules but does NOT own migrations or run them.

### Server boot sequence (`servers/backend/src/_core/index.ts`)

When `AUTO_MIGRATE` is on, startup runs three steps **in order**, before the API listens:

1. **Migrations** (`runMigrations`) — brings the schema up to date. **Fatal** on error (aborts startup; serving a stale schema is worse than not starting).
2. **RLS / realtime / storage policies** (`applyRls`, from `sql/rls.sql`) — idempotent, re-applied every boot. **Non-fatal**: logs and continues.
3. **Stack initialization** (`runInitialization`, from `scripts/initialize-core.ts`) — seeds/repairs the baseline rows the app can't run without (super-admin, global settings, the built-in feature-subscription products with an active price each). Runs **after** migrations so its tables exist. **Non-fatal**: logs and continues.

Rules for the init step:

- **It MUST stay idempotent** — it runs on _every_ boot. Every step is check-then-write (look up by a stable key, insert only when missing) and self-heals missing children (e.g. a product with no active price) without overwriting user-edited data. The full contract is documented at the top of `scripts/initialize-core.ts`; keep it intact when adding seed steps.
- **`initialize-core.ts` holds the logic; `initialize.ts` is only the CLI wrapper** (`npm run db:initialize`). The core must NOT import `./env-setup.js` or call `process.exit` — those are CLI-only. Seed-data files are read lazily _inside_ the function so a missing file can't throw during import (which would crash boot before the non-fatal catch).
- The build copies `src/scripts/initialize_data/` into `dist/` (see the `build` script) so the boot-time read works in prod, not just under `tsx` in dev.

### Feature subscriptions & payments

All recurring feature subscriptions (Reviews, the URL shortener, and every future
product) go through **one** shared path: the `featureSubscriptions.checkout` tRPC
mutation → `modules/feature-subscriptions/stripe.ts` → the webhook recorder in
`modules/feature-subscriptions/webhook.ts`. Do NOT build a per-product subscribe
flow — add the product and reuse this path so it inherits every rule below.

- **Charge the card on file before opening Checkout.** `checkout` first calls
  `createFeatureSubscriptionOnFile` — if the brand owner's Stripe customer already
  has a default payment method, it creates the subscription directly (charged on
  that card, `payment_behavior: 'error_if_incomplete'`, **no redirect**) and
  returns `{ url: null, status: 'active' }`. Only when there's no card on file (or
  the on-file card is declined / needs SCA) does it fall back to hosted Checkout
  (`{ url, status: 'checkout' }`). Frontends already handle both: redirect when
  `res.url` is set, otherwise invalidate + toast. **Any new subscribe UI must
  handle a null `url` the same way** — never assume a redirect.
- **Both activation paths persist through the same recorder.** Hosted Checkout
  (`checkout.session.completed` → `handleFeatureCheckoutCompleted`) and the on-file
  path both call `recordFeatureSubscription(sub)`. It's idempotent (keyed on
  `stripeSubscriptionId`) and owns all side effects (row upsert, per-unit quantity
  reconcile, referral settlement, first-activation email). Add new side effects
  there — not in one path only — so the two never drift. Note the webhook does
  **not** handle `customer.subscription.created`, so a directly-created sub must be
  recorded by whoever creates it.
- **Keep the customer default payment method in sync.** `recordFeatureSubscription`
  calls `syncCustomerDefaultPaymentMethod`, which promotes the subscription's
  paying card to `customer.invoice_settings.default_payment_method` when none is set
  (Checkout attaches the card + sets the _subscription_ default but never the
  _customer_ default). This is what makes the "Card on file" panel populate after
  subscribing and what renewals charge. It never overrides an existing default.
- **Card-on-file management is tool-agnostic.** The SetupIntent card procedures
  live on the `shortLinks` router (`paymentMethod` / `createSetupIntent` /
  `setDefaultPaymentMethod`) but operate on the brand owner's single shared Stripe
  customer — the same card backs every feature sub. Reuse them; don't add
  per-product card procedures.

### Beta programme

Time-boxed free access to the whole suite in exchange for feedback — full model in
[`docs/beta-program.md`](../docs/beta-program.md). Three rules to know before touching
anything nearby:

- **Never add per-feature beta checks.** Beta access is one expiry clause inside
  `isBetaUser()` (`modules/feature-subscriptions/entitlements.ts`), which every paid
  gate already funnels through. When a beta lapses, every paid feature — present and
  future — locks by itself. A feature that gates on `brandHasFeature` is already correct.
- **Every frontend MUST mount `<BetaProgram />`** (`@shared/beta/beta-program`) in the
  authenticated branch of its `App.tsx`, beside `<PendingInvitePrompt />`. It carries the
  beta countdown, the post-beta price report, and the floating feedback tab, and all three
  self-suppress for non-members. `scripts/check-frontend-wiring.mjs` **fails** the
  typecheck when a frontend (or `_template`) is missing it.
- **One report builder.** `modules/beta/report.ts` feeds the reminder emails, the in-app
  screen, and the activation that charges the card. Adding a product to the report means
  adding a usage probe in `modules/beta/usage.ts` — nothing else. Never compute a price or
  total anywhere else, and never trust one from the client.

Feedback is a support ticket with `source = 'feedback'` (same table, same triage console),
but the UI must never present it as a ticket — see the doc's §7.

### Creating a new frontend

When the user says **"create a new frontend"** (for some feature/product), **always start by copying the template** at `clients/_template/` — never hand-assemble one from scratch. The template is a working frontend with the shared auth, context, and theming scaffolding already wired and no UI/design opinions of its own.

Steps (full checklist in `clients/_template/README.md`):

1. `cp -r clients/_template clients/<name>`
2. Set `"name"` in `clients/<name>/package.json`.
3. In `clients/<name>/vite.config.ts`: set `__PRODESK_CLIENT__` to `<name>` and pick a unique dev `port`.
4. Set the `<title>` in `clients/<name>/index.html`.
5. In `clients/<name>/src/App.tsx`: replace `<LandingPage />` with the frontend's real routes. The unknown-route fallback is already wired — keep the shared `<UnknownRouteRedirect>` as the last `<Route>` of every `Switch` you add (see the `NOT-FOUND RULE` comment in the template). If the frontend needs its own hosted domain, add `VITE_<NAME>_PRODESK_ORIGIN` to the root `.env`/`.env.example` + `.railway/envs/shared.*.env` and expose it in `@shared/lib/origins`.
6. Add design-token overrides (if any) to the trailing `@theme {}` block in `clients/<name>/src/index.css`. **Never hardcode the accent** (`--color-accent`, `--accent-h/s/l`) — it is driven at runtime for agency white-labeling.
7. Wire the new frontend into dev + verification:
   - The root `build`/`typecheck` scripts (and the pre-push build) run via `scripts/run-all.mjs`, which **derives the workspace list from `clients/` + `servers/` automatically** — nothing to add there. The pre-commit hook type-checks only the workspaces the staged files touch (`scripts/affected-typecheck.mjs` → `scripts/affected.mjs`); a new frontend is picked up automatically there too.
   - `scripts/dev.mjs`: register the frontend in the `FRONTENDS` table (prefix color + any extra services it needs, e.g. links → redirector).
   - Root `package.json`: add a `"dev:<name>": "node scripts/dev.mjs <name>"` script.
   - This is **enforced** by `scripts/check-frontend-wiring.mjs`, which runs first in both `bun run typecheck` and the pre-commit hook: it fails (with pointers) when a frontend is missing from the `dev.mjs` table or has no `dev:<name>` script, when root build/typecheck stop delegating to `run-all.mjs`, when pre-push stops building via `run-all.mjs`, or when pre-commit stops type-checking affected workspaces. It warns when a frontend has no `.railway` config or `sync.ps1` service entry yet. If the guard fires, fix the wiring — don't bypass it.
8. Add `.railway/configs/clients/<name>.json` and create the Railway service.
9. Add the new frontend to the table above and to `docs/agents/architecture.md`.
10. Wire the new frontend into the Railway env sync:
    - **All frontends share the single env file `.railway/envs/client/client.env`** (frontend vars are public `VITE_*` values, so one file covers every client) — do NOT create a per-frontend env file. Only touch `client.env` if the new frontend needs a `${{shared.VAR}}` reference that isn't in it yet (e.g. a new `VITE_<NAME>_PRODESK_ORIGIN`).
    - In `.railway/sync.ps1`: add `"<Railway service name>" = "client\client"` to the `$serviceMap`.

## Verifying changes (typecheck)

When verifying that a change is sound, **typecheck the entire workspace — not just the package you edited.** Shared code feeds every downstream app, so a change in `packages/shared` or `packages/server-shared` (or any type-level change) can break a package the local check never touched.

Cover **all** of:

- Both shared folders: `packages/shared` and `packages/server-shared`
- Every frontend under `clients/` (e.g. `prodesk`, `dashboard` — there may be more)
- Every server under `servers/` (e.g. `backend`, `redirector` — there may be multiple)

Prefer the root script, which fans out across all of them:

```bash
bun run typecheck
```

The root script needs no updating for new clients/servers — it runs `scripts/run-all.mjs`, which derives the workspace list from the `clients/` and `servers/` directories and typechecks them all in parallel. `scripts/check-frontend-wiring.mjs` (the first step) guards the wiring that IS still explicit (dev scripts, Railway).

## Git Workflow

- Always work on the `development` branch. Never commit directly to `staging` or `main`.
- Pull before starting: `git checkout development && git pull origin development`
- Commit and push when done:
  ```bash
  git add -A
  git commit -m "describe the change"
  git pull origin development
  git push origin development
  ```
- If any command prints **CONFLICT**, stop immediately and ask the user. Do not force-push or attempt to resolve.
