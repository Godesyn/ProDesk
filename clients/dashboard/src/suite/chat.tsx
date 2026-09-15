/* Prodesk Suite — Strategist chat dock. A persistent right rail backed by the
   brand's AI assistant thread — the same data-backed flow as the Growth strategy
   app (strategy.tsx), just docked. The thread id comes from the brand model
   (brands.chatbotThreadId); legacy brands without one have it ensured on demand.
   When the brand owner isn't subscribed to Growth Strategy, MessagePanel shows
   its in-thread upsell card (the "offer") and locks the composer. */

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useCurrentUser } from '@shared/auth/auth-context';
import { MessagePanel } from '@shared/pages/chat/message-panel';
import type { ChatIdentity } from '@shared/pages/chat/chat-types';
import { Icon } from './icons';
import { Scrim } from './ui';
import { APPS, type Brand, type SuiteApp } from './data';

export function ChatDock({
  brand,
  onOpenApp,
  isMobile,
  deskOpen,
  setDeskOpen,
  mobileOpen,
  setMobileOpen,
}: {
  brand: Brand;
  onOpenApp: (a: SuiteApp) => void;
  isMobile: boolean;
  deskOpen: boolean;
  setDeskOpen: (v: boolean) => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { data: me } = useCurrentUser();

  // The brand identity to chat as ("Chat as <brand>").
  const identitiesQ = useQuery(trpc.chat.identities.queryOptions());
  const identity = useMemo<ChatIdentity | null>(
    () =>
      (identitiesQ.data ?? []).find(
        (i) => i.type === 'brand' && i.entityId === brand.id,
      ) ?? null,
    [identitiesQ.data, brand.id],
  );

  // Thread id from the brand model; ensure it for legacy brands (null chatbotThreadId).
  const [threadId, setThreadId] = useState<string | null>(
    brand.chatbotThreadId ?? null,
  );
  const ensure = useMutation(trpc.brands.ensureAiThread.mutationOptions());
  useEffect(() => {
    setThreadId(brand.chatbotThreadId ?? null);
    if (!brand.chatbotThreadId) {
      ensure.mutate(
        { brandId: brand.id },
        {
          onSuccess: (r) => {
            if (r.threadId) {
              setThreadId(r.threadId);
              void qc.invalidateQueries({
                queryKey: trpc.brands.mine.queryKey(),
              });
            }
          },
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand.id, brand.chatbotThreadId]);

  const openFullView = () => {
    const a = APPS.find((x) => x.id === 'strategy');
    if (a) onOpenApp(a);
  };

  const Body = (
    <div className="pd-chat">
      <div className="pd-chat-head">
        <span className="pd-chat-spark">
          <Icon name="sparkle" size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="pd-chat-title">Strategist</div>
          <div className="pd-chat-sub">Knows everything about {brand.name}</div>
        </div>
        <button
          type="button"
          className="pd-icon-btn"
          aria-label="Open full Growth strategy"
          title="Open full view"
          onClick={openFullView}
        >
          <Icon name="external" size={17} />
        </button>
        {isMobile ? (
          <button
            type="button"
            className="pd-icon-btn"
            aria-label="Close chat"
            onClick={() => setMobileOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        ) : (
          <button
            type="button"
            className="pd-icon-btn"
            aria-label="Hide chat"
            onClick={() => setDeskOpen(false)}
          >
            <Icon
              name="collapse"
              size={18}
              style={{ transform: 'scaleX(-1)' }}
            />
          </button>
        )}
      </div>

      {/* AI chat thread — same component & flow as the Growth strategy app. Fills
          the remaining height. The composer locks itself (and shows the upsell
          card) until the brand owner subscribes to Growth Strategy. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {threadId ? (
          <MessagePanel
            key={threadId}
            threadId={threadId}
            threadName="Strategist"
            isAiThread
            hideHeader
            meId={me?.id}
            identity={identity}
            onOpenProject={() => {}}
            onRead={() => {}}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-8 text-center text-sm text-ink-40">
            {ensure.isPending
              ? 'Setting up your AI strategist…'
              : 'Your AI strategist is unavailable right now.'}
          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    if (!mobileOpen) return null;
    return (
      <Scrim onClick={() => setMobileOpen(false)} align="right">
        <div
          style={{
            width: 'min(400px, 92vw)',
            height: '100%',
            animation: 'pd-slide-right var(--dur) var(--ease)',
          }}
        >
          {Body}
        </div>
      </Scrim>
    );
  }
  if (!deskOpen) return null;
  return <aside className="pd-chat-rail">{Body}</aside>;
}

export function ChatReopen({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="pd-chat-reopen"
      onClick={onClick}
      aria-label="Open strategist chat"
    >
      <Icon name="sparkle" size={18} />
    </button>
  );
}
