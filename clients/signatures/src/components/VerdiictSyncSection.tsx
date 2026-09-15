/**
 * VerdiictSyncSection — brand-level "Sync from Verdiict" picker.
 *
 * Lists every brand the signed-in user can reach (owns, or is active staff of
 * with a reviews permission) that has a Verdiict presence, via
 * `reviews.directory.listMine`. Selecting a brand writes its "Get a Review"
 * (/r/:slug — anchored to the brand's primary location, since reviews are
 * captured per location) and "See our Reviews" (/directory/:brandSlug/:locationSlug —
 * directory profile) URLs back through `onSync`. Used by the main signature
 * editor (Home) and the brand / member editors (Brands) so all three share one
 * flow. Self-fetching: it owns its query so hosts only wire the URL value +
 * onSync/onClear callbacks.
 */
import { useState, useMemo } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { trpc } from '@/lib/trpc';
import { LazyImage } from '@shared/components/ui/lazy-image';
import { PRODESK_ORIGINS, originUrl } from '@shared/lib/origins';
import { useCrossAppOpen } from '@shared/auth/use-cross-app';

interface VerdiictSyncSectionProps {
  /** Current "Get a Review" URL — used to detect the currently-synced brand. */
  verdiictUrl: string;
  /** Called with the review + directory URLs when a brand is picked. */
  onSync: (reviewUrl: string, directoryUrl: string) => void;
  /** Called when the user clears the synced brand. */
  onClear: () => void;
  /** Optional helper line above the picker (context-specific copy). */
  description?: string;
  /**
   * Render the popover as modal. REQUIRED when this lives inside a Radix Dialog:
   * a modal Dialog sets `pointer-events: none` on <body>, and the popover content
   * is portaled to <body>, so a non-modal (default) popover's rows render but
   * ignore clicks. A modal popover registers a top dismissable layer that
   * re-enables pointer events on its own content. Leave false outside dialogs.
   */
  modal?: boolean;
}

export function VerdiictSyncSection({ verdiictUrl, onSync, onClear, description, modal = false }: VerdiictSyncSectionProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const openCrossApp = useCrossAppOpen();

  const { data: businesses, isLoading, isError } = trpc.reviews.directory.listMine.useQuery(undefined, {
    retry: 1,
    refetchOnWindowFocus: true,
  });

  const reviewsOrigin = PRODESK_ORIGINS.reviews;

  // Derive which brand is currently synced by matching the /r/ slug in the URL
  // against each brand's representative review (location) slug.
  const syncedSlug = useMemo(() => {
    if (!verdiictUrl) return null;
    const match = verdiictUrl.match(/\/r\/([^/?#]+)/);
    return match?.[1] ?? null;
  }, [verdiictUrl]);

  const syncedBusiness = useMemo(() => {
    if (!syncedSlug || !businesses) return null;
    return businesses.find((b: { reviewSlug: string }) => b.reviewSlug === syncedSlug) ?? null;
  }, [syncedSlug, businesses]);

  function handleSelect(biz: { reviewSlug: string; directoryPath: string | null }) {
    const base = originUrl(reviewsOrigin);
    const reviewUrl = `${base}/r/${biz.reviewSlug}`;
    // Only a LOCATION listed in the directory has a "See our Reviews" page, and
    // the API hands back its canonical path — never rebuild it from a slug.
    const directoryUrl = biz.directoryPath ? `${base}${biz.directoryPath}` : '';
    onSync(reviewUrl, directoryUrl);
    setPopoverOpen(false);
  }

  // Currently synced state
  if (syncedBusiness) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 p-2.5 rounded-lg bg-emerald-50 border border-emerald-200">
          <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden bg-muted border border-border">
            {syncedBusiness.logoUrl ? (
              <LazyImage src={syncedBusiness.logoUrl} alt={syncedBusiness.brandName} wrapperClassName="w-full h-full" className="object-cover" />
            ) : (
              <span className="text-xs font-bold text-muted-foreground">{syncedBusiness.brandName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">{syncedBusiness.brandName}</p>
            <p className="text-[10px] text-emerald-700">Synced from Verdiict</p>
          </div>
          <button
            onClick={onClear}
            className="text-[11px] text-muted-foreground hover:text-foreground underline underline-offset-2 flex-shrink-0"
          >
            Clear
          </button>
        </div>
      </div>
    );
  }

  // Sync dropdown
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground leading-relaxed">
        {description ?? 'Sync a Verdiict business to show review CTAs in your signature.'}
      </p>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen} modal={modal}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Sync from Verdiict
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-0">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-foreground">Select a business</p>
          </div>
          <div className="max-h-56 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {isError && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-muted-foreground">
                  Could not load businesses. Set up Verdiict first.
                </p>
                <button
                  onClick={() => {
                    openCrossApp(PRODESK_ORIGINS.reviews, '/', { newWindow: true });
                    setPopoverOpen(false);
                  }}
                  className="text-xs text-accent underline mt-1 inline-block bg-transparent border-0 p-0 text-left cursor-pointer"
                >
                  Open Verdiict →
                </button>
              </div>
            )}
            {!isLoading && !isError && businesses && businesses.length === 0 && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-muted-foreground">No businesses found.</p>
                <button
                  onClick={() => {
                    openCrossApp(PRODESK_ORIGINS.reviews, '/', { newWindow: true });
                    setPopoverOpen(false);
                  }}
                  className="text-xs text-accent underline mt-1 inline-block bg-transparent border-0 p-0 text-left cursor-pointer"
                >
                  Create one in Verdiict →
                </button>
              </div>
            )}
            {!isLoading && !isError && businesses && businesses.length > 0 && (
              <div className="py-1">
                {businesses.map((biz) => {
                  const displayName = (biz as any).locationName && (biz as any).brandName !== (biz as any).locationName
                    ? `${biz.brandName} (${(biz as any).locationName})`
                    : biz.brandName;
                  return (
                    <button
                      key={(biz as any).locationId || biz.brandId}
                      onClick={() => handleSelect(biz)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-secondary/60 transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 overflow-hidden bg-muted border border-border">
                        {biz.logoUrl ? (
                          <img src={biz.logoUrl} alt={displayName} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xs font-bold text-muted-foreground">{displayName.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{displayName}</p>
                        {!biz.directoryPath && (
                          <p className="text-[10px] text-muted-foreground truncate">Review link only · this location isn't listed</p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
