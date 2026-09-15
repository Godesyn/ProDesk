import { Search } from 'lucide-react';
import { cn, initialsOf } from '../../lib/utils';
import { Skeleton } from '../../components/ui/skeleton';
import { Input } from '../../components/ui/input';
import {
  THREAD_SECTION_ORDER,
  threadVisuals,
  timeAgoShort,
  unreadLabel,
  type ThreadType,
} from './chat-types';

export interface ThreadListItemData {
  id: string;
  type: ThreadType;
  displayName: string;
  logoUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  section: string;
  /** Brand label for the cross-identity unread overview ("ABOUT {BRAND}"). */
  groupLabel?: string;
  // Raw thread fields used to resolve identity+brand on cross-identity navigation.
  brandId: string | null;
  agencyIds: string[] | null;
}

function ThreadAvatar({ thread }: { thread: ThreadListItemData }) {
  const { icon: Icon, accent } = threadVisuals(thread.type);

  if (thread.type === 'platformAdmin') {
    // Super admin view: the server resolves the counterparty's name + photo.
    // When the user has a photo, show it; when they don't, show their initials.
    // Regular user view: displayName stays "Platform Admin" and logoUrl is null —
    // fall back to the favicon so they see the Prodesk logo.
    const isSuperAdminView = thread.displayName !== 'Platform Admin';
    if (thread.logoUrl) {
      return (
        <span className={cn('inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]', 'bg-inset')}>
          <img src={thread.logoUrl} alt="" className="h-full w-full rounded-[8px] object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
        </span>
      );
    }
    if (isSuperAdminView) {
      // No photo — show initials of the counterparty's name.
      return (
        <span className={cn('inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] bg-[#a855f7]/10 text-[11px] font-bold text-[#a855f7]')}>
          {initialsOf(thread.displayName)}
        </span>
      );
    }
    // Regular user: show Prodesk favicon.
    return (
      <span className={cn('inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]', 'bg-inset')}>
        <img src="/favicon.png" alt="" className="h-full w-full rounded-[8px] object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      </span>
    );
  }

  const src = thread.logoUrl;
  return (
    <span className={cn('inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px]', 'bg-inset')}>
      {src ? (
        <img src={src} alt="" className="h-full w-full rounded-[8px] object-cover" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />
      ) : (
        <Icon className={cn('h-[18px] w-[18px]', accent)} />
      )}
    </span>
  );
}

function ThreadItem({ thread, active, onClick }: { thread: ThreadListItemData; active: boolean; onClick: () => void }) {
  const unread = thread.unreadCount > 0;
  return (
    <button
      onClick={onClick}
      className={cn(
        'mb-1 flex w-full items-start gap-3 rounded-[8px] border p-3 text-left transition-colors',
        active ? 'border-ink-100/30 bg-inset' : 'border-transparent hover:bg-inset',
      )}
    >
      <ThreadAvatar thread={thread} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-sm text-ink-100', unread ? 'font-bold' : 'font-medium')}>
            {thread.displayName}
          </span>
          {thread.lastMessageAt && <span className="shrink-0 text-[11px] text-ink-40">{timeAgoShort(thread.lastMessageAt)}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-xs', unread ? 'font-medium text-ink-100' : 'text-ink-40')}>
            {thread.lastMessage ?? 'No messages yet'}
          </span>
          {unread && (
            <span className="inline-flex items-center rounded-full bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold leading-none text-paper">
              {unreadLabel(thread.unreadCount)}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/**
 * Thread list grouped into category sections with a search bar. Ports
 * `ChatThreadListGrouped` + `ChatThreadListItem` + the search bar.
 */
export function ThreadList({
  threads,
  loading,
  activeId,
  onSelect,
  search,
  onSearch,
  grouped,
}: {
  threads: ThreadListItemData[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
  grouped: boolean;
}) {
  const filtered = search.trim()
    ? threads.filter((t) => t.displayName.toLowerCase().includes(search.trim().toLowerCase()))
    : threads;

  // Grouped (identity selected): category sections in fixed order.
  // Overview (no identity): "ABOUT {BRAND}" dividers, brands A→Z, recent-first within.
  const sections: Array<{ key: string; label: string | null; items: ThreadListItemData[] }> = [];
  if (grouped) {
    const bySection = new Map<string, ThreadListItemData[]>();
    for (const t of filtered) {
      const key = t.section || 'THREADS';
      if (!bySection.has(key)) bySection.set(key, []);
      bySection.get(key)!.push(t);
    }
    for (const s of THREAD_SECTION_ORDER) {
      const items = bySection.get(s);
      if (items?.length) sections.push({ key: s, label: s, items });
    }
  } else {
    const byBrand = new Map<string, ThreadListItemData[]>();
    for (const t of filtered) {
      const key = t.groupLabel || 'Other';
      if (!byBrand.has(key)) byBrand.set(key, []);
      byBrand.get(key)!.push(t);
    }
    const brandKeys = [...byBrand.keys()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    for (const brand of brandKeys) {
      const items = byBrand.get(brand)!.sort((a, b) => new Date(b.lastMessageAt ?? 0).getTime() - new Date(a.lastMessageAt ?? 0).getTime());
      sections.push({ key: brand, label: `ABOUT ${brand.toUpperCase()}`, items });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[color:var(--color-border-hairline)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
          <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search conversations…" className="pl-9" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-ink-40">
            {grouped ? 'No conversations yet.' : 'No unread messages. Pick an identity above to see your conversations.'}
          </p>
        ) : (
          sections.map((section) =>
            grouped ? (
              <div key={section.key} className="mb-3">
                <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-ink-40">{section.label}</div>
                {section.items.map((t) => (
                  <ThreadItem key={t.id} thread={t} active={t.id === activeId} onClick={() => onSelect(t.id)} />
                ))}
              </div>
            ) : (
              <div key={section.key} className="mb-3">
                {/* Brand divider — ports `_BrandDividerHeader` (rules + centered label). */}
                <div className="mb-1 mt-3 flex items-center gap-2 px-1">
                  <span className="h-px flex-1 bg-ink-100/10" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-ink-40">{section.label}</span>
                  <span className="h-px flex-1 bg-ink-100/10" />
                </div>
                {section.items.map((t) => (
                  <ThreadItem key={t.id} thread={t} active={t.id === activeId} onClick={() => onSelect(t.id)} />
                ))}
              </div>
            ),
          )
        )}
      </div>
    </div>
  );
}
