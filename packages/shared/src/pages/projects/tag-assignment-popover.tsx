import { useState, useMemo } from 'react';
import { Plus, Check, Search, X, Pencil, Trash2 } from 'lucide-react';
import { Popover } from '../../components/ui/popover';
import { useConfirm } from '../../components/ui/confirm-dialog';
import { cn } from '../../lib/utils';
import { PRIMARY_COLORS, TAG_COLOR_MAP, type TagColor } from '../../lib/tag-colors';
import type { ProjectTagMutations } from './use-project-tags';

export function TagAssignmentPopover({
  project,
  agencyId,
  availableTags,
  mutations,
}: {
  project: any;
  agencyId: string;
  availableTags: any[];
  mutations: ProjectTagMutations;
}) {
  const [search, setSearch] = useState('');
  const [creatingColor, setCreatingColor] = useState<TagColor>('red');
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const confirm = useConfirm();
  const { createTag, updateTag, deleteTag, toggleTag } = mutations;

  const filteredTags = useMemo(() => {
    if (!search.trim()) return availableTags;
    const lower = search.toLowerCase();
    return availableTags.filter((t: any) => t.name.toLowerCase().includes(lower));
  }, [search, availableTags]);

  const exactMatch = availableTags.find((t: any) => t.name.toLowerCase() === search.trim().toLowerCase());
  const canCreate = search.trim().length > 0 && !exactMatch && availableTags.length < 5;
  const atTagLimit = availableTags.length >= 5 && !exactMatch && search.trim().length > 0;

  const saveRename = (t: any) => {
    const name = editName.trim();
    if (!name || name === t.name) { setEditingTagId(null); return; }
    updateTag.mutate({ id: t.id, agencyId, name });
    setEditingTagId(null);
  };

  const onDelete = async (t: any) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      description: 'This tag will be removed from every project it’s applied to. This cannot be undone.',
      confirmLabel: 'Delete tag',
      destructive: true,
    });
    if (ok) deleteTag.mutate({ id: t.id, agencyId });
  };

  return (
    <Popover
      align="start"
      className="w-56 p-0 shadow-lg bg-white border border-slate-200 rounded-md overflow-hidden"
      trigger={({ open: popoverOpen, toggle }) => (
        <button
          onClick={() => {
            if (!popoverOpen) setSearch('');
            toggle();
          }}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium border-dashed border-slate-300 text-ink-60 hover:text-ink-80 hover:bg-slate-50 transition-colors",
            popoverOpen && "bg-slate-50"
          )}
        >
          <Plus className="h-3 w-3" />
          Add Tag
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col max-h-80">
          <div className="relative border-b border-slate-100 px-2 py-1.5 flex items-center">
            <Search className="h-3.5 w-3.5 text-ink-40 shrink-0" />
            <input
              autoFocus
              placeholder="Search or create tag..."
              className="flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-ink-40"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={30}
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-ink-40 hover:text-ink-80 p-0.5">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
            {filteredTags.map((t: any) => {
              const isSelected = project.tags?.some((pt: any) => pt.id === t.id);
              const isEditing = editingTagId === t.id;

              if (isEditing) {
                return (
                  <div key={t.id} className="flex items-center gap-1.5 px-2 py-1.5 bg-slate-50 rounded-sm">
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: TAG_COLOR_MAP[t.color] || t.color }} />
                    <input
                      autoFocus
                      className="flex-1 min-w-0 bg-white border border-slate-200 px-2 py-0.5 text-sm outline-none rounded-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      maxLength={50}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename(t);
                        if (e.key === 'Escape') setEditingTagId(null);
                      }}
                    />
                    <button
                      onClick={() => saveRename(t)}
                      disabled={!editName.trim()}
                      className="p-1 text-ink-60 hover:text-ink-100 disabled:opacity-50"
                      title="Save"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDelete(t)}
                      className="p-1 text-ink-40 hover:text-danger"
                      title="Delete tag"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setEditingTagId(null)} className="p-1 text-ink-60 hover:text-ink-100" title="Cancel"><X className="h-3.5 w-3.5" /></button>
                  </div>
                );
              }

              return (
                <div key={t.id} className="w-full flex items-center gap-1 px-2 py-1 text-sm text-left hover:bg-slate-100 rounded-sm group">
                  <button
                    className="flex-1 flex items-center gap-2 text-left min-w-0"
                    onClick={() => toggleTag(t)}
                  >
                    <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: TAG_COLOR_MAP[t.color] || t.color }} />
                    <span className="text-ink-80 flex-1 truncate">{t.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-ink-100 mr-2 shrink-0" />}
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditName(t.name);
                      setEditingTagId(t.id);
                    }}
                    className="p-1 text-ink-40 hover:text-ink-80 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    title="Edit tag"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              );
            })}

            {filteredTags.length === 0 && !canCreate && !atTagLimit && (
              <p className="p-2 text-xs text-ink-40 text-center">No matching tags.</p>
            )}

            {atTagLimit && (
              <p className="p-2 text-xs text-danger text-center">Maximum of 5 tags reached.</p>
            )}

            {canCreate && (
              <div className={cn(filteredTags.length > 0 && "mt-2 pt-2 border-t border-slate-100")}>
                <div className="px-2 pb-2">
                  <span className="text-xs text-ink-60">Create <span className="font-semibold text-ink-100">"{search.trim()}"</span></span>
                </div>
                <div className="flex items-center gap-1.5 px-2 pb-1.5">
                  {PRIMARY_COLORS.map(c => {
                    const inUse = availableTags.some((t: any) => t.color === c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={inUse}
                        className={cn(
                          "h-5 w-5 rounded-full border-2 transition-all flex items-center justify-center",
                          creatingColor === c.id ? "border-ink-100 scale-110" : "border-transparent hover:scale-105",
                          inUse && "opacity-30 cursor-not-allowed"
                        )}
                        style={{ backgroundColor: c.hex }}
                        onClick={() => {
                          setCreatingColor(c.id);
                          createTag.mutate({ agencyId, name: search.trim(), color: c.id });
                          setSearch('');
                          close();
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Popover>
  );
}
