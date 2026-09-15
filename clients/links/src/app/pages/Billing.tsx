/* Billing — the brand's short-link subscription, ported to the Manus Adeyy layout:
 * KPIs (active codes / monthly cost / next invoice), a Card-on-file card with native
 * Stripe Elements add/update (SetupIntent), and a links-only Invoices table. Wired to
 * shortLinks.{billingConfig,paymentMethod,invoices,createSetupIntent,setDefaultPaymentMethod}
 * + featureSubscriptions.{myForBrand,cancel,resume,checkout}. */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { StripeCardSetup } from '@shared/components/billing/stripe-card-setup';
import { Icon, Modal, SkeletonTable } from '../components';
import { fmtDate, money, monthYear, num, STRIPE_PUBLISHABLE_KEY } from '../lib';
import { useToast } from '../toast';
import { useLinksInvalidate } from '../use-invalidate';
import { useConfirm } from '../confirm';
import type { PageProps } from '../types';

export function Billing({ brandId, entitlement }: PageProps) {
  const trpc = useTRPC();
  const toast = useToast();
  const confirm = useConfirm();
  const { data: user } = useCurrentUser();

  const canManageBilling =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('payments');

  const { data, isLoading } = useQuery(
    trpc.featureSubscriptions.myForBrand.queryOptions({ brandId }),
  );
  const subs = (data?.subscriptions ?? []).filter((s) =>
    s.featureKeys.includes('url_shortener'),
  );
  const sub = subs.find((s) => s.active) ?? subs[0];

  const { data: card } = useQuery({
    ...trpc.shortLinks.paymentMethod.queryOptions({ brandId }),
    enabled: canManageBilling,
  });
  const { data: invoices = [] } = useQuery({
    ...trpc.shortLinks.invoices.queryOptions({ brandId }),
    enabled: canManageBilling,
  });

  const { afterBillingChange: invalidate } = useLinksInvalidate();
  const cancel = useMutation({
    ...trpc.featureSubscriptions.cancel.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Subscription will cancel at the period end.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });
  const resume = useMutation({
    ...trpc.featureSubscriptions.resume.mutationOptions(),
    onSuccess: () => {
      invalidate();
      toast('Subscription resumed.');
    },
    onError: (e) => toast('Error: ' + e.message),
  });
  const checkout = useMutation(
    trpc.featureSubscriptions.checkout.mutationOptions(),
  );

  // ── Card on file (Stripe Elements via SetupIntent) ─────────────────────
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const createSetupIntent = useMutation(
    trpc.shortLinks.createSetupIntent.mutationOptions(),
  );
  const setDefaultPm = useMutation(
    trpc.shortLinks.setDefaultPaymentMethod.mutationOptions(),
  );

  async function openCardForm() {
    if (!STRIPE_PUBLISHABLE_KEY) {
      toast(
        'Card payments aren’t configured (missing Stripe publishable key).',
      );
      return;
    }
    try {
      const res = await createSetupIntent.mutateAsync({ brandId });
      if (res.clientSecret) setSetupSecret(res.clientSecret);
      else toast('Card payments are not available right now.');
    } catch (e) {
      toast('Error: ' + (e instanceof Error ? e.message : 'could not start'));
    }
  }
  async function onCardSaved(paymentMethodId: string) {
    try {
      await setDefaultPm.mutateAsync({ brandId, paymentMethodId });
      invalidate();
      setSetupSecret(null);
      toast('Card saved.');
    } catch (e) {
      toast(
        'Error: ' + (e instanceof Error ? e.message : 'could not save card'),
      );
    }
  }

  async function subscribe() {
    if (!entitlement?.priceId) {
      toast('Short links are not available to subscribe to yet.');
      return;
    }
    try {
      const base = window.location.origin + window.location.pathname;
      const res = await checkout.mutateAsync({
        brandId,
        priceId: entitlement.priceId,
        successUrl: base + '?sub=success',
        cancelUrl: base + '?sub=cancel',
      });
      if (res.url) window.location.href = res.url;
      else {
        invalidate();
        toast('Subscription active.');
      }
    } catch (e) {
      toast('Error: ' + (e instanceof Error ? e.message : 'checkout failed'));
    }
  }

  const unit = entitlement?.unitAmount ?? 1;
  const currency = entitlement?.currency ?? 'AUD';
  const activeCount = entitlement?.activeCount ?? sub?.quantity ?? 0;
  // The rate a NEW link locks in now (grandfathering: existing links keep theirs).
  const newRate = entitlement?.newLinkAmount ?? unit;
  // Real monthly bill = Σ each active link's locked price (mix of old + new rates).
  const monthlyTotal = entitlement?.monthlyTotal ?? unit * activeCount;
  // Active links sit at more than one price → show a per-rate breakdown, not a
  // single "× per code" line that can't represent the mix.
  const mixedRates = (entitlement?.breakdown?.length ?? 0) > 1;

  if (isLoading) {
    return (
      <div>
        <div className="apage-head">
          <h1>Billing</h1>
        </div>
        <SkeletonTable rows={4} />
      </div>
    );
  }

  if (entitlement?.betaExempt) {
    return (
      <div>
        <div className="apage-head">
          <h1>Billing</h1>
          <span className="meta">Billed through Prodesk · Stripe</span>
        </div>
        <div className="dcard">
          <div className="db" style={{ paddingTop: 18 }}>
            <div className="kpi accent" style={{ maxWidth: 320 }}>
              <div className="lbl">Beta access</div>
              <div className="num">Free</div>
              <div className="sub">Unlimited short links during the beta.</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="apage-head">
        <h1>Billing</h1>
        <span className="meta">
          Billed through Prodesk · Stripe · new links {money(newRate, currency)}{' '}
          each
        </span>
      </div>

      <div className="kpis three">
        <div className="kpi accent">
          <div className="lbl">Active codes</div>
          <div className="num">{num(activeCount)}</div>
          <div className="sub">Each one redirects live</div>
        </div>
        <div className="kpi">
          <div className="lbl">Monthly cost</div>
          <div className="num">{money(monthlyTotal, currency)}</div>
          <div className="sub">
            {mixedRates
              ? entitlement!.breakdown
                  .map((b) => `${b.count} × ${money(b.amount, currency)}`)
                  .join(' · ') + ', prorated'
              : `${money(newRate, currency)} per active code, prorated`}
          </div>
        </div>
        <div className="kpi">
          <div className="lbl">Next invoice</div>
          <div className="num">
            {sub?.currentPeriodEnd ? fmtDate(sub.currentPeriodEnd) : '—'}
          </div>
          <div className="sub">
            {sub
              ? sub.cancelAtPeriodEnd
                ? 'Cancels at period end'
                : 'Adjusted to the day'
              : 'No active subscription'}
          </div>
        </div>
      </div>

      <div className="detail-grid rev">
        {/* Card on file + plan */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="dcard">
            <div className="dh">
              <h2>Card on file</h2>
            </div>
            <div
              className="db"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {!canManageBilling ? (
                <p className="mutetext" style={{ margin: 0, fontSize: 13 }}>
                  Billing is managed by the brand owner.
                </p>
              ) : card ? (
                <>
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 12 }}
                  >
                    <span
                      style={{
                        border: '1px solid var(--border-2)',
                        borderRadius: 4,
                        padding: '6px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                        textTransform: 'capitalize',
                      }}
                    >
                      {card.brand}
                    </span>
                    <span className="slug" style={{ fontSize: 13 }}>
                      ···· {card.last4}
                    </span>
                    <span className="mutetext slug" style={{ fontSize: 12 }}>
                      {String(card.expMonth).padStart(2, '0')}/
                      {String(card.expYear).slice(-2)}
                    </span>
                  </div>
                  <button
                    className="abtn abtn-ghost abtn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={createSetupIntent.isPending}
                    onClick={openCardForm}
                  >
                    Update card
                  </button>
                </>
              ) : (
                <>
                  <p className="mutetext" style={{ margin: 0, fontSize: 13 }}>
                    No card yet. Add one so you can switch links on.
                  </p>
                  <button
                    className="abtn abtn-primary abtn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={createSetupIntent.isPending}
                    onClick={openCardForm}
                  >
                    Add card
                  </button>
                </>
              )}
              <p className="mutetext" style={{ fontSize: 11.5, margin: 0 }}>
                Activating mid-month charges only the days remaining.
                Deactivating credits the difference.
              </p>
            </div>
          </div>

          {/* Hide the plan card entirely when there's nothing to show: no active
              subscription AND no plan available to subscribe to (no priceId). */}
          {(sub || entitlement?.priceId) && (
            <div className="dcard">
              <div className="dh">
                <h2>Your plan</h2>
                {sub ? <span className="meta">{sub.status}</span> : null}
              </div>
              <div className="db">
                {!sub ? (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 12,
                    }}
                  >
                    <p className="mutetext" style={{ margin: 0 }}>
                      Creating links is free — subscribe to switch them on.
                    </p>
                    <button
                      className="abtn abtn-primary abtn-sm"
                      style={{ alignSelf: 'flex-start' }}
                      disabled={checkout.isPending}
                      onClick={subscribe}
                    >
                      Subscribe
                    </button>
                  </div>
                ) : sub.cancelAtPeriodEnd ? (
                  <button
                    className="abtn abtn-primary abtn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={resume.isPending}
                    onClick={() => resume.mutate({ subscriptionId: sub.id })}
                  >
                    Resume subscription
                  </button>
                ) : (
                  <button
                    className="abtn abtn-ghost abtn-sm"
                    style={{ alignSelf: 'flex-start' }}
                    disabled={cancel.isPending}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: 'Cancel subscription?',
                          description:
                            'It cancels at the end of this period. Active links keep redirecting until then.',
                          confirmLabel: 'Cancel subscription',
                          cancelLabel: 'Keep it',
                          destructive: true,
                        })
                      )
                        cancel.mutate({ subscriptionId: sub.id });
                    }}
                  >
                    Cancel subscription
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Invoices — links only */}
        <div className="dcard">
          <div className="dh">
            <h2>Invoices</h2>
            <span className="meta">Short links only</span>
          </div>
          <div className="db">
            {!canManageBilling ? (
              <p className="mutetext">Billing is managed by the brand owner.</p>
            ) : invoices.length === 0 ? (
              <div className="aempty">
                <div className="serif">No invoices yet.</div>
                <p>
                  Your first invoice arrives the month after your first code
                  goes live.
                </p>
              </div>
            ) : (
              <table className="atable">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Period</th>
                    <th className="r">Amount</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} style={{ cursor: 'default' }}>
                      <td className="tslug">{inv.number}</td>
                      <td>
                        {monthYear(
                          inv.periodStart ?? inv.created ?? new Date(),
                        )}
                      </td>
                      <td className="tnum">
                        {money(inv.amount, inv.currency)}
                      </td>
                      <td>
                        <span
                          className="status off"
                          style={{
                            borderColor: 'transparent',
                            color: 'var(--ink-80)',
                          }}
                        >
                          <span
                            className="sdot"
                            style={{ background: 'var(--adeyy)', border: 0 }}
                          />
                          {inv.status === 'paid' ? 'Paid' : inv.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {inv.pdfUrl ? (
                          <a
                            className="abtn abtn-quiet abtn-sm"
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="Download invoice"
                          >
                            <Icon name="download" size={13} />
                          </a>
                        ) : inv.hostedUrl ? (
                          <a
                            className="abtn abtn-quiet abtn-sm"
                            href={inv.hostedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label="View invoice"
                          >
                            <Icon name="external" size={13} />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {setupSecret && STRIPE_PUBLISHABLE_KEY && (
        <Modal
          title="Card details"
          onClose={() => setSetupSecret(null)}
          width={460}
        >
          <StripeCardSetup
            publishableKey={STRIPE_PUBLISHABLE_KEY}
            clientSecret={setupSecret}
            submitClassName="abtn abtn-primary"
            submitLabel="Save card"
            onSaved={onCardSaved}
            onError={(m) => toast(m)}
          />
        </Modal>
      )}
    </div>
  );
}
