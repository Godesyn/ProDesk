import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import { toastError } from '../../lib/errors';

type Tag = { id: string; name: string; color: string };

/**
 * Tag mutations for the project-detail screen, all applied optimistically so the
 * chips + popover update instantly instead of waiting for the realtime round-trip.
 *
 * Three query caches hold tag data and are kept in sync on every mutation:
 *   - `projects.byId`      — this project's assigned tags (the chips)
 *   - `projects.boardFacets` — the agency's full tag palette (the popover list)
 *   - `projects.board`     — every card's tag dots across all board queries
 *
 * Each mutation snapshots those caches in `onMutate`, patches them, rolls back in
 * `onError` (with a toast), and re-validates against the server in `onSettled`.
 */
export function useProjectTagMutations(project: { id: string; tags?: Tag[] }, agencyId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();

  const byIdKey = trpc.projects.byId.queryKey({ id: project.id });
  const facetsKey = trpc.projects.boardFacets.queryKey({ agencyId });
  // Partial key — matches every board query regardless of its filter args.
  const boardKey = trpc.projects.board.queryKey();

  /* ---- cache patch helpers ---- */

  // The agency's full tag palette (popover list).
  const patchFacetTags = (fn: (tags: Tag[]) => Tag[]) =>
    qc.setQueryData(facetsKey, (old: any) => (old ? { ...old, tags: fn(old.tags ?? []) } : old));

  // This project's assigned tags (the chips).
  const patchByIdTags = (fn: (tags: Tag[]) => Tag[]) =>
    qc.setQueryData(byIdKey, (old: any) => (old ? { ...old, tags: fn(old.tags ?? []) } : old));

  // Every board card's tags; `fn` receives the card's project id so per-project
  // assignment changes can be scoped while rename/delete apply to all cards.
  const patchBoardTags = (fn: (tags: Tag[], projectId: string) => Tag[]) =>
    qc.setQueriesData({ queryKey: boardKey }, (old: any) => {
      if (!old?.columns) return old;
      const columns = Object.fromEntries(
        Object.entries(old.columns).map(([status, list]: [string, any]) => [
          status,
          (list as any[]).map((p) => ({ ...p, tags: fn(p.tags ?? [], p.id) })),
        ]),
      );
      return { ...old, columns };
    });

  const snapshot = () => ({
    byId: qc.getQueryData(byIdKey),
    facets: qc.getQueryData(facetsKey),
    board: qc.getQueriesData({ queryKey: boardKey }),
  });
  type Snap = ReturnType<typeof snapshot>;
  const restore = (snap: Snap) => {
    qc.setQueryData(byIdKey, snap.byId);
    qc.setQueryData(facetsKey, snap.facets);
    snap.board.forEach(([key, data]) => qc.setQueryData(key, data));
  };
  const cancel = () =>
    Promise.all([
      qc.cancelQueries({ queryKey: byIdKey }),
      qc.cancelQueries({ queryKey: facetsKey }),
      qc.cancelQueries({ queryKey: boardKey }),
    ]);
  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: byIdKey });
    qc.invalidateQueries({ queryKey: facetsKey });
    qc.invalidateQueries({ queryKey: boardKey });
  };

  // Full tag objects (name + color) keyed by id, merged from the palette and the
  // currently-assigned set, so a tagIds-only payload can be rebuilt into chips.
  const tagPool = () => {
    const facets = ((qc.getQueryData(facetsKey) as any)?.tags ?? []) as Tag[];
    const assigned = (((qc.getQueryData(byIdKey) as any)?.tags ?? project.tags ?? []) as Tag[]);
    const map = new Map<string, Tag>();
    [...facets, ...assigned].forEach((t) => map.set(t.id, t));
    return map;
  };
  const assignedIds = () =>
    (((qc.getQueryData(byIdKey) as any)?.tags ?? project.tags ?? []) as Tag[]).map((t) => t.id);

  /* ---- mutations ---- */

  // Assign/unassign the given set of tags on THIS project.
  const setTags = useMutation(
    trpc.projects.setProjectTags.mutationOptions({
      onMutate: async (vars) => {
        await cancel();
        const snap = snapshot();
        const pool = tagPool();
        const nextTags = vars.tagIds.map((id) => pool.get(id)).filter(Boolean) as Tag[];
        patchByIdTags(() => nextTags);
        patchBoardTags((tags, pid) => (pid === vars.id ? nextTags : tags));
        return snap;
      },
      onError: (e, _v, snap) => {
        if (snap) restore(snap);
        toastError(e);
      },
      onSettled: invalidateAll,
    }),
  );

  // Create a new agency tag and immediately assign it to this project.
  const createTag = useMutation(
    trpc.projectTags.create.mutationOptions({
      onMutate: async (vars) => {
        await cancel();
        const snap = snapshot();
        const temp: Tag = { id: `temp-${crypto.randomUUID()}`, name: vars.name, color: vars.color };
        patchFacetTags((tags) => [...tags, temp]);
        patchByIdTags((tags) => [...tags, temp]);
        patchBoardTags((tags, pid) => (pid === project.id ? [...tags, temp] : tags));
        return { snap, tempId: temp.id };
      },
      onError: (e, _v, ctx) => {
        if (ctx?.snap) restore(ctx.snap);
        toastError(e);
      },
      onSuccess: (newTag, _v, ctx) => {
        // Swap the temp id for the real one everywhere it was optimistically added.
        const swap = (tags: Tag[]) => tags.map((t) => (t.id === ctx?.tempId ? { ...t, id: newTag.id } : t));
        patchFacetTags(swap);
        patchByIdTags(swap);
        patchBoardTags((tags) => swap(tags));
        // Persist the assignment — create() only made the tag, not the link.
        setTags.mutate({ id: project.id, tagIds: assignedIds() });
      },
    }),
  );

  // Rename an agency tag (reflected on every card that carries it).
  const updateTag = useMutation(
    trpc.projectTags.update.mutationOptions({
      onMutate: async (vars) => {
        await cancel();
        const snap = snapshot();
        const rename = (tags: Tag[]) => tags.map((t) => (t.id === vars.id ? { ...t, name: vars.name } : t));
        patchFacetTags(rename);
        patchByIdTags(rename);
        patchBoardTags((tags) => rename(tags));
        return snap;
      },
      onError: (e, _v, snap) => {
        if (snap) restore(snap);
        toastError(e);
      },
      onSettled: invalidateAll,
    }),
  );

  // Delete an agency tag entirely (removed from the palette and every card).
  const deleteTag = useMutation(
    trpc.projectTags.delete.mutationOptions({
      onMutate: async (vars) => {
        await cancel();
        const snap = snapshot();
        const remove = (tags: Tag[]) => tags.filter((t) => t.id !== vars.id);
        patchFacetTags(remove);
        patchByIdTags(remove);
        patchBoardTags((tags) => remove(tags));
        return snap;
      },
      onError: (e, _v, snap) => {
        if (snap) restore(snap);
        toastError(e);
      },
      onSettled: invalidateAll,
    }),
  );

  /* ---- high-level actions (read the freshest assignment from cache) ---- */

  const toggleTag = (tag: Tag) => {
    const ids = assignedIds();
    const next = ids.includes(tag.id) ? ids.filter((i) => i !== tag.id) : [...ids, tag.id];
    setTags.mutate({ id: project.id, tagIds: next });
  };

  const removeTag = (tagId: string) => {
    setTags.mutate({ id: project.id, tagIds: assignedIds().filter((i) => i !== tagId) });
  };

  return { setTags, createTag, updateTag, deleteTag, toggleTag, removeTag, agencyId };
}

export type ProjectTagMutations = ReturnType<typeof useProjectTagMutations>;
