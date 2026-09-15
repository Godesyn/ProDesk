import { Building2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { Badge } from '../../ui/badge';
import type { ContextOption } from './context-option';

/**
 * One context row — logo + label (+ pending/deleted status). Presentational only:
 * the trigger's click-to-upload-logo affordance is overlaid by ContextSelector
 * (it can't live in here, since this renders inside the Radix dropdown trigger
 * <button> and a nested control has its click swallowed). Port of
 * lib/src/shared/components/context_selector/context_option_item.dart.
 */
export function ContextOptionItem({
  option,
  inOverlay = true,
  iconOnly = false,
}: {
  option: ContextOption;
  inOverlay?: boolean;
  /** Collapsed sidebar: render only the logo (no label/status), centered. */
  iconOnly?: boolean;
}) {
  const size = inOverlay ? 'h-6 w-6' : 'h-9 w-9';
  const label = option.label ? option.label[0].toUpperCase() + option.label.slice(1) : '';
  const hasStatus = option.status === 'pending' || option.status === 'deleted';

  if (iconOnly) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--color-border-hairline)] bg-inset">
        {option.logoUrl ? (
          <img src={option.logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Building2 className="h-4 w-4 text-ink-40" />
        )}
      </span>
    );
  }

  return (
    <div className="flex w-full items-center gap-2.5">
      {/* Logo / avatar (display only; upload is handled by the overlay in the trigger) */}
      <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[color:var(--color-border-hairline)] bg-inset', size)}>
        {option.logoUrl ? (
          <img src={option.logoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <Building2 className={inOverlay ? 'h-3 w-3 text-ink-40' : 'h-4 w-4 text-ink-40'} />
        )}
      </span>

      {/* Label + (on the trigger) a descriptive status line */}
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-semibold text-ink-100', inOverlay ? 'text-ui-sm' : 'text-[14px] leading-tight')}>{label}</div>
        {!inOverlay && hasStatus && (
          <div className="mt-0.5 flex items-center gap-1.5">
            <StatusDot status={option.status} />
            <span className={cn('truncate text-[11px] font-medium leading-none', option.status === 'pending' ? 'text-warn' : 'text-danger')}>
              {option.status === 'pending' ? 'Pending verification' : 'Access removed'}
            </span>
          </div>
        )}
      </div>

      {/* In-overlay status badge (design-system Badge, right-aligned) */}
      {inOverlay && hasStatus && (
        <Badge variant={option.status === 'pending' ? 'warn' : 'danger'} className="shrink-0 px-1.5 py-0.5 text-[0.625rem]">
          {option.status === 'pending' ? 'Pending' : 'Removed'}
        </Badge>
      )}
    </div>
  );
}

/** Pending → softly pulsing warn dot; deleted → solid danger dot. */
function StatusDot({ status }: { status: ContextOption['status'] }) {
  if (status === 'pending') {
    return (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-warn" />
      </span>
    );
  }
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />;
}
