import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTRPC } from "@shared/lib/trpc";
import { useBrandId } from "@/lib/payments-trpc";
import { NavIcon } from "@/components/AppShell";
import { toast } from "sonner";
import { sanitizeError } from "@/lib/errorMessage";
import { isProd } from "@/lib/env";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const fmtAUD = (n: number) => "$" + n.toLocaleString("en-AU", { maximumFractionDigits: 0 });

const STATUS_FILTERS = ["All", "Active", "At risk", "Lapsed", "Churned"];

export default function Clients() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const brandId = useBrandId();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editClient, setEditClient] = useState<any>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<any>(null);
  const [form, setForm] = useState({ name: "", businessName: "", email: "", mobile: "" });
  const [editForm, setEditForm] = useState({ name: "", businessName: "", email: "", mobile: "" });
  const invalidateList = () =>
    qc.invalidateQueries({ queryKey: trpc.payments.clients.list.queryKey() });
  const createClient = useMutation(trpc.payments.clients.create.mutationOptions({
    onSuccess: (c) => {
      toast.success(`${c?.name ?? "Payer"} added`);
      invalidateList();
      setShowAdd(false);
      setForm({ name: "", businessName: "", email: "", mobile: "" });
    },
    onError: (e) => toast.error(sanitizeError(e)),
  }));

  const updateClient = useMutation(trpc.payments.clients.update.mutationOptions({
    onSuccess: () => { toast.success("Payer updated"); invalidateList(); setEditClient(null); },
    onError: (e) => toast.error(sanitizeError(e)),
  }));
  const generateSupportSession = useMutation({
    ...trpc.payments.clients.generateSupportSession.mutationOptions(),
    onSuccess: (data) => {
      // Store session in sessionStorage and open portal in new tab
      const key = `cp_support_${data.clientId}`;
      sessionStorage.setItem(key, data.sessionToken);
      const portalUrl = `${window.location.origin}/client-portal/verify?token=${data.sessionToken}`;
      window.open(portalUrl, "_blank");
      toast.success("Portal opened in a new tab");
    },
    onError: (e) => toast.error(sanitizeError(e)),
  });
  const deleteClient = useMutation({
    ...trpc.payments.clients.delete.mutationOptions(),
    onSuccess: () => { toast.success("Payer deleted"); invalidateList(); setDeleteConfirm(null); },
    onError: (e) => toast.error(sanitizeError(e)),
  });

  const { data, isLoading } = useQuery({
    ...trpc.payments.clients.list.queryOptions({
      brandId: brandId!,
      limit: 50, offset: 0,
      search: search || undefined,
    }),
    enabled: !!brandId,
  });

  const clients = data?.rows ?? [];

  return (
    <div className="page">
      <div className="page-hd">
        <div className="ttl">
          <span className="eye">{clients.length} PAYERS · 8 ACTIVE PLANS</span>
          <h1>Payers.</h1>
          <span className="sub">Everyone you've quoted, been paid by, or chased. Click a row to open.</span>
        </div>
        <div className="acts">
          {!isProd && (
            <button className="btn ghost" onClick={() => toast.info("CSV import coming soon")}>
              <NavIcon name="upload" />Import CSV
            </button>
          )}
          <button className="btn primary" onClick={() => setShowAdd(true)}>
            <NavIcon name="plus" />Add payer
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            className={"chip" + (statusFilter === s ? " on" : "")}
            onClick={() => setStatusFilter(s)}
          >
            {s}
          </button>
        ))}
        <span className="sep" />
        {!isProd && (
          <button className="chip" onClick={() => toast.info("Tier filter coming soon")}>
            <NavIcon name="filter" />Tier · all
          </button>
        )}
        {!isProd && (
          <button className="chip" onClick={() => toast.info("Source filter coming soon")}>
            <NavIcon name="filter" />Source · all
          </button>
        )}
        <span className="grow" />
        <div className="search">
          <NavIcon name="search" />
          <input
            placeholder="Search by name, business, email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="pnl" style={{ padding: 0 }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Contact</th>
              <th style={{ textAlign: "right" }}>Lifetime</th>
              <th style={{ textAlign: "center" }}>Proposals</th>
              <th>Last activity</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "32px 0", color: "var(--ink-60)" }}>Loading…</td></tr>
            )}
            {!isLoading && clients.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "48px 0" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, color: "var(--ink-60)" }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--bg-inset)", display: "grid", placeItems: "center" }}>
                      <NavIcon name="clients" />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "var(--ink)" }}>No payers yet</div>
                    <div style={{ fontSize: 13, maxWidth: 320, textAlign: "center", lineHeight: 1.5 }}>
                      Add your first payer to start sending proposals.
                    </div>
                    <button className="btn primary" onClick={() => setShowAdd(true)}>
                      <NavIcon name="plus" />Add payer
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {clients.map((c: any) => {
              const initials = c.name
                ? c.name.split(" ").map((n: string) => n[0]).join("").toUpperCase().slice(0, 2)
                : "??";
              return (
                <tr key={c.id} onClick={() => navigate(`/clients/${c.id}`)}>
                  <td>
                    <div className="client">
                      <div className="avt">{initials}</div>
                      <div>
                        <div className="nm">{c.name}</div>
                        <div className="sub">{c.businessName || ""}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink-60)", fontFamily: "var(--font-mono)" }}>
                    {c.email || c.mobile || "—"}
                  </td>
                  <td className="num"><b style={{ fontWeight: 700 }}>{fmtAUD(Number(c.lifetimeValue) || 0)}</b></td>
                  <td style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                    {c.proposalCount || 0}
                  </td>
                  <td style={{ fontSize: 12, color: "var(--ink-60)" }}>
                    {c.updatedAt ? new Date(c.updatedAt).toLocaleDateString("en-AU") : "—"}
                  </td>
                  <td>
                    <span className="st active"><span className="d" />Active</span>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button className="icon-only" title="Open portal" onClick={(e) => { e.stopPropagation(); generateSupportSession.mutate({ clientId: c.id }); }}>
                        <NavIcon name="link" />
                      </button>
                      <button className="icon-only" title="Edit" onClick={(e) => { e.stopPropagation(); setEditForm({ name: c.name || "", businessName: c.businessName || "", email: c.email || "", mobile: c.mobile || "" }); setEditClient(c); }}>
                        <NavIcon name="edit" />
                      </button>
                      <button className="icon-only" title="Delete" style={{ color: "var(--red)" }} onClick={(e) => { e.stopPropagation(); setDeleteConfirm(c); }}>
                        <NavIcon name="trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* Edit Client Dialog */}
      <Dialog open={!!editClient} onOpenChange={(o) => !o && setEditClient(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit payer</DialogTitle></DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div><Label>Full name *</Label><Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} /></div>
            <div><Label>Business name</Label><Input value={editForm.businessName} onChange={e => setEditForm(f => ({ ...f, businessName: e.target.value }))} /></div>
            <div><Label>Email</Label><Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} /></div>
            <div><Label>Mobile</Label><Input value={editForm.mobile} onChange={e => setEditForm(f => ({ ...f, mobile: e.target.value }))} /></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8 }}>
              <Button variant="outline" onClick={() => setEditClient(null)}>Cancel</Button>
              <Button disabled={!editForm.name.trim() || updateClient.isPending} onClick={() => updateClient.mutate({ id: editClient.id, name: editForm.name, businessName: editForm.businessName || undefined, email: editForm.email || undefined, mobile: editForm.mobile || undefined })}>
                {updateClient.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={(o) => !o && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete payer?</DialogTitle></DialogHeader>
          <p style={{ fontSize: 14, color: "var(--ink-60)", margin: "8px 0 16px" }}>This will permanently delete <b>{deleteConfirm?.name}</b> and cannot be undone.</p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="destructive" disabled={deleteClient.isPending} onClick={() => deleteClient.mutate({ id: deleteConfirm.id })}>
              {deleteClient.isPending ? "Deleting…" : "Delete payer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* Add Client Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add payer</DialogTitle></DialogHeader>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, paddingTop: 8 }}>
            <div><Label>Full name *</Label><Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Sarah Chen" /></div>
            <div><Label>Business name</Label><Input value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} placeholder="Acme Pty Ltd" /></div>
            <div><Label>Email</Label><Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="sarah@acme.com" /></div>
            <div><Label>Mobile</Label><Input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value }))} placeholder="+61 4XX XXX XXX" /></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 8 }}>
              <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button
                disabled={!form.name.trim() || createClient.isPending || !brandId}
                onClick={() => createClient.mutate({ brandId: brandId!, name: form.name, businessName: form.businessName || undefined, email: form.email || undefined, mobile: form.mobile || undefined })}
              >
                {createClient.isPending ? "Saving…" : "Add payer"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
