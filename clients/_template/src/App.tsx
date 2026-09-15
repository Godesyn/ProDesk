import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser, signOut } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useInviteRedemption } from '@shared/auth/use-invite-redemption';
import { PendingInvitePrompt } from '@shared/auth/pending-invite-prompt';
import { BetaProgram } from '@shared/beta/beta-program';
import { useSubdomainRedirect } from '@shared/auth/use-subdomain-redirect';
import { useActiveContext } from '@shared/hooks/use-active-context';
import { LoginPage } from '@shared/pages/login';
import { SignupPage } from '@shared/pages/signup';
import { VerifyEmailPage } from '@shared/pages/verify-email';
import { RoleSelectionPage } from '@shared/pages/role-selection';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  MigratedResetPage,
} from '@shared/pages/auth-reset';
import { AuthConfirmPage } from '@shared/pages/auth-confirm';
import { AuthHandoffPage } from '@shared/pages/auth-handoff';
import { ProfilePage } from '@shared/pages/profile';
import { Support } from './pages/Support';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { ContextSelector } from '@shared/components/layout/context-selector/context-selector';
import { AppShell } from '@shared/components/layout/app-side-panel';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { LayoutGrid, LifeBuoy, User } from 'lucide-react';

/**
 * Frontend template — auth + context scaffolding shared by every Prodesk frontend.
 *
 * This is the STARTING POINT for a new frontend. Copy this whole directory
 * (clients/_template) to clients/<your-frontend>/ and build from here. It already wires:
 * - Login / Signup / Forgot password / Reset password
 * - Email verification
 * - Auth confirmation (email deep links)
 * - Auth handoff (/auth/handoff): consumes a one-time sign-in token
 *   (?token_hash=…&next=/path) minted by another Prodesk frontend — used by
 *   the agency white-label subdomain redirect AND by cross-frontend navigation
 *   when this frontend is hosted on a different domain (cookies can't cross
 *   registrable domains). To link OUT to a sibling frontend, use
 *   useCrossAppOpen() from @shared/auth/use-cross-app — it attaches the token
 *   automatically when (and only when) the target can't see this session.
 * - Context selector (agency/brand switcher)
 * - Profile page
 * - Runtime accent theming via shared Providers (see main.tsx)
 *
 * Everything above comes from @shared and should be left as-is. To make this
 * your own frontend, replace <LandingPage /> with your authenticated routes.
 */

/**
 * Brand permissions that gate THIS frontend. A staff member sees a brand in the
 * context selector only when they hold at least one of these for it (owners
 * always qualify); when their access to the selected brand is revoked they fall
 * back to their first still-accessible brand, or to the create-brand empty state
 * when none remain.
 *
 * REPLACE with your tool's permission key(s) — e.g. `['links', 'linksViewer']`
 * for Links, `['signatures']` for a manage-only tool. It is then passed to
 * `useActiveContext`, `useEnsureBrandContext`, and `<ContextSelector>` (see
 * below) so hiding, re-selection, and persistence all agree. Leave `undefined`
 * ONLY for a multi-tool frontend that every brand teammate may use regardless of
 * per-tool permissions (like core Prodesk). See README "Team & permissions".
 */
const APP_BRAND_PERMISSIONS: string[] | undefined = undefined;

/** Redirect that preserves the query string. */
function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return (
    <Redirect to={search && !to.includes('?') ? to + search : to} replace />
  );
}

/*
 * NOT-FOUND RULE — every Prodesk frontend handles an unmatched route the same
 * way: send the visitor to this frontend's OWN root ("/"). No frontend renders
 * a 404 screen, and no frontend ships its own fallback component.
 *
 *   1. ONE implementation. Use the shared <UnknownRouteRedirect> imported above
 *      (@shared/components/unknown-route-redirect). Do NOT hand-roll a local
 *      copy or add a NotFound/404 page — that is how the apps drifted apart
 *      before. Changing the behaviour for everyone means editing that one file.
 *   2. LAST route of the Switch. A wouter <Route> with no `path` matches
 *      everything, so it must come after every real route (see the Switch at
 *      the bottom of this file). Mount it in EVERY Switch that a user-typed URL
 *      can reach — including public/unauthenticated ones — so no path can fall
 *      through and render a blank page.
 *   3. AUTOMATIC only. It fires when the router can't match a route, never from
 *      an intentional click. Don't wire buttons or links to it.
 *   4. HANDLE IT IN-APP instead. For an account/feature screen you don't own
 *      (profile, staff, invoices, …), mount the shared page here (see /profile
 *      below) and navigate to it in-app with wouter. The shared pages use the
 *      same auth + brand/agency context, so they just work — otherwise the URL
 *      silently bounces to the root.
 *
 * Auth gating is a DIFFERENT concern: the catch-alls in the unauthenticated and
 * role-less Switches below intentionally redirect to /login and /role-selection
 * (preserving the query string) rather than to the root. Leave those as they are.
 */

/** Post-login landing page — replace this with real content for your frontend. */
function LandingPage() {
  const { data: user } = useCurrentUser();
  // Filter the active context to brands this frontend can use (see
  // APP_BRAND_PERMISSIONS). Every useActiveContext() call in a frontend must pass
  // the SAME appPermissions so brandId/brands agree app-wide — real frontends wrap
  // this in a per-app hook (e.g. clients/links useLinksContext).
  const { activeAgency, activeBrand } = useActiveContext({
    appPermissions: APP_BRAND_PERMISSIONS,
  });

  const contextName =
    activeAgency?.businessName ?? activeBrand?.businessName ?? null;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-paper p-8">
      <div className="w-full max-w-md animate-reveal space-y-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent/10">
          <svg
            className="h-8 w-8 text-accent"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>

        <div>
          <h1 className="text-2xl font-semibold text-ink-100">
            Successfully logged in
          </h1>
          <p className="mt-2 text-sm text-ink-40">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}. This is a new
            frontend created from the template.
          </p>
        </div>

        <div className="rounded-lg border border-ink-4 bg-surface p-4 text-left text-xs text-ink-40 space-y-1">
          <p className="font-medium text-ink-60">Session info</p>
          <p>Email: {user?.email ?? '—'}</p>
          <p>Role: {user?.role ?? 'none'}</p>
          {contextName && <p>Context: {contextName}</p>}
        </div>

        {/* Context switching, Profile, Support, Sign out and the Prodesk Suite
            row are ALL provided by <Shell> below (the shared AppShell side
            panel) — don't rebuild them per page. */}
      </div>
    </div>
  );
}

/**
 * The authenticated shell — every Prodesk frontend wears the SAME side panel.
 *
 * `AppShell` (@shared/components/layout/app-side-panel) owns the layout, the width,
 * collapse-to-icons, the mobile drawer, the Prodesk Suite row at the top of the
 * panel, the Support/Billing tail and Sign out. You supply the nav, the logo, and
 * one of:
 *
 *   brand={{ brands, activeBrandId, onCreateBrand }}   brand-level (most tools).
 *                                                      Dropdown under the header;
 *                                                      always offers "New brand".
 *   contextSlot={…<ContextSelector/>}                   multi-role (see clients/jobs)
 *   identity={{ … }} and neither of the above           user-level (clients/design):
 *                                                      a plain Profile row above
 *                                                      the exit row instead.
 *
 * The template is generic (APP_BRAND_PERMISSIONS may be undefined), so it mounts the
 * ContextSelector. A brand-only frontend should pass `brand` instead — copy
 * clients/reviews or clients/websites.
 *
 * COLOURS: never style the panel from here. Add a `.psp-theme-<app>` block in your
 * index.css overriding the `--psp-*` variables and pass it as `panelClassName` (see
 * clients/links for a light rail, clients/reviews for a dark one). A dark rail also
 * passes `psp-ink` — the shared black-panel contract — and then only has to supply
 * --psp-bg and its accent.
 */
function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const confirm = useConfirm();

  const handleSignOut = async () => {
    if (
      await confirm({
        title: 'Sign out?',
        description: 'You’ll need to log in again to get back in.',
        confirmLabel: 'Sign out',
        destructive: true,
      })
    )
      void signOut();
  };

  const isActive = (href: string) =>
    href === '/' ? location === '/' : location.startsWith(href);

  return (
    <AppShell
      appKey="template"
      panelClassName="psp-theme-accent"
      logo={
        <span className="text-base font-semibold text-ink-100">Template</span>
      }
      groups={[
        {
          // Group your nav by category — the headings are part of the shared look.
          label: 'Workspace',
          items: [
            {
              key: 'home',
              label: 'Home',
              icon: <LayoutGrid className="h-[18px] w-[18px]" />,
              href: '/',
              active: isActive('/'),
            },
          ],
        },
      ]}
      // Support is MANDATORY on every frontend and pinned here, with Billing if
      // your tool has a billing screen.
      tail={[
        {
          key: 'support',
          label: 'Support',
          icon: <LifeBuoy className="h-[18px] w-[18px]" />,
          href: '/support',
          active: isActive('/support'),
        },
      ]}
      contextSlot={({ collapsed, expand, collapse }) => (
        <ContextSelector
          appPermissions={APP_BRAND_PERMISSIONS}
          collapsed={collapsed}
          onExpand={expand}
          onCollapse={collapse}
        />
      )}
      identity={{
        key: 'profile',
        label: 'Profile',
        icon: <User className="h-[18px] w-[18px]" />,
        href: '/profile',
        active: isActive('/profile'),
      }}
      onSignOut={() => void handleSignOut()}
    >
      {children}
    </AppShell>
  );
}

export function App() {
  const {
    isLoading,
    sessionLoading,
    isAuthenticated,
    data: user,
  } = useCurrentUser();
  const [location] = useLocation();

  // Shared auth hooks — run on every route
  useInviteRedemption();
  useAutoSelectContext();
  const redirecting = useSubdomainRedirect();

  // Auth deep-link routes — render regardless of auth state
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;

  // Wait for auth to resolve
  if (sessionLoading || (isAuthenticated && (isLoading || !user))) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-40">
        Loading…
      </div>
    );
  }

  if (redirecting) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-40">
        Taking you to your workspace…
      </div>
    );
  }

  // Not authenticated → show auth screens
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route>{() => <RedirectPreserve to="/login" />}</Route>
      </Switch>
    );
  }

  // Email verification gate
  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Role selection (if user has no role yet)
  if (!user?.role) {
    return (
      <OnboardingLayout>
        <Switch>
          <Route path="/role-selection" component={RoleSelectionPage} />
          <Route path="/profile">{() => <ProfilePage />}</Route>
          <Route>{() => <RedirectPreserve to="/role-selection" />}</Route>
        </Switch>
      </OnboardingLayout>
    );
  }

  // A screen this frontend doesn't own, handled IN-APP by mounting the shared
  // page (NOT by redirecting to the main app — see the redirect rule above).
  // Copy this block for other shared screens your frontend should host, e.g.
  // /staff (StaffPage) or /invoices (InvoicesPage) from @shared/pages.
  //
  // TEAM: staff are ONE team shared across every frontend. If your tool has its
  // own brand permission, add a SCOPED team panel (list all brand staff; grant/
  // revoke just your permission) instead of mounting the full StaffPage — model
  // it on clients/links SettingsTeam.tsx or clients/reviews Team.tsx. See the
  // README "Team & permissions" section and docs/permissions.md "Cross-frontend
  // team".
  if (location === '/profile') {
    return (
      <Shell>
        <ProfilePage />
      </Shell>
    );
  }

  // MANDATORY — every frontend MUST offer customer support from anywhere, and it
  // must be a NATIVE screen in your app's own look (not the shared SupportPage,
  // which is styled for the main Prodesk app and reads as a foreign screen inside
  // a bespoke skin). Build your own `src/pages/Support.tsx` on the shared DATA
  // layer — `@shared/pages/support/use-support` hooks + `@shared/pages/support/model`
  // (types/labels/upload) — and re-skin the markup with your components; the
  // backend (`trpc.support.*`) is shared and unchanged. The reference Support page
  // here uses the shared design tokens because the template has no kit of its own.
  // Like every real frontend, it renders INSIDE the app shell (side panel, with the
  // Support row in the tail highlighted) so it feels like just another screen. It
  // handles both the list (/support) and a thread (/support/:id). The Support entry
  // point also appears on the shared ProfilePage (mounted above).
  if (location === '/support' || location.startsWith('/support/')) {
    return (
      <Shell>
        <Support />
      </Shell>
    );
  }

  // Already signed in → auth screens have nothing to do. Without this, the URL
  // stays at /login after email/password sign-in (the shared LoginPage establishes
  // the session without navigating), falls through to UnknownRouteRedirect, and
  // bounces the user to the main app.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Authenticated → show landing page with context selector.
  // Replace this section with your frontend's authenticated routes. Keep
  // UnknownRouteRedirect LAST as the single catch-all — it's the only main-app
  // handoff (automatic, on unmatched routes only). Never link out to the main
  // app from a click; mount the shared page in-app like /profile above.
  return (
    <>
      <Shell>
        <Switch>
          <Route path="/" component={LandingPage} />
          <Route component={UnknownRouteRedirect} />
        </Switch>
      </Shell>
      {/* Surface any pending staff invitation the moment an existing user lands.
          No permission filter here — the template is generic, so it shows every
          invite. Real frontends pass relevantPermissions / relevantOrgType. */}
      <PendingInvitePrompt />
      {/* Beta programme — MANDATORY on every frontend (enforced by
          scripts/check-frontend-wiring.mjs). Renders the beta countdown, the
          post-beta price report, and the floating feedback tab; all three
          self-suppress for users who aren't beta members. */}
      <BetaProgram />
    </>
  );
}
