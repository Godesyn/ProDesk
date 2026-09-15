import { useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ThumbsDown, Building2, User, Check, RotateCcw, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../../lib/errors';
import { useTRPC } from '../../lib/trpc';
import { cn } from '../../lib/utils';
import { PageHeader } from '../../components/layout/page-header';
import { Card } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { Skeleton } from '../../components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { PillToggle } from './components';

/** Date + time — the list needs the time-of-day, which shared formatDate omits. */
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-AU', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

type ListResult = ReturnType<typeof useDislikedList>;
type FeedbackRow = ListResult['items'][number];

function useDislikedList(includeResolved: boolean) {
  const trpc = useTRPC();
  const q = useInfiniteQuery(
    trpc.chat.adminListDislikedAiReplies.infiniteQueryOptions(
      { includeResolved, limit: 20 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );
  const items = useMemo(() => (q.data?.pages ?? []).flatMap((p) => p.items), [q.data]);
  return { items, q };
}

export function StrategyFeedbackPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [includeResolved, setIncludeResolved] = useState(false);
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);

  const { items, q } = useDislikedList(includeResolved);

  // Invalidate every variant (resolved + unresolved lists) so a toggled row moves
  // between them without a stale cache.
  const invalidate = () => qc.invalidateQueries({ queryKey: trpc.chat.adminListDislikedAiReplies.queryKey() });

  const resolve = useMutation({
    ...trpc.chat.adminResolveAiFeedback.mutationOptions(),
    onSuccess: () => {
      toast.success('Updated');
      invalidate();
    },
    onError: (e) => toastError(e),
  });

  return (
    <div>
      <PageHeader
        title="Strategy Feedback"
        description="AI replies your users thumbed-down. Open one to read the conversation that led up to it, then mark it resolved once handled."
      />

      <div className="mb-4 flex items-center justify-between">
        <PillToggle
          label="Show resolved"
          checked={includeResolved}
          onChange={setIncludeResolved}
        />
        {!q.isLoading && (
          <p className="text-xs text-ink-40">
            {items.length} {includeResolved ? 'total' : 'unresolved'}
            {q.hasNextPage ? '+' : ''}
          </p>
        )}
      </div>

      {q.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-ink-60">
          {includeResolved ? 'No disliked replies yet.' : 'No unresolved feedback — nice.'}
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <FeedbackCard
              key={item.id}
              item={item}
              busy={resolve.isPending}
              onOpen={() => setOpenMessageId(item.id)}
              onToggleResolved={() => resolve.mutate({ messageId: item.id, resolved: !item.resolved })}
            />
          ))}
          {q.hasNextPage && (
            <div className="pt-1 text-center">
              <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          )}
        </div>
      )}

      {openMessageId && (
        <ThreadContextDialog
          messageId={openMessageId}
          onClose={() => setOpenMessageId(null)}
          onResolvedChanged={invalidate}
        />
      )}
    </div>
  );
}

function FeedbackCard({
  item,
  busy,
  onOpen,
  onToggleResolved,
}: {
  item: FeedbackRow;
  busy: boolean;
  onOpen: () => void;
  onToggleResolved: () => void;
}) {
  return (
    <Card className="p-0">
      <div className="flex items-start gap-3 p-4">
        <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-danger/12 text-danger">
          <ThumbsDown className="h-4 w-4" />
        </div>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-sm font-medium text-ink-100">
              <Building2 className="h-3.5 w-3.5 text-ink-40" />
              {item.brand?.name ?? 'No brand'}
            </span>
            <span className="inline-flex items-center gap-1 text-sm text-ink-60">
              <User className="h-3.5 w-3.5 text-ink-40" />
              {item.ratedBy?.name ?? 'Unknown user'}
            </span>
            {item.resolved && <Badge variant="success">Resolved</Badge>}
          </div>
          <p className="mt-1.5 line-clamp-3 text-sm text-ink-80">
            {item.content?.trim() || <span className="italic text-ink-40">(empty reply)</span>}
          </p>
          <p className="mt-1.5 text-xs text-ink-40">{formatDateTime(item.timestamp)}</p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Button variant="ghost" size="sm" onClick={onOpen}>
            <MessageSquare className="h-3.5 w-3.5" /> View thread
          </Button>
          <Button variant={item.resolved ? 'ghost' : 'outline'} size="sm" onClick={onToggleResolved} disabled={busy}>
            {item.resolved ? (
              <>
                <RotateCcw className="h-3.5 w-3.5" /> Reopen
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> Resolve
              </>
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ThreadContextDialog({
  messageId,
  onClose,
  onResolvedChanged,
}: {
  messageId: string;
  onClose: () => void;
  onResolvedChanged: () => void;
}) {
  const trpc = useTRPC();
  const ctxQ = useQuery(trpc.chat.adminThreadContext.queryOptions({ messageId }));
  const messages = ctxQ.data?.items ?? [];
  const targetId = ctxQ.data?.targetId;

  const resolve = useMutation({
    ...trpc.chat.adminResolveAiFeedback.mutationOptions(),
    onSuccess: (res) => {
      toast.success(res.resolved ? 'Marked resolved' : 'Reopened');
      onResolvedChanged();
    },
    onError: (e) => toastError(e),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
          <DialogTitle>Conversation leading up to the disliked reply</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {ctxQ.isLoading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14 w-2/3" />)}</div>
          ) : messages.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-40">No messages found.</p>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} isTarget={m.id === targetId} />)
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--color-border-hairline)] px-5 py-3">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant="accent"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ messageId, resolved: true })}
          >
            <Check className="h-4 w-4" /> Mark resolved
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ContextMessage = {
  id: string;
  isAi: boolean;
  type: string;
  senderName: string | null;
  content: string | null;
  timestamp: string;
};

function MessageBubble({ message, isTarget }: { message: ContextMessage; isTarget: boolean }) {
  const m = message;

  // System dividers (e.g. the /clear marker) render centred and muted.
  if (m.type === 'system') {
    return (
      <div className="flex justify-center">
        <span className="rounded-full bg-inset px-3 py-1 text-xs text-ink-40">{m.content}</span>
      </div>
    );
  }

  const mine = m.isAi;
  return (
    <div className={cn('flex', mine ? 'justify-start' : 'justify-end')}>
      <div
        className={cn(
          'max-w-[80%] rounded-[var(--radius-md)] px-3 py-2',
          mine ? 'bg-inset text-ink-100' : 'bg-accent/12 text-ink-100',
          isTarget && 'ring-2 ring-danger',
        )}
      >
        <div className="mb-0.5 flex items-center gap-2">
          <span className="text-xs font-medium text-ink-60">{mine ? 'Strategist' : m.senderName || 'User'}</span>
          {isTarget && <Badge variant="danger">Disliked</Badge>}
        </div>
        <p className="whitespace-pre-wrap text-sm">{m.content?.trim() || <span className="italic text-ink-40">(no text)</span>}</p>
        <p className="mt-1 text-[0.6875rem] text-ink-40">{formatDateTime(m.timestamp)}</p>
      </div>
    </div>
  );
}
