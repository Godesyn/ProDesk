import { useEffect, useRef } from 'react';
import { useRoute, useLocation, useSearch, Link } from 'wouter';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { clearCartStorage } from './marketplace/cart-store';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

/** Kicks off payment for an existing purchase, redirecting to Stripe if configured. */
export function CheckoutPage() {
  const [, params] = useRoute('/checkout/:id');
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const started = useRef(false);

  const checkout = useMutation({
    ...trpc.purchases.checkoutPurchase.mutationOptions(),
    onSuccess: (res) => {
      if (res.checkoutUrl) window.location.href = res.checkoutUrl;
      else navigate(`/payment-success?purchaseId=${res.purchaseId}`);
    },
    onError: (e) => toastError(e),
  });

  useEffect(() => {
    if (params?.id && !started.current) {
      started.current = true;
      checkout.mutate({
        id: params.id,
        successUrl: `${window.location.origin}/payment-success`,
        cancelUrl: `${window.location.origin}/payment-cancel`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params?.id]);

  return <div className="grid min-h-[50vh] place-items-center text-ink-40">Starting checkout…</div>;
}

/**
 * Payment result landing. On success, polls the purchase until projects are
 * fulfilled, then forwards to the post-checkout brief stepper. Ports
 * payment_success_screen.dart (status-aware, then routes to the stepper).
 */
export function PaymentResultPage({ success }: { success: boolean }) {
  const [, navigate] = useLocation();
  const searchStr = useSearch();
  const purchaseId = new URLSearchParams(searchStr).get('purchaseId') ?? '';
  const trpc = useTRPC();
  const { brandId } = useActiveContext();

  const poll = useQuery({
    ...trpc.marketplace.briefProjects.queryOptions({ purchaseId }),
    enabled: success && !!purchaseId,
    refetchInterval: (q) => (q.state.data?.ready ? false : 1500),
  });

  // The cart is emptied HERE — and only here — once the purchase is confirmed
  // (briefProjects.ready flips true after the Stripe webhook fulfils it). This is
  // why "Checkout" never clears the cart: an abandoned/declined payment leaves it
  // intact. The CartProvider in any other tab syncs via its `storage` listener.
  useEffect(() => {
    if (success && purchaseId && poll.data?.ready) clearCartStorage(brandId);
  }, [success, purchaseId, poll.data?.ready, brandId]);

  // Once fulfilled, hand off to the brief stepper (which itself skips to
  // projects when no briefs are required).
  useEffect(() => {
    if (success && purchaseId && poll.data?.ready) {
      navigate(`/post-checkout/${purchaseId}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [success, purchaseId, poll.data?.ready]);

  const verifying = success && !!purchaseId && !poll.data?.ready;

  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="w-full max-w-md text-center">
        <CardContent className="flex flex-col items-center gap-3 p-8">
          {verifying ? (
            <Loader2 className="h-12 w-12 animate-spin text-accent" />
          ) : success ? (
            <CheckCircle2 className="h-12 w-12 text-success" />
          ) : (
            <XCircle className="h-12 w-12 text-danger" />
          )}
          <h2 className="text-xl font-semibold">
            {verifying ? 'Verifying payment…' : success ? 'Payment successful' : 'Payment cancelled'}
          </h2>
          <p className="text-sm text-ink-60">
            {verifying
              ? 'Setting up your projects. This only takes a moment.'
              : success
                ? 'Your projects are being set up.'
                : 'No charge was made.'}
          </p>
          {!verifying && (
            <Button asChild variant="accent">
              <Link href="/brand-projects">Go to projects</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
