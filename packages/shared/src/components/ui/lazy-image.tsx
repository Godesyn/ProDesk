import * as React from 'react';
import { useState, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { ImageOff } from 'lucide-react';

export interface LazyImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'style' | 'src'> {
  src?: string | null;
  style?: React.CSSProperties;
  wrapperClassName?: string;
  wrapperStyle?: React.CSSProperties;
  imgClassName?: string;
  imgStyle?: React.CSSProperties;
  fallback?: React.ReactNode;
  fallbackClassName?: string;
  fallbackStyle?: React.CSSProperties;
  onMeasure?: (aspectRatio: number) => void;
  showShimmerOnly?: boolean;
}

export function LazyImage({
  src,
  alt = '',
  className,
  style,
  wrapperClassName,
  wrapperStyle,
  imgClassName,
  imgStyle,
  fallback,
  fallbackClassName,
  fallbackStyle,
  onLoad,
  onError,
  onMeasure,
  showShimmerOnly = false,
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Reset loading/error states when src changes
  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [src]);

  // Sync cache hits immediately on mount or src change
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && src) {
      handleLoad();
    }
  }, [src]);

  const handleLoad = (e?: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setIsLoaded(true);
    setHasError(false);
    if (onLoad && e) {
      onLoad(e);
    }
    if (onMeasure && imgRef.current) {
      const { naturalWidth, naturalHeight } = imgRef.current;
      if (naturalWidth > 0 && naturalHeight > 0) {
        onMeasure(naturalWidth / naturalHeight);
      }
    }
  };

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setHasError(true);
    if (onError) {
      onError(e);
    }
  };

  const displayFallback = hasError || !src;
  const showShimmer = !isLoaded && !displayFallback && !showShimmerOnly;

  return (
    <div
      className={cn('relative overflow-hidden', wrapperClassName)}
      style={{
        ...wrapperStyle,
        ...style, // allow standard style prop to bind to wrapper for easier transition of legacy code
      }}
    >
      {/* Shimmer loading overlay */}
      {(showShimmer || showShimmerOnly) && (
        <div
          className="absolute inset-0 pd-shimmer"
          aria-hidden="true"
        />
      )}

      {/* Fallback / Error state */}
      {displayFallback ? (
        fallback !== undefined ? (
          fallback
        ) : (
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center bg-inset text-ink-40/50',
              fallbackClassName
            )}
            style={{
              backgroundColor: 'var(--color-inset)',
              color: 'var(--color-ink-40)',
              opacity: 0.5,
              width: '100%',
              height: '100%',
              ...fallbackStyle,
            }}
          >
            <ImageOff className="w-1/3 h-1/3 min-w-[16px] min-h-[16px] max-w-[48px] max-h-[48px]" />
          </div>
        )
      ) : (
        /* Image element */
        !showShimmerOnly && (
          <img
            ref={imgRef}
            src={src || undefined}
            alt={alt}
            onLoad={handleLoad}
            onError={handleError}
            className={cn(
              'w-full h-full object-cover transition-opacity duration-300',
              isLoaded ? 'opacity-100' : 'opacity-0',
              imgClassName,
              className // allow standard className to apply to img styles if wrapper is styled via wrapperClassName
            )}
            style={imgStyle}
            {...props}
          />
        )
      )}
    </div>
  );
}
