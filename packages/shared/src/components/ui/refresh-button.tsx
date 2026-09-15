import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from './button';
import { cn } from '../../lib/utils';

/**
 * Reusable refresh/sync control. Runs `onRefresh` (sync or async) and spins the
 * icon while it's in flight, with a short minimum so a fast refresh still reads
 * as a deliberate sync. Drop it in any header's action slot.
 */
export function RefreshButton({
  onRefresh,
  title = 'Refresh',
  label,
  variant = 'outline',
  className,
}: {
  onRefresh: () => Promise<unknown> | unknown;
  title?: string;
  /** Optional visible label next to the icon (icon-only when omitted). */
  label?: string;
  variant?: 'outline' | 'ghost' | 'accent';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await Promise.all([Promise.resolve(onRefresh()), new Promise((r) => setTimeout(r, 500))]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant={variant} size={label ? 'sm' : 'icon'} title={title} aria-label={title} disabled={busy} onClick={run} className={className}>
      <RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} />
      {label}
    </Button>
  );
}
