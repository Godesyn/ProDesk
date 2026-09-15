import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Plus, GitMerge, Pencil, X, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { SectionCard } from './components';

interface Stage { stage: string; substages: string[] }

/**
 * Super-admin Infin8 taxonomy manager — the Infin8 analogue of the disciplines
 * screen. Structural edits that don't rename anything (add / delete a STAGE,
 * add / delete a SUBSTAGE) persist the whole ordered array via
 * updateInfin8Stages. Renames cascade through dedicated endpoints: renaming a
 * SUBSTAGE updates every agency's selection + every service's sub_stage; renaming
 * a STAGE updates every service's stage. Merging a SUBSTAGE cascades the same way
 * as a rename. Reads from agencies.infin8Stages (admin-editable, default-seeded).
 */
export function Infin8Manager() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const query = useQuery(trpc.agencies.infin8Stages.queryOptions());

  const [stages, setStages] = useState<Stage[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Merge flow (substages, may span stages).
  const [mergeMode, setMergeMode] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  // Dialogs / inline add.
  const [addStageOpen, setAddStageOpen] = useState(false);
  const [addStageValue, setAddStageValue] = useState('');
  const [renameStageIdx, setRenameStageIdx] = useState<number | null>(null);
  const [renameStageValue, setRenameStageValue] = useState('');
  const [renameSub, setRenameSub] = useState<string | null>(null);
  const [renameSubValue, setRenameSubValue] = useState('');
  const [addSubFor, setAddSubFor] = useState<number | null>(null);
  const [addSubValue, setAddSubValue] = useState('');

  useEffect(() => {
    if (!initialized && query.data) {
      setStages(query.data.map((g) => ({ stage: g.stage, substages: [...g.substages] })));
      setInitialized(true);
    }
  }, [query.data, initialized]);

  const refresh = () => qc.invalidateQueries({ queryKey: trpc.agencies.infin8Stages.queryKey() });
  const updateMut = useMutation({
    ...trpc.superAdmin.updateInfin8Stages.mutationOptions(),
    onSuccess: refresh,
    onError: (e) => toastError(e),
  });
  const renameMut = useMutation({
    ...trpc.superAdmin.renameInfin8Substage.mutationOptions(),
    onSuccess: () => { toast.success('Substage renamed across all agencies.'); refresh(); },
    onError: (e) => toastError(e),
  });
  const renameStageMut = useMutation({
    ...trpc.superAdmin.renameInfin8Stage.mutationOptions(),
    onSuccess: () => { toast.success('Stage renamed across all services.'); refresh(); },
    onError: (e) => toastError(e),
  });
  const mergeMut = useMutation({
    ...trpc.superAdmin.mergeInfin8Substages.mutationOptions(),
    onSuccess: () => { toast.success('Substages merged.'); refresh(); },
    onError: (e) => toastError(e),
  });

  function persist(next: Stage[], msg?: string) {
    setStages(next);
    updateMut.mutate({ stages: next }, msg ? { onSuccess: () => { toast.success(msg); refresh(); } } : undefined);
  }

  function addStage() {
    const v = addStageValue.trim();
    if (!v) return;
    persist([...stages, { stage: v, substages: [] }], 'Stage added.');
    setAddStageValue('');
    setAddStageOpen(false);
  }
  function renameStage() {
    if (renameStageIdx === null) return;
    const v = renameStageValue.trim();
    const oldName = stages[renameStageIdx]?.stage;
    if (!v || !oldName || v === oldName) { setRenameStageIdx(null); setRenameStageValue(''); return; }
    // Cascade: rename the stage in the taxonomy + every service pinned to it.
    renameStageMut.mutate({ oldName, newName: v });
    setStages((prev) => prev.map((g, i) => (i === renameStageIdx ? { ...g, stage: v } : g)));
    setRenameStageIdx(null);
    setRenameStageValue('');
  }
  async function deleteStage(i: number) {
    const g = stages[i];
    const subCount = g?.substages.length ?? 0;
    if (!(await confirm({
      title: 'Delete stage?',
      description: <>Remove the <span className="font-medium text-ink-100">{g?.stage}</span> stage{subCount ? <> and its {subCount} substage{subCount === 1 ? '' : 's'}</> : ''} from the Infin8 taxonomy? This cannot be undone.</>,
      confirmLabel: 'Delete',
      destructive: true,
    }))) return;
    persist(stages.filter((_, idx) => idx !== i), 'Stage removed.');
  }
  function addSubstage() {
    if (addSubFor === null) return;
    const v = addSubValue.trim();
    if (!v) { setAddSubFor(null); return; }
    persist(stages.map((g, i) => (i === addSubFor && !g.substages.includes(v) ? { ...g, substages: [...g.substages, v] } : g)), 'Substage added.');
    setAddSubValue('');
    setAddSubFor(null);
  }
  async function deleteSubstage(stageIdx: number, sub: string) {
    if (!(await confirm({
      title: 'Delete substage?',
      description: <>Remove <span className="font-medium text-ink-100">{sub}</span> from the Infin8 taxonomy? This cannot be undone.</>,
      confirmLabel: 'Delete',
      destructive: true,
    }))) return;
    persist(stages.map((g, i) => (i === stageIdx ? { ...g, substages: g.substages.filter((s) => s !== sub) } : g)), 'Substage removed.');
  }
  function renameSubstage() {
    if (!renameSub) return;
    const v = renameSubValue.trim();
    if (!v || v === renameSub) { setRenameSub(null); return; }
    renameMut.mutate({ oldName: renameSub, newName: v });
    // Optimistic local: replace across all stages (dedupe per stage).
    setStages((prev) => prev.map((g) => ({ ...g, substages: Array.from(new Set(g.substages.map((s) => (s === renameSub ? v : s)))) })));
    setRenameSub(null);
    setRenameSubValue('');
  }

  function toggleMergeSelect(sub: string) {
    setMergeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sub)) next.delete(sub); else next.add(sub);
      return next;
    });
  }
  function cancelMerge() {
    setMergeMode(false);
    setSelectingTarget(false);
    setMergeSelected(new Set());
    setMergeTarget(null);
  }
  async function confirmMerge() {
    if (!mergeTarget) return;
    const sources = [...mergeSelected].filter((s) => s !== mergeTarget);
    if (sources.length && !(await confirm({
      title: 'Merge substages?',
      description: <>Merge {sources.length} substage{sources.length === 1 ? '' : 's'} into <span className="font-medium text-ink-100">{mergeTarget}</span> across every agency and service that uses them? This cannot be undone.</>,
      confirmLabel: 'Merge',
      destructive: true,
    }))) return;
    if (sources.length) mergeMut.mutate({ sources, target: mergeTarget });
    // Optimistic local: collapse sources → target, dedupe per stage.
    setStages((prev) => prev.map((g) => ({ ...g, substages: Array.from(new Set(g.substages.map((s) => (mergeSelected.has(s) ? mergeTarget : s)))) })));
    cancelMerge();
  }

  return (
    <SectionCard
      icon={<Layers className="h-5 w-5" />}
      title="Infin8 Stages & Substages"
      description="The taxonomy agencies pick from. Renaming or merging cascades across every agency and service that uses it."
      action={
        mergeMode ? (
          <div className="flex items-center gap-2">
            {!selectingTarget ? (
              <>
                <Button variant="ghost" size="sm" onClick={cancelMerge}>Cancel</Button>
                <Button variant="accent" size="sm" disabled={mergeSelected.size < 2} onClick={() => setSelectingTarget(true)}>
                  Choose target ({mergeSelected.size})
                </Button>
              </>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setSelectingTarget(false); setMergeTarget(null); }}>Back</Button>
                <Button variant="accent" size="sm" disabled={!mergeTarget} onClick={confirmMerge}>Merge</Button>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => { setMergeMode(true); setMergeSelected(new Set()); setMergeTarget(null); }}><GitMerge className="h-4 w-4" /> Merge substages</Button>
            <Button variant="outline" size="sm" onClick={() => setAddStageOpen(true)}><Plus className="h-4 w-4" /> Add stage</Button>
          </div>
        )
      }
    >
      {query.isLoading ? (
        <div className="flex flex-col gap-5">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="flex flex-wrap gap-2">{Array.from({ length: 6 }).map((__, j) => <Skeleton key={j} className="h-7 w-28 rounded-full" />)}</div>)}</div>
      ) : (
        <div className="flex flex-col gap-6">
          {selectingTarget && <p className="text-xs text-ink-60">Select which substage to merge the others into.</p>}
          {stages.map((group, stageIdx) => (
            <div key={stageIdx}>
              <div className="mb-2 flex items-center gap-2">
                <span className="text-eyebrow text-ink-80">{group.stage}</span>
                {!mergeMode && (
                  <span className="flex items-center gap-1">
                    <button type="button" className="text-ink-40 hover:text-ink-80" title="Rename stage" onClick={() => { setRenameStageIdx(stageIdx); setRenameStageValue(group.stage); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" className="text-ink-40 hover:text-danger" title="Delete stage" onClick={() => deleteStage(stageIdx)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.substages.map((sub) => {
                  const inMerge = mergeSelected.has(sub);
                  const isTarget = mergeTarget === sub;
                  const onClick = () => {
                    if (selectingTarget) { if (mergeSelected.has(sub)) setMergeTarget(sub); return; }
                    if (mergeMode) { toggleMergeSelect(sub); return; }
                  };
                  return (
                    <span
                      key={sub}
                      onClick={mergeMode ? onClick : undefined}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-1 text-sm',
                        mergeMode && 'cursor-pointer',
                        isTarget ? 'border-accent bg-accent/10 text-accent'
                          : inMerge ? 'border-accent/50 bg-accent/5 text-accent'
                            : 'border-[color:var(--color-border-default)] text-ink-80',
                        selectingTarget && !inMerge && 'opacity-40',
                      )}
                    >
                      {sub}
                      {!mergeMode && (
                        <>
                          <button type="button" className="text-ink-40 hover:text-ink-80" title="Rename" onClick={() => { setRenameSub(sub); setRenameSubValue(sub); }}>
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button type="button" className="text-ink-40 hover:text-danger" title="Remove" onClick={() => deleteSubstage(stageIdx, sub)}>
                            <X className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </span>
                  );
                })}
                {!mergeMode && (
                  addSubFor === stageIdx ? (
                    <span className="inline-flex items-center gap-1">
                      <Input autoFocus className="h-7 w-44" placeholder="New substage" value={addSubValue} onChange={(e) => setAddSubValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSubstage(); if (e.key === 'Escape') setAddSubFor(null); }} />
                      <Button size="sm" variant="accent" onClick={addSubstage}>Add</Button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => { setAddSubFor(stageIdx); setAddSubValue(''); }} className="press inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-dashed border-[color:var(--color-border-default)] px-3 py-1 text-sm text-ink-40 hover:text-ink-80">
                      <Plus className="h-3 w-3" /> Add
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={addStageOpen} onOpenChange={setAddStageOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Stage</DialogTitle></DialogHeader>
          <Input autoFocus placeholder="e.g. 9. ELEVATE" value={addStageValue} onChange={(e) => setAddStageValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addStage()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddStageOpen(false)}>Cancel</Button>
            <Button variant="accent" onClick={addStage}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameStageIdx !== null} onOpenChange={(o) => !o && setRenameStageIdx(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Stage</DialogTitle></DialogHeader>
          <Input autoFocus value={renameStageValue} onChange={(e) => setRenameStageValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && renameStage()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameStageIdx(null)}>Cancel</Button>
            <Button variant="accent" onClick={renameStage}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameSub !== null} onOpenChange={(o) => !o && setRenameSub(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Substage</DialogTitle></DialogHeader>
          <p className="text-sm text-ink-60">This renames the substage everywhere, including every agency that selected it.</p>
          <Input autoFocus value={renameSubValue} onChange={(e) => setRenameSubValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && renameSubstage()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameSub(null)}>Cancel</Button>
            <Button variant="accent" onClick={renameSubstage}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}
