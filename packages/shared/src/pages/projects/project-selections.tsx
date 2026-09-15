import { cn } from '../../lib/utils';

/**
 * Compact read-only display of the variant (selected options) and add-ons the
 * brand chose when ordering. `selectedOptions` is the option→choice map that
 * defines the variant (e.g. { Size: 'Large' }); `selectedAddons` is the list of
 * chosen add-on snapshots. Shown to everyone — brand, agency, and the assigned
 * contractor — so the production side knows the exact scope of work. Renders
 * nothing when there is no variant and no add-on.
 */
export function ProjectSelections({
  options,
  addons,
  className,
}: {
  options?: Record<string, string> | null;
  addons?: unknown[] | null;
  className?: string;
}) {
  const opts = options ? Object.entries(options).filter(([, v]) => v != null && String(v).trim() !== '') : [];
  const adds = Array.isArray(addons)
    ? (addons as { name?: string | null }[]).map((a) => a?.name).filter((n): n is string => !!n && n.trim() !== '')
    : [];
  if (opts.length === 0 && adds.length === 0) return null;

  const chip = 'inline-flex items-center rounded-[6px] bg-inset px-2.5 py-1 text-[13px] text-ink-100';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {opts.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-ink-60">Variant:</span>
          {opts.map(([k, v]) => (
            <span key={k} className={chip}><span className="text-ink-60">{k}:</span>&nbsp;{v}</span>
          ))}
        </div>
      )}
      {adds.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-ink-60">Add-ons:</span>
          {adds.map((n, i) => (
            <span key={i} className={cn(chip, 'bg-accent/10 text-accent')}>{n}</span>
          ))}
        </div>
      )}
    </div>
  );
}
