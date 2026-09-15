import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FileText,
  HelpCircle,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Minimize2,
  Music,
  Play,
  Presentation,
  RotateCcw,
  Share2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  fileNameFromUrl,
  getFileType,
  vimeoVideoId,
  youtubeVideoId,
  type AppFileType,
} from '../../lib/file-utils';
import { cn } from '../../lib/utils';
import { downloadFile } from '../../lib/download';

/**
 * Full-screen file previewer — a React port of the Flutter `AppFileViewer`
 * (lib/src/shared/components/app_file_viewer.dart). Renders an image (zoom/pan),
 * SVG, video (incl. YouTube/Vimeo), PDF (URL or in-memory bytes), DOCX/PPTX (via
 * the Google Docs embedded viewer), arbitrary links (iframe), and a download
 * fallback for everything else. A top bar exposes share / download / open-in-new
 * plus a maximize (fill-viewport) toggle.
 *
 * Use the imperative API (`useFileViewer().openFile` / `openMemoryPdf`) rather
 * than mounting this directly — see file-viewer-provider.tsx.
 */
export interface AppFileViewerProps {
  open: boolean;
  url: string;
  title: string;
  fileType?: AppFileType;
  /** In-memory PDF bytes/blob (the `showMemoryPdf` path) — `url` is ignored when set. */
  memoryPdf?: Uint8Array | Blob | null;
  /** When set, the header name is click-to-rename; the callback persists it. */
  onRename?: (name: string) => void | Promise<void>;
  onClose: () => void;
}

function googleViewerUrl(url: string): string {
  return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
}

const ICONS: Record<AppFileType, { Icon: typeof FileText; className: string }> = {
  image: { Icon: ImageIcon, className: 'text-blue-300' },
  svg: { Icon: ImageIcon, className: 'text-blue-300' },
  video: { Icon: Play, className: 'text-red-300' },
  pdf: { Icon: FileText, className: 'text-red-400' },
  docx: { Icon: FileText, className: 'text-blue-400' },
  pptx: { Icon: Presentation, className: 'text-orange-400' },
  audio: { Icon: Music, className: 'text-purple-300' },
  link: { Icon: Link2, className: 'text-green-400' },
  unknown: { Icon: HelpCircle, className: 'text-white/50' },
};

export function AppFileViewer({ open, url, title, fileType, memoryPdf, onRename, onClose }: AppFileViewerProps) {
  const [maximized, setMaximized] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const type: AppFileType = memoryPdf ? 'pdf' : (fileType ?? getFileType(url, title));
  const baseName = fileNameFromUrl(title || url);
  const { Icon, className: iconClass } = ICONS[type] ?? ICONS.unknown;

  // Click-to-rename header (only when onRename is provided). nameOverride keeps the
  // freshly-renamed name visible without waiting for the parent to re-open.
  const [nameOverride, setNameOverride] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const editingRef = useRef(false);
  editingRef.current = editing;
  const displayName = nameOverride ?? baseName;
  const startRename = () => { if (!onRename) return; setDraft(displayName); setEditing(true); };
  const commitRename = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!onRename || !next || next === displayName) return;
    try {
      await onRename(next);
      setNameOverride(next);
    } catch {
      /* the rename callback surfaces its own error toast */
    }
  };

  // Build (and revoke) an object URL for in-memory PDF bytes.
  useEffect(() => {
    if (!memoryPdf) {
      setBlobUrl(null);
      return;
    }
    const blob =
      memoryPdf instanceof Blob ? memoryPdf : new Blob([memoryPdf as BlobPart], { type: 'application/pdf' });
    const u = URL.createObjectURL(blob);
    setBlobUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [memoryPdf]);

  // Reset maximize + rename state each time a new file opens.
  useEffect(() => {
    if (open) { setMaximized(false); setEditing(false); setNameOverride(null); }
  }, [open, url, title]);

  // Esc to close; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingRef.current) return; // Esc cancels rename, not the viewer
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const download = useCallback(async () => {
    // In-memory PDFs are already same-origin blobs, so the plain anchor works.
    if (memoryPdf && blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = displayName.toLowerCase().endsWith('.pdf') ? displayName : `${displayName}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    // Everything else is on the storage host, and `download` is IGNORED for a
    // cross-origin href — which is why this button used to open a new tab and
    // render the file instead of saving it. `downloadFile` fetches the bytes and
    // hands the browser a same-origin blob, which is what makes it do what the
    // label says (and what gives a phone a Save at all).
    await downloadFile(url, displayName);
  }, [memoryPdf, blobUrl, url, displayName]);

  const share = useCallback(async () => {
    if (!url) return;
    try {
      if (navigator.share) {
        await navigator.share({ title: displayName, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Link copied to clipboard');
    } catch {
      /* user cancelled share — ignore */
    }
  }, [url, displayName]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={displayName}
    >
      {/* Top bar */}
      <div className="z-10 flex h-16 shrink-0 items-center gap-3 bg-black/50 px-4">
        <button
          type="button"
          onClick={onClose}
          title="Back"
          className="rounded-full p-2 text-white transition-colors hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Icon className={cn('h-5 w-5 shrink-0', iconClass)} />
        {editing && onRename ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              else if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); }
            }}
            className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-base font-medium text-white outline-none ring-1 ring-white/40 focus:ring-accent"
          />
        ) : (
          <button
            type="button"
            onClick={onRename ? startRename : undefined}
            title={onRename ? 'Rename' : displayName}
            className={cn(
              'min-w-0 flex-1 truncate text-left text-base font-medium text-white',
              onRename && 'cursor-text rounded px-1 hover:bg-white/10',
            )}
          >
            {displayName}
          </button>
        )}

        <div className="flex items-center gap-1">
          <ActionButton title={maximized ? 'Restore' : 'Maximize'} onClick={() => setMaximized((m) => !m)}>
            {maximized ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </ActionButton>
          {url && !memoryPdf && (
            <>
              <ActionButton title="Share" onClick={share}>
                <Share2 className="h-5 w-5" />
              </ActionButton>
              <ActionButton title="Open in new tab" onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                <ExternalLink className="h-5 w-5" />
              </ActionButton>
            </>
          )}
          {(url || memoryPdf) && (
            <ActionButton title="Download" onClick={download}>
              <Download className="h-5 w-5" />
            </ActionButton>
          )}
        </div>
      </div>

      {/* Backdrop click target + content */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-4" onClick={onClose}>
        <div
          className={cn(
            'relative flex max-h-full min-h-0 w-full items-center justify-center overflow-hidden',
            maximized ? 'h-full max-w-none' : 'max-w-[1200px]',
            type === 'image' || type === 'svg'
              ? 'bg-transparent'
              : 'rounded-xl bg-white shadow-2xl',
          )}
          style={maximized ? undefined : { maxHeight: 'calc(100vh - 6rem)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <ViewerBody type={type} url={url} blobUrl={blobUrl} displayName={displayName} onDownload={download} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ActionButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="rounded-lg p-2 text-white transition-colors hover:bg-white/10"
    >
      {children}
    </button>
  );
}

function ViewerBody({
  type,
  url,
  blobUrl,
  displayName,
  onDownload,
}: {
  type: AppFileType;
  url: string;
  blobUrl: string | null;
  displayName: string;
  onDownload: () => void;
}) {
  switch (type) {
    case 'image':
      return <ZoomableImage src={url} alt={displayName} />;
    case 'svg':
      return <ZoomableImage src={url} alt={displayName} />;
    case 'video':
      return <VideoView url={url} />;
    case 'audio':
      return (
        <div className="flex w-full max-w-xl flex-col items-center gap-6 p-10">
          <Music className="h-16 w-16 text-ink-40" />
          <p className="text-center text-sm font-medium text-ink-100">{displayName}</p>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio src={url} controls autoPlay className="w-full" />
        </div>
      );
    case 'pdf':
      return (
        <iframe
          title={displayName}
          src={blobUrl ?? `${url}#toolbar=1&view=FitH`}
          className="h-[calc(100vh-7rem)] w-full"
        />
      );
    case 'docx':
    case 'pptx':
      return <iframe title={displayName} src={googleViewerUrl(url)} className="h-[calc(100vh-7rem)] w-full" />;
    case 'link':
      return <iframe title={displayName} src={url} className="h-[calc(100vh-7rem)] w-full" />;
    case 'unknown':
    default:
      return (
        <div className="flex flex-col items-center gap-4 p-12 text-center">
          <HelpCircle className="h-16 w-16 text-ink-40" />
          <div>
            <p className="text-lg font-medium text-ink-100">No preview available</p>
            <p className="mt-1 text-sm text-ink-60">This file type cannot be previewed directly.</p>
          </div>
          <button
            type="button"
            onClick={onDownload}
            className="mt-2 inline-flex items-center gap-2 rounded-[var(--radius-sm)] bg-ink-100 px-4 py-2 text-sm font-medium text-paper transition-colors hover:bg-ink-80"
          >
            <Download className="h-4 w-4" /> Download file
          </button>
        </div>
      );
  }
}

/** Wheel/pinch/double-click/button zoom + drag-to-pan, mirroring Flutter InteractiveViewer (0.5×–4×). */
function ZoomableImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const clamp = (s: number) => Math.min(4, Math.max(0.5, s));
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale((s) => clamp(s - e.deltaY * 0.0015));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (scale <= 1) return;
    dragging.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setOffset({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  return (
    <div
      className="relative flex h-[calc(100vh-6rem)] max-h-full w-full items-center justify-center overflow-hidden"
      onWheel={onWheel}
      onDoubleClick={() => (scale > 1 ? reset() : setScale(2))}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          cursor: scale > 1 ? 'grab' : 'zoom-in',
        }}
        className="h-full w-full select-none object-contain transition-transform duration-75 will-change-transform"
      />
      {/* Zoom controls */}
      <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/60 px-2 py-1 backdrop-blur">
        <button type="button" title="Zoom out" onClick={() => setScale((s) => clamp(s - 0.25))} className="rounded-full p-1.5 text-white hover:bg-white/10">
          <ZoomOut className="h-4 w-4" />
        </button>
        <span className="min-w-[3ch] text-center text-xs tabular-nums text-white">{Math.round(scale * 100)}%</span>
        <button type="button" title="Zoom in" onClick={() => setScale((s) => clamp(s + 0.25))} className="rounded-full p-1.5 text-white hover:bg-white/10">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button type="button" title="Reset" onClick={reset} className="rounded-full p-1.5 text-white hover:bg-white/10">
          <RotateCcw className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Network video, YouTube and Vimeo — ports ServiceVideoPreview's URL handling. */
function VideoView({ url }: { url: string }) {
  const yt = youtubeVideoId(url);
  if (yt) {
    return (
      <div className="aspect-video w-full max-w-[1100px] bg-black">
        <iframe
          title="YouTube video"
          src={`https://www.youtube.com/embed/${yt}?rel=0`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  const vimeo = vimeoVideoId(url);
  if (vimeo) {
    return (
      <div className="aspect-video w-full max-w-[1100px] bg-black">
        <iframe
          title="Vimeo video"
          src={`https://player.vimeo.com/video/${vimeo}`}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }
  return (
    <div className="flex w-full items-center justify-center bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video src={url} controls autoPlay className="max-h-[calc(100vh-6rem)] max-w-full" />
    </div>
  );
}
