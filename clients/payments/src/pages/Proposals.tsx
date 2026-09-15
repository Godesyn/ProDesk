import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { NavIcon } from "@/components/AppShell";
import { toast } from "sonner";
import { isProd } from "@/lib/env";

const fmtAmount = (n: number, currency?: string) => {
  const c = currency ?? "AUD";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: c, maximumFractionDigits: 0 }).format(n);
  } catch { return "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 }); }
};

const STATUS_FILTERS = ["All", "Draft", "Sent", "Viewed", "Accepted", "Paid", "Expired", "Declined"];

// Win score badge
function WinBadge({ score }: { score: number }) {
  const color = score >= 70 ? "#22c55e" : score >= 40 ? "#f59e0b" : "#ef4444";
  const bg = score >= 70 ? "#22c55e18" : score >= 40 ? "#f59e0b18" : "#ef444418";
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 700,
      fontFamily: "var(--font-mono)", color, background: bg, border: `1px solid ${color}40`,
    }}>
      {score}
    </span>
  );
}

function RowMenu({ proposalId, slug, onDelete, onDuplicate }: { proposalId: string; slug: string; onDelete: () => void; onDuplicate: () => void; }) {
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const copyLink = () => {
    const url = `${window.location.origin}/p/${slug}`;
    navigator.clipboard.writeText(url).then(() => toast.success("Link copied!")).catch(() => toast.error("Failed to copy"));
    setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="icon-only"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
      >
        <NavIcon name="more" />
      </button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
          background: "var(--card)", border: "1px solid var(--border-1)", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", minWidth: 160, padding: "4px 0",
        }}>
          {[
            { icon: "eye", label: "View", action: () => navigate(`/proposals/${proposalId}`) },
            { icon: "edit", label: "Edit", action: () => navigate(`/proposals/${proposalId}/edit`) },
            { icon: "duplicate", label: "Duplicate", action: () => { onDuplicate(); setOpen(false); } },
            { icon: "link", label: "Copy link", action: copyLink },
            { icon: "eye", label: "Preview as client", action: () => { window.open(`/p/${slug}`, "_blank"); setOpen(false); } },
            { icon: "trash", label: "Delete", action: () => { onDelete(); setOpen(false); }, danger: true },
          ].map(({ icon, label, action, danger }) => (
            <button
              key={label}
              onClick={(e) => { e.stopPropagation(); action(); }}
              style={{
                display: "flex", alignItems: "center", gap: 8, width: "100%",
                padding: "8px 14px", background: "none", border: "none", cursor: "pointer",
                fontSize: 13, color: danger ? "#E53E3E" : "var(--ink)",
                textAlign: "left",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-inset)")}
              onMouseLeave={e => (e.currentTarget.style.background = "none")}
            >
              <NavIcon name={icon} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick-peek preview drawer
// ---------------------------------------------------------------------------
function PreviewDrawer({ proposalId, onClose }: { proposalId: string; onClose: () => void }) {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const { data, isLoading } = useQuery(trpc.payments.proposals.get.queryOptions({ id: proposalId }));

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const p = data as any;
  const blocks: any[] = Array.isArray(p?.blocks) ? p.blocks : [];

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 300,
          animation: "fadeIn 150ms ease-out",
        }}
      />
      {/* Drawer */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(480px, 95vw)",
        background: "var(--card)", borderLeft: "1px solid var(--border-1)",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.18)", zIndex: 301,
        display: "flex", flexDirection: "column",
        animation: "slideInRight 200ms cubic-bezier(0.23,1,0.32,1)",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "16px 20px", borderBottom: "1px solid var(--border-1)", flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-40)", textTransform: "uppercase", marginBottom: 2 }}>
              Quick Preview
            </div>
            <div style={{ fontWeight: 700, fontSize: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {isLoading ? "Loading…" : (p?.title ?? "Untitled")}
            </div>
          </div>
          <button
            className="btn sm ghost"
            onClick={() => { onClose(); navigate(`/proposals/${proposalId}`); }}
            style={{ flexShrink: 0 }}
          >
            Open full
          </button>
          <button className="icon-only" onClick={onClose} style={{ flexShrink: 0 }}>
            <NavIcon name="close" />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 60, borderRadius: 8, background: "var(--bg-inset)", animation: "pulse 1.5s infinite" }} />
              ))}
            </div>
          )}
          {!isLoading && p && (
            <>
              {/* Meta row */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <span className={`st ${p.status}`}><span className="d" />{p.status}</span>
                {(p.winScore ?? 0) > 0 && <WinBadge score={p.winScore} />}
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)" }}>
                  {fmtAmount(Number(p.totalCents ?? 0) / 100, p.currency)}
                </span>
              </div>

              {/* Client info */}
              {(p.clientName || p.clientEmail) && (
                <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-inset)", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-40)", textTransform: "uppercase", marginBottom: 6 }}>Payer</div>
                  <div style={{ fontWeight: 600 }}>{p.clientName || "—"}</div>
                  {p.clientCompany && <div style={{ fontSize: 12, color: "var(--ink-60)" }}>{p.clientCompany}</div>}
                  {p.clientEmail && <div style={{ fontSize: 12, color: "var(--ink-60)" }}>{p.clientEmail}</div>}
                </div>
              )}

              {/* Key dates */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
                {[
                  { label: "Sent", val: p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-AU") : "—" },
                  { label: "Accepted", val: p.acceptedAt ? new Date(p.acceptedAt).toLocaleDateString("en-AU") : "—" },
                  { label: "Paid", val: p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-AU") : "—" },
                  { label: "Expires", val: p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("en-AU") : "—" },
                ].map(({ label, val }) => (
                  <div key={label} style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg-inset)" }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-40)", textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Blocks summary */}
              {blocks.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-40)", textTransform: "uppercase", marginBottom: 8 }}>
                    Content ({blocks.length} blocks)
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {blocks.slice(0, 8).map((block: any, i: number) => (
                      <div key={i} style={{
                        padding: "8px 12px", borderRadius: 6, background: "var(--bg-inset)",
                        display: "flex", alignItems: "center", gap: 8,
                      }}>
                        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "var(--ink-40)", textTransform: "uppercase", flexShrink: 0, width: 60 }}>
                          {block.type ?? "block"}
                        </span>
                        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-80)" }}>
                          {block.heading ?? block.title ?? block.label ?? "—"}
                        </span>
                      </div>
                    ))}
                    {blocks.length > 8 && (
                      <div style={{ fontSize: 12, color: "var(--ink-40)", textAlign: "center", paddingTop: 4 }}>
                        +{blocks.length - 8} more blocks
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Engagement stats */}
              {(p.viewCount != null || p.scrollDepth != null) && (
                <div style={{ padding: "12px 14px", borderRadius: 8, background: "var(--bg-inset)", marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--ink-40)", textTransform: "uppercase", marginBottom: 8 }}>Engagement</div>
                  <div style={{ display: "flex", gap: 16 }}>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{p.viewCount ?? 0}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-60)" }}>views</div>
                    </div>
                    {p.scrollDepth != null && (
                      <div>
                        <div style={{ fontSize: 20, fontWeight: 800, fontFamily: "var(--font-mono)" }}>{p.scrollDepth}%</div>
                        <div style={{ fontSize: 11, color: "var(--ink-60)" }}>scroll depth</div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Applied fee */}
              {p.appliedFeePercentage != null && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--bg-inset)", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: "var(--ink-60)" }}>Platform fee</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 700 }}>{Number(p.appliedFeePercentage).toFixed(1)}%</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border-1)", display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            className="btn primary"
            style={{ flex: 1 }}
            onClick={() => { onClose(); navigate(`/proposals/${proposalId}`); }}
          >
            Open proposal
          </button>
          <button
            className="btn ghost"
            onClick={() => { window.open(`/p/${p?.slug}`, "_blank"); }}
            disabled={!p?.slug}
          >
            Client view
          </button>
        </div>
      </div>
    </>
  );
}

export default function Proposals() {
  const [, navigate] = useLocation();
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = useBrandId();
  const { data, isLoading } = useQuery({
    ...trpc.payments.proposals.list.queryOptions({
      brandId: brandId!,
      offset: (page - 1) * 20,
      limit: 20,
      status: statusFilter === "All" ? undefined : statusFilter.toLowerCase(),
      search: search || undefined,
    }),
    enabled: !!brandId,
  });

  const duplicateMutation = useMutation({
    ...trpc.payments.proposals.duplicate.mutationOptions(),
    onSuccess: (res) => {
      toast.success("Proposal duplicated — opening draft");
      qc.invalidateQueries({ queryKey: trpc.payments.proposals.list.queryKey() });
      navigate(`/proposals/${res.proposalId}/edit`);
    },
    onError: () => toast.error("Failed to duplicate"),
  });

  const deleteProposal = useMutation({
    ...trpc.payments.proposals.delete.mutationOptions(),
    onSuccess: () => {
      toast.success("Proposal deleted");
      qc.invalidateQueries({ queryKey: trpc.payments.proposals.list.queryKey() });
      setDeletingId(null);
    },
    onError: () => toast.error("Failed to delete"),
  });

  const proposals = data?.rows ?? [];

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">PROPOSALS · {data?.total ?? 0} TOTAL</span>
          <h1>Proposals.</h1>
          <span className="sub">Everything you've sent. Click any row to preview it. Double-click to open. Filter by status, model, value, or team.</span>
        </div>
        <div className="acts">
          {!isProd && (
            <button className="btn ghost" onClick={() => toast.info("Export coming soon")}>
              <NavIcon name="download" />Export CSV
            </button>
          )}
          <button className="btn primary" onClick={() => navigate("/proposals/new")}>
            <NavIcon name="plus" />New proposal
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={"chip" + (statusFilter === s ? " on" : "")}
            onClick={() => { setStatusFilter(s); setPage(1); }}
          >
            {s}
          </button>
        ))}
        <span className="sep" />
        <span className="grow" />
        <div className="search">
          <NavIcon name="search" />
          <input
            placeholder="Search by client or name"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table — desktop */}
      <div className="pnl hidden md:block" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Proposal</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th>Status</th>
              <th>Score</th>
              <th>Sent</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "32px 0", color: "var(--ink-60)" }}>Loading…</td></tr>
            )}
            {!isLoading && proposals.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "48px 0" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--ink-60)" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bg-inset)", display: "grid", placeItems: "center" }}>
                      <NavIcon name="proposals" />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>No proposals yet</div>
                    <div style={{ fontSize: 13, maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>
                      Create your first proposal and start winning clients.
                    </div>
                    <button className="btn primary" onClick={() => navigate("/proposals/new")}>
                      <NavIcon name="plus" />New proposal
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {proposals.map((p: any) => {
              const initials = p.clientName
                ? p.clientName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                : "??";
              return (
                <tr
                  key={p.id}
                  onClick={() => setPreviewId(p.id)}
                  onDoubleClick={() => navigate(`/proposals/${p.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <div className="client">
                      <div className="avt">{initials}</div>
                      <div>
                        <div className="nm">{p.clientName || "—"}</div>
                        <div className="sub">{p.clientCompany || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ maxWidth: 260 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
                      <span style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.title}</span>
                      {(() => {
                        const exp = p.expiresAt ? new Date(p.expiresAt) : null;
                        const now = new Date();
                        if (exp && exp < now && p.status !== "accepted" && p.status !== "paid") {
                          return <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "#ef444418", color: "#ef4444", border: "1px solid #ef444440" }}>EXPIRED</span>;
                        }
                        if (exp && exp > now && exp.getTime() - now.getTime() < 3 * 86400000) {
                          return <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, padding: "1px 5px", borderRadius: 4, background: "#f59e0b18", color: "#f59e0b", border: "1px solid #f59e0b40" }}>EXPIRING</span>;
                        }
                        return null;
                      })()}
                    </div>
                  </td>
                  <td className="num"><b style={{ fontWeight: 700 }}>{fmtAmount(Number(p.totalCents ?? 0) / 100, p.currency)}</b></td>
                  <td><span className={`st ${p.status}`}><span className="d" />{p.status}</span></td>
                  <td>
                    {(p.winScore ?? 0) > 0 ? <WinBadge score={p.winScore ?? 0} /> : <span style={{ color: "var(--ink-40)", fontSize: 12 }}>—</span>}
                  </td>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                    {p.sentAt ? new Date(p.sentAt).toLocaleDateString("en-AU") : "—"}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <RowMenu
                      proposalId={p.id}
                      slug={p.slug}
                      onDelete={() => setDeletingId(p.id)}
                      onDuplicate={() => duplicateMutation.mutate({ id: p.id })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      <div className="block md:hidden">
        {isLoading && (
          <div className="pnl" style={{ padding: "32px 16px", textAlign: "center", color: "var(--ink-60)" }}>Loading…</div>
        )}
        {!isLoading && proposals.length === 0 && (
          <div className="pnl" style={{ padding: "48px 16px", textAlign: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--ink-60)" }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>No proposals yet</div>
              <button className="btn primary" onClick={() => navigate("/proposals/new")}>
                <NavIcon name="plus" />New proposal
              </button>
            </div>
          </div>
        )}
        {proposals.map((p: any) => {
          const initials = p.clientName
            ? p.clientName.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
            : "??";
          return (
            <div key={p.id} className="pnl" style={{ padding: "14px 16px", marginBottom: 8, cursor: "pointer" }} onClick={() => setPreviewId(p.id)}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div className="avt" style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--ink)", color: "var(--paper)", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>{initials}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 2 }}>{p.clientName || "—"}{p.clientCompany ? ` · ${p.clientCompany}` : ""}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{fmtAmount(Number(p.totalCents ?? 0) / 100, p.currency)}</div>
                  <span className={`st ${p.status}`} style={{ fontSize: 10 }}><span className="d" />{p.status}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {data && data.total > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--ink-60)", letterSpacing: "0.06em" }}>
          <span>SHOWING {proposals.length} OF {data.total}</span>
          <div style={{ display: "flex", gap: 8 }}>
            {page > 1 && <button className="btn sm" onClick={() => setPage(p => p - 1)}>← Prev</button>}
            {data.total > page * 20 && <button className="btn sm" onClick={() => setPage(p => p + 1)}>Next →</button>}
          </div>
        </div>
      )}

      {/* Delete confirm dialog */}
      {deletingId !== null && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "grid", placeItems: "center", zIndex: 200 }}>
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, maxWidth: 380, width: "90%", border: "1px solid var(--border-1)" }}>
            <h3 style={{ margin: "0 0 10px" }}>Delete proposal?</h3>
            <p style={{ fontSize: 14, color: "var(--ink-60)", margin: "0 0 20px", lineHeight: 1.5 }}>
              This will permanently delete the proposal and all associated data. This action cannot be undone.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setDeletingId(null)}>Cancel</button>
              <button
                className="btn"
                style={{ background: "#E53E3E", color: "white", border: "none" }}
                onClick={() => deleteProposal.mutate({ id: deletingId })}
                disabled={deleteProposal.isPending}
              >
                {deleteProposal.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick-peek preview drawer */}
      {previewId !== null && (
        <PreviewDrawer proposalId={previewId} onClose={() => setPreviewId(null)} />
      )}
    </div>
  );
}
