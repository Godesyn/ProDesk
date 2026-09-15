import { CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { type UploadProgress } from '../lib/storage';

/**
 * Compression / upload progress indicator — the web counterpart of the Flutter
 * media-upload progress widgets (MediaAssetsSection / CustomFieldUploadProgressIndicator).
 *
 * - `compressing` → determinate bar + "Compressing Video… X%"
 * - `uploading`   → indeterminate bar + "Uploading…"
 * - `done`        → green check + "Video processing complete"
 *
 * Renders nothing when `progress` is null.
 */
export function UploadProgressBar({ progress, className }: { progress: UploadProgress | null; className?: string }) {
  if (!progress) return null;

  if (progress.phase === 'done') {
    return (
      <div className={cn('flex items-center gap-1.5 text-xs font-medium text-emerald-600', className)}>
        <CheckCircle2 className="h-4 w-4" />
        Video processing complete
      </div>
    );
  }

  const compressing = progress.phase === 'compressing';
  const pct = Math.round(progress.progress * 100);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between text-xs text-ink-60">
        <span>{compressing ? 'Compressing Video…' : 'Uploading…'}</span>
        {compressing && <span className="font-semibold text-ink-80">{pct}%</span>}
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-20">
        {compressing ? (
          <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
        )}
      </div>
    </div>
  );
}
