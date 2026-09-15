import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useEnsureBrandContext } from '@shared/auth/use-ensure-brand-context';
import { LINKS_BRAND_PERMISSIONS } from './app/use-context';
import { useInviteRedemption } from '@shared/auth/use-invite-redemption';
import { PendingInvitePrompt } from '@shared/auth/pending-invite-prompt';
import { BetaProgram } from '@shared/beta/beta-program';
import { useSubdomainRedirect } from '@shared/auth/use-subdomain-redirect';
import { LoginPage } from '@shared/pages/login';
import { SignupPage } from '@shared/pages/signup';
import { VerifyEmailPage } from '@shared/pages/verify-email';
import { CreateBrandOnboarding } from './app/CreateBrandOnboarding';
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
import { useLinksRealtime } from './app/realtime';
import { LinksApp } from './app/LinksApp';
import { LandingPage } from '@shared/pages/landing';

/**
 * Adeyy (short-link tool) frontend. Built from clients/_template, keeping the
 * shared auth + context scaffolding untouched; the authenticated experience is
 * the ported link-shortener app (see ./app/LinksApp). See
 * docs/agents/manus-migration.md.
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
  useEnsureBrandContext({ appPermissions: LINKS_BRAND_PERMISSIONS });
  useLinksRealtime();
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
        {/* Children form, not `component=`: the shared page takes optional
            props, which wouter's own RouteComponentProps don't satisfy. */}
        <Route path="/">{() => <LandingPage />}</Route>
        <Route>{() => <RedirectPreserve to="/" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Brand-only frontend: skip role selection. A freshly signed-up, role-less user
  // just names their brand — creating it sets the brandOwner role + active brand,
  // then App drops them into the links workspace. (Staff invited to a brand are
  // routed by useInviteRedemption before they ever reach here.)
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

  // Account screens this frontend doesn't own are handled IN-APP by mounting the
  // shared pages (same brand/user context) — never by navigating out to the main
  // app. Profile is user-scoped; Staff + Invoices are brand-scoped (Links always
  // runs inside a brand context).
  if (location === '/profile') {
    return (
      <OnboardingLayout>
        <ProfilePage />
      </OnboardingLayout>
    );
  }
  // Support tickets are a NATIVE Adeyy screen now (clients/links/src/app/pages/
  // Support.tsx), rendered inside the app shell — so `/support` falls through to
  // LinksApp's Switch below rather than mounting the shared page here.
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

  // Shared auth/onboarding flows may navigate to a role's "home" path that the
  // MAIN app owns (dashboardFor → /brand-dashboard, or /role-selection). This
  // brand-only frontend doesn't host those, and letting them fall through to
  // LinksApp's unknown-route handoff would bounce a brand owner out to the main
  // app right after creating their brand. Keep them here instead.
  if (
    location === '/brand-dashboard' ||
    location === '/role-selection' ||
    location === '/agency-dashboard'
  ) {
    return <Redirect to="/" replace />;
  }

  // Already signed in → the auth screens have nothing to do here. Without this,
  // a role-holding user who just logged in stays on /login (the LoginPage only
  // establishes the session; useAutoSelectContext navigates for role-LESS users
  // only), falls through to LinksApp, whose Switch treats /login as unknown and
  // hands off to the main app — bouncing brand owners to /brand-dashboard.
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/" replace />;
  }

  // Everything else is the short-link app. LinksApp owns its own routing AND the
  // single unknown-route → main-app redirect (with loop guard). That handoff is
  // the ONLY place this frontend sends a user to the main app, and it fires only
  // automatically on an unrecognised route — never from an intentional click.
  return (
    <>
      <LinksApp />
      {/* Pop a pending staff invitation on landing — only when it grants access
          this frontend actually uses (the links viewer/editor permissions). */}
      <PendingInvitePrompt relevantPermissions={LINKS_BRAND_PERMISSIONS} />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
