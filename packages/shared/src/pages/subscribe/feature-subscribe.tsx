import { useMemo, useState } from 'react';
import { useRoute, useSearch, useLocation, Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Sparkles, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { checkoutReturnUrls } from '../../lib/url';
import { useTRPC } from '../../lib/trpc';
import { useActiveContext } from '../../hooks/use-active-context';
import { cn, formatCurrency } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { EmptyState } from '../../components/layout/empty-state';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';

const intervalLabel = (i: 'week' | 'month') => (i === 'week' ? '/wk' : '/mo');
const intervalWord = (i: 'week' | 'month') => (i === 'week' ? 'Weekly' : 'Monthly');

/**
 * Feature Subscription subscribe view (/subscribe/:slug). Shows the product's
 * plan + price and starts a Stripe Checkout for the brand (attaching to the brand
 * owner). Reached from the in-thread upsell card's "Generate my strategy" button.
 */
export function FeatureSubscribePage() {
  const [, params] = useRoute('/subscribe/:slug');
  const slug = params?.slug;
  const search = useSearch();
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { brandId: activeBrandId } = useActiveContext();

  // Brand the subscription is bought for: explicit ?brandId wins (from the AI
  // thread), else the active brand.
  const brandId = new URLSearchParams(search).get('brandId') || activeBrandId || undefined;

  const catalog = useQuery(trpc.featureSubscriptions.catalog.queryOptions());
  const product = useMemo(
    () => catalog.data?.find((p) => p.slug === slug) ?? null,
    [catalog.data, slug],
  );

  // All active prices across the product's tiers (Growth Strategy: one monthly).
  const priceOptions = useMemo(() => {
    if (!product) return [];
    return product.tiers.flatMap((t) =>
      t.prices.map((pr) => ({
        priceId: pr.id,
        tierName: t.name,
        interval: pr.interval as 'week' | 'month',
        amount: Number(pr.amount),
        currency: pr.currency,
      })),
    );
  }, [product]);

  const [selected, setSelected] = useState<string | null>(null);
  const selectedPrice =
    priceOptions.find((p) => p.priceId === selected) ??
    priceOptions.find((p) => p.interval === 'month') ??
    priceOptions[0] ??
    null;

  const checkout = useMutation({
    ...trpc.featureSubscriptions.checkout.mutationOptions(),
    onSuccess: (res) => {
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      // Dev (no Stripe) or already-active: entitlement is live now.
      qc.invalidateQueries();
      toast.success(res.status === 'already_active' ? 'You already have this subscription' : 'Subscribed!');
      navigate('/chat?sub=success');
    },
    onError: (e) => toastError(e),
  });

  if (catalog.isLoading) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!product || !selectedPrice) {
    return (
      <div className="mx-auto max-w-xl">
        <EmptyState icon={Sparkles} title="Subscription unavailable" description="This subscription isn't available right now." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl">
      <Link href="/chat" className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-60 hover:text-ink-100">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <PageHeader title={product.name} description={product.description ?? undefined} />

      <Card className="space-y-5 p-6">
        {/* Price */}
        <div>
          <p className="text-3xl font-semibold tabular-nums text-ink-100">
            {formatCurrency(selectedPrice.amount)}
            <span className="text-base font-normal text-ink-40"> {intervalLabel(selectedPrice.interval)}</span>
          </p>
          <p className="mt-1 text-sm text-ink-60">
            {product.tiers[0]?.name ? `${product.tiers[0].name} plan · ` : ''}
            {intervalWord(selectedPrice.interval)} billing
          </p>
        </div>

        {/* Tier features (if any) */}
        {product.tiers[0]?.features?.length ? (
          <ul className="space-y-1.5">
            {product.tiers[0].features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-ink-80">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> {f}
              </li>
            ))}
          </ul>
        ) : null}

        {/* Interval picker (only when more than one price is offered) */}
        {priceOptions.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {priceOptions.map((p) => (
              <button
                key={p.priceId}
                onClick={() => setSelected(p.priceId)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  p.priceId === selectedPrice.priceId
                    ? 'border-accent bg-accent/12 text-accent'
                    : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset',
                )}
              >
                {formatCurrency(p.amount)} {intervalLabel(p.interval)}
              </button>
            ))}
          </div>
        )}

        <Button
          variant="accent"
          size="lg"
          className="w-full"
          disabled={checkout.isPending || !brandId}
          onClick={() => brandId && checkout.mutate({ brandId, priceId: selectedPrice.priceId, ...checkoutReturnUrls() })}
        >
          {checkout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {product.cardButtonLabel || 'Subscribe'}
        </Button>
        {!brandId && <p className="text-center text-xs text-ink-40">Select a brand to subscribe.</p>}
      </Card>
    </div>
  );
}
