/**
 * SIGKITT workspace shell — brand-scoped. Wraps the local tRPC provider, the
 * DashboardLayout sidebar chrome, and the wouter routes, and sends unmatched
 * routes back to this frontend's root. Handles the ?sub=success return from the
 * per-seat Stripe checkout, mirroring clients/reviews' ReviewsApp.
 */
import { useEffect } from 'react';
import { Route, Switch, Redirect } from 'wouter';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useSignaturesContext } from './app/context';
import { SignaturesTrpcProvider } from './lib/trpc';
import DashboardLayout from './components/DashboardLayout';
import { CreateBrandOnboarding } from './pages/CreateBrandOnboarding';
import Home from './pages/Home';
import DepartmentsPage from './pages/Departments';
import { setSavedSignatureScope } from './lib/signatureTypes';
import CampaignsPage from './pages/Campaigns';
import AnalyticsPage from './pages/Analytics';
import TeamPage from './pages/Team';
import BillingPage from './pages/Billing';
import { Support } from './pages/Support';
import { UnknownRouteRedirect } from '@shared/components/unknown-route-redirect';

function Shell() {
  const { brands, brandId, loading } = useSignaturesContext();
  const qc = useQueryClient();

  // Saved signatures are brand-level, and they live in localStorage — point the
  // store at the active brand before any screen reads it, so switching brands in
  // the side panel switches the studio's saved work with it.
  setSavedSignatureScope(brandId);

  // Return from Stripe checkout (?sub=success|cancel).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sub = params.get('sub');
    if (!sub) return;
    if (sub === 'success') {
      toast.success('Subscription active. Your signatures are unlocked.');
      qc.invalidateQueries();
    } else if (sub === 'cancel') {
      toast('Checkout cancelled.');
    }
    params.delete('sub');
    const qs = params.toString();
    window.history.replaceState(
      {},
      '',
      window.location.pathname + (qs ? '?' + qs : ''),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While brands.mine is still in flight the list is empty even for users WITH
  // a brand — hold on a loading state so the create-brand onboarding never
  // flashes before the workspace renders.
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  // Signatures is user-level: the workspace renders whenever the caller can reach
  // AT LEAST ONE brand (owned or signatures-staff), regardless of which brand is
  // "active". Only when they have NO accessible brand (e.g. an agency-only user,
  // or a brand user whose brand was removed) do we initiate the create-brand
  // onboarding instead of dead-ending — creating one sets the brandOwner role and
  // drops straight into the workspace.
  if (brands.length === 0) {
    return <CreateBrandOnboarding />;
  }

  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/departments" component={DepartmentsPage} />
        {/* The screen was "Brand Manager" before departments — keep the old path
            working for bookmarks and any link already sent to a teammate. */}
        <Route path="/brands">{() => <Redirect to="/departments" replace />}</Route>
        <Route path="/campaigns" component={CampaignsPage} />
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/team" component={TeamPage} />
        <Route path="/support" component={Support} />
        <Route path="/support/:id" component={Support} />
        {/* Legacy /app paths from the original export → redirect to the new roots. */}
        <Route path="/app">{() => <Redirect to="/" replace />}</Route>
        <Route path="/app/brands">
          {() => <Redirect to="/departments" replace />}
        </Route>
        <Route path="/app/campaigns">
          {() => <Redirect to="/campaigns" replace />}
        </Route>
        <Route path="/app/analytics">
          {() => <Redirect to="/analytics" replace />}
        </Route>
        <Route component={UnknownRouteRedirect} />
      </Switch>
    </DashboardLayout>
  );
}

export function SignaturesApp() {
  return (
    <div className="sigkitt">
      <SignaturesTrpcProvider>
        <Shell />
      </SignaturesTrpcProvider>
    </div>
  );
}
