import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useState, useMemo } from "react";

const FILTERS = ["All", "Proposals", "Payments", "System"];
function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
function activityToItem(a: any, idx: number) {
  const action = (a.action ?? a.eventType ?? "").toLowerCase();
  let type = "System";
  let icon = "🔔";
  if (action.includes("proposal") || action.includes("sent") || action.includes("viewed") || action.includes("accepted")) { type = "Proposals"; icon = "📄"; }
  else if (action.includes("payment") || action.includes("paid") || action.includes("charge") || action.includes("invoice")) { type = "Payments"; icon = "💳"; }
  return {
    id: (a.id ?? idx) as string | number,
    type,
    icon,
    title: a.action ?? a.eventType ?? "Activity",
    body: a.detail ?? "",
    ts: a.occurredAt ? new Date(a.occurredAt).getTime() : Date.now(),
  };
}
export default function Inbox() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const [filter, setFilter] = useState("All");
  const [readIds, setReadIds] = useState<Set<string | number>>(new Set());
  const { data: activity } = useQuery({
    ...trpc.payments.accounts.recentActivity.queryOptions({ brandId: brandId!, limit: 50 }),
    enabled: !!brandId,
  });
  const items = useMemo(() => (activity ?? []).map((a: any, i: number) => activityToItem(a, i)), [activity]);
  const filtered = items.filter((i: any) => filter === "All" || i.type === filter);
  const unread = items.filter((i: any) => !readIds.has(i.id)).length;
  const markAllRead = () => setReadIds(new Set(Array.from(items.map((i: any) => i.id))));
  const markRead = (id: string | number) => setReadIds(prev => { const next = new Set(Array.from(prev)); next.add(id); return next; });

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">NOTIFICATIONS</span>
          <h1>Inbox. {unread > 0 && <span style={{ fontSize: 18, fontWeight: 500, color: "var(--ink-40)" }}>{unread} unread</span>}</h1>
          <span className="sub">Proposal opens, payment events, and system alerts.</span>
        </div>
        <div className="acts">
          {unread > 0 && (
            <button className="btn ghost" onClick={markAllRead}>Mark all read</button>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {FILTERS.map(f => (
          <button
            key={f}
            className={"chip" + (filter === f ? " on" : "")}
            onClick={() => setFilter(f)}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="pnl" style={{ padding: 0, overflow: "hidden" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px", textAlign: "center", color: "var(--ink-40)" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
            <p style={{ fontSize: 14 }}>No notifications in this category.</p>
          </div>
        ) : (
          filtered.map((item, idx) => (
            <div
              key={item.id}
              onClick={() => markRead(item.id)}
              style={{
                display: "flex",
                gap: 16,
                padding: "16px 24px",
                borderBottom: idx < filtered.length - 1 ? "1px solid var(--border-1)" : "none",
                background: readIds.has(item.id) ? "transparent" : "rgba(217,245,66,0.04)",
                cursor: "pointer",
                transition: "background 150ms",
              }}
            >
              <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{item.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: readIds.has(item.id) ? 400 : 600, color: "var(--ink)" }}>{item.title}</span>
                  {!readIds.has(item.id) && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#D9F542", flexShrink: 0 }} />
                  )}
                </div>
                <p style={{ fontSize: 13, color: "var(--ink-60)", margin: 0 }}>{item.body}</p>
              </div>
              <div style={{ fontSize: 12, color: "var(--ink-40)", flexShrink: 0, marginTop: 2 }}>
                {timeAgo(item.ts)}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Live activity from DB */}
      {activity && activity.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-40)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>Recent Activity</h2>
          <div className="pnl" style={{ padding: 0, overflow: "hidden" }}>
            {activity.map((a, idx) => (
              <div key={a.id} style={{
                display: "flex",
                gap: 12,
                padding: "12px 20px",
                borderBottom: idx < activity.length - 1 ? "1px solid var(--border-1)" : "none",
                fontSize: 13,
                color: "var(--ink-60)",
              }}>
                <span style={{ color: "var(--ink-40)", flexShrink: 0, minWidth: 60 }}>{timeAgo(new Date(a.occurredAt).getTime())}</span>
                <span>{a.eventType} — {a.entityType ?? ""} {a.entityId ?? ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
