import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
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
import { SuiteApp } from './suite/SuiteApp';

/**
 * Dashboard frontend — auth + context template.
 *
 * This serves as the starting template for all new frontends. It includes:
 * - Login / Signup / Forgot password / Reset password
 * - Email verification
 * - Auth confirmation (email deep links)
 * - Auth handoff (subdomain cross-auth)
 * - Context selector (agency/brand switcher)
 * - Profile page
 * - A landing page shown after successful login
 *
 * To create a new frontend, copy this file and replace the <LandingPage />
 * with your own authenticated routes.
 */

/** Redirect that preserves the query string. */
function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return (
    <Redirect to={search && !to.includes('?') ? to + search : to} replace />
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

  // NOTE: This brand-only dashboard intentionally skips role selection. A role-less
  // user who already has a context is auto-switched by useAutoSelectContext; one with
  // no context at all falls through to the SuiteApp, which opens the "Add brand"
  // dialog (creating a brand sets the brandOwner role). Role selection lives in the
  // main Prodesk app for users who need it.

  // Profile renders in the onboarding (chromeless) layout. This is the brand-only
  // dashboard, so the personal payout panel is restricted to agency owners/staff.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage agencyOnlyPayout />
      </OnboardingLayout>
    );
  }
  // Support tickets render as a real suite view (topbar + sidebar) inside
  // SuiteApp — /support and /support/:id fall through to the Switch below.

  // Authenticated → show landing page with context selector
  // Replace this section with your frontend's authenticated routes.
  return (
    <>
      <Switch>
        {/* Already signed in → the auth screens have nothing to do here. */}
        <Route path="/login">{() => <Redirect to="/" replace />}</Route>
        <Route path="/signup">{() => <Redirect to="/" replace />}</Route>
        <Route component={SuiteApp} />
      </Switch>
      {/* Pop a pending staff invitation on landing. This is the brand-only
          suite, so only brand-staff invitations are relevant. */}
      <PendingInvitePrompt relevantOrgType="brand" />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
