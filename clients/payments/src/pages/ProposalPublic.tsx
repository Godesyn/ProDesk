/**
 * ProposalPublic — client-facing proposal page.
 * Rendering is handled by the shared ProposalPreview component.
 */
import { useState, useEffect, useRef } from "react";
import { useParams } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { STRIPE_PUBLISHABLE_KEY } from "@shared/lib/env";
import { useQuery, useMutation } from "@tanstack/react-query";
import { StripePaymentForm } from "@/components/StripePaymentForm";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import {
  ProposalPage,
  ProposalSuccess,
  mapDbProposal,
  DEFAULT_PROPOSAL_DATA,
} from "@/components/ProposalPreview";
import { ProposalRenderer } from "@/components/ProposalRenderer";
import type { Block } from "@/lib/blocks";
import { applyBrandKitToBlocks, loadBrandKitFonts, type BrandKit } from "@/lib/blocks";
import { resolveBlocksMergeFields, type MergeFieldContext } from "@/lib/mergeFields";

// AnimatedBlock is now handled inside ProposalRenderer — removed from ProposalPublic.

// ─── Proposal Q&A ─────────────────────────────────────────────────────────────
function ProposalQA({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const { data: answered = [] } = useQuery(trpc.payments.proposals.getQuestionsPublic.queryOptions({ slug }));
  const askMut = useMutation(trpc.payments.proposals.askQuestion.mutationOptions());
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [question, setQuestion] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    await askMut.mutateAsync({ slug, clientName: name || undefined, clientEmail: email || undefined, question });
    setSubmitted(true);
    setQuestion("");
  };
  const sectionStyle: React.CSSProperties = {
    maxWidth: 680, margin: "0 auto", padding: "40px 24px",
    fontFamily: "'IBM Plex Sans', sans-serif",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", border: "1px solid #ddd",
    borderRadius: 6, fontSize: 14, boxSizing: "border-box", marginBottom: 8,
  };
  return (
    <div style={sectionStyle}>
      <hr style={{ border: "none", borderTop: "1px solid #eee", marginBottom: 32 }} />
      <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Have a question?</h3>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 20 }}>Ask below and we'll reply directly to you.</p>
      {submitted ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "16px 20px", color: "#166534", fontSize: 14 }}>
          ✓ Your question has been sent. We'll be in touch soon.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 0 }}>
            <div style={{ flex: "1 1 200px" }}>
              <input style={inputStyle} placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <input style={inputStyle} type="email" placeholder="Your email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 80, resize: "vertical" }}
            placeholder="Type your question here…"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            required
          />
          <button
            type="submit"
            disabled={askMut.isPending || !question.trim()}
            style={{ background: "#0E0E0C", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: askMut.isPending ? 0.6 : 1 }}
          >
            {askMut.isPending ? "Sending…" : "Send question"}
          </button>
        </form>
      )}
      {answered.length > 0 && (
        <div style={{ marginTop: 40 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Frequently asked questions</h4>
          {answered.map((q: any) => (
            <div key={q.id} style={{ marginBottom: 20, padding: "16px 20px", background: "#f9fafb", borderRadius: 8 }}>
              <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Q: {q.question}</p>
              <p style={{ fontSize: 14, color: "#374151" }}>A: {q.answer}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Client Change Requests ────────────────────────────────────────────────────
function ProposalAnnotations({ slug }: { slug: string }) {
  const trpc = useTRPC();
  const addMut = useMutation(trpc.payments.annotations.add.mutationOptions());
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) return;
    await addMut.mutateAsync({ slug, comment, clientName: name || undefined, clientEmail: email || undefined });
    setSubmitted(true);
    setComment("");
  };
  const sectionStyle: React.CSSProperties = {
    maxWidth: 680, margin: "0 auto", padding: "0 24px 48px",
    fontFamily: "'IBM Plex Sans', sans-serif",
  };
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "10px 12px", border: "1px solid #ddd",
    borderRadius: 6, fontSize: 14, boxSizing: "border-box", marginBottom: 8,
  };
  if (!open) {
    return (
      <div style={sectionStyle}>
        <button
          onClick={() => setOpen(true)}
          style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 6, padding: "8px 16px", fontSize: 13, color: "#666", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Request a change
        </button>
      </div>
    );
  }
  return (
    <div style={sectionStyle}>
      <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Request a change</h3>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>Describe what you’d like changed and we’ll review it.</p>
      {submitted ? (
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "16px 20px", color: "#166534", fontSize: 14 }}>
          ✓ Your request has been sent. We’ll review it and get back to you.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 0 }}>
            <div style={{ flex: "1 1 200px" }}>
              <input style={inputStyle} placeholder="Your name (optional)" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div style={{ flex: "1 1 200px" }}>
              <input style={inputStyle} type="email" placeholder="Your email (optional)" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>
          <textarea
            style={{ ...inputStyle, minHeight: 100, resize: "vertical" }}
            placeholder="Describe the change you’d like…"
            value={comment}
            onChange={e => setComment(e.target.value)}
            required
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="submit"
              disabled={addMut.isPending || !comment.trim()}
              style={{ background: "#0E0E0C", color: "#fff", border: "none", borderRadius: 6, padding: "10px 20px", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: addMut.isPending ? 0.6 : 1 }}
            >
              {addMut.isPending ? "Sending…" : "Submit request"}
            </button>
            <button type="button" onClick={() => setOpen(false)} style={{ background: "transparent", border: "1px solid #ddd", borderRadius: 6, padding: "10px 16px", fontSize: 14, cursor: "pointer", color: "#666" }}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── Installment Pay Button ────────────────────────────────────────────────────
let _stripePromise: ReturnType<typeof loadStripe> | null = null;
function getInstallmentStripe() {
  if (!_stripePromise) {
    const key = STRIPE_PUBLISHABLE_KEY;
    if (key) _stripePromise = loadStripe(key);
  }
  return _stripePromise;
}

function InstallmentCheckoutForm({ installmentId, slug, onSuccess }: { installmentId: string; slug: string; onSuccess: () => void }) {
  const trpc = useTRPC();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const confirmMutation = useMutation({
    ...trpc.payments.installments.confirmPayment.mutationOptions(),
    onSuccess: () => { setSubmitting(false); onSuccess(); },
    onError: (err) => { setErrorMsg(err.message); setSubmitting(false); },
  });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMsg(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setErrorMsg(error.message ?? "Payment failed"); setSubmitting(false); return; }
    if (paymentIntent?.status === "succeeded") {
      confirmMutation.mutate({ installmentId, paymentIntentId: paymentIntent.id, slug });
    } else { setErrorMsg("Payment did not complete"); setSubmitting(false); }
  };
  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <PaymentElement options={{ layout: "tabs" }} />
      {errorMsg && <div style={{ color: "#ef4444", fontSize: 12 }}>{errorMsg}</div>}
      <button type="submit" disabled={!stripe || submitting} className="btn-prop primary" style={{ padding: "10px 16px" }}>
        {submitting ? "Processing…" : "Pay this installment"}
      </button>
    </form>
  );
}

function InstallmentPayButton({ installmentId, slug, theme, onSuccess }: { installmentId: string; slug: string; theme: string; onSuccess: () => void }) {
  const trpc = useTRPC();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const createPIMutation = useMutation({
    ...trpc.payments.installments.createPaymentIntent.mutationOptions(),
    onSuccess: (data) => setClientSecret(data.clientSecret),
  });
  const handleOpen = () => {
    setOpen(true);
    if (!clientSecret) createPIMutation.mutate({ installmentId, slug });
  };
  const stripePromise = getInstallmentStripe();
  const appearance: import("@stripe/stripe-js").Appearance = {
    theme: theme === "digital" ? "night" : "stripe",
    variables: { colorPrimary: theme === "digital" ? "#65F5C9" : theme === "luxury" ? "#B8860B" : "#1A1A1A", borderRadius: "8px" },
  };
  if (!open) return <button className="btn-prop primary" style={{ padding: "8px 14px", fontSize: 12 }} onClick={handleOpen}>Pay now</button>;
  if (!clientSecret || !stripePromise) return <span style={{ fontSize: 12, opacity: 0.6 }}>Loading…</span>;
  return (
    <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
      <InstallmentCheckoutForm installmentId={installmentId} slug={slug} onSuccess={onSuccess} />
    </Elements>
  );
}

// ─── Payment Plan Section ──────────────────────────────────────────────────────
function PaymentPlanSection({ slug, theme, onAllPaid }: { slug: string; theme: string; onAllPaid: () => void }) {
  const trpc = useTRPC();
  const { data: installments, refetch } = useQuery({
    ...trpc.payments.installments.listBySlug.queryOptions({ slug }),
    retry: false,
  });
  const createScheduleMutation = useMutation({
    ...trpc.payments.installments.createSchedule.mutationOptions(),
    onSuccess: () => refetch(),
  });

  if (!installments || installments.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ fontSize: 13, opacity: 0.7, lineHeight: 1.5 }}>
          Accept this proposal to set up your payment plan. You'll be able to pay each installment as it falls due.
        </p>
        <button
          className="btn-prop primary"
          disabled={createScheduleMutation.isPending}
          onClick={() => createScheduleMutation.mutate({ slug })}
        >
          {createScheduleMutation.isPending ? "Setting up…" : "Accept & Set Up Payment Plan"}
        </button>
      </div>
    );
  }

  const fmt = (cents: number) => `$${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0 })}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Payment Schedule</div>
      {installments.map((ins: any) => (
        <div key={ins.id} style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", borderRadius: 8,
          background: ins.status === "paid" ? "rgba(101,245,201,0.08)" : ins.status === "due" ? "rgba(255,200,0,0.08)" : "rgba(255,255,255,0.04)",
          border: `1px solid ${ins.status === "paid" ? "rgba(101,245,201,0.2)" : ins.status === "due" ? "rgba(255,200,0,0.3)" : "rgba(255,255,255,0.08)"}`,
          fontSize: 13,
        }}>
          <div>
            <div style={{ fontWeight: 600 }}>Installment {ins.installmentNumber}/{ins.totalInstallments}</div>
            <div style={{ opacity: 0.55, fontSize: 12 }}>{new Date(ins.dueAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{fmt(ins.amountCents)}</span>
            {ins.status === "paid" && <span style={{ fontSize: 11, color: "#65F5C9", fontWeight: 600 }}>PAID</span>}
            {(ins.status === "due" || ins.status === "overdue") && (
              <InstallmentPayButton
                installmentId={ins.id}
                slug={slug}
                theme={theme}
                onSuccess={() => refetch().then(() => { if (installments.every((i: any) => i.id === ins.id || i.status === "paid")) onAllPaid(); })}
              />
            )}
            {ins.status === "pending" && <span style={{ fontSize: 11, opacity: 0.4 }}>UPCOMING</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Dual Option Section ─────────────────────────────────────────────────────
function DualOptionSection({ slug, theme, paymentConfig, totalCents, currency, onSuccess }: {
  slug: string;
  theme: string;
  paymentConfig: Record<string, unknown>;
  totalCents: number;
  currency: string;
  onSuccess: () => void;
}) {
  const trpc = useTRPC();
  const [choice, setChoice] = useState<"upfront" | "plan" | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [amountCents, setAmountCents] = useState(0);
  const createIntentMutation = useMutation({
    ...trpc.payments.payments.createDualOptionIntent.mutationOptions(),
    onSuccess: (data) => { setClientSecret(data.clientSecret); setAmountCents(data.amountCents); },
  });
  const stripePromise = getInstallmentStripe();

  const discountPct = typeof paymentConfig.dualDiscountPct === "number" ? paymentConfig.dualDiscountPct : 0;
  const upfrontCents = Math.round(totalCents * (1 - discountPct / 100));
  const depositPct = typeof paymentConfig.ppDepositPct === "number" ? paymentConfig.ppDepositPct : 0;
  const installments = Math.max(2, parseInt(String(paymentConfig.ppInstallments ?? "3"), 10));
  const depositCents = depositPct > 0 ? Math.round(totalCents * depositPct / 100) : Math.round(totalCents / installments);
  const fmt = (cents: number) => `${currency === "AUD" ? "$" : currency}${(cents / 100).toLocaleString("en-AU", { minimumFractionDigits: 0 })}`;

  const handleChoose = (c: "upfront" | "plan") => {
    setChoice(c);
    if (!clientSecret) createIntentMutation.mutate({ slug, choice: c });
  };

  const appearance: import("@stripe/stripe-js").Appearance = {
    theme: theme === "digital" ? "night" : "stripe",
    variables: { colorPrimary: theme === "digital" ? "#65F5C9" : theme === "luxury" ? "#B8860B" : "#1A1A1A", borderRadius: "8px" },
  };

  if (!choice) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.5, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Choose how you'd like to pay</div>
        {/* Upfront option */}
        <button
          onClick={() => handleChoose("upfront")}
          style={{
            background: "rgba(101,245,201,0.06)", border: "1px solid rgba(101,245,201,0.25)",
            borderRadius: 10, padding: "16px 20px", cursor: "pointer", textAlign: "left", color: "inherit",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{paymentConfig.dualDiscountLabel as string || "Pay upfront"}</span>
            <span style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums", color: "#65F5C9" }}>{fmt(upfrontCents)}</span>
          </div>
          {discountPct > 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Save {discountPct}% — pay in full today</div>}
        </button>
        {/* Payment plan option */}
        <button
          onClick={() => handleChoose("plan")}
          style={{
            background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 10, padding: "16px 20px", cursor: "pointer", textAlign: "left", color: "inherit",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Payment plan</span>
            <span style={{ fontWeight: 700, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{fmt(depositCents)} today</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.6 }}>
            {depositPct > 0 ? `${depositPct}% deposit, then ` : ""}{installments} payments of {fmt(Math.round((totalCents - depositCents) / (installments - (depositPct > 0 ? 0 : 0))))} · {String(paymentConfig.ppInterval ?? "monthly")}
          </div>
        </button>
      </div>
    );
  }

  if (createIntentMutation.isPending || !clientSecret || !stripePromise) {
    return <div style={{ fontSize: 13, opacity: 0.6, padding: "16px 0" }}>Preparing payment…</div>;
  }

  return (
    <div>
      <button
        onClick={() => { setChoice(null); setClientSecret(null); }}
        style={{ background: "transparent", border: "none", color: "inherit", opacity: 0.5, fontSize: 12, cursor: "pointer", marginBottom: 12, padding: 0 }}
      >
        ← Change option
      </button>
      <div style={{ fontSize: 12, opacity: 0.5, marginBottom: 12 }}>
        {choice === "upfront" ? `Paying ${fmt(amountCents)} upfront` : `Paying ${fmt(amountCents)} deposit today`}
      </div>
      <Elements stripe={stripePromise} options={{ clientSecret, appearance }}>
        <DualOptionCheckoutForm slug={slug} choice={choice} onSuccess={onSuccess} />
      </Elements>
    </div>
  );
}

function DualOptionCheckoutForm({ slug, choice, onSuccess }: { slug: string; choice: "upfront" | "plan"; onSuccess: () => void }) {
  const trpc = useTRPC();
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const confirmMutation = useMutation({
    ...trpc.payments.payments.confirmPayment.mutationOptions(),
    onSuccess: () => { setSubmitting(false); onSuccess(); },
    onError: (err) => { setErrorMsg(err.message); setSubmitting(false); },
  });
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMsg(null);
    const { error, paymentIntent } = await stripe.confirmPayment({ elements, redirect: "if_required" });
    if (error) { setErrorMsg(error.message ?? "Payment failed"); setSubmitting(false); return; }
    if (paymentIntent?.status === "succeeded") {
      confirmMutation.mutate({ slug, paymentIntentId: paymentIntent.id });
    } else { setErrorMsg("Payment did not complete"); setSubmitting(false); }
  };
  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <PaymentElement options={{ layout: "tabs" }} />
      {errorMsg && <div style={{ color: "#ef4444", fontSize: 12 }}>{errorMsg}</div>}
      <button type="submit" disabled={!stripe || submitting} className="btn-prop primary" style={{ padding: "10px 16px" }}>
        {submitting ? "Processing…" : choice === "upfront" ? "Pay in full" : "Pay deposit"}
      </button>
    </form>
  );
}

// ─── EziQuotes Platform Frame ────────────────────────────────────────────────────
function EziFrame({ isDemo, businessName, proposalTitle, status, slug, brandLogoUrl, children }: {
  isDemo: boolean;
  businessName: string;
  proposalTitle?: string;
  status?: string;
  slug?: string;
  brandLogoUrl?: string | null;
  children: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      {!dismissed && (
        <div style={{
          position: "sticky", top: 0, zIndex: 100,
          background: "#0f0f0f",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex", alignItems: "center", gap: 0,
          padding: "0 20px",
          height: 40,
          fontFamily: "var(--font-sans, system-ui)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {brandLogoUrl ? (
              // Show the brand's logo when available
              <img
                src={brandLogoUrl}
                alt={businessName}
                style={{ height: 24, maxWidth: 120, objectFit: "contain", objectPosition: "left center" }}
              />
            ) : (
              // Fall back to EziQuotes wordmark
              <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 20, width: "auto", objectFit: "contain", filter: "brightness(0) invert(1)" }} />
            )}
          </div>
          <div style={{ width: 1, height: 20, background: "rgba(255,255,255,0.1)", margin: "0 16px", flexShrink: 0 }} />
          <div className="ezi-frame-ctx" style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, overflow: "hidden", minWidth: 0 }}>
            {isDemo && (
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase",
                color: "#D9F542", background: "rgba(217,245,66,0.12)",
                padding: "2px 8px", borderRadius: 4, flexShrink: 0,
              }}>Demo</span>
            )}
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", flexShrink: 0 }}>Sent by</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.85)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {businessName}
            </span>
            {proposalTitle && (
              <>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", flexShrink: 0 }}>·</span>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {proposalTitle}
                </span>
              </>
            )}
            {status && (
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase",
                color: status === "accepted" || status === "paid" ? "#4ade80" : "rgba(255,255,255,0.4)",
                background: status === "accepted" || status === "paid" ? "rgba(74,222,128,0.1)" : "rgba(255,255,255,0.06)",
                padding: "2px 7px", borderRadius: 4, flexShrink: 0,
              }}>{status}</span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {slug && !isDemo && (
              <a
                href={`/api/payments/proposals/${slug}/pdf`}
                download={`proposal-${slug}.pdf`}
                style={{
                  fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.6)",
                  textDecoration: "none", letterSpacing: "0.02em",
                  padding: "5px 10px", borderRadius: 6,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  transition: "background 150ms",
                  display: "inline-flex", alignItems: "center", gap: 5,
                }}
              >↓ PDF</a>
            )}
            <a
              href="/"
              style={{
                fontSize: 11, fontWeight: 600, color: "#D9F542",
                textDecoration: "none", letterSpacing: "0.02em",
                padding: "5px 12px", borderRadius: 6,
                background: "rgba(217,245,66,0.12)",
                border: "1px solid rgba(217,245,66,0.25)",
                transition: "background 150ms",
                display: "inline-flex", alignItems: "center", gap: 5,
              }}
            >
              {isDemo ? "Create your own →" : "Powered by EziQuotes"}
            </a>
            <button
              onClick={() => setDismissed(true)}
              title="Dismiss this bar"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "rgba(255,255,255,0.3)", fontSize: 16, lineHeight: 1,
                padding: "4px 6px", borderRadius: 4,
                transition: "color 150ms",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,0.7)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,0.3)")}
            >×</button>
          </div>
        </div>
      )}
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ─── Main export ───────────────────────────────────────────────────────────────
export default function ProposalPublic() {
  const trpc = useTRPC();
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? "demo";
  const isDemo = slug === "demo";

  const [theme] = useState<string>("digital");
  const [paid, setPaid] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const { data: dbProposal, isLoading, isError, error } = useQuery({
    ...trpc.payments.proposals.getPublic.queryOptions({ slug }),
    retry: false,
    enabled: !isDemo,
  });

   const [hasEngaged, setHasEngaged] = useState(false);
  const engageMutation = useMutation(trpc.payments.proposals.engage.mutationOptions());
  const trackViewMutation = useMutation(trpc.payments.proposals.trackView.mutationOptions());
  const trackScrollDepthMutation = useMutation(trpc.payments.proposals.trackScrollDepth.mutationOptions());
  const engageRef = useRef<HTMLDivElement>(null);

  // Track view on load
  useEffect(() => {
    if (isDemo || !slug) return;
    trackViewMutation.mutate({ slug });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isDemo]);

  // Track scroll depth
  useEffect(() => {
    if (isDemo) return;
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      if (docHeight <= 0) return;
      const depth = Math.round((scrollTop / docHeight) * 100);
      trackScrollDepthMutation.mutate({ slug, depth });
    };
    const throttled = () => { clearTimeout((handleScroll as any)._t); (handleScroll as any)._t = setTimeout(handleScroll, 1000); };
    window.addEventListener("scroll", throttled, { passive: true });
    return () => window.removeEventListener("scroll", throttled);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, isDemo]);

  useEffect(() => {
    if (isDemo || hasEngaged) return;
    const el = engageRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasEngaged) {
          setHasEngaged(true);
          engageMutation.mutate({ slug });
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isDemo, hasEngaged, slug]);

  const acceptMutation = useMutation({
    ...trpc.payments.proposals.accept.mutationOptions(),
    onSuccess: () => { setPaid(true); setAccepting(false); },
    onError: () => setAccepting(false),
  });

  const subscriptionCheckoutMutation = useMutation({
    ...trpc.payments.payments.createSubscriptionCheckout.mutationOptions(),
    onSuccess: (data) => {
      window.open(data.checkoutUrl, "_blank");
      setAccepting(false);
    },
    onError: () => setAccepting(false),
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("subscription_success") === "1") {
      setPaid(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const [countdown, setCountdown] = useState<string | null>(null);
  const [isExpired, setIsExpired] = useState(false);
  useEffect(() => {
    const expiresAt = (dbProposal as any)?.expiresAt;
    if (!expiresAt) return;
    const expDate = new Date(expiresAt);
    const update = () => {
      const now = new Date();
      const diff = expDate.getTime() - now.getTime();
      if (diff <= 0) { setIsExpired(true); setCountdown(null); return; }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      if (days > 0) setCountdown(`${days}d ${hours}h remaining`);
      else if (hours > 0) setCountdown(`${hours}h ${mins}m remaining`);
      else setCountdown(`${mins}m remaining`);
    };
    update();
    const t = setInterval(update, 60000);
    return () => clearInterval(t);
  }, [dbProposal]);

  // Build payment element for real proposals
  const paymentModel = (dbProposal as any)?.paymentModel;

  // Apply brand kit fonts when brand kit data is available
  const brandKit: BrandKit | null = (dbProposal as any)?.brandKit ?? null;
  useEffect(() => {
    if (brandKit) loadBrandKitFonts(brandKit);
  }, [brandKit?.headingFont, brandKit?.bodyFont]);

  // Check if this proposal uses the new modular block system
  const rawBlocks: Block[] | null = (dbProposal as any)?.structure?.blocks ?? null;

  // Interactive pricing state — client can toggle optional add-ons
  // Apply brand kit to blocks when both are available
  const [interactiveBlocks, setInteractiveBlocks] = useState<Block[] | null>(null);
  useEffect(() => {
    if (rawBlocks) {
      const branded = brandKit ? applyBrandKitToBlocks(rawBlocks, brandKit) : rawBlocks;
      // Resolve merge fields using proposal context data
      const mergeCtx: MergeFieldContext = {
        clientName: (dbProposal as any)?.client?.name ?? null,
        clientEmail: (dbProposal as any)?.client?.email ?? null,
        businessName: (dbProposal as any)?.account?.businessName ?? null,
        proposalTitle: (dbProposal as any)?.title ?? null,
        totalCents: (dbProposal as any)?.totalCents ?? null,
        subtotalCents: (dbProposal as any)?.subtotalCents ?? null,
        taxCents: (dbProposal as any)?.taxCents ?? null,
        currency: (dbProposal as any)?.currency ?? null,
        proposalDate: (dbProposal as any)?.createdAt ?? null,
        expiryDate: (dbProposal as any)?.validUntil ?? null,
        proposalNumber: (dbProposal as any)?.slug ?? null,
        senderName: (dbProposal as any)?.account?.ownerName ?? null,
        senderEmail: (dbProposal as any)?.account?.email ?? null,
      };
      const resolved = resolveBlocksMergeFields(branded as unknown[], mergeCtx) as Block[];
      // P0-TOTAL: inject proposal-level totalCents/subtotalCents/taxCents into pricing_table block.
      // The block is built client-side without these values; the server calculates them authoritatively
      // from structure.lineItems and stores them on the proposals row.
      const proposalTotalCents = (dbProposal as any)?.totalCents ?? 0;
      const proposalSubtotalCents = (dbProposal as any)?.subtotalCents ?? proposalTotalCents;
      const proposalTaxCents = (dbProposal as any)?.taxCents ?? 0;
      const proposalTaxLabel = (dbProposal as any)?.account?.taxLabel ?? "GST";
      const proposalCurrency = (dbProposal as any)?.currency ?? "AUD";
      const injected = resolved.map(b => {
        if (b.type !== "pricing_table") return b;
        const d = b.data as any;
        // Only inject if the block doesn't already have a non-zero totalCents
        // (interactive toggles may have already computed it)
        if ((d.totalCents ?? 0) > 0) return b;
        return {
          ...b,
          data: {
            ...d,
            totalCents: proposalTotalCents,
            subtotalCents: proposalSubtotalCents,
            taxCents: proposalTaxCents,
            taxLabel: d.taxLabel ?? proposalTaxLabel,
            currency: d.currency ?? proposalCurrency,
          },
        };
      });
      setInteractiveBlocks(injected);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!rawBlocks, brandKit?.primaryColor, brandKit?.accentColor, brandKit?.headingFont, (dbProposal as any)?.client?.name, (dbProposal as any)?.account?.businessName, (dbProposal as any)?.totalCents]);

  const handleAccept = () => {
    if (accepting) return;
    setAccepting(true);
    if (!isDemo && dbProposal) {
      if (paymentModel === "subscription") {
        subscriptionCheckoutMutation.mutate({ slug, origin: window.location.origin });
      } else if (paymentModel === "payment-plan" || paymentModel === "payment_plan" || paymentModel === "pay_plan") {
        setAccepting(false); // PaymentPlanSection handles its own flow
      } else if (paymentModel === "dual_option") {
        setAccepting(false); // DualOptionSection handles its own flow
      } else {
        acceptMutation.mutate({ slug });
      }
    } else {
      setTimeout(() => { setPaid(true); setAccepting(false); }, 600);
    }
  };

  if (!isDemo && isLoading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0A0A0A", color: "#FAFAF9" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            border: "3px solid rgba(101,245,201,0.2)",
            borderTopColor: "#65F5C9",
            animation: "spin 700ms linear infinite",
          }} />
          <p style={{ fontSize: 12, fontFamily: "monospace", letterSpacing: "0.1em", opacity: 0.5 }}>Loading…</p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // Error state — proposal not found or server error
  if (!isDemo && isError) {
    const is404 = (error as any)?.data?.code === 'NOT_FOUND' || (error as any)?.message?.includes('not found');
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0A0A0A", color: "#FAFAF9", padding: "24px", textAlign: "center" }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{is404 ? "🔍" : "⚠️"}</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, fontFamily: "'Inter Tight', sans-serif" }}>
            {is404 ? "Proposal not found" : "Something went wrong"}
          </h1>
          <p style={{ fontSize: 14, opacity: 0.55, lineHeight: 1.6, margin: 0 }}>
            {is404
              ? "This proposal link may have expired or been removed. Contact the sender for a new link."
              : "We couldn't load this proposal. Please try refreshing the page or contact the sender."}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 24, padding: "10px 24px", borderRadius: 8, background: "#D9F542", color: "#0A0A0A", fontWeight: 600, fontSize: 14, border: "none", cursor: "pointer" }}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Not found — proposal loaded but returned null
  if (!isDemo && !isLoading && !dbProposal) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0A0A0A", color: "#FAFAF9", padding: "24px", textAlign: "center" }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, fontFamily: "'Inter Tight', sans-serif" }}>Proposal not found</h1>
          <p style={{ fontSize: 14, opacity: 0.55, lineHeight: 1.6, margin: 0 }}>
            This proposal link may have expired or been removed. Contact the sender for a new link.
          </p>
        </div>
      </div>
    );
  }

  const data = (!isDemo && dbProposal) ? mapDbProposal(dbProposal) : DEFAULT_PROPOSAL_DATA;
  const isAlreadyAccepted = (dbProposal as any)?.status === "accepted" || (dbProposal as any)?.status === "paid";
  const frameStatus = paid || isAlreadyAccepted ? "accepted" : "sent";
  const frameTitle = data.hero?.eyebrow ?? undefined;

  // Build the real payment element for non-demo, non-subscription, non-payment-plan
  // NOTE: DB stores paymentModel as "payment_plan" (underscore) but builder uses "payment-plan" (hyphen)
  const isPaymentPlan = paymentModel === "payment-plan" || paymentModel === "payment_plan" || paymentModel === "pay_plan";
  let payElement: React.ReactNode = undefined;
  if (!isDemo && dbProposal && paymentModel !== "subscription") {
    if (isPaymentPlan) {
      payElement = (
        <PaymentPlanSection
          slug={slug}
          theme={theme}
          onAllPaid={() => setPaid(true)}
        />
      );
    } else if (paymentModel === "dual_option") {
      payElement = (
        <DualOptionSection
          slug={slug}
          theme={theme}
          paymentConfig={(dbProposal as any)?.paymentConfig ?? {}}
          totalCents={(dbProposal as any)?.totalCents ?? 0}
          currency={(dbProposal as any)?.currency ?? "AUD"}
          onSuccess={() => setPaid(true)}
        />
      );
    } else {
      // One-off: use StripePaymentForm
      payElement = (
        <StripePaymentForm
          slug={slug}
          theme={theme}
          onSuccess={() => setPaid(true)}
        />
      );
    }
  }

  const blocks = interactiveBlocks ?? rawBlocks;

  // Handle optional line item toggle (client-side add-on selection)
  const handleLineItemToggle = (itemId: string, selected: boolean) => {
    if (!blocks) return;
    setInteractiveBlocks(blocks.map(b => {
      if (b.type !== "pricing_table") return b;
      const d = b.data as any;
      const updatedItems = d.lineItems.map((li: any) =>
        li.id === itemId ? { ...li, selected } : li
      );
      const activeItems = updatedItems.filter((li: any) => !li.optional || li.selected !== false);
      const subtotal = activeItems.reduce((s: number, li: any) => s + li.qty * li.unitCents, 0);
      const taxRate = d.taxRate ?? 0.1;
      const taxCents = d.taxBehaviour === "exclusive" ? Math.round(subtotal * taxRate) : 0;
      const total = subtotal + taxCents;
      return { ...b, data: { ...d, lineItems: updatedItems, subtotalCents: subtotal, taxCents, totalCents: total } };
    }));
  };

  // Handle quantity change for editable line items
  const handleQuantityChange = (itemId: string, qty: number) => {
    if (!blocks) return;
    setInteractiveBlocks(blocks.map(b => {
      if (b.type !== "pricing_table") return b;
      const d = b.data as any;
      const updatedItems = d.lineItems.map((li: any) =>
        li.id === itemId ? { ...li, qty } : li
      );
      const activeItems = updatedItems.filter((li: any) => !li.optional || li.selected !== false);
      const subtotal = activeItems.reduce((s: number, li: any) => s + li.qty * li.unitCents, 0);
      const taxRate = d.taxRate ?? 0.1;
      const taxCents = d.taxBehaviour === "exclusive" ? Math.round(subtotal * taxRate) : 0;
      const total = subtotal + taxCents;
      return { ...b, data: { ...d, lineItems: updatedItems, subtotalCents: subtotal, taxCents, totalCents: total } };
    }));
  };
  // Handle package selector tier selection
  const handleTierSelect = (tierId: string) => {
    if (!blocks) return;
    setInteractiveBlocks(blocks.map(b => {
      if (b.type !== "package_selector") return b;
      const d = b.data as any;
      return { ...b, data: { ...d, selectedTierId: tierId } };
    }));
  };

  const brandLogoUrl = brandKit?.logoLightUrl ?? null;

  if (paid || isAlreadyAccepted) {
    const signedPdfUrl = (dbProposal as any)?.signedPdfUrl ?? null;
    const tyConfig = (dbProposal as any)?.account?.thankYouConfig ?? null;
    return (
      <EziFrame isDemo={isDemo} businessName={data.customer} proposalTitle={frameTitle} status="accepted" brandLogoUrl={brandLogoUrl}>
        <ProposalSuccess theme={theme} data={data} thankYouConfig={tyConfig} brandKit={brandKit} />
        {signedPdfUrl && (
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px 48px", fontFamily: "'IBM Plex Sans', sans-serif", textAlign: "center" }}>
            <a href={signedPdfUrl} target="_blank" rel="noopener noreferrer" download>
              <button style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "transparent", border: "1px solid #ddd", borderRadius: 6, padding: "10px 20px", fontSize: 14, cursor: "pointer", color: "#374151" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Download signed proposal PDF
              </button>
            </a>
          </div>
        )}
      </EziFrame>
    );
  }

  if (!isDemo && isExpired) {
    return (
      <EziFrame isDemo={isDemo} businessName={data.customer} proposalTitle={frameTitle} status="expired" brandLogoUrl={brandLogoUrl}>
        <div style={{
          minHeight: "60vh", display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 24, padding: "60px 24px", textAlign: "center",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}>
          <div style={{ fontSize: 48 }}>⏰</div>
          <h2 style={{ fontSize: 28, fontWeight: 700, margin: 0 }}>This proposal has expired</h2>
          <p style={{ fontSize: 16, opacity: 0.6, maxWidth: 420, margin: 0 }}>
            The offer period for this proposal has ended. Please contact {data.customer} to request a new proposal.
          </p>
        </div>
      </EziFrame>
    );
  }

  // ---- Block-based rendering (new modular WYSIWYG proposals) ----
  // Uses ProposalRenderer as the single source of truth (PHASE2-13)
  if (blocks && blocks.length > 0) {
    const mergeCtx: MergeFieldContext = {
      clientName: (dbProposal as any)?.client?.name ?? null,
      clientEmail: (dbProposal as any)?.client?.email ?? null,
      businessName: (dbProposal as any)?.account?.businessName ?? null,
      proposalTitle: (dbProposal as any)?.title ?? null,
      totalCents: (dbProposal as any)?.totalCents ?? null,
      subtotalCents: (dbProposal as any)?.subtotalCents ?? null,
      taxCents: (dbProposal as any)?.taxCents ?? null,
      currency: (dbProposal as any)?.currency ?? null,
      proposalDate: (dbProposal as any)?.createdAt ?? null,
      expiryDate: (dbProposal as any)?.validUntil ?? null,
      proposalNumber: (dbProposal as any)?.slug ?? null,
      senderName: (dbProposal as any)?.account?.ownerName ?? null,
      senderEmail: (dbProposal as any)?.account?.email ?? null,
    };
    return (
      <EziFrame isDemo={isDemo} businessName={(dbProposal as any)?.account?.businessName ?? "EziQuotes"} proposalTitle={(dbProposal as any)?.title} status={frameStatus} brandLogoUrl={brandLogoUrl}>
        {countdown && (
          <div style={{
            background: "#FFF3CD", color: "#856404", textAlign: "center",
            padding: "8px 16px", fontSize: 13, fontWeight: 600,
            fontFamily: "'IBM Plex Sans', sans-serif",
            borderBottom: "1px solid #FFEAA7",
          }}>
            ⏰ This offer expires in {countdown}
          </div>
        )}
        <div ref={engageRef}>
          <ProposalRenderer
            blocks={interactiveBlocks ?? blocks}
            brandKit={brandKit}
            mergeCtx={mergeCtx}
            enforceCanonical={false}
            previewMode={false}
            onAccept={handleAccept}
            accepted={accepting}
            onLineItemToggle={handleLineItemToggle}
            onQuantityChange={handleQuantityChange}
            onTierSelect={handleTierSelect}
            onSign={(sigData) => {
              setInteractiveBlocks(prev => (prev ?? blocks ?? []).map(b => {
                if (b.type !== "signature") return b;
                return { ...b, data: { ...b.data, ...sigData, signedAt: new Date().toISOString(), isSigned: true } };
              }));
              setTimeout(() => handleAccept(), 500);
            }}
            payElement={payElement}
            proposalExpiresAt={(dbProposal as any)?.expiresAt}
            onBlocksChange={setInteractiveBlocks}
            paymentConfig={dbProposal ? { ...((dbProposal as any).paymentConfig ?? {}), paymentModel } : undefined}
          />
        </div>
        {!isDemo && <ProposalQA slug={slug} />}
        {!isDemo && <ProposalAnnotations slug={slug} />}
      </EziFrame>
    );
  }
  // ---- Legacy rendering (old cinematic layout) ----
  return (
    <EziFrame isDemo={isDemo} businessName={data.customer} proposalTitle={frameTitle} status={frameStatus} slug={isDemo ? undefined : slug} brandLogoUrl={brandLogoUrl}>
      {countdown && (
        <div style={{
          background: "#FFF3CD", color: "#856404", textAlign: "center",
          padding: "8px 16px", fontSize: 13, fontWeight: 600,
          fontFamily: "'IBM Plex Sans', sans-serif",
          borderBottom: "1px solid #FFEAA7",
        }}>
          ⏰ This offer expires in {countdown}
        </div>
      )}
      <ProposalPage
        theme={theme}
        data={data}
        onAccept={handleAccept}
        accepted={false}
        engageRef={engageRef}
        isDemo={isDemo}
        slug={slug}
        paymentModel={paymentModel}
        payElement={payElement}
      />
    </EziFrame>
  );
}
