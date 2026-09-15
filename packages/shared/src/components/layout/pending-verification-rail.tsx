import { Hourglass } from 'lucide-react';

/**
 * Shown in place of the nav tabs while an agency is awaiting platform
 * verification (buildNavItems returns a single `pending` entry). Replaces the
 * bare "PENDING VERIFICATION" eyebrow header with a self-contained rail card
 * that explains the state and reassures the user. Warn-toned, on-brand.
 */
export function PendingVerificationRail() {
  return (
    <div className="mx-3 overflow-hidden rounded-[var(--radius-md)] border border-warn/30 bg-warn/[0.06] p-4 shadow-1">
      {/* Pulsing hourglass medallion */}
      <div className="relative mb-3 grid h-11 w-11 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-warn/20" style={{ animationDuration: '2.4s' }} />
        <span className="relative grid h-11 w-11 place-items-center rounded-full bg-warn/15 ring-1 ring-warn/30">
          <Hourglass className="h-5 w-5 text-warn" />
        </span>
      </div>

      <h3 className="text-ui-md font-semibold leading-tight text-ink-100">Pending verification</h3>
      <p className="mt-1.5 text-ui-xs leading-relaxed text-ink-60">
        Your agency is being reviewed by our team. The full workspace unlocks the moment it’s approved.
      </p>

      {/* Live status chip */}
      <div className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-warn/12 px-2 py-1">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warn" />
        </span>
        <span className="font-mono text-[0.625rem] uppercase tracking-[0.08em] text-warn">Under review</span>
      </div>

      <p className="mt-3 border-t border-warn/15 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-40">
        Reviews usually take 1–2 business days. We’ll email you as soon as you’re verified.
      </p>
    </div>
  );
}
