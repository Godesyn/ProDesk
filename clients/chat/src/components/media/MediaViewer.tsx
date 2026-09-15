import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useTRPC } from '@shared/lib/trpc';
import { useLocation } from 'wouter';
import { Spec } from '../primitives';
import { clockTime, fileSize } from '../../lib/format';
import { downloadFile } from '@shared/lib/download';
import { mediaSearch } from '../../app/routes';

/**
 * The lightbox.
 *
 * Driven entirely by `?v=<messageId>` in the URL, which is the point: the browser
 * Back button CLOSES it rather than leaving the conversation. That single defect —
 * Back exiting the thread instead of dismissing the image — is the most reported
 * bug class in web messengers, and it is free to avoid if the viewer is a route
 * rather than a piece of component state.
 *
 * THREE THINGS IT DOES THAT THE FIRST VERSION DID NOT, and each fixes a way the
 * old one stopped short of actually letting you look at what you were sent:
 *
 *  1. It walks EVERY picture in the conversation, not the thirty-odd messages
 *     the transcript happens to have loaded. It reads the same paginated
 *     attachment query the Media tab does, so arrows keep going back through
 *     years and the two surfaces share one cache.
 *  2. It ZOOMS. A screenshot of a spreadsheet fitted to a phone screen is not
 *     legible, and "view it properly, with detail" is the entire reason someone
 *     opens a picture rather than reading the bubble. Wheel and pinch to scale,
 *     drag to pan, double-tap to toggle.
 *  3. Download SAVES the file (lib/download.ts) instead of opening it in a tab,
 *     and there is real fullscreen for the case where even the chrome is in the
 *     way.
 *
 * The chrome hides itself while you are zoomed in, because at that point the
 * picture is the whole point and a header over it is furniture.
 */

/** Pages to walk looking for a message that isn't in the newest page. */
const MAX_SEEK_PAGES = 8;
const MAX_SCALE = 6;

export function MediaViewer({
  threadId,
  messageId,
  onClose,
}: {
  threadId: string;
  messageId: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const [, navigate] = useLocation();

  /**
   * The same query, with the same input, that the detail sheet's Media tab uses
   * — so opening the lightbox from there costs no network at all, and paging
   * here fills the grid behind it.
   */
  const mediaQuery = useInfiniteQuery(
    trpc.chat.threadAttachments.infiniteQueryOptions(
      { threadId, kind: 'media', limit: 48 },
      { getNextPageParam: (last) => last.nextCursor ?? undefined },
    ),
  );

  // Newest-first from the server; oldest-first here, so ← and → mean what they
  // mean in the transcript.
  const media = (mediaQuery.data?.pages.flatMap((p) => p.items) ?? []).slice().reverse();
  const index = media.findIndex((m) => m.id === messageId);
  const current = index >= 0 ? media[index] : null;

  /**
   * Keep paging while the message we were asked to show is still further back.
   * Bounded, because a thread with fifty thousand pictures and a stale link
   * should give up rather than walk the archive.
   */
  const seeks = useRef(0);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = mediaQuery;
  useEffect(() => {
    if (current || !hasNextPage || isFetchingNextPage) return;
    if (seeks.current >= MAX_SEEK_PAGES) return;
    seeks.current += 1;
    void fetchNextPage();
    // Destructured, not `mediaQuery`: the query object is a new identity every
    // render, so depending on it would re-run this on every render and let the
    // seek counter climb for reasons that have nothing to do with seeking.
  }, [current, hasNextPage, isFetchingNextPage, fetchNextPage]);

  useEffect(() => {
    seeks.current = 0;
  }, [threadId]);

  const go = useCallback(
    (delta: number) => {
      const next = media[index + delta];
      if (next) navigate(`${window.location.pathname}?${mediaSearch(next.id)}`, { replace: true });
      // Reaching the oldest loaded picture while there is more history is a
      // reason to fetch, not a wall.
      if (delta < 0 && index <= 0 && hasNextPage) void fetchNextPage();
    },
    [index, media, navigate, hasNextPage, fetchNextPage],
  );

  const zoom = useZoomPan(messageId);
  const [fullscreen, setFullscreen] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    // Best-effort: iOS Safari has no element fullscreen, so the button simply
    // does nothing there rather than throwing. The viewer is already
    // edge-to-edge, so nothing is lost.
    else void shell.current?.requestFullscreen?.().catch(() => {});
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape unwinds one layer at a time: zoom, then fullscreen, then the
        // viewer. Closing the lot on the first press is how people lose the
        // conversation they were in.
        if (zoom.scale > 1) return zoom.reset();
        if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {});
        return onClose();
      }
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
      if (e.key === '0') zoom.reset();
      if (e.key === '+' || e.key === '=') zoom.nudge(1);
      if (e.key === '-') zoom.nudge(-1);
      if (e.key.toLowerCase() === 'f') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!current?.fileUrl) {
    // Still walking back to find it — say so rather than rendering nothing,
    // which reads as a broken tap.
    if (mediaQuery.isFetching) {
      return (
        <div
          className="fixed inset-0 z-[60] grid place-items-center"
          style={{ background: 'color-mix(in srgb, var(--room) 96%, black)' }}
        >
          <Spec>Finding it…</Spec>
        </div>
      );
    }
    return null;
  }

  const isVideo = current.type === 'video';
  const zoomed = zoom.scale > 1;

  return (
    <div
      ref={shell}
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: 'color-mix(in srgb, var(--room) 96%, black)' }}
      role="dialog"
      aria-modal="true"
      aria-label={current.fileName ?? 'Attachment'}
    >
      {/* The chrome fades out while zoomed rather than unmounting, so the
          controls are one pointer-move away and nothing reflows. */}
      <header
        className="flex shrink-0 items-center gap-2 px-3 py-3 transition-opacity sm:px-4"
        style={{
          opacity: zoomed ? 0 : 1,
          pointerEvents: zoomed ? 'none' : 'auto',
          paddingTop: 'calc(0.75rem + env(safe-area-inset-top, 0px))',
        }}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px]" style={{ color: 'var(--voice)' }}>
            {current.fileName ?? current.senderName ?? 'Attachment'}
          </span>
          <Spec>
            {[
              current.senderName,
              clockTime(current.timestamp),
              current.fileSize ? fileSize(current.fileSize) : '',
              media.length > 1 ? `${index + 1} of ${media.length}${mediaQuery.hasNextPage ? '+' : ''}` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </Spec>
        </span>

        {!isVideo && (
          <>
            <ChromeButton label="Zoom out" onClick={() => zoom.nudge(-1)} disabled={zoom.scale <= 1}>
              <ZoomOut className="h-4 w-4" />
            </ChromeButton>
            <ChromeButton label="Zoom in" onClick={() => zoom.nudge(1)} disabled={zoom.scale >= MAX_SCALE}>
              <ZoomIn className="h-4 w-4" />
            </ChromeButton>
          </>
        )}
        <ChromeButton
          label={fullscreen ? 'Exit full screen' : 'Full screen'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </ChromeButton>
        <ChromeButton
          label="Download"
          onClick={() => void downloadFile(current.fileUrl ?? '', current.fileName)}
        >
          <Download className="h-4 w-4" />
        </ChromeButton>
        <ChromeButton label="Close" onClick={onClose}>
          <X className="h-4 w-4" />
        </ChromeButton>
      </header>

      <div
        ref={stage}
        className="relative flex min-h-0 flex-1 touch-none select-none items-center justify-center overflow-hidden px-2 pb-4 sm:px-4"
        onDoubleClick={zoom.toggle}
        onWheel={zoom.onWheel}
        onPointerDown={zoom.onPointerDown}
        onPointerMove={zoom.onPointerMove}
        onPointerUp={(e) => {
          const swipe = zoom.onPointerUp(e);
          // A flick is only navigation when there is nothing to pan. Zoomed in,
          // the same gesture is how you move around the picture.
          if (swipe === 'left') go(1);
          if (swipe === 'right') go(-1);
        }}
        onPointerCancel={zoom.onPointerUp}
        onClick={(e) => {
          // Click the surround to dismiss — but never while zoomed, where a
          // stray click at the end of a pan would close the thing you are
          // examining.
          if (!zoomed && e.target === e.currentTarget) onClose();
        }}
      >
        {isVideo ? (
          <video
            key={current.id}
            src={current.fileUrl}
            poster={current.thumbnailUrl ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-full max-w-full"
            style={{ borderRadius: 'var(--radius-md)' }}
          />
        ) : (
          <img
            key={current.id}
            src={current.fileUrl}
            alt={current.fileName ?? ''}
            draggable={false}
            className="max-h-full max-w-full object-contain"
            style={{
              borderRadius: zoomed ? 0 : 'var(--radius-md)',
              transform: `translate3d(${zoom.x}px, ${zoom.y}px, 0) scale(${zoom.scale})`,
              transition: zoom.animating ? 'transform 160ms var(--ease-click)' : 'none',
              cursor: zoomed ? (zoom.panning ? 'grabbing' : 'grab') : 'zoom-in',
            }}
          />
        )}

        {!zoomed && index > 0 && (
          <NavButton side="left" onClick={() => go(-1)}>
            <ChevronLeft className="h-5 w-5" />
          </NavButton>
        )}
        {!zoomed && index < media.length - 1 && (
          <NavButton side="right" onClick={() => go(1)}>
            <ChevronRight className="h-5 w-5" />
          </NavButton>
        )}
      </div>

      {/* The strip. Turns the viewer from "this picture" into "the pictures in
          this conversation", which is what people are doing when they open one
          and then press the arrow eleven times. Hidden while zoomed, and on a
          short viewport where it would eat the picture. */}
      {media.length > 1 && (
        <div
          className="cx-scroll hidden shrink-0 gap-1.5 overflow-x-auto px-3 pb-3 transition-opacity [@media(min-height:520px)]:flex"
          style={{
            opacity: zoomed ? 0 : 1,
            pointerEvents: zoomed ? 'none' : 'auto',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))',
          }}
        >
          {media.map((m) => (
            <button
              key={m.id}
              type="button"
              ref={m.id === messageId ? scrollIntoView : undefined}
              onClick={() =>
                navigate(`${window.location.pathname}?${mediaSearch(m.id)}`, { replace: true })
              }
              aria-label={m.fileName ?? 'Attachment'}
              aria-current={m.id === messageId}
              className="press h-12 w-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)]"
              style={{
                background: 'var(--room-3)',
                outline: m.id === messageId ? '2px solid var(--voice)' : 'none',
                outlineOffset: -2,
                opacity: m.id === messageId ? 1 : 0.55,
              }}
            >
              {m.type === 'video' && !m.thumbnailUrl ? (
                <video
                  src={m.fileUrl ?? undefined}
                  muted
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                />
              ) : (
                <img
                  src={m.thumbnailUrl ?? m.fileUrl ?? undefined}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Keep the active thumbnail in view as the arrows walk the strip. */
function scrollIntoView(el: HTMLButtonElement | null) {
  el?.scrollIntoView({ block: 'nearest', inline: 'center' });
}

function ChromeButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="press grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-30"
      style={{ color: 'var(--voice-2)' }}
    >
      {children}
    </button>
  );
}

function NavButton({
  side,
  onClick,
  children,
}: {
  side: 'left' | 'right';
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous' : 'Next'}
      className="press absolute top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full"
      style={{
        [side]: 16,
        background: 'var(--room-2)',
        border: '1px solid var(--wire-2)',
        color: 'var(--voice)',
      }}
    >
      {children}
    </button>
  );
}

/* ── Zoom + pan ──────────────────────────────────────────────────────────── */

type Swipe = 'left' | 'right' | null;

/**
 * Scale and offset for the stage, driven by every input a person might reach
 * for: wheel, pinch, drag, double-tap, and the keyboard.
 *
 * Built on POINTER events rather than separate mouse and touch paths, because
 * the two gestures that matter — drag-to-pan and pinch-to-zoom — are the same
 * code once you are tracking a set of active pointers. One pointer down and
 * moving is a pan (or, at rest scale, a swipe); two is a pinch.
 *
 * Everything resets when the picture changes: carrying a 4× zoom onto the next
 * image lands the viewer somewhere in the middle of a photograph nobody asked
 * to be inside.
 */
function useZoomPan(resetKey: string) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [panning, setPanning] = useState(false);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const start = useRef({ x: 0, y: 0, at: 0, offsetX: 0, offsetY: 0, distance: 0, scale: 1 });

  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setAnimating(false);
  }, [resetKey]);

  const clampScale = (next: number) => Math.min(MAX_SCALE, Math.max(1, next));

  const applyScale = (next: number) => {
    const clamped = clampScale(next);
    setScale(clamped);
    // Back at rest means back to centre — an offset with no scale to justify it
    // leaves the picture hanging off the edge of the stage.
    if (clamped === 1) setOffset({ x: 0, y: 0 });
  };

  const reset = () => {
    setAnimating(true);
    applyScale(1);
  };

  const toggle = () => {
    setAnimating(true);
    applyScale(scale > 1 ? 1 : 2.5);
  };

  const nudge = (direction: 1 | -1) => {
    setAnimating(true);
    applyScale(scale * (direction > 0 ? 1.5 : 1 / 1.5));
  };

  const onWheel = (e: React.WheelEvent) => {
    // Trackpads send pinch as ctrl+wheel; a plain wheel over a lightbox has
    // nothing else to do, so both zoom.
    setAnimating(false);
    applyScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setAnimating(false);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      start.current = {
        ...start.current,
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale,
      };
      return;
    }
    start.current = {
      x: e.clientX,
      y: e.clientY,
      at: Date.now(),
      offsetX: offset.x,
      offsetY: offset.y,
      distance: 0,
      scale,
    };
    if (scale > 1) setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (start.current.distance > 0) {
        applyScale(start.current.scale * (distance / start.current.distance));
      }
      return;
    }
    if (scale <= 1) return; // a one-finger drag at rest is a swipe, resolved on up
    setOffset({
      x: start.current.offsetX + (e.clientX - start.current.x),
      y: start.current.offsetY + (e.clientY - start.current.y),
    });
  };

  /** Returns the swipe this gesture turned out to be, if any. */
  const onPointerUp = (e: React.PointerEvent): Swipe => {
    pointers.current.delete(e.pointerId);
    setPanning(false);
    if (pointers.current.size > 0) return null;
    if (scale > 1) return null;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    const elapsed = Date.now() - start.current.at;
    // A swipe is fast, horizontal and long enough not to be a tap. All three,
    // because a slow horizontal drag is somebody selecting, and a diagonal one
    // is somebody scrolling the page behind.
    if (elapsed > 600 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
    return dx < 0 ? 'left' : 'right';
  };

  return {
    scale,
    x: offset.x,
    y: offset.y,
    animating,
    panning,
    reset,
    toggle,
    nudge,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
