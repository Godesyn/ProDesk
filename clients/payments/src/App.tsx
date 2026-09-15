import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useEnsureBrandContext } from '@shared/auth/use-ensure-brand-context';
import { PAYMENTS_BRAND_PERMISSIONS } from './lib/payments-trpc';
import { useInviteRedemption } from '@shared/auth/use-invite-redemption';
import { useSubdomainRedirect } from '@shared/auth/use-subdomain-redirect';
import { BetaProgram } from '@shared/beta/beta-program';
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
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import Onboarding from '@/pages/Onboarding';
import { PaymentsApp } from './PaymentsApp';

// Public (unauthenticated) surfaces — ported 1:1 from the export's Router.
import Home from '@/pages/Home';
import Terms from '@/pages/Terms';
import ProposalPublic from '@/pages/ProposalPublic';
import RecoveryPage from '@/pages/RecoveryPage';
import SurveyPage from '@/pages/SurveyPage';
import PayerPortal from '@/pages/PayerPortal';
import ClientPortal from '@/pages/ClientPortal';
import ClientPortalLogin from '@/pages/ClientPortalLogin';
import ClientPortalVerify from '@/pages/ClientPortalVerify';
import { AffiliateLanding, AffiliateSignup } from '@/pages/Affiliate';

/**
 * Payments (EziQuotes) frontend — proposals/quotes + Stripe Connect payments
 * tool migrated from the Manus "prodesk-payments" export. Built from
 * clients/_template, keeping the shared auth + context scaffolding; the
 * authenticated experience is PaymentsApp. See docs/agents/manus-migration.md.
 *
 * The payer-facing surfaces (public proposal /p/:slug, payer portal, client
 * portal, surveys, recovery, affiliate signup, marketing home) render WITHOUT
 * auth, before the auth gate — they're for the vendor's customers, who are not
 * platform users.
 */

function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return <Redirect to={search && !to.includes('?') ? to + search : to} replace />;
}

/** Public, unauthenticated surfaces — render regardless of session. */
const PUBLIC_RE = /^\/(p|portal|survey|recover|client-portal|terms)(\/|$)/;

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/p/:slug" component={ProposalPublic} />
      <Route path="/portal/:token" component={PayerPortal} />
      <Route path="/survey/:token" component={SurveyPage} />
      <Route path="/recover/:token" component={RecoveryPage} />
      <Route path="/client-portal/login" component={ClientPortalLogin} />
      <Route path="/client-portal/verify" component={ClientPortalVerify} />
      <Route path="/client-portal" component={ClientPortal} />
      <Route path="/affiliate/signup" component={AffiliateSignup} />
      <Route path="/affiliate" component={AffiliateLanding} />
      <Route path="/terms" component={Terms} />
      {/* A public-prefixed URL that matches no route above (e.g. a truncated
          /portal with no token) goes to the root rather than rendering blank. */}
      <Route component={UnknownRouteRedirect} />
    </Switch>
  );
}

export function App() {
  const { isLoading, sessionLoading, isAuthenticated, data: user } = useCurrentUser();
  const [location] = useLocation();

  useInviteRedemption();
  useAutoSelectContext();
  useEnsureBrandContext({ appPermissions: PAYMENTS_BRAND_PERMISSIONS });
  const redirecting = useSubdomainRedirect();

  // Payer-facing public surfaces — before any auth gate. /affiliate and
  // /affiliate/signup are public; /affiliate/dashboard belongs to the app.
  if (
    PUBLIC_RE.test(location) ||
    location === '/affiliate' ||
    location === '/affiliate/signup'
  ) {
    return <PublicRoutes />;
  }

  // Auth deep-link routes — render regardless of auth state.
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;

  // Marketing home at "/" for visitors (the export served it to everyone; an
  // authenticated user is taken straight into their workspace instead).
  if (location === '/' && !sessionLoading && !isAuthenticated) {
    return <Home />;
  }

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
        <Route path="/login" component={LoginPage} />
        <Route path="/signup" component={SignupPage} />
        <Route>{() => <RedirectPreserve to="/login" />}</Route>
      </Switch>
    );
  }

  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  // Brand-only frontend: a role-less user goes straight into the Onboarding
  // wizard, whose first step names the business (creating the brand) before the
  // rest of setup. ProfilePage still needs the shared OnboardingLayout.
  if (!user?.role) {
    if (location === '/profile') {
      return (
        <OnboardingLayout>
          <ProfilePage />
        </OnboardingLayout>
      );
    }
    return <Onboarding />;
  }

  // Account screens this frontend doesn't own are mounted IN-APP (never a
  // main-app redirect): profile is user-scoped; staff + invoices are
  // brand-scoped. Staff replaces the export's Team tab (Manus team_members).
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

  // Already signed in → the auth screens have nothing to do here (see the
  // reviews client for the full rationale).
  if (location === '/login' || location === '/signup') {
    return <Redirect to="/dashboard" replace />;
  }

  // Shared flows may navigate to a role home the MAIN app owns — keep them here.
  if (
    location === '/brand-dashboard' ||
    location === '/role-selection' ||
    location === '/agency-dashboard'
  ) {
    return <Redirect to="/dashboard" replace />;
  }

  // Authenticated "/" → the workspace dashboard.
  if (location === '/') {
    return <Redirect to="/dashboard" replace />;
  }

  return (
    <>
      <PaymentsApp />
      {/* Beta programme — MANDATORY on every frontend (enforced by
          scripts/check-frontend-wiring.mjs). Renders the beta countdown, the
          post-beta price report, and the floating feedback tab; all three
          self-suppress for users who aren't beta members. */}
      <BetaProgram />
    </>
  );
}
