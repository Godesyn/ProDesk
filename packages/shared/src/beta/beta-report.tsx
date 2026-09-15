/**
 * The beta price report — "here's what you'll pay, pick what you keep".
 *
 * Shown in two places, same component:
 *  • as a full-screen takeover the first time a lapsed member loads any frontend,
 *  • as a dialog from the persistent banner afterwards.
 *
 * Every figure comes from `beta.myReport` (modules/beta/report.ts) — the same
 * builder that renders the reminder emails, so the inbox and the app always agree.
 * Nothing is hardcoded: prices, quantities and currency are all server-derived.
 *
 * Flow: tick the tools to keep → add a card (Stripe Elements, no redirect) →
 * activate. Activation reports per line, so a partial success is shown honestly
 * rather than collapsed into one error.
 */
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, Check, CreditCard, Loader2 } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { cn, formatPrice } from '../lib/utils';
import { toastError } from '../lib/errors';
import { StripeCardSetup } from '../components/billing/stripe-card-setup';
import { formatBetaDate } from './use-beta-status';

type ReportLine = {
  productId: string;
  productName: string;
  productSlug: string;
  unitAmount: number;
  quantity: number;
  monthlyAmount: number;
  currency: string;
  perUnit: boolean;
  unitNoun: string | null;
  usageDetail: string | null;
  alreadySubscribed: boolean;
};

export function BetaReport({
  /** The deadline, for the headline copy. Null when already past / unknown. */
  endsAt,
  /** True once the beta has lapsed — changes the framing from warning to gate. */
  expired,
  /** Called after at least one subscription went live. */
  onActivated,
  /** Rendered under the actions — e.g. "Continue with limited access". */
  secondaryAction,
}: {
  endsAt: Date | null;
  expired: boolean;
  onActivated?: () => void;
  secondaryAction?: React.ReactNode;
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const report = useQuery(trpc.beta.myReport.queryOptions());
  const card = useQuery(trpc.beta.card.queryOptions());
  const config = useQuery(trpc.beta.billingConfig.queryOptions());

  const lines = (report.data?.lines ?? []) as ReportLine[];
  const billable = useMemo(() => lines.filter((l) => !l.alreadySubscribed), [lines]);

  // Everything they used is pre-ticked: the default should be "keep working as I
  // was", not "start from nothing".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || billable.length === 0) return;
    setSelected(new Set(billable.map((l) => l.productId)));
    setSeeded(true);
  }, [billable, seeded]);

  const [showCardForm, setShowCardForm] = useState(false);
  const [outcomes, setOutcomes] = useState<
    { productName: string; status: string; error: string | null }[] | null
  >(null);

  const selectedLines = billable.filter((l) => selected.has(l.productId));
  const selectedTotal = selectedLines.reduce((s, l) => s + l.monthlyAmount, 0);
  const currency = report.data?.currency ?? 'AUD';
  const hasCard = !!card.data;

  const setupIntent = useMutation(trpc.beta.createSetupIntent.mutationOptions());
  const setDefaultCard = useMutation(trpc.beta.setDefaultCard.mutationOptions());
  const activate = useMutation(trpc.beta.activate.mutationOptions());
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  async function beginAddCard() {
    try {
      const { clientSecret: secret } = await setupIntent.mutateAsync();
      if (!secret) throw new Error('Could not start the card form.');
      setClientSecret(secret);
      setShowCardForm(true);
    } catch (err) {
      toastError(err);
    }
  }

  async function onCardSaved(paymentMethodId: string) {
    try {
      await setDefaultCard.mutateAsync({ paymentMethodId });
      setShowCardForm(false);
      setClientSecret(null);
      await qc.invalidateQueries({ queryKey: trpc.beta.card.queryKey() });
      toast.success('Card saved.');
      // The card exists purely so the selection can be charged — go straight on.
      await runActivate();
    } catch (err) {
      toastError(err);
    }
  }

  async function runActivate() {
    if (selectedLines.length === 0) {
      toast.error('Pick at least one tool to keep.');
      return;
    }
    try {
      const res = await activate.mutateAsync({
        productIds: selectedLines.map((l) => l.productId),
      });
      setOutcomes(
        res.outcomes.map((o) => ({
          productName: o.productName,
          status: o.status,
          error: o.error,
        })),
      );
      // A line that needs SCA / a different card comes back with a hosted
      // Checkout url — send them there to finish it.
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: trpc.beta.myReport.queryKey() }),
        qc.invalidateQueries({ queryKey: trpc.beta.myStatus.queryKey() }),
        // Subscribing lifts the paid gates, so every screen that asked "am I
        // entitled?" needs to re-ask. auth.me also backs useBetaStatus.
        qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
      ]);
      if (res.activatedCount > 0) {
        toast.success(
          res.activatedCount === 1
            ? 'You’re all set — 1 tool is now on your plan.'
            : `You’re all set — ${res.activatedCount} tools are now on your plan.`,
        );
        onActivated?.();
      } else {
        toast.error('Nothing could be activated. See the details below.');
      }
    } catch (err) {
      toastError(err);
    }
  }

  if (report.isLoading) {
    return (
      <div className="grid place-items-center py-16 text-sm text-ink-40">
        <Loader2 className="mb-3 h-5 w-5 animate-spin" />
        Working out your pricing…
      </div>
    );
  }

  // Nothing used means nothing owed. Say so plainly instead of showing an empty
  // table with a $0 total, which reads like an error.
  if (lines.length === 0) {
    return (
      <div className="space-y-4">
        <Headline endsAt={endsAt} expired={expired} nothingOwed />
        <p className="text-sm leading-relaxed text-ink-60">
          You haven't started using any of the paid tools yet, so there's nothing to
          pay. Everything you've set up stays exactly where it is — subscribe to any
          tool whenever you're ready.
        </p>
        {secondaryAction}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Headline endsAt={endsAt} expired={expired} />

      <ul className="divide-y divide-[color:var(--color-border-hairline)] overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card">
        {lines.map((line) => (
          <LineRow
            key={line.productId}
            line={line}
            checked={selected.has(line.productId)}
            onToggle={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(line.productId)) next.delete(line.productId);
                else next.add(line.productId);
                return next;
              })
            }
          />
        ))}

        <li className="flex items-baseline justify-between gap-4 bg-inset px-4 py-3.5">
          <span className="text-sm font-semibold text-ink-100">
            {selectedLines.length === billable.length
              ? 'Total per month'
              : `Selected total (${selectedLines.length} of ${billable.length})`}
          </span>
          <span className="text-lg font-bold tabular-nums text-ink-100">
            {formatPrice(selectedTotal, currency)}
            <span className="ml-1 text-xs font-medium text-ink-40">/month</span>
          </span>
        </li>
      </ul>

      <p className="text-xs leading-relaxed text-ink-40">
        Usage-based tools are billed on what's live at the time — the quantities
        above are today's. Cancel any tool from your Subscriptions tab at any point;
        you're never charged for a tool you don't keep.
      </p>

      {outcomes && <Outcomes outcomes={outcomes} />}

      {/* Actions */}
      {showCardForm && clientSecret && config.data?.publishableKey ? (
        <div className="rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] bg-card p-4">
          <p className="mb-3 text-sm font-medium text-ink-100">
            Add a card — you'll be charged {formatPrice(selectedTotal, currency)} a
            month{endsAt && !expired ? `, starting ${formatBetaDate(endsAt)}` : ''}.
          </p>
          <StripeCardSetup
            publishableKey={config.data.publishableKey}
            clientSecret={clientSecret}
            onSaved={onCardSaved}
            onError={(m) => toast.error(m)}
            submitLabel="Save card & continue"
            submitClassName="press inline-flex h-10 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-semibold text-ink-100 transition-colors hover:bg-accent-hover disabled:opacity-40"
          />
          <button
            type="button"
            onClick={() => {
              setShowCardForm(false);
              setClientSecret(null);
            }}
            className="mt-3 text-xs font-medium text-ink-40 underline-offset-4 hover:text-ink-80 hover:underline"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={
              selectedLines.length === 0 || activate.isPending || setupIntent.isPending
            }
            onClick={() => void (hasCard ? runActivate() : beginAddCard())}
            className={cn(
              'press inline-flex h-11 items-center gap-2 rounded-[var(--radius-sm)] px-5',
              // Ink on accent, not white — see the note in feedback-panel.tsx: white
              // on the Forest accent is ~3.2:1 and fails AA at this size.
              'bg-accent text-sm font-semibold text-ink-100 transition-colors hover:bg-accent-hover',
              'disabled:pointer-events-none disabled:opacity-40',
            )}
          >
            {activate.isPending || setupIntent.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CreditCard className="h-4 w-4" />
            )}
            {hasCard
              ? `Keep ${selectedLines.length === 1 ? 'this tool' : 'these tools'}`
              : 'Add a card & continue'}
          </button>

          {hasCard && card.data && (
            <span className="text-xs text-ink-40">
              Charging {card.data.brand} •••• {card.data.last4}
            </span>
          )}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

function Headline({
  endsAt,
  expired,
  nothingOwed = false,
}: {
  endsAt: Date | null;
  expired: boolean;
  nothingOwed?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
        {expired ? 'Beta ended' : 'Beta ending'}
      </p>
      <h2 className="mt-1.5 text-[22px] font-bold leading-tight text-ink-100">
        {nothingOwed
          ? expired
            ? 'Your beta has ended'
            : 'Your beta is ending'
          : expired
            ? 'Your beta has ended — here’s what you’d pay to carry on'
            : 'Here’s what you’ll pay when your beta ends'}
      </h2>
      {endsAt && (
        <p className="mt-1.5 text-sm text-ink-60">
          {expired
            ? `Free access ran until ${formatBetaDate(endsAt)}.`
            : `Free access runs until ${formatBetaDate(endsAt)}. The first charge is taken then — not today.`}
        </p>
      )}
    </div>
  );
}

function LineRow({
  line,
  checked,
  onToggle,
}: {
  line: ReportLine;
  checked: boolean;
  onToggle: () => void;
}) {
  const rate = line.perUnit
    ? `${formatPrice(line.unitAmount, line.currency)} × ${line.quantity} ${line.unitNoun ?? 'unit'}${line.quantity === 1 ? '' : 's'}`
    : `${formatPrice(line.unitAmount, line.currency)} / month`;

  // An already-paid tool isn't a choice — it's shown as covered so the report is a
  // complete picture, but it can't be toggled and isn't in the total.
  if (line.alreadySubscribed) {
    return (
      <li className="flex items-center gap-3 px-4 py-3.5">
        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-sm)] bg-accent text-white">
          <Check className="h-3 w-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-100">{line.productName}</p>
          <p className="mt-0.5 text-xs text-ink-40">
            {rate}
            {line.usageDetail ? ` · ${line.usageDetail}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold text-accent">Already active</span>
      </li>
    );
  }

  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-inset/60">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="h-4 w-4 shrink-0 accent-[color:var(--color-accent)]"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink-100">{line.productName}</p>
          <p className="mt-0.5 text-xs text-ink-40">
            {rate}
            {line.usageDetail ? ` · ${line.usageDetail}` : ''}
          </p>
        </div>
        <span
          className={cn(
            'shrink-0 text-sm font-semibold tabular-nums transition-opacity',
            checked ? 'text-ink-100' : 'text-ink-40 opacity-60',
          )}
        >
          {formatPrice(line.monthlyAmount, line.currency)}
        </span>
      </label>
    </li>
  );
}

/** Per-line activation results — shown only when something didn't go through. */
function Outcomes({
  outcomes,
}: {
  outcomes: { productName: string; status: string; error: string | null }[];
}) {
  const failed = outcomes.filter((o) => o.status === 'failed');
  if (failed.length === 0) return null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-[color:var(--color-danger)] bg-[color:var(--color-danger)]/8 p-3.5">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[color:var(--color-danger)]">
        <AlertCircle className="h-4 w-4" />
        {failed.length === 1
          ? 'One tool could not be activated'
          : `${failed.length} tools could not be activated`}
      </p>
      <ul className="space-y-1">
        {failed.map((o) => (
          <li key={o.productName} className="text-xs leading-relaxed text-ink-80">
            <span className="font-medium">{o.productName}</span>
            {o.error ? ` — ${o.error}` : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}
