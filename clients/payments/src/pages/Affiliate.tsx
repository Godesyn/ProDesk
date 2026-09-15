import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useCurrentUser } from "@shared/auth/auth-context";

const fmtAUD = (n: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);

// ─── AF1: Public affiliate landing page ─────────────────────────────────────

export function AffiliateLanding() {
  const { data: user } = useCurrentUser();

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#F4F1E8", fontFamily: "var(--font-sans)" }}>
      {/* Nav */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 40px", borderBottom: "1px solid rgba(244,241,232,0.08)" }}>
        <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 28, display: "block", marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 12 }}>
          {user ? (
            <a href="/affiliate/dashboard" className="btn primary" style={{ textDecoration: "none" }}>My dashboard →</a>
          ) : (
            <>
              <a href="/login" style={{ fontSize: 14, color: "rgba(244,241,232,0.7)", textDecoration: "none", padding: "8px 16px" }}>Sign in</a>
              <a href="/affiliate/signup" className="btn primary" style={{ textDecoration: "none" }}>Join the program →</a>
            </>
          )}
        </div>
      </nav>

      {/* Hero */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "80px 40px 60px", textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.18em", color: "#D9F542", marginBottom: 20 }}>AFFILIATE PROGRAM</div>
        <h1 style={{ fontSize: "clamp(40px, 7vw, 80px)", fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1.0, marginBottom: 24 }}>
          Earn 0.5% of every<br />dollar your referrals process.
        </h1>
        <p style={{ fontSize: 18, color: "rgba(244,241,232,0.65)", lineHeight: 1.7, maxWidth: 560, margin: "0 auto 40px" }}>
          Refer bookkeepers, accountants, and service businesses to EziQuotes. You earn 0.5% of their processed volume — for life, while they stay active. You earn 0.5% of their processed volume — for life, while they stay active.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <a href="/affiliate/signup" className="btn primary" style={{ fontSize: 16, padding: "14px 28px", textDecoration: "none" }}>Start earning →</a>
          <a href="#how" style={{ fontSize: 14, color: "rgba(244,241,232,0.7)", textDecoration: "none", padding: "14px 20px", border: "1px solid rgba(244,241,232,0.15)", borderRadius: 8 }}>How it works</a>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, background: "rgba(244,241,232,0.08)", maxWidth: 900, margin: "0 auto 80px" }}>
        {[
          { v: "0.5%", l: "Lifetime rate", sub: "of all volume your referrals process" },
          { v: "$10", l: "Minimum payout", sub: "rolls forward if under threshold" },
          { v: "90d", l: "Cookie window", sub: "last-click attribution" },
        ].map((s, i) => (
          <div key={i} style={{ padding: "32px 28px", background: "#0E0E0C", textAlign: "center" }}>
            <div style={{ fontSize: 48, fontWeight: 900, letterSpacing: "-0.04em", color: "#D9F542" }}>{s.v}</div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>{s.l}</div>
            <div style={{ fontSize: 12, color: "rgba(244,241,232,0.5)", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div id="how" style={{ maxWidth: 900, margin: "0 auto 80px", padding: "0 40px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.18em", color: "rgba(244,241,232,0.5)", marginBottom: 32, textAlign: "center" }}>HOW IT WORKS</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24 }}>
          {[
            { n: "01", t: "Get your link", b: "Sign up and receive a unique referral link. Share it anywhere — email, social, your website." },
            { n: "02", t: "They sign up", b: "When someone clicks your link and creates a EziQuotes account, they're attributed to you for 90 days." },
            { n: "03", t: "You earn forever", b: "Once they process their first payment, you earn 0.5% of everything they process — for as long as they stay active." },
          ].map((s, i) => (
            <div key={i} style={{ padding: 28, border: "1px solid rgba(244,241,232,0.1)", borderRadius: 12 }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 32, fontWeight: 900, color: "rgba(244,241,232,0.15)", marginBottom: 16 }}>{s.n}</div>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 10 }}>{s.t}</div>
              <div style={{ fontSize: 14, color: "rgba(244,241,232,0.6)", lineHeight: 1.6 }}>{s.b}</div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div style={{ textAlign: "center", padding: "60px 40px 80px", borderTop: "1px solid rgba(244,241,232,0.08)" }}>
        <h2 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 16 }}>Ready to start earning?</h2>
        <p style={{ color: "rgba(244,241,232,0.6)", marginBottom: 32 }}>Join hundreds of bookkeepers and accountants already earning passive income.</p>
        <a href="/affiliate/signup" className="btn primary" style={{ fontSize: 16, padding: "14px 32px", textDecoration: "none" }}>Join the program →</a>
      </div>
    </div>
  );
}

// ─── AF2: Affiliate dashboard ────────────────────────────────────────────────

export function AffiliateDashboard() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = useBrandId();
  const { data: affiliate, isLoading } = useQuery({
    ...trpc.payments.affiliates.getMyAffiliate.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: referrals = [] } = useQuery({
    ...trpc.payments.affiliates.getReferrals.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const { data: payouts = [] } = useQuery({
    ...trpc.payments.affiliates.getPayouts.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const registerMut = useMutation({
    ...trpc.payments.affiliates.register.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.payments.affiliates.getMyAffiliate.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.payments.affiliates.getReferrals.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.payments.affiliates.getPayouts.queryKey() });
      toast.success("You're enrolled! Your referral link is ready.");
    },
    onError: () => toast.error("Failed to enrol"),
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const referralUrl = affiliate ? `${origin}/r/${affiliate.referralCode}` : "";

  const copyLink = () => {
    navigator.clipboard.writeText(referralUrl);
    toast.success("Link copied!");
  };

  if (isLoading || !brandId) {
    return (
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 300, color: "var(--ink-40)" }}>Loading…</div>
      </div>
    );
  }

  if (!affiliate) {
    return (
      <div className="page">
        <div className="page-hd">
          <div className="ttl">
            <span className="eye">AFFILIATE</span>
            <h1>Affiliate program.</h1>
            <span className="sub">Earn 0.5% of every dollar your referrals process.</span>
          </div>
        </div>
        <div className="pnl" style={{ maxWidth: 520, padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>💸</div>
          <h2 style={{ fontWeight: 800, fontSize: 24, marginBottom: 12 }}>You're not enrolled yet</h2>
          <p style={{ color: "var(--ink-60)", lineHeight: 1.6, marginBottom: 28 }}>
            Join the EziQuotes affiliate program and earn 0.5% of every dollar your referrals process — for life.
          </p>
          <button
            className="btn primary"
            onClick={() => registerMut.mutate({ brandId: brandId! })}
            disabled={registerMut.isPending}
          >
            {registerMut.isPending ? "Enrolling…" : "Join the program →"}
          </button>
        </div>
      </div>
    );
  }

  const totalVolume = referrals.reduce((s: number, r: any) => s + r.volumeCents, 0);

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">AFFILIATE</span>
          <h1>Affiliate dashboard.</h1>
          <span className="sub">Your referral link, earnings, and payout history.</span>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-row">
        <div className="kpi"><span className="lbl">LIFETIME EARNED</span><span className="num">{fmtAUD(affiliate.totalEarnedCents / 100)}</span></div>
        <div className="kpi"><span className="lbl">ACTIVE REFERRALS</span><span className="num">{affiliate.activeReferrals}</span></div>
        <div className="kpi"><span className="lbl">TOTAL REFERRALS</span><span className="num">{affiliate.totalReferrals}</span></div>
        <div className="kpi"><span className="lbl">VOLUME REFERRED</span><span className="num">{fmtAUD(totalVolume / 100)}</span></div>
      </div>

      {/* Referral link */}
      <div className="pnl">
        <div className="pnl-hd"><h3>Your referral link</h3><span className="meta">SHARE THIS LINK</span></div>
        <div className="pnl-body" style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 13, padding: "10px 14px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {referralUrl}
          </div>
          <button className="btn primary" onClick={copyLink}>Copy link</button>
          <button className="btn ghost" onClick={() => {
            const text = `I use EziQuotes to send professional proposals and get paid instantly. Try it free: ${referralUrl}`;
            navigator.clipboard.writeText(text);
            toast.success("Share text copied!");
          }}>Copy share text</button>
        </div>
      </div>

      {/* Referrals table */}
      <div className="pnl">
        <div className="pnl-hd"><h3>Your referrals</h3><span className="meta">{referrals.length} TOTAL</span></div>
        {referrals.length === 0 ? (
          <div className="pnl-body" style={{ textAlign: "center", color: "var(--ink-40)", padding: "40px 20px" }}>
            No referrals yet. Share your link to start earning.
          </div>
        ) : (
          <div className="pnl-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Referred</th>
                  <th>Status</th>
                  <th style={{ textAlign: "right" }}>Volume processed</th>
                  <th style={{ textAlign: "right" }}>Earned</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 500 }}>{r.referredName ?? r.referredEmail ?? "—"}</td>
                    <td><span className={`st ${r.status === "active" ? "connected" : r.status === "churned" ? "overdue" : "pending"}`}><span className="d" />{r.status}</span></td>
                    <td className="num">{fmtAUD(r.volumeCents / 100)}</td>
                    <td className="num">{fmtAUD(r.earnedCents / 100)}</td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {r.signedUpAt ? new Date(r.signedUpAt).toLocaleDateString("en-AU") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Payouts */}
      <div className="pnl">
        <div className="pnl-hd"><h3>Payout history</h3><span className="meta">MONTHLY · 1ST OF MONTH</span></div>
        {payouts.length === 0 ? (
          <div className="pnl-body" style={{ textAlign: "center", color: "var(--ink-40)", padding: "40px 20px" }}>
            No payouts yet. Minimum payout is $10.
          </div>
        ) : (
          <div className="pnl-body" style={{ padding: 0 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Status</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p: any, i: number) => (
                  <tr key={i}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {p.periodStart ? new Date(p.periodStart).toLocaleDateString("en-AU", { month: "short", year: "numeric" }) : "—"}
                    </td>
                    <td className="num"><b>{fmtAUD(p.amountCents / 100)}</b></td>
                    <td><span className={`st ${p.status === "paid" ? "paid" : p.status === "failed" ? "overdue" : "pending"}`}><span className="d" />{p.status}</span></td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-AU") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AF4: Affiliate signup page ──────────────────────────────────────────────

export function AffiliateSignup() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const registerMut = useMutation({
    ...trpc.payments.affiliates.register.mutationOptions(),
    onSuccess: () => {
      window.location.href = "/affiliate/dashboard";
    },
    onError: () => toast.error("Failed to enrol — please try again"),
  });
  const { data: user } = useCurrentUser();
  const userName = user ? [user.firstName, user.lastName].filter(Boolean).join(" ") : "";

  if (!user) {
    return (
      <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#F4F1E8", display: "grid", placeItems: "center", fontFamily: "var(--font-sans)" }}>
        <div style={{ maxWidth: 480, padding: 48, textAlign: "center" }}>
          <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 28, display: "block", marginBottom: 40 }} />
          <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 16 }}>Join the affiliate program</h1>
          <p style={{ color: "rgba(244,241,232,0.6)", lineHeight: 1.6, marginBottom: 32 }}>
            Sign in with your EziQuotes account to enrol and get your unique referral link.
          </p>
          <a href="/login" className="btn primary" style={{ fontSize: 16, padding: "14px 28px", textDecoration: "none" }}>
            Sign in to continue →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#0E0E0C", color: "#F4F1E8", display: "grid", placeItems: "center", fontFamily: "var(--font-sans)" }}>
      <div style={{ maxWidth: 520, padding: 48, textAlign: "center" }}>
        <img src="/logo-wordmark.svg" alt="EziQuotes" style={{ height: 28, display: "block", marginBottom: 40 }} />
        <div style={{ width: 80, height: 80, borderRadius: "50%", background: "#D9F542", display: "grid", placeItems: "center", margin: "0 auto 24px", fontSize: 36 }}>💸</div>
        <h1 style={{ fontSize: 32, fontWeight: 900, letterSpacing: "-0.03em", marginBottom: 16 }}>You're one click away</h1>
        <p style={{ color: "rgba(244,241,232,0.6)", lineHeight: 1.6, marginBottom: 12 }}>
          Signed in as <strong style={{ color: "#F4F1E8" }}>{userName || user.email}</strong>
        </p>
        <p style={{ color: "rgba(244,241,232,0.6)", lineHeight: 1.6, marginBottom: 32 }}>
          By enrolling, you agree to the affiliate program terms. You'll earn <strong style={{ color: "#D9F542" }}>0.5% of lifetime volume</strong> for every active referral.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 32 }}>
          {[
            { v: "0.5%", l: "Lifetime rate" },
            { v: "$10", l: "Min payout" },
            { v: "90d", l: "Cookie window" },
          ].map((s, i) => (
            <div key={i} style={{ padding: 16, border: "1px solid rgba(244,241,232,0.1)", borderRadius: 10 }}>
              <div style={{ fontSize: 28, fontWeight: 900, color: "#D9F542" }}>{s.v}</div>
              <div style={{ fontSize: 12, color: "rgba(244,241,232,0.6)", marginTop: 4 }}>{s.l}</div>
            </div>
          ))}
        </div>
        <button
          className="btn primary"
          style={{ width: "100%", fontSize: 16, padding: "14px 28px" }}
          onClick={() => registerMut.mutate({ brandId: brandId! })}
          disabled={registerMut.isPending || !brandId}
        >
          {registerMut.isPending ? "Enrolling…" : "Enrol and get my link →"}
        </button>
      </div>
    </div>
  );
}
