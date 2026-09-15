import { useEffect, useState, type ReactNode } from 'react';
import { Play } from 'lucide-react';
import { cn } from '../../lib/utils';
import { posterFor, inferVideoAspectRatio } from '../../pages/marketplace/media';
import { LazyImage } from './lazy-image';

/**
 * AppItemCard — 1:1 port of `lib/src/shared/components/app_item_card.dart`.
 *
 * A media-tile card used across the marketplace (services, packages, agency
 * catalog). The artwork fills the card; on desktop the name + price sit on a
 * dark gradient overlay at the bottom, while on mobile (< 600px) they drop into
 * a solid card-surface bar beneath the media. Hover lifts the card 1px and
 * swaps shadow-1 → shadow-2 + hairline → default border (brand click curve).
 *
 * Sizing mirrors Flutter: the card is image-shaped — its aspect ratio tracks
 * the artwork, clamped to [3/4 .. 4/3] (`marketplaceMin/MaxHeightWidthAspect`),
 * defaulting to 4/3 when unknown. Drop it in a width-constrained cell/rail and
 * the height follows from the aspect.
 */

/** consideredWidthForMobile (widget_constants.dart). */
const MOBILE_BREAKPOINT = 600;
/** marketplaceMin/MaxHeightWidthAspect (widget_constants.dart): 3/4 .. 4/3. */
const MIN_ASPECT = 3 / 4;
const MAX_ASPECT = 4 / 3;
/** marketplaceCardHeightRatioWeb/Mobile (widget_constants.dart): 0.4 of the viewport. */
const RAIL_HEIGHT = '40vh';
/** mobileContentHeight (app_item_card.dart): the solid name/price bar height. */
const MOBILE_BAR = 60;
/** Height reserved below the media for trailing actions (Edit button + padding). */
const TRAILING_HEIGHT = 44;

/** Tracks the < 600px mobile breakpoint used by the Flutter MediaQuery checks. */
function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = () => setIsMobile(mq.matches);
    handler();
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}

export interface AppItemCardProps {
  name: string;
  priceText: string;
  imageUrl?: string | null;
  imageAspectRatio?: number | null;
  videoUrl?: string | null;
  onTap: () => void;
  /**
   * Absolutely-positioned badge nodes layered over the media (purchased / type
   * chips, favourite button). `isPlaying` mirrors the Flutter signature and is
   * always false on web (no inline playback).
   */
  badges?: (isPlaying: boolean) => ReactNode;
  /** Buttons rendered below the media (e.g. an Edit action in the catalog). */
  trailingActions?: ReactNode;
  /**
   * `grid` (default): the tile fills its width-constrained cell and its height
   * follows from the artwork aspect. `square`: like `grid`, but the media is
   * forced to a 1:1 box and the artwork cover-fills it (no letterboxing), so a
   * grid of cards is perfectly uniform. `rail`: the tile fills a FIXED height
   * (`40vh`) and its WIDTH follows from the aspect — the Flutter marketplace
   * model (fixed-height horizontal ListView, variable-width cards), so a row of
   * cards shares one height with tops AND bottoms aligned.
   */
  layout?: 'grid' | 'square' | 'rail';
}

export function AppItemCard({
  name,
  priceText,
  imageUrl,
  imageAspectRatio,
  videoUrl,
  onTap,
  badges,
  trailingActions,
  layout = 'grid',
}: AppItemCardProps) {
  const isMobile = useIsMobile();
  const hasVideo = !!videoUrl;
  // Poster = explicit cover, else the derived video thumbnail (YouTube /
  // backend `_thumbnail.jpg`). This is what replaces the perpetual shimmer.
  const poster = posterFor(imageUrl, videoUrl);

  // The artwork aspect is clamped to the marketplace band [3/4 .. 4/3]. When no
  // cover ratio is stored we measure the decoded poster on load (Flutter
  // `_getNetworkImageInfo`), falling back to the inferred video ratio (16/9
  // YouTube · 4/3 uploaded) and finally landscape 4/3 so the tile is never
  // mis-shaped while measuring.
  const [measured, setMeasured] = useState<number | null>(null);
  const ratio = imageAspectRatio ?? measured ?? inferVideoAspectRatio(videoUrl) ?? MAX_ASPECT;
  const aspect = Math.min(MAX_ASPECT, Math.max(MIN_ASPECT, ratio));

  const isRail = layout === 'rail';
  const isSquare = layout === 'square';
  // Rail: fixed height, width = clamped-aspect × media height (Flutter
  // `_buildAImage`, which sizes off the Expanded media — i.e. the card height
  // minus the mobile name/price bar and any trailing actions row). On mobile the
  // rail height is reduced so cards aren't ~40vh tall on a phone (more density).
  const railHeight = isMobile ? '30vh' : RAIL_HEIGHT;
  const reserved = (isMobile ? MOBILE_BAR : 0) + (trailingActions != null ? TRAILING_HEIGHT : 0);
  const railWidth = `calc((${railHeight} - ${reserved}px) * ${aspect})`;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap();
        }
      }}
      className={cn(
        'group flex cursor-pointer select-none flex-col overflow-hidden bg-card text-left',
        'rounded-[var(--radius-md)] border border-[color:var(--color-border-hairline)] shadow-1',
        'transition-[transform,box-shadow,border-color] duration-[240ms] ease-[var(--ease-click)]',
        'hover:-translate-y-px hover:border-[color:var(--color-border-default)] hover:shadow-2',
        'focus-visible:outline-none focus-visible:shadow-[var(--shadow-focus)]',
        isRail ? 'shrink-0' : 'w-full',
      )}
      style={isRail ? { height: railHeight, width: railWidth } : undefined}
    >
      {/* Media stack — fills the card; content overlays on desktop. In grid mode
          the media is aspect-shaped; in rail mode it fills the fixed height. */}
      <div
        className={cn('relative overflow-hidden bg-inset', isRail ? 'min-h-0 flex-1' : 'w-full')}
        style={isRail ? undefined : { aspectRatio: isSquare ? '1' : String(aspect) }}
      >
        <Media
          hasVideo={hasVideo}
          poster={poster}
          name={name}
          isMobile={isMobile}
          onMeasure={imageAspectRatio == null ? setMeasured : undefined}
        />

        {/* Readability gradient (desktop only): transparent → ink @ 70%. */}
        {!isMobile && (
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(to bottom, rgba(14,14,12,0) 30%, rgba(14,14,12,0.7) 100%)',
            }}
          />
        )}

        {/* Consumer badges (purchased / type / favourite). */}
        {badges?.(false)}

        {/* Desktop: name + price overlaid at the bottom. */}
        {!isMobile && <ContentInfo name={name} priceText={priceText} isMobile={false} />}
      </div>

      {/* Mobile: name + price in a solid bar below the media. In rail mode it's
          pinned to MOBILE_BAR so the fixed-height width maths stays exact. */}
      {isMobile && (
        <div className="bg-card" style={isRail ? { height: MOBILE_BAR } : undefined}>
          <ContentInfo name={name} priceText={priceText} isMobile />
        </div>
      )}

      {trailingActions != null && <div className="px-3 py-1.5">{trailingActions}</div>}
    </div>
  );
}

function Media({
  hasVideo,
  poster,
  name,
  isMobile,
  onMeasure,
}: {
  hasVideo: boolean;
  poster: string | null;
  name: string;
  isMobile: boolean;
  /** Reports the decoded poster's aspect ratio (w/h) when no ratio is stored. */
  onMeasure?: (ratio: number) => void;
}) {
  return (
    <>
      <LazyImage
        src={poster}
        alt={name}
        onMeasure={onMeasure}
        wrapperClassName="absolute inset-0 w-full h-full"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {hasVideo && (
        <>
          {/* Video darkening wash (black 0.1 → 0.3). */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.3))' }}
          />
          {/* Centered play affordance. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div
              className={cn(
                'grid place-items-center rounded-full bg-white/90 shadow-[0_4px_16px_rgba(0,0,0,0.2)]',
                isMobile ? 'h-4 w-4' : 'h-14 w-14',
              )}
            >
              <Play className={cn('fill-black/80 text-black/80', isMobile ? 'h-2.5 w-2.5' : 'h-9 w-9')} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

function ContentInfo({
  name,
  priceText,
  isMobile,
}: {
  name: string;
  priceText: string;
  isMobile: boolean;
}) {
  const shadow = isMobile ? undefined : '0 0 4px rgba(0,0,0,0.5)';
  return (
    <div
      className={cn(
        'flex flex-col',
        isMobile ? 'p-2.5' : 'absolute inset-x-0 bottom-0 p-3',
      )}
    >
      <span
        className={cn(
          'overflow-hidden font-sans font-semibold',
          isMobile ? 'truncate text-ink-100' : 'line-clamp-2 text-white',
        )}
        style={{
          fontSize: isMobile ? 13 : 14,
          lineHeight: 1.4,
          letterSpacing: isMobile ? '-0.13px' : '-0.14px',
          textShadow: shadow,
        }}
      >
        {name}
      </span>
      <span
        className={cn('mt-1 truncate font-mono', isMobile ? 'text-ink-60' : 'text-white/85')}
        style={{
          fontSize: isMobile ? 10 : 11,
          letterSpacing: '0.5px',
          textShadow: shadow,
        }}
      >
        {priceText}
      </span>
    </div>
  );
}
