import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useEnsureBrandContext } from '@shared/auth/use-ensure-brand-context';
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
import { CreateBrandOnboarding } from './app/CreateBrandOnboarding';
import { DesignApp } from './app/DesignApp';

/**
 * Design frontend — a USER-LEVEL app (like Signatures): it runs inside a brand
 * context for tenancy, but the experience is user-centric and fans across ALL of
 * the user's accessible brands rather than pinning one. Built from
 * clients/_template; the shared auth/context scaffolding is untouched and the
 * authenticated experience is ./app/DesignApp.
 *
 * Scaffold status: a working shell (placeholder Home + native Support) on
 * existing shared procedures — no backend of its own yet.
 */

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

  useInviteRedemption();
  useAutoSelectContext();
  // Adopt a brand context (like Signatures) so brand-scoped queries resolve; the
  // UI then fans across every accessible brand. No appPermissions — user-level.
  useEnsureBrandContext();
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

  // Like Signatures: a role-less user just names their first brand (no role
  // selection), then App drops them into the Design workspace.
  if (!user?.role) {
    return (
      <OnboardingLayout>
        <Switch>
          <Route path="/profile">{() => <ProfilePage />}</Route>
          <Route>{() => <CreateBrandOnboarding />}</Route>
        </Switch>
      </OnboardingLayout>
    );
  }

  // Profile is a shared account screen mounted IN-APP (never a handoff to the
  // main app). Support is a NATIVE screen inside the DesignApp shell, so it falls
  // through to DesignApp's Switch below.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }

  // Shared flows may navigate to a role "home" the MAIN app owns; keep the user
  // here instead of bouncing out.
  if (
    location === '/brand-dashboard' ||
    location === '/agency-dashboard' ||
    location === '/role-selection'
  ) {
    return <Redirect to="/" replace />;
  }

  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Everything else is the Design app. DesignApp owns its own routing AND the
  // single unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <DesignApp />
      <PendingInvitePrompt />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
