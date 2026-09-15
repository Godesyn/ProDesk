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
import { LOGO_BRAND_PERMISSIONS } from './app/use-context';
import { CreateBrandOnboarding } from './app/CreateBrandOnboarding';
import { LandingPage } from './app/LandingPage';
import { LogoApp } from './app/LogoApp';
import { shareTokenFromPath } from '@server/modules/logo/share-link';
import { PublicGuidelines } from './pages/PublicGuidelines';

/**
 * Logo frontend — a BRAND-ONLY app (like Links/Reviews): it always operates
 * inside a brand context. Built from clients/_template; the shared auth/context
 * scaffolding is untouched and the authenticated experience is ./app/LogoApp.
 *
 * The one public surface is the shared brand-guidelines page, which must render
 * with no session at all — it is matched before any auth gate. It answers on
 * `/share/:brand/:version` (the readable link) and on the legacy `/g/:token`.
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
  useEnsureBrandContext({ appPermissions: LOGO_BRAND_PERMISSIONS });
  const redirecting = useSubdomainRedirect();

  // PUBLIC brand guidelines — a shared rulebook must render for people who have
  // no Prodesk account, so it precedes every auth gate below.
  //
  // `/share/acme-coffee/v2` is the link we mint now; `shareTokenFromPath` rebuilds
  // the stored token from the two segments (and vets them), so the route and the
  // minter can't drift. The old `/g/<32 hex>` form stays because those links are
  // already in circulation.
  const sharedLink = location.match(/^\/share\/([^/]+)\/([^/]+)$/);
  if (sharedLink) {
    const token = shareTokenFromPath(sharedLink[1], sharedLink[2]);
    if (token) return <PublicGuidelines token={token} />;
  }
  const legacyLink = location.match(/^\/g\/([A-Za-z0-9_-]{8,64})$/);
  if (legacyLink) return <PublicGuidelines token={legacyLink[1]} />;

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

  // Brand-only frontend: skip role selection. A role-less user just names their
  // brand — creating it sets the brandOwner role + active brand, then App drops
  // them into the Logo workspace.
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
  // to the main app). Support and `/profile` are NATIVE screens inside the LogoApp
  // shell (pages/Support, pages/Account), so they fall through to LogoApp's Switch
  // below — the shared ProfilePage is only used before a brand exists (above).
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

  // Everything else is the Logo app. LogoApp owns its own routing AND the single
  // unknown-route → main-app handoff (with loop guard).
  return (
    <>
      <LogoApp />
      {/* Logo owns the `logo` staff permission (migration 0074), so only surface
          invites this frontend can actually act on — and brand invites only, since
          Logo is a brand-only app. */}
      <PendingInvitePrompt
        relevantPermissions={LOGO_BRAND_PERMISSIONS}
        relevantOrgType="brand"
      />
      {/* Beta programme — countdown, post-beta price report, feedback tab. */}
      <BetaProgram />
    </>
  );
}
