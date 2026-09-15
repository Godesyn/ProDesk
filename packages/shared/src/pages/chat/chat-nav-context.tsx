import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../../lib/trpc';
import type { ChatIdentity, ChatIdentityType } from './chat-types';
import type { ChatBrand } from './brand-selector';

/**
 * Global chat-navigation surface. Ports `ChatNavigationService`
 * (chat_navigation_service.dart) + the `floatingMessagePanelOpenProvider` +
 * `chatStateProvider.navigateToThread` glue: any chip/button in the app can ask
 * to open chat focused on a brand/agency/inter-agency conversation or a 1-on-1.
 *
 * The heavy lifting (pick identity, find the target thread) happens server-side
 * in `chat.resolveNavigation`; this provider holds the resolved request and the
 * docked-panel open state so `FloatingMessagePanel` and `ChatPage` can react.
 */

export type ChatNavigationTarget = 'allThread' | 'brandThread' | 'agencyThread' | 'interAgencyThread' | 'personalThread';

export interface NavigateToChatInput {
  brandId: string;
  agencyId?: string | null;
  target: ChatNavigationTarget;
  targetUserId?: string | null;
  /** The viewer's own agency — required so inter-agency picks the right identity. */
  selfAgencyId?: string | null;
  /** Project to attach to the next message, if launched from a project. */
  projectId?: string | null;
}

/** A resolved navigation target that a mounted ChatPage should apply. */
export interface ChatNavRequest {
  identityType: ChatIdentityType;
  entityId: string;
  brandId: string | null;
  threadId: string | null;
  projectId: string | null;
}

interface ChatNavContextValue {
  /** Docked panel open state (desktop). */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** The pending request a ChatPage should consume, or null. */
  request: ChatNavRequest | null;
  /** Clear the request once a ChatPage has applied it. */
  consumeRequest: () => void;
  /** Resolve + launch chat for an intent (the `ChatNavigationService` entry point). */
  navigateToChat: (input: NavigateToChatInput) => Promise<void>;

  // Persisted chat selections ("Chat as" identity, "Chat about" brand, and the
  // open thread). Held here — above the docked panel — so they survive closing
  // and reopening the message panel; they reset only on logout or page refresh
  // (this provider is recreated then).
  selectedIdentity: ChatIdentity | null;
  setSelectedIdentity: (v: ChatIdentity | null) => void;
  selectedBrand: ChatBrand | null;
  setSelectedBrand: (v: ChatBrand | null) => void;
  activeThreadId: string | null;
  setActiveThreadId: (v: string | null) => void;
}

const ChatNavContext = createContext<ChatNavContextValue | null>(null);

export function ChatNavProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [location, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<ChatNavRequest | null>(null);
  const [selectedIdentity, setSelectedIdentity] = useState<ChatIdentity | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<ChatBrand | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  const consumeRequest = useCallback(() => setRequest(null), []);

  const navigateToChat = useCallback(
    async (input: NavigateToChatInput) => {
      const res = await qc.fetchQuery(
        trpc.chat.resolveNavigation.queryOptions({
          brandId: input.brandId,
          agencyId: input.agencyId ?? null,
          target: input.target,
          targetUserId: input.targetUserId ?? null,
          selfAgencyId: input.selfAgencyId ?? null,
        }),
      );
      if (!res) return;

      setRequest({
        identityType: res.identityType,
        entityId: res.entityId,
        brandId: res.brandId,
        threadId: res.threadId,
        projectId: input.projectId ?? null,
      });

      // A ChatPage already mounted at /chat will consume the request directly.
      if (location === '/chat') return;
      // Small screens route to the full-screen page; desktop opens the docked panel.
      const small = window.innerWidth < 768 || window.innerHeight < 600;
      if (small) navigate('/chat');
      else setOpen(true);
    },
    [qc, trpc, location, navigate],
  );

  const value = useMemo<ChatNavContextValue>(
    () => ({
      open,
      setOpen,
      request,
      consumeRequest,
      navigateToChat,
      selectedIdentity,
      setSelectedIdentity,
      selectedBrand,
      setSelectedBrand,
      activeThreadId,
      setActiveThreadId,
    }),
    [open, request, consumeRequest, navigateToChat, selectedIdentity, selectedBrand, activeThreadId],
  );

  return <ChatNavContext.Provider value={value}>{children}</ChatNavContext.Provider>;
}

export function useChatNav(): ChatNavContextValue {
  const ctx = useContext(ChatNavContext);
  if (!ctx) throw new Error('useChatNav must be used within a ChatNavProvider');
  return ctx;
}
