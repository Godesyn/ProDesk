import { useMutation, useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { toast } from 'sonner';
import { toastError } from '@shared/lib/errors';
import { useTRPC } from '@shared/lib/trpc';
import { useConfirm } from '@shared/components/ui/confirm-dialog';
import { Avatar, EmptyState, GhostButton, LiveButton, Spec } from '../components/primitives';
import { inboxTime } from '../lib/format';
import { threadPath } from '../app/routes';
import { useChatInvalidate } from '../app/use-invalidate';

/**
 * Message requests.
 *
 * This screen is not a feature, it is the price of admission. The moment anyone
 * can be found by email address, "discoverable" would otherwise mean "reachable
 * by everyone with a list" — so a first message from someone you share nothing
 * with lands here instead of in the inbox.
 *
 * Requests used to be COMPLETELY silent — no badge, no toast, no email — and the
 * cost of that was a queue nobody opened, so genuine first messages went unread
 * for weeks. They now announce themselves, but only ever as a COUNT: the rail
 * badge is a number, the toast says "someone wrote", and the digest email says
 * how many are waiting. No name and no words reach you until you accept, so this
 * is still not a channel a stranger can deliver a message through.
 *
 * The full first message is shown, not a truncated preview. You have to be able
 * to judge a stranger's note to decide on it, and a clipped line is how a
 * legitimate one gets declined by mistake.
 *
 * Declining does NOT delete the thread. The sender keeps their side, exactly as
 * they would if you had simply never replied — telling them they were declined is
 * a worse outcome for the person declining.
 */
export function Requests() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const confirm = useConfirm();
  const invalidate = useChatInvalidate();

  const list = useQuery(trpc.chat.listRequests.queryOptions({ limit: 30 }));
  const accept = useMutation(trpc.chat.acceptRequest.mutationOptions());
  const decline = useMutation(trpc.chat.declineRequest.mutationOptions());

  const items = list.data ?? [];

  const onDecline = async (threadId: string, name: string, block: boolean) => {
    if (block) {
      const ok = await confirm({
        title: `Block ${name}?`,
        description: 'They won’t be able to message you or find you by email address.',
        confirmLabel: 'Block',
        destructive: true,
      });
      if (!ok) return;
    }
    decline.mutate(
      { threadId, block },
      {
        onSuccess: () => {
          invalidate.afterRequestChange();
          toast.success(block ? 'Blocked' : 'Deleted');
        },
        onError: (e) => toastError(e),
      },
    );
  };

  return (
    <div className="cx-scroll min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-5 pb-20 pt-8">
        <header className="mb-7">
          <Spec>Requests</Spec>
          <h1
            className="mt-1.5 text-[26px] font-bold tracking-tight"
            style={{ color: 'var(--voice)' }}
          >
            People you don’t know yet
          </h1>
          <p className="mt-2 max-w-md text-sm" style={{ color: 'var(--voice-2)' }}>
            First messages from anyone you share no conversation with land here. You’re
            told how many are waiting — never who, or what they said, until you accept.
          </p>
        </header>

        {list.isLoading ? (
          <p className="py-12 text-center">
            <Spec>Loading…</Spec>
          </p>
        ) : items.length === 0 ? (
          <EmptyState line="No one new has written to you." />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((r) => (
              <article key={r.threadId} className="cx-card p-5">
                <div className="flex items-center gap-3">
                  <Avatar name={r.from.name} url={r.from.avatarUrl} size={40} />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-[14.5px] font-semibold"
                      style={{ color: 'var(--voice)' }}
                    >
                      {r.from.name}
                    </p>
                    <Spec>{inboxTime(r.at)}</Spec>
                  </div>
                </div>

                <p
                  className="speech mt-4 whitespace-pre-wrap"
                  style={{ color: 'var(--voice)' }}
                >
                  {r.preview ?? 'They haven’t said anything yet.'}
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <LiveButton
                    onClick={() =>
                      accept.mutate(
                        { threadId: r.threadId },
                        {
                          onSuccess: () => {
                            invalidate.afterRequestChange();
                            navigate(threadPath(r.threadId));
                          },
                          onError: (e) => toastError(e),
                        },
                      )
                    }
                  >
                    Accept
                  </LiveButton>
                  <GhostButton onClick={() => void onDecline(r.threadId, r.from.name, false)}>
                    Delete
                  </GhostButton>
                  <button
                    type="button"
                    onClick={() => void onDecline(r.threadId, r.from.name, true)}
                    className="press ml-auto text-[13px]"
                    style={{ color: 'var(--danger)' }}
                  >
                    Block
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
