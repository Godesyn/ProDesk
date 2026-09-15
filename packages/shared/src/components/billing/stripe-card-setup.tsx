/* Reusable Stripe Elements card capture, driven by a SetupIntent. The parent
 * fetches a SetupIntent client secret + the publishable key (server-side), renders
 * this, and gets the resulting payment-method id back via `onSaved` so it can set
 * it as the customer's default. Provider-agnostic styling: the submit button takes
 * a className so it can match the host app's buttons. */
import { useMemo, useState, type FormEvent } from 'react';
// '/pure' defers Stripe.js injection until loadStripe() is actually called —
// the root '@stripe/stripe-js' entry loads it on import, putting Stripe's
// fraud-detection iframes/beacons on every page of any app that bundles this.
import { loadStripe } from '@stripe/stripe-js/pure';
import type { Stripe, Appearance } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

// loadStripe must be called once per publishable key (it injects a script tag).
const promiseCache = new Map<string, Promise<Stripe | null>>();
function stripePromise(pk: string): Promise<Stripe | null> {
  let p = promiseCache.get(pk);
  if (!p) {
    p = loadStripe(pk);
    promiseCache.set(pk, p);
  }
  return p;
}

function CardForm({
  onSaved,
  onError,
  submitClassName,
  submitLabel,
}: {
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  onError: (message: string) => void;
  submitClassName: string;
  submitLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      redirect: 'if_required',
    });
    if (error) {
      setBusy(false);
      onError(error.message ?? 'Could not save card.');
      return;
    }
    const pm = setupIntent?.payment_method;
    const pmId = typeof pm === 'string' ? pm : (pm?.id ?? null);
    if (!pmId) {
      setBusy(false);
      onError('Card was not saved. Please try again.');
      return;
    }
    await onSaved(pmId);
    setBusy(false);
  }

  return (
    <form
      onSubmit={submit}
      style={{ display: 'flex', flexDirection: 'column', gap: 16 }}
    >
      <PaymentElement options={{ layout: 'tabs' }} />
      <button
        type="submit"
        className={submitClassName}
        disabled={!stripe || busy}
        style={{ alignSelf: 'flex-start' }}
      >
        {busy ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}

export function StripeCardSetup({
  publishableKey,
  clientSecret,
  onSaved,
  onError,
  submitClassName = '',
  submitLabel = 'Save card',
  appearance,
}: {
  publishableKey: string;
  clientSecret: string;
  onSaved: (paymentMethodId: string) => void | Promise<void>;
  onError: (message: string) => void;
  submitClassName?: string;
  submitLabel?: string;
  appearance?: Appearance;
}) {
  const stripe = useMemo(() => stripePromise(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripe} options={{ clientSecret, appearance }}>
      <CardForm
        onSaved={onSaved}
        onError={onError}
        submitClassName={submitClassName}
        submitLabel={submitLabel}
      />
    </Elements>
  );
}
