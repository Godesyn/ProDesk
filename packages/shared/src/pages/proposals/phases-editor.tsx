import { useEffect, useRef, useState } from 'react';
import { Heading, Trash2, GripVertical, Package as PackageIcon } from 'lucide-react';
import {
  DndContext, DragOverlay, closestCorners, PointerSensor, KeyboardSensor,
  useSensor, useSensors, useDroppable,
  type DragStartEvent, type DragOverEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy,
  useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { cn, toNumberInput, formatCurrency } from '../../lib/utils';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';

/** Up to two leading initials for an agency's logo fallback. */
const initialsOf = (name?: string | null) =>
  (name ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export type Phase = { id: string; name: string; sortOrder: number; startDelayDays: number | null };
export type Item = {
  id: string; phaseId: string | null; type: 'service' | 'heading' | 'custom';
  description: string | null; headingText: string | null; amount: string;
  quantity: number; upfrontFee: string | null; isRecurring: boolean; isOptional: boolean;
  serviceId: string | null; packageId: string | null; packageName?: string | null; sortOrder: number;
  agencyId?: string | null; agencyName?: string | null; agencyLogo?: string | null;
};

/** item ids grouped by phase id, in display order. */
type Containers = Record<string, string[]>;

/** Bucket items into their phases (preserving sort order). Items with no phase —
 * or a phase that no longer exists — fall into the first phase, mirroring the
 * Flutter builder and the `removePhase` reassignment rule. */
function buildContainers(phases: Phase[], items: Item[]): Containers {
  const map: Containers = {};
  for (const ph of phases) map[ph.id] = [];
  const firstId = phases[0]?.id;
  for (const it of items) {
    const pid = it.phaseId && map[it.phaseId] ? it.phaseId : firstId;
    if (pid && map[pid]) map[pid].push(it.id);
  }
  return map;
}

/** A phase's items as display entries: a standalone item, or a run of items that
 *  came from one package (consecutive same packageId) grouped under that package. */
type Entry = { kind: 'item'; id: string } | { kind: 'package'; packageId: string; name: string; ids: string[] };
function groupEntries(itemIds: string[], itemsById: Map<string, Item>): Entry[] {
  const entries: Entry[] = [];
  let i = 0;
  while (i < itemIds.length) {
    const pkgId = itemsById.get(itemIds[i])?.packageId ?? null;
    if (pkgId) {
      const ids = [itemIds[i]];
      let j = i + 1;
      while (j < itemIds.length && (itemsById.get(itemIds[j])?.packageId ?? null) === pkgId) ids.push(itemIds[j++]);
      entries.push({ kind: 'package', packageId: pkgId, name: itemsById.get(itemIds[i])?.packageName || 'Package', ids });
      i = j;
    } else {
      entries.push({ kind: 'item', id: itemIds[i] });
      i++;
    }
  }
  return entries;
}

/**
 * A package's items rendered as one bundle: a header (name · count · total · remove)
 * over the package's nested item rows. Mirrors the Flutter proposal package tile so
 * a package reads as a single bundled offering, not loose line items.
 */
function PackageGroupBlock({ name, total, count, onRemoveAll, children }: {
  name: string; total: number; count: number; onRemoveAll: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-accent/[0.04]">
      <div className="flex items-center gap-2 px-3 py-2">
        <PackageIcon className="h-4 w-4 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-accent">{name}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-ink-40">{count} item{count !== 1 ? 's' : ''} · {formatCurrency(total)}</span>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onRemoveAll} title="Remove package"><Trash2 className="h-4 w-4 text-danger" /></Button>
      </div>
      <div className="divide-y divide-[color:var(--color-border-hairline)] border-t border-[color:var(--color-border-hairline)] bg-card">
        {children}
      </div>
    </div>
  );
}

/**
 * Drag-and-drop phases & line-items editor. Items can be reordered within a
 * phase or dragged across phases (including into an empty phase); the flat
 * ordering + each item's phaseId is committed through `onReorder`.
 */
export function PhasesEditor({
  phases, items, salesMode, ownAgencyId,
  onRenamePhase, onRemovePhase, onSetStartDelay, onAddHeading, onUpdateItem, onRemoveItem, onReorder,
}: {
  phases: Phase[]; items: Item[]; salesMode?: boolean; ownAgencyId?: string | null;
  onRenamePhase: (id: string, name: string) => void;
  onRemovePhase: (id: string) => void;
  onSetStartDelay: (id: string, days: number) => void;
  onAddHeading: (phaseId: string) => void;
  onUpdateItem: (id: string, v: Record<string, unknown>) => void;
  onRemoveItem: (id: string) => void;
  onReorder: (ordered: { id: string; phaseId: string; sortOrder: number }[]) => void;
}) {
  const itemsById = new Map(items.map((it) => [it.id, it]));

  // Local mirror of the grouping so cross-phase moves can be applied live during
  // the drag (onDragOver) before they're committed on drop. A ref shadows the
  // state so onDragEnd always reads the latest grouping even mid-event.
  const [containers, setContainers] = useState<Containers>(() => buildContainers(phases, items));
  const containersRef = useRef(containers);
  const apply = (next: Containers) => { containersRef.current = next; setContainers(next); };

  const [activeId, setActiveId] = useState<string | null>(null);

  // Re-sync from server data whenever it changes — but never mid-drag, which
  // would yank items out from under the pointer.
  useEffect(() => {
    if (activeId) return;
    apply(buildContainers(phases, items));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases, items, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = (c: Containers, id: string): string | undefined =>
    id in c ? id : Object.keys(c).find((phaseId) => c[phaseId].includes(id));

  function commit(c: Containers) {
    const ordered: { id: string; phaseId: string; sortOrder: number }[] = [];
    let sortOrder = 0;
    for (const ph of phases) {
      for (const itemId of c[ph.id] ?? []) ordered.push({ id: itemId, phaseId: ph.id, sortOrder: sortOrder++ });
    }
    onReorder(ordered);
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    const prev = containersRef.current;
    const from = findContainer(prev, activeKey);
    const to = findContainer(prev, overKey);
    if (!from || !to || from === to) return;

    const fromItems = prev[from];
    const toItems = prev[to];
    const overIndex = overKey in prev ? toItems.length : toItems.indexOf(overKey);
    const insertAt = overIndex < 0 ? toItems.length : overIndex;
    apply({
      ...prev,
      [from]: fromItems.filter((id) => id !== activeKey),
      [to]: [...toItems.slice(0, insertAt), activeKey, ...toItems.slice(insertAt)],
    });
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    setActiveId(null);
    if (!over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    const prev = containersRef.current;
    const from = findContainer(prev, activeKey);
    const to = findContainer(prev, overKey);
    if (!from || !to) return;

    let next = prev;
    if (from === to) {
      const arr = prev[to];
      const oldIndex = arr.indexOf(activeKey);
      const newIndex = overKey in prev ? arr.length - 1 : arr.indexOf(overKey);
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) {
        next = { ...prev, [to]: arrayMove(arr, oldIndex, newIndex) };
      }
    } else {
      // Cross-phase drop that didn't go through onDragOver — reparent here.
      const toItems = prev[to];
      const overIndex = overKey in prev ? toItems.length : toItems.indexOf(overKey);
      const insertAt = overIndex < 0 ? toItems.length : overIndex;
      next = {
        ...prev,
        [from]: prev[from].filter((id) => id !== activeKey),
        [to]: [...toItems.slice(0, insertAt), activeKey, ...toItems.slice(insertAt)],
      };
    }
    apply(next);
    commit(next);
  }

  const activeItem = activeId ? itemsById.get(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => { setActiveId(null); apply(buildContainers(phases, items)); }}
    >
      <div className="space-y-5">
        {phases.length === 0 && <p className="text-sm text-ink-40">Add a phase to start building.</p>}
        {phases.map((phase, i) => (
          <PhaseBlock
            key={phase.id}
            phase={phase}
            isFirst={i === 0}
            itemIds={containers[phase.id] ?? []}
            itemsById={itemsById}
            canRemovePhase={phases.length > 1}
            salesMode={salesMode}
            ownAgencyId={ownAgencyId}
            activeId={activeId}
            onRenamePhase={(name) => onRenamePhase(phase.id, name)}
            onRemovePhase={() => onRemovePhase(phase.id)}
            onSetStartDelay={(days) => onSetStartDelay(phase.id, days)}
            onAddHeading={() => onAddHeading(phase.id)}
            onUpdateItem={onUpdateItem}
            onRemoveItem={onRemoveItem}
          />
        ))}
      </div>
      <DragOverlay>
        {activeItem ? <div className="rounded-[var(--radius-sm)] border border-accent/40 bg-card shadow-lg"><ItemRow item={activeItem} /></div> : null}
      </DragOverlay>
    </DndContext>
  );
}

function PhaseBlock({
  phase, isFirst, itemIds, itemsById, canRemovePhase, salesMode, ownAgencyId, activeId,
  onRenamePhase, onRemovePhase, onSetStartDelay, onAddHeading, onUpdateItem, onRemoveItem,
}: {
  phase: Phase; isFirst: boolean; itemIds: string[]; itemsById: Map<string, Item>;
  canRemovePhase: boolean; salesMode?: boolean; ownAgencyId?: string | null; activeId: string | null;
  onRenamePhase: (name: string) => void; onRemovePhase: () => void; onSetStartDelay: (days: number) => void;
  onAddHeading: () => void;
  onUpdateItem: (id: string, v: Record<string, unknown>) => void; onRemoveItem: (id: string) => void;
}) {
  const [name, setName] = useState(phase.name);
  useEffect(() => setName(phase.name), [phase.name]);
  const [delay, setDelay] = useState(toNumberInput(phase.startDelayDays ?? 0));
  useEffect(() => setDelay(toNumberInput(phase.startDelayDays ?? 0)), [phase.startDelayDays]);
  const commitDelay = () => {
    const days = Math.max(0, Math.round(Number(delay) || 0));
    setDelay(String(days));
    if (days !== (phase.startDelayDays ?? 0)) onSetStartDelay(days);
  };
  // Droppable wrapper so items can be dropped into an empty phase (where there
  // are no sortable rows to hit).
  const { setNodeRef, isOver } = useDroppable({ id: phase.id });

  const renderItem = (id: string) => {
    const item = itemsById.get(id);
    if (!item) return null;
    return (
      <SortableItem
        key={id}
        item={item}
        dimmed={activeId === id}
        priceLocked={!!salesMode && !!item.agencyId && item.agencyId !== ownAgencyId}
        showAgencyTag={!!salesMode && !!item.agencyId && item.agencyId !== ownAgencyId}
        onUpdate={(v) => onUpdateItem(item.id, v)}
        onRemove={() => onRemoveItem(item.id)}
      />
    );
  };

  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--color-border-hairline)] bg-inset/40 px-3 py-2">
        <Input className="h-8 max-w-[200px] border-transparent bg-transparent px-1 text-sm font-semibold" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => onRenamePhase(name)} />
        {/* Start delay: the first phase always begins immediately; later phases
            start N days after the proposal is accepted (Flutter startDelayDays). */}
        {isFirst ? (
          <span className="whitespace-nowrap text-xs text-ink-40">Starts immediately</span>
        ) : (
          <span className="flex items-center gap-1 whitespace-nowrap text-xs text-ink-60">
            Starts after
            <Input
              type="number"
              min={0}
              className="h-7 w-14 px-1.5 text-center text-xs"
              value={delay}
              onChange={(e) => setDelay(e.target.value)}
              onBlur={commitDelay}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            />
            days
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={onAddHeading}><Heading className="h-4 w-4" /> Heading</Button>
          {canRemovePhase && <Button size="icon" variant="ghost" onClick={onRemovePhase}><Trash2 className="h-4 w-4 text-danger" /></Button>}
        </div>
      </div>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'min-h-[3rem] divide-y divide-[color:var(--color-border-hairline)] transition-colors',
            isOver && 'bg-accent/5',
          )}
        >
          {itemIds.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-ink-40">Drag items here, or add services from the catalog.</p>
          )}
          {groupEntries(itemIds, itemsById).map((entry) => {
            if (entry.kind === 'item') return renderItem(entry.id);
            const groupItems = entry.ids.map((id) => itemsById.get(id)).filter(Boolean) as Item[];
            const total = groupItems.reduce((s, it) => s + Number(it.amount) * it.quantity, 0);
            return (
              <PackageGroupBlock
                key={entry.ids[0]}
                name={entry.name}
                count={groupItems.length}
                total={total}
                onRemoveAll={() => entry.ids.forEach((id) => onRemoveItem(id))}
              >
                {entry.ids.map(renderItem)}
              </PackageGroupBlock>
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}

/** ItemRow wrapped for drag-to-reorder (dnd-kit), with a grab handle. */
function SortableItem({ item, dimmed, priceLocked, showAgencyTag, onUpdate, onRemove }: {
  item: Item; dimmed?: boolean; priceLocked?: boolean; showAgencyTag?: boolean;
  onUpdate: (v: Record<string, unknown>) => void; onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    // The dragged source is masked while the DragOverlay shows the floating copy.
    opacity: isDragging || dimmed ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <ItemRow
        item={item}
        priceLocked={priceLocked}
        showAgencyTag={showAgencyTag}
        onUpdate={onUpdate}
        onRemove={onRemove}
        dragHandle={
          <button {...attributes} {...listeners} className="cursor-grab touch-none text-ink-30 hover:text-ink-60 active:cursor-grabbing" aria-label="Drag to reorder">
            <GripVertical className="h-4 w-4" />
          </button>
        }
      />
    </div>
  );
}

function ItemRow({ item, priceLocked, showAgencyTag, onUpdate, onRemove, dragHandle }: {
  item: Item; priceLocked?: boolean; showAgencyTag?: boolean;
  onUpdate?: (v: Record<string, unknown>) => void; onRemove?: () => void; dragHandle?: React.ReactNode;
}) {
  const [heading, setHeading] = useState(item.headingText ?? '');
  const [amount, setAmount] = useState(toNumberInput(item.amount));
  const [upfront, setUpfront] = useState(toNumberInput(item.upfrontFee ?? 0));
  const [qty, setQty] = useState(toNumberInput(item.quantity));
  useEffect(() => { setHeading(item.headingText ?? ''); setAmount(toNumberInput(item.amount)); setUpfront(toNumberInput(item.upfrontFee ?? 0)); setQty(toNumberInput(item.quantity)); }, [item.headingText, item.amount, item.upfrontFee, item.quantity]);

  if (item.type === 'heading') {
    return (
      <div className="flex items-center gap-2 bg-inset/20 px-3 py-2">
        {dragHandle}
        <Heading className="h-4 w-4 shrink-0 text-ink-40" />
        <Input className="h-8 min-w-0 flex-1 border-transparent bg-transparent px-1 text-sm font-semibold" value={heading} onChange={(e) => setHeading(e.target.value)} onBlur={() => onUpdate?.({ headingText: heading })} />
        {onRemove && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove}><Trash2 className="h-4 w-4 text-danger" /></Button>}
      </div>
    );
  }

  // Mobile: the description + qty/amount/remove controls don't fit on one 390px
  // line, so the row wraps — description (with the drag handle) takes the full
  // first line, and the controls drop to a second full-width line. At md the
  // original single horizontal row is restored.
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 md:flex-nowrap">
      <div className="flex min-w-0 flex-1 items-center gap-2 max-md:w-full max-md:flex-none">
        {dragHandle}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-ink-100">{item.description ?? '—'}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {item.isRecurring && <Badge variant="accent">Weekly</Badge>}
            {showAgencyTag && (
              <span className="flex items-center gap-1 rounded-full bg-inset px-1.5 py-0.5 text-[11px] text-ink-60">
                <Avatar className="h-4 w-4">
                  {item.agencyLogo && <AvatarImage src={item.agencyLogo} alt="" />}
                  <AvatarFallback className="text-[8px]">{initialsOf(item.agencyName)}</AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate">{item.agencyName ?? 'Partner agency'}</span>
              </span>
            )}
            <label className="flex items-center gap-1 text-[11px] text-ink-60">
              <input type="checkbox" checked={item.isOptional} onChange={(e) => onUpdate?.({ isOptional: e.target.checked })} /> Optional
            </label>
          </div>
        </div>
      </div>
      {/* Controls: their own full-width row on mobile (pushed right), inline at md.
          Recurring items carry two editable prices — a one-time upfront/setup fee
          and the ongoing weekly fee — so both inputs are shown (labelled); a
          one-off item shows a single unlabelled price. */}
      <div className="flex items-end gap-2 max-md:ml-auto">
        <Input className="h-8 w-14" type="number" value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => onUpdate?.({ quantity: Number(qty) || 1 })} />
        {/* Sales mode: a partner agency's price is fixed — the sales agency can't edit it. */}
        {item.isRecurring && (
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wide text-ink-40">Upfront</span>
            <Input className="h-8 w-24 text-right" type="number" value={upfront} disabled={priceLocked} title={priceLocked ? 'Set by the providing agency' : undefined} onChange={(e) => setUpfront(e.target.value)} onBlur={() => { if (!priceLocked) onUpdate?.({ upfrontFee: Number(upfront) || 0 }); }} />
          </label>
        )}
        <label className="flex flex-col gap-0.5">
          {item.isRecurring && <span className="text-[10px] uppercase tracking-wide text-ink-40">Weekly</span>}
          <Input className="h-8 w-24 text-right" type="number" value={amount} disabled={priceLocked} title={priceLocked ? 'Set by the providing agency' : undefined} onChange={(e) => setAmount(e.target.value)} onBlur={() => { if (!priceLocked) onUpdate?.({ amount: Number(amount) || 0 }); }} />
        </label>
        {onRemove && <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onRemove}><Trash2 className="h-4 w-4 text-danger" /></Button>}
      </div>
    </div>
  );
}
