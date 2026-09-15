import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useEnsureBrandContext } from '@shared/auth/use-ensure-brand-context';
import { REVIEWS_BRAND_PERMISSIONS } from './app/use-context';
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
import { useReviewsRealtime } from './app/realtime';
import { LandingPage } from './app/LandingPage';
import { CreateBrandOnboarding } from './app/CreateBrandOnboarding';
import { ConfirmProvider } from './app/confirm';
import { ReviewsApp } from './app/ReviewsApp';
import { ReviewFlowPage } from './app/public/ReviewFlow';
import { DirectoryPage } from './app/public/Directory';
import { IndustryLeaderboardPage } from './app/public/IndustryLeaderboard';
import { BusinessProfilePage } from './app/public/BusinessProfile';

/**
 * Reviews (Verdiict) frontend — review-capture tool migrated from the Manus
 * "review-request-tool" export. Built from clients/_template, keeping the shared
 * auth + context scaffolding; the authenticated experience is ReviewsApp. See
 * docs/agents/manus-migration.md. The public review-capture page (/r/:slug) and
 * the public directory render WITHOUT auth (top of this component), before the
 * auth gate — they're the visitor-facing surfaces.
 */

function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return <Redirect to={search && !to.includes('?') ? to + search : to} replace />;
}

/** Public, unauthenticated surfaces — render regardless of session. */
const PUBLIC_RE = /^\/(r|directory)(\/|$)/;

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/r/:slug" component={ReviewFlowPage} />
      <Route path="/directory" component={DirectoryPage} />
      <Route path="/directory/industry/:industry" component={IndustryLeaderboardPage} />
      <Route path="/directory/:slug/:location" component={BusinessProfilePage} />
      <Route path="/directory/:slug" component={BusinessProfilePage} />
      {/* A public-prefixed URL that matches no route above (e.g. a bare /r) goes
          to the root rather than rendering blank. */}
      <Route component={UnknownRouteRedirect} />
    </Switch>
  );
}

export function App() {
  const { isLoading, sessionLoading, isAuthenticated, data: user } = useCurrentUser();
  const [location] = useLocation();

  useInviteRedemption();
  useAutoSelectContext();
  useEnsureBrandContext({ appPermissions: REVIEWS_BRAND_PERMISSIONS });
  useReviewsRealtime();
  const redirecting = useSubdomainRedirect();

  // Public visitor surfaces (review capture + directory) — before any auth gate.
  if (PUBLIC_RE.test(location)) return <PublicRoutes />;

  // Auth deep-link routes — render regardless of auth state.
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;

  if (sessionLoading || (isAuthenticated && (isLoading || !user))) {
    return <div className="grid min-h-screen place-items-center text-ink-40">Loading…</div>;
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
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route>{() => <RedirectPreserve to="/" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Brand-only frontend: skip role selection. A role-less user goes through the
  // two-step onboarding (business name → industry). CreateBrandOnboarding renders
  // its own full-page layout; ProfilePage still needs the shared OnboardingLayout.
  if (!user?.role) {
    if (location === '/profile') {
      return (
        <OnboardingLayout>
          <ProfilePage />
        </OnboardingLayout>
      );
    }
    return (
      <ConfirmProvider>
        <CreateBrandOnboarding />
      </ConfirmProvider>
    );
  }

  // Profile is user-scoped and this frontend doesn't own it, so it's mounted
  // in-app under the shared OnboardingLayout (never a main-app redirect). Team +
  // Invoices are brand-scoped and have native Verdiict screens inside ReviewsApp.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }
  // Already signed in → the auth screens have nothing to do here. Without this,
  // a role-holding user who just logged in stays on /login (the LoginPage only
  // establishes the session; useAutoSelectContext navigates for role-LESS users
  // only), falls through to ReviewsApp, whose Switch treats /login as unknown
  // and hands off to the main app.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Shared flows may navigate to a role home the MAIN app owns — keep them here.
  if (
    location === '/brand-dashboard' ||
    location === '/role-selection' ||
    location === '/agency-dashboard'
  ) {
    return <Redirect to="/" replace />;
  }

  // Everything else is the reviews workspace. ReviewsApp owns its routing AND the
  // single unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <ReviewsApp />
      {/* Pop a pending staff invitation on landing — only when it grants the
          reviews viewer/editor permissions this frontend uses. */}
      <PendingInvitePrompt relevantPermissions={REVIEWS_BRAND_PERMISSIONS} />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
