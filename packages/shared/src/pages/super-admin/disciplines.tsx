import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Tags, Plus, GitMerge, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { SectionCard } from './components';
import { Infin8Manager } from './infin8-manager';

const cmp = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

export function DisciplinesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const settings = useQuery(trpc.superAdmin.getSettings.queryOptions());
  const requests = useQuery(trpc.superAdmin.disciplineRequests.queryOptions());

  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  // Merge flow state.
  const [mergeMode, setMergeMode] = useState(false);
  const [selectingTarget, setSelectingTarget] = useState(false);
  const [mergeSelected, setMergeSelected] = useState<Set<string>>(new Set());
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);

  // Add / rename dialog state.
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState('');
  const [renameIndex, setRenameIndex] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Discipline request confirmation dialog state.
  const [confirmReq, setConfirmReq] = useState<{ id: string; discipline: string } | null>(null);

  useEffect(() => {
    if (!initialized && settings.data) {
      setDisciplines([...(settings.data.disciplines ?? [])].sort(cmp));
      setInitialized(true);
    }
  }, [settings.data, initialized]);

  const update = useMutation({
    ...trpc.superAdmin.updateDisciplines.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: trpc.superAdmin.getSettings.queryKey() }),
    onError: (e) => toastError(e),
  });
  const approve = useMutation({
    ...trpc.superAdmin.approveDisciplineRequest.mutationOptions(),
    onSuccess: () => {
      toast.success('Discipline accepted.');
      // Reflect it in the locally-held list immediately — getSettings is held in
      // local state and only seeds once (the `initialized` guard), so the refetch
      // below won't re-sync it back in. Mirrors add/remove/rename.
      if (confirmReq) setDisciplines((prev) => Array.from(new Set([...prev, confirmReq.discipline])).sort(cmp));
      setConfirmReq(null);
      qc.invalidateQueries({ queryKey: trpc.superAdmin.getSettings.queryKey() });
      qc.invalidateQueries({ queryKey: trpc.superAdmin.disciplineRequests.queryKey() });
    },
    onError: (e) => toastError(e),
  });
  const refreshSettings = () => qc.invalidateQueries({ queryKey: trpc.superAdmin.getSettings.queryKey() });
  const renameMut = useMutation({
    ...trpc.superAdmin.renameDiscipline.mutationOptions(),
    onSuccess: () => { toast.success('Discipline renamed across all agencies.'); refreshSettings(); },
    onError: (e) => toastError(e),
  });
  const mergeMut = useMutation({
    ...trpc.superAdmin.mergeDisciplines.mutationOptions(),
    onSuccess: () => { toast.success('Disciplines merged.'); refreshSettings(); },
    onError: (e) => toastError(e),
  });

  function persist(next: string[], toastMsg?: string) {
    const sorted = [...next].sort(cmp);
    setDisciplines(sorted);
    update.mutate({ disciplines: sorted }, toastMsg ? { onSuccess: () => toast.success(toastMsg) } : undefined);
  }

  function onAdd() {
    const v = addValue.trim();
    if (!v) return;
    persist([...disciplines, v], 'Disciplines updated!');
    setAddValue('');
    setAddOpen(false);
  }
  async function onRemove(index: number) {
    const name = disciplines[index];
    if (!(await confirm({
      title: 'Delete discipline?',
      description: <>Remove <span className="font-medium text-ink-100">{name}</span> from the global disciplines list? Agencies will no longer be able to select it.</>,
      confirmLabel: 'Delete',
      destructive: true,
    }))) return;
    persist(disciplines.filter((_, i) => i !== index), 'Disciplines updated!');
  }
  function onRename() {
    if (renameIndex === null) return;
    const v = renameValue.trim();
    const oldName = disciplines[renameIndex];
    if (!v || !oldName || v === oldName) { setRenameIndex(null); setRenameValue(''); return; }
    // Cascade the rename across the global list + every agency that references it.
    renameMut.mutate({ oldName, newName: v });
    setDisciplines((prev) => Array.from(new Set(prev.map((d) => (d === oldName ? v : d)))).sort(cmp));
    setRenameIndex(null);
    setRenameValue('');
  }

  function toggleMergeSelect(d: string) {
    setMergeSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  }
  function startMerge() {
    setMergeMode(true);
    setSelectingTarget(false);
    setMergeSelected(new Set());
    setMergeTarget(null);
  }
  function cancelMerge() {
    setMergeMode(false);
    setSelectingTarget(false);
    setMergeSelected(new Set());
    setMergeTarget(null);
  }
  async function confirmMerge() {
    if (!mergeTarget) return;
    // Cascade: re-point every merged source to the target across global + agencies.
    const sources = [...mergeSelected].filter((d) => d !== mergeTarget);
    if (sources.length && !(await confirm({
      title: 'Merge disciplines?',
      description: <>Merge {sources.length} discipline{sources.length === 1 ? '' : 's'} into <span className="font-medium text-ink-100">{mergeTarget}</span> across the whole platform? This re-points every agency that uses them and cannot be undone.</>,
      confirmLabel: 'Merge',
      destructive: true,
    }))) return;
    if (sources.length) mergeMut.mutate({ sources, target: mergeTarget });
    const next = disciplines.filter((d) => !mergeSelected.has(d) || d === mergeTarget);
    if (!next.includes(mergeTarget)) next.push(mergeTarget);
    setDisciplines(next.sort(cmp));
    cancelMerge();
  }

  const pending = requests.data ?? [];

  return (
    <div>
      <PageHeader title="Taxonomy" description="Manage global disciplines, the Infin8 framework, and review requests" />
      <div className="space-y-8">
        <SectionCard
          icon={<Tags className="h-5 w-5" />}
          title="Disciplines"
          description="Manage the disciplines available for agencies to select."
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
                <Button variant="outline" size="sm" onClick={startMerge}><GitMerge className="h-4 w-4" /> Merge</Button>
                <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add</Button>
              </div>
            )
          }
        >
          {settings.isLoading ? (
            <div className="flex flex-wrap gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}</div>
          ) : disciplines.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-40">No disciplines configured</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectingTarget && <p className="w-full text-xs text-ink-60">Select which discipline to merge the others into:</p>}
              {disciplines.map((d, i) => {
                const inMerge = mergeSelected.has(d);
                const isTarget = mergeTarget === d;
                const onClick = () => {
                  if (selectingTarget) { if (mergeSelected.has(d)) setMergeTarget(d); return; }
                  if (mergeMode) { toggleMergeSelect(d); return; }
                };
                return (
                  <span
                    key={d}
                    onClick={mergeMode ? onClick : undefined}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm',
                      mergeMode && 'cursor-pointer',
                      isTarget
                        ? 'border-accent bg-accent/10 text-accent'
                        : inMerge
                          ? 'border-accent/50 bg-accent/5 text-accent'
                          : 'border-[color:var(--color-border-default)] text-ink-80',
                      selectingTarget && !inMerge && 'opacity-40',
                    )}
                  >
                    {d}
                    {!mergeMode && (
                      <>
                        <button type="button" className="text-ink-40 hover:text-ink-80" onClick={() => { setRenameIndex(i); setRenameValue(d); }}>
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button type="button" className="text-ink-40 hover:text-danger" onClick={() => onRemove(i)}>
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </SectionCard>

        {pending.length > 0 && (
          <SectionCard
            icon={<Tags className="h-5 w-5" />}
            title="Discipline Requests"
            description="Review and accept custom disciplines suggested by agencies."
          >
            <div className="flex flex-wrap gap-2">
              {pending.map((req) => (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setConfirmReq({ id: req.id, discipline: req.discipline })}
                  title="Tap to review"
                  className="press inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/5 px-3 py-1 text-sm text-accent"
                >
                  {req.discipline}
                </button>
              ))}
            </div>
          </SectionCard>
        )}

        <Infin8Manager />
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Discipline</DialogTitle></DialogHeader>
          <Input autoFocus placeholder="Discipline name" value={addValue} onChange={(e) => setAddValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onAdd()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button variant="accent" onClick={onAdd}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmReq !== null} onOpenChange={(o) => !o && setConfirmReq(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Accept Discipline Request</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-ink-60">
              Accept{' '}
              <span className="font-medium text-ink-100">{confirmReq?.discipline}</span> and add it to the
              global disciplines list?
            </p>
            <p className="text-xs text-ink-40">
              Once accepted, this discipline becomes available to every agency on the platform and can be
              selected when creating or editing their profiles.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmReq(null)}>Cancel</Button>
            <Button
              variant="accent"
              disabled={approve.isPending}
              onClick={() => confirmReq && approve.mutate({ id: confirmReq.id })}
            >
              Accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameIndex !== null} onOpenChange={(o) => !o && setRenameIndex(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rename Discipline</DialogTitle></DialogHeader>
          <Input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onRename()} />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameIndex(null)}>Cancel</Button>
            <Button variant="accent" onClick={onRename}>Rename</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
