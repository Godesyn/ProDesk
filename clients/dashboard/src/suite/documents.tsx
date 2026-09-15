/* Prodesk — Document Locker (documents).

   The *Files & Assets* design idiom (FndHeader title, search field, left filter
   panel, card grid) wired to Prodesk's real Document Locker backend (the files.*
   tRPC router). Ports the behaviour of packages/shared/src/pages/brand/documents.tsx
   + components/file-locker/locker-grid.tsx, re-skinned to the suite's pd-* design.

   Left rail = Tabs + Folders: three scopes (Agency / Public / Private); the active
   scope expands to list its root folders. The grid shows the folders + files inside
   the selected scope/folder, with breadcrumb navigation for depth, OS-style
   drag-to-move (onto a folder card / breadcrumb / rail folder) and drag-to-reorder
   (onto another file). Live via useDashboardRealtime (files / folders tables). */

import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import type { RouterOutputs } from '@server/trpc/router';
import { useFileViewer } from '@shared/components/file-viewer/file-viewer-provider';
import { uploadBrandFile, fileTypeOf } from '@shared/pages/brand/storage';
import { formatDate } from '@shared/lib/utils';
import { Button, pushToast, Skeleton } from './ui';
import { Icon } from './icons';
import {
  FndHeader,
  FndToolbar,
  FndEmpty,
  FndModal,
  FndInput,
  FndDeleteDialog,
} from './fnd-shared';
import type { Brand, SuiteApp } from './data';

type Tab = 'agency' | 'public' | 'private';
type FileRow = RouterOutputs['files']['list']['items'][number];
type FolderRow = RouterOutputs['files']['folders'][number];

const TABS: { id: Tab; label: string }[] = [
  { id: 'agency', label: 'Agency Documents' },
  { id: 'public', label: 'Public Brand Assets' },
  { id: 'private', label: 'Private Documents' },
];

/** Every agency a file belongs to — a doc shared in a group chat can span several. */
const agenciesOf = (f: FileRow): string[] =>
  Array.isArray(f.agencyIds) && f.agencyIds.length
    ? (f.agencyIds as string[])
    : f.agencyId
      ? [f.agencyId]
      : [];

/* ── glyphs + action icons (inline, suite-tinted; port of LockerGrid's OS look) ── */

export function extOf(name: string, type: string): string {
  const i = name.lastIndexOf('.');
  if (i > 0 && i < name.length - 1) return name.slice(i + 1);
  return type;
}

const TYPE_TINT: Record<string, string> = {
  image: '#10b981',
  pdf: '#f43f5e',
  doc: '#0ea5e9',
  docx: '#0ea5e9',
  xls: '#16a34a',
  xlsx: '#16a34a',
  csv: '#16a34a',
  ppt: '#f97316',
  pptx: '#f97316',
  zip: '#f59e0b',
  rar: '#f59e0b',
};

/** Classic two-tone OS folder, tinted by the tool accent. */
function FolderGlyph({ size = 46 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * (52 / 64)}
      viewBox="0 0 64 52"
      fill="none"
      style={{ color: 'var(--accent)' }}
      aria-hidden
    >
      <path
        d="M4 12a4 4 0 0 1 4-4h14.3a4 4 0 0 1 2.83 1.17L29 13h27a4 4 0 0 1 4 4v27a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="currentColor"
        fillOpacity="0.5"
      />
      <path
        d="M4 22h56v22a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"
        fill="currentColor"
      />
      <path d="M4 22h56v2H4z" fill="#fff" fillOpacity="0.2" />
    </svg>
  );
}

/** OS-style document glyph: page with a folded corner + an extension ribbon. */
function FileGlyph({
  type,
  ext,
  size = 46,
}: {
  type: string;
  ext: string;
  size?: number;
}) {
  const tint = TYPE_TINT[type] ?? 'var(--ink-3)';
  return (
    <svg
      width={size * (48 / 60)}
      height={size}
      viewBox="0 0 48 60"
      fill="none"
      style={{ color: tint }}
      aria-hidden
    >
      <path
        d="M9 4h21l13 13v36a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z"
        fill="currentColor"
        fillOpacity="0.12"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="2"
      />
      <path
        d="M30 4v10a3 3 0 0 0 3 3h10"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="2"
        fill="none"
      />
      <rect x="6" y="33" width="37" height="14" rx="3" fill="currentColor" />
      <text
        x="24.5"
        y="43"
        textAnchor="middle"
        fontSize="9"
        fontWeight="700"
        fill="#fff"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {ext.slice(0, 4).toUpperCase()}
      </text>
    </svg>
  );
}

const actSvg = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;
const TrashIcon = () => (
  <svg {...actSvg}>
    <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m2 0v12a2 2 0 01-2 2H8a2 2 0 01-2-2V7" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);
const MoveIcon = () => (
  <svg {...actSvg}>
    <polyline points="5 9 2 12 5 15" />
    <polyline points="9 5 12 2 15 5" />
    <polyline points="15 19 12 22 9 19" />
    <polyline points="19 9 22 12 19 15" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <line x1="12" y1="2" x2="12" y2="22" />
  </svg>
);
const GlobeIcon = () => (
  <svg {...actSvg}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a15 15 0 010 18M12 3a15 15 0 000 18" />
  </svg>
);
const PencilIcon = () => (
  <svg {...actSvg}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
  </svg>
);

function ActionBtn({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="pd-doc-actbtn"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

/* ── tool ──────────────────────────────────────────────────────────────────── */

export function DocumentsTool({ app, brand }: { app: SuiteApp; brand: Brand }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const brandId = brand.id;
  const { openFile } = useFileViewer();

  const [tab, setTab] = useState<Tab>('agency');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [agencyChip, setAgencyChip] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    name: string;
    onDelete: () => void;
  } | null>(null);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [folderDraft, setFolderDraft] = useState('');
  const [pendingAgencyFile, setPendingAgencyFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverCrumb, setDragOverCrumb] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const query = search.trim();
  const agencyId = tab === 'agency' ? (agencyChip ?? undefined) : undefined;
  const listInput = {
    brandId,
    tab,
    folderId,
    agencyId,
    limit: 100,
    offset: 0,
  } as const;

  const foldersQ = useQuery(
    trpc.files.folders.queryOptions({ brandId, tab, agencyId }),
  );
  const filesQ = useQuery(trpc.files.list.queryOptions(listInput));
  const agenciesQ = useQuery(
    trpc.connections.brandAgencies.queryOptions({
      brandId,
      limit: 100,
      offset: 0,
    }),
  );
  const searchQ = useQuery({
    ...trpc.files.search.queryOptions({ brandId, query }),
    enabled: query.length > 0,
  });

  const allFolders = foldersQ.data ?? [];
  const rootFolders = allFolders.filter((f) => (f.parentId ?? null) === null);
  const childFolders = allFolders.filter(
    (f) => (f.parentId ?? null) === folderId,
  );
  const files = filesQ.data?.items ?? [];

  const agencyById = useMemo(() => {
    const m = new Map<string, { name: string; logoUrl: string | null }>();
    for (const a of agenciesQ.data?.items ?? [])
      m.set(a.id, { name: a.businessName, logoUrl: a.logoUrl ?? null });
    return m;
  }, [agenciesQ.data]);
  const agencyName = (id: string) => agencyById.get(id)?.name ?? 'Agency';

  // Breadcrumb chain root → current.
  const crumbs = useMemo(() => {
    const byId = new Map(allFolders.map((f) => [f.id, f]));
    const stack: { id: string | null; name: string }[] = [];
    let cur = folderId;
    while (cur) {
      const f = byId.get(cur);
      if (!f) break;
      stack.unshift({ id: f.id, name: f.name });
      cur = f.parentId ?? null;
    }
    return [{ id: null as string | null, name: 'Root' }, ...stack];
  }, [folderId, allFolders]);

  const filesKey = trpc.files.list.queryKey();
  const foldersKey = trpc.files.folders.queryKey();
  const searchKey = trpc.files.search.queryKey();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: filesKey });
    qc.invalidateQueries({ queryKey: foldersKey });
    qc.invalidateQueries({ queryKey: searchKey });
  };
  const onErr = (e: { message: string }) => pushToast(e.message, 'error');

  const register = useMutation(trpc.files.register.mutationOptions());
  const createFolder = useMutation({
    ...trpc.files.createFolder.mutationOptions(),
    onSuccess: () => {
      pushToast('Folder created.', 'success');
      setNewFolderOpen(false);
      invalidate();
    },
    onError: onErr,
  });
  const renameFolderMut = useMutation({
    ...trpc.files.renameFolder.mutationOptions(),
    onSuccess: () => {
      pushToast('Folder renamed.', 'success');
      invalidate();
    },
    onError: onErr,
  });
  const removeFolder = useMutation({
    ...trpc.files.removeFolder.mutationOptions(),
    onSuccess: () => {
      pushToast('Folder deleted.', 'info');
      invalidate();
    },
    onError: onErr,
  });
  const renameMut = useMutation({
    ...trpc.files.rename.mutationOptions(),
    onSuccess: () => {
      pushToast('Renamed.', 'success');
      invalidate();
    },
    onError: onErr,
  });
  const moveMut = useMutation({
    ...trpc.files.move.mutationOptions(),
    onSuccess: () => {
      pushToast('Moved.', 'success');
      setMoveFileId(null);
      invalidate();
    },
    onError: onErr,
  });
  const reorder = useMutation({
    ...trpc.files.reorder.mutationOptions(),
    onSuccess: invalidate,
    onError: (e) => {
      onErr(e);
      invalidate();
    },
  });
  const copyToPublic = useMutation({
    ...trpc.files.copyToPublic.mutationOptions(),
    onSuccess: () => {
      pushToast('Copied to Public Brand Assets.', 'success');
      invalidate();
    },
    onError: onErr,
  });
  const removeFile = useMutation({
    ...trpc.files.remove.mutationOptions(),
    onSuccess: () => {
      pushToast('Deleted.', 'info');
      invalidate();
    },
    onError: onErr,
  });

  const moveToFolder = (fileId: string, destFolderId: string | null) =>
    moveMut.mutate({ id: fileId, folderId: destFolderId });

  const reorderTo = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const ids = files.map((f) => f.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const newIds = [...ids];
    newIds.splice(from, 1);
    newIds.splice(to, 0, draggedId);
    qc.setQueryData(
      trpc.files.list.queryKey(listInput),
      (old: typeof filesQ.data) =>
        old
          ? {
              ...old,
              items: newIds.map((id) => files.find((f) => f.id === id)!),
            }
          : old,
    );
    reorder.mutate({ brandId, orderedIds: newIds });
  };

  // Connected agencies — the candidate owners for an Agency Documents upload.
  const connectedAgencies = useMemo(
    () =>
      (agenciesQ.data?.items ?? []).map((a) => ({
        id: a.id,
        name: a.businessName,
        logoUrl: a.logoUrl ?? null,
      })),
    [agenciesQ.data],
  );

  // An Agency Documents upload needs an owning agency, else it lands as a
  // brand-owned Public asset and vanishes from this tab. Resolve the owner:
  // a selected chip wins; with no chip use the sole connected agency; with
  // several connected agencies, prompt before uploading.
  const startUpload = (file: File) => {
    if (tab !== 'agency') {
      onUpload(file, undefined);
      return;
    }
    if (agencyChip) {
      onUpload(file, agencyChip);
      return;
    }
    if (connectedAgencies.length <= 1) {
      onUpload(file, connectedAgencies[0]?.id);
      return;
    }
    setPendingAgencyFile(file);
  };

  const onUpload = async (file: File, uploadAgencyId: string | undefined) => {
    setUploading(true);
    try {
      const url = await uploadBrandFile(brandId, tab, file);
      const created = await register.mutateAsync({
        brandId,
        name: file.name,
        url,
        size: file.size,
        type: fileTypeOf(file.name),
        folderId: folderId ?? undefined,
        agencyId: uploadAgencyId,
        isPrivate: tab === 'private',
      });
      // A brand upload with no agency selected is a brand-owned asset, so the
      // backend files it under Public Brand Assets (agencyId null) — which the
      // Agency tab hides (it only lists agency-owned docs). Jump to wherever the
      // file actually landed so an upload is never invisible, and say where.
      const landed: Tab = created.isPrivate
        ? 'private'
        : created.agencyId
          ? 'agency'
          : 'public';
      if (landed !== tab) {
        setTab(landed);
        setAgencyChip(landed === 'agency' ? created.agencyId : null);
        setFolderId(created.folderId ?? null);
      }
      pushToast(
        landed === tab
          ? 'Uploaded.'
          : `Uploaded to ${TABS.find((t) => t.id === landed)!.label}.`,
        'success',
      );
      invalidate();
    } catch (e) {
      pushToast(`Upload failed: ${(e as Error).message}`, 'error');
    } finally {
      setUploading(false);
    }
  };

  const open = (f: FileRow) =>
    openFile({
      url: f.url,
      title: f.name,
      onRename: async (name: string) => {
        await renameMut.mutateAsync({ id: f.id, name });
      },
    });

  const switchTab = (t: Tab) => {
    setTab(t);
    setFolderId(null);
    setAgencyChip(null);
  };

  const startFolderRename = (f: FolderRow) => {
    setRenameFolderId(f.id);
    setFolderDraft(f.name);
  };
  const commitFolderRename = () => {
    const id = renameFolderId;
    const next = folderDraft.trim();
    setRenameFolderId(null);
    if (id && next) renameFolderMut.mutate({ id, name: next });
  };
  const requestDeleteFolder = (f: FolderRow) =>
    setConfirm({
      name: f.name,
      onDelete: () => {
        removeFolder.mutate({ id: f.id });
        setConfirm(null);
      },
    });
  const requestDeleteFile = (f: FileRow) =>
    setConfirm({
      name: f.name,
      onDelete: () => {
        removeFile.mutate({ id: f.id });
        setConfirm(null);
      },
    });

  const loading = filesQ.isLoading || foldersQ.isLoading;

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        style={{ display: 'none' }}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) startUpload(f);
          e.target.value = '';
        }}
      />

      <FndHeader
        app={{
          icon: app.icon || 'document',
          name: app.name,
          tag: 'Signed contracts, T&Cs and SOWs — the canonical store',
        }}
        brand={brand}
        pill="Source of truth"
        count={filesQ.data?.total ?? files.length}
        countLabel="documents"
        ghostLabel="New folder"
        onGhost={() => setNewFolderOpen(true)}
        primaryLabel={uploading ? 'Uploading…' : 'Upload'}
        onPrimary={() => {
          if (!uploading) fileInput.current?.click();
        }}
      />

      <FndToolbar
        search={search}
        setSearch={setSearch}
        placeholder="Search all documents"
      />

      {query ? (
        <SearchResults
          rows={searchQ.data ?? []}
          loading={searchQ.isLoading}
          query={query}
          onOpen={open}
          ownerLabel={(f) =>
            f.isPrivate
              ? 'Private'
              : f.agencyId
                ? agencyName(f.agencyId)
                : 'Public'
          }
        />
      ) : (
        <div className="pd-doc-layout">
          {/* Left filter panel — Tabs + Folders */}
          <aside className="pd-doc-rail">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <div key={t.id} className="pd-doc-scope">
                  <button
                    type="button"
                    className="pd-doc-tab"
                    data-on={active}
                    onClick={() => switchTab(t.id)}
                  >
                    <Icon
                      name={active ? 'chevron' : 'chevronRight'}
                      size={14}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'left',
                      }}
                    >
                      {t.label}
                    </span>
                  </button>
                  {active && (
                    <div className="pd-doc-folders">
                      <button
                        type="button"
                        className="pd-doc-folder"
                        data-on={folderId === null}
                        onClick={() => setFolderId(null)}
                        onDragOver={(e) => {
                          if (dragId) {
                            e.preventDefault();
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragId) moveToFolder(dragId, null);
                          setDragId(null);
                        }}
                      >
                        All files
                      </button>
                      {rootFolders.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          className="pd-doc-folder"
                          data-on={folderId === f.id}
                          onClick={() => setFolderId(f.id)}
                          onDragOver={(e) => {
                            if (dragId) {
                              e.preventDefault();
                              setDragOverFolderId(f.id);
                            }
                          }}
                          onDragLeave={() =>
                            setDragOverFolderId((c) => (c === f.id ? null : c))
                          }
                          onDrop={(e) => {
                            e.preventDefault();
                            setDragOverFolderId(null);
                            if (dragId) moveToFolder(dragId, f.id);
                            setDragId(null);
                          }}
                          data-drop={dragOverFolderId === f.id}
                        >
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {f.name}
                          </span>
                        </button>
                      ))}
                      {rootFolders.length === 0 && !foldersQ.isLoading && (
                        <div className="pd-doc-folder-empty">
                          No folders yet
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </aside>

          {/* Main: breadcrumbs + chips + grid */}
          <div className="pd-doc-main">
            <div className="pd-doc-crumbs">
              {crumbs.map((c, i) => {
                const key = c.id ?? 'root';
                const isCurrent = (c.id ?? null) === folderId;
                const canDrop = !!dragId && !isCurrent;
                return (
                  <span
                    key={key}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {i > 0 && (
                      <Icon
                        name="chevronRight"
                        size={12}
                        style={{ color: 'var(--ink-3)' }}
                      />
                    )}
                    <button
                      type="button"
                      className="pd-doc-crumb"
                      data-on={isCurrent}
                      data-drop={canDrop && dragOverCrumb === key}
                      onClick={() => setFolderId(c.id)}
                      onDragOver={(e) => {
                        if (canDrop) {
                          e.preventDefault();
                          setDragOverCrumb(key);
                        }
                      }}
                      onDragLeave={() =>
                        setDragOverCrumb((cur) => (cur === key ? null : cur))
                      }
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverCrumb(null);
                        if (canDrop) moveToFolder(dragId!, c.id);
                        setDragId(null);
                      }}
                    >
                      {c.name}
                    </button>
                  </span>
                );
              })}
            </div>

            {/* Chips list every connected agency (not just those that own a loaded
                file) so you can filter to an agency even when its folder is empty. */}
            {tab === 'agency' && connectedAgencies.length > 0 && (
              <div className="pd-doc-chips">
                <button
                  type="button"
                  className="pd-doc-chip"
                  data-on={!agencyChip}
                  onClick={() => setAgencyChip(null)}
                >
                  All
                </button>
                {connectedAgencies.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="pd-doc-chip"
                    data-on={agencyChip === a.id}
                    onClick={() => setAgencyChip(a.id)}
                  >
                    {a.logoUrl && (
                      <img
                        src={a.logoUrl}
                        alt=""
                        className="pd-doc-chip-logo"
                      />
                    )}
                    {a.name}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="pd-doc-grid">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} h={120} r={12} />
                ))}
              </div>
            ) : childFolders.length === 0 && files.length === 0 ? (
              <FndEmpty
                line={
                  folderId
                    ? 'This folder is empty.'
                    : 'Nothing here yet. Upload a document or create a folder.'
                }
                cta="Upload"
                onCta={() => fileInput.current?.click()}
              />
            ) : (
              <div className="pd-doc-grid">
                {childFolders.map((f) => (
                  <div
                    key={f.id}
                    className="pd-doc-tile"
                    data-drop={dragOverFolderId === f.id}
                    onDragOver={(e) => {
                      if (dragId) {
                        e.preventDefault();
                        setDragOverFolderId(f.id);
                      }
                    }}
                    onDragLeave={() =>
                      setDragOverFolderId((c) => (c === f.id ? null : c))
                    }
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOverFolderId(null);
                      if (dragId) moveToFolder(dragId, f.id);
                      setDragId(null);
                    }}
                  >
                    <button
                      type="button"
                      className="pd-doc-tile-body"
                      title={f.name}
                      onClick={() => setFolderId(f.id)}
                    >
                      <FolderGlyph />
                      {renameFolderId === f.id ? (
                        <input
                          autoFocus
                          className="pd-doc-rename"
                          value={folderDraft}
                          onChange={(e) => setFolderDraft(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitFolderRename}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitFolderRename();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setRenameFolderId(null);
                            }
                          }}
                        />
                      ) : (
                        <span className="pd-doc-name">{f.name}</span>
                      )}
                    </button>
                    <div className="pd-doc-actions">
                      <ActionBtn
                        title="Rename folder"
                        onClick={() => startFolderRename(f)}
                      >
                        <PencilIcon />
                      </ActionBtn>
                      <ActionBtn
                        title="Delete folder"
                        onClick={() => requestDeleteFolder(f)}
                      >
                        <TrashIcon />
                      </ActionBtn>
                    </div>
                  </div>
                ))}

                {files.map((f) => {
                  const owners = agenciesOf(f);
                  return (
                    <div
                      key={f.id}
                      className="pd-doc-tile"
                      draggable
                      data-dragging={dragId === f.id}
                      onDragStart={() => setDragId(f.id)}
                      onDragEnd={() => {
                        setDragId(null);
                        setDragOverFolderId(null);
                        setDragOverCrumb(null);
                      }}
                      onDragOver={(e: DragEvent) => {
                        if (dragId && dragId !== f.id) e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragId) reorderTo(dragId, f.id);
                        setDragId(null);
                      }}
                    >
                      <button
                        type="button"
                        className="pd-doc-tile-body"
                        title={f.note ? `${f.name}\n${f.note}` : f.name}
                        onClick={() => open(f)}
                      >
                        <FileGlyph
                          type={f.type ?? 'file'}
                          ext={extOf(f.name, f.type ?? 'file')}
                        />
                        <span className="pd-doc-name">{f.name}</span>
                        {tab === 'agency' && owners.length > 0 && (
                          <span className="pd-doc-cap">
                            {agencyById.get(owners[0])?.logoUrl && (
                              <img
                                src={agencyById.get(owners[0])!.logoUrl!}
                                alt=""
                                className="pd-doc-cap-logo"
                              />
                            )}
                            <span
                              style={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {owners.map(agencyName).join(', ')}
                            </span>
                          </span>
                        )}
                        <span className="pd-doc-date">
                          {formatDate(f.uploadedAt)}
                        </span>
                      </button>
                      <div className="pd-doc-actions">
                        {tab === 'agency' && !f.isPublic && (
                          <ActionBtn
                            title="Copy to Public Brand Assets"
                            onClick={() => copyToPublic.mutate({ id: f.id })}
                          >
                            <GlobeIcon />
                          </ActionBtn>
                        )}
                        <ActionBtn
                          title="Move"
                          onClick={() => setMoveFileId(f.id)}
                        >
                          <MoveIcon />
                        </ActionBtn>
                        <ActionBtn
                          title="Delete"
                          onClick={() => requestDeleteFile(f)}
                        >
                          <TrashIcon />
                        </ActionBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {newFolderOpen && (
        <NewFolderDialog
          saving={createFolder.isPending}
          onClose={() => setNewFolderOpen(false)}
          onCreate={(name) =>
            createFolder.mutate({
              brandId,
              name,
              parentId: folderId ?? undefined,
              isPublic: tab === 'public',
              isPrivate: tab === 'private',
            })
          }
        />
      )}

      {moveFileId && (
        <MoveDialog
          folders={allFolders}
          saving={moveMut.isPending}
          onClose={() => setMoveFileId(null)}
          onMove={(dest) => moveMut.mutate({ id: moveFileId, folderId: dest })}
        />
      )}

      {pendingAgencyFile && (
        <AgencyPickDialog
          agencies={connectedAgencies}
          saving={uploading}
          onClose={() => setPendingAgencyFile(null)}
          onPick={(id) => {
            const f = pendingAgencyFile;
            setPendingAgencyFile(null);
            if (f) onUpload(f, id);
          }}
        />
      )}

      {confirm && (
        <FndDeleteDialog
          name={confirm.name}
          onDelete={confirm.onDelete}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ── cross-tab search results (files.search) ─────────────────────────────────── */
function SearchResults({
  rows,
  loading,
  query,
  onOpen,
  ownerLabel,
}: {
  rows: RouterOutputs['files']['search'];
  loading: boolean;
  query: string;
  onOpen: (f: FileRow) => void;
  ownerLabel: (f: FileRow) => string;
}) {
  if (loading)
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} h={48} r={10} />
        ))}
      </div>
    );
  if (rows.length === 0)
    return <FndEmpty line={`No documents match “${query}”.`} />;
  return (
    <div className="pd-doc-search">
      {rows.map((f) => (
        <button
          key={f.id}
          type="button"
          className="pd-doc-search-row"
          title={f.note ?? f.name}
          onClick={() => onOpen(f as FileRow)}
        >
          <FileGlyph
            type={f.type ?? 'file'}
            ext={extOf(f.name, f.type ?? 'file')}
            size={30}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="pd-doc-search-name">{f.name}</span>
            {f.note && <span className="pd-doc-search-note">{f.note}</span>}
          </span>
          <span className="pd-doc-search-owner">
            {ownerLabel(f as FileRow)}
          </span>
          <span className="pd-doc-date" style={{ flexShrink: 0 }}>
            {formatDate(f.uploadedAt)}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ── dialogs ──────────────────────────────────────────────────────────────── */
function NewFolderDialog({
  saving,
  onClose,
  onCreate,
}: {
  saving: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const valid = name.trim().length > 0;
  return (
    <FndModal
      title="New folder"
      eyebrow="Organise your locker"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid || saving}
            onClick={() => valid && onCreate(name.trim())}
          >
            {saving ? 'Creating…' : 'Create'}
          </Button>
        </>
      }
    >
      <FndInput
        label="Folder name"
        value={name}
        onChange={setName}
        placeholder="e.g. Contracts"
      />
    </FndModal>
  );
}

function AgencyPickDialog({
  agencies,
  saving,
  onClose,
  onPick,
}: {
  agencies: { id: string; name: string; logoUrl: string | null }[];
  saving: boolean;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  const [sel, setSel] = useState(agencies[0]?.id ?? '');
  return (
    <FndModal
      title="Which agency?"
      eyebrow="Agency Documents need an owner"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!sel || saving}
            onClick={() => sel && onPick(sel)}
          >
            {saving ? 'Uploading…' : 'Upload'}
          </Button>
        </>
      }
    >
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span
          className="eyebrow"
          style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
        >
          Owning agency
        </span>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'var(--font)',
            fontSize: 14,
            color: 'var(--ink)',
            background: 'var(--white)',
            border: '1px solid var(--rule-2)',
            borderRadius: 'var(--r-2)',
            padding: '9px 11px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
    </FndModal>
  );
}

function MoveDialog({
  folders,
  saving,
  onClose,
  onMove,
}: {
  folders: FolderRow[];
  saving: boolean;
  onClose: () => void;
  onMove: (dest: string | null) => void;
}) {
  const [dest, setDest] = useState('');
  return (
    <FndModal
      title="Move file"
      eyebrow="Choose a destination"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => onMove(dest || null)}
          >
            {saving ? 'Moving…' : 'Move'}
          </Button>
        </>
      }
    >
      <label style={{ display: 'block', marginBottom: 12 }}>
        <span
          className="eyebrow"
          style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
        >
          Destination folder
        </span>
        <select
          value={dest}
          onChange={(e) => setDest(e.target.value)}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: 'var(--font)',
            fontSize: 14,
            color: 'var(--ink)',
            background: 'var(--white)',
            border: '1px solid var(--rule-2)',
            borderRadius: 'var(--r-2)',
            padding: '9px 11px',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          <option value="">Root</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>
    </FndModal>
  );
}
