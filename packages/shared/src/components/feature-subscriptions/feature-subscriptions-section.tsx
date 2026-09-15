import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, CheckCircle2, Ban, CalendarClock } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { checkoutReturnUrls } from '../../lib/url';
import { useTRPC } from '../../lib/trpc';
import { cn, formatCurrency, formatDate } from '../../lib/utils';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { useConfirm } from '../ui/confirm-dialog';
import { GrowthUpsellCard } from './growth-upsell-card';

const intervalLabel = (i: 'week' | 'month') => (i === 'week' ? '/wk' : '/mo');

/**
 * "Prodesk Subscriptions" — the Feature Subscriptions held by the brand's OWNER,
 * shown on the brand Subscriptions tab. Distinct from the marketplace recurring
 * services listed by BrandSubscriptionsView. Renders nothing when the owner has
 * none, so it doesn't clutter the page.
 */
export function FeatureSubscriptionsSection({
  brandId,
  featureKey,
}: {
  brandId: string;
  featureKey?: string;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const input = { brandId };
  const q = useQuery(trpc.featureSubscriptions.myForBrand.queryOptions(input));

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: trpc.featureSubscriptions.myForBrand.queryKey(input),
    });

  const cancel = useMutation({
    ...trpc.featureSubscriptions.cancel.mutationOptions(),
    onSuccess: () => {
      toast.success('Subscription scheduled for cancellation');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  const resume = useMutation({
    ...trpc.featureSubscriptions.resume.mutationOptions(),
    onSuccess: () => {
      toast.success('Subscription resumed');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  const onCancel = async (s: {
    id: string;
    productName: string;
    currentPeriodEnd: string | null;
  }) => {
    const ok = await confirm({
      title: 'Cancel this subscription?',
      description: s.currentPeriodEnd
        ? `You'll keep access to ${s.productName} until ${formatDate(s.currentPeriodEnd)} and won't be charged again. After that the feature locks. You can resume any time before then.`
        : `You'll keep access to ${s.productName} until the end of the current billing period and won't be charged again. After that the feature locks. You can resume any time before then.`,
      confirmLabel: 'Cancel subscription',
      cancelLabel: 'Keep subscription',
      destructive: true,
    });
    if (ok) cancel.mutate({ subscriptionId: s.id });
  };

  const onResume = async (s: { id: string; productName: string }) => {
    const ok = await confirm({
      title: 'Resume this subscription?',
      description: `${s.productName} will stay active and billing will continue as normal. The scheduled cancellation will be cancelled.`,
      confirmLabel: 'Resume subscription',
      cancelLabel: 'Keep cancelling',
    });
    if (ok) resume.mutate({ subscriptionId: s.id });
  };

  // When scoped to a feature, show every subscription that unlocks it (there may
  // be more than one product granting the same feature).
  const subs = (q.data?.subscriptions ?? []).filter(
    (s) => !featureKey || s.featureKeys?.includes(featureKey),
  );
  if (q.isLoading || subs.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink-100">
          Prodesk Subscriptions
        </h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {subs.map((s) => {
          const cancelled = s.status === 'canceled';
          return (
            <Card
              key={s.id}
              className={cn(
                'flex flex-col gap-3 p-4',
                cancelled && 'opacity-70',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-full',
                    cancelled
                      ? 'bg-inset text-ink-40'
                      : 'bg-accent/12 text-accent',
                  )}
                >
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-100">
                    {s.productName}
                  </p>
                  {s.tierName && (
                    <p className="mt-0.5 truncate text-xs text-ink-40">
                      {s.tierName}
                    </p>
                  )}
                </div>
                {cancelled ? (
                  <Badge variant="danger">
                    <Ban className="mr-1 h-3 w-3" /> Cancelled
                  </Badge>
                ) : s.status === 'past_due' || s.status === 'unpaid' ? (
                  <Badge variant="warn">Past due</Badge>
                ) : (
                  <Badge variant="success">
                    <CheckCircle2 className="mr-1 h-3 w-3" /> Active
                  </Badge>
                )}
              </div>

              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xl font-semibold tabular-nums text-ink-100">
                    {formatCurrency(s.amount)}
                    <span className="text-sm font-normal text-ink-40">
                      {' '}
                      {intervalLabel(s.interval)}
                    </span>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-40">
                    {cancelled ? (
                      <>Cancelled {formatDate(s.canceledAt)}</>
                    ) : s.cancelAtPeriodEnd && s.currentPeriodEnd ? (
                      <>Ends {formatDate(s.currentPeriodEnd)}</>
                    ) : s.currentPeriodEnd ? (
                      <>
                        <CalendarClock className="h-3 w-3" /> Renews{' '}
                        {formatDate(s.currentPeriodEnd)}
                      </>
                    ) : (
                      <>Recurring</>
                    )}
                  </p>
                </div>
                {s.active && !s.cancelAtPeriodEnd && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() => onCancel(s)}
                  >
                    Cancel
                  </Button>
                )}
                {s.cancelAtPeriodEnd && (
                  <Button
                    size="sm"
                    variant="accent"
                    disabled={resume.isPending}
                    onClick={() => onResume(s)}
                  >
                    Resume
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/** First active price for a catalog product (prefers the lowest tier's monthly). */
function defaultCatalogPrice(product: {
  tiers: {
    prices: {
      id: string;
      interval: 'week' | 'month';
      amount: string | number;
      currency: string;
    }[];
  }[];
}) {
  for (const tier of product.tiers) {
    const price =
      tier.prices.find((p) => p.interval === 'month') ?? tier.prices[0];
    if (price) {
      return {
        priceId: price.id,
        amount: Number(price.amount),
        interval: price.interval,
        currency: price.currency,
      };
    }
  }
  return null;
}

/**
 * "Explore feature subscriptions" — the full catalogue of Feature Subscriptions
 * we sell, shown at the END of the brand Subscriptions page as the same marketing
 * card layout used in the AI thread. Products the brand owner already has are
 * filtered out. Clicking a card starts Stripe Checkout and redirects to Stripe.
 */
export function ExploreFeatureSubscriptions({
  brandId,
  featureKey,
}: {
  brandId: string;
  featureKey?: string;
}) {
  const trpc = useTRPC();
  const catalogQ = useQuery(trpc.featureSubscriptions.catalog.queryOptions());
  const mineQ = useQuery(
    trpc.featureSubscriptions.myForBrand.queryOptions({ brandId }),
  );

  const checkout = useMutation({
    ...trpc.featureSubscriptions.checkout.mutationOptions(),
    onSuccess: (res) => {
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      toast.success(
        res.status === 'already_active'
          ? 'You already have this subscription'
          : 'Subscribed!',
      );
    },
    onError: (e) => toastError(e),
  });

  if (catalogQ.isLoading) return null;

  // Hide products the owner is already actively subscribed to — "Explore" shows
  // what they can still add.
  const owned = new Set(
    (mineQ.data?.subscriptions ?? [])
      .filter((s) => s.active)
      .map((s) => s.productId),
  );
  const grantsFeature = (p: {
    featureKey: string;
    featureKeys?: string[] | null;
  }) =>
    !featureKey ||
    p.featureKey === featureKey ||
    (p.featureKeys ?? []).includes(featureKey);
  const products = (catalogQ.data ?? []).filter(
    (p) => !owned.has(p.id) && grantsFeature(p),
  );
  if (products.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent" />
        <h2 className="text-sm font-semibold text-ink-100">
          Explore feature subscriptions
        </h2>
      </div>
      <div className="flex flex-wrap gap-4">
        {products.map((p) => {
          const price = defaultCatalogPrice(p);
          return (
            <GrowthUpsellCard
              key={p.id}
              padded={false}
              loading={checkout.isPending}
              product={{
                cardTitle: p.cardTitle,
                cardSubtitle: p.cardSubtitle,
                cardDescription: p.cardDescription,
                cardButtonLabel: p.cardButtonLabel,
                amount: price?.amount ?? null,
                interval: price?.interval ?? null,
                currency: price?.currency ?? null,
              }}
              onSubscribe={() => {
                if (price) checkout.mutate({ brandId, priceId: price.priceId, ...checkoutReturnUrls() });
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
