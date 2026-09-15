/**
 * Beta overlays — the one component every frontend mounts to get the whole beta
 * member experience. Mounted beside <PendingInvitePrompt /> in each frontend's
 * authenticated tree (enforced by scripts/check-frontend-wiring.mjs).
 *
 * It renders exactly one of three things:
 *
 *   nothing            not a beta member, OR beta is live with plenty of time left
 *   ending banner      beta live, final week — top strip with the report one click away
 *   expiry takeover    beta lapsed and not yet acknowledged — full-screen report
 *   expiry banner      beta lapsed and acknowledged — persistent top strip
 *
 * The quiet countdown (when more than a week remains) is handled by the
 * `<BetaAccessTile />` inside the feedback panel — see feedback-panel.tsx.
 *
 * WHY A BANNER RATHER THAN A HARD BLOCK: when the beta lapses, `isBetaUser()`
 * returns false, so every paid gate across the platform closes on its own — links
 * can't be created, reviews can't be captured, signatures lock, AI chat locks. The
 * app therefore becomes read-only WITHOUT any new gating code. These overlays
 * explain that state and offer the way out; they don't implement it. That's what
 * keeps the enforcement in one place (the entitlement check) instead of scattered
 * across ten frontends.
 */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Clock, Sparkles, X } from 'lucide-react';
import { useTRPC } from '../lib/trpc';
import { cn } from '../lib/utils';
import { Dialog, DialogContent } from '../components/ui/dialog';
import { BetaReport } from './beta-report';
import { betaCountdownLabel, formatBetaDate, useBetaStatus } from './use-beta-status';

export function BetaOverlays() {
  const beta = useBetaStatus();
  const [reportOpen, setReportOpen] = useState(false);

  if (!beta.ready || !beta.enrolled) return null;

  // Lapsed and never shown the report → take over the screen once. This is the
  // "when the user logs in after the beta period is finished" moment.
  if (beta.expired && !beta.acknowledged) {
    return <BetaExpiryTakeover endsAt={beta.endsAt} />;
  }

  // Quiet state (plenty of time left) — no overlay here. The countdown lives in
  // the feedback panel's BetaAccessTile instead.
  if (!beta.expired && !beta.endingSoon) return null;

  return (
    <>
      {beta.expired ? (
        <BetaBanner
          tone="expired"
          title="Your beta has ended"
          detail={
            beta.endsAt
              ? `Free access ran until ${formatBetaDate(beta.endsAt)}. Paid tools are locked until you add a card.`
              : 'Paid tools are locked until you add a card.'
          }
          cta="See what you'll pay"
          onCta={() => setReportOpen(true)}
        />
      ) : (
        <BetaBanner
          tone="ending"
          title={betaCountdownLabel(beta.daysRemaining)}
          detail={
            beta.endsAt
              ? `Add a card before ${formatBetaDate(beta.endsAt)} and nothing is interrupted.`
              : 'Add a card and nothing is interrupted.'
          }
          cta="See what you'll pay"
          onCta={() => setReportOpen(true)}
        />
      )}

      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        {/* pd-beta-scope on every surface that renders <BetaReport />: the dialog
            is portalled too, so it needs the same tokens as the takeover. */}
        <DialogContent className="pd-beta-scope max-h-[90vh] max-w-2xl overflow-y-auto">
          <BetaReport
            endsAt={beta.endsAt}
            expired={beta.expired}
            onActivated={() => setReportOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * The one-time full-screen report. Not dismissible by scrim or Escape — it's the
 * moment the member has to see — but it always offers an explicit way past, so
 * nobody is trapped: they can carry on with the paid tools locked.
 */
function BetaExpiryTakeover({ endsAt }: { endsAt: Date | null }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const acknowledge = useMutation({
    ...trpc.beta.acknowledgeExpiry.mutationOptions(),
    // `useBetaStatus` reads betaExpiryAcknowledgedAt off `auth.me` (see that hook
    // for why), so THAT is the query that has to be refreshed for the takeover to
    // step down to the banner. myStatus is invalidated too for its cohort label.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }),
        qc.invalidateQueries({ queryKey: trpc.beta.myStatus.queryKey() }),
      ]),
  });

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="pd-beta-scope fixed inset-0 z-[80] overflow-y-auto bg-paper/95 backdrop-blur-sm">
      <div className="mx-auto w-full max-w-2xl px-5 py-10 sm:py-16">
        <div className="animate-reveal rounded-[var(--radius-lg)] border border-[color:var(--color-border-hairline)] bg-card p-6 shadow-3 sm:p-8">
          <span className="mb-5 inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-accent/12 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
            <Sparkles className="h-3.5 w-3.5" />
            Thanks for testing with us
          </span>

          <BetaReport
            endsAt={endsAt}
            expired
            onActivated={() => acknowledge.mutate()}
            secondaryAction={
              <button
                type="button"
                disabled={acknowledge.isPending}
                onClick={() => acknowledge.mutate()}
                className="text-sm font-medium text-ink-40 underline-offset-4 transition-colors hover:text-ink-80 hover:underline disabled:opacity-50"
              >
                Not now — continue with paid tools locked
              </button>
            }
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Persistent top strip. Fixed rather than in-flow so it works identically in every
 * frontend's layout without any of them reserving space for it; the frontends'
 * shells all scroll under it.
 */
function BetaBanner({
  tone,
  title,
  detail,
  cta,
  onCta,
}: {
  tone: 'ending' | 'expired';
  title: string;
  detail: string;
  cta: string;
  onCta: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={cn(
        'pd-beta-scope fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 shadow-1 sm:px-6',
        tone === 'expired'
          ? 'bg-ink-100 text-paper'
          : 'bg-[color:var(--color-warn)] text-ink-100',
      )}
    >
      <Clock className="h-4 w-4 shrink-0 opacity-80" />
      <span className="text-[13px] font-semibold">{title}</span>
      <span
        className={cn(
          'min-w-0 flex-1 text-[13px]',
          tone === 'expired' ? 'text-paper/70' : 'text-ink-80',
        )}
      >
        {detail}
      </span>
      <button
        type="button"
        onClick={onCta}
        className={cn(
          'press inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] font-semibold transition-opacity hover:opacity-90',
          tone === 'expired' ? 'bg-paper text-ink-100' : 'bg-ink-100 text-paper',
        )}
      >
        {cta}
        <ArrowRight className="h-3.5 w-3.5" />
      </button>
      {/* Dismiss is per-session only (component state, nothing persisted): the
          banner returns on the next load, because the situation hasn't changed. */}
      <button
        type="button"
        aria-label="Hide for now"
        onClick={() => setHidden(true)}
        className="shrink-0 rounded-[var(--radius-sm)] p-1 opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>,
    document.body,
  );
}
