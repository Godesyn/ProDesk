import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Link2 } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { getErrorMessage, toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { useConfirm } from '../../../components/ui/confirm-dialog';
import { OutreachShell, railColumn } from './shell';
import { ClassificationMark, ShortcutHelp, useKeepInView, useListKeys } from './shared';
import { WebhookPanel } from './webhook-panel';
import { useReducedMotion } from './motion';

/**
 * REPLY QUEUE — /super-admin/outreach/replies
 *
 * Triage, not a table. One reply in focus at a time with its thread above the
 * draft, and every action on the home row: `j`/`k` move, `a` sends, `e` edits,
 * `x` suppresses. Someone who learns four keys can clear a morning's replies
 * without touching the mouse — which is the whole design goal, because this is
 * where the volume lands.
 *
 * `never` and unsubscribe replies never reach this screen: they are suppressed
 * automatically on arrival (§9), so everything here is a real decision.
 */

/**
 * Does this draft already carry a login link?
 *
 * "Add account link" is only offered on a `yes`, which is exactly when sending
 * also creates the account and appends a link — so pressing it used to put the
 * same URL in the email twice. The server refuses the second append on the same
 * test; this is here so the confirmation says what will actually happen rather
 * than describing the behaviour that was removed.
 */
const bodyHasLink = (body: string) => /\/auth\/confirm\?token_hash=/i.test(body);

const SHORTCUTS = [
  { keys: 'j / k', label: 'Next / previous reply' },
  { keys: 'a', label: 'Approve and send' },
  { keys: 'e', label: 'Edit the draft' },
  { keys: 'x', label: 'Suppress and discard' },
  { keys: '?', label: 'This list' },
  { keys: 'Esc', label: 'Back out' },
];

export function OutreachRepliesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const reduced = useReducedMotion();

  const queueKey = trpc.outreach.replyQueue.queryKey();
  const queueQuery = useQuery({
    ...trpc.outreach.replyQueue.queryOptions(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const items = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);

  const [focusIndex, setFocusIndex] = useState(0);
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const current = items[Math.min(focusIndex, Math.max(0, items.length - 1))] ?? null;

  // Load the focused draft into the editor. Deliberately keyed on id — a poll
  // that returns the same item must not discard an in-progress edit.
  useEffect(() => {
    if (current) setBody(current.draftBody);
    setEditing(false);
  }, [current?.id]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queueKey });
    qc.invalidateQueries({ queryKey: trpc.outreach.pendingReplyCount.queryKey() });
  };

  const send = useMutation({
    ...trpc.outreach.sendReply.mutationOptions(),
    onSuccess: (r) => {
      invalidate();
      toast(r.includedLink ? 'Sent — with their account link.' : 'Sent.');
      // Stay on the same index: the list shortens under us, so this lands on the
      // next reply rather than skipping one.
      setFocusIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    },
    onError: (e) => toastError(e),
  });

  const discard = useMutation({
    ...trpc.outreach.discardReply.mutationOptions(),
    onSuccess: (_r, vars) => {
      invalidate();
      toast(vars.alsoSuppress ? 'Suppressed. They won’t be contacted again.' : 'Discarded.');
      setFocusIndex((i) => Math.max(0, Math.min(i, items.length - 2)));
    },
    onError: (e) => toastError(e),
  });

  const saveDraft = useMutation({
    ...trpc.outreach.saveDraft.mutationOptions(),
    onSuccess: () => toast('Draft saved.'),
    onError: (e) => toastError(e),
  });

  const resendLink = useMutation({
    ...trpc.outreach.resendAccountLink.mutationOptions(),
    onSuccess: (r) => {
      setBody((b) => `${b.trim()}\n\nSet up your listing here: ${r.link}`);
      toast('Link added to the draft.');
    },
    onError: (e) => toastError(e),
  });

  const busy = send.isPending || discard.isPending;

  const approve = useCallback(async () => {
    if (!current || busy) return;
    const effective = current.manualClassification ?? current.classification;
    const withLink = effective === 'yes';

    const ok = await confirm({
      title: `Send this reply to ${current.businessName || current.email}?`,
      description: !withLink
        ? 'Sent email cannot be recalled.'
        : bodyHasLink(body)
          ? 'Their Verdiict account is created, and the link already in this draft is the one that goes out. Sent email cannot be recalled.'
          : 'Their Verdiict account is created and the login link goes out in this email. Sent email cannot be recalled.',
      confirmLabel: 'Send reply',
    });
    if (!ok) return;

    send.mutate({ draftId: current.id, body, withAccountLink: withLink });
  }, [current, body, busy, confirm, send]);

  const suppress = useCallback(async () => {
    if (!current || busy) return;
    const ok = await confirm({
      title: `Never contact ${current.email} again?`,
      description: 'They are added to the global suppression list across all domains and mailboxes.',
      confirmLabel: 'Suppress',
      destructive: true,
    });
    if (!ok) return;
    discard.mutate({ draftId: current.id, alsoSuppress: true });
  }, [current, busy, confirm, discard]);

  useListKeys({
    disabled: helpOpen,
    onNext: () => setFocusIndex((i) => Math.min(items.length - 1, i + 1)),
    onPrev: () => setFocusIndex((i) => Math.max(0, i - 1)),
    onApprove: () => void approve(),
    onEdit: () => {
      setEditing(true);
      // Focus after the state flush, or the textarea isn't editable yet.
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onSuppress: () => void suppress(),
    onHelp: () => setHelpOpen(true),
    onEscape: () => {
      setHelpOpen(false);
      setEditing(false);
    },
  });

  const effective = current ? (current.manualClassification ?? current.classification) : null;
  const position = Math.min(focusIndex, Math.max(0, items.length - 1));
  const focusedRef = useKeepInView<HTMLLIElement>(current?.id ?? null);

  return (
    <OutreachShell
      title="Reply Queue"
      description="Every outgoing reply goes through a human. Nothing here sends itself."
      pendingReplies={items.length}
    >
      {/* Above everything, because an empty queue means two completely
          different things depending on what it says: nothing to answer, or
          Smartlead was never told where to post. */}
      <WebhookPanel />

      {queueQuery.isError && (
        <p className="text-ui-sm mb-4 text-danger">{getErrorMessage(queueQuery.error)}</p>
      )}

      {queueQuery.isPending ? (
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-5">
          <div className="pd-shimmer h-[18px] w-1/3 rounded-full" />
          <div className="pd-shimmer mt-4 h-[140px] w-full rounded-[var(--radius-sm)]" />
          <div className="pd-shimmer mt-4 h-[100px] w-full rounded-[var(--radius-sm)]" />
        </div>
      ) : items.length === 0 ? (
        <QueueClear reduced={reduced} />
      ) : (
        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          {/* ── Waiting ─────────────────────────────────────────────────── */}
          <aside
            className={cn(
              'overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card',
              railColumn,
            )}
          >
            {/* Sticky only where the column owns a scrollbar — below `lg` it
                would stick to the viewport instead and slide under the tab rail. */}
            <div className="border-b border-[color:var(--color-border-hairline)] bg-card px-4 py-3 lg:sticky lg:top-0 lg:z-10">
              <div className="flex items-baseline justify-between">
                <span className="eyebrow">Waiting</span>
                <span className="tnum text-ui-sm text-ink-100">{items.length}</span>
              </div>
              {/* Where you are in the queue, and how much is left of it. Working
                  a queue by keyboard means the list scrolls itself, so the sense
                  of progress has to come from somewhere other than the scrollbar. */}
              <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-inset">
                <div
                  className="h-full rounded-full bg-ink-80 transition-[width] duration-[var(--duration-standard)] ease-[var(--ease-click)]"
                  style={{ width: `${((position + 1) / items.length) * 100}%` }}
                />
              </div>
            </div>
            <ul>
              {items.map((it, i) => (
                <li key={it.id} ref={i === position ? focusedRef : undefined}>
                  <button
                    type="button"
                    onClick={() => setFocusIndex(i)}
                    className={cn(
                      'w-full border-b border-[color:var(--color-border-hairline)] px-4 py-3 text-left last:border-0',
                      'transition-colors duration-[var(--duration-quick)]',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--color-accent-ring)]',
                      i === position ? 'bg-inset' : 'hover:bg-inset/60',
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-ui-sm truncate text-ink-100">
                        {it.businessName || it.email}
                      </span>
                      <ClassificationMark value={it.manualClassification ?? it.classification} />
                    </div>
                    <div className="mono mt-1 truncate text-[11px] text-ink-40">{it.email}</div>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* ── The one in focus ────────────────────────────────────────── */}
          {current && (
            <section className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
              <header className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="eyebrow">
                      Reply {position + 1} of {items.length}
                    </div>
                    <h2 className="text-panel-title mt-1 truncate text-ink-100">
                      {current.businessName || current.email}
                    </h2>
                    <p className="mono mt-1 truncate text-[12px] text-ink-40">{current.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ClassificationMark value={effective} />
                    {current.fulfilmentStatus && current.fulfilmentStatus !== 'none' && (
                      <span className="text-ui-xs text-ink-40">
                        account {current.fulfilmentStatus}
                      </span>
                    )}
                  </div>
                </div>
                {current.classificationReasoning && (
                  <p className="text-ui-xs mt-2 text-ink-60">{current.classificationReasoning}</p>
                )}
              </header>

              {/* The thread they replied to sits above the draft, so the answer
                  is written against what they actually said. */}
              <ThreadPreview email={current.email} />

              <div className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="eyebrow">Your reply</span>
                  <div className="flex items-center gap-2">
                    {effective === 'yes' && (
                      <button
                        type="button"
                        disabled={resendLink.isPending}
                        onClick={() => resendLink.mutate({ email: current.email })}
                        className="text-ui-xs inline-flex items-center gap-1 text-ink-60 underline-offset-4 hover:text-ink-100 hover:underline disabled:opacity-50"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        Add account link
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => saveDraft.mutate({ draftId: current.id, body })}
                      disabled={saveDraft.isPending || body === current.draftBody}
                      className="text-ui-xs text-ink-60 underline-offset-4 hover:text-ink-100 hover:underline disabled:opacity-40"
                    >
                      Save without sending
                    </button>
                  </div>
                </div>

                <textarea
                  ref={textareaRef}
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onFocus={() => setEditing(true)}
                  placeholder="The model couldn't draft this one — write it yourself."
                  className={cn(
                    'mt-2 w-full resize-y rounded-[var(--radius-sm)] border bg-paper p-3 text-body text-ink-100',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                    editing
                      ? 'border-[color:var(--color-border-default)]'
                      : 'border-[color:var(--color-border-hairline)]',
                  )}
                />

                {effective === 'yes' && (
                  <p className="text-ui-xs mt-2 text-ink-60">
                    {bodyHasLink(body)
                      ? 'Sending creates their Verdiict account. The link already in this draft is the one that goes out — it will not be added a second time.'
                      : 'Sending creates their Verdiict account and appends the login link to this email.'}
                  </p>
                )}

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Button size="sm" disabled={busy || !body.trim()} onClick={approve}>
                    <Check className="h-4 w-4" />
                    Approve and send
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => discard.mutate({ draftId: current.id, alsoSuppress: false })}
                  >
                    Discard
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={suppress}>
                    Suppress
                  </Button>
                  <span className="text-ui-xs ml-auto text-ink-40">
                    <kbd className="mono">a</kbd> send · <kbd className="mono">e</kbd> edit ·{' '}
                    <kbd className="mono">x</kbd> suppress · <kbd className="mono">?</kbd> keys
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      )}

      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} shortcuts={SHORTCUTS} />
    </OutreachShell>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Thread
 * ────────────────────────────────────────────────────────────────────────── */

function ThreadPreview({ email }: { email: string }) {
  const trpc = useTRPC();
  const q = useQuery(trpc.outreach.prospectThread.queryOptions({ email }));

  if (q.isPending) {
    return (
      <div className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        <div className="pd-shimmer h-[80px] w-full rounded-[var(--radius-sm)]" />
      </div>
    );
  }
  const messages = (q.data?.messages ?? []) as Record<string, unknown>[];
  if (q.data?.threadError) {
    return (
      <div className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
        <p className="text-ui-xs text-danger">
          Smartlead could not return the thread: {q.data.threadError}
        </p>
      </div>
    );
  }
  if (messages.length === 0) return null;

  // The last inbound message is what the reply is answering, so it leads.
  const inbound = messages.filter((m) => String(m.type ?? '').toUpperCase().includes('REPLY'));
  const latest = inbound[inbound.length - 1] ?? messages[messages.length - 1];
  const body = String(latest.email_body ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return (
    <div className="border-b border-[color:var(--color-border-hairline)] px-5 py-4">
      <div className="eyebrow">They wrote</div>
      <blockquote className="text-body mt-2 whitespace-pre-wrap border-l-2 border-[color:var(--color-border-default)] pl-3 text-ink-80">
        {body || '—'}
      </blockquote>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
 * Cleared
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The completion state.
 *
 * §9 asks for a satisfying finish rather than an empty table — clearing a queue
 * should feel like finishing something, because that is what it is.
 */
function QueueClear({ reduced }: { reduced: boolean }) {
  return (
    <div
      className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-6 py-20 text-center"
      style={reduced ? undefined : { animation: 'reveal var(--duration-statement) var(--ease-click) both' }}
    >
      <div
        aria-hidden
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--color-border-default)]"
      >
        <Check className="h-5 w-5 text-ink-60" />
      </div>
      <h2 className="text-panel-title mt-4 text-ink-100">Queue clear</h2>
      <p className="text-ui-sm mx-auto mt-2 max-w-sm text-ink-60">
        Every reply has been answered. New ones land here as they arrive — nothing goes out without
        you.
      </p>
    </div>
  );
}
