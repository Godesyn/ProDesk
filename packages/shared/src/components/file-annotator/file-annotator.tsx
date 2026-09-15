import { useCallback, useEffect, useRef, useState } from 'react';
import { Pen, Highlighter, Type, Undo2, Redo2, Save, X, Loader2, Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves the worker as a module worker; wiring it via workerPort avoids
// hosting a separate worker file and any cross-origin worker-src issues.
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import { PDFDocument } from 'pdf-lib';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { extOf, baseName } from './annotatable';

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();

type Tool = 'pen' | 'highlight' | 'text';
type Pt = { x: number; y: number };
type Shape =
  | { id: string; page: number; kind: 'pen' | 'highlight'; color: string; width: number; points: Pt[] }
  | { id: string; page: number; kind: 'text'; color: string; size: number; x: number; y: number; text: string };

// A rendered page: its base raster (PDF page or image), the canvas-pixel size
// strokes are recorded against, and the original page size in PDF points so the
// rebuilt PDF keeps its dimensions.
type Page = { base: HTMLCanvasElement; cw: number; ch: number; ptW: number; ptH: number };

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#111827'];
const PEN_WIDTH = 3;
const HIGHLIGHT_WIDTH = 18;
const FONT_SIZE = 20; // default text size (canvas points)
const MIN_FONT = 8;
const MAX_FONT = 96;
const FONT_STEP = 2;
const MAX_RENDER_WIDTH = 1400; // cap raster width for memory/quality balance

/** Paint the committed shapes (and an optional in-progress draft) for one page. */
function paint(ctx: CanvasRenderingContext2D, shapes: Shape[], draft: Shape | null) {
  const all = draft ? [...shapes, draft] : shapes;
  for (const s of all) {
    if (s.kind === 'text') {
      ctx.save();
      ctx.fillStyle = s.color;
      ctx.font = `${s.size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = 'top';
      s.text.split('\n').forEach((line, i) => ctx.fillText(line, s.x, s.y + i * s.size * 1.2));
      ctx.restore();
      continue;
    }
    if (s.points.length === 0) continue;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.kind === 'highlight') { ctx.globalAlpha = 0.35; ctx.globalCompositeOperation = 'multiply'; }
    ctx.beginPath();
    ctx.moveTo(s.points[0].x, s.points[0].y);
    for (const p of s.points.slice(1)) ctx.lineTo(p.x, p.y);
    if (s.points.length === 1) ctx.lineTo(s.points[0].x + 0.1, s.points[0].y + 0.1);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Full-screen PDF / image markup editor. Renders the source, lets the reviewer
 * draw, highlight and type over it with undo/redo, then bakes the annotations
 * into a flattened file (PDF pages are re-rasterised; images export as PNG) and
 * hands the result back via `onSave` so the caller can re-attach it.
 */
export function FileAnnotator({ src, onSave, onCancel }: {
  src: { url: string; name: string };
  onSave: (file: File) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [pages, setPages] = useState<Page[]>([]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [fontSize, setFontSize] = useState(FONT_SIZE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending text box: where the reviewer clicked, the live value, the CSS font
  // size that matches FONT_SIZE at the canvas's current display scale, and a
  // stable `key` so the focus effect only fires when a NEW box opens (not on
  // every keystroke).
  const [textBox, setTextBox] = useState<{ key: string; page: number; x: number; y: number; value: string; fontPx: number } | null>(null);

  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // False until the new text box has actually been focused (next frame). Blur
  // events that fire before this — e.g. focus races while the pointer gesture is
  // still settling — must NOT commit-and-close the box, or it vanishes before
  // you can type (the "only works with DevTools open" bug).
  const boxReadyRef = useRef(false);
  const draftRef = useRef<Shape | null>(null);
  const drawingRef = useRef(false);
  const idRef = useRef(0);
  const newId = () => `s${idRef.current++}`;
  const isPdf = extOf(src.name) === 'pdf';

  // ---- load + render the source into per-page base canvases ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(src.url);
        if (!res.ok) throw new Error(`Could not load file (${res.status})`);
        const buf = await res.arrayBuffer();
        const next: Page[] = [];
        if (isPdf) {
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const vp1 = page.getViewport({ scale: 1 });
            const scale = Math.min(2, MAX_RENDER_WIDTH / vp1.width);
            const vp = page.getViewport({ scale });
            const c = document.createElement('canvas');
            c.width = Math.ceil(vp.width);
            c.height = Math.ceil(vp.height);
            const ctx = c.getContext('2d')!;
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, c.width, c.height);
            await page.render({ canvas: c, viewport: vp }).promise;
            next.push({ base: c, cw: c.width, ch: c.height, ptW: vp1.width, ptH: vp1.height });
          }
        } else {
          const url = URL.createObjectURL(new Blob([buf]));
          const img = new Image();
          img.crossOrigin = 'anonymous';
          await new Promise<void>((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = () => reject(new Error('Could not load image'));
            img.src = url;
          });
          URL.revokeObjectURL(url);
          const c = document.createElement('canvas');
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext('2d')!.drawImage(img, 0, 0);
          next.push({ base: c, cw: c.width, ch: c.height, ptW: img.naturalWidth, ptH: img.naturalHeight });
        }
        if (!cancelled) { setPages(next); setLoading(false); }
      } catch (e) {
        if (!cancelled) { setError((e as Error).message); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [src.url, isPdf]);

  // ---- redraw a page's visible canvas from base + shapes (+ live draft) ----
  const redraw = useCallback((pageIndex: number) => {
    const canvas = canvasRefs.current[pageIndex];
    const page = pages[pageIndex];
    if (!canvas || !page) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(page.base, 0, 0);
    paint(ctx, shapes.filter((s) => s.page === pageIndex), draftRef.current?.page === pageIndex ? draftRef.current : null);
  }, [pages, shapes]);

  useEffect(() => { pages.forEach((_, i) => redraw(i)); }, [pages, shapes, redraw]);

  // Focus a freshly-opened text box on the next frame (after it has mounted and
  // laid out), rather than via `autoFocus` mid-pointer-gesture. Until the focus
  // lands, blur is ignored (see boxReadyRef) so the box can't be torn down by a
  // focus race before you type. Keyed on textBox.key → runs once per new box.
  useEffect(() => {
    if (!textBox) { boxReadyRef.current = false; return; }
    boxReadyRef.current = false;
    const raf = requestAnimationFrame(() => {
      textareaRef.current?.focus({ preventScroll: true });
      boxReadyRef.current = true;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textBox?.key]);

  const toCanvasPt = (e: React.PointerEvent, pageIndex: number): Pt => {
    const canvas = canvasRefs.current[pageIndex]!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const commit = (shape: Shape) => { setShapes((prev) => [...prev, shape]); setRedo([]); };

  const onPointerDown = (e: React.PointerEvent, pageIndex: number) => {
    if (saving) return;
    if (tool === 'text') {
      if (textBox) return; // finish the current box first
      const canvas = canvasRefs.current[pageIndex]!;
      const rect = canvas.getBoundingClientRect();
      const p = toCanvasPt(e, pageIndex);
      setTextBox({ key: crypto.randomUUID(), page: pageIndex, x: p.x, y: p.y, value: '', fontPx: fontSize * (rect.width / canvas.width) });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    draftRef.current = {
      id: newId(), page: pageIndex, kind: tool, color,
      width: tool === 'highlight' ? HIGHLIGHT_WIDTH : PEN_WIDTH,
      points: [toCanvasPt(e, pageIndex)],
    };
    redraw(pageIndex);
  };
  const onPointerMove = (e: React.PointerEvent, pageIndex: number) => {
    if (!drawingRef.current || !draftRef.current || draftRef.current.kind === 'text') return;
    draftRef.current.points.push(toCanvasPt(e, pageIndex));
    redraw(pageIndex);
  };
  const onPointerUp = (pageIndex: number) => {
    if (!drawingRef.current || !draftRef.current) return;
    drawingRef.current = false;
    const draft = draftRef.current;
    draftRef.current = null;
    if (draft.kind !== 'text' && draft.points.length > 0) commit(draft);
    else redraw(pageIndex);
  };

  // Change the text size. If a box is open, rescale its on-screen preview too so
  // it matches what will be baked (canvas points × the canvas's display scale).
  const changeFont = (next: number) => {
    const size = Math.max(MIN_FONT, Math.min(MAX_FONT, next));
    setFontSize(size);
    if (textBox) {
      const canvas = canvasRefs.current[textBox.page];
      const scale = canvas ? canvas.getBoundingClientRect().width / canvas.width : 1;
      setTextBox({ ...textBox, fontPx: size * scale });
    }
  };

  const commitText = () => {
    if (!textBox) return;
    const v = textBox.value.trim();
    if (v) commit({ id: newId(), page: textBox.page, kind: 'text', color, size: fontSize, x: textBox.x, y: textBox.y, text: v });
    setTextBox(null);
  };

  // Read current state from the handler closure (recreated each render) rather
  // than nesting setState calls, which would double-fire under StrictMode.
  const undo = () => {
    if (shapes.length === 0) return;
    setRedo([...redo, shapes[shapes.length - 1]]);
    setShapes(shapes.slice(0, -1));
  };
  const redoFn = () => {
    if (redo.length === 0) return;
    setShapes([...shapes, redo[redo.length - 1]]);
    setRedo(redo.slice(0, -1));
  };

  // Keyboard: Ctrl/Cmd+Z / Shift+Z, Escape cancels text box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (textBox && e.key === 'Escape') { setTextBox(null); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoFn(); else undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textBox, shapes, redo]);

  async function handleSave() {
    if (pages.length === 0) return;
    // Bake any text still sitting in the open box: committing it via setState
    // here would be async and wouldn't be visible to the export below, so fold
    // it into the effective shape list directly (and reflect it back into state).
    const pending: Shape | null = textBox && textBox.value.trim()
      ? { id: newId(), page: textBox.page, kind: 'text', color, size: fontSize, x: textBox.x, y: textBox.y, text: textBox.value.trim() }
      : null;
    const effective = pending ? [...shapes, pending] : shapes;
    if (pending) { setShapes(effective); setRedo([]); }
    setTextBox(null);
    setSaving(true);
    try {
      const pngs: { bytes: Uint8Array; ptW: number; ptH: number }[] = [];
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const c = document.createElement('canvas');
        c.width = page.cw; c.height = page.ch;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(page.base, 0, 0);
        paint(ctx, effective.filter((s) => s.page === i), null);
        const blob: Blob = await new Promise((resolve, reject) =>
          c.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
        pngs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), ptW: page.ptW, ptH: page.ptH });
      }

      let file: File;
      if (isPdf) {
        const doc = await PDFDocument.create();
        for (const pg of pngs) {
          const img = await doc.embedPng(pg.bytes);
          const p = doc.addPage([pg.ptW, pg.ptH]);
          p.drawImage(img, { x: 0, y: 0, width: pg.ptW, height: pg.ptH });
        }
        const bytes = await doc.save();
        file = new File([bytes as BlobPart], `${baseName(src.name)}-annotated.pdf`, { type: 'application/pdf' });
      } else {
        file = new File([pngs[0].bytes as BlobPart], `${baseName(src.name)}-annotated.png`, { type: 'image/png' });
      }
      await onSave(file);
    } catch (e) {
      toast.error((e as Error).message);
      setSaving(false);
    }
  }

  const toolBtn = (t: Tool, Icon: typeof Pen, label: string) => (
    <Button size="icon" variant={tool === t ? 'accent' : 'ghost'} aria-label={label} title={label}
      onClick={() => { setTool(t); if (textBox) commitText(); }}>
      <Icon className="h-4 w-4" />
    </Button>
  );

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onCancel(); }}>
      <DialogContent className="flex h-[92vh] max-w-5xl flex-col gap-0 p-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--color-border-hairline)] p-3">
          {toolBtn('pen', Pen, 'Draw')}
          {toolBtn('highlight', Highlighter, 'Highlight')}
          {toolBtn('text', Type, 'Add text')}
          <div className="mx-1 flex items-center gap-1.5">
            {COLORS.map((c) => (
              <button key={c} aria-label={`Color ${c}`} onClick={() => setColor(c)}
                className={cn('h-5 w-5 rounded-full border border-black/10', color === c && 'ring-2 ring-accent ring-offset-1')}
                style={{ backgroundColor: c }} />
            ))}
          </div>
          <div className="h-5 w-px bg-[color:var(--color-border-hairline)]" />
          {/* Text size stepper (applies to the text tool). Keep the textarea
              focused so adjusting size mid-typing doesn't commit/close the box. */}
          <div className="flex items-center gap-1" onMouseDown={(e) => e.preventDefault()}>
            <Button size="icon" variant="ghost" aria-label="Decrease text size" title="Decrease text size"
              disabled={fontSize <= MIN_FONT} onClick={() => changeFont(fontSize - FONT_STEP)}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-6 text-center text-xs tabular-nums text-ink-60" title="Text size">{fontSize}</span>
            <Button size="icon" variant="ghost" aria-label="Increase text size" title="Increase text size"
              disabled={fontSize >= MAX_FONT} onClick={() => changeFont(fontSize + FONT_STEP)}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="h-5 w-px bg-[color:var(--color-border-hairline)]" />
          <Button size="icon" variant="ghost" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={shapes.length === 0} onClick={undo}><Undo2 className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={redo.length === 0} onClick={redoFn}><Redo2 className="h-4 w-4" /></Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" disabled={saving} onClick={onCancel}><X className="h-4 w-4" /> Cancel</Button>
            <Button variant="accent" size="sm" disabled={saving || loading || !!error}
              // Keep focus on the textarea so its blur doesn't race the save;
              // handleSave bakes the pending text itself.
              onMouseDown={(e) => e.preventDefault()} onClick={handleSave}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save & attach
            </Button>
          </div>
        </div>

        {/* Pages */}
        <div className="flex-1 overflow-auto bg-inset/60 p-4">
          {loading && <div className="flex h-full items-center justify-center text-ink-60"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…</div>}
          {error && <div className="flex h-full items-center justify-center text-danger">{error}</div>}
          <div className="mx-auto flex max-w-3xl flex-col items-center gap-4">
            {pages.map((page, i) => (
              <div key={i} className="relative w-full shadow-sm">
                <canvas
                  ref={(el) => { canvasRefs.current[i] = el; }}
                  width={page.cw}
                  height={page.ch}
                  className={cn('block w-full rounded-[var(--radius-sm)] bg-white', tool === 'text' ? 'cursor-text' : 'cursor-crosshair')}
                  style={{ touchAction: 'none' }}
                  onPointerDown={(e) => onPointerDown(e, i)}
                  onPointerMove={(e) => onPointerMove(e, i)}
                  onPointerUp={() => onPointerUp(i)}
                  onPointerLeave={() => onPointerUp(i)}
                />
                {textBox?.page === i && (
                  <textarea
                    ref={textareaRef}
                    value={textBox.value}
                    placeholder="Type, then Enter"
                    onChange={(e) => setTextBox({ ...textBox, value: e.target.value })}
                    // Only commit on blur once the box is focused & ready — an
                    // early blur from a focus race must not tear it down.
                    onBlur={() => { if (boxReadyRef.current) commitText(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); } }}
                    // No border/padding: content origin must match fillText(x, y)
                    // with textBaseline 'top'. Outline + font/line-height mirror
                    // the baked text so the preview lands exactly where it bakes.
                    className="absolute z-10 resize-none overflow-hidden bg-white/80 p-0 text-ink-100 outline outline-1 outline-accent"
                    style={{
                      left: `${(textBox.x / page.cw) * 100}%`,
                      top: `${(textBox.y / page.ch) * 100}%`,
                      color,
                      fontSize: `${textBox.fontPx}px`,
                      fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                      lineHeight: 1.2,
                      minWidth: '8ch',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
