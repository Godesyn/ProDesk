import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { useTRPC } from "@shared/lib/trpc";
import { STRIPE_PUBLISHABLE_KEY } from "@shared/lib/env";
import { useQuery, useMutation } from "@tanstack/react-query";

// ── Stripe loader ─────────────────────────────────────────────────────────────
// Guarded like StripePaymentForm: loadStripe("") throws at import and takes the whole app down.
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtAUD(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

// ── CH4 Catchup Success ───────────────────────────────────────────────────────
function CatchupSuccess({ totalCents, businessName }: { totalCents: number; businessName: string }) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0A0A0A", color: "#FAFAF9", position: "relative",
      overflow: "hidden", padding: "32px 22px 24px",
    }}>
      {/* Glow */}
      <div style={{
        position: "absolute", top: -80, left: "50%", transform: "translateX(-50%)",
        width: 400, height: 400, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(101,245,201,0.22), transparent 60%)",
        pointerEvents: "none",
      }} />
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, position: "relative" }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6, background: "#0F766E", color: "white",
          display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12,
        }}>iK</div>
        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>
          iKeep<span style={{ color: "#65F5C9" }}> · payments</span>
        </div>
      </div>
      {/* Success content */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        textAlign: "center", gap: 16, marginTop: 60, position: "relative",
      }}>
        <div style={{
          width: 80, height: 80, borderRadius: "50%", background: "#65F5C9",
          display: "grid", placeItems: "center", color: "#053D2A", position: "relative",
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-11" />
          </svg>
          <span style={{
            position: "absolute", inset: -8, borderRadius: "50%",
            border: "2px solid #65F5C9", opacity: 0.4,
          }} />
        </div>
        <div style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 11,
          letterSpacing: "0.16em", color: "rgba(250,250,249,0.6)",
        }}>
          PAID · {fmtAUD(totalCents)} · {timeStr}
        </div>
        <h1 style={{
          fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 40,
          letterSpacing: "-0.04em", lineHeight: 0.95, margin: 0,
        }}>
          You're{" "}
          <em style={{
            color: "#65F5C9", fontStyle: "italic",
            fontFamily: "Instrument Serif, serif", fontWeight: 400,
          }}>caught up.</em>
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "rgba(250,250,249,0.7)", maxWidth: 300 }}>
          Payment cleared for <b style={{ color: "#FAFAF9" }}>{businessName}</b>. You'll receive a receipt by email shortly.
        </p>
      </div>
      {/* Receipt strip */}
      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px",
          border: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: 6, fontSize: 12,
        }}>
          {[
            ["Amount paid", fmtAUD(totalCents)],
            ["Card", "•••• saved"],
            ["Time", timeStr],
          ].map(([label, val], i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "rgba(250,250,249,0.6)" }}>{label}</span>
              <span style={{ fontFamily: "IBM Plex Mono, monospace" }}>{val}</span>
            </div>
          ))}
        </div>
        <button
          onClick={() => window.close()}
          style={{
            background: "#65F5C9", color: "#053D2A", border: 0, borderRadius: 10,
            padding: "14px", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

// ── CH3 Card form (inside Elements) ──────────────────────────────────────────
function CardForm({
  totalCents,
  clientSecret,
  isDemo,
  onSuccess,
}: {
  totalCents: number;
  clientSecret: string;
  isDemo: boolean;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePay = async () => {
    if (isDemo) { onSuccess(); return; }
    if (!stripe || !elements) return;
    setLoading(true);
    setError(null);
    const card = elements.getElement(CardElement);
    if (!card) { setLoading(false); return; }
    const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: { card },
    });
    if (stripeError) {
      setError(stripeError.message ?? "Payment failed");
      setLoading(false);
      return;
    }
    if (paymentIntent?.status === "succeeded") {
      onSuccess();
    }
    setLoading(false);
  };

  return (
    <div style={{
      marginTop: "auto", background: "#141414", borderTopLeftRadius: 24, borderTopRightRadius: 24,
      padding: "24px 22px 32px", borderTop: "1px solid rgba(255,255,255,0.08)",
      boxShadow: "0 -20px 60px rgba(0,0,0,0.5)",
    }}>
      {/* Handle */}
      <div style={{ width: 36, height: 4, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto 18px" }} />
      <div style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, letterSpacing: "0.16em", color: "rgba(250,250,249,0.55)" }}>
        NEW CARD · ENCRYPTED BY STRIPE
      </div>
      <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 28, letterSpacing: "-0.03em", marginTop: 6 }}>
        Add a card to{" "}
        <em style={{ color: "#65F5C9", fontWeight: 300, fontFamily: "Instrument Serif, serif", fontStyle: "italic" }}>
          catch up.
        </em>
      </div>
      {/* Card element */}
      <div style={{ marginTop: 18 }}>
        {isDemo ? (
          <div style={{
            background: "#1C1C1A", borderRadius: 8, padding: "12px 14px",
            fontFamily: "IBM Plex Mono, monospace", fontSize: 14,
            border: "1px solid rgba(255,255,255,0.08)", color: "rgba(250,250,249,0.6)",
          }}>
            4242 4242 4242 4242 · 12/28 · 123 (demo)
          </div>
        ) : (
          <div style={{
            background: "#1C1C1A", borderRadius: 8, padding: "12px 14px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>
            <CardElement options={{
              style: {
                base: {
                  color: "#FAFAF9",
                  fontFamily: "IBM Plex Mono, monospace",
                  fontSize: "14px",
                  "::placeholder": { color: "rgba(250,250,249,0.4)" },
                },
                invalid: { color: "#F4A088" },
              },
            }} />
          </div>
        )}
      </div>
      {error && (
        <div style={{ marginTop: 10, color: "#F4A088", fontSize: 12, fontFamily: "IBM Plex Mono, monospace" }}>
          {error}
        </div>
      )}
      <button
        onClick={handlePay}
        disabled={loading}
        style={{
          width: "100%", marginTop: 18, background: loading ? "rgba(101,245,201,0.5)" : "#65F5C9",
          color: "#053D2A", border: 0, borderRadius: 10, padding: "14px",
          fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer",
          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          boxShadow: "0 0 32px rgba(101,245,201,0.25)",
        }}
      >
        {loading ? "Processing…" : `Confirm & pay ${fmtAUD(totalCents)} →`}
      </button>
      <div style={{
        marginTop: 12, fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
        letterSpacing: "0.1em", color: "rgba(250,250,249,0.45)", textAlign: "center",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 1l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z" />
        </svg>
        STRIPE · 256-BIT TLS · PCI DSS L1
      </div>
    </div>
  );
}

// ── CH2 Recovery landing ──────────────────────────────────────────────────────
function RecoveryLanding({
  totalCents,
  clientName,
  businessName,
  daysOverdue,
  clientSecret,
  isDemo,
  onSuccess,
}: {
  token: string;
  totalCents: number;
  clientName: string;
  businessName: string;
  daysOverdue: number;
  clientSecret: string;
  isDemo: boolean;
  onSuccess: () => void;
}) {
  const [showCard, setShowCard] = useState(false);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0A0A0A", color: "#FAFAF9", position: "relative", overflow: "hidden",
    }}>
      {/* Glow */}
      <div style={{
        position: "absolute", top: -60, right: -60, width: 300, height: 300, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(244,160,136,0.15), transparent 60%)",
        pointerEvents: "none",
      }} />
      {/* Header */}
      <div style={{ padding: "28px 16px 0", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6, background: "#0F766E", color: "white",
          display: "grid", placeItems: "center", fontWeight: 800, fontSize: 12,
        }}>iK</div>
        <div style={{ fontFamily: "Inter, sans-serif", fontWeight: 700, fontSize: 14, letterSpacing: "-0.02em" }}>
          iKeep<span style={{ color: "#65F5C9" }}> · payments</span>
        </div>
      </div>
      {/* Hero */}
      <div style={{ padding: "20px 16px 0" }}>
        <div style={{
          fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.18em",
          color: "#F4A088", fontWeight: 700,
        }}>
          OUTSTANDING · {daysOverdue} DAYS OVERDUE
        </div>
        <div style={{
          fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 56,
          letterSpacing: "-0.05em", lineHeight: 0.95, marginTop: 10,
        }}>
          {fmtAUD(totalCents)}<span style={{ fontSize: 18, color: "rgba(250,250,249,0.5)", marginLeft: 4 }}>AUD</span>
        </div>
        <div style={{ marginTop: 12, fontSize: 13, color: "rgba(250,250,249,0.75)", lineHeight: 1.55 }}>
          Hey {clientName} — your <b style={{ color: "#65F5C9" }}>{businessName} invoice</b> couldn't be charged.
          Update the card and we'll catch you back up in one tap.
        </div>
      </div>
      {/* What's owed */}
      <div style={{ margin: "16px 16px 0", background: "#141414", borderRadius: 12, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
        <div style={{
          padding: "10px 14px", fontFamily: "IBM Plex Mono, monospace", fontSize: 9,
          letterSpacing: "0.14em", color: "rgba(250,250,249,0.55)", borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          WHAT'S OWED
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
          <span style={{ fontSize: 13 }}>Invoice total</span>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontWeight: 700, fontSize: 14 }}>{fmtAUD(totalCents)}</span>
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          padding: "12px 14px", background: "rgba(101,245,201,0.06)",
        }}>
          <span style={{ fontFamily: "IBM Plex Mono, monospace", fontSize: 10, letterSpacing: "0.14em", color: "#65F5C9", fontWeight: 700 }}>
            TO CATCH UP
          </span>
          <span style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em" }}>
            {fmtAUD(totalCents)}
          </span>
        </div>
      </div>
      {/* CTAs */}
      {!showCard ? (
        <div style={{ padding: "14px 16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            onClick={() => setShowCard(true)}
            style={{
              background: "#65F5C9", color: "#053D2A", border: 0, borderRadius: 10,
              padding: "14px", fontWeight: 700, fontSize: 14, fontFamily: "inherit",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              boxShadow: "0 0 32px rgba(101,245,201,0.25)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <path d="M2 9h20M6 14h4" />
            </svg>
            Update card & pay {fmtAUD(totalCents)}
          </button>
          <button style={{
            background: "transparent", color: "rgba(255,255,255,0.6)", border: 0,
            fontWeight: 500, fontSize: 12, padding: "8px", fontFamily: "inherit", cursor: "pointer",
          }}>
            I need more time · message {businessName}
          </button>
        </div>
      ) : (
        <Elements stripe={stripePromise} options={{ clientSecret: isDemo ? undefined : clientSecret }}>
          <CardForm
            totalCents={totalCents}
            clientSecret={clientSecret}
            isDemo={isDemo}
            onSuccess={onSuccess}
          />
        </Elements>
      )}
      {/* Trust strip */}
      <div style={{
        display: "flex", justifyContent: "space-around", padding: "12px 16px 22px",
        borderTop: "1px solid rgba(255,255,255,0.06)", marginTop: "auto",
        fontFamily: "IBM Plex Mono, monospace", fontSize: 9, letterSpacing: "0.12em",
        color: "rgba(250,250,249,0.5)",
      }}>
        <span>STRIPE · PCI L1</span>
        <span>NO STORED PIN</span>
        <span>RECEIPT TO YOU</span>
      </div>
    </div>
  );
}

// ── Main RecoveryPage ─────────────────────────────────────────────────────────
export default function RecoveryPage() {
  const trpc = useTRPC();
  const { token } = useParams<{ token: string }>();
  const [paid, setPaid] = useState(false);

  const { data, isLoading, error } = useQuery({
    ...trpc.payments.chase.getByToken.queryOptions({ token: token ?? "" }),
    enabled: !!token,
  });

  const createIntent = useMutation(trpc.payments.chase.createRecoveryIntent.mutationOptions());

  // Trigger intent creation once data loads.
  // NOTE: the export fired mutateAsync during render; moved into a
  // ref-guarded effect so StrictMode/re-renders can't double-create intents.
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const intentRequested = useRef(false);

  useEffect(() => {
    if (intentRequested.current || !data || paid || clientSecret) return;
    intentRequested.current = true;
    createIntent.mutateAsync({ token: token ?? "" }).then((res) => {
      setClientSecret(res.clientSecret);
      setIsDemo(res.isDemo);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, paid, clientSecret, token]);

  if (isLoading || (data && !clientSecret && !paid)) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#0A0A0A", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          border: "3px solid rgba(101,245,201,0.3)",
          borderTopColor: "#65F5C9",
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{
        minHeight: "100dvh", background: "#0A0A0A", color: "#FAFAF9",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "32px 24px", textAlign: "center",
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔗</div>
        <h1 style={{ fontFamily: "Inter, sans-serif", fontWeight: 800, fontSize: 28, letterSpacing: "-0.03em" }}>
          Link not found
        </h1>
        <p style={{ color: "rgba(250,250,249,0.6)", fontSize: 14, marginTop: 8 }}>
          This recovery link may have expired or already been used.
        </p>
      </div>
    );
  }

  if (paid) {
    return (
      <div style={{ minHeight: "100dvh", background: "#0A0A0A", maxWidth: 430, margin: "0 auto" }}>
        <CatchupSuccess totalCents={data.totalCents} businessName={data.businessName} />
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "#0A0A0A", maxWidth: 430, margin: "0 auto" }}>
      <RecoveryLanding
        token={token ?? ""}
        totalCents={data.totalCents}
        clientName={data.clientName}
        businessName={data.businessName}
        daysOverdue={data.daysOverdue}
        clientSecret={clientSecret!}
        isDemo={isDemo}
        onSuccess={() => setPaid(true)}
      />
    </div>
  );
}
