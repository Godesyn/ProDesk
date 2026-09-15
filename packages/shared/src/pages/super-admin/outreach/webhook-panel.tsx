import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { useTRPC } from '../../../lib/trpc';
import { toastError } from '../../../lib/errors';
import { cn } from '../../../lib/utils';
import { Button } from '../../../components/ui/button';

/**
 * THE CALLBACK — the wire everything on this screen hangs off.
 *
 * A reply only becomes a queue item because Smartlead posts it to us, and
 * Smartlead only posts to us because it has been told a URL. Nothing in the
 * product ever told it: `POST /webhook/create` existed in the client and was
 * called from nowhere, so every environment sat behind an endpoint no event
 * would arrive at, and an empty Reply Queue was indistinguishable from a
 * working one with nothing in it.
 *
 * So the panel's job is to make that distinction visible, and it reports THREE
 * separate facts rather than one status light, because each fails on its own:
 *
 *  1. Is there a secret? Without it the endpoint 404s everything, and there is
 *     no URL to register.
 *  2. Have we registered? One user-level webhook covers every campaign, so this
 *     is a single act per environment.
 *  3. Has anything ever ARRIVED? The only end-to-end proof. Registration
 *     succeeding means Smartlead accepted a URL, not that it can reach one —
 *     which is exactly what a localhost origin, a private network or a rotated
 *     domain each look like.
 *
 * Once an event has landed it collapses to a single quiet line. This is setup,
 * and setup that keeps announcing itself after it is done is noise on the
 * screen where the actual work happens.
 */

function Fact({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        aria-hidden
        className={cn(
          'mt-[0.4em] inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          ok ? 'bg-accent' : 'bg-warn',
        )}
      />
      <span className={ok ? 'text-ink-60' : 'text-ink-100'}>{children}</span>
    </li>
  );
}

export function WebhookPanel() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const statusKey = trpc.outreach.webhookStatus.queryKey();
  const status = useQuery(trpc.outreach.webhookStatus.queryOptions());
  const [copied, setCopied] = useState(false);

  const register = useMutation({
    ...trpc.outreach.registerWebhook.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: statusKey });
      toast('Smartlead is pointed at this environment.', {
        description: 'Replies, bounces and unsubscribes will arrive here from the next send.',
      });
    },
    onError: (e) => toastError(e),
  });

  const s = status.data;
  if (!s) return null;

  // Working, and proven working. One line, and out of the way.
  if (s.eventCount > 0 && s.registeredId !== null && s.registeredUrl === s.url) {
    return (
      <p className="text-ui-xs mb-4 text-ink-40">
        Smartlead is delivering events here &mdash; {s.eventCount.toLocaleString()} received
        {s.lastEventAt && `, last ${new Date(s.lastEventAt).toLocaleString()}`}.
      </p>
    );
  }

  const registered = s.registeredId !== null || !!s.registeredUrl;
  // A registration that names a different URL than the one we would build now:
  // the domain moved, or the secret was rotated. Smartlead is still posting
  // somewhere, just not somewhere that answers.
  const drifted = registered && !!s.url && s.registeredUrl !== s.url;

  return (
    <section className="mb-5 rounded-[var(--radius-md)] border border-dashed border-[color:var(--color-ink-20)] bg-card px-5 py-4">
      <h2 className="text-ui-md text-ink-100">
        {s.secretConfigured ? 'Smartlead is not delivering replies here yet' : 'This environment has no callback'}
      </h2>

      <ul className="text-ui-xs mt-2 flex flex-col gap-1">
        <Fact ok={s.smartleadConfigured}>
          {s.smartleadConfigured
            ? 'Smartlead is connected.'
            : 'Smartlead is not connected — add SMARTLEAD_API_KEY.'}
        </Fact>
        <Fact ok={s.secretConfigured}>
          {s.secretConfigured ? (
            'The callback endpoint is open.'
          ) : (
            <>
              No <code className="mono text-ink-100">OUTREACH_WEBHOOK_SECRET</code>, so the endpoint
              refuses every callback. Smartlead does not sign its events, so the URL is the only
              credential there is.
            </>
          )}
        </Fact>
        <Fact ok={registered && !drifted}>
          {drifted
            ? `Registered against ${s.registeredUrl}, which is no longer this environment's URL. Register again.`
            : registered
              ? `Registered with Smartlead${s.registeredId ? ` (webhook ${s.registeredId})` : ''}.`
              : 'Smartlead has not been told where to post. Nothing will ever reach this queue until it is.'}
        </Fact>
        <Fact ok={s.eventCount > 0}>
          {s.eventCount > 0
            ? `${s.eventCount.toLocaleString()} events received.`
            : 'No event has arrived yet. Until one does, an empty queue means nothing.'}
        </Fact>
      </ul>

      {s.url && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* The URL carries the secret, so it is shown deliberately and never
              logged. Copyable because registering by hand in Smartlead's own UI
              is the fallback when the API call is refused. */}
          <code className="mono min-w-0 flex-1 truncate rounded-[var(--radius-sm)] bg-inset px-2 py-1 text-[11px] text-ink-60">
            {s.url}
          </code>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(s.url ?? '').then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
            aria-label="Copy the callback URL"
            className="press text-ui-xs inline-flex items-center gap-1 text-ink-40 hover:text-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-ring)]"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={!s.secretConfigured || !s.smartleadConfigured || register.isPending}
          onClick={() => register.mutate()}
        >
          {registered ? 'Register again' : 'Register with Smartlead'}
        </Button>
        <span className="text-ui-xs text-ink-40">
          One user-level webhook covers every campaign. Sends, replies, bounces, unsubscribes and
          mailbox disconnections — opens and clicks are deliberately left off.
        </span>
      </div>
    </section>
  );
}
