import { useState, type ReactNode } from 'react';
import { ChevronRight, Move, Trash2, FileBox, Globe } from 'lucide-react';
import { formatDate } from '../../lib/utils';
import { Card } from '../ui/card';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../layout/empty-state';

/** Best-effort file extension for display on the glyph. */
export function extOf(name: string, type: string): string {
  const i = name.lastIndexOf('.');
  if (i > 0 && i < name.length - 1) return name.slice(i + 1);
  return type;
}

/** Classic two-tone OS folder, tinted by the current text color. */
export function FolderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 52" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Back panel with tab */}
      <path
        d="M4 12a4 4 0 0 1 4-4h14.3a4 4 0 0 1 2.83 1.17L29 13h27a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="currentColor"
        fillOpacity="0.55"
      />
      {/* Front pocket */}
      <path d="M4 22h56v22a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" fill="currentColor" />
      {/* Top highlight on the front edge */}
      <path d="M4 22h56v2H4z" fill="#fff" fillOpacity="0.18" />
    </svg>
  );
}

const TYPE_TINT: Record<string, string> = {
  image: 'text-emerald-500',
  pdf: 'text-rose-500',
  doc: 'text-sky-500',
  docx: 'text-sky-500',
  xls: 'text-green-600',
  xlsx: 'text-green-600',
  csv: 'text-green-600',
  ppt: 'text-orange-500',
  pptx: 'text-orange-500',
  zip: 'text-amber-500',
  rar: 'text-amber-500',
};

/** OS-style document glyph: page with a folded corner and an extension ribbon. */
export function FileGlyph({ type, ext, className }: { type: string; ext: string; className?: string }) {
  const tint = TYPE_TINT[type] ?? 'text-ink-60';
  return (
    <svg viewBox="0 0 48 60" className={`${tint} ${className ?? ''}`} fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* Page */}
      <path
        d="M9 4h21l13 13v36a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="2"
      />
      {/* Folded corner */}
      <path d="M30 4v10a3 3 0 0 0 3 3h10" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2" fill="none" />
      {/* Extension ribbon */}
      <rect x="6" y="33" width="37" height="14" rx="3" fill="currentColor" />
      <text x="24.5" y="43" textAnchor="middle" fontSize="9" fontWeight="700" fill="#fff" fontFamily="ui-sans-serif, system-ui, sans-serif">
        {ext.slice(0, 4).toUpperCase()}
      </text>
    </svg>
  );
}

export interface Crumb {
  id: string | null;
  name: string;
}

export interface LockerGridProps {
  loading?: boolean;
  crumbs: Crumb[];
  childFolders: { id: string; name: string }[];
  files: any[];
  onNavigate: (folderId: string | null) => void;
  onOpenFile: (f: any) => void;
  /** Sub-caption under a file name (agency names on the brand side, owner badge on the agency side). */
  fileCaption?: (f: any) => ReactNode;
  emptyDescription?: string;
  /**
   * Read-only mode (the agency client view): no create/rename/move/reorder/delete
   * and no drag-and-drop — folders open, files open, nothing mutates. When false
   * (the brand owner view) the mutation handlers below drive the interactions.
   */
  readOnly?: boolean;
  onMoveToFolder?: (fileId: string, folderId: string | null) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
  onRenameFolder?: (id: string, name: string) => void;
  onDeleteFolder?: (f: { id: string; name: string }) => void;
  onMoveFile?: (fileId: string) => void;
  onDeleteFile?: (f: any) => void;
  /** Copy an agency doc to Public Brand Assets — shown only on files not already public. */
  onCopyToPublic?: (f: any) => void;
}

/**
 * The Document Locker file/folder grid + breadcrumbs — OS-style tiles shared by
 * the brand owner view (document_locker, full mutations) and the agency client
 * view (read-only). The `readOnly` flag is the only thing that differs in markup.
 */
export function LockerGrid({
  loading,
  crumbs,
  childFolders,
  files,
  onNavigate,
  onOpenFile,
  fileCaption,
  emptyDescription = 'Upload a document or create a folder to get started.',
  readOnly = false,
  onMoveToFolder,
  onReorder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFile,
  onDeleteFile,
  onCopyToPublic,
}: LockerGridProps) {
  const currentId = crumbs.length ? crumbs[crumbs.length - 1].id : null;

  // Drag-and-drop + inline rename state — only meaningful when not read-only.
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverCrumb, setDragOverCrumb] = useState<string | null>(null);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');

  const startFolderRename = (f: { id: string; name: string }) => { setRenameFolderId(f.id); setFolderDraft(f.name); };
  const commitFolderRename = () => {
    const id = renameFolderId;
    const next = folderDraft.trim();
    setRenameFolderId(null);
    if (id && next) onRenameFolder?.(id, next);
  };

  return (
    <div>
      {/* Breadcrumbs (drop a dragged file on an ancestor crumb to move it out). */}
      <div className="mb-3 flex flex-wrap items-center gap-1 text-sm text-ink-60">
        {crumbs.map((c, i) => {
          const key = c.id ?? 'root';
          const isCurrent = (c.id ?? null) === currentId;
          const canDrop = !readOnly && !!dragId && !isCurrent;
          return (
            <span key={key} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-ink-40" />}
              <button
                className={`rounded px-1.5 py-0.5 transition ${i === crumbs.length - 1 ? 'font-medium text-ink-100' : 'hover:text-ink-100'} ${canDrop && dragOverCrumb === key ? 'bg-accent/10 text-ink-100 ring-1 ring-accent' : ''}`}
                onClick={() => onNavigate(c.id)}
                onDragOver={(e) => { if (canDrop) { e.preventDefault(); setDragOverCrumb(key); } }}
                onDragLeave={() => setDragOverCrumb((cur) => (cur === key ? null : cur))}
                onDrop={(e) => { e.preventDefault(); setDragOverCrumb(null); if (canDrop) onMoveToFolder?.(dragId!, c.id); setDragId(null); }}
                title={canDrop ? 'Move here' : undefined}
              >
                {c.name}
              </button>
            </span>
          );
        })}
      </div>

      <Card className="p-0">
        {loading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : childFolders.length === 0 && files.length === 0 ? (
          <EmptyState icon={FileBox} title="Empty" description={emptyDescription} />
        ) : (
          <div className="grid grid-cols-2 gap-1 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {childFolders.map((f) => (
              <div
                key={f.id}
                className={`group relative min-w-0 rounded-xl transition ${!readOnly && dragOverFolderId === f.id ? 'bg-accent/5 ring-2 ring-accent' : ''}`}
                onDragOver={(e) => { if (!readOnly && dragId) { e.preventDefault(); setDragOverFolderId(f.id); } }}
                onDragLeave={() => setDragOverFolderId((cur) => (cur === f.id ? null : cur))}
                onDrop={(e) => { e.preventDefault(); setDragOverFolderId(null); if (!readOnly && dragId) onMoveToFolder?.(dragId, f.id); setDragId(null); }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full min-w-0 cursor-pointer flex-col items-center gap-2 rounded-xl border border-transparent px-2 py-3 text-center transition hover:border-[color:var(--color-border-default)] hover:bg-inset/50"
                  title={f.name}
                  onClick={() => onNavigate(f.id)}
                  // Keyboard: only act when the tile itself is focused, never when a
                  // child (the rename input/button) bubbles a keystroke up.
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onNavigate(f.id); } }}
                >
                  {/* The whole tile opens the folder; the name below renames it (when editable). */}
                  <FolderGlyph className="h-14 w-16 text-accent drop-shadow-sm" />
                  {!readOnly && renameFolderId === f.id ? (
                    <input
                      autoFocus
                      value={folderDraft}
                      onChange={(e) => setFolderDraft(e.target.value)}
                      onFocus={(e) => e.currentTarget.select()}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={commitFolderRename}
                      onKeyDown={(e) => {
                        e.stopPropagation(); // typing (incl. space) must not reach the tile's open handler
                        if (e.key === 'Enter') { e.preventDefault(); commitFolderRename(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setRenameFolderId(null); }
                      }}
                      className="w-full rounded border border-[color:var(--color-border-default)] bg-surface px-1 py-0.5 text-center text-xs font-medium text-ink-100 outline-none focus:ring-1 focus:ring-accent"
                    />
                  ) : readOnly ? (
                    <span className="line-clamp-2 w-full overflow-hidden break-words [overflow-wrap:anywhere] text-xs font-medium text-ink-100">{f.name}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); startFolderRename(f); }}
                      title="Rename folder"
                      className="line-clamp-2 w-full overflow-hidden break-words [overflow-wrap:anywhere] text-xs font-medium text-ink-100 hover:text-accent"
                    >
                      {f.name}
                    </button>
                  )}
                </div>
                {!readOnly && onDeleteFolder && (
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Delete folder"
                    className="absolute right-1 top-1 h-7 w-7 opacity-0 transition group-hover:opacity-100"
                    onClick={() => onDeleteFolder(f)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            {files.map((f) => (
              <div
                key={f.id}
                className={`group relative min-w-0 ${!readOnly && dragId === f.id ? 'opacity-40' : ''}`}
                draggable={!readOnly}
                onDragStart={() => !readOnly && setDragId(f.id)}
                onDragEnd={() => { setDragId(null); setDragOverFolderId(null); setDragOverCrumb(null); }}
                onDragOver={(e) => { if (!readOnly && dragId && dragId !== f.id) e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); if (!readOnly && dragId) onReorder?.(dragId, f.id); setDragId(null); }}
              >
                <button
                  type="button"
                  onClick={() => onOpenFile(f)}
                  className={`flex w-full min-w-0 flex-col items-center gap-2 rounded-xl border border-transparent px-2 py-3 text-center transition hover:border-[color:var(--color-border-default)] hover:bg-inset/50 ${readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
                  title={f.note ? `${f.name}\n${f.note}` : f.name}
                >
                  <FileGlyph type={f.type ?? 'file'} ext={extOf(f.name, f.type ?? 'file')} className="h-14 w-16" />
                  <span className="line-clamp-2 w-full overflow-hidden break-words [overflow-wrap:anywhere] text-xs font-medium text-ink-100">{f.name}</span>
                  {fileCaption?.(f)}
                  <span className="w-full truncate text-[10px] text-ink-40">{formatDate(f.uploadedAt)}</span>
                </button>
                {!readOnly && (
                  <div className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
                    {onCopyToPublic && !f.isPublic && (
                      <Button size="icon" variant="ghost" title="Copy to Public Brand Assets" className="h-7 w-7" onClick={() => onCopyToPublic(f)}><Globe className="h-4 w-4" /></Button>
                    )}
                    {onMoveFile && (
                      <Button size="icon" variant="ghost" title="Move" className="h-7 w-7" onClick={() => onMoveFile(f.id)}><Move className="h-4 w-4" /></Button>
                    )}
                    {onDeleteFile && (
                      <Button size="icon" variant="ghost" title="Delete" className="h-7 w-7" onClick={() => onDeleteFile(f)}><Trash2 className="h-4 w-4" /></Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
