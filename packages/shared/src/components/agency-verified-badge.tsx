import { BadgeCheck } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The platform-verified mark shown beside an agency's name. An agency is
 * platform-verified when it's a Prodesk-curated/default agency (`platformVerified`,
 * formerly `isDefault`). Centralizes the badge so every surface — marketplace,
 * storefront, brand agencies list, agency profile — renders it identically.
 *
 * Renders nothing when the agency isn't platform-verified.
 */
export function AgencyVerifiedBadge({
  platformVerified,
  className,
}: {
  platformVerified?: boolean | null;
  className?: string;
}) {
  if (!platformVerified) return null;
  return (
    <BadgeCheck
      className={cn('h-4 w-4 shrink-0 text-accent', className)}
      aria-label="Platform verified"
    />
  );
}
