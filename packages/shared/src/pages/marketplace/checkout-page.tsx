import { useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { formatCurrency } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Button } from '../../components/ui/button';
import { Card, CardContent } from '../../components/ui/card';
import { Badge } from '../../components/ui/badge';
import { CartProvider, useCart } from './cart-store';
import { computeSubtotals, computePayInFull, computePaymentPlan, priceLine } from './pricing';
import { reserveNewTab } from '../../lib/redirect';
import type { PaymentPlan } from './types';

/**
 * Marketplace checkout: itemised cart + billing sidebar with pay-in-full /
 * payment-plan chips, recurring (weekly) breakdown, and "Complete purchase".
 * Ports checkout_screen.dart + checkout_billing_sidebar.dart.
 */
export function MarketplaceCheckoutPage() {
  const { brandId } = useActiveContext();
  return (
    <CartProvider brandId={brandId}>
      <CheckoutInner brandId={brandId} />
    </CartProvider>
  );
}

function CheckoutInner({ brandId }: { brandId: string | null }) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const cart = useCart();
  const [planIdx, setPlanIdx] = useState(-1); // -1 = pay in full

  const plansQuery = useQuery(trpc.marketplace.paymentPlans.queryOptions());
  const plans = (plansQuery.data ?? []) as PaymentPlan[];

  const subtotals = useMemo(() => computeSubtotals(cart.lines), [cart.lines]);
  const selectedPlan = planIdx === -1 ? null : plans[planIdx];
  const breakdown = selectedPlan ? computePaymentPlan(subtotals, selectedPlan) : computePayInFull(subtotals);

  const checkout = useMutation({
    ...trpc.purchases.checkoutServices.mutationOptions(),
    onError: (e) => toastError(e),
  });

  const submit = () => {
    if (!brandId) return toast.error('Select a brand to purchase');
    // Reserve the Stripe tab against this click so the popup blocker allows it.
    const tab = reserveNewTab();
    checkout.mutate(
      {
        brandId,
        items: cart.lines.map((l) => ({
          serviceId: l.service.id,
          quantity: l.quantity,
          packageId: l.packageId,
          packageName: l.packageName,
          selectedVariantId: l.selectedVariantId,
          selectedOptions: l.selectedOptions,
          selectedAddons: l.selectedAddons,
        })),
        selectedPaymentPlan: selectedPlan,
        successUrl: `${window.location.origin}/payment-success`,
        cancelUrl: `${window.location.origin}/payment-cancel`,
      },
      {
        onSuccess: (res) => {
          // NEVER clear the cart here — it is cleared on /payment-success only
          // once the Stripe webhook confirms the purchase. Always send the buyer
          // to Stripe (in the reserved tab); fall back to the in-app success page
          // when Stripe isn't configured (dev) and the purchase auto-fulfils.
          if (res.checkoutUrl) tab.go(res.checkoutUrl);
          else {
            tab.cancel();
            navigate(`/payment-success?purchaseId=${res.purchaseId}`);
          }
        },
        onError: () => tab.cancel(),
      },
    );
  };

  if (cart.lines.length === 0) {
    return (
      <div>
        <PageHeader title="Checkout" />
        <EmptyState
          icon={ShoppingCart}
          title="Your cart is empty"
          description="Add services from the marketplace first."
          action={<Button variant="accent" onClick={() => navigate('/marketplace')}>Browse marketplace</Button>}
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Checkout" description="Review your order and choose how to pay." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Items */}
        <div className="space-y-3">
          {cart.lines.map((l) => {
            const p = priceLine(l);
            const weekly = p.recurringWeekly > 0;
            return (
              <Card key={l.key}>
                <CardContent className="flex items-center gap-3 p-4">
                  {l.service.imageUrl ? (
                    <img src={l.service.imageUrl} alt="" className="h-14 w-14 rounded-[var(--radius-sm)] object-cover" />
                  ) : (
                    <div className="h-14 w-14 rounded-[var(--radius-sm)] bg-inset" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-ink-100">{l.service.name}</span>
                      {l.packageName && <Badge variant="accent">{l.packageName}</Badge>}
                      {weekly && <Badge variant="muted">recurring</Badge>}
                    </div>
                    <p className="text-xs text-ink-40">{l.service.agencyName} · qty {l.quantity}</p>
                  </div>
                  <span className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums text-ink-80">
                    {formatCurrency(p.oneOff + p.recurringUpfront)}
                    {weekly && <span className="block text-xs text-ink-40">+{formatCurrency(p.recurringWeekly)}/wk</span>}
                  </span>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Billing sidebar */}
        <Card className="h-fit">
          <CardContent className="space-y-4 p-4 md:p-5">
            <h3 className="font-semibold text-ink-100">Billing summary</h3>

            {subtotals.oneOffSubtotal > 0 && <Row label="One-off subtotal" value={formatCurrency(subtotals.oneOffSubtotal)} />}
            {subtotals.recurringUpfrontTotal > 0 && <Row label="Recurring setup" value={formatCurrency(subtotals.recurringUpfrontTotal)} />}
            {subtotals.recurringWeeklyTotal > 0 && <Row label="Recurring weekly" value={`${formatCurrency(subtotals.recurringWeeklyTotal)}/wk`} />}

            {/* Payment plan chips (only meaningful for one-off spend). */}
            {subtotals.oneOffSubtotal > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-ink-80">Payment plan</p>
                <div className="flex flex-wrap gap-1.5">
                  <PlanChip active={planIdx === -1} onClick={() => setPlanIdx(-1)}>Pay in full</PlanChip>
                  {plans.map((p, i) => (
                    <PlanChip key={p.id ?? i} active={planIdx === i} onClick={() => setPlanIdx(i)}>
                      {p.name} · {p.durationWeeks}wk
                    </PlanChip>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1 border-t border-[color:var(--color-border-hairline)] pt-3">
              <Row label="Due today" value={formatCurrency(breakdown.upfront)} bold />
              {breakdown.weeklyDuring > 0 && (
                <Row
                  label={breakdown.durationWeeks ? `Weekly × ${breakdown.durationWeeks}` : 'Weekly'}
                  value={`${formatCurrency(breakdown.weeklyDuring)}/wk`}
                />
              )}
              {breakdown.durationWeeks && breakdown.weeklyAfter !== breakdown.weeklyDuring && breakdown.weeklyAfter > 0 && (
                <Row label="Weekly after plan" value={`${formatCurrency(breakdown.weeklyAfter)}/wk`} />
              )}
            </div>

            <Button variant="accent" className="w-full" onClick={submit} disabled={checkout.isPending}>
              {checkout.isPending ? 'Processing…' : 'Complete purchase'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold text-ink-100' : 'text-ink-60'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function PlanChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-accent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset'}`}
    >
      {children}
    </button>
  );
}
