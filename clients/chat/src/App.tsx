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
import { ChatApp } from './app/ChatApp';

/**
 * CHAT — the Prodesk messenger (clients/chat, port 5184, chat.prodesk.com).
 *
 * A USER-LEVEL frontend, like clients/passwords and clients/design: no brand
 * dropdown, a plain Profile row above the exit row. There is nothing brand-shaped
 * about a conversation between two people, and a switcher would only ask a
 * question the product never needs answered.
 *
 * It is also DELIBERATELY UNGATED. Every other satellite is reached through a
 * staff permission, because every other satellite is a tool an agency buys. This
 * is the messenger: any Prodesk account can open it, find anyone by email, and
 * talk to them. Gating a messenger on a permission would be gating the telephone.
 *
 * Unlike KEYMASTR and Logo Studio there are NO public surfaces here — a private
 * message has no shareable face — so the auth gate is the first thing that runs
 * after the auth deep links.
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

  // Signed out. There is no marketing surface for a private messenger, so `/` is
  // the login form itself rather than a landing page — and an unknown route falls
  // back to it with the query preserved (a `?next=` deep link survives sign-in).
  if (!isAuthenticated) {
    return (
      <Switch>
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route path="/" component={LoginPage} />
        <Route>{() => <RedirectPreserve to="/" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // A role-less user picks one first. Chat itself needs no role, but the shared
  // account screens below (staff, invoices, profile) all read one, and a user
  // without a role is mid-signup rather than someone who chose to skip it.
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
  // (pages/Support, pages/Account), so they fall through to ChatApp below.
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

  // Everything else is Chat. ChatApp owns its own routing AND the single
  // unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <ChatApp />
      {/* Chat owns no staff permission of its own, so surface every pending
          invite — an invite is the most likely reason a stranger just messaged
          you, and burying it here would be the wrong place to be quiet. */}
      <PendingInvitePrompt />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
