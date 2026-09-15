import { lazy, type ComponentType } from 'react';
import { Route, Switch, Redirect, useLocation } from 'wouter';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useInviteRedemption } from '@shared/auth/use-invite-redemption';
import { useAutoSelectContext } from '@shared/auth/use-auto-select-context';
import { useSubdomainRedirect } from '@shared/auth/use-subdomain-redirect';
import { useActiveContext } from '@shared/hooks/use-active-context';
import { canAccess, dashboardFor, type AccessIdentity } from '@shared/auth/route-access';
import type { StaffPermission, UserRole } from '@shared/components/layout/sidebar';
import { MainLayout } from '@shared/components/layout/main-layout';
import { OnboardingLayout } from '@shared/components/layout/onboarding-layout';
import { AuthLoadingScreen } from '@shared/components/auth-loading-screen';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { BetaProgram } from '@shared/beta/beta-program';
// Route pages are code-split (React.lazy) so the initial bundle ships only the
// shell; each page chunk loads on first navigation. Suspense boundaries live in
// MainLayout/OnboardingLayout (in-app routes keep the shell) and at the root in
// main.tsx (standalone auth/public screens). Named exports → default-shape adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lz = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  lazy(() => loader().then((m) => ({ default: m[name] as ComponentType<any> })));

const LoginPage = lz(() => import('@shared/pages/login'), 'LoginPage');
const SignupPage = lz(() => import('@shared/pages/signup'), 'SignupPage');
const VerifyEmailPage = lz(() => import('@shared/pages/verify-email'), 'VerifyEmailPage');
const RoleSelectionPage = lz(() => import('@shared/pages/role-selection'), 'RoleSelectionPage');
const ForgotPasswordPage = lz(() => import('@shared/pages/auth-reset'), 'ForgotPasswordPage');
const ResetPasswordPage = lz(() => import('@shared/pages/auth-reset'), 'ResetPasswordPage');
const MigratedResetPage = lz(() => import('@shared/pages/auth-reset'), 'MigratedResetPage');
const AuthConfirmPage = lz(() => import('@shared/pages/auth-confirm'), 'AuthConfirmPage');
const DashboardPage = lz(() => import('@shared/pages/dashboard'), 'DashboardPage');
const CatalogPage = lz(() => import('@shared/pages/catalog'), 'CatalogPage');
const ClientsPage = lz(() => import('@shared/pages/clients'), 'ClientsPage');
const StaffPage = lz(() => import('@shared/pages/staff'), 'StaffPage');
const ProposalsPage = lz(() => import('@shared/pages/proposals'), 'ProposalsPage');
const ProposalDetailPage = lz(() => import('@shared/pages/proposal-detail'), 'ProposalDetailPage');
const ProjectsBoardPage = lz(() => import('@shared/pages/projects-board'), 'ProjectsBoardPage');
const MarketplacePage = lz(() => import('@shared/pages/marketplace'), 'MarketplacePage');
const TasksPage = lz(() => import('@shared/pages/tasks'), 'TasksPage');
const EarningsPage = lz(() => import('@shared/pages/earnings'), 'EarningsPage');
const InvoicesPage = lz(() => import('@shared/pages/invoices'), 'InvoicesPage');
const ChatPage = lz(() => import('@shared/pages/chat'), 'ChatPage');
const ProfilePage = lz(() => import('@shared/pages/profile'), 'ProfilePage');
const SupportPage = lz(() => import('@shared/pages/support/support'), 'SupportPage');
const CheckoutPage = lz(() => import('@shared/pages/checkout'), 'CheckoutPage');
const PaymentResultPage = lz(() => import('@shared/pages/checkout'), 'PaymentResultPage');
const TicketsAdminPage = lz(() => import('@shared/pages/super-admin/tickets'), 'TicketsAdminPage');
const AdminUsersPage = lz(() => import('@shared/pages/super-admin'), 'AdminUsersPage');
const AdminAgenciesPage = lz(() => import('@shared/pages/super-admin'), 'AdminAgenciesPage');
const AdminBrandsPage = lz(() => import('@shared/pages/super-admin'), 'AdminBrandsPage');
const GlobalSettingsPage = lz(() => import('@shared/pages/super-admin'), 'GlobalSettingsPage');
const DisciplinesPage = lz(() => import('@shared/pages/super-admin'), 'DisciplinesPage');
const ResourcesManagementPage = lz(() => import('@shared/pages/super-admin'), 'ResourcesManagementPage');
const AdminPayoutsPage = lz(() => import('@shared/pages/super-admin'), 'AdminPayoutsPage');
const AdminInvoicesPage = lz(() => import('@shared/pages/super-admin'), 'AdminInvoicesPage');
const AiSpendByBrandPage = lz(() => import('@shared/pages/super-admin'), 'AiSpendByBrandPage');
const AiModelsPage = lz(() => import('@shared/pages/super-admin/ai-models'), 'AiModelsPage');
const BrandAgenciesPage = lz(() => import('@shared/pages/agencies'), 'BrandAgenciesPage');
const AgencyContractorsPage = lz(() => import('@shared/pages/agency-contractors'), 'AgencyContractorsPage');
const ContractorContractsPage = lz(() => import('@shared/pages/contractor'), 'ContractorContractsPage');
const ContractorAgenciesPage = lz(() => import('@shared/pages/contractor'), 'ContractorAgenciesPage');
const ProposalBuilderPage = lz(() => import('@shared/pages/proposals/builder'), 'ProposalBuilderPage');
const ProjectDetailPage = lz(() => import('@shared/pages/projects/project-detail'), 'ProjectDetailPage');
const ContractorProjectsPage = lz(() => import('@shared/pages/contractor/projects'), 'ContractorProjectsPage');
const InvoiceDetailPage = lz(() => import('@shared/pages/invoices/invoice-detail'), 'InvoiceDetailPage');
const CreateAgencyPage = lz(() => import('@shared/pages/agency/create-agency'), 'CreateAgencyPage');
const EditAgencyPage = lz(() => import('@shared/pages/agency/edit-agency'), 'EditAgencyPage');
const WorkflowSettingsPage = lz(() => import('@shared/pages/agency/workflow-settings'), 'WorkflowSettingsPage');
const AgencyBankAccountPage = lz(() => import('@shared/pages/agency/agency-bank-account'), 'AgencyBankAccountPage');
const AgencySubscriptionsPage = lz(() => import('@shared/pages/agency/agency-subscriptions'), 'AgencySubscriptionsPage');
const AgencyAffiliatePage = lz(() => import('@shared/pages/agency/agency-affiliate'), 'AgencyAffiliatePage');
const ManageResourcesPage = lz(() => import('@shared/pages/agency/manage-resources'), 'ManageResourcesPage');
const InfoHubSetupPage = lz(() => import('@shared/pages/agency/info-hub-setup'), 'InfoHubSetupPage');
const GlobalInfoHubTemplatesPage = lz(() => import('@shared/pages/super-admin/info-hub-templates'), 'GlobalInfoHubTemplatesPage');
const PushNotificationsPage = lz(() => import('@shared/pages/super-admin/push-notifications'), 'PushNotificationsPage');
const ClientDetailPage = lz(() => import('@shared/pages/agency/client-detail'), 'ClientDetailPage');
const MarketplaceCheckoutPage = lz(() => import('@shared/pages/marketplace/checkout-page'), 'MarketplaceCheckoutPage');
const AgencyStorefrontPage = lz(() => import('@shared/pages/marketplace/agency-storefront'), 'AgencyStorefrontPage');
const PostCheckoutStepperPage = lz(() => import('@shared/pages/marketplace/post-checkout-stepper'), 'PostCheckoutStepperPage');
const BrandProfilePage = lz(() => import('@shared/pages/brand/brand-profile'), 'BrandProfilePage');
const BrandGuidelinesPage = lz(() => import('@shared/pages/brand/brand-guidelines'), 'BrandGuidelinesPage');
const InfoHubPage = lz(() => import('@shared/pages/brand/info-hub'), 'InfoHubPage');
const AdminBrandInfoHubPage = lz(() => import('@shared/pages/brand/info-hub'), 'AdminBrandInfoHubPage');
const AdminBrandBillingPage = lz(() => import('@shared/pages/brand/brand-billing'), 'AdminBrandBillingPage');
const BrandBillingPage = lz(() => import('@shared/pages/brand/brand-billing'), 'BrandBillingPage');
const AgencyBrandBillingPage = lz(() => import('@shared/pages/brand/brand-billing'), 'AgencyBrandBillingPage');
const BrandSubscriptionsPage = lz(() => import('@shared/pages/brand/brand-subscriptions'), 'BrandSubscriptionsPage');
const AgencyBrandSubscriptionsPage = lz(() => import('@shared/pages/brand/brand-subscriptions'), 'AgencyBrandSubscriptionsPage');
const FeatureSubscribePage = lz(() => import('@shared/pages/subscribe/feature-subscribe'), 'FeatureSubscribePage');
const FeatureSubscriptionsPage = lz(() => import('@shared/pages/super-admin/feature-subscriptions'), 'FeatureSubscriptionsPage');
const StrategyFeedbackPage = lz(() => import('@shared/pages/super-admin/strategy-feedback'), 'StrategyFeedbackPage');
const BetaAdminPage = lz(() => import('@shared/pages/super-admin/beta'), 'BetaAdminPage');
const ReviewsAdminPage = lz(() => import('@shared/pages/super-admin/reviews'), 'ReviewsAdminPage');
const PaymentsAdminPage = lz(() => import('@shared/pages/super-admin/payments'), 'PaymentsAdminPage');
const OutreachMailboxesPage = lz(() => import('@shared/pages/super-admin/outreach/mailboxes'), 'OutreachMailboxesPage');
const OutreachCampaignsPage = lz(() => import('@shared/pages/super-admin/outreach/campaigns'), 'OutreachCampaignsPage');
const OutreachProspectsPage = lz(() => import('@shared/pages/super-admin/outreach/prospects'), 'OutreachProspectsPage');
const OutreachRepliesPage = lz(() => import('@shared/pages/super-admin/outreach/replies'), 'OutreachRepliesPage');
const OutreachListsPage = lz(() => import('@shared/pages/super-admin/outreach/lists'), 'OutreachListsPage');
const OutreachRunPage = lz(() => import('@shared/pages/super-admin/outreach/run-screen'), 'OutreachRunPage');
const BrandDocumentsPage = lz(() => import('@shared/pages/brand/documents'), 'BrandDocumentsPage');
const BrandResourcesPage = lz(() => import('@shared/pages/brand/resources'), 'BrandResourcesPage');
const CreateBrandPage = lz(() => import('@shared/pages/brand/create-brand'), 'CreateBrandPage');
const CreateContractorPage = lz(() => import('@shared/pages/contractor/create-contractor'), 'CreateContractorPage');
const PublicBrandProfilePage = lz(() => import('@shared/pages/brand/public-brand-profile'), 'PublicBrandProfilePage');
const PublicBrandFormPage = lz(() => import('@shared/pages/brand/public-brand-profile'), 'PublicBrandFormPage');
const PublicProposalPage = lz(() => import('@shared/pages/proposals/public-proposal'), 'PublicProposalPage');
const AuthHandoffPage = lz(() => import('@shared/pages/auth-handoff'), 'AuthHandoffPage');
const LinksPage = lz(() => import('@shared/pages/brand/links'), 'LinksPage');

/** Redirect that carries the current query string through (Flutter goPreservingParams). */
function RedirectPreserve({ to }: { to: string }) {
  const search = window.location.search;
  return <Redirect to={search && !to.includes('?') ? to + search : to} replace />;
}

/** Mirrors the Flutter GoRouter redirect chain (app_router_notifier.dart) + RouteAccess. */
export function App() {
  const { data: user, isLoading, sessionLoading, isAuthenticated, error } = useCurrentUser();
  const { activeAgency } = useActiveContext();
  const [location] = useLocation();

  // Redeem any pending new-user invitation (the /signup?invite=<token> links) once
  // the user is authenticated + email-verified. Called unconditionally (before the
  // early returns below) so it runs on every route.
  useInviteRedemption();

  // If the user has no active role but already has selectable identities (staff
  // seat / owned org / contractor), switch into the first one instead of parking
  // them on role-selection. Runs on every route, after invite redemption.
  useAutoSelectContext();

  // White-label redirect: a logged-in user referred by an agency is handed off
  // to that agency's subdomain (true while the hand-off is in flight).
  const redirecting = useSubdomainRedirect();

  // Email-confirmation + password-reset deep links + public brand profiles render
  // regardless of auth state (verifyOtp establishes the session on these pages).
  if (location === '/auth/confirm') return <AuthConfirmPage />;
  // Subdomain hand-off landing — redeems the one-time token to sign the user in
  // on the tenant subdomain (renders before any auth gate, like /auth/confirm).
  if (location === '/auth/handoff') return <AuthHandoffPage />;
  if (location === '/auth/action') return <ResetPasswordPage />;
  if (location === '/auth/reset-otp') return <MigratedResetPage />;
  if (location === '/forgot-password') return <ForgotPasswordPage />;
  // NOTE: Privacy & Terms are NOT routed here — they live on the marketing site
  // (prodesk.com/legal) as the single source of truth. Links to them are plain
  // external <a target="_blank"> anchors (see auth-shell + sidebar).
  if (location.startsWith('/public/brand/')) {
    return (
      <Switch>
        <Route path="/public/brand/form/:componentId" component={PublicBrandFormPage} />
        <Route path="/public/brand/:id" component={PublicBrandProfilePage} />
        <Route component={UnknownRouteRedirect} />
      </Switch>
    );
  }
  // Tokenized proposal link from the "View & Accept Proposal" email — renders a
  // read-only preview regardless of auth state, then routes the viewer through
  // signup/login or the brand chooser to accept (PublicProposalPage).
  if (location.startsWith('/public/proposal/')) {
    return (
      <Switch>
        <Route path="/public/proposal/:token" component={PublicProposalPage} />
        <Route component={UnknownRouteRedirect} />
      </Switch>
    );
  }

  // Never land on a screen until auth.me is fetched for the CURRENT user: while
  // authenticated, wait for the query to resolve (isLoading) AND for a non-null
  // row (`!user`) — which also covers the brief window while the row is being
  // provisioned. This prevents flashing the dashboard / role-selection before
  // the verify-email gate (which depends on user.isEmailVerified) can engage.
  if (sessionLoading || (isAuthenticated && (isLoading || !user))) {
    return <AuthLoadingScreen error={error} />;
  }

  // Hold a loading screen while handing the session off to the referring
  // agency's subdomain, so the dashboard never flashes before the redirect.
  if (redirecting) {
    return <div className="grid min-h-screen place-items-center text-ink-40">Taking you to your workspace…</div>;
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

  // Hard gate: a signed-in user whose email is not yet verified is blocked from
  // the entire app (role-selection included) until they confirm. Verification is
  // app-level (auth.me.isEmailVerified) and flips when they click our link on any
  // device; the gate screen polls auth.me and clears itself. OAuth users are
  // pre-verified so they never see this.
  if (user && !user.isEmailVerified) {
    return <VerifyEmailPage />;
  }

  const isSuperAdmin = !!user?.isSuperAdmin;

  // Authenticated but no role: super-admins skip role-selection straight to their
  // console; everyone else is held in onboarding — they may pick a role and reach
  // the matching create screen. A roleless user can ALSO reach the role-independent
  // screens (Tasks + Profile) so they can act on pending invitations (e.g. accept a
  // staff invite from Tasks) or manage their account before committing to a role.
  // Mirrors the Flutter gate (app_router_notifier roleIndependentPaths =
  // {'/profile', '/tasks', '/chat'}) layered over the role-selection / create-*
  // onboarding screens, all rendered in the chromeless onboarding shell.
  if (!user?.role && !isSuperAdmin) {
    return (
      <OnboardingLayout>
        <Switch>
          <Route path="/role-selection" component={RoleSelectionPage} />
          <Route path="/create-brand" component={CreateBrandPage} />
          <Route path="/create-agency" component={CreateAgencyPage} />
          <Route path="/create-contractor" component={CreateContractorPage} />
          {/* Tasks needs the page padding MainLayout's <main> normally supplies
              (the onboarding shell renders children flush). py-6 keeps the page
              within TasksPage's h-[calc(100vh-7rem)] = header(4rem)+padding(3rem). */}
          <Route path="/tasks">{() => <div className="px-4 py-6 md:px-8"><TasksPage /></div>}</Route>
          <Route path="/profile">{() => <ProfilePage />}</Route>
          <Route>{() => <RedirectPreserve to="/role-selection" />}</Route>
        </Switch>
      </OnboardingLayout>
    );
  }

  const id: AccessIdentity = {
    role: user?.role as UserRole | undefined,
    isSuperAdmin,
    permissions: (user?.permissions ?? []) as StaffPermission[],
    agencyVerified: activeAgency ? activeAgency.emailVerified : undefined,
    agencyDeleted: activeAgency ? activeAgency.username === 'deleted' && !activeAgency.emailVerified : undefined,
  };
  const home = dashboardFor(id);

  // Add-role mode: a roled user may revisit role-selection only with ?add=true.
  const params = new URLSearchParams(window.location.search);
  if (location === '/role-selection') {
    return params.get('add') === 'true'
      ? <OnboardingLayout><RoleSelectionPage /></OnboardingLayout>
      : <RedirectPreserve to={home} />;
  }

  // Bounce auth/landing pages to the role dashboard.
  if (location === '/' || location === '/login' || location === '/signup') {
    return <RedirectPreserve to={home} />;
  }

  // Per-route authorization (RouteAccess.canAccess). Denied → role dashboard.
  if (!canAccess(location, id)) {
    return <RedirectPreserve to={home} />;
  }

  // Create/onboarding + edit-profile screens always render in the chromeless
  // onboarding shell — no sidebar/context-selector — even for a user who already
  // has a role (e.g. the add-role flow). Mirrors the roleless onboarding branch.
  if (
    location === '/create-brand' || location === '/create-agency' ||
    location === '/create-contractor' || location === '/profile'
  ) {
    return (
      <OnboardingLayout>
        <Switch>
          <Route path="/create-brand" component={CreateBrandPage} />
          <Route path="/create-agency" component={CreateAgencyPage} />
          <Route path="/create-contractor" component={CreateContractorPage} />
          <Route path="/profile">{() => <ProfilePage />}</Route>
        </Switch>
      </OnboardingLayout>
    );
  }

  // Hide the left nav rail on the proposal builder so the 3-pane editor gets the
  // full width (the builder has its own back-to-Proposals control).
  const hideNav = /^\/proposal\/[^/]+\/edit\/?$/.test(location);

  return (
    <MainLayout hideNav={hideNav}>
      <Switch>
        <Route path="/agency-dashboard" component={DashboardPage} />
        <Route path="/brand-dashboard" component={DashboardPage} />
        <Route path="/contractor-dashboard" component={DashboardPage} />
        <Route path="/staff-dashboard" component={TasksPage} />
        <Route path="/catalog" component={CatalogPage} />
        <Route path="/clients/:id" component={ClientDetailPage} />
        <Route path="/clients" component={ClientsPage} />
        <Route path="/staff" component={StaffPage} />
        <Route path="/create-agency" component={CreateAgencyPage} />
        <Route path="/edit-agency" component={EditAgencyPage} />
        <Route path="/workflow-settings" component={WorkflowSettingsPage} />
        <Route path="/manage-resources" component={ManageResourcesPage} />
        <Route path="/section-library" component={InfoHubSetupPage} />
        <Route path="/agency-bank-account" component={AgencyBankAccountPage} />
        <Route path="/agency-subscriptions" component={AgencySubscriptionsPage} />
        <Route path="/agency-affiliate" component={AgencyAffiliatePage} />
        <Route path="/brand-profile" component={BrandProfilePage} />
        <Route path="/brand-guidelines" component={BrandGuidelinesPage} />
        <Route path="/info-hub" component={InfoHubPage} />
        {/* Billing & subscriptions — brand self-service + agency view of a client. */}
        <Route path="/payments/:brandId" component={AgencyBrandBillingPage} />
        <Route path="/payments" component={BrandBillingPage} />
        <Route path="/subscriptions/:brandId" component={AgencyBrandSubscriptionsPage} />
        <Route path="/subscriptions" component={BrandSubscriptionsPage} />
        <Route path="/subscribe/:slug" component={FeatureSubscribePage} />
        <Route path="/documents" component={BrandDocumentsPage} />
        <Route path="/resources" component={BrandResourcesPage} />
        <Route path="/links" component={LinksPage} />
        <Route path="/create-brand" component={CreateBrandPage} />
        <Route path="/create-contractor" component={CreateContractorPage} />
        <Route path="/proposals" component={ProposalsPage} />
        <Route path="/proposal/:id/edit" component={ProposalBuilderPage} />
        <Route path="/proposal/:id" component={ProposalDetailPage} />
        <Route path="/agency-projects" component={ProjectsBoardPage} />
        <Route path="/brand-projects" component={ProjectsBoardPage} />
        <Route path="/project/:id" component={ProjectDetailPage} />
        <Route path="/my-projects" component={ContractorProjectsPage} />
        <Route path="/marketplace/checkout" component={MarketplaceCheckoutPage} />
        <Route path="/marketplace/agency/:agencyId" component={AgencyStorefrontPage} />
        <Route path="/marketplace" component={MarketplacePage} />
        <Route path="/post-checkout/:purchaseId" component={PostCheckoutStepperPage} />
        <Route path="/tasks" component={TasksPage} />
        <Route path="/chat">{() => <ChatPage />}</Route>
        <Route path="/earnings" component={EarningsPage} />
        <Route path="/invoices" component={InvoicesPage} />
        <Route path="/invoices/:id" component={InvoiceDetailPage} />
        <Route path="/agency-invoices" component={InvoicesPage} />
        <Route path="/profile">{() => <ProfilePage />}</Route>
        <Route path="/support/:id" component={SupportPage} />
        <Route path="/support" component={SupportPage} />
        <Route path="/checkout/:id" component={CheckoutPage} />
        <Route path="/payment-success">{() => <PaymentResultPage success />}</Route>
        <Route path="/payment-cancel">{() => <PaymentResultPage success={false} />}</Route>
        <Route path="/super-admin/users" component={AdminUsersPage} />
        <Route path="/super-admin/agencies" component={AdminAgenciesPage} />
        <Route path="/super-admin/tickets" component={TicketsAdminPage} />
        <Route path="/super-admin/payouts" component={AdminPayoutsPage} />
        <Route path="/super-admin/invoices" component={AdminInvoicesPage} />
        <Route path="/super-admin/brands/:id/billing" component={AdminBrandBillingPage} />
        <Route path="/super-admin/brands/:id/info-hub" component={AdminBrandInfoHubPage} />
        <Route path="/super-admin/brands" component={AdminBrandsPage} />
        <Route path="/super-admin/push-notifications" component={PushNotificationsPage} />
        <Route path="/super-admin/settings" component={GlobalSettingsPage} />
        <Route path="/super-admin/ai-spend" component={AiSpendByBrandPage} />
        <Route path="/super-admin/ai-models" component={AiModelsPage} />
        <Route path="/super-admin/disciplines" component={DisciplinesPage} />
        <Route path="/super-admin/feature-subscriptions" component={FeatureSubscriptionsPage} />
        <Route path="/super-admin/strategy-feedback" component={StrategyFeedbackPage} />
        <Route path="/super-admin/beta" component={BetaAdminPage} />
        <Route path="/super-admin/resources" component={ResourcesManagementPage} />
        <Route path="/super-admin/info-hub-templates" component={GlobalInfoHubTemplatesPage} />
        <Route path="/super-admin/reviews" component={ReviewsAdminPage} />
        <Route path="/super-admin/payments" component={PaymentsAdminPage} />
        {/* Outreach — our own cold email. Super-admin and ProDesk only; never
            mirrored into a satellite frontend. */}
        <Route path="/super-admin/outreach/mailboxes" component={OutreachMailboxesPage} />
        {/* Specific first: a run is a screen of its own, under the list it
            came from, so the address says where it belongs. */}
        <Route path="/super-admin/outreach/lists/:runId" component={OutreachRunPage} />
        <Route path="/super-admin/outreach/lists" component={OutreachListsPage} />
        <Route path="/super-admin/outreach/campaigns" component={OutreachCampaignsPage} />
        <Route path="/super-admin/outreach/prospects" component={OutreachProspectsPage} />
        <Route path="/super-admin/outreach/replies" component={OutreachRepliesPage} />
        <Route path="/agencies" component={BrandAgenciesPage} />
        <Route path="/agency-contractors" component={AgencyContractorsPage} />
        <Route path="/contracts" component={ContractorContractsPage} />
        <Route path="/contractor-agencies" component={ContractorAgenciesPage} />
        {/* Contractor "Info" (sidebar) — edits the profile via the create-contractor
            screen in edit mode, rendered inside the app shell like Agency Info. */}
        <Route path="/contractor-info" component={CreateContractorPage} />
        <Route>{() => <RedirectPreserve to={home} />}</Route>
      </Switch>
      {/* Beta programme — MANDATORY on every frontend (enforced by
          scripts/check-frontend-wiring.mjs). Renders the beta countdown, the
          post-beta price report, and the floating feedback tab; all three
          self-suppress for users who aren't beta members. */}
      <BetaProgram />
    </MainLayout>
  );
}
