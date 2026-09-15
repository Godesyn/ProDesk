import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, FileText, Loader2, Play } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar';
import { Badge } from '../../components/ui/badge';
import { cn, initialsOf, formatNumber } from '../../lib/utils';
import { useTRPC } from '../../lib/trpc';
import { downloadFile } from '../../lib/download';
import { useFileViewer } from '../../components/file-viewer/file-viewer-provider';

export interface ThreadMember {
  userId: string;
  name: string;
  avatar: string | null;
  role: string;
  entity: string;
  /** Which side of the connection the member sits on: brand | agency | contractor | user | admin. */
  memberRole?: string;
}

type Tab = 'people' | 'media' | 'files';

/**
 * THE CONVERSATION'S DETAIL DIALOG — who is here, and everything that has been
 * sent.
 *
 * It was a members list and nothing else, which left "where's that PDF she sent
 * me last month" answerable only by scrolling the transcript until you found it.
 * The two new tabs answer it directly, and the split between them is the split
 * between two different questions: a photo is identified by LOOKING at it, so it
 * wants a grid; a document is identified by READING its name, so it wants rows
 * carrying name, size, sender and date. One merged "Attachments" tab is bad at
 * both.
 *
 * Both tabs read `chat.threadAttachments`, which pages the whole conversation
 * rather than filtering the loaded window — the file someone is looking for is by
 * definition the one they have already scrolled past.
 *
 * The messenger's twin is `clients/chat/src/components/thread/ThreadDetail.tsx`,
 * which additionally manages the roster (rename, admin, remove) because a
 * consumer group is owned by its members. A workspace thread's membership is
 * derived from the org relationship, so there is nothing here to edit.
 */
export function MembersDialog({
  open,
  onOpenChange,
  members,
  threadId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: ThreadMember[];
  /** Scopes the Media and Files tabs. Omit to render the people list alone. */
  threadId?: string;
}) {
  const [tab, setTab] = useState<Tab>('people');
  const tabs: Tab[] = threadId ? ['people', 'media', 'files'] : ['people'];
  const active = tabs.includes(tab) ? tab : 'people';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {active === 'people' ? `Members (${members.length})` : active === 'media' ? 'Media' : 'Files'}
          </DialogTitle>
        </DialogHeader>

        {tabs.length > 1 && (
          <div className="-mt-1 flex items-stretch border-b border-[color:var(--color-border-hairline)]" role="tablist">
            {tabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active === key}
                onClick={() => setTab(key)}
                className={cn(
                  'relative px-3.5 py-2 text-[13px] font-semibold capitalize transition-colors',
                  active === key ? 'text-ink-100' : 'text-ink-40 hover:text-ink-60',
                )}
              >
                {key}
                {active === key && (
                  <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-ink-100" />
                )}
              </button>
            ))}
          </div>
        )}

        {active === 'people' && (
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.userId} className="flex items-center gap-3 rounded-[var(--radius-sm)] p-2 hover:bg-inset">
                <Avatar className="h-9 w-9">
                  {m.avatar && <AvatarImage src={m.avatar} alt="" />}
                  <AvatarFallback>{initialsOf(m.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-100">{m.name}</div>
                  {m.entity && <div className="truncate text-xs text-ink-40">{m.entity}</div>}
                </div>
                <Badge variant={m.role === 'Owner' ? 'accent' : m.role === 'Contractor' ? 'warn' : 'muted'}>{m.role}</Badge>
              </li>
            ))}
          </ul>
        )}

        {active === 'media' && threadId && <MediaTab threadId={threadId} />}
        {active === 'files' && threadId && <FilesTab threadId={threadId} />}
      </DialogContent>
    </Dialog>
  );
}

/* ── Media ───────────────────────────────────────────────────────────────── */

/**
 * Square tiles, three across. Squares rather than each picture's own ratio: a
 * grid you SCAN wants one predictable shape per cell, and the moment cells are
 * different heights the eye stops reading rows and starts reading a collage. The
 * full frame is one tap away in the file viewer.
 */
function MediaTab({ threadId }: { threadId: string }) {
  const query = useAttachments(threadId, 'media');
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const { openFile } = useFileViewer();

  if (query.isLoading) return <TabLoading />;
  if (!items.length) return <TabEmpty>No photos or video here yet.</TabEmpty>;

  return (
    <Scroller query={query}>
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() =>
              openFile({
                url: m.fileUrl ?? '',
                title: m.fileName ?? 'media',
                fileType: m.type === 'video' ? 'video' : 'image',
              })
            }
            aria-label={m.fileName ?? 'Attachment'}
            className="relative aspect-square overflow-hidden rounded-[var(--radius-sm)] bg-inset"
          >
            {m.type === 'video' && !m.thumbnailUrl ? (
              // No stored poster: the video element paints its own first frame
              // from the metadata, which is a real preview for free.
              <video src={m.fileUrl ?? undefined} muted playsInline preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <img src={m.thumbnailUrl ?? m.fileUrl ?? undefined} alt="" loading="lazy" className="h-full w-full object-cover" />
            )}
            {m.type === 'video' && (
              <span className="absolute bottom-1 left-1 grid h-5 w-5 place-items-center rounded-full bg-black/55">
                <Play className="h-2.5 w-2.5" fill="white" color="white" />
              </span>
            )}
          </button>
        ))}
      </div>
    </Scroller>
  );
}

/* ── Files ───────────────────────────────────────────────────────────────── */

/** A file is recognised by its NAME, its size and who sent it, so the row says
 *  all three and its primary action is the one people came here for: Download. */
function FilesTab({ threadId }: { threadId: string }) {
  const query = useAttachments(threadId, 'files');
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const { openFile } = useFileViewer();

  if (query.isLoading) return <TabLoading />;
  if (!items.length) return <TabEmpty>Nothing has been filed here yet.</TabEmpty>;

  return (
    <Scroller query={query}>
      <ul className="space-y-1">
        {items.map((m) => (
          <li key={m.id} className="flex items-center gap-3 rounded-[var(--radius-sm)] p-2 hover:bg-inset">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-inset">
              <FileText className="h-4 w-4 text-ink-60" />
            </span>
            <button
              type="button"
              onClick={() => openFile({ url: m.fileUrl ?? '', title: m.fileName ?? 'Document' })}
              className="min-w-0 flex-1 text-left"
            >
              <span className="block truncate text-sm font-medium text-ink-100">{m.fileName ?? 'Attachment'}</span>
              <span className="block truncate text-xs text-ink-40">
                {[m.senderName, fileSize(m.fileSize), shortDate(m.timestamp)].filter(Boolean).join(' · ')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void downloadFile(m.fileUrl ?? '', m.fileName)}
              aria-label={`Download ${m.fileName ?? 'attachment'}`}
              title="Download"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-60 hover:bg-card"
            >
              <Download className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Scroller>
  );
}

/* ── Shared plumbing ─────────────────────────────────────────────────────── */

function useAttachments(threadId: string, kind: 'media' | 'files') {
  const trpc = useTRPC();
  return useInfiniteQuery(
    trpc.chat.threadAttachments.infiniteQueryOptions(
      { threadId, kind, limit: 48 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
}

/**
 * The scroll box, with the next-page trigger.
 *
 * A sentinel + IntersectionObserver rather than a scroll listener doing
 * arithmetic: the two tabs have very different row heights, and any pixel
 * threshold right for a 40px file row loads three pages at a time in a grid of
 * tiles.
 */
function Scroller({
  query,
  children,
}: {
  query: ReturnType<typeof useAttachments>;
  children: React.ReactNode;
}) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="max-h-[60vh] overflow-y-auto">
      {children}
      <div ref={sentinel} className="flex h-10 items-center justify-center">
        {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-ink-40" />}
      </div>
    </div>
  );
}

function TabLoading() {
  return (
    <div className="space-y-2 py-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-[var(--radius-sm)] bg-inset" />
      ))}
    </div>
  );
}

function TabEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[var(--radius-sm)] border border-dashed border-[color:var(--color-border-default)] px-4 py-8 text-center text-xs text-ink-40">
      {children}
    </p>
  );
}

function fileSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 1)} KB`;
  return `${formatNumber(bytes / (1024 * 1024), 1)} MB`;
}

function shortDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}
