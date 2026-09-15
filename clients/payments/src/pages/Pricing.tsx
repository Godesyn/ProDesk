import { useState } from "react";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { isProd } from "@/lib/env";

function fmtAUD(cents: number) {
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(cents);
}

type Tab = "products" | "addons" | "tables" | "quicksets";
type ProductUnit = "month" | "quarter" | "year" | "project" | "hour" | "item" | "custom";
type AddonType = "one_off" | "recurring";

interface EditProductState { id: string; name: string; basePriceCents: number; category: string; unit: ProductUnit; }
interface EditAddonState { id: string; name: string; priceCents: number; type: AddonType; }
interface EditQSState { id: string; name: string; defaultPaymentModel: "one_off" | "subscription" | "payment_plan"; productIds: string[]; }

function ActionMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        className="icon-only"
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      >⋯</button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 100,
          background: "var(--card)", border: "1px solid var(--border-1)", borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)", minWidth: 130, overflow: "hidden",
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <button
      style={{
        display: "block", width: "100%", textAlign: "left", padding: "9px 14px",
        background: "none", border: "none", cursor: "pointer", fontSize: 13,
        color: danger ? "#ef4444" : "var(--ink)", fontFamily: "inherit",
      }}
      onMouseEnter={e => (e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "var(--paper)")}
      onMouseLeave={e => (e.currentTarget.style.background = "none")}
      onClick={onClick}
    >{label}</button>
  );
}

function ConfirmDelete({ name, onConfirm, onCancel }: { name: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, width: 380, border: "1px solid var(--border-1)" }}>
        <h3 style={{ margin: "0 0 8px", fontSize: 17 }}>Delete "{name}"?</h3>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--ink-60)" }}>This action cannot be undone. Proposals using this item will retain their existing data.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{ background: "#ef4444", color: "#fff", border: "none" }} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function Pricing() {
  const trpc = useTRPC();
  const brandId = useBrandId();
  const [tab, setTab] = useState<Tab>("products");

  // Products
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategory, setNewCategory] = useState("General");
  const [editProduct, setEditProduct] = useState<EditProductState | null>(null);
  const [deleteProductTarget, setDeleteProductTarget] = useState<{ id: string; name: string } | null>(null);
  const { data: products, refetch: refetchProducts } = useQuery({
    ...trpc.payments.pricing.listProducts.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const createProduct = useMutation(trpc.payments.pricing.createProduct.mutationOptions());
  const updateProduct = useMutation(trpc.payments.pricing.updateProduct.mutationOptions());
  const deleteProductMut = useMutation(trpc.payments.pricing.deleteProduct.mutationOptions());

  // Add-ons
  const [showNewAddon, setShowNewAddon] = useState(false);
  const [newAddonName, setNewAddonName] = useState("");
  const [newAddonPrice, setNewAddonPrice] = useState("");
  const [newAddonType, setNewAddonType] = useState<AddonType>("one_off");
  const [editAddon, setEditAddon] = useState<EditAddonState | null>(null);
  const [deleteAddonTarget, setDeleteAddonTarget] = useState<{ id: string; name: string } | null>(null);
  const { data: addons, refetch: refetchAddons } = useQuery({
    ...trpc.payments.pricing.listAddons.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const createAddon = useMutation(trpc.payments.pricing.createAddon.mutationOptions());
  const updateAddon = useMutation(trpc.payments.pricing.updateAddon.mutationOptions());
  const deleteAddonMut = useMutation(trpc.payments.pricing.deleteAddon.mutationOptions());

  // Quick sets
  const { data: quickSets, refetch: refetchQuickSets } = useQuery({
    ...trpc.payments.pricing.listQuickSets.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const [showNewQS, setShowNewQS] = useState(false);
  const [newQSName, setNewQSName] = useState("");
  const [newQSModel, setNewQSModel] = useState<"one_off" | "subscription" | "payment_plan">("one_off");
  const [newQSProductIds, setNewQSProductIds] = useState<string[]>([]);
  const [editQS, setEditQS] = useState<EditQSState | null>(null);
  const [deleteQSTarget, setDeleteQSTarget] = useState<{ id: string; name: string } | null>(null);
  const createQS = useMutation(trpc.payments.pricing.createQuickSet.mutationOptions());
  const updateQS = useMutation(trpc.payments.pricing.updateQuickSet.mutationOptions());
  const deleteQSMut = useMutation(trpc.payments.pricing.deleteQuickSet.mutationOptions());

  const allProducts = products ?? [];
  const allAddons = addons ?? [];
  const allQS = quickSets ?? [];

  const handleCreate = async () => {
    if (!newName.trim()) return;
    if (!brandId) { toast.error("No active brand"); return; }
    try {
      await createProduct.mutateAsync({ brandId, name: newName, description: "", basePriceCents: Math.round(parseFloat(newPrice || "0") * 100), unit: "project" as const, category: newCategory });
      toast.success("Product created");
      setShowNewProduct(false); setNewName(""); setNewPrice(""); setNewCategory("General");
      refetchProducts();
    } catch { toast.error("Failed to create product"); }
  };

  const handleUpdateProduct = async () => {
    if (!editProduct) return;
    try {
      await updateProduct.mutateAsync({ id: editProduct.id, name: editProduct.name, basePriceCents: editProduct.basePriceCents, category: editProduct.category, unit: editProduct.unit as ProductUnit });
      toast.success("Product updated");
      setEditProduct(null);
      refetchProducts();
    } catch { toast.error("Failed to update product"); }
  };

  const handleDeleteProduct = async () => {
    if (!deleteProductTarget) return;
    try {
      await deleteProductMut.mutateAsync({ id: deleteProductTarget.id });
      toast.success("Product deleted");
      setDeleteProductTarget(null);
      refetchProducts();
    } catch { toast.error("Failed to delete product"); }
  };

  const handleCreateAddon = async () => {
    if (!newAddonName.trim()) return;
    if (!brandId) { toast.error("No active brand"); return; }
    try {
      await createAddon.mutateAsync({ brandId, name: newAddonName, priceCents: Math.round(parseFloat(newAddonPrice || "0") * 100), type: newAddonType });
      toast.success("Add-on created");
      setShowNewAddon(false); setNewAddonName(""); setNewAddonPrice(""); setNewAddonType("one_off");
      refetchAddons();
    } catch { toast.error("Failed to create add-on"); }
  };

  const handleUpdateAddon = async () => {
    if (!editAddon) return;
    try {
      await updateAddon.mutateAsync({ id: editAddon.id, name: editAddon.name, priceCents: editAddon.priceCents, type: editAddon.type });
      toast.success("Add-on updated");
      setEditAddon(null);
      refetchAddons();
    } catch { toast.error("Failed to update add-on"); }
  };

  const handleDeleteAddon = async () => {
    if (!deleteAddonTarget) return;
    try {
      await deleteAddonMut.mutateAsync({ id: deleteAddonTarget.id });
      toast.success("Add-on deleted");
      setDeleteAddonTarget(null);
      refetchAddons();
    } catch { toast.error("Failed to delete add-on"); }
  };

  const handleCreateQS = async () => {
    if (!newQSName.trim()) return;
    if (!brandId) { toast.error("No active brand"); return; }
    try {
      await createQS.mutateAsync({
        brandId,
        name: newQSName,
        defaultPaymentModel: newQSModel,
        options: newQSProductIds.map(id => ({ productId: id, quantity: 1 })),
      });
      toast.success("Quick set created");
      setShowNewQS(false); setNewQSName(""); setNewQSModel("one_off"); setNewQSProductIds([]);
      refetchQuickSets();
    } catch { toast.error("Failed to create quick set"); }
  };

  const handleUpdateQS = async () => {
    if (!editQS) return;
    try {
      await updateQS.mutateAsync({
        id: editQS.id,
        name: editQS.name,
        defaultPaymentModel: editQS.defaultPaymentModel,
        options: editQS.productIds.map(id => ({ productId: id, quantity: 1 })),
      });
      toast.success("Quick set updated");
      setEditQS(null);
      refetchQuickSets();
    } catch { toast.error("Failed to update quick set"); }
  };

  const handleDeleteQS = async () => {
    if (!deleteQSTarget) return;
    try {
      await deleteQSMut.mutateAsync({ id: deleteQSTarget.id });
      toast.success("Quick set deleted");
      setDeleteQSTarget(null);
      refetchQuickSets();
    } catch { toast.error("Failed to delete quick set"); }
  };

  return (
    <div className="page">
      {deleteProductTarget && <ConfirmDelete name={deleteProductTarget.name} onConfirm={handleDeleteProduct} onCancel={() => setDeleteProductTarget(null)} />}
      {deleteAddonTarget && <ConfirmDelete name={deleteAddonTarget.name} onConfirm={handleDeleteAddon} onCancel={() => setDeleteAddonTarget(null)} />}
      {deleteQSTarget && <ConfirmDelete name={deleteQSTarget.name} onConfirm={handleDeleteQS} onCancel={() => setDeleteQSTarget(null)} />}

      <div className="page-hd">
        <div className="ttl">
          <span className="eye">PRICING · {allProducts.length} PRODUCTS · {allQS.length} QUICK SETS</span>
          <h1>Pricing.</h1>
          <span className="sub">Your catalog, your rules. Products live here, get pulled into proposals and templates.</span>
        </div>
        <div className="acts">
          {!isProd && <button className="btn ghost" onClick={() => toast.info("CSV import coming soon")}>Import CSV</button>}
          <button className="btn primary" onClick={() => setShowNewProduct(true)}>+ New product</button>
        </div>
      </div>

      <div className="filter-bar">
        {([
          { id: "products", label: "Products" },
          { id: "addons", label: "Add-ons" },
          { id: "tables", label: "Pricing tables" },
          { id: "quicksets", label: "Quick sets" },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} className={"chip" + (tab === t.id ? " on" : "")} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <span className="grow" />
        <div className="search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
          <input placeholder="Search products…" />
        </div>
      </div>

      {showNewProduct && (
        <div className="pnl" style={{ marginBottom: 14 }}>
          <div className="pnl-hd"><h3>New product</h3></div>
          <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
            <div className="fld"><label>Name</label><input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Brand Strategy Sprint" autoFocus /></div>
            <div className="fld"><label>Category</label><input value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="e.g. Brand Strategy" /></div>
            <div className="fld"><label>Base price (AUD)</label><input type="number" value={newPrice} onChange={e => setNewPrice(e.target.value)} placeholder="0" /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn ghost" onClick={() => setShowNewProduct(false)}>Cancel</button>
              <button className="btn primary" onClick={handleCreate} disabled={createProduct.isPending}>Create</button>
            </div>
          </div>
        </div>
      )}

      {editProduct && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, width: 480, border: "1px solid var(--border-1)" }}>
            <h3 style={{ margin: "0 0 20px" }}>Edit product</h3>
            <div className="fld" style={{ marginBottom: 12 }}><label>Name</label><input value={editProduct.name} onChange={e => setEditProduct({ ...editProduct, name: e.target.value })} /></div>
            <div className="fld" style={{ marginBottom: 12 }}><label>Category</label><input value={editProduct.category} onChange={e => setEditProduct({ ...editProduct, category: e.target.value })} /></div>
            <div className="fld" style={{ marginBottom: 12 }}><label>Base price (AUD)</label>
              <input type="number" value={(editProduct.basePriceCents / 100).toFixed(2)} onChange={e => setEditProduct({ ...editProduct, basePriceCents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
            </div>
            <div className="fld" style={{ marginBottom: 20 }}>
              <label>Unit</label>
              <select value={editProduct.unit} onChange={e => setEditProduct({ ...editProduct, unit: e.target.value as ProductUnit })} style={{ width: "100%", padding: "8px 10px", background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}>
                <option value="project">Per project</option>
                <option value="hour">Per hour</option>
                <option value="month">Per month</option>
                <option value="quarter">Per quarter</option>
                <option value="year">Per year</option>
                <option value="item">Per item</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setEditProduct(null)}>Cancel</button>
              <button className="btn primary" onClick={handleUpdateProduct} disabled={updateProduct.isPending}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {editAddon && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, width: 440, border: "1px solid var(--border-1)" }}>
            <h3 style={{ margin: "0 0 20px" }}>Edit add-on</h3>
            <div className="fld" style={{ marginBottom: 12 }}><label>Name</label><input value={editAddon.name} onChange={e => setEditAddon({ ...editAddon, name: e.target.value })} /></div>
            <div className="fld" style={{ marginBottom: 12 }}>
              <label>Type</label>
              <select value={editAddon.type} onChange={e => setEditAddon({ ...editAddon, type: e.target.value as AddonType })} style={{ width: "100%", padding: "8px 10px", background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}>
                <option value="one_off">One-off</option>
                <option value="recurring">Recurring</option>
              </select>
            </div>
            <div className="fld" style={{ marginBottom: 20 }}><label>Price (AUD)</label>
              <input type="number" value={(editAddon.priceCents / 100).toFixed(2)} onChange={e => setEditAddon({ ...editAddon, priceCents: Math.round(parseFloat(e.target.value || "0") * 100) })} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setEditAddon(null)}>Cancel</button>
              <button className="btn primary" onClick={handleUpdateAddon} disabled={updateAddon.isPending}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {editQS && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--card)", borderRadius: 12, padding: 28, width: 520, border: "1px solid var(--border-1)", maxHeight: "90vh", overflowY: "auto" }}>
            <h3 style={{ margin: "0 0 20px" }}>Edit quick set</h3>
            <div className="fld" style={{ marginBottom: 12 }}><label>Name</label><input value={editQS.name} onChange={e => setEditQS({ ...editQS, name: e.target.value })} /></div>
            <div className="fld" style={{ marginBottom: 16 }}>
              <label>Default payment model</label>
              <select value={editQS.defaultPaymentModel} onChange={e => setEditQS({ ...editQS, defaultPaymentModel: e.target.value as EditQSState["defaultPaymentModel"] })} style={{ width: "100%", padding: "8px 10px", background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}>
                <option value="one_off">One-off</option>
                <option value="subscription">Subscription</option>
                <option value="payment_plan">Payment plan</option>
              </select>
            </div>
            <div className="fld" style={{ marginBottom: 20 }}>
              <label>Products in this set</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 0" }}>
                {(products ?? []).map((p: any) => {
                  const checked = editQS.productIds.includes(p.id);
                  return (
                    <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontSize: 12, border: "1px solid", borderColor: checked ? "var(--volt)" : "var(--border-2)", background: checked ? "var(--volt)" : "transparent", color: checked ? "#0f0f0f" : "var(--ink)" }}>
                      <input type="checkbox" checked={checked} onChange={() => setEditQS({ ...editQS, productIds: checked ? editQS.productIds.filter(id => id !== p.id) : [...editQS.productIds, p.id] })} style={{ display: "none" }} />
                      {p.name}
                    </label>
                  );
                })}
                {(!products || products.length === 0) && <div style={{ fontSize: 12, color: "var(--ink-60)" }}>No products yet — add some in the Products tab first.</div>}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn ghost" onClick={() => setEditQS(null)}>Cancel</button>
              <button className="btn primary" onClick={handleUpdateQS} disabled={updateQS.isPending}>Save changes</button>
            </div>
          </div>
        </div>
      )}

      {tab === "products" && (
        <>
          <div className="pnl" style={{ marginBottom: 14 }}>
            <div className="pnl-hd"><h3>Products · {allProducts.length}</h3><span className="meta">YOUR CATALOG</span></div>
            <div className="pnl-body" style={{ padding: 0 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Product</th><th>Category</th><th>Unit</th>
                    <th style={{ textAlign: "right" }}>Base price</th>
                    <th>Status</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {allProducts.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: "center", padding: "32px 16px", color: "var(--ink-40)" }}>
                        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", marginBottom: 6 }}>NO PRODUCTS YET</div>
                        <div style={{ fontSize: 12 }}>Click "+ New product" above to add your first catalog item.</div>
                      </td>
                    </tr>
                  )}
                  {allProducts.map((p: any) => {
                    const tag = (p.category ?? p.name ?? 'CUS').replace(/[^A-Z]/g, '').slice(0, 4) || (p.category ?? p.name ?? 'CUS').slice(0, 3).toUpperCase();
                    const catColor = "#8E8E84";
                    return (
                      <tr key={p.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span className="tag" style={{ borderLeft: `3px solid ${catColor}` }}>{tag}</span>
                            <b style={{ fontWeight: 500 }}>{p.name}</b>
                          </div>
                        </td>
                        <td style={{ fontSize: 12 }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: catColor }} />
                            {p.category ?? "Uncategorised"}
                          </span>
                        </td>
                        <td style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--ink-60)" }}>
                          {p.unit ?? (p.name.toLowerCase().includes("monthly") ? "per month" : "per project")}
                        </td>
                        <td className="num"><b style={{ fontWeight: 700 }}>{fmtAUD((p.basePriceCents ?? 0) / 100)}</b></td>
                        <td><span className="st connected"><span className="d" />Active</span></td>
                        <td>
                          <ActionMenu>
                            <MenuItem label="Edit" onClick={() => setEditProduct({ id: p.id, name: p.name, basePriceCents: p.basePriceCents ?? 0, category: p.category ?? "", unit: (p.unit ?? "project") as ProductUnit })} />
                            <MenuItem label="Delete" danger onClick={() => setDeleteProductTarget({ id: p.id, name: p.name })} />
                          </ActionMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="pnl" style={{ marginBottom: 14 }}>
            <div className="pnl-hd"><h3>Calculation rules</h3><span className="meta">APPLY ACROSS THE WORKSPACE</span></div>
            <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>
              {[
                { k: "GST", v: "Included in displayed prices · 10%", tag: "AUSTRALIAN" },
                { k: "Rounding", v: "Round line totals to nearest $1", tag: "CLEAN" },
                { k: "Multi-currency", v: "AUD only · request to enable USD", tag: "V1" },
              ].map((r, i) => (
                <div key={i} style={{ padding: 14, background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)" }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-60)" }}>{r.tag}</div>
                  <div style={{ fontWeight: 600, marginTop: 4 }}>{r.k}</div>
                  <div style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 4 }}>{r.v}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "quicksets" && (
        <div className="pnl">
          <div className="pnl-hd">
            <h3>Quick Sets · {allQS.length} active</h3>
            <span className="meta">PRESET BUNDLES FOR QUICK QUOTE</span>
          </div>
          <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10 }}>
            {allQS.length === 0 && !showNewQS && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--ink-40)", gridColumn: "1 / -1" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", marginBottom: 6 }}>NO QUICK SETS YET</div>
                <div style={{ fontSize: 12 }}>Create a quick set to pre-bundle products for Quick Quote.</div>
              </div>
            )}
            {allQS.map((q: any) => (
              <div key={q.id} style={{ padding: 14, background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)", position: "relative" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", color: "var(--ink-60)" }}>QUICK SET</div>
                <div style={{ fontWeight: 700, marginTop: 4, paddingRight: 28 }}>{q.name}</div>
                <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 4 }}>
                  {(q.defaultPaymentModel ?? "one_off").replace(/_/g, " ")}
                </div>
                {q.usageCount != null && (
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--ink-60)", marginTop: 8 }}><b style={{ color: "var(--ink)" }}>{q.usageCount}</b> USES</div>
                )}
                <div style={{ position: "absolute", top: 10, right: 10 }}>
                  <ActionMenu>
                    <MenuItem label="Edit" onClick={() => setEditQS({ id: q.id, name: q.name, defaultPaymentModel: q.defaultPaymentModel ?? "one_off", productIds: (q.options ?? []).map((o: any) => o.productId ?? o) })} />
                    <MenuItem label="Delete" danger onClick={() => setDeleteQSTarget({ id: q.id, name: q.name })} />
                  </ActionMenu>
                </div>
              </div>
            ))}
            {showNewQS ? (
              <div style={{ padding: 14, background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)", gridColumn: "1 / -1" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-60)", marginBottom: 10 }}>New quick set</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
                  <div className="fld"><label>Name</label><input autoFocus value={newQSName} onChange={e => setNewQSName(e.target.value)} placeholder="e.g. Monthly retainer" onKeyDown={e => e.key === "Enter" && handleCreateQS()} /></div>
                  <div className="fld">
                    <label>Payment model</label>
                    <select value={newQSModel} onChange={e => setNewQSModel(e.target.value as any)} style={{ width: "100%", padding: "8px 10px", background: "var(--card)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}>
                      <option value="one_off">One-off</option>
                      <option value="subscription">Subscription</option>
                      <option value="payment_plan">Payment plan</option>
                    </select>
                  </div>
                </div>
                {products && products.length > 0 && (
                  <div className="fld" style={{ marginBottom: 12 }}>
                    <label>Products (optional)</label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {products.map((p: any) => {
                        const checked = newQSProductIds.includes(p.id);
                        return (
                          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 20, cursor: "pointer", fontSize: 12, border: "1px solid", borderColor: checked ? "var(--volt)" : "var(--border-2)", background: checked ? "var(--volt)" : "transparent", color: checked ? "#0f0f0f" : "var(--ink)" }}>
                            <input type="checkbox" checked={checked} onChange={() => setNewQSProductIds(checked ? newQSProductIds.filter(id => id !== p.id) : [...newQSProductIds, p.id])} style={{ display: "none" }} />
                            {p.name}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <button className="btn ghost sm" onClick={() => { setShowNewQS(false); setNewQSName(""); setNewQSModel("one_off"); setNewQSProductIds([]); }}>Cancel</button>
                  <button className="btn primary sm" onClick={handleCreateQS} disabled={createQS.isPending}>Create</button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 14, background: "var(--paper)", borderRadius: 8, border: "2px dashed var(--border-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 6, cursor: "pointer", color: "var(--ink-60)", minHeight: 90 }} onClick={() => setShowNewQS(true)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 5v14M5 12h14"/></svg>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em" }}>NEW QUICK SET</span>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "tables" && (
        <div className="pnl">
          <div className="pnl-hd"><h3>Pricing tables</h3><span className="meta">TIERED COLUMNS IN PROPOSALS</span></div>
          <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            {[
              { name: "Local", sub: "Single suburb", price: "$12,000", items: ["Brand workshop", "Logo only", "3 launch assets"], on: false },
              { name: "National", sub: "Multi-market", price: "$24,800", items: ["Brand workshop", "Logo + system", "12 launch assets", "Brand book PDF"], on: true },
              { name: "International", sub: "Cross-language", price: "$28,000", items: ["All National +", "Translation strategy", "Localised brand books", "Trademark advisory"], on: false },
            ].map((t, i) => (
              <div key={i} style={{ padding: 18, borderRadius: 12, border: `1px solid ${t.on ? "var(--ink)" : "var(--border-1)"}`, background: t.on ? "var(--volt)" : "var(--card)" }}>
                {t.on && <div style={{ fontFamily: "var(--font-mono)", fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700 }}>RECOMMENDED</div>}
                <div style={{ fontWeight: 700, fontSize: 22, letterSpacing: "-0.02em", marginTop: t.on ? 8 : 0 }}>{t.name}</div>
                <div style={{ fontSize: 12, color: "var(--ink-60)", marginTop: 2 }}>{t.sub}</div>
                <div style={{ fontSize: 36, fontWeight: 800, letterSpacing: "-0.03em", marginTop: 14 }}>{t.price}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16, fontSize: 13 }}>
                  {t.items.map(x => (
                    <div key={x} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>{x}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "addons" && (
        <div className="pnl">
          <div className="pnl-hd"><h3>Add-ons · {allAddons.length}</h3><span className="meta">OPTIONAL EXTRAS CLIENTS CAN SELECT</span></div>
          <div className="pnl-body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allAddons.length === 0 && !showNewAddon && (
              <div style={{ padding: 24, textAlign: "center", color: "var(--ink-40)" }}>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: "0.1em", marginBottom: 6 }}>NO ADD-ONS YET</div>
                <div style={{ fontSize: 12 }}>Add optional extras that clients can select on their proposal.</div>
              </div>
            )}
            {allAddons.map((a: any) => (
              <div key={a.id} style={{ padding: 14, background: "var(--paper)", borderRadius: 8, border: "1px solid var(--border-1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: "var(--ink-60)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    {a.type === "recurring" ? "Recurring" : "One-off"} · {a.priceCents > 0 ? fmtAUD(a.priceCents / 100) : "—"}
                  </div>
                </div>
                <ActionMenu>
                  <MenuItem label="Edit" onClick={() => setEditAddon({ id: a.id, name: a.name, priceCents: a.priceCents ?? 0, type: (a.type ?? "one_off") as AddonType })} />
                  <MenuItem label="Delete" danger onClick={() => setDeleteAddonTarget({ id: a.id, name: a.name })} />
                </ActionMenu>
              </div>
            ))}
            {showNewAddon ? (
              <div className="pnl" style={{ marginTop: 8 }}>
                <div className="pnl-hd"><h3>New add-on</h3></div>
                <div className="pnl-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "flex-end" }}>
                  <div className="fld"><label>Name</label><input value={newAddonName} onChange={e => setNewAddonName(e.target.value)} placeholder="e.g. Rush delivery" autoFocus /></div>
                  <div className="fld">
                    <label>Type</label>
                    <select value={newAddonType} onChange={e => setNewAddonType(e.target.value as AddonType)} style={{ width: "100%", padding: "8px 10px", background: "var(--paper)", border: "1px solid var(--border-1)", borderRadius: 6, color: "var(--ink)" }}>
                      <option value="one_off">One-off</option>
                      <option value="recurring">Recurring</option>
                    </select>
                  </div>
                  <div className="fld"><label>Price (AUD)</label><input type="number" value={newAddonPrice} onChange={e => setNewAddonPrice(e.target.value)} placeholder="0" /></div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn ghost" onClick={() => setShowNewAddon(false)}>Cancel</button>
                    <button className="btn primary" onClick={handleCreateAddon} disabled={createAddon.isPending}>Create</button>
                  </div>
                </div>
              </div>
            ) : (
              <button className="btn ghost sm" onClick={() => setShowNewAddon(true)}>+ Add add-on</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
