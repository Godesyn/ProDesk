import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";

function timeAgo(ts: Date | number) {
  const diff = Date.now() - (ts instanceof Date ? ts.getTime() : ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts instanceof Date ? ts : ts).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

const EVENT_ICON: Record<string, string> = {
  proposal_created: "📝",
  proposal_sent: "📤",
  proposal_viewed: "👁",
  proposal_engaged: "🔥",
  proposal_accepted: "✅",
  proposal_paid: "💰",
  proposal_disputed: "⚠️",
  proposal_refunded: "↩️",
  nudge_sent: "💬",
  payment_failed: "❌",
  payment_recovered: "🔄",
  client_created: "👤",
  template_created: "📋",
};

const DEMO_ACTIVITY = [
  { id: 1, eventType: "proposal_viewed",   entityType: "proposal", entityId: "Brand & Web v2",      actorType: "payer",  actorId: "Sarah Chen",   occurredAt: new Date(Date.now() - 41 * 60000) },
  { id: 2, eventType: "payment_failed",    entityType: "payment",  entityId: "$2,685",              actorType: "system",  actorId: null,           occurredAt: new Date(Date.now() - 90 * 60000) },
  { id: 3, eventType: "proposal_accepted", entityType: "proposal", entityId: "Northshore Lawn Care", actorType: "payer", actorId: "Marcus Lowe",  occurredAt: new Date(Date.now() - 24 * 3600000) },
  { id: 4, eventType: "proposal_sent",     entityType: "proposal", entityId: "Interior Refresh v1", actorType: "user",    actorId: "You",          occurredAt: new Date(Date.now() - 2 * 24 * 3600000) },
  { id: 5, eventType: "payer_created",    entityType: "payer",   entityId: "Tessa Brink",         actorType: "user",    actorId: "You",          occurredAt: new Date(Date.now() - 3 * 24 * 3600000) },
  { id: 6, eventType: "proposal_paid",     entityType: "proposal", entityId: "SEO Retainer Q1",     actorType: "payer",  actorId: "Raj Patel",    occurredAt: new Date(Date.now() - 5 * 24 * 3600000) },
];

export default function Activity() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: activity, isLoading } = useQuery({
    ...trpc.payments.accounts.recentActivity.queryOptions({ brandId: brandId!, limit: 50 }),
    enabled: !!brandId,
  });

  const items = (activity && activity.length > 0)
    ? activity.map(a => ({
        id: a.id,
        eventType: a.eventType,
        entityType: a.entityType,
        entityId: a.entityId,
        actorType: a.actorType,
        actorId: a.actorId,
        occurredAt: a.occurredAt,
      }))
    : DEMO_ACTIVITY;

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">TIMELINE</span>
          <h1>Activity.</h1>
          <span className="sub">Every event across proposals, payments, and clients — in order.</span>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "var(--ink-40)" }}>
          <div style={{ fontSize: 13 }}>Loading activity…</div>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          {/* Timeline line */}
          <div style={{
            position: "absolute",
            left: 19,
            top: 8,
            bottom: 8,
            width: 2,
            background: "var(--border-1)",
            borderRadius: 1,
          }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {items.map((item, idx) => (
              <div key={item.id} style={{
                display: "flex",
                gap: 20,
                paddingBottom: idx < items.length - 1 ? 24 : 0,
                position: "relative",
              }}>
                {/* Dot */}
                <div style={{
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  background: "var(--bg-card)",
                  border: "2px solid var(--border-2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  flexShrink: 0,
                  zIndex: 1,
                }}>
                  {EVENT_ICON[item.eventType ?? ''] ?? "📌"}
                </div>

                {/* Content */}
                <div style={{ flex: 1, paddingTop: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: "var(--ink)", textTransform: "capitalize" }}>
                      {item.eventType ?? ''.replace(/_/g, " ")}
                    </span>
                    {item.entityId && (
                      <span style={{ fontSize: 13, color: "var(--ink-60)" }}>— {item.entityId}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-40)", display: "flex", gap: 8 }}>
                    {item.actorId && <span>{item.actorId}</span>}
                    <span>·</span>
                    <span>{timeAgo(item.occurredAt)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
