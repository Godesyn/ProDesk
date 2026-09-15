import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Expand, MessageSquare, X } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { supabase } from '../lib/supabase';
import { subscribeResilient } from '../lib/resilient-channel';
import { createCoalescer } from '../lib/coalesce';
import { useCurrentUser } from '../auth/auth-context';
import { cn } from '../lib/utils';
import { EmptyState } from '../components/layout/empty-state';
import { IdentitySelector } from './chat/identity-selector';
import { BrandSelector, type ChatBrand } from './chat/brand-selector';
import { ThreadList, type ThreadListItemData } from './chat/thread-list';
import { MessagePanel } from './chat/message-panel';
import type { ChatIdentity, ThreadType } from './chat/chat-types';
import { useChatNav } from './chat/chat-nav-context';

// Identity-visibility predicates, mirrored from server thread-types.ts so the
// cross-identity unread overview can resolve which identity owns a thread.
const userIdentityThreads = (t: ThreadType) => t === 'you' || t === 'platformAdmin';
const contractorIdentityThreads = (t: ThreadType) => t === 'agencyContractorPersonal';
const brandIdentityThreads = (t: ThreadType) =>
  t === 'all' || t === 'brandAgencyStaff' || t === 'brandStaff' || t === 'brandAgencyPersonal' || t === 'brandPersonal';
const agencyIdentityThreads = (t: ThreadType) =>
  t === 'all' ||
  t === 'brandAgencyStaff' ||
  t === 'agencyStaff' ||
  t === 'brandAgencyPersonal' ||
  t === 'agencyPersonal' ||
  t === 'agencyContractorPersonal' ||
  t === 'interAgency';

/**
 * Resolve which identity owns a thread (for cross-identity navigation from the
 * unread overview). Ports `_navigateToThread`
 * (chat_thread_list_unread_overview.dart:227-315).
 */
function resolveIdentity(thread: ThreadListItemData, identities: ChatIdentity[]): ChatIdentity | null {
  const type = thread.type;
  if (userIdentityThreads(type)) return identities.find((i) => i.type === 'user') ?? identities[0] ?? null;
  if (contractorIdentityThreads(type)) return identities.find((i) => i.type === 'contractor') ?? identities[0] ?? null;
  if (brandIdentityThreads(type)) {
    const b = identities.find((i) => i.type === 'brand' && i.entityId === thread.brandId);
    if (b) return b;
  }
  if (agencyIdentityThreads(type)) {
    const ids = thread.agencyIds ?? [];
    const a = identities.find((i) => i.type === 'agency' && ids.includes(i.entityId));
    if (a) return a;
  }
  return identities[0] ?? null;
}

export function ChatPage({ embedded, onClose }: { embedded?: boolean; onClose?: () => void } = {}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();
  const [, navigate] = useLocation();
  // External chat-launch requests (project chips, clients/agencies "Chat") arrive
  // here via the shared chat-nav context — ports ChatNavigationService landing on
  // chatStateProvider.navigateToThread.
  const {
    request: navRequest,
    consumeRequest,
    selectedIdentity: identity,
    setSelectedIdentity: setIdentity,
    selectedBrand: brand,
    setSelectedBrand: setBrand,
    activeThreadId: activeId,
    setActiveThreadId: setActiveId,
    setOpen,
  } = useChatNav();

  const [search, setSearch] = useState('');
  const [attachedProjectId, setAttachedProjectId] = useState<string | null>(null);
  // Pending cross-identity navigation target (overview → resolved identity+brand+thread).
  const [pendingNav, setPendingNav] = useState<{ threadId: string; brandId: string | null } | null>(null);

  // Identities ("Chat as").
  const identitiesQ = useQuery(trpc.chat.identities.queryOptions());
  const identities = (identitiesQ.data ?? []) as ChatIdentity[];

  // Apply an external navigation request once identities are loaded: select the
  // resolved identity + brand and queue the target thread to open.
  useEffect(() => {
    if (!navRequest || identities.length === 0) return;
    const matched = identities.find((i) => i.type === navRequest.identityType && i.entityId === navRequest.entityId);
    if (!matched) return;
    setIdentity(matched);
    setBrand(null);
    setActiveId(null);
    setAttachedProjectId(navRequest.projectId ?? null);
    setPendingNav(
      navRequest.threadId
        ? { threadId: navRequest.threadId, brandId: navRequest.brandId && navRequest.brandId !== 'app' ? navRequest.brandId : null }
        : null,
    );
    consumeRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRequest, identities]);

  // Total unread + per-identity unread buckets (selector badges).
  const totalUnreadQ = useQuery(trpc.chat.totalUnread.queryOptions());
  const unreadByIdentityQ = useQuery(trpc.chat.unreadByIdentity.queryOptions());
  const unreadByKey = (unreadByIdentityQ.data ?? {}) as Record<string, number>;

  // Ensure the user's `you` + platform-admin support threads exist on open.
  const ensureSupport = useMutation(trpc.chat.ensureSupportThreads.mutationOptions());
  useEffect(() => {
    if (me?.id) ensureSupport.mutate(undefined, { onSuccess: () => qc.invalidateQueries({ queryKey: trpc.chat.threads.queryKey() }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Brands ("Chat about") for the active identity.
  const brandsQ = useQuery({
    ...trpc.chat.brandsForIdentity.queryOptions(
      identity ? { identityType: identity.type, entityId: identity.entityId } : { identityType: 'user', entityId: '' },
    ),
    enabled: !!identity,
  });
  const brands = (brandsQ.data ?? []) as ChatBrand[];

  // Auto-select the first brand when the list changes (chat_brand_selector.dart:30-49),
  // honoring a pending cross-identity navigation target.
  useEffect(() => {
    if (!identity) {
      setBrand(null);
      return;
    }
    if (!brands.length) return;
    if (pendingNav) {
      const target = (pendingNav.brandId && brands.find((b) => b.id === pendingNav.brandId)) || brands[0];
      setBrand(target);
      return;
    }
    if (!brand || !brands.some((b) => b.id === brand.id)) setBrand(brands[0]);
  }, [identity, brands, brand, pendingNav]);

  // Threads. With an identity+brand: type-filtered + grouped. Without: unread overview.
  const threadsQ = useQuery(
    trpc.chat.threads.queryOptions({
      limit: 100,
      offset: 0,
      identityType: identity?.type,
      entityId: identity?.entityId,
      brandId: identity && brand && brand.id !== 'app' ? brand.id : undefined,
      unreadOnly: !identity,
    }),
  );
  const threads = useMemo(() => ((threadsQ.data?.items ?? []) as ThreadListItemData[]), [threadsQ.data]);

  // Once the resolved identity+brand's threads load, open the pending thread.
  useEffect(() => {
    if (!pendingNav || !brand) return;
    if (threads.some((t) => t.id === pendingNav.threadId)) {
      setActiveId(pendingNav.threadId);
      setPendingNav(null);
    }
  }, [pendingNav, brand, threads]);

  // Reset thread selection when identity/brand changes (not mid-navigation).
  useEffect(() => {
    if (!pendingNav) setActiveId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, brand]);

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  const onSelectIdentity = (i: ChatIdentity) => {
    setPendingNav(null);
    setIdentity(i);
    setBrand(null);
    setActiveId(null);
  };

  // Thread selection. With no identity (overview), resolve identity+brand first.
  const onSelectThread = (id: string) => {
    if (identity) {
      setActiveId(id);
      return;
    }
    const t = threads.find((x) => x.id === id);
    if (!t) return;
    const matched = resolveIdentity(t, identities);
    if (!matched) return;
    setIdentity(matched);
    setBrand(null);
    setActiveId(null);
    setPendingNav({ threadId: id, brandId: t.brandId && t.brandId !== 'app' ? t.brandId : null });
  };

  const openProject = (projectId: string) => {
    // Mirror the Flutter pop-panel → push-board → push-detail flow: close the
    // docked chat panel, land on the projects board, then push the project
    // detail on top so Back returns to the board (not straight to chat).
    setOpen(false);
    const board = me?.role === 'brandOwner' ? '/brand-projects' : '/agency-projects';
    navigate(board);
    navigate(`/project/${projectId}`);
  };

  const refreshThreads = () => {
    qc.invalidateQueries({ queryKey: trpc.chat.threads.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.chat.totalUnread.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.chat.unreadByIdentity.queryKey() });
  };

  // Live thread-list delivery. `chat_threads`/`chat_thread_members` are in the
  // supabase_realtime publication (server/sql/rls.sql); their bumps on every
  // send are the broadcast signal that a conversation changed. RLS scopes
  // delivery to the user's own threads.
  //
  // Coalesced with a CEILING. This was a plain trailing debounce, which never
  // fires at all while events keep arriving — so the thread list froze for
  // exactly as long as the workspace stayed busy, which is the one time it needs
  // to be right. Held while the tab is hidden, too: three list queries refetched
  // per message, for a screen nobody is looking at.
  useEffect(() => {
    if (!me?.id) return;
    const refreshes = createCoalescer<null>(() => refreshThreads(), {
      wait: 300,
      maxWait: 1_500,
      deferWhileHidden: true,
    });
    const refresh = () => refreshes.push(null);
    // Resilient subscription: revives the feed after sleep/offline drops and
    // refetches the thread list on re-join (events during the gap aren't replayed).
    const handle = subscribeResilient({
      // Serialises a rebuild behind the same topic's async teardown.
      topic: 'chat:thread-list',
      build: () => supabase
        .channel('chat:thread-list')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_threads' }, refresh)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_threads' }, refresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_thread_members', filter: `user_id=eq.${me.id}` }, refresh),
      onCatchUp: refresh,
    });
    return () => {
      refreshes.cancel();
      handle.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-card',
        embedded ? 'h-full rounded-[var(--radius-md)]' : 'h-[calc(100vh-8rem)] rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)]',
      )}
    >
      {/* Header — hidden on mobile entirely. The thread list already makes it
          obvious this is Messages, and dropping the title/description reclaims
          vertical space on a phone (it stays on desktop, and in the embedded
          desktop panel where the close button lives). */}
      <div className={cn('hidden items-center gap-3 border-b border-[color:var(--color-border-hairline)] px-5 py-4 md:flex')}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] bg-ink-100/10">
          <MessageSquare className="h-5 w-5 text-ink-100" />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold text-ink-100">Messages</h1>
          <p className="text-xs text-ink-60">Chat with your brands and agencies</p>
        </div>
        {(totalUnreadQ.data?.total ?? 0) > 0 && (
          <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-bold text-white">{totalUnreadQ.data!.total}</span>
        )}
        {embedded && onClose && (
          <>
            <button
              onClick={() => {
                onClose();
                navigate('/chat');
              }}
              aria-label="Open messages fullscreen"
              className="rounded-[var(--radius-sm)] p-1.5 text-ink-60 hover:bg-inset hover:text-ink-100"
            >
              <Expand className="h-5 w-5" />
            </button>
            <button onClick={onClose} aria-label="Close messages" className="rounded-[var(--radius-sm)] p-1.5 text-ink-60 hover:bg-inset hover:text-ink-100">
              <X className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      {/* Selectors — also hidden on mobile while a thread is open (the message
          panel takes over the full screen; Back returns to the list + selectors). */}
      <div className={cn('grid grid-cols-1 gap-4 border-b border-[color:var(--color-border-hairline)] px-5 py-4 sm:grid-cols-2', activeId && 'hidden md:grid')}>
        <IdentitySelector
          identities={identities}
          selected={identity}
          unreadByKey={unreadByKey}
          onSelect={onSelectIdentity}
          onClear={() => {
            setPendingNav(null);
            setIdentity(null);
            setBrand(null);
            setActiveId(null);
          }}
          loading={identitiesQ.isLoading}
        />
        <BrandSelector identity={identity} brands={brands} selected={brand} onSelect={(b) => setBrand(b)} />
      </div>

      {/* Split (responsive single-pane on mobile) */}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'flex w-full shrink-0 flex-col border-r border-[color:var(--color-border-hairline)] md:w-80',
            activeId && 'hidden md:flex',
          )}
        >
          <ThreadList
            threads={threads}
            loading={threadsQ.isLoading}
            activeId={activeId}
            onSelect={onSelectThread}
            search={search}
            onSearch={setSearch}
            grouped={!!identity}
          />
        </aside>
        <section className={cn('flex min-w-0 flex-1 flex-col', !activeId && 'hidden md:flex')}>
          {!identity ? (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={MessageSquare} title="Select who to chat as" description="Pick an identity above, or tap an unread conversation." />
            </div>
          ) : !brand ? (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={MessageSquare} title="Select a brand to chat about" />
            </div>
          ) : activeId && activeThread ? (
            <MessagePanel
              key={activeId}
              threadId={activeId}
              threadName={activeThread.displayName}
              isAiThread={activeThread.type === 'ai'}
              meId={me?.id}
              identity={identity}
              attachedProjectId={attachedProjectId}
              onClearAttachedProject={() => setAttachedProjectId(null)}
              onOpenProject={openProject}
              onRead={refreshThreads}
              onBack={() => setActiveId(null)}
            />
          ) : (
            <div className="grid flex-1 place-items-center">
              <EmptyState icon={MessageSquare} title="Select a conversation" />
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
