import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus, Pencil, Trash2, Check, X, Heading, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { SortableList } from '../../components/ui/sortable-list';
import { DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';

/** A reorderable catalog entry — either a service card or a section heading. */
type Row = { kind: 'service' | 'heading'; id: string; label: string; sortOrder: number };

/**
 * Organize / reorder the catalog — ports organize_services_dialog.dart. The list
 * interleaves services and section headings: headings can be added, renamed,
 * deleted, and dragged among the services. Both share one sortOrder sequence,
 * committed via `services.reorder` (kind-tagged ids) on Save. Heading add/rename/
 * delete persist immediately (they need a server id) and re-sync into the list.
 */
export function OrganizeServicesDialog({ agencyId, services, onDone }: { agencyId: string; services: any[]; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const headingsKey = trpc.services.headings.queryKey({ agencyId });
  const headingsQ = useQuery(trpc.services.headings.queryOptions({ agencyId }));
  const headings = headingsQ.data ?? [];
  const refreshHeadings = () => qc.invalidateQueries({ queryKey: headingsKey });

  // Merge services + headings into one list ordered by the shared sortOrder.
  const merged = useMemo<Row[]>(() => {
    const rows: Row[] = [
      ...services.map((s) => ({ kind: 'service' as const, id: s.id, label: s.name, sortOrder: s.sortOrder ?? 0 })),
      ...headings.map((h) => ({ kind: 'heading' as const, id: h.id, label: h.text, sortOrder: h.sortOrder ?? 0 })),
    ];
    return rows.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [services, headings]);

  // Local working order. Re-syncs when the *set* of ids changes (heading added /
  // removed) while preserving the user's in-progress drag order for ids that stay.
  const [order, setOrder] = useState<Row[] | null>(null);
  useEffect(() => {
    setOrder((prev) => {
      if (!prev) return merged;
      const mergedById = new Map(merged.map((r) => [r.id, r]));
      const prevIds = new Set(prev.map((r) => r.id));
      const kept = prev.filter((r) => mergedById.has(r.id)).map((r) => mergedById.get(r.id)!); // refresh labels too
      const added = merged.filter((r) => !prevIds.has(r.id));
      return [...kept, ...added];
    });
  }, [merged]);
  const rows = order ?? merged;

  // Collapsed headings hide their section's services and let the whole section be
  // dragged as one block (ports organize_services_dialog.dart's collapse logic).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapse = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The visible rows (services under a collapsed heading are hidden) plus, for each
  // visible row, the "block" it carries: a collapsed heading carries its section's
  // services so dragging it moves them together; everything else is just itself.
  const { displayed, blockOf } = useMemo(() => {
    const displayed: Row[] = [];
    const blockOf = new Map<string, Row[]>();
    let i = 0;
    while (i < rows.length) {
      const r = rows[i];
      if (r.kind === 'heading' && collapsed.has(r.id)) {
        const block: Row[] = [r];
        let j = i + 1;
        while (j < rows.length && rows[j].kind !== 'heading') block.push(rows[j++]);
        displayed.push(r);
        blockOf.set(r.id, block);
        i = j;
      } else {
        displayed.push(r);
        blockOf.set(r.id, [r]);
        i++;
      }
    }
    return { displayed, blockOf };
  }, [rows, collapsed]);

  const [newHeading, setNewHeading] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const addHeading = useMutation({
    ...trpc.services.addHeading.mutationOptions(),
    onSuccess: () => { setNewHeading(''); refreshHeadings(); },
    onError: (e) => toastError(e),
  });
  const updateHeading = useMutation({
    ...trpc.services.updateHeading.mutationOptions(),
    onSuccess: () => { setEditingId(null); refreshHeadings(); },
    onError: (e) => toastError(e),
  });
  const deleteHeading = useMutation({
    ...trpc.services.deleteHeading.mutationOptions(),
    onSuccess: refreshHeadings,
    onError: (e) => toastError(e),
  });
  const reorder = useMutation({
    ...trpc.services.reorder.mutationOptions(),
    onSuccess: () => { toast.success('Order saved'); onDone(); },
    onError: (e) => toastError(e),
  });

  const submitNewHeading = () => {
    const text = newHeading.trim();
    if (text) addHeading.mutate({ agencyId, text });
  };
  const startEdit = (row: Row) => { setEditingId(row.id); setEditDraft(row.label); };
  const submitEdit = () => {
    const text = editDraft.trim();
    if (editingId && text) updateHeading.mutate({ id: editingId, text });
    else setEditingId(null);
  };

  return (
    <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Organize catalog</DialogTitle>
        <DialogDescription>Add section headings and drag to set the display order of your catalog. Collapse a heading to drag its whole section at once.</DialogDescription>
      </DialogHeader>

      {/* Add a heading. */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="New heading title…"
          value={newHeading}
          onChange={(e) => setNewHeading(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitNewHeading(); } }}
        />
        <Button variant="outline" disabled={!newHeading.trim() || addHeading.isPending} onClick={submitNewHeading}>
          <Plus className="h-4 w-4" /> Heading
        </Button>
      </div>

      <SortableList
        items={displayed}
        getId={(r) => r.id}
        // Reconstruct the full order from the reordered visible rows: each visible
        // row contributes its block (a collapsed heading drags its section along).
        onReorder={(ids) => setOrder(ids.flatMap((id) => blockOf.get(id) ?? []))}
        className="flex flex-col gap-1.5"
      >
        {({ item: r, handleProps }) =>
          r.kind === 'heading' ? (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-accent/40 bg-accent/10 px-3 py-2">
              <button {...handleProps} className="cursor-grab touch-none text-ink-40 hover:text-ink-80 active:cursor-grabbing" aria-label="Drag to reorder">
                <GripVertical className="h-4 w-4" />
              </button>
              <button
                onClick={() => toggleCollapse(r.id)}
                className="shrink-0 text-ink-60 hover:text-ink-100"
                aria-label={collapsed.has(r.id) ? 'Expand section' : 'Collapse section'}
                aria-expanded={!collapsed.has(r.id)}
              >
                {collapsed.has(r.id) ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <Heading className="h-3.5 w-3.5 shrink-0 text-accent" />
              {editingId === r.id ? (
                <>
                  <Input
                    autoFocus
                    className="h-7 flex-1"
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitEdit(); } if (e.key === 'Escape') setEditingId(null); }}
                  />
                  <button onClick={submitEdit} className="text-ink-40 hover:text-ink-100" aria-label="Save heading"><Check className="h-4 w-4" /></button>
                  <button onClick={() => setEditingId(null)} className="text-ink-40 hover:text-ink-100" aria-label="Cancel"><X className="h-4 w-4" /></button>
                </>
              ) : (
                <>
                  <button onClick={() => toggleCollapse(r.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <span className="truncate text-sm font-semibold text-ink-100">{r.label}</span>
                    {collapsed.has(r.id) && (blockOf.get(r.id)?.length ?? 1) > 1 && (
                      <span className="shrink-0 rounded-full bg-accent/15 px-1.5 text-[11px] font-medium text-accent">{(blockOf.get(r.id)!.length - 1)}</span>
                    )}
                  </button>
                  <button onClick={() => startEdit(r)} className="text-ink-40 hover:text-ink-100" aria-label="Rename heading"><Pencil className="h-3.5 w-3.5" /></button>
                  <button
                    onClick={() => { deleteHeading.mutate({ id: r.id }); setCollapsed((p) => { const n = new Set(p); n.delete(r.id); return n; }); }}
                    className="text-ink-40 hover:text-danger"
                    aria-label="Delete heading"
                  ><Trash2 className="h-3.5 w-3.5" /></button>
                </>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2">
              <button {...handleProps} className="cursor-grab touch-none text-ink-30 hover:text-ink-60 active:cursor-grabbing" aria-label="Drag to reorder">
                <GripVertical className="h-4 w-4" />
              </button>
              <span className="flex-1 truncate text-sm text-ink-100">{r.label}</span>
            </div>
          )
        }
      </SortableList>

      <DialogFooter>
        <Button
          variant="accent"
          disabled={reorder.isPending}
          onClick={() => reorder.mutate({ agencyId, items: rows.map((r) => ({ kind: r.kind, id: r.id })) })}
        >
          {reorder.isPending ? 'Saving…' : 'Save order'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
