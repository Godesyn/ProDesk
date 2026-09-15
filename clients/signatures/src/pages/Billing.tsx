/**
 * SIGKITT — Billing. Owner-level, per-seat signatures subscription (one seat per
 * signature member across the owner's brands): status + per-seat KPIs, cancel/resume,
 * card-on-file management (Stripe Elements
 * via SetupIntent, reusing the tool-agnostic shortLinks card procedures), and a
 * signatures-only invoice history (signatures.invoices). Prices are read live from
 * the entitlement — never hardcoded. Card/cancel controls are gated to the brand
 * owner or staff with the `payments` permission. Modeled on clients/reviews Billing.
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import {
  CreditCard,
  Download,
  ExternalLink,
  Info,
  Loader2,
} from 'lucide-react';
import { useCurrentUser } from '@shared/auth/auth-context';
import { supabase } from '@shared/lib/supabase';
import { subscribeResilient } from '@shared/lib/resilient-channel';
import { STRIPE_PUBLISHABLE_KEY } from '@shared/lib/env';
import { StripeCardSetup } from '@shared/components/billing/stripe-card-setup';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { trpc } from '@/lib/trpc';
import { useOwnedSignatureBrands } from '@/app/context';

function money(amount: number, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(
    amount,
  );
}
function fmtDate(d: string | Date | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function BillingPage() {
  // Signatures billing is owner-scoped (one subscription per owner, keyed by
  // userId, with seats summed across all the owner's brands). Resolve via a brand
  // the caller OWNS — never the active-context brand — so billing is the same no
  // matter which brand is "active". Any owned brand resolves to the same owner
  // subscription; a staff-only user (owns none) sees the empty state below.
  const ownedBrands = useOwnedSignatureBrands();
  const brandId = ownedBrands[0]?.id ?? null;
  const utils = trpc.useUtils();
  const { data: user } = useCurrentUser();
  const [, navigate] = useLocation();

  const canManageBilling =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('payments');

  const { data: ent } = trpc.signatures.entitlement.useQuery(
    { brandId: brandId! },
    { enabled: !!brandId },
  );
  const { data: myForBrand, isLoading } =
    trpc.featureSubscriptions.myForBrand.useQuery(
      { brandId: brandId! },
      { enabled: !!brandId },
    );
  const subs = (myForBrand?.subscriptions ?? []).filter((s) =>
    s.featureKeys.includes('email_signatures'),
  );
  const sub = subs.find((s) => s.active) ?? subs[0];

  const showBillingMachinery = !ent?.betaExempt;

  const { data: card } = trpc.shortLinks.paymentMethod.useQuery(
    { brandId: brandId! },
    { enabled: !!brandId && canManageBilling && showBillingMachinery },
  );
  const { data: invoices = [], isLoading: invoicesLoading } =
    trpc.signatures.invoices.useQuery(
      { brandId: brandId! },
      { enabled: !!brandId && canManageBilling && showBillingMachinery },
    );

  const invalidate = () => {
    utils.featureSubscriptions.myForBrand.invalidate();
    utils.signatures.entitlement.invalidate();
  };

  // ── Live billing ───────────────────────────────────────────────────────────
  // A Stripe webhook that flips the owner's signatures subscription (payment
  // succeeded, seat added/removed, cancel/resume, period roll) writes the
  // feature_subscriptions row, which is realtime-published + RLS-scoped to the
  // owner and brand members (servers/backend/sql/rls.sql). Refetch the plan,
  // entitlement and invoices whenever it changes so this screen never shows stale
  // billing. postgres_changes authorizes ONCE at subscribe time against the socket
  // JWT, so gate on the signed-in user — by then auth-context has run
  // supabase.realtime.setAuth with the session, and the feed is authorized as the
  // brand member rather than anon (else every event is silently dropped). The dep
  // also re-subscribes after a context switch (new brand id).
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId || !brandId) return;
    const refetch = () => {
      utils.featureSubscriptions.myForBrand.invalidate();
      utils.signatures.entitlement.invalidate();
      utils.signatures.invoices.invalidate();
    };
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic: 'rt-signatures-billing',
      build: () => {
        const channel = supabase.channel('rt-signatures-billing');
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'feature_subscriptions' },
          () => refetch(),
        );
        return channel;
      },
      // postgres_changes has no replay — on every re-join (tab wake / reconnect)
      // refetch to recover whatever changed while the socket was down.
      onCatchUp: refetch,
    });
    return () => handle.dispose();
    // utils is stable; re-run only when the signed-in user or active brand changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, brandId]);

  const cancel = trpc.featureSubscriptions.cancel.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Subscription will cancel at the period end.');
    },
    onError: (e) => toast.error(e.message),
  });
  const resume = trpc.featureSubscriptions.resume.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Subscription resumed.');
    },
    onError: (e) => toast.error(e.message),
  });

  // ── Card on file (Stripe Elements via SetupIntent) ─────────────────────────
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const createSetupIntent = trpc.shortLinks.createSetupIntent.useMutation();
  const setDefaultPm = trpc.shortLinks.setDefaultPaymentMethod.useMutation();

  async function openCardForm() {
    if (!STRIPE_PUBLISHABLE_KEY) {
      toast.error('Card payments aren’t configured (missing Stripe key).');
      return;
    }
    try {
      const res = await createSetupIntent.mutateAsync({ brandId: brandId! });
      if (res.clientSecret) setSetupSecret(res.clientSecret);
      else toast.error('Card payments are not available right now.');
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Could not start card setup.',
      );
    }
  }
  async function onCardSaved(paymentMethodId: string) {
    try {
      await setDefaultPm.mutateAsync({ brandId: brandId!, paymentMethodId });
      utils.shortLinks.paymentMethod.invalidate();
      setSetupSecret(null);
      toast.success('Card saved.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save card.');
    }
  }

  const currency = ent?.currency ?? sub?.currency ?? 'AUD';
  const unit = ent?.unitAmount ?? (sub ? Number(sub.amount) : null);
  const billableUnits = sub?.quantity ?? 0;
  const monthlyTotal = sub
    ? Number(sub.totalAmount ?? Number(sub.amount) * (sub.quantity ?? 1))
    : 0;

  // Staff-only user (owns no brand): there is no subscription they can manage.
  if (!brandId) {
    return (
      <div className="space-y-4 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-primary" /> Billing
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Signatures is billed per seat to the brand owner through Prodesk ·
            Stripe.
          </p>
        </div>
        <Alert className="bg-muted/30 border">
          <Info className="h-4 w-4" />
          <AlertDescription>
            <span className="font-semibold text-foreground">Note:</span> You
            don’t own any brands, so there’s no subscription to manage here.
            Billing for a brand you’re staff of is managed by that brand’s owner
            — please contact them.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <div className="h-32 rounded-xl bg-muted animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CreditCard className="w-6 h-6 text-primary" /> Billing
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Signatures is billed per seat ($1/seat per month). Billed to the brand
          owner through Prodesk · Stripe.
        </p>
      </div>

      {/* Status / plan */}
      <div className="bg-card rounded-xl border p-5">
        {ent?.betaExempt ? (
          <>
            <div className="text-xl font-bold">Beta access — free</div>
            <p className="text-sm text-muted-foreground mt-1">
              You’re on the beta: unlimited signatures at no charge.
            </p>
          </>
        ) : sub && (sub.active || sub.status) ? (
          <>
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Your plan
              </div>
              <Badge variant="outline" className="capitalize">
                {sub.status}
              </Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
              <div>
                <div className="text-2xl font-bold">{billableUnits}</div>
                <div className="text-xs text-muted-foreground">
                  billed seat{billableUnits !== 1 ? 's' : ''}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {money(monthlyTotal, currency)}
                </div>
                <div className="text-xs text-muted-foreground">
                  per month
                  {unit != null ? ` · ${money(unit, currency)}/seat` : ''}
                </div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {fmtDate(sub.currentPeriodEnd)}
                </div>
                <div className="text-xs text-muted-foreground">
                  {sub.cancelAtPeriodEnd ? 'cancels on' : 'next invoice'}
                </div>
              </div>
            </div>
            {canManageBilling ? (
              <div className="mt-4">
                {sub.cancelAtPeriodEnd ? (
                  <Button
                    size="sm"
                    disabled={resume.isPending}
                    onClick={() => resume.mutate({ subscriptionId: sub.id })}
                  >
                    Resume subscription
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate({ subscriptionId: sub.id })}
                  >
                    Cancel subscription
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground mt-3">
                Billing is managed by the brand owner.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="text-xl font-bold">No paid subscription</div>
            <p className="text-sm text-muted-foreground mt-1">
              Signatures is $1 per seat per month. Add a seat (member) from the
              Brand Manager and you’ll be prompted to subscribe
              {unit != null
                ? ` (${money(unit, currency)}/seat per month).`
                : '.'}
            </p>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => navigate('/brands')}
            >
              Go to Brand Manager
            </Button>
          </>
        )}
      </div>

      {/* Card on file — owner/payments only. Beta brands never get billed. */}
      {showBillingMachinery && canManageBilling ? (
        <div className="bg-card rounded-xl border p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Card on file
          </div>
          {card ? (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="border rounded px-2.5 py-1 text-xs font-bold capitalize">
                {card.brand}
              </span>
              <span className="text-sm">···· {card.last4}</span>
              <span className="text-xs text-muted-foreground">
                {String(card.expMonth).padStart(2, '0')}/
                {String(card.expYear).slice(-2)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                disabled={createSetupIntent.isPending}
                onClick={openCardForm}
              >
                {createSetupIntent.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : null}
                Update card
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-sm text-muted-foreground">
                No card yet. Add one so renewals go through.
              </p>
              <Button
                size="sm"
                disabled={createSetupIntent.isPending}
                onClick={openCardForm}
              >
                {createSetupIntent.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : null}
                Add card
              </Button>
            </div>
          )}
        </div>
      ) : null}

      {/* Invoices — signatures subscription only, owner/payments only. */}
      {showBillingMachinery && canManageBilling ? (
        <div className="bg-card rounded-xl border p-5">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">
            Invoices
          </div>
          {invoicesLoading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No invoices yet. They’ll appear here once your subscription starts
              billing.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b">
                    <th className="py-2">Invoice</th>
                    <th className="py-2">Date</th>
                    <th className="py-2 text-right">Amount</th>
                    <th className="py-2">Status</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="py-2">{inv.number}</td>
                      <td className="py-2">
                        {fmtDate(inv.periodStart ?? inv.created)}
                      </td>
                      <td className="py-2 text-right">
                        {money(inv.amount, inv.currency)}
                      </td>
                      <td className="py-2">
                        <Badge variant="outline" className="capitalize">
                          {inv.status === 'paid' ? 'Paid' : inv.status}
                        </Badge>
                      </td>
                      <td className="py-2 text-right">
                        {inv.pdfUrl ? (
                          <a
                            className="inline-flex"
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Download invoice"
                          >
                            <Download className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </a>
                        ) : inv.hostedUrl ? (
                          <a
                            className="inline-flex"
                            href={inv.hostedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View invoice"
                          >
                            <ExternalLink className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
      <Alert className="bg-muted/30 border mt-4">
        <Info className="h-4 w-4" />
        <AlertDescription>
          <span className="font-semibold text-foreground">Note:</span> Only
          displaying billing data for brands you are the owner of. If you want
          billing information for a brand you are staff of, please contact the
          brand owner.
        </AlertDescription>
      </Alert>
      {setupSecret && STRIPE_PUBLISHABLE_KEY ? (
        <Dialog open onOpenChange={(open) => !open && setSetupSecret(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Card details</DialogTitle>
            </DialogHeader>
            <StripeCardSetup
              publishableKey={STRIPE_PUBLISHABLE_KEY}
              clientSecret={setupSecret}
              submitClassName="w-full bg-primary text-[#0E0E0C] hover:bg-primary/85 border border-[#0E0E0C] font-semibold rounded-lg py-2"
              submitLabel="Save card"
              onSaved={onCardSaved}
              onError={(m) => toast.error(m)}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
