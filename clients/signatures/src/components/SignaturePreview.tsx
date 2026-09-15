/**
 * SignaturePreview — Live preview of the generated email signature.
 *
 * Scaling: the signature is measured at its true intrinsic (max-content) width,
 * then scaled with a CSS transform to fit the container width — but ONLY ever
 * scaled DOWN. The factor is `min(1, containerWidth / naturalWidth)`, so a
 * signature narrower than its container renders at 1:1 (never enlarged) while a
 * wider one shrinks to fit without a horizontal scrollbar. The wrapper height
 * tracks the scaled height. Measuring at max-content (not the container width)
 * is what keeps the ratio correct — an earlier `min-width:100%` on the iframe
 * body coupled the measured width to the container and skewed the scale.
 *
 * Icon colouring:
 *   ALWAYS uses hosted PNG icons (via generateSignatureHtmlForExport).
 *   The preview waits for batchColorize to return before rendering, so
 *   copy-pasting the preview into Gmail always contains PNG <img> tags,
 *   never SVG data URIs (which Gmail blocks).
 */

import {
  useEffect,
  useRef,
  useState,
  useMemo,
  useImperativeHandle,
} from 'react';
import {
  generateSignatureHtmlForExport,
  makeSignatureUrlsAbsolute,
} from '@/lib/signatureGenerator';
import type { IconUrlMap } from '@/lib/signatureGenerator';
import { activeIconKeys, exportIconColor } from '@/lib/signatureExport';
import type { SignatureData } from '@/lib/signatureTypes';
import { trpc } from '@/lib/trpc';

export interface SignaturePreviewHandle {
  /** Copies the rendered iframe content as rich HTML (for Gmail paste). Returns true on success. */
  copyRenderedContent: () => Promise<boolean>;
}

interface SignaturePreviewProps {
  data: SignatureData;
  /** Active Prodesk brand id — scopes the server-side icon PNG rendering. */
  brandId: string;
  /**
   * Pre-rendered icon URL map from the server (stored in DB at member save time).
   * When provided, skips the batchColorize query and uses these URLs directly.
   * Keys are like "facebook_21123b" -> hosted PNG URL.
   */
  preloadedIconUrlMap?: IconUrlMap;
  /** Optional ref to expose imperative methods (e.g. copyRenderedContent for Gmail). */
  imperativeRef?: React.RefObject<SignaturePreviewHandle | null>;
}

export function SignaturePreview({
  data,
  brandId,
  preloadedIconUrlMap,
  imperativeRef,
}: SignaturePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Expose copyRenderedContent for Gmail-style rich copy
  useImperativeHandle(imperativeRef, () => ({
    copyRenderedContent: async (): Promise<boolean> => {
      try {
        const iframe = iframeRef.current;
        if (!iframe) return false;
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return false;

        // Method 1: Use ClipboardItem with text/html blob (modern browsers)
        if (
          typeof ClipboardItem !== 'undefined' &&
          navigator.clipboard?.write
        ) {
          const htmlContent = doc.documentElement.outerHTML;
          const blob = new Blob([htmlContent], { type: 'text/html' });
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/html': blob }),
          ]);
          return true;
        }

        // Method 2: Select all content in the iframe and execCommand('copy')
        const win = iframe.contentWindow;
        if (!win) return false;
        const selection = win.getSelection();
        if (!selection) return false;
        const range = doc.createRange();
        range.selectNodeContents(doc.body);
        selection.removeAllRanges();
        selection.addRange(range);
        const success = doc.execCommand('copy');
        selection.removeAllRanges();
        return success;
      } catch {
        return false;
      }
    },
  }));

  // ── Icon URL map (brand-coloured PNGs from server) ──────────────────────────
  // Build a stable request array — only re-fetch when colour or active keys change
  const iconColor = useMemo(() => exportIconColor(data), [data]);
  const iconRequests = useMemo(() => {
    return activeIconKeys(data).map((key) => ({ key, color: iconColor }));
  }, [data, iconColor]);

  // ALWAYS fetch PNG icons from the server using the current iconColor.
  // We never use preloadedIconUrlMap directly because it may have been generated
  // with a different colour (e.g. brand barTextColor changed since last save).
  // Skip the query only when there are no social links to render.
  const colorizeQuery = trpc.signatures.icons.batchColorize.useQuery(
    { brandId, requests: iconRequests },
    { enabled: iconRequests.length > 0 && !!brandId, retry: 1 },
  );

  // Prefer freshly-fetched icons (correct current colours) but fall back to the
  // DB-prerendered map the caller passed. Without this fallback the public share
  // page hangs forever on "Preparing preview…" whenever the live colorize query
  // is slow or errors, since it would never resolve an icon map.
  const iconUrlMap =
    (colorizeQuery.data as IconUrlMap | undefined) ?? preloadedIconUrlMap;

  // ── Generate HTML using PNG-only export generator ───────────────────────────
  // We use generateSignatureHtmlForExport so the preview iframe contains the
  // exact same HTML that gets pasted into Gmail — hosted PNG icons, no SVG data URIs.
  // Ready once we have a map, there are no icons, or the fetch settled — even on
  // error we render (icons are simply omitted) rather than blocking forever.
  const iconsReady =
    iconRequests.length === 0 ||
    iconUrlMap !== undefined ||
    colorizeQuery.isError;
  const html = iconsReady
    ? makeSignatureUrlsAbsolute(generateSignatureHtmlForExport(data, iconUrlMap ?? {}))
    : null;

  // Track the signature's natural (intrinsic) dimensions and the container width
  // so we can compute the scale-down factor.
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const [containerWidth, setContainerWidth] = useState(0);

  // Observe container width changes (e.g. panel/dialog resize).
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(wrapper);
    setContainerWidth(wrapper.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!html) return; // wait until PNG icons are ready
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background: #ffffff;
      /* max-content only — no min-width:100%, so scrollWidth is the signature's
         TRUE intrinsic width, independent of the iframe/container width. That
         keeps the scale ratio (container / natural) correct. */
      width: max-content;
    }
  </style>
</head>
<body>
  ${html}
</body>
</html>`;

    doc.open();
    doc.write(fullHtml);
    doc.close();

    const measure = () => {
      try {
        const body = doc.body;
        const w = Math.max(body.scrollWidth, 200);
        const h = Math.max(body.scrollHeight, 80);
        iframe.style.width = `${w}px`;
        iframe.style.height = `${h}px`;
        setNaturalSize({ w, h });
      } catch {
        // cross-origin guard
      }
    };

    setTimeout(measure, 80);
    setTimeout(measure, 300);
    iframe.onload = measure;

    const attachImageListeners = () => {
      try {
        const imgs = doc.querySelectorAll('img');
        imgs.forEach((img) => {
          if (!img.complete) {
            img.addEventListener('load', measure, { once: true });
            img.addEventListener('error', measure, { once: true });
          }
        });
      } catch {
        /* cross-origin guard */
      }
    };
    setTimeout(attachImageListeners, 50);

    // The signature HTML links have no target, so by default they'd navigate the
    // sandboxed iframe in place — replacing the preview with the destination.
    // Instead, intercept clicks and open the link in a real new browser tab so
    // the preview is never disturbed. mailto:/tel: go through location.href so
    // the OS handler fires without spawning a blank tab. Listeners are attached
    // from the (non-sandboxed) parent, so window.open is not popup-blocked.
    const onAnchorClick = (e: Event) => {
      const anchor = (e.currentTarget as HTMLAnchorElement) ?? null;
      const href = anchor?.getAttribute('href') || '';
      if (!href) return;
      e.preventDefault();
      if (/^(mailto:|tel:)/i.test(href)) {
        window.location.href = href;
      } else {
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    };
    try {
      doc.querySelectorAll('a').forEach((a) => {
        a.addEventListener('click', onAnchorClick);
      });
    } catch {
      /* cross-origin guard */
    }
  }, [html, data.template]);

  // Scale DOWN to fit the container; never enlarge past the natural size (the
  // min(1, …) cap). Single stable wrapper + iframe across every state — earlier
  // the component returned different JSX per state, so wrapperRef/iframeRef
  // re-attached to a fresh node each transition and the ResizeObserver kept
  // measuring an unmounted wrapper (stale containerWidth → overflow).
  const scale =
    naturalSize.w > 0 && containerWidth > 0
      ? Math.min(1, containerWidth / naturalSize.w)
      : 1;
  const scaledHeight =
    naturalSize.h > 0 ? Math.ceil(naturalSize.h * scale) : undefined;
  // Show the overlay until icons AND the natural size are known.
  const showLoading =
    !iconsReady || colorizeQuery.isLoading || naturalSize.w === 0;

  return (
    <div
      ref={wrapperRef}
      className="relative w-full"
      style={{ height: scaledHeight ?? 120, overflow: 'hidden' }}
    >
      <iframe
        ref={iframeRef}
        title="Signature Preview"
        className="border-0 block origin-top-left"
        style={{
          minWidth: '200px',
          minHeight: '80px',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // Hide until measured so the un-scaled frame never flashes before the
          // scale factor is applied.
          visibility: naturalSize.w > 0 ? 'visible' : 'hidden',
        }}
        sandbox="allow-same-origin"
      />
      {showLoading && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white">
          <svg
            className="animate-spin text-muted-foreground"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            width="18"
            height="18"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-muted-foreground text-sm">
            Preparing preview…
          </span>
        </div>
      )}
    </div>
  );
}
