import { useState } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { BlockRenderer } from "@/components/blocks/BlockRenderers";
import { ThankYouEditor } from "@/components/ThankYouEditor";

// Colour palette for template cards (cycles by index)
const CARD_COLOURS = ["#0F766E", "#4361EE", "#E9B44C", "#52B788", "#E76F51", "#7E5BEF", "#2A9D8F", "#1A2540"];
type FilterTab = "All" | "Active" | "Archived";
type PageTab = "templates" | "thankyou";


function ConfirmDelete({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, width: 380, border: "1px solid var(--border-1)" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>Delete "{name}"?</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--ink-60)" }}>This cannot be undone. Proposals that used this template will keep their existing content.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{ background: "#ef4444", color: "#fff", border: "none" }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Preview Drawer
// ---------------------------------------------------------------------------

function TemplatePreviewDrawer({
  templateId,
  templateName,
  onClose,
  onEdit,
}: {
  templateId: string;
  templateName: string;
  onClose: () => void;
  onEdit: () => void;
}) {
  const trpc = useTRPC();
  const { data: template, isLoading } = useQuery(
    trpc.payments.templates.get.queryOptions({ id: templateId })
  );

  // Parse blocks from template structure
  const blocks: any[] = (() => {
    if (!template) return [];
    const structure = (template as any).structure;
    if (!structure) return [];
    if (Array.isArray(structure)) return structure;
    if (structure.blocks && Array.isArray(structure.blocks)) return structure.blocks;
    return [];
  })();

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          zIndex: 400, backdropFilter: "blur(2px)",
          animation: "fadeIn 150ms ease-out",
        }}
      />
      {/* Drawer panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(680px, 90vw)",
        background: "var(--bg)", borderLeft: "1px solid var(--border-1)",
        zIndex: 401, display: "flex", flexDirection: "column",
        animation: "slideInRight 200ms cubic-bezier(0.23,1,0.32,1)",
        overflowY: "auto",
      }}>
        {/* Drawer header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "16px 20px",
          borderBottom: "1px solid var(--border-1)", position: "sticky", top: 0,
          background: "var(--bg)", zIndex: 10,
        }}>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--border-1)", background: "var(--card)", cursor: "pointer", display: "grid", placeItems: "center", flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--ink-60)", textTransform: "uppercase" }}>Template preview</div>
            <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{templateName}</div>
          </div>
          <button className="btn primary" onClick={onEdit} style={{ flexShrink: 0 }}>
            Open builder →
          </button>
        </div>

        {/* Drawer body */}
        <div style={{ flex: 1, padding: "20px 24px", overflowY: "auto" }}>
          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 80, background: "var(--border-1)", borderRadius: 10, animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          )}

          {!isLoading && blocks.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-40)" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>◻</div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>NO BLOCKS YET</div>
              <div style={{ fontSize: 13, color: "var(--ink-60)", marginBottom: 20 }}>This template has no blocks. Open the builder to add content.</div>
              <button className="btn primary" onClick={onEdit}>Open builder →</button>
            </div>
          )}

          {!isLoading && blocks.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Block count badge */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.12em", color: "var(--ink-60)" }}>
                  {blocks.length} BLOCK{blocks.length !== 1 ? "S" : ""} · READ-ONLY PREVIEW
                </div>
              </div>

              {/* Render each block using the shared BlockRenderer */}
              <div style={{
                background: "var(--card)", borderRadius: 12, border: "1px solid var(--border-1)",
                overflow: "hidden",
              }}>
                {blocks.map((block: any, idx: number) => (
                  <div
                    key={block.id ?? idx}
                    style={{
                      borderBottom: idx < blocks.length - 1 ? "1px solid var(--border-1)" : undefined,
                      pointerEvents: "none", // read-only
                      userSelect: "none",
                    }}
                  >
                    <BlockRenderer block={block} />
                  </div>
                ))}
              </div>

              {/* CTA at bottom */}
              <div style={{ textAlign: "center", paddingTop: 8 }}>
                <button className="btn primary" onClick={onEdit}>Edit this template →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Templates page
// ---------------------------------------------------------------------------

export default function Templates() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();
  const [pageTab, setPageTab] = useState<PageTab>("templates");
  const [filter, setFilter] = useState<FilterTab>("All");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: templates, refetch: refetchTemplates, isLoading } = useQuery({
    ...trpc.payments.templates.list.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const createMutation = useMutation(trpc.payments.templates.create.mutationOptions());
  const deleteMutation = useMutation(trpc.payments.templates.delete.mutationOptions());
  const duplicateMutation = useMutation(trpc.payments.templates.duplicate.mutationOptions());

  const allTemplates = (templates ?? []).map((t, i) => ({
    id: t.id,
    name: t.name,
    status: (t.status === "active" ? "Active" : "Archived") as "Active" | "Archived",
    color: CARD_COLOURS[i % CARD_COLOURS.length],
    updatedAt: (t as any).updatedAt ? new Date((t as any).updatedAt) : null,
  }));

  const filtered = allTemplates.filter(t => {
    if (filter !== "All" && t.status !== filter) return false;
    if (search && !t.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = {
    All: allTemplates.length,
    Active: allTemplates.filter(t => t.status === "Active").length,
    Archived: allTemplates.filter(t => t.status === "Archived").length,
  };

  const handleNewTemplate = async () => {
    if (!brandId) { toast.error("No active brand"); return; }
    try {
      const result = await createMutation.mutateAsync({ brandId, name: "New template", source: "scratch" });
      if (result?.id) navigate(`/templates/${result.id}/edit`);
    } catch {
      toast.error("Failed to create template");
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      refetchTemplates();
    } catch {
      toast.error("Failed to delete template");
    }
  };

  const handleDuplicate = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const result = await duplicateMutation.mutateAsync({ id });
      toast.success(`"${name}" duplicated`);
      refetchTemplates();
      if (result?.id) navigate(`/templates/${result.id}/edit`);
    } catch {
      toast.error("Failed to duplicate template");
    }
  };

  const formatRelative = (d: Date | null) => {
    if (!d) return "Never used";
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Updated today";
    if (days === 1) return "Updated yesterday";
    if (days < 7) return `Updated ${days}d ago`;
    if (days < 30) return `Updated ${Math.floor(days / 7)}w ago`;
    return `Updated ${Math.floor(days / 30)}mo ago`;
  };

  return (
    <div className="page">
      {deleteTarget && <ConfirmDelete name={deleteTarget.name} onConfirm={handleDelete} onCancel={() => setDeleteTarget(null)} />}
      {previewTarget && (
        <TemplatePreviewDrawer
          templateId={previewTarget.id}
          templateName={previewTarget.name}
          onClose={() => setPreviewTarget(null)}
          onEdit={() => { setPreviewTarget(null); navigate(`/templates/${previewTarget.id}/edit`); }}
        />
      )}

      <div className="page-hd">
        <div className="ttl">
          <span className="eye">YOUR WORKSPACE</span>
          <h1>Templates.</h1>
          <span className="sub">Reusable proposal shapes and post-payment experiences. Build once, use everywhere.</span>
        </div>
        <div className="acts">
          {pageTab === "templates" && (
            <button className="btn primary" onClick={handleNewTemplate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "+ New template"}
            </button>
          )}
        </div>
      </div>

      {/* Page tab switcher */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid var(--border-1)", paddingBottom: 0 }}>
        {(["templates", "thankyou"] as PageTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setPageTab(tab)}
            style={{
              padding: "8px 16px",
              fontSize: 13, fontWeight: 600,
              border: "none", background: "none",
              cursor: "pointer",
              color: pageTab === tab ? "var(--ink)" : "var(--ink-40)",
              borderBottom: pageTab === tab ? "2px solid var(--ink)" : "2px solid transparent",
              marginBottom: -1,
              transition: "color 150ms",
            }}
          >
            {tab === "templates" ? "Proposal templates" : "Thank-you pages"}
          </button>
        ))}
      </div>

      {pageTab === "thankyou" && <ThankYouEditor />}

      {/* Filters + grid — only shown on templates tab */}
      {pageTab === "templates" && <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        {(["All", "Active", "Archived"] as FilterTab[]).map(f => (
          <button
            key={f}
            className={"btn sm" + (filter === f ? " primary" : " ghost")}
            onClick={() => setFilter(f)}
          >
            {f} <span style={{ opacity: 0.6, marginLeft: 4 }}>{counts[f]}</span>
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ position: "relative" }}>
          <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.4 }} width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.2"/><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search templates…"
            style={{ paddingLeft: 30, paddingRight: 12, height: 32, fontSize: 13, border: "1px solid var(--border-1)", borderRadius: 8, background: "var(--card)", color: "var(--ink)", width: 200 }}
          />
        </div>
      </div>

      {isLoading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="pnl" style={{ padding: 0, overflow: "hidden" }}>
              <div style={{ height: 140, background: "var(--border-1)", animation: "pulse 1.5s ease-in-out infinite" }} />
              <div style={{ padding: 14 }}>
                <div style={{ height: 14, background: "var(--border-1)", borderRadius: 4, marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite" }} />
                <div style={{ height: 10, background: "var(--border-1)", borderRadius: 4, width: "60%", animation: "pulse 1.5s ease-in-out infinite" }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
          {filtered.map((t) => (
            <div
              key={t.id}
              className="pnl"
              style={{ padding: 0, overflow: "hidden", cursor: "pointer", position: "relative" }}
              onClick={() => setPreviewTarget({ id: t.id, name: t.name })}
            >
              {/* Duplicate button */}
              <button
                title="Duplicate template"
                onClick={e => handleDuplicate(t.id, t.name, e)}
                style={{
                  position: "absolute", top: 10, right: 42, zIndex: 10,
                  width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(0,0,0,0.12)",
                  background: "rgba(255,255,255,0.85)", cursor: "pointer", fontSize: 11,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#555", backdropFilter: "blur(4px)",
                  transition: "background 150ms",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(101,245,201,0.18)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.85)")}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="3" width="7" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2"/><path d="M4 3V2a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
              </button>
              {/* Delete button */}
              <button
                title="Delete template"
                onClick={e => { e.stopPropagation(); setDeleteTarget({ id: t.id, name: t.name }); }}
                style={{
                  position: "absolute", top: 10, right: 10, zIndex: 10,
                  width: 26, height: 26, borderRadius: 6, border: "1px solid rgba(0,0,0,0.12)",
                  background: "rgba(255,255,255,0.85)", cursor: "pointer", fontSize: 14,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#ef4444", backdropFilter: "blur(4px)",
                  transition: "background 150ms",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(239,68,68,0.12)")}
                onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.85)")}
              >×</button>
              <div style={{
                height: 140, background: `linear-gradient(135deg, ${t.color}22 0%, ${t.color}08 100%)`,
                position: "relative", padding: 14, display: "flex", flexDirection: "column", justifyContent: "flex-end"
              }}>
                <div style={{ position: "absolute", top: 12, left: 14, fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: t.color, fontWeight: 700 }}>TEMPLATE</div>
                <div style={{ position: "absolute", top: 10, right: 44 }}>
                  <span className={"st " + (t.status === "Active" ? "connected" : "")}>
                    <span className="d" />{t.status}
                  </span>
                </div>
                <div style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--ink-60)", letterSpacing: "0.04em" }}>{formatRelative(t.updatedAt)}</div>
              </div>
              <div style={{ padding: 14, borderTop: "1px solid var(--border-1)" }}>
                <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: "-0.01em", lineHeight: 1.2 }}>{t.name}</div>
                <div style={{ marginTop: 10, fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.06em", color: "var(--ink-60)" }}>
                  Click to preview →
                </div>
              </div>
            </div>
          ))}
          {/* New template card */}
          <div
            className="pnl"
            style={{ padding: 0, overflow: "hidden", cursor: "pointer", border: "2px dashed var(--border-2)" }}
            onClick={handleNewTemplate}
          >
            <div style={{ height: 140, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--ink-60)" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>New template</span>
            </div>
          </div>
        </div>
      )}
      {!isLoading && allTemplates.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--ink-40)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>◻</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em", marginBottom: 8 }}>NO TEMPLATES YET</div>
          <div style={{ fontSize: 13, color: "var(--ink-60)", marginBottom: 20 }}>Create your first template to reuse proposal structures across clients.</div>
          <button className="btn primary" onClick={handleNewTemplate}>+ Create first template</button>
        </div>
      )}
      {!isLoading && allTemplates.length > 0 && filtered.length === 0 && (
        <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--ink-40)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, letterSpacing: "0.1em" }}>NO RESULTS</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>Try a different search or filter.</div>
        </div>
      )}
      </> }
    </div>
  );
}
