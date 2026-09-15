/* Verdiict — Billing. Status (beta / subscribed / trial / trial-ended), a
 * subscribe button (feature-subscription checkout), cancel/resume for an active
 * subscription, card-on-file management (Stripe Elements via SetupIntent, reusing
 * the tool-agnostic shortLinks card procedures), a reviews-only invoice history
 * (reviews.invoices), and the plan feature summary. Prices are always read live
 * from the entitlement — never hardcoded. Card/cancel controls are gated to the
 * brand owner or staff with the `payments` permission. */
import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Download, ExternalLink, Loader2 } from 'lucide-react';
import { useCurrentUser } from '@shared/auth/auth-context';
import { useTRPC } from '@shared/lib/trpc';
import { STRIPE_PUBLISHABLE_KEY } from '@shared/lib/env';
import { StripeCardSetup } from '@shared/components/billing/stripe-card-setup';
import { Modal, SkeletonRows } from '../components';
import { fmtDate, money, num } from '../lib';
import type { PageProps } from '../lib';
import { useToast } from '../toast';
import { useConfirm } from '../confirm';

/** What the subscription includes — adapted from the Manus plan summary. */
const PLAN_FEATURES = [
  'Unlimited locations & captured reviews',
  'AI review generation',
  'Private bad-review routing',
  'All review platforms',
  'Custom logo & win tags',
  'Reviews log, embeds & directory listing',
];

/** Referral tile — "give a month, get a month". Every user has a shareable code;
 * redeeming a friend's code (brand owners, once ever) credits BOTH sides one
 * month of the reviews price as Stripe account credit once the redeemer's
 * subscription activates. Mirrors the source tool's Billing-page ReferralTile. */
function ReferralCard({ canRedeem }: { canRedeem: boolean }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useQuery(trpc.reviews.referrals.mine.queryOptions());
  const [code, setCode] = useState('');

  const redeem = useMutation({
    ...trpc.reviews.referrals.redeem.mutationOptions(),
    onSuccess: (res) => {
      qc.invalidateQueries({
        queryKey: trpc.reviews.referrals.mine.queryKey(),
      });
      setCode('');
      toast(
        res.settled
          ? 'Code redeemed — a month of credit is on your account.'
          : 'Code redeemed — your free month is credited when your subscription starts.',
      );
    },
    onError: (e) => toast(e.message || "Couldn't redeem that code."),
  });

  async function copyCode() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.code);
      toast('Referral code copied.');
    } catch {
      toast("Couldn't copy the code.");
    }
  }

  return (
    <div className="vcard" style={{ marginBottom: 16 }}>
      <div className="veyebrow" style={{ marginBottom: 8 }}>
        Refer a business
      </div>
      <p className="vmuted" style={{ margin: 0, fontSize: 13 }}>
        Share your code — you both get one month free when they subscribe.
      </p>
      {!data ? (
        <div style={{ marginTop: 12 }}>
          <SkeletonRows rows={2} />
        </div>
      ) : (
        <>
          <div className="vrow-between" style={{ marginTop: 14 }}>
            <span className="mono" style={{ fontSize: 18, fontWeight: 700 }}>
              {data.code}
            </span>
            <button className="vbtn vbtn-quiet vbtn-sm" onClick={copyCode}>
              <Copy size={14} />
              Copy
            </button>
          </div>
          <div className="vmuted" style={{ fontSize: 13, marginTop: 10 }}>
            {num(data.monthsEarned)} free{' '}
            {data.monthsEarned === 1 ? 'month' : 'months'} earned
            {data.monthsPending > 0
              ? ` · ${num(data.monthsPending)} pending — credited when they subscribe`
              : ''}
          </div>
          {data.creditCents != null && data.creditCents > 0 ? (
            <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>
              Account credit: {money(data.creditCents / 100)} — applies to your
              next invoice automatically.
            </div>
          ) : null}

          {data.myRedemption ? (
            <div
              className="vmuted"
              style={{
                fontSize: 13,
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--v-line)',
              }}
            >
              You redeemed{' '}
              <span className="mono">{data.myRedemption.code}</span> —{' '}
              {data.myRedemption.creditedAt
                ? 'your free month has been credited.'
                : 'your free month is credited when your subscription starts.'}
            </div>
          ) : canRedeem ? (
            <div
              style={{
                marginTop: 16,
                paddingTop: 14,
                borderTop: '1px solid var(--v-line)',
              }}
            >
              <div className="vmuted" style={{ fontSize: 13, marginBottom: 8 }}>
                Got a code from someone? Redeem it.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="vinput mono"
                  style={{ flex: 1, textTransform: 'uppercase' }}
                  value={code}
                  placeholder="FRIENDCODE"
                  onChange={(e) => setCode(e.target.value)}
                />
                <button
                  className="vbtn vbtn-primary vbtn-sm"
                  disabled={!code.trim() || redeem.isPending}
                  onClick={() => redeem.mutate({ code: code.trim() })}
                >
                  {redeem.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  Redeem
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function Billing(props: PageProps) {
  const { brandId, entitlement } = props;
  const trpc = useTRPC();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [, navigate] = useLocation();
  const { data: user } = useCurrentUser();

  const canManageBilling =
    user?.role === 'brandOwner' ||
    (user?.permissions ?? []).includes('payments');

  const { data, isLoading } = useQuery(
    trpc.featureSubscriptions.myForBrand.queryOptions({ brandId }),
  );
  const subs = (data?.subscriptions ?? []).filter((s) =>
    s.featureKeys.includes('reviews'),
  );
  const sub = subs.find((s) => s.active) ?? subs[0];

  const showBillingMachinery = !entitlement?.betaExempt;

  // Card on file + invoices are owner/payments-only reads; the card procedures
  // live on shortLinks but are tool-agnostic (the brand owner's Stripe customer).
  const { data: card } = useQuery({
    ...trpc.shortLinks.paymentMethod.queryOptions({ brandId }),
    enabled: canManageBilling && showBillingMachinery,
  });
  const { data: invoices = [], isLoading: invoicesLoading } = useQuery({
    ...trpc.reviews.invoices.queryOptions({ brandId }),
    enabled: canManageBilling && showBillingMachinery,
  });

  const invalidate = () => {
    qc.invalidateQueries({
      queryKey: trpc.featureSubscriptions.myForBrand.queryKey(),
    });
    qc.invalidateQueries({ queryKey: trpc.reviews.entitlement.queryKey() });
  };

  const checkout = useMutation(
    trpc.featureSubscriptions.checkout.mutationOptions(),
  );
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

  // ── Card on file (Stripe Elements via SetupIntent) ───────────────────────
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
      qc.invalidateQueries({
        queryKey: trpc.shortLinks.paymentMethod.queryKey(),
      });
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
      toast("Reviews subscription isn't configured yet.");
      return;
    }
    // Explicit price acknowledgment before any charge: state the amount and the
    // card it will hit (or that Checkout will collect one).
    const rate =
      entitlement.unitAmount != null
        ? `${money(entitlement.unitAmount, entitlement.currency ?? 'AUD')}/month`
        : 'the current monthly rate';
    const ok = await confirm({
      title: 'Start the Reviews subscription?',
      description: card
        ? `You'll be charged ${rate}, billed to your saved card ${card.brand.toUpperCase()} •••• ${card.last4}. It renews monthly until cancelled from this page.`
        : `You'll be charged ${rate}, renewing monthly until cancelled from this page. You'll be taken to secure checkout to add a payment method.`,
      confirmLabel: `Subscribe · ${rate}`,
    });
    if (!ok) return;
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

  const unit = entitlement?.unitAmount;
  const currency = entitlement?.currency ?? 'AUD';
  const priceLabel = unit != null ? `${money(unit, currency)} / month` : null;

  let statusTitle = 'Trial ended';
  let statusSub = priceLabel
    ? `${priceLabel} to keep your pages live.`
    : 'Subscribe to keep capturing.';
  if (entitlement?.betaExempt) {
    statusTitle = 'Beta access, free';
    statusSub = 'Unlimited reviews during the beta.';
  } else if (entitlement?.entitled) {
    statusTitle = 'Subscribed';
    statusSub = 'Your review pages are live.';
  } else if (entitlement?.trialActive) {
    statusTitle = `${num(entitlement.trialRemaining)} of ${num(entitlement.trialLimit)} free reviews left`;
    statusSub = priceLabel
      ? `${priceLabel} when your trial ends.`
      : 'Subscribe before the trial ends.';
  }

  const canSubscribe =
    !!entitlement && !entitlement.betaExempt && !entitlement.entitled;

  if (isLoading) {
    return (
      <>
        <div className="vpagehead">
          <h1>Billing</h1>
        </div>
        <SkeletonRows rows={3} />
      </>
    );
  }

  return (
    <>
      <div className="vpagehead">
        <div>
          <h1>Billing</h1>
          <p>Billed through Prodesk · Stripe.</p>
        </div>
      </div>

      <div className="vcard" style={{ marginBottom: 16 }}>
        <div className="veyebrow" style={{ marginBottom: 8 }}>
          Status
        </div>
        <div
          style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}
        >
          {statusTitle}
        </div>
        <div className="vmuted" style={{ marginTop: 4, fontSize: 14 }}>
          {statusSub}
        </div>

        {canSubscribe ? (
          canManageBilling ? (
            <button
              className="vbtn vbtn-primary"
              style={{ marginTop: 16 }}
              disabled={checkout.isPending}
              onClick={subscribe}
            >
              Subscribe
            </button>
          ) : (
            <div className="vmuted" style={{ marginTop: 12, fontSize: 13 }}>
              Billing is managed by the brand owner.
            </div>
          )
        ) : null}
      </div>

      {entitlement?.entitled && !entitlement.betaExempt && sub ? (
        <div className="vcard" style={{ marginBottom: 16 }}>
          <div className="vrow-between">
            <div className="veyebrow">Your plan</div>
            <span className="vbadge">{sub.status}</span>
          </div>
          <div className="vmuted" style={{ marginTop: 10, fontSize: 14 }}>
            {sub.cancelAtPeriodEnd
              ? sub.currentPeriodEnd
                ? `Cancels on ${fmtDate(sub.currentPeriodEnd)}.`
                : 'Cancels at the end of this period.'
              : sub.currentPeriodEnd
                ? `Renews on ${fmtDate(sub.currentPeriodEnd)}.`
                : 'Active.'}
          </div>
          {canManageBilling ? (
            <div style={{ marginTop: 16 }}>
              {sub.cancelAtPeriodEnd ? (
                <button
                  className="vbtn vbtn-primary vbtn-sm"
                  disabled={resume.isPending}
                  onClick={() => resume.mutate({ subscriptionId: sub.id })}
                >
                  Resume subscription
                </button>
              ) : (
                <button
                  className="vbtn vbtn-quiet vbtn-sm"
                  disabled={cancel.isPending}
                  onClick={async () => {
                    if (
                      await confirm({
                        title: 'Cancel subscription?',
                        description:
                          'It cancels at the end of this period. Your pages stay live until then.',
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
          ) : (
            <div className="vmuted" style={{ marginTop: 12, fontSize: 13 }}>
              Billing is managed by the brand owner.
            </div>
          )}
        </div>
      ) : null}

      {/* Card on file — owner/payments only. Beta brands never get billed. */}
      {showBillingMachinery && canManageBilling ? (
        <div className="vcard" style={{ marginBottom: 16 }}>
          <div className="veyebrow" style={{ marginBottom: 10 }}>
            Card on file
          </div>
          {card ? (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span
                  style={{
                    border: '1px solid var(--v-line)',
                    borderRadius: 6,
                    padding: '5px 10px',
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: 'capitalize',
                  }}
                >
                  {card.brand}
                </span>
                <span style={{ fontSize: 13 }}>···· {card.last4}</span>
                <span className="vmuted" style={{ fontSize: 12 }}>
                  {String(card.expMonth).padStart(2, '0')}/
                  {String(card.expYear).slice(-2)}
                </span>
              </div>
              <button
                className="vbtn vbtn-quiet vbtn-sm"
                style={{ marginTop: 14 }}
                disabled={createSetupIntent.isPending}
                onClick={openCardForm}
              >
                {createSetupIntent.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Update card
              </button>
            </>
          ) : (
            <>
              <p className="vmuted" style={{ margin: 0, fontSize: 13 }}>
                No card yet. Add one so renewals go through without a hitch.
              </p>
              <button
                className="vbtn vbtn-primary vbtn-sm"
                style={{ marginTop: 14 }}
                disabled={createSetupIntent.isPending}
                onClick={openCardForm}
              >
                {createSetupIntent.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : null}
                Add card
              </button>
            </>
          )}
        </div>
      ) : null}

      {/* Plan summary — what the subscription includes; price comes from the offer. */}
      {showBillingMachinery && (priceLabel || entitlement?.priceId) ? (
        <div className="vcard" style={{ marginBottom: 16 }}>
          <div className="veyebrow" style={{ marginBottom: 8 }}>
            Plan summary
          </div>
          <div style={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
            Verdiict — standard plan
          </div>
          <p
            className="vmuted"
            style={{ marginTop: 4, marginBottom: 14, fontSize: 13 }}
          >
            {priceLabel
              ? `One brand-level subscription at ${priceLabel} covers everything below.`
              : 'One brand-level subscription covers everything below.'}
          </p>
          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            {PLAN_FEATURES.map((feat) => (
              <li
                key={feat}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                }}
              >
                <Check
                  size={15}
                  style={{ color: 'var(--v-accent)', flexShrink: 0 }}
                />
                <span>{feat}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Referrals — share code / redeem; free months settle as Stripe credit.
          Beta users can still share (their friend gets a month) but redeeming is
          pointless for them: they never activate a paid subscription. */}
      <ReferralCard
        canRedeem={user?.role === 'brandOwner' && !entitlement?.betaExempt}
      />

      {/* Invoices — reviews subscription only, owner/payments only. */}
      {showBillingMachinery && canManageBilling ? (
        <div className="vcard" style={{ marginBottom: 16 }}>
          <div className="veyebrow" style={{ marginBottom: 10 }}>
            Invoices
          </div>
          {invoicesLoading ? (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                padding: '18px 0',
              }}
            >
              <Loader2
                size={18}
                className="animate-spin"
                style={{ color: 'var(--v-muted)' }}
              />
            </div>
          ) : invoices.length === 0 ? (
            <p className="vmuted" style={{ margin: 0, fontSize: 13 }}>
              No invoices yet. They’ll appear here once your subscription starts
              billing.
            </p>
          ) : (
            <table className="vtable">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td style={{ fontSize: 13 }}>{inv.number}</td>
                    <td>
                      {fmtDate(inv.periodStart ?? inv.created ?? new Date())}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {money(inv.amount, inv.currency)}
                    </td>
                    <td>
                      <span className="vbadge">
                        {inv.status === 'paid' ? 'Paid' : inv.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {inv.pdfUrl ? (
                        <a
                          className="vbtn vbtn-quiet vbtn-sm"
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Download invoice"
                        >
                          <Download size={13} />
                        </a>
                      ) : inv.hostedUrl ? (
                        <a
                          className="vbtn vbtn-quiet vbtn-sm"
                          href={inv.hostedUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="View invoice"
                        >
                          <ExternalLink size={13} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}

      <p
        className="vmuted"
        style={{ textAlign: 'center', fontSize: 12, marginTop: 24 }}
      >
        Need help with billing?{' '}
        <a
          href="/support"
          onClick={(e) => {
            e.preventDefault();
            navigate('/support');
          }}
          style={{
            color: 'inherit',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          Contact support
        </a>
        .
      </p>

      {setupSecret && STRIPE_PUBLISHABLE_KEY ? (
        <Modal
          title="Card details"
          onClose={() => setSetupSecret(null)}
          width={460}
        >
          <StripeCardSetup
            publishableKey={STRIPE_PUBLISHABLE_KEY}
            clientSecret={setupSecret}
            submitClassName="vbtn vbtn-primary"
            submitLabel="Save card"
            onSaved={onCardSaved}
            onError={(m) => toast(m)}
          />
        </Modal>
      ) : null}
    </>
  );
}
