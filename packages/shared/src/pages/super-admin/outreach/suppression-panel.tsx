import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronRight } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { useConfirm } from '../../../components/ui/confirm-dialog';

/**
 * THE DO-NOT-CONTACT LIST.
 *
 * It is the one piece of state in this feature that is written by four
 * different things and had never been readable by any of them: a bounce, an
 * unsubscribe, a classifier verdict of `never`, and an operator pressing
 * Suppress in the Reply Queue all land here, and until now the only way to find
 * out what was on it was to query the database. Which means the two questions
 * an operator actually asks — "why is this business not being emailed?" and
 * "did that suppression actually reach Smartlead?" — had no surface at all.
 *
 * It lives on Prospects rather than in the Reply Queue because it is a fact
 * about the contact database, not about a decision being made right now.
 * Collapsed by default: it is a reference, and it must not compete with the
 * list it sits above.
 *
 * `pushedAt` is the column worth reading. Our copy is authoritative — the list
 * builder checks it directly — but Smartlead holds a replica that stops a
 * campaign already in flight, and a row that never reached it is a person a
 * running sequence can still email. The reconcile sweep retries those every
 * fifteen minutes; this is where you find out it hasn't managed yet.
 */

function whenever(iso: string | Date | null): string {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function SuppressionPanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<'email' | 'domain'>('email');
  const [reason, setReason] = useState('');

  const listKey = trpc.outreach.suppressions.queryKey({ limit: 100 });
  const list = useQuery({
    ...trpc.outreach.suppressions.queryOptions({ limit: 100 }),
    enabled: open,
  });

  const add = useMutation({
    ...trpc.outreach.addSuppression.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      setValue('');
      setReason('');
      toast('Added. They will not be contacted again from any domain.');
    },
    onError: (e) => toastError(e),
  });

  const remove = useMutation({
    ...trpc.outreach.removeSuppression.mutationOptions(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: listKey });
      toast(`${r.value} is off the list.`, {
        description: r.stillBlockedInSmartlead
          ? 'Smartlead still holds it on its own block list, so it will keep refusing them until that entry is removed there.'
          : undefined,
      });
    },
    onError: (e) => toastError(e),
  });

  const rows = list.data ?? [];
  const unpushed = rows.filter((r) => !r.pushedAt).length;

  const onRemove = async (id: string, label: string) => {
    const ok = await confirm({
      title: `Take ${label} off the suppression list?`,
      description:
        'They become contactable again by the next list run. Suppressions written by a bounce or an unsubscribe are a record of something the recipient asked for — removing one is only right when it was a mistake.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) remove.mutate({ id });
  };

  return (
    <section className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-ui-xs press inline-flex items-center gap-2 text-ink-40 transition-colors duration-[var(--duration-quick)] hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            'h-3.5 w-3.5 transition-transform duration-[var(--duration-quick)]',
            open && 'rotate-90',
          )}
        />
        Suppression list
        {open && rows.length > 0 && <span className="tnum text-ink-60">{rows.length}</span>}
      </button>

      {open && (
        <div className="mt-2 rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card px-4 py-4">
          <p className="text-ui-xs text-ink-60">
            One list across all four domains and twenty mailboxes. Checked when a list is built and
            again immediately before any reply is sent.
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[14rem] flex-1">
              <span className="eyebrow">Address or domain</span>
              <Input
                className="mt-1.5"
                value={value}
                placeholder={kind === 'email' ? 'someone@example.com' : 'example.com'}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <div
              role="group"
              aria-label="What kind of entry"
              className="inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]"
            >
              {(['email', 'domain'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    'press text-ui-xs h-8 px-3 transition-colors duration-[var(--duration-quick)]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]',
                    kind === k ? 'bg-ink-100 text-paper' : 'text-ink-60 hover:bg-inset',
                  )}
                >
                  {k === 'email' ? 'Address' : 'Whole domain'}
                </button>
              ))}
            </div>
            <label className="min-w-[10rem] flex-1">
              <span className="eyebrow">Why</span>
              <Input
                className="mt-1.5"
                value={reason}
                placeholder="optional"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <Button
              size="sm"
              disabled={value.trim().length < 3 || add.isPending}
              onClick={() =>
                add.mutate({ value: value.trim(), kind, reason: reason.trim() || undefined })
              }
            >
              Suppress
            </Button>
          </div>

          {unpushed > 0 && (
            <p className="text-ui-xs mt-3 text-warn">
              {unpushed} {unpushed === 1 ? 'entry has' : 'entries have'} not reached Smartlead&rsquo;s
              own block list yet. They are already excluded from every future list run; a sequence
              already in flight can still reach them until the sweep gets through. It retries every
              fifteen minutes.
            </p>
          )}

          {list.isPending ? (
            <div className="pd-shimmer mt-4 h-[80px] w-full rounded-[var(--radius-sm)]" />
          ) : rows.length === 0 ? (
            <p className="text-ui-xs mt-4 text-ink-40">
              Nothing suppressed. Bounces, unsubscribes and anything read as &ldquo;never&rdquo;
              land here on their own.
            </p>
          ) : (
            <ul className="mt-4 overflow-hidden rounded-[var(--radius-sm)] border border-[color:var(--color-border-hairline)]">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color:var(--color-border-hairline)] px-3 py-2 last:border-0"
                >
                  <span className="mono min-w-0 flex-1 truncate text-[12px] text-ink-100">
                    {r.value}
                  </span>
                  {r.kind === 'domain' && (
                    <span className="text-ui-xs text-ink-60">whole domain</span>
                  )}
                  <span className="text-ui-xs text-ink-40">
                    {r.reason || r.source || 'no reason recorded'}
                  </span>
                  <span className="text-ui-xs tnum text-ink-20">{whenever(r.createdAt)}</span>
                  {!r.pushedAt && (
                    <span
                      className="text-ui-xs text-warn"
                      title={r.pushError ?? 'Not yet mirrored to Smartlead'}
                    >
                      local only
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => onRemove(r.id, r.value)}
                    className="text-ui-xs text-ink-40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)] disabled:opacity-50"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
