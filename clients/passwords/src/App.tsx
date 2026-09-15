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
import { StaffPage } from '@shared/pages/staff';
import { InvoicesPage } from '@shared/pages/invoices';
import { RoleSelectionPage } from '@shared/pages/role-selection';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { PASSWORDS_BRAND_PERMISSIONS } from './app/use-context';
import { LandingPage } from './app/LandingPage';
import { PasswordsApp } from './app/PasswordsApp';
import { PublicSend } from './pages/PublicSend';
import { PublicIntake } from './pages/PublicIntake';

/**
 * KEYMASTR — the Prodesk password vault (clients/passwords, port 5183).
 *
 * A USER-LEVEL frontend (like clients/design): the user sees every brand they
 * can reach and the keys inside each one, all at once. Brand scoping lives in
 * the content, not in a switcher — see DESIGN.md §4 for why.
 *
 * Two PUBLIC surfaces must render with no session at all, so they are matched
 * before every auth gate (the same shape clients/logo uses for its shared brand
 * guidelines):
 *
 *   /s/:token   a one-time Send — receive a secret without an account
 *   /i/:token   an Intake form  — supply credentials without an account
 *
 * Both are the app's viral surfaces: every send and every intake is a demo shown
 * to somebody who doesn't have Prodesk yet, so they get the full paper stage.
 */

/** Redirect that preserves the query string. */
function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return <Redirect to={search && !to.includes('?') ? to + search : to} replace />;
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
  const redirecting = useSubdomainRedirect();

  // PUBLIC recipient surfaces — before every auth gate. The key that decrypts a
  // Send rides in the URL fragment and never reaches the server (DESIGN.md §6).
  const send = location.match(/^\/s\/([A-Za-z0-9_-]{6,64})$/);
  if (send) return <PublicSend token={send[1]} />;
  const intake = location.match(/^\/i\/([A-Za-z0-9_-]{6,64})$/);
  if (intake) return <PublicIntake token={intake[1]} />;

  // Auth deep-link routes — render regardless of auth state.
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;

  if (sessionLoading || (isAuthenticated && (isLoading || !user))) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-40">Loading…</div>
    );
  }

  if (redirecting) {
    return (
      <div className="grid min-h-screen place-items-center text-ink-40">
        Taking you to your workspace…
      </div>
    );
  }

  // Signed-out visitors land on the marketing page, not the login form — an
  // unknown route falls back to it too (query preserved for campaign params).
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

  // A role-less user picks one first. KEYMASTR is user-level and serves agencies
  // and brands alike, so unlike the brand-only tools it does NOT skip this.
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

  // Account screens this frontend doesn't own are mounted IN-APP (never a handoff
  // to the main app). Support and /profile are NATIVE screens inside the shell
  // (pages/Support, pages/Account), so they fall through to PasswordsApp below.
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
  // here instead of bouncing out.
  if (location === '/brand-dashboard' || location === '/agency-dashboard') {
    return <Redirect to="/" replace />;
  }

  // The shared LoginPage establishes the session without navigating, so without
  // this the URL stays at /login, hits the catch-all and bounces to the main app.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Everything else is KEYMASTR. PasswordsApp owns its own routing AND the single
  // unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <PasswordsApp />
      {/* KEYMASTR owns the `passwords` / `passwordsViewer` staff permissions, so
          only surface invites this frontend can actually act on. */}
      <PendingInvitePrompt relevantPermissions={PASSWORDS_BRAND_PERMISSIONS} />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
