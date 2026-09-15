import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';

/**
 * The two numbers the navigation rail carries: how much is unread, and how many
 * people are waiting to be let in.
 *
 * Both queries are already invalidated by the inbox realtime channel
 * (realtime-inbox.ts#flush), so these stay live without a poll and without a
 * second subscription. Kept in one hook so the rail can't accidentally read one
 * of them and not the other.
 *
 * `surface: 'messenger'` is not optional. `totalUnread` defaults to the WORKSPACE
 * surface — the org threads this app cannot even open — so without it the badge
 * would count conversations that live in a different product.
 */
export function useChatBadges(): { unread: number; requests: number } {
  const trpc = useTRPC();
  const unread = useQuery(trpc.chat.totalUnread.queryOptions({ surface: 'messenger' }));
  const requests = useQuery(trpc.chat.requestCount.queryOptions());
  return {
    unread: unread.data?.total ?? 0,
    requests: requests.data?.count ?? 0,
  };
}
