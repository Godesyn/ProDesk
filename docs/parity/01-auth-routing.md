# Authentication, Onboarding & Route Access

This is the authoritative specification of how a user signs in, gets provisioned,
chooses (or recovers) a role, and is gated through the app. The behavior lives in
the React client (`client/src`), the tRPC auth router (`server/src/routers/auth.ts`),
and the request context (`server/src/trpc/context.ts`). Auth is backed by Supabase
GoTrue; data by Drizzle/Postgres.

Key files:

- Routing + redirect chain: `client/src/App.tsx`
- Client route authorization: `client/src/auth/route-access.ts`
- Session + provisioning: `client/src/auth/auth-context.tsx`
- Onboarding hooks: `client/src/auth/use-invite-redemption.ts`, `client/src/auth/use-auto-select-context.ts`, `client/src/auth/use-subdomain-redirect.ts`
- Multi-tenant subdomain detection: `client/src/lib/subdomain.ts`
- Auth screens: `client/src/pages/{login,signup,verify-email,role-selection,auth-reset,auth-confirm,auth-handoff}.tsx`
- Server auth + edge-case healing + context switching: `server/src/routers/auth.ts`
- Request context (token verify + tenant resolve): `server/src/trpc/context.ts`
- Role/permission types: `client/src/components/layout/nav-items.ts` (re-exported by `sidebar.tsx`)

---

## 1. Session model

`AuthProvider` (`auth-context.tsx`) holds the Supabase `Session` and subscribes to
`onAuthStateChange`. On any identity change (login, logout, account switch) it wipes
the entire React Query cache (`qc.clear()`), so no data from a previous user can ever
flash on screen.

The canonical app user is `auth.me` (tRPC), gated on an active session
(`useCurrentUser`). The server verifies the GoTrue access token supporting **both**
the symmetric HS256 (shared JWT secret) format and the asymmetric signing-keys system (ES256/RS256
via the project JWKS), chosen by the token `alg` header (`context.ts:49-74`).

`auth.me` returns the user row plus `agencyIds`, `brandIds`, `hasContractorProfile`,
and the resolved `permissions` array for the active org context. It runs the
self-healing edge-case pass (§7) before returning, so callers always receive a valid
state.

---

## 2. Account provisioning

On first authenticated load, the client calls `auth.ensureUser`
(`auth-context.tsx:51-61`), passing referral context resolved from the URL via
`detectReferral()`. Provisioning is idempotent (`ensureUser` returns the existing row
if present) so it safely covers the email-confirmation flow where no session existed
at sign-up time.

`ensureUser` (`auth.ts:811-877`):

- Inserts `users` with `id`, `email`, `firstName`/`lastName` — preferring explicit
  input, falling back to names carried in `user_metadata` from sign-up.
- Captures the referrer, stamped **only on first insert**:
  - `referredByUserId` from `?ref_user_id=` (an individual affiliate).
  - `referredByAgencyId` from `?ref=<agencyId>`, else resolved from the tenant
    subdomain username (the agency whose theme the user already saw).
- Sets `isEmailVerified` based on the sign-in provider: OAuth providers (e.g. Google)
  vouch for the email and start verified; email/password signups start unverified
  and must click the verification link.
- Attaches a platform-admin support thread (`ensurePlatformAdminThread`) so every new
  user can reach support. Best-effort; never blocks provisioning.

---

## 3. Sign-up & sign-in

### Sign-up (`pages/signup.tsx` → `auth.signUp`)

The signup form collects First/Last name (2-column grid), Email, Password, and
**Confirm Password** (with mismatch validation). It calls `auth.signUp`, then signs
the user in.

`auth.signUp` (`auth.ts:262-316`) follows a "login now, verify later" model: it
creates the GoTrue account with `email_confirm: true` so password login works
immediately (no blocking GoTrue gate), then delivers a **branded verification link**
over our own SMTP. Email verification is tracked at the app level on
`users.isEmailVerified` (starts `false` for email signups, set `true` only when the
user redeems our link), independent of GoTrue's `email_confirmed_at`. Names ride in
`user_metadata` so they survive to first authed load.

`auth.resendConfirmation` (`auth.ts:324-347`) re-issues a magic link; redeeming it
both confirms the email and establishes a session.

### Sign-in (`pages/login.tsx`)

The login screen offers email/password sign-in plus a **Google** button
(`signInWithOAuth({ provider: 'google' })`) with a Google mark icon, a
**Forgot password?** link, and a sign-up link. When a password login fails, it calls
`auth.startMigratedReset`; if the account is a flagged migrated user it routes to the
4-digit OTP recovery flow (§4), otherwise it shows the normal invalid-credentials
error.

---

## 4. Password reset

Three flows, all rendered without an auth session:

- **Forgot password** (`/forgot-password` → `ForgotPasswordPage`): requests a reset
  via `auth.requestPasswordReset` (`auth.ts:391-413`), which emails a recovery link.
  Always resolves success (never reveals whether the account exists).
- **Set new password** (`/auth/action` → `ResetPasswordPage`): redeems the recovery
  `token_hash` with `verifyOtp({ type: 'recovery' })`, then `updateUser({ password })`.
  Phases: verifying → ready (password + confirm with mismatch validation) → invalid.
- **Migrated-account recovery** (`/auth/reset-otp` → `MigratedResetPage`): accounts
  brought over from the previous auth system have no usable password and are flagged
  `requiresPasswordReset`. A 4-digit code (10-min TTL, 5-attempt cap, only the
  SHA-256 hash stored) is emailed by `auth.startMigratedReset`, validated by
  `auth.verifyMigratedOtp`, and the new password is set by `auth.completeMigratedReset`
  (server-side via the admin API, since there is no session yet). Brute force is
  bounded by `OTP_MAX_ATTEMPTS` + the short TTL (`auth.ts:40-86, 426-499`).

---

## 5. Email-verification gate

A signed-in user whose app-level email is not yet verified is **hard-blocked** from
the entire app — role-selection included — until they confirm (`App.tsx:157-159`).
The gate (`pages/verify-email.tsx`) shows the pending email address, polls `auth.me`
every 3 seconds, and advances on its own the moment the flag flips. It offers
"I have verified my email" (re-check), "Resend verification email", and "Sign out".

Verification flips when the user redeems our link on **any** device:
`/auth/confirm` (`AuthConfirmPage`) establishes the session via `verifyOtp` and calls
`auth.markEmailVerified` (`auth.ts:357-383`), which is a `sessionProcedure` (not
`protected`) so a fresh device can redeem the link before the app `users` row exists
— in which case it provisions the row verified. OAuth users are pre-verified and
never see this gate.

The loading screen between session resolution and first render holds until `auth.me`
resolves for the current user, so the dashboard / role-selection never flashes before
the verify gate can engage (`App.tsx:127-134`).

---

## 6. Onboarding & role selection

A verified user with **no role** (and not a super-admin) is held in the chromeless
onboarding shell (`App.tsx:171-188`). They may reach `/role-selection`, the three
create screens, and the role-independent screens `/tasks` and `/profile` (so they can
act on pending invitations, e.g. accept a staff invite from Tasks, before committing
to a role). Anything else redirects to `/role-selection`.

### Role selection (`pages/role-selection.tsx`)

Picking a role does **not** set it directly. Each card navigates to the matching
create screen — `/create-brand`, `/create-agency`, `/create-contractor` — and the
role + organization are committed only once that entity is created
(`brands.create` / `agencies.create` / `contractor.create`). This guarantees a user
is never left with a role but no organization. (`auth.ts:879-886` documents that
`selectRole` no longer exists for exactly this reason.)

Behaviors:

- **Contractor suppression**: the Contractor card is hidden once the user already has
  a contractor profile (`hasContractorProfile` from `auth.me`).
- **Pending invitations**: invitation-type tasks (`staffInvitation`,
  `connectionRequest`) are surfaced as tiles below the role cards; tapping one opens
  the same `TaskDetailDialog` the Tasks board uses, so accept/decline works there.
- **"Maybe later" escape**: shown only once the user already has a role; returns to
  the dashboard untouched.
- **Add-role mode**: a roled user may revisit `/role-selection` only with `?add=true`
  (`App.tsx:199-205`); otherwise they are bounced to their dashboard. Query strings
  are preserved across the create-screen hops.

### Auto-select on login

`useAutoSelectContext` (`use-auto-select-context.ts`) resolves the common case where
a verified, role-less, non-super-admin user already has valid identities (an
accepted staff seat, an owned/staff org, or a contractor profile). It queries
`auth.contextOptions`, switches into the first non-disabled option via
`auth.switchContext` (which persists role + selected org server-side), and routes to
the dashboard — instead of parking them on role-selection. It is skipped while an
invite token is pending (that flow owns role assignment), and genuinely role-less
users are left on role-selection.

### Invitation redemption

`useInviteRedemption` (`use-invite-redemption.ts`) drives the `/signup?invite=<token>`
email links. The token is stashed in `localStorage` the moment it appears in the URL
(so it survives the signup → verify → confirm navigation chain) and redeemed via
`auth.redeemInvite` once the user is verified:

- **staff** → server links + activates the pending staff seat, switches the user into
  the staff context (role + selected org), completes the system task, and applies
  granted permissions (`auth.ts:545-592`). Client clears the token and routes to the
  staff workspace.
- **contractor** → if already a contractor, the connection is established immediately
  and the token cleared; otherwise the client keeps the token and routes to
  `/create-contractor`, which consumes it when the profile is built.
- **proposal** → the tokenized "View & Accept Proposal" link; the server connects the
  proposal (claiming the agency's unclaimed referral brand and stamping the referring
  agency on the recipient when applicable), or hands back a flag so the client shows
  the public brand chooser (`auth.ts:600-678`).

---

## 7. Self-healing edge cases

`healUserEdgeCases` (`auth.ts:134-222`), run inside `auth.me` before every response,
keeps users out of dead states when their selected agency/brand was deleted or their
active staff record was removed. It detects the dead/limbo condition for the current
role and walks a fallback ladder, persisting the result:

1. valid agency membership → `agencyOwner` (selected agency = first membership)
2. else any active staff record → `agencyStaff`/`brandStaff` pointing at that org
3. else any brand membership → `brandOwner`
4. else → clean `brandOwner` with no org

A super-admin with no org is promoted to the `superAdmin` role. Contractors and users
already in a valid state are untouched. A **null** role is treated as the legitimate
pre-onboarding state (routed to role-selection), not as limbo to be healed.

---

## 8. Multi-tenant subdomains & cross-domain hand-off

The tenant is the leading host label (prod) or a `?subdomain=` query param (dev),
matched to an agency by `username`. Server-side, `tenantFromHost` /`resolveTenant`
expose `ctx.tenant` (`context.ts:8-23, 76-82`). Client-side,
`client/src/lib/subdomain.ts` provides `getSubdomain`, `getSubdomainUrl`,
`isLocalhost`, and `detectReferral`; that agency is the session's referring agency and
drives white-label theming. Platform identity constants (`PRODESK_IDENTITY`) live
beside the detector.

**Post-login white-label redirect** (`use-subdomain-redirect.ts`): when an
authenticated user is on a subdomain that does not match their referring agency (the
common case: they signed in on the default `app` domain), the session is handed off to
the agency's white-label subdomain. Because Supabase sessions are per-origin, the
session cannot be copied directly; instead the client mints a one-time magic-link
token (`auth.createSubdomainHandoff`, `auth.ts:236-248`), signs out of the current
origin, and redirects to `<username>.<domain>/auth/handoff?token_hash=...`. The
landing page (`AuthHandoffPage`) redeems the token to establish a session there — the
same redemption path as `/auth/confirm`. The redirect holds a loading screen so the
dashboard never flashes, runs at most once per session, and is skipped on localhost
(subdomains are query-param simulated in dev).

---

## 9. Routing & redirect chain (`App.tsx`)

Order of evaluation:

1. **Deep-link / public routes** render regardless of auth state: `/auth/confirm`,
   `/auth/handoff`, `/auth/action`, `/auth/reset-otp`, `/forgot-password`,
   `/public/brand/*`, `/public/proposal/*`. (Privacy & Terms are external links to
   the marketing site, not routed here.)
2. **Loading hold** until `auth.me` resolves for the current user; **hand-off hold**
   while a subdomain redirect is in flight.
3. **Unauthenticated** → only `/login` and `/signup`; everything else redirects to
   `/login` (preserving the query string).
4. **Email-verification gate** (§5).
5. **Role-less** (non-super-admin) → onboarding shell (§6).
6. **Add-role mode** + landing-page bounce (`/`, `/login`, `/signup` → role dashboard).
7. **Per-route authorization**: `canAccess(location, identity)`. Denied → role
   dashboard.

`RedirectPreserve` carries the current query string through every redirect, so deep
links carrying referral / checkout context never lose it.

The access identity is assembled from `auth.me`:
`{ role, isSuperAdmin, permissions, agencyVerified, agencyDeleted }` (`App.tsx:190-196`).

---

## 10. Route-access matrix (`route-access.ts`)

`canAccess(path, identity)` is the single source of client-side authorization. The
router consults it before rendering, so URL-bar manipulation cannot reach a screen the
user's active identity does not grant. **Unknown shell routes deny by default.**

Rules:

- **Owners** (`agencyOwner` / `brandOwner`) bypass permission checks; staff are checked
  against their granular `StaffPermission` set (`has(perm) = isOwner || permissions.includes(perm)`).
- **Super-admin namespace** (`/super-admin/*`) is gated on `isSuperAdmin` independent of
  the active role, so a super-admin acting as an owner keeps admin access.
- **Pending/unverified agency**: an agency user whose active agency is unverified (and
  not deleted) can reach **only** `/agency-dashboard`.

`StaffPermission` and `UserRole` are defined in
`client/src/components/layout/nav-items.ts`. The `permissions` array is computed
server-side in `auth.me`, including the implied "view projects" expansion for
workflow-permission holders (`expandAgencyPermissions`).

| Route                                                                                                                                                                              | Access rule                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `/`, `/profile`, `/chat`, `/tasks`, `/role-selection`, `/create-{brand,agency,contractor}`, `/payment-success`, `/payment-cancel`, `/post-checkout*`, `/staff-dashboard`, `/login`, `/signup`, `/forgot-password` | Always allowed (any authed user) |
| `/public/*`, `/auth/{action,confirm,handoff}`, `/loading*`                                                                                                                          | Public (no auth)                                                                                             |
| `/super-admin/*`                                                                                                                                                                    | `isSuperAdmin` (independent of active role)                                                                  |
| `/agency-dashboard`                                                                                                                                                                 | agency + `agencyDashboard` (or owner). A pending/unverified agency can ONLY see `/agency-dashboard`          |
| `/clients`, `/clients/:id`                                                                                                                                                          | agency + `clients`                                                                                           |
| `/section-library`                                                                                                                                                                  | owner or `agencyBusinessInfo`                                                                                |
| `/agency-projects`                                                                                                                                                                  | agency + `agencyProjects`                                                                                    |
| `/catalog`                                                                                                                                                                          | agency + `catalog`                                                                                           |
| `/workflow-settings`                                                                                                                                                                | owner or `rolesAndCommissions`                                                                               |
| `/manage-resources`                                                                                                                                                                 | agency + `manageResources`                                                                                   |
| `/agency-invoices`                                                                                                                                                                  | owner or `invoice`                                                                                           |
| `/agency-subscriptions`                                                                                                                                                             | owner or `subscriptions`                                                                                     |
| `/agency-bank-account`                                                                                                                                                              | owner or `bankAccount`                                                                                       |
| `/edit-agency`                                                                                                                                                                      | owner or `agencyInfo`                                                                                        |
| `/agency-affiliate`                                                                                                                                                                 | any agency                                                                                                   |
| `/agency-contractors`                                                                                                                                                               | owner or `manageContractors`                                                                                 |
| `/brand-dashboard`                                                                                                                                                                  | brand + `brandDashboard`                                                                                     |
| `/brand-profile`                                                                                                                                                                    | owner or `brandBusinessInfo`                                                                                 |
| `/info-hub`                                                                                                                                                                         | brand + `brandBusinessInfo`                                                                                  |
| `/brand-projects`                                                                                                                                                                   | brand + `brandProjects`                                                                                      |
| `/documents`                                                                                                                                                                        | brand + `documents`                                                                                          |
| `/resources`                                                                                                                                                                        | brand + `resources`                                                                                          |
| `/brand-guidelines`                                                                                                                                                                 | owner or `brandGuidelines`                                                                                   |
| `/agencies`                                                                                                                                                                         | owner or `staffManagement`                                                                                   |
| `/proposals`, `/create-proposal`, `/proposal/:id`, `/proposal/:id/edit`                                                                                                             | (agency or brand) + `proposals`                                                                              |
| `/staff`                                                                                                                                                                            | (agency or brand) + `staffManagement`                                                                        |
| `/contractor-dashboard`, `/contractor-agencies`, `/contractor-info`                                                                                                                 | `individualContractor`                                                                                       |
| `/contracts`                                                                                                                                                                        | contractor or `agencyStaff`                                                                                  |
| `/my-projects`                                                                                                                                                                      | contractor or `agencyStaff`                                                                                  |
| `/project/:id`                                                                                                                                                                      | agency, brand, or contractor                                                                                 |
| `/earnings`                                                                                                                                                                         | agency or contractor                                                                                         |
| `/invoices`, `/invoices/:id`                                                                                                                                                        | super-admin, agency, brand, or contractor                                                                    |
| `/payments`, `/subscriptions` (bare)                                                                                                                                                | brand + `payments` / `subscriptions` (owner bypass); bare also requires `brandOwner`                         |
| `/payments/:brandId`, `/subscriptions/:brandId`                                                                                                                                     | any agency                                                                                                   |
| `/checkout/:id`                                                                                                                                                                     | brand                                                                                                        |
| `/marketplace`, `/marketplace/*`                                                                                                                                                    | brand + `infin8`                                                                                             |
| Unknown shell route                                                                                                                                                                 | **deny → dashboard**                                                                                         |

### Dashboard landing per role (`dashboardFor`)

| Identity                              | Dashboard            |
| ------------------------------------- | -------------------- |
| super-admin (no role)                 | `/super-admin/users` |
| `agencyOwner`                         | `/agency-dashboard`  |
| `brandOwner`                          | `/brand-dashboard`   |
| `agencyStaff` / `brandStaff`          | `/tasks`             |
| `individualContractor`                | `/contractor-dashboard` |
| no role                               | `/role-selection`    |

---

## 11. Context switching (`auth.switchContext`)

A user with multiple identities switches the active context through the context
selector, backed by `auth.contextOptions` (the ordered, deduped list of admin / owned
agencies / staff agencies / owned brands / staff brands / contractor) and
`auth.switchContext` (`auth.ts:896-1173`). The new role is **derived server-side** from
the user's real membership (owner vs staff) — never trusted from the client — so a
switch cannot escalate privilege. Agency and brand selection are mutually exclusive;
`admin` and `contractor` only change the role.
