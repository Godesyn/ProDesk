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
import { RoleSelectionPage } from '@shared/pages/role-selection';
import {
  ForgotPasswordPage,
  ResetPasswordPage,
  MigratedResetPage,
} from '@shared/pages/auth-reset';
import { AuthConfirmPage } from '@shared/pages/auth-confirm';
import { AuthHandoffPage } from '@shared/pages/auth-handoff';
import { ProfilePage } from '@shared/pages/profile';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { JobsApp } from './app/JobsApp';

/**
 * Jobs frontend — a MULTI-ROLE app (like the main Prodesk app): any identity
 * (agency, brand, contractor, admin) can use it, so it mounts the shared
 * ContextSelector and does NOT filter the context by a tool permission. Built
 * from clients/_template; the shared auth/context scaffolding is untouched and
 * the authenticated experience is ./app/JobsApp.
 *
 * Scaffold status: this is a working shell (sidebar + placeholder Home + native
 * Support) on existing shared procedures — it has no backend of its own yet.
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

  // Shared auth hooks — run on every route. Multi-role: no appPermissions filter.
  useInviteRedemption();
  useAutoSelectContext();
  const redirecting = useSubdomainRedirect();

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
        <Route>{() => <RedirectPreserve to="/login" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Multi-role: a role-less user picks a role first (like the main app).
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

  // Profile is a shared account screen mounted IN-APP (never a handoff to the
  // main app). Support is a NATIVE screen rendered inside the JobsApp shell, so
  // it falls through to JobsApp's own Switch below.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }

  // Shared auth/onboarding flows may navigate to a role "home" the MAIN app owns
  // (dashboardFor → /brand-dashboard, /agency-dashboard) or /role-selection. This
  // satellite doesn't host those; keep the user here instead of bouncing out.
  if (
    location === '/brand-dashboard' ||
    location === '/agency-dashboard' ||
    location === '/role-selection'
  ) {
    return <Redirect to="/" replace />;
  }

  // Already signed in → auth screens have nothing to do.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Everything else is the Jobs app. JobsApp owns its own routing AND the single
  // unknown-route → main-app handoff (with loop guard) — the ONLY place this
  // frontend sends a user to the main app, and only on an unrecognised route.
  return (
    <>
      <JobsApp />
      <PendingInvitePrompt />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
