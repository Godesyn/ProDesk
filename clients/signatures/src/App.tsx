import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useEnsureBrandContext } from '@shared/auth/use-ensure-brand-context';
import { SIGNATURES_BRAND_PERMISSIONS } from './app/context';
import { useInviteRedemption } from '@shared/auth/use-invite-redemption';
import { PendingInvitePrompt } from '@shared/auth/pending-invite-prompt';
import { BetaProgram } from '@shared/beta/beta-program';
import { useSubdomainRedirect } from '@shared/auth/use-subdomain-redirect';
import { LoginPage } from '@shared/pages/login';
import { SignupPage } from '@shared/pages/signup';
import { VerifyEmailPage } from '@shared/pages/verify-email';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  MigratedResetPage,
} from '@shared/pages/auth-reset';
import { AuthConfirmPage } from '@shared/pages/auth-confirm';
import { AuthHandoffPage } from '@shared/pages/auth-handoff';
import { ProfilePage } from '@shared/pages/profile';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { SignaturesTrpcProvider } from './lib/trpc';
import { SignaturesApp } from './SignaturesApp';
import { CreateBrandOnboarding } from './pages/CreateBrandOnboarding';
import BrandSharePage from './pages/BrandShare';
import LandingPage from './pages/Landing';

/**
 * Signatures (SIGKITT) frontend — email-signature builder migrated from the
 * Manus "email-signature-builder" export. Built from clients/_template, keeping
 * the shared auth + context scaffolding; the authenticated experience is
 * SignaturesApp. See docs/agents/manus-migration.md. The public hosted-signature
 * share page (/team/:slug, and the legacy /share/:id) renders WITHOUT auth (top
 * of this component), before the auth gate — it's the visitor-facing surface
 * embedded in real inboxes.
 */

/** Redirect that preserves the query string. */
function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return <Redirect to={search && !to.includes('?') ? to + search : to} replace />;
}

/**
 * Public, unauthenticated surface — the hosted signature directory for a brand.
 * `/team/:slug` is the current pretty share link (resolves by brand-kit name);
 * `/share/:brandId` is the legacy id-based link, kept so URLs already embedded in
 * real inboxes keep working. Both require a segment after the prefix — bare
 * `/team` stays the AUTHENTICATED team-management screen (owned by SignaturesApp).
 */
const PUBLIC_RE = /^\/(share|team)\/[^/]+/;

function PublicRoutes() {
  return (
    <div className="sigkitt">
      <SignaturesTrpcProvider>
        <Switch>
          {/* Two segments = one specific department; one = the brand's current
              default. The nested route must come FIRST — wouter matches in
              order, and `/team/:slug` would otherwise swallow `/team/a/b`. */}
          <Route
            path="/team/:slug/:department"
            component={BrandSharePage}
          />
          <Route path="/team/:slug" component={BrandSharePage} />
          <Route path="/share/:brandId" component={BrandSharePage} />
          {/* A public-prefixed URL that matches no route above (e.g. an extra
              path segment) goes to the root rather than rendering blank. */}
          <Route component={UnknownRouteRedirect} />
        </Switch>
      </SignaturesTrpcProvider>
    </div>
  );
}

export function App() {
  const { isLoading, sessionLoading, isAuthenticated, data: user } =
    useCurrentUser();
  const [location] = useLocation();

  useInviteRedemption();
  useAutoSelectContext();
  useEnsureBrandContext({ appPermissions: SIGNATURES_BRAND_PERMISSIONS });
  const redirecting = useSubdomainRedirect();

  // Public visitor surface (hosted signature share) — before any auth gate.
  if (PUBLIC_RE.test(location)) return <PublicRoutes />;

  // Auth deep-link routes — render regardless of auth state.
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;

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

  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        {/* Public marketing landing at the root (mirrors clients/links) — signed-out
            visitors land here instead of being bounced straight to /login. */}
        <Route path="/" component={LandingPage} />
        <Route>{() => <RedirectPreserve to="/" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Brand-only frontend: skip role selection. A role-less user goes straight to
  // the create-brand onboarding, which calls brands.create — that sets the
  // brandOwner role + active brand at the user level, so there's nothing to pick.
  // CreateBrandOnboarding renders its own full-page layout; ProfilePage still
  // needs the shared OnboardingLayout.
  if (!user?.role) {
    if (location === '/profile') {
      return (
        <OnboardingLayout>
          <ProfilePage />
        </OnboardingLayout>
      );
    }
    return <CreateBrandOnboarding />;
  }

  // Shared screens this frontend doesn't own but mounts IN-APP (never a main-app
  // redirect). Profile is user-scoped. Support has a NATIVE SIGKITT screen mounted
  // inside SignaturesApp's DashboardLayout (see ./pages/Support), not here.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }

  // Already signed in → the auth screens have nothing to do here.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Shared role-home paths the MAIN app owns — bounce back to our home.
  if (
    location === '/brand-dashboard' ||
    location === '/role-selection' ||
    location === '/agency-dashboard'
  ) {
    return <Redirect to="/" replace />;
  }

  // Everything else is the signatures workspace. SignaturesApp owns its routing
  // AND the single unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <SignaturesApp />
      {/* Pop a pending staff invitation on landing — only when it grants the
          signatures permission this frontend uses (manage-only; no viewer role). */}
      <PendingInvitePrompt relevantPermissions={SIGNATURES_BRAND_PERMISSIONS} />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
