/* Authenticated router for the Payments (EziQuotes) frontend — a 1:1 port of
 * the export's Router (client/src/App.tsx), minus auth plumbing (the shared
 * scaffolding in App.tsx owns login/verify/onboarding gates) and minus
 * /team/accept (platform staff invites + useInviteRedemption replace Manus
 * team invites). Route ORDER matters (wouter first-match): full-screen builder
 * routes must precede the /proposals/:id and /templates shell routes. */
import { Route, Switch } from 'wouter';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';
import { usePaymentsContext } from '@/lib/payments-trpc';
import { usePaymentsRealtime } from '@/app/realtime';

import AppShell from '@/components/AppShell';
import Onboarding from '@/pages/Onboarding';
import Dashboard from '@/pages/Dashboard';
import Proposals from '@/pages/Proposals';
import ProposalDetail from '@/pages/ProposalDetail';
import ProposalBuilder from '@/pages/ProposalBuilder';
import QuickBuilder from '@/pages/QuickBuilder';
import Clients from '@/pages/Clients';
import ClientDetail from '@/pages/ClientDetail';
import Templates from '@/pages/Templates';
import TemplateBuilder from '@/pages/TemplateBuilder';
import Pricing from '@/pages/Pricing';
import BrandKit from '@/pages/BrandKit';
import Settings from '@/pages/Settings';
import { Support } from '@/pages/Support';
import ChaseQueue from '@/pages/ChaseQueue';
import RecurringInvoices from '@/pages/RecurringInvoices';
import Inbox from '@/pages/Inbox';
import Activity from '@/pages/Activity';
import { AffiliateDashboard } from '@/pages/Affiliate';
import AIInsights from '@/pages/AIInsights';
import RevenueForecast from '@/pages/RevenueForecast';
import Webhooks from '@/pages/Webhooks';

function ShelledPage({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}

export function PaymentsApp() {
  // Live updates for every payments list/detail/dashboard. Mounted here (the
  // authenticated router) so it never runs on public payer surfaces.
  usePaymentsRealtime();

  // No brand for the context selector (e.g. an agency-only user, or a brand user
  // whose brand was removed) → drop straight into the Onboarding wizard, whose
  // Step 1 names the business and creates the brand before the rest of setup.
  const { brandId } = usePaymentsContext();
  if (!brandId) return <Onboarding />;

  return (
    <Switch>
      {/* ── Onboarding (full-screen wizard) ── */}
      <Route path="/onboarding" component={Onboarding} />

      {/* Super-admin screens (incl. the affiliates admin) live in the Prodesk
          app's /super-admin section, not here. */}

      {/* ── Full-screen builder routes (no sidebar) ── */}
      <Route path="/templates/new" component={TemplateBuilder} />
      <Route path="/templates/:id/edit" component={TemplateBuilder} />
      <Route path="/proposals/new" component={ProposalBuilder} />
      <Route path="/proposals/:id/edit" component={ProposalBuilder} />
      <Route path="/quick" component={QuickBuilder} />

      {/* ── Shell routes (sidebar + topbar) ── */}
      <Route path="/dashboard">
        <ShelledPage>
          <Dashboard />
        </ShelledPage>
      </Route>
      <Route path="/app">
        <ShelledPage>
          <Dashboard />
        </ShelledPage>
      </Route>
      <Route path="/proposals/:id">
        <ShelledPage>
          <ProposalDetail />
        </ShelledPage>
      </Route>
      <Route path="/proposals">
        <ShelledPage>
          <Proposals />
        </ShelledPage>
      </Route>
      <Route path="/clients/:id">
        <ShelledPage>
          <ClientDetail />
        </ShelledPage>
      </Route>
      <Route path="/clients">
        <ShelledPage>
          <Clients />
        </ShelledPage>
      </Route>
      <Route path="/templates">
        <ShelledPage>
          <Templates />
        </ShelledPage>
      </Route>
      <Route path="/pricing">
        <ShelledPage>
          <Pricing />
        </ShelledPage>
      </Route>
      <Route path="/brand">
        <ShelledPage>
          <BrandKit />
        </ShelledPage>
      </Route>
      <Route path="/settings/:tab">
        <ShelledPage>
          <Settings />
        </ShelledPage>
      </Route>
      <Route path="/settings">
        <ShelledPage>
          <Settings />
        </ShelledPage>
      </Route>
      <Route path="/support/:id">
        <ShelledPage>
          <Support />
        </ShelledPage>
      </Route>
      <Route path="/support">
        <ShelledPage>
          <Support />
        </ShelledPage>
      </Route>
      <Route path="/webhooks">
        <ShelledPage>
          <Webhooks />
        </ShelledPage>
      </Route>
      <Route path="/chase">
        <ShelledPage>
          <ChaseQueue />
        </ShelledPage>
      </Route>
      <Route path="/inbox">
        <ShelledPage>
          <Inbox />
        </ShelledPage>
      </Route>
      <Route path="/activity">
        <ShelledPage>
          <Activity />
        </ShelledPage>
      </Route>
      <Route path="/ai">
        <ShelledPage>
          <AIInsights />
        </ShelledPage>
      </Route>
      <Route path="/forecast">
        <ShelledPage>
          <RevenueForecast />
        </ShelledPage>
      </Route>
      <Route path="/affiliate/dashboard">
        <ShelledPage>
          <AffiliateDashboard />
        </ShelledPage>
      </Route>
      <Route path="/recurring-invoices">
        <ShelledPage>
          <RecurringInvoices />
        </ShelledPage>
      </Route>

      {/* ── Catch-all → main app ── */}
      <Route component={UnknownRouteRedirect} />
    </Switch>
  );
}
