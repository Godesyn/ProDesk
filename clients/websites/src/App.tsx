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
import { StaffPage } from '@shared/pages/staff';
import { InvoicesPage } from '@shared/pages/invoices';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { WEBSITES_BRAND_PERMISSIONS } from './app/use-context';
import { CreateBrandOnboarding } from './app/CreateBrandOnboarding';
import { WebsitesApp } from './app/WebsitesApp';

/**
 * Websites frontend — a BRAND-ONLY app (like Links/Reviews): it always operates
 * inside a brand context. Built from clients/_template; the shared auth/context
 * scaffolding is untouched and the authenticated experience is ./app/WebsitesApp.
 *
 * Scaffold status: a working shell (brand switcher + placeholder Home + native
 * Support) on existing shared procedures — no backend of its own yet.
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
  useEnsureBrandContext({ appPermissions: WEBSITES_BRAND_PERMISSIONS });
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

  // Brand-only frontend: skip role selection. A role-less user just names their
  // brand — creating it sets the brandOwner role + active brand, then App drops
  // them into the Websites workspace.
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

  // Account screens this frontend doesn't own are mounted IN-APP (never a handoff
  // to the main app). Support is a NATIVE screen inside the WebsitesApp shell, so
  // it falls through to WebsitesApp's Switch below.
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }
  if (location === '/staff') {
    return (
      <OnboardingLayout>
        <StaffPage />
      </OnboardingLayout>
    );
  }
  if (location === '/invoices') {
    return (
      <OnboardingLayout>
        <InvoicesPage />
      </OnboardingLayout>
    );
  }

  // Shared flows may navigate to a role "home" the MAIN app owns; keep the user
  // here instead of bouncing out right after creating their brand.
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

  // Everything else is the Websites app. WebsitesApp owns its own routing AND the
  // single unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <WebsitesApp />
      {/* No permission filter yet — Websites has no dedicated staff permission,
          so surface every pending invite (like the template). Pass
          WEBSITES_BRAND_PERMISSIONS here once the tool has its own permission. */}
      <PendingInvitePrompt />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
