/**
 * StripePaymentForm — Stripe Elements card form for proposal payment.
 * Wraps the PaymentElement from @stripe/react-stripe-js.
 */
import { useState, useEffect } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useMutation } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { STRIPE_PUBLISHABLE_KEY } from "@shared/lib/env";

// ─── Stripe instance (singleton) ──────────────────────────────────────────────
let stripePromise: ReturnType<typeof loadStripe> | null = null;
function getStripePromise() {
  if (!stripePromise) {
    const key = STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.warn("[Stripe] VITE_STRIPE_PUBLISHABLE_KEY not set");
      return null;
    }
    stripePromise = loadStripe(key);
  }
  return stripePromise;
}

// ─── Inner form (must be inside <Elements>) ────────────────────────────────────
function CheckoutForm({
  slug,
  onSuccess,
}: {
  slug: string;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const trpc = useTRPC();
  const confirmMutation = useMutation({
    ...trpc.payments.payments.confirmPayment.mutationOptions(),
    onSuccess: () => {
      setSubmitting(false);
      onSuccess();
    },
    onError: (err) => {
      setErrorMsg(err.message);
      setSubmitting(false);
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMsg(null);

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      setErrorMsg(error.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      confirmMutation.mutate({ slug, paymentIntentId: paymentIntent.id });
    } else {
      setErrorMsg("Payment did not complete. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PaymentElement
        options={{
          layout: "tabs",
          fields: { billingDetails: { email: "auto" } },
        }}
      />
      {errorMsg && (
        <div style={{
          padding: "10px 14px",
          borderRadius: 8,
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)",
          color: "#ef4444",
          fontSize: 13,
        }}>
          {errorMsg}
        </div>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="btn-prop primary"
        style={{ padding: "14px 22px", opacity: submitting ? 0.7 : 1 }}
      >
        {submitting ? "Processing…" : "Confirm & pay"}
      </button>
      <p style={{ fontSize: 11, opacity: 0.45, textAlign: "center", margin: 0 }}>
        Secured by Stripe · Card data never touches EziQuotes
      </p>
    </form>
  );
}

// ─── Outer wrapper: fetches client_secret and mounts Elements ─────────────────
export function StripePaymentForm({
  slug,
  onSuccess,
  theme,
}: {
  slug: string;
  onSuccess: () => void;
  theme: string;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const trpc = useTRPC();
  const createPIMutation = useMutation({
    ...trpc.payments.payments.createPaymentIntent.mutationOptions(),
    onSuccess: (data) => setClientSecret(data.clientSecret),
    onError: (err) => setLoadError(err.message),
  });

  useEffect(() => {
    createPIMutation.mutate({ slug });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const stripePromise = getStripePromise();

  if (loadError) {
    return (
      <div style={{ padding: "16px", color: "#ef4444", fontSize: 13 }}>
        Could not initialise payment: {loadError}
      </div>
    );
  }

  if (!clientSecret || !stripePromise) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0", opacity: 0.6 }}>
        <div style={{
          width: 20, height: 20, borderRadius: "50%",
          border: "2px solid currentColor",
          borderTopColor: "transparent",
          animation: "spin 600ms linear infinite",
        }} />
        <span style={{ fontSize: 13 }}>Preparing payment…</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const appearance: import("@stripe/stripe-js").Appearance = {
    theme: theme === "digital" ? "night" : "stripe",
    variables: {
      colorPrimary: theme === "digital" ? "#65F5C9" : theme === "luxury" ? "#B8860B" : "#1A1A1A",
      borderRadius: "8px",
      fontFamily: theme === "luxury" ? "'Cormorant Garamond', serif" : "inherit",
    },
  };

  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
      <CheckoutForm slug={slug} onSuccess={onSuccess} />
    </Elements>
  );
}
