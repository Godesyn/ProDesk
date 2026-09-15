/**
 * Client Portal Dashboard
 * Shows active subscriptions, upcoming payments, and proposal history for a client.
 * Route: /client-portal
 * Auth: sessionStorage token (magic-link based)
 */
import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useConfirm } from "@shared/components/ui/confirm-dialog";
import { useQuery, useMutation } from "@tanstack/react-query";

// ─── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    paid: { bg: "#dcfce7", text: "#166534" },
    active: { bg: "#dcfce7", text: "#166534" },
    accepted: { bg: "#dbeafe", text: "#1e40af" },
    sent: { bg: "#fef9c3", text: "#854d0e" },
    draft: { bg: "#f3f4f6", text: "#374151" },
    expired: { bg: "#fee2e2", text: "#991b1b" },
    cancelled: { bg: "#fee2e2", text: "#991b1b" },
    past_due: { bg: "#fee2e2", text: "#991b1b" },
  };
  const c = colors[status] ?? { bg: "#f3f4f6", text: "#374151" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      background: c.bg,
      color: c.text,
    }}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Section card ──────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      padding: "24px",
      boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function ClientPortal() {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const [, navigate] = useLocation();
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "proposals" | "payments">("overview");
  const [portalLoading, setPortalLoading] = useState(false);

  const billingPortal = useMutation({
    ...trpc.payments.clientPortal.createBillingPortalSession.mutationOptions(),
    onSuccess: (data) => {
      setPortalLoading(false);
      window.open(data.url, "_blank");
    },
    onError: () => setPortalLoading(false),
  });

  const handleManageSubscription = () => {
    if (!sessionToken || portalLoading) return;
    setPortalLoading(true);
    billingPortal.mutate({
      sessionToken,
      returnUrl: window.location.href,
    });
  };

  useEffect(() => {
    const token = sessionStorage.getItem("cp_session_token");
    if (!token) {
      navigate("/client-portal/login");
    } else {
      setSessionToken(token);
    }
  }, []);

  const { data, isLoading, error } = useQuery({
    ...trpc.payments.clientPortal.getPortalData.queryOptions({ sessionToken: sessionToken ?? "" }),
    enabled: !!sessionToken,
    retry: false,
  });

  const handleLogout = async () => {
    if (!(await confirm({
      title: "Sign out?",
      description: "You’ll need your magic link to sign back in.",
      confirmLabel: "Sign out",
      destructive: true,
    }))) return;
    sessionStorage.removeItem("cp_session_token");
    sessionStorage.removeItem("cp_client_id");
    sessionStorage.removeItem("cp_account_id");
    navigate("/client-portal/login");
  };

  if (!sessionToken || isLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F4F1E8",
      }}>
        <div style={{ textAlign: "center" }}>
          <div style={{
            width: 40, height: 40, borderRadius: "50%",
            border: "3px solid rgba(14,14,12,0.1)",
            borderTopColor: "#0E0E0C",
            animation: "spin 700ms linear infinite",
            margin: "0 auto 16px",
          }} />
          <p style={{ fontSize: 14, color: "#666", margin: 0, fontFamily: "system-ui, sans-serif" }}>Loading your portal…</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#F4F1E8",
        padding: 24,
        fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{ textAlign: "center", maxWidth: 400 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>Session expired</h2>
          <p style={{ margin: "0 0 24px", color: "#666", fontSize: 14 }}>
            Your session has expired. Please log in again.
          </p>
          <a
            href="/client-portal/login"
            style={{
              display: "inline-block",
              padding: "12px 24px",
              background: "#0E0E0C",
              color: "#D9F542",
              borderRadius: 8,
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Log in again
          </a>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const s = {
    page: { minHeight: "100vh", background: "#F4F1E8", fontFamily: "system-ui, -apple-system, sans-serif" },
    header: {
      background: "#0E0E0C",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    container: { maxWidth: 900, margin: "0 auto", padding: "32px 24px" },
    tabs: { display: "flex", gap: 4, marginBottom: 28, borderBottom: "1px solid #e0ddd4", paddingBottom: 0 },
    tab: (active: boolean): React.CSSProperties => ({
      padding: "10px 16px",
      background: "none",
      border: "none",
      borderBottom: active ? "2px solid #0E0E0C" : "2px solid transparent",
      cursor: "pointer",
      fontSize: 14,
      fontWeight: active ? 600 : 400,
      color: active ? "#0E0E0C" : "#888",
      marginBottom: -1,
      transition: "all 150ms",
    }),
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 6,
            background: "linear-gradient(135deg, #D9F542 0%, #a8e020 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 900, color: "#0E0E0C",
          }}>P</div>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
            {data.account.businessName}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, color: "#D9F542",
            background: "rgba(217,245,66,0.12)",
            padding: "2px 7px", borderRadius: 4, letterSpacing: "0.08em", textTransform: "uppercase",
          }}>Client Portal</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, color: "rgba(255,255,255,0.6)" }}>
            {data.client.name}
          </span>
          <button
            onClick={() => void handleLogout()}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.7)",
              padding: "6px 14px",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <div style={s.container}>
        {/* Welcome */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700, color: "#0E0E0C", letterSpacing: "-0.02em" }}>
            Hi {data.client.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p style={{ margin: 0, color: "#666", fontSize: 14 }}>
            Your account with {data.account.businessName}
          </p>
        </div>

        {/* Summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 32 }}>
          <Card>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Active subscriptions</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#0E0E0C" }}>{data.activeSubscriptions.length}</div>
          </Card>
          <Card>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Total proposals</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#0E0E0C" }}>{data.proposals.length}</div>
          </Card>
          <Card>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#888", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8 }}>Payments made</div>
            <div style={{ fontSize: 32, fontWeight: 700, color: "#0E0E0C" }}>{data.recentPayments.length}</div>
          </Card>
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {(["overview", "proposals", "payments"] as const).map((t) => (
            <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview tab */}
        {tab === "overview" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Active subscriptions */}
            <Card>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>Active subscriptions</h3>
              {data.activeSubscriptions.length === 0 ? (
                <p style={{ margin: 0, color: "#999", fontSize: 14 }}>No active subscriptions.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {data.activeSubscriptions.map((sub: any) => (
                    <div key={sub.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "14px 16px",
                      background: "#F9F8F4",
                      borderRadius: 8,
                      border: "1px solid #e8e5dc",
                    }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#0E0E0C" }}>{sub.title}</div>
                        <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>
                          {sub.billingInterval} · started {sub.startedAt ? new Date(sub.startedAt).toLocaleDateString() : "—"}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "#0E0E0C" }}>{sub.monthlyAmountFormatted}</div>
                        <div style={{ fontSize: 11, color: "#888" }}>/ {sub.billingInterval}</div>
                        <button
                          onClick={handleManageSubscription}
                          disabled={portalLoading}
                          style={{
                            padding: "5px 10px",
                            background: "none",
                            border: "1px solid #d0cdc4",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#555",
                            cursor: portalLoading ? "not-allowed" : "pointer",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {portalLoading ? "Loading…" : "Manage →"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Upcoming payment plan payments */}
            {data.upcomingPayments.length > 0 && (
              <Card>
                <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>Payment plans</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {data.upcomingPayments.map((plan: any) => (
                    <div key={plan.id} style={{
                      padding: "14px 16px",
                      background: "#F9F8F4",
                      borderRadius: 8,
                      border: "1px solid #e8e5dc",
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#0E0E0C" }}>{plan.title}</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: "#0E0E0C" }}>{plan.totalFormatted}</div>
                      </div>
                      {/* Progress bar */}
                      <div style={{ background: "#e8e5dc", borderRadius: 4, height: 6, marginBottom: 8 }}>
                        <div style={{
                          background: "#0E0E0C",
                          borderRadius: 4,
                          height: 6,
                          width: `${(plan.paidCount / plan.installments) * 100}%`,
                          transition: "width 400ms ease",
                        }} />
                      </div>
                      <div style={{ fontSize: 12, color: "#888" }}>
                        {plan.paidCount} of {plan.installments} payments made · {plan.remaining} remaining ({plan.installmentFormatted} each)
                        {plan.nextDueDate && ` · Next due ${new Date(plan.nextDueDate).toLocaleDateString()}`}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Recent payments */}
            <Card>
              <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>Recent payments</h3>
              {data.recentPayments.length === 0 ? (
                <p style={{ margin: 0, color: "#999", fontSize: 14 }}>No payments yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                  {data.recentPayments.map((pay: any, i: number) => (
                    <div key={pay.id} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "12px 0",
                      borderBottom: i < data.recentPayments.length - 1 ? "1px solid #f0ede4" : "none",
                    }}>
                      <div>
                        <div style={{ fontSize: 14, color: "#0E0E0C" }}>{pay.proposalTitle}</div>
                        <div style={{ fontSize: 12, color: "#999" }}>
                          {pay.paidAt ? new Date(pay.paidAt).toLocaleDateString() : new Date(pay.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <StatusBadge status={pay.status} />
                        <span style={{ fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>{pay.amountFormatted}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            {/* Manage payment method — always shown when a Stripe customer exists */}
            {data.hasStripeCustomer && (
              <Card>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>Payment method</h3>
                    <p style={{ margin: 0, color: "#999", fontSize: 13 }}>Update your card, view invoices, or manage billing details.</p>
                  </div>
                  <button
                    onClick={handleManageSubscription}
                    disabled={portalLoading}
                    style={{
                      padding: "10px 18px",
                      background: "#0E0E0C",
                      color: "#D9F542",
                      border: "none",
                      borderRadius: 8,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: portalLoading ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                      opacity: portalLoading ? 0.6 : 1,
                    }}
                  >
                    {portalLoading ? "Loading…" : "Manage →"}
                  </button>
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Proposals tab */}
        {tab === "proposals" && (
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>All proposals</h3>
            {data.proposals.length === 0 ? (
              <p style={{ margin: 0, color: "#999", fontSize: 14 }}>No proposals yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {data.proposals.map((p: any, i: number) => (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 0",
                    borderBottom: i < data.proposals.length - 1 ? "1px solid #f0ede4" : "none",
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0E0E0C", marginBottom: 2 }}>{p.title}</div>
                      <div style={{ fontSize: 12, color: "#999" }}>
                        {p.paymentModel.replace(/_/g, " ")} · {new Date(p.createdAt).toLocaleDateString()}
                        {p.expiresAt && new Date(p.expiresAt) > new Date() && (
                          <span style={{ color: "#d97706" }}> · Expires {new Date(p.expiresAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
                      <StatusBadge status={p.status} />
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#0E0E0C", minWidth: 80, textAlign: "right" }}>
                        {p.totalFormatted}
                      </span>
                      {(p.status === "sent" || p.status === "viewed" || p.status === "engaged") && (
                        <a
                          href={`/p/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: "inline-block",
                            padding: "6px 12px",
                            background: "#0E0E0C",
                            color: "#D9F542",
                            borderRadius: 6,
                            textDecoration: "none",
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          View →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Payments tab */}
        {tab === "payments" && (
          <Card>
            <h3 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, color: "#0E0E0C" }}>Payment history</h3>
            {data.recentPayments.length === 0 ? (
              <p style={{ margin: 0, color: "#999", fontSize: 14 }}>No payments yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {data.recentPayments.map((pay: any, i: number) => (
                  <div key={pay.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "14px 0",
                    borderBottom: i < data.recentPayments.length - 1 ? "1px solid #f0ede4" : "none",
                  }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#0E0E0C" }}>{pay.proposalTitle}</div>
                      <div style={{ fontSize: 12, color: "#999" }}>
                        {pay.paidAt ? new Date(pay.paidAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <StatusBadge status={pay.status} />
                      <span style={{ fontSize: 16, fontWeight: 700, color: "#0E0E0C" }}>{pay.amountFormatted}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
