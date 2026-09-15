/**
 * Prodesk Block Renderers
 * Each renderer produces the exact visual output shown to the client.
 * Used by both ProposalCanvas (editing) and ProposalPublic (read-only).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type {
  Block,
  BlockStyles,
  HeroData,
  ValuePanelsData,
  TextBlockData,
  PricingTableData,
  TeamCardsData,
  RoadmapData,
  ImageBannerData,
  DividerData,
  AcceptPayData,
  VideoData,
  TestimonialData,
  CaseStudyData,
  FaqData,
  ComparisonData,
  GuaranteeData,
  CountdownData,
  StatBarData,
  LogoStripData,
  ProcessStepsData,
  SpacerData,
  EmbedData,
  GalleryData,
  PackageSelectorData,
  SignatureData,
  CustomHtmlData,
  BlockData,
  RecommendationsData,
} from '@/lib/blocks';
import { useQuery } from '@tanstack/react-query';
import { useTRPC } from '@shared/lib/trpc';
import { useBrandId } from '@/lib/payments-trpc';
import { LazyImage } from '@shared/components/ui/lazy-image';

// ---- Shared helpers ----
function fmtCents(cents: number, currency = 'AUD') {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function bgLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function css(styles: BlockStyles) {
  const bg = styles.bg ?? '#000';
  // Determine scheme from bg luminance (scheme field is advisory only)
  const isLight = bgLuminance(bg) > 0.5;

  // baseText: if explicitly set, use it — but validate it contrasts against bg.
  // If the set colour is too similar to bg (luminance diff < 0.3), override with safe default.
  let baseText = styles.text ?? (isLight ? '#0A0A0A' : '#ffffff');
  const textLum = bgLuminance(baseText);
  const bgLum = bgLuminance(bg);
  if (Math.abs(textLum - bgLum) < 0.25) {
    // Not enough contrast — fall back to safe readable colour
    baseText = isLight ? '#0A0A0A' : '#ffffff';
  }

  // Muted/dim/subtle are always derived from the actual bg luminance, not the text colour
  const mutedText =
    styles.textMuted ??
    (isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)');
  const dimText = isLight ? 'rgba(0,0,0,0.38)' : 'rgba(255,255,255,0.32)';
  const subtleText = isLight ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.15)';
  const borderColor =
    (styles as any).border ??
    (isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)');
  const cardBg = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)';
  const cardBgHover = isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.08)';
  return {
    '--block-bg': bg,
    '--block-accent': styles.accent ?? '#65F5C9',
    '--block-text': baseText,
    '--block-text-muted': mutedText,
    '--block-text-dim': dimText,
    '--block-text-subtle': subtleText,
    '--block-border': borderColor,
    '--block-card-bg': cardBg,
    '--block-card-bg-hover': cardBgHover,
    '--block-font-heading': styles.fontHeading ?? 'inherit',
    '--block-font-body': styles.fontBody ?? 'inherit',
    backgroundColor: bg,
    color: baseText,
    fontFamily: styles.fontBody
      ? `'${styles.fontBody}', sans-serif`
      : 'inherit',
  } as React.CSSProperties;
}

// Editable text wrapper — contentEditable in edit mode, plain span in view mode
type EditableTag =
  | 'span'
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'div'
  | 'strong';
interface EditableProps {
  value: string;
  onChange?: (v: string) => void;
  className?: string;
  style?: React.CSSProperties;
  tag?: EditableTag;
  placeholder?: string;
  richText?: boolean;
}

// Floating rich-text toolbar
// Link URLs are captured via an inline input (never window.prompt — in-app UI only).
const RichTextToolbar = React.forwardRef<
  HTMLDivElement,
  {
    position: { top: number; left: number } | null;
    onCommand: (cmd: string, val?: string) => void;
    linkEditing: boolean;
    onLinkStart: () => void;
    onLinkSubmit: (url: string) => void;
    onLinkCancel: () => void;
  }
>(function RichTextToolbar(
  { position, onCommand, linkEditing, onLinkStart, onLinkSubmit, onLinkCancel },
  ref,
) {
  const [linkUrl, setLinkUrl] = useState('https://');
  useEffect(() => {
    if (linkEditing) setLinkUrl('https://');
  }, [linkEditing]);
  if (!position) return null;
  return (
    <div
      ref={ref}
      className="fixed z-[9999] flex items-center gap-0.5 rounded-lg shadow-xl px-1.5 py-1"
      style={{
        top: position.top - 44,
        left: position.left,
        background: '#1a1a1a',
        border: '1px solid rgba(255,255,255,0.15)',
        transform: 'translateX(-50%)',
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {linkEditing ? (
        <>
          <input
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onLinkSubmit(linkUrl.trim());
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onLinkCancel();
              }
            }}
            placeholder="https://"
            className="w-48 bg-transparent outline-none text-[12px] px-2 py-1 rounded-md"
            style={{
              color: 'rgba(255,255,255,0.85)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          />
          <button
            title="Apply link"
            onClick={() => onLinkSubmit(linkUrl.trim())}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            <svg width="11" height="9" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button
            title="Cancel"
            onClick={onLinkCancel}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path
                d="M1 1L9 9M9 1L1 9"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      ) : (
        <>
          {(
            [
              {
                cmd: 'bold',
                icon: (
                  <strong style={{ fontSize: 12, fontFamily: 'serif' }}>
                    B
                  </strong>
                ),
                title: 'Bold',
              },
              {
                cmd: 'italic',
                icon: <em style={{ fontSize: 12, fontFamily: 'serif' }}>I</em>,
                title: 'Italic',
              },
              {
                cmd: 'underline',
                icon: (
                  <span style={{ fontSize: 12, textDecoration: 'underline' }}>
                    U
                  </span>
                ),
                title: 'Underline',
              },
              {
                cmd: 'strikeThrough',
                icon: (
                  <span
                    style={{ fontSize: 12, textDecoration: 'line-through' }}
                  >
                    S
                  </span>
                ),
                title: 'Strikethrough',
              },
            ] as const
          ).map(({ cmd, icon, title }) => (
            <button
              key={cmd}
              title={title}
              onClick={() => onCommand(cmd)}
              className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
              style={{ color: 'rgba(255,255,255,0.85)' }}
            >
              {icon}
            </button>
          ))}
          <div
            className="w-px h-4 mx-0.5"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          />
          <button
            title="Link"
            onClick={onLinkStart}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
            style={{ color: 'rgba(255,255,255,0.85)' }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M5 7L7 5M4.5 3.5L3 5a2.121 2.121 0 0 0 3 3l1.5-1.5M7.5 8.5L9 7a2.121 2.121 0 0 0-3-3L4.5 5.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <button
            title="Remove formatting"
            onClick={() => onCommand('removeFormat')}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-white/15 transition-colors"
            style={{ color: 'rgba(255,255,255,0.5)' }}
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path
                d="M1 1l9 9M10 1L1 10"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </>
      )}
    </div>
  );
});

export function Editable({
  value,
  onChange,
  className,
  style,
  tag = 'span',
  placeholder,
  richText,
}: EditableProps) {
  const Tag = tag;
  const [toolbarPos, setToolbarPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [linkEditing, setLinkEditing] = useState(false);
  const ref = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (!richText || !onChange) return;
    if (linkEditing) return; // Keep toolbar open while the link URL is being typed
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setToolbarPos(null);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!ref.current?.contains(range.commonAncestorContainer)) {
      setToolbarPos(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setToolbarPos({
      top: rect.top + window.scrollY,
      left: rect.left + rect.width / 2 + window.scrollX,
    });
  }, [richText, onChange, linkEditing]);

  useEffect(() => {
    if (!richText) return;
    document.addEventListener('selectionchange', handleSelectionChange);
    return () =>
      document.removeEventListener('selectionchange', handleSelectionChange);
  }, [richText, handleSelectionChange]);

  const execCmd = useCallback(
    (cmd: string, val?: string) => {
      document.execCommand(cmd, false, val);
      if (ref.current && onChange) onChange(ref.current.innerHTML);
      setToolbarPos(null);
      setLinkEditing(false);
    },
    [onChange],
  );

  const handleLinkStart = useCallback(() => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount)
      savedRange.current = sel.getRangeAt(0).cloneRange();
    setLinkEditing(true);
  }, []);

  const handleLinkSubmit = useCallback(
    (url: string) => {
      const sel = window.getSelection();
      if (savedRange.current && sel) {
        sel.removeAllRanges();
        sel.addRange(savedRange.current);
      }
      savedRange.current = null;
      if (url && url !== 'https://') {
        execCmd('createLink', url);
      } else {
        setLinkEditing(false);
        setToolbarPos(null);
      }
    },
    [execCmd],
  );

  const handleLinkCancel = useCallback(() => {
    savedRange.current = null;
    setLinkEditing(false);
    setToolbarPos(null);
  }, []);

  if (!onChange)
    return (
      <Tag
        className={className}
        style={style}
        dangerouslySetInnerHTML={{ __html: value || placeholder || '' }}
      />
    );

  if (richText) {
    return (
      <>
        {toolbarPos && (
          <RichTextToolbar
            ref={toolbarRef}
            position={toolbarPos}
            onCommand={execCmd}
            linkEditing={linkEditing}
            onLinkStart={handleLinkStart}
            onLinkSubmit={handleLinkSubmit}
            onLinkCancel={handleLinkCancel}
          />
        )}
        <Tag
          ref={ref as any}
          className={`outline-none focus:ring-2 focus:ring-[var(--block-accent)] focus:ring-offset-1 focus:ring-offset-transparent rounded-sm ${className ?? ''}`}
          style={style}
          contentEditable
          suppressContentEditableWarning
          onBlur={(e: React.FocusEvent<HTMLElement>) => {
            onChange(e.currentTarget.innerHTML);
            // Keep the toolbar mounted when focus moves into it (link URL input)
            if (
              !(
                e.relatedTarget &&
                toolbarRef.current?.contains(e.relatedTarget as Node)
              )
            ) {
              setToolbarPos(null);
              setLinkEditing(false);
            }
          }}
          dangerouslySetInnerHTML={{
            __html:
              value || `<span style="opacity:0.4">${placeholder ?? ''}</span>`,
          }}
        />
      </>
    );
  }

  return (
    <Tag
      className={`outline-none focus:ring-2 focus:ring-[var(--block-accent)] focus:ring-offset-1 focus:ring-offset-transparent rounded-sm ${className ?? ''}`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      onBlur={(e: React.FocusEvent<HTMLElement>) =>
        onChange(e.currentTarget.textContent ?? '')
      }
      dangerouslySetInnerHTML={{
        __html:
          value || `<span style="opacity:0.4">${placeholder ?? ''}</span>`,
      }}
    />
  );
}

// ============================================================
// HERO
// ============================================================
interface HeroRendererProps {
  block: Block;
  onDataChange?: (data: HeroData) => void;
}
export function HeroRenderer({ block, onDataChange }: HeroRendererProps) {
  const d = block.data as HeroData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<HeroData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updMeta = upd
    ? (i: number, key: 'label' | 'value', v: string) => {
        const items = [...d.metaItems];
        items[i] = { ...items[i], [key]: v };
        upd({ metaItems: items });
      }
    : undefined;

  return (
    <section
      className="relative min-h-[90vh] flex flex-col justify-end overflow-hidden"
      style={{ ...css(s), padding: '120px clamp(24px,6vw,96px) 80px' }}
    >
      {/* Background */}
      {d.bgImageUrl ? (
        <div className="absolute inset-0 z-0">
          <LazyImage
            src={d.bgImageUrl}
            alt=""
            wrapperClassName="w-full h-full"
            className="object-cover"
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg,rgba(0,0,0,.1) 0%,rgba(0,0,0,.35) 55%,rgba(0,0,0,.88) 100%)',
            }}
          />
        </div>
      ) : (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: `radial-gradient(60% 50% at 30% 70%, ${s.accent ?? '#65F5C9'}33, transparent 60%), #000`,
          }}
        />
      )}
      {/* Grain overlay */}
      <div
        className="absolute inset-0 opacity-[0.06] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        }}
      />

      <div className="relative z-10 max-w-7xl mx-auto w-full">
        {/* Eyebrow */}
        <div className="flex items-center gap-3 mb-6">
          <span
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              background: s.accent ?? '#65F5C9',
              boxShadow: `0 0 8px ${s.accent ?? '#65F5C9'}`,
            }}
          />
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow text"
          />
        </div>

        {/* Headline */}
        <h1
          className="font-light tracking-tight leading-[1.02] m-0"
          style={{ fontSize: 'clamp(40px,5.4vw,88px)', maxWidth: '1100px' }}
        >
          <Editable
            value={d.headlineTop}
            onChange={upd ? (v) => upd({ headlineTop: v }) : undefined}
            placeholder="your"
          />
          <br />
          <Editable
            value={d.headlineBottom}
            onChange={upd ? (v) => upd({ headlineBottom: v }) : undefined}
            tag="strong"
            className="font-bold"
            placeholder="engagement."
          />
        </h1>

        {/* Strap */}
        <Editable
          value={d.strap}
          onChange={upd ? (v) => upd({ strap: v }) : undefined}
          tag="p"
          className="mt-8 font-light leading-relaxed max-w-xl"
          style={{
            fontSize: 'clamp(17px,1.4vw,21px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Supporting copy..."
        />

        {/* Meta row */}
        <div
          className="mt-14 pt-8 grid grid-cols-2 md:grid-cols-4 gap-0"
          style={{ borderTop: '1px solid var(--block-border)' }}
        >
          {(d.metaItems ?? []).map((item, i) => (
            <div
              key={i}
              className={`pr-6 ${i > 0 ? 'pl-6 border-l border-white/10' : ''}`}
            >
              <div
                className="text-[10.5px] tracking-[0.18em] uppercase"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {updMeta ? (
                  <Editable
                    value={item.label}
                    onChange={(v) => updMeta(i, 'label', v)}
                    placeholder="Label"
                  />
                ) : (
                  item.label
                )}
              </div>
              <div className="text-[17px] font-medium mt-2 tracking-tight">
                {updMeta ? (
                  <Editable
                    value={item.value}
                    onChange={(v) => updMeta(i, 'value', v)}
                    placeholder="Value"
                  />
                ) : (
                  item.value
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// VALUE PANELS
// ============================================================
interface ValuePanelsRendererProps {
  block: Block;
  onDataChange?: (data: ValuePanelsData) => void;
}
export function ValuePanelsRenderer({
  block,
  onDataChange,
}: ValuePanelsRendererProps) {
  const d = block.data as ValuePanelsData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<ValuePanelsData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updPanel = upd
    ? (i: number, patch: Partial<(typeof d.panels)[0]>) => {
        const panels = [...d.panels];
        panels[i] = { ...panels[i], ...patch };
        upd({ panels });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <span
            className="font-mono text-[10px] tracking-[0.14em]"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            01
          </span>
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow"
          />
        </div>
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          className="font-light tracking-tight leading-none mt-6 mb-0"
          style={{ fontSize: 'clamp(40px,5vw,84px)', maxWidth: '1000px' }}
          placeholder="Headline"
        />
        <Editable
          value={d.lede}
          onChange={upd ? (v) => upd({ lede: v }) : undefined}
          tag="p"
          className="mt-7 font-light leading-relaxed max-w-2xl"
          style={{
            fontSize: 'clamp(17px,1.3vw,20px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Lede copy..."
        />

        {/* Panels grid */}
        <div
          className="mt-[72px] grid grid-cols-1 md:grid-cols-3 gap-px rounded-2xl overflow-hidden"
          style={{
            background: 'var(--block-border)',
            border: '1px solid var(--block-border)',
          }}
        >
          {(d.panels ?? []).map((panel, i) => (
            <div
              key={i}
              className="flex flex-col p-10 min-h-[320px]"
              style={{ background: 'var(--block-bg)' }}
            >
              <span
                className="font-mono text-[11px] tracking-[0.14em]"
                style={{ color: s.accent ?? '#65F5C9' }}
              >
                {updPanel ? (
                  <Editable
                    value={panel.num}
                    onChange={(v) => updPanel(i, { num: v })}
                    placeholder="01"
                  />
                ) : (
                  panel.num
                )}
              </span>
              <h4 className="text-[26px] font-semibold tracking-tight mt-[18px] mb-[14px] leading-tight max-w-[240px]">
                {updPanel ? (
                  <Editable
                    value={panel.title}
                    onChange={(v) => updPanel(i, { title: v })}
                    placeholder="Panel title"
                  />
                ) : (
                  panel.title
                )}
              </h4>
              <p
                className="text-[14px] leading-relaxed flex-1"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {updPanel ? (
                  <Editable
                    value={panel.body}
                    onChange={(v) => updPanel(i, { body: v })}
                    placeholder="Panel body..."
                  />
                ) : (
                  panel.body
                )}
              </p>
              {panel.corner && (
                <span
                  className="mt-6 text-[11px] tracking-[0.06em] uppercase"
                  style={{ color: 'var(--block-text-dim)' }}
                >
                  {updPanel ? (
                    <Editable
                      value={panel.corner ?? ''}
                      onChange={(v) => updPanel(i, { corner: v })}
                      placeholder="Corner tag"
                    />
                  ) : (
                    panel.corner
                  )}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// TEXT BLOCK
// ============================================================
interface TextBlockRendererProps {
  block: Block;
  onDataChange?: (data: TextBlockData) => void;
}
export function TextBlockRenderer({
  block,
  onDataChange,
}: TextBlockRendererProps) {
  const d = block.data as TextBlockData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<TextBlockData>) => onDataChange({ ...d, ...patch })
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          {d.eyebrowNum && (
            <span
              className="font-mono text-[10px] tracking-[0.14em]"
              style={{ color: s.accent ?? '#65F5C9' }}
            >
              {d.eyebrowNum}
            </span>
          )}
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow"
          />
        </div>
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          className="font-light tracking-tight leading-none mt-6 mb-0"
          style={{ fontSize: 'clamp(40px,5vw,84px)', maxWidth: '1000px' }}
          placeholder="Headline"
        />
        <Editable
          value={d.lede}
          onChange={upd ? (v) => upd({ lede: v }) : undefined}
          tag="p"
          className="mt-7 font-light leading-relaxed max-w-2xl"
          style={{
            fontSize: 'clamp(17px,1.3vw,20px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Lede copy..."
          richText={!!upd}
        />
      </div>
    </section>
  );
}
// ============================================================
// PRODUCT PICKER (used by PricingTableRenderer in edit mode)
// ============================================================
interface ProductPickerButtonProps {
  accent: string;
  currency?: string;
  onPick: (product: {
    id: string;
    name: string;
    description: string | null;
    basePriceCents: number;
    currency: string;
  }) => void;
}
function ProductPickerButton({ accent, onPick }: ProductPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: products } = useQuery({
    ...trpc.payments.pricing.listProducts.queryOptions({ brandId: brandId! }),
    enabled: !!brandId,
  });
  const filtered = (products ?? []).filter(
    (p) =>
      p.status === 'active' &&
      (!search || p.name.toLowerCase().includes(search.toLowerCase())),
  );
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[12px] flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all"
        style={{
          color: accent,
          background: `${accent}14`,
          border: `1px solid ${accent}30`,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <rect
            x="0.5"
            y="0.5"
            width="4"
            height="4"
            rx="0.8"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <rect
            x="6.5"
            y="0.5"
            width="4"
            height="4"
            rx="0.8"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <rect
            x="0.5"
            y="6.5"
            width="4"
            height="4"
            rx="0.8"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <rect
            x="6.5"
            y="6.5"
            width="4"
            height="4"
            rx="0.8"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
        From products
      </button>
      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 z-[200] rounded-xl shadow-2xl"
          style={{
            background: '#111',
            border: '1px solid rgba(255,255,255,0.12)',
            width: 280,
          }}
        >
          <div
            className="p-3 border-b"
            style={{ borderColor: 'rgba(255,255,255,0.08)' }}
          >
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full bg-transparent outline-none text-[12px] text-white placeholder-white/30"
            />
          </div>
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && (
              <div
                className="px-4 py-6 text-center text-[12px]"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                No products found
              </div>
            )}
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onPick(p as any);
                  setOpen(false);
                  setSearch('');
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
              >
                <div>
                  <div className="text-[13px] font-medium text-white">
                    {p.name}
                  </div>
                  {p.description && (
                    <div
                      className="text-[11px] mt-0.5"
                      style={{ color: 'rgba(255,255,255,0.45)' }}
                    >
                      {p.description.slice(0, 50)}
                    </div>
                  )}
                </div>
                <div
                  className="text-[12px] font-medium ml-3 flex-shrink-0"
                  style={{ color: accent }}
                >
                  {new Intl.NumberFormat('en-AU', {
                    style: 'currency',
                    currency: p.currency ?? 'AUD',
                    minimumFractionDigits: 0,
                  }).format(p.basePriceCents / 100)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PRICING TABLEE
// ============================================================
interface PricingTableRendererProps {
  block: Block;
  onDataChange?: (data: PricingTableData) => void;
  onAddLineItem?: () => void;
  interactiveMode?: boolean;
  onLineItemToggle?: (id: string, selected: boolean) => void;
  onQuantityChange?: (id: string, qty: number) => void;
}
export function PricingTableRenderer({
  block,
  onDataChange,
  onAddLineItem,
  interactiveMode,
  onLineItemToggle,
  onQuantityChange,
}: PricingTableRendererProps) {
  const d = block.data as PricingTableData;
  const s = block.styles;
  // Auto-recalculate totals from line items
  function calcTotals(items: typeof d.lineItems) {
    const subtotal = items
      .filter((it) => !it.optional || it.selected !== false)
      .reduce((s, it) => s + it.qty * it.unitCents, 0);
    const tax = d.taxRate
      ? Math.round((subtotal * d.taxRate) / 100)
      : (d.taxCents ?? 0);
    return { subtotalCents: subtotal, totalCents: subtotal + tax };
  }
  const upd = onDataChange
    ? (patch: Partial<PricingTableData>) => {
        const merged = { ...d, ...patch };
        // Always recalculate totals when lineItems change
        if (patch.lineItems) {
          const { subtotalCents, totalCents } = calcTotals(patch.lineItems);
          onDataChange({ ...merged, subtotalCents, totalCents });
        } else {
          onDataChange(merged);
        }
      }
    : undefined;
  const updLine = upd
    ? (i: number, patch: Partial<(typeof d.lineItems)[0]>) => {
        const items = [...d.lineItems];
        items[i] = { ...items[i], ...patch };
        upd({ lineItems: items });
      }
    : undefined;
  const removeLine = upd
    ? (i: number) => {
        const items = (d.lineItems ?? []).filter((_, idx) => idx !== i);
        upd({ lineItems: items });
      }
    : undefined;

  const visibleItems = (d.lineItems ?? []).filter(
    (item) => !item.optional || item.selected !== false,
  );
  const displayItems = interactiveMode ? d.lineItems : visibleItems;
  // Display totals: use live calculation for display, fall back to stored values
  const displaySubtotal = visibleItems.reduce(
    (s, it) => s + it.qty * it.unitCents,
    0,
  );
  const displayTax = d.taxRate
    ? Math.round((displaySubtotal * d.taxRate) / 100)
    : (d.taxCents ?? 0);
  const displayTotal = displaySubtotal + displayTax;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-2 mb-6">
          <span
            className="font-mono text-[10px] tracking-[0.14em]"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            02
          </span>
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow"
          />
        </div>
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          className="font-light tracking-tight leading-none mt-6 mb-0"
          style={{ fontSize: 'clamp(40px,5vw,84px)', maxWidth: '1000px' }}
          placeholder="Proposal title"
        />
        <Editable
          value={d.lede}
          onChange={upd ? (v) => upd({ lede: v }) : undefined}
          tag="p"
          className="mt-7 font-light leading-relaxed max-w-2xl"
          style={{
            fontSize: 'clamp(17px,1.3vw,20px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Lede copy..."
        />

        {/* Plan wrap */}
        <div className="mt-[72px] grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-[clamp(32px,4vw,64px)] items-start">
          {/* Line items */}
          <div>
            <div
              className="text-[11px] tracking-[0.18em] uppercase mb-2"
              style={{ color: 'var(--block-text-dim)' }}
            >
              What's included
            </div>
            {d.lineItems.length === 0 && (
              <div
                className="py-8 text-center text-sm"
                style={{
                  color: 'var(--block-text-dim)',
                  border: '1px dashed var(--block-border)',
                  borderRadius: '12px',
                }}
              >
                {upd ? 'Add line items from the Pricing tab →' : 'No items yet'}
              </div>
            )}
            {displayItems.map((item, i) => (
              <div
                key={item.id}
                className="group py-[14px] grid items-center gap-[18px]"
                style={{
                  borderBottom: '1px solid var(--block-border)',
                  gridTemplateColumns:
                    '28px minmax(0,1.4fr) minmax(0,1fr) auto',
                }}
              >
                {interactiveMode && item.optional ? (
                  <button
                    onClick={() =>
                      onLineItemToggle?.(item.id, item.selected === false)
                    }
                    className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      background:
                        item.selected !== false
                          ? `${s.accent ?? '#65F5C9'}14`
                          : 'transparent',
                      border: `1px solid ${item.selected !== false ? (s.accent ?? '#65F5C9') : 'rgba(255,255,255,0.2)'}`,
                    }}
                  >
                    {item.selected !== false && (
                      <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                        <path
                          d="M1 4L3.5 6.5L9 1"
                          stroke={s.accent ?? '#65F5C9'}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </button>
                ) : (
                  <div
                    className="w-[22px] h-[22px] rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: `${s.accent ?? '#65F5C9'}14`,
                      border: `1px solid ${s.accent ?? '#65F5C9'}40`,
                    }}
                  >
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                      <path
                        d="M1 4L3.5 6.5L9 1"
                        stroke={s.accent ?? '#65F5C9'}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
                <div>
                  <div className="text-[15px] font-medium tracking-tight flex items-center gap-2">
                    {updLine ? (
                      <Editable
                        value={item.name}
                        onChange={(v) => updLine(i, { name: v })}
                        placeholder="Item name"
                      />
                    ) : (
                      item.name
                    )}
                    {item.optional && (
                      <span
                        className="text-[10px] tracking-[0.1em] uppercase px-1.5 py-0.5 rounded"
                        style={{
                          background: 'var(--block-border)',
                          color: 'var(--block-text-dim)',
                        }}
                      >
                        Optional
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div
                      className="text-[12px] mt-[3px] leading-snug"
                      style={{ color: 'var(--block-text-dim)' }}
                    >
                      {updLine ? (
                        <Editable
                          value={item.description ?? ''}
                          onChange={(v) => updLine(i, { description: v })}
                          placeholder="Description"
                        />
                      ) : (
                        item.description
                      )}
                    </div>
                  )}
                </div>
                <div
                  className="text-[13px]"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {interactiveMode && item.isQuantityEditable ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() =>
                          onQuantityChange?.(item.id, Math.max(1, item.qty - 1))
                        }
                        className="w-6 h-6 rounded flex items-center justify-center transition-opacity hover:opacity-80"
                        style={{
                          background: 'var(--block-border)',
                          color: 'var(--block-text-muted)',
                        }}
                      >
                        <svg width="8" height="2" viewBox="0 0 8 2" fill="none">
                          <path
                            d="M1 1h6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <span
                        className="w-6 text-center font-medium"
                        style={{ color: 'var(--block-text)' }}
                      >
                        {item.qty}
                      </span>
                      <button
                        onClick={() =>
                          onQuantityChange?.(item.id, item.qty + 1)
                        }
                        className="w-6 h-6 rounded flex items-center justify-center transition-opacity hover:opacity-80"
                        style={{
                          background: 'var(--block-border)',
                          color: 'var(--block-text-muted)',
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path
                            d="M4 1v6M1 4h6"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                      <span className="ml-1">
                        × {fmtCents(item.unitCents, d.currency)}
                      </span>
                    </div>
                  ) : (
                    <>
                      {item.qty} × {fmtCents(item.unitCents, d.currency)}
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium">
                    {fmtCents(item.qty * item.unitCents, d.currency)}
                  </span>
                  {removeLine && (
                    <button
                      onClick={() => removeLine(i)}
                      className="w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--block-text-dim)' }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 10 10"
                        fill="none"
                      >
                        <path
                          d="M1 1L9 9M9 1L1 9"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
            {interactiveMode && (
              <div className="mt-8">
                <a
                  href="#accept-pay"
                  onClick={(e) => {
                    e.preventDefault();
                    document
                      .getElementById('accept-pay')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                  className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[14px] font-medium tracking-tight transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{
                    background: s.accent ?? '#65F5C9',
                    color: s.bg ?? '#000',
                  }}
                >
                  Choose payment options
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M7 1v12M1 7h12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      transform="rotate(45 7 7)"
                    />
                  </svg>
                </a>
              </div>
            )}
            {onAddLineItem && (
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={onAddLineItem}
                  className="text-[13px] flex items-center gap-2 transition-opacity hover:opacity-80"
                  style={{ color: s.accent ?? '#65F5C9' }}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path
                      d="M7 1v12M1 7h12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                  </svg>
                  Add line item
                </button>
                {upd && (
                  <ProductPickerButton
                    accent={s.accent ?? '#65F5C9'}
                    currency={d.currency}
                    onPick={(p) => {
                      const newItem = {
                        id: `li-${Date.now()}`,
                        name: p.name,
                        description: p.description ?? '',
                        qty: 1,
                        unitCents: p.basePriceCents,
                        taxBehaviour: 'exclusive' as const,
                        optional: false,
                        selected: true,
                      };
                      upd({ lineItems: [...d.lineItems, newItem] });
                    }}
                  />
                )}
              </div>
            )}
          </div>

          {/* Summary card — always uses live-calculated totals */}
          <div
            className="rounded-2xl p-9 sticky top-[92px]"
            style={{
              background: `linear-gradient(180deg,${s.bg ?? '#000'}ee 0%,${s.bg ?? '#000'} 100%)`,
              border: `1px solid ${s.accent ?? '#65F5C9'}40`,
              boxShadow: `0 32px 80px -32px ${s.accent ?? '#65F5C9'}4D`,
            }}
          >
            <div
              className="text-[13px] tracking-[0.1em] uppercase"
              style={{ color: 'var(--block-text-muted)' }}
            >
              Total investment
            </div>
            <div
              className="font-bold tracking-tight leading-none mt-4"
              style={{
                fontSize: 'clamp(56px,6vw,88px)',
                color: s.accent ?? '#65F5C9',
                textShadow: `0 0 40px ${s.accent ?? '#65F5C9'}4D`,
              }}
            >
              {fmtCents(displayTotal, d.currency)}
            </div>
            <div className="mt-6 space-y-0">
              {visibleItems.map((item, i) => (
                <div
                  key={i}
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    {item.name}
                    {item.qty > 1 ? ` ×${item.qty}` : ''}
                  </span>
                  <span className="font-medium">
                    {fmtCents(item.qty * item.unitCents, d.currency)}
                  </span>
                </div>
              ))}
              {displayTax > 0 && (
                <div
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    Subtotal
                  </span>
                  <span className="font-medium">
                    {fmtCents(displaySubtotal, d.currency)}
                  </span>
                </div>
              )}
              {displayTax > 0 && (
                <div
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    {d.taxLabel || 'GST'} ({d.taxRate ?? 10}%)
                  </span>
                  <span className="font-medium">
                    {fmtCents(displayTax, d.currency)}
                  </span>
                </div>
              )}
              {d.depositPercent && d.depositPercent > 0 && (
                <div
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    Deposit ({d.depositPercent}%)
                  </span>
                  <span className="font-medium">
                    {fmtCents(
                      Math.round((displayTotal * d.depositPercent) / 100),
                      d.currency,
                    )}
                  </span>
                </div>
              )}
              {d.paymentModel === 'payment_plan' && d.installments && (
                <div
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    Payment plan
                  </span>
                  <span className="font-medium">
                    {d.installments}×{' '}
                    {fmtCents(
                      Math.round(displayTotal / d.installments),
                      d.currency,
                    )}
                  </span>
                </div>
              )}
              {d.paymentModel === 'subscription' && d.billingInterval && (
                <div
                  className="flex justify-between py-3 text-[13.5px]"
                  style={{ borderBottom: '1px solid var(--block-border)' }}
                >
                  <span style={{ color: 'var(--block-text-muted)' }}>
                    Billing
                  </span>
                  <span className="font-medium capitalize">
                    {d.billingInterval}
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-5 text-[18px] font-semibold">
                <span>Total</span>
                <span>{fmtCents(displayTotal, d.currency)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// TEAM CARDS
// ============================================================
interface TeamCardsRendererProps {
  block: Block;
  onDataChange?: (data: TeamCardsData) => void;
}
export function TeamCardsRenderer({
  block,
  onDataChange,
}: TeamCardsRendererProps) {
  const d = block.data as TeamCardsData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<TeamCardsData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updMember = upd
    ? (i: number, patch: Partial<(typeof d.members)[0]>) => {
        const members = [...d.members];
        members[i] = { ...members[i], ...patch };
        upd({ members });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <span
            className="font-mono text-[10px] tracking-[0.14em]"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            03
          </span>
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow"
          />
        </div>
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          className="font-light tracking-tight leading-none mt-6 mb-0"
          style={{ fontSize: 'clamp(40px,5vw,84px)', maxWidth: '1000px' }}
          placeholder="Headline"
        />
        <Editable
          value={d.lede}
          onChange={upd ? (v) => upd({ lede: v }) : undefined}
          tag="p"
          className="mt-7 font-light leading-relaxed max-w-2xl"
          style={{
            fontSize: 'clamp(17px,1.3vw,20px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Lede copy..."
        />

        <div className="mt-[72px] grid grid-cols-1 md:grid-cols-2 gap-6">
          {(d.members ?? []).map((member, i) => (
            <div
              key={member.id}
              className="flex gap-6 items-center p-8 rounded-[18px]"
              style={{
                background: 'var(--block-card-bg)',
                border: '1px solid var(--block-border)',
              }}
            >
              <div
                className="w-[92px] h-[92px] rounded-full flex-shrink-0 flex items-center justify-center text-[28px] font-semibold tracking-tight"
                style={{
                  background: 'linear-gradient(135deg,#1c4541,#0a1f1d 80%)',
                  border: `1px solid ${s.accent ?? '#65F5C9'}40`,
                  color: '#a8e6d8',
                }}
              >
                {updMember ? (
                  <Editable
                    value={member.initials}
                    onChange={(v) => updMember(i, { initials: v })}
                    placeholder="SA"
                  />
                ) : (
                  member.initials
                )}
              </div>
              <div className="min-w-0">
                <h4 className="text-[20px] font-semibold tracking-tight m-0">
                  {updMember ? (
                    <Editable
                      value={member.name}
                      onChange={(v) => updMember(i, { name: v })}
                      placeholder="Name"
                    />
                  ) : (
                    member.name
                  )}
                </h4>
                <div
                  className="text-[12px] tracking-[0.14em] uppercase mt-[6px]"
                  style={{ color: s.accent ?? '#65F5C9' }}
                >
                  {updMember ? (
                    <Editable
                      value={member.role}
                      onChange={(v) => updMember(i, { role: v })}
                      placeholder="Role"
                    />
                  ) : (
                    member.role
                  )}
                </div>
                <p
                  className="text-[13.5px] mt-[10px] leading-relaxed m-0"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {updMember ? (
                    <Editable
                      value={member.bio}
                      onChange={(v) => updMember(i, { bio: v })}
                      placeholder="Short bio..."
                    />
                  ) : (
                    member.bio
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// ROADMAP
// ============================================================
interface RoadmapRendererProps {
  block: Block;
  onDataChange?: (data: RoadmapData) => void;
}
export function RoadmapRenderer({ block, onDataChange }: RoadmapRendererProps) {
  const d = block.data as RoadmapData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<RoadmapData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updStep = upd
    ? (i: number, patch: Partial<(typeof d.steps)[0]>) => {
        const steps = [...d.steps];
        steps[i] = { ...steps[i], ...patch };
        upd({ steps });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-6">
          <span
            className="font-mono text-[10px] tracking-[0.14em]"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            04
          </span>
          <Editable
            value={d.eyebrow}
            onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
            className="text-[11px] tracking-[0.18em] uppercase font-medium"
            style={{ color: 'var(--block-text-muted)' }}
            placeholder="Eyebrow"
          />
        </div>
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          className="font-light tracking-tight leading-none mt-6 mb-0"
          style={{ fontSize: 'clamp(40px,5vw,84px)', maxWidth: '1000px' }}
          placeholder="Headline"
        />
        <Editable
          value={d.lede}
          onChange={upd ? (v) => upd({ lede: v }) : undefined}
          tag="p"
          className="mt-7 font-light leading-relaxed max-w-2xl"
          style={{
            fontSize: 'clamp(17px,1.3vw,20px)',
            color: 'var(--block-text-muted)',
          }}
          placeholder="Lede copy..."
        />

        <div
          className="mt-[72px] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0"
          style={{ borderLeft: '1px solid var(--block-border)' }}
        >
          {(d.steps ?? []).map((step, i) => (
            <div
              key={step.id}
              className="px-7 py-7 relative"
              style={{ borderRight: '1px solid var(--block-border)' }}
            >
              <div
                className="absolute top-0 left-[-1px] w-[2px] h-8"
                style={{
                  background: s.accent ?? '#65F5C9',
                  boxShadow: `0 0 8px ${s.accent ?? '#65F5C9'}`,
                }}
              />
              <div
                className="font-mono text-[11px] tracking-[0.18em]"
                style={{ color: s.accent ?? '#65F5C9' }}
              >
                {updStep ? (
                  <Editable
                    value={step.stamp}
                    onChange={(v) => updStep(i, { stamp: v })}
                    placeholder="DAY 1"
                  />
                ) : (
                  step.stamp
                )}
              </div>
              <h5 className="text-[22px] font-medium tracking-tight mt-3 mb-[18px]">
                {updStep ? (
                  <Editable
                    value={step.title}
                    onChange={(v) => updStep(i, { title: v })}
                    placeholder="Step title"
                  />
                ) : (
                  step.title
                )}
              </h5>
              <p
                className="text-[13.5px] leading-relaxed m-0"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {updStep ? (
                  <Editable
                    value={step.body}
                    onChange={(v) => updStep(i, { body: v })}
                    placeholder="Step description..."
                  />
                ) : (
                  step.body
                )}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// IMAGE BANNER
// ============================================================
interface ImageBannerRendererProps {
  block: Block;
  onDataChange?: (data: ImageBannerData) => void;
}
export function ImageBannerRenderer({ block }: ImageBannerRendererProps) {
  const d = block.data as ImageBannerData;
  const s = block.styles;

  return (
    <section style={{ ...css(s), padding: '0' }}>
      {d.imageUrl ? (
        <div
          style={{ aspectRatio: d.aspectRatio ?? '16/9', overflow: 'hidden' }}
        >
          <LazyImage
            src={d.imageUrl}
            alt={d.alt ?? ''}
            wrapperClassName="w-full h-full"
            className="object-cover"
          />
        </div>
      ) : (
        <div
          className="flex items-center justify-center"
          style={{
            aspectRatio: d.aspectRatio ?? '16/9',
            background: 'var(--block-card-bg)',
            border: '2px dashed var(--block-border)',
          }}
        >
          <div
            className="text-center"
            style={{ color: 'var(--block-text-dim)' }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              className="mx-auto mb-3"
            >
              <rect
                x="4"
                y="8"
                width="40"
                height="32"
                rx="4"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <circle
                cx="16"
                cy="20"
                r="4"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M4 36l10-10 8 8 6-6 16 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-sm m-0">Click to upload image</p>
          </div>
        </div>
      )}
      {d.caption && (
        <p
          className="text-center text-[12px] py-3 m-0"
          style={{ color: 'var(--block-text-dim)' }}
        >
          {d.caption}
        </p>
      )}
    </section>
  );
}

// ============================================================
// DIVIDER
// ============================================================
export function DividerRenderer({ block }: { block: Block }) {
  const d = block.data as DividerData;
  const s = block.styles;
  if (d.style === 'space')
    return (
      <div style={{ height: d.height ?? 80, background: 'var(--block-bg)' }} />
    );
  if (d.style === 'line')
    return (
      <div
        style={{
          background: 'var(--block-bg)',
          padding: '0 clamp(24px,6vw,96px)',
        }}
      >
        <div style={{ height: '1px', background: 'var(--block-border)' }} />
      </div>
    );
  return (
    <div
      style={{
        height: d.height ?? 80,
        background: `linear-gradient(180deg, ${s.bg ?? '#000'} 0%, rgba(0,0,0,0) 100%)`,
      }}
    />
  );
}

// ============================================================
// ACCEPT & PAY
// ============================================================
interface AcceptPayRendererProps {
  block: Block;
  onDataChange?: (data: AcceptPayData) => void;
  totalCents?: number;
  currency?: string;
  lineItems?: PricingTableData['lineItems'];
  subtotalCents?: number;
  taxCents?: number;
  taxLabel?: string;
  onAccept?: () => void;
  accepted?: boolean;
  /** Real payment form injected from ProposalPublic (Stripe / DualOptionSection / PaymentPlanSection) */
  payElement?: React.ReactNode;
  paymentConfig?: {
    paymentModel?: string;
    subCadence?: string;
    subTerm?: string;
    subAutoRenew?: boolean;
    subSetupFeeEnabled?: boolean;
    subSetupFeeCents?: number;
    subSetupFeeLabel?: string;
    ppInstallments?: string;
    ppInterval?: string;
    ppDepositPct?: number;
    ppDepositLabel?: string;
    dualDiscountPct?: number;
    dualDiscountLabel?: string;
    commercialIntent?: string;
    minTermMonths?: number;
    commitmentEndDate?: string;
  };
}
export function AcceptPayRenderer({
  block,
  onDataChange,
  totalCents = 0,
  currency = 'AUD',
  lineItems = [],
  subtotalCents,
  taxCents,
  taxLabel = 'GST',
  onAccept,
  accepted,
  paymentConfig,
  payElement,
}: AcceptPayRendererProps) {
  const d = block.data as AcceptPayData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<AcceptPayData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const [dualChoice, setDualChoice] = React.useState<'upfront' | 'plan' | null>(
    null,
  );

  if (accepted) {
    return (
      <section
        className="relative min-h-screen flex items-center justify-center overflow-hidden"
        style={{ ...css(s), padding: '80px 24px' }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(60% 50% at 50% 30%, ${s.accent ?? '#65F5C9'}26, transparent 70%)`,
          }}
        />
        <div className="max-w-2xl text-center relative">
          <div
            className="w-[72px] h-[72px] rounded-full flex items-center justify-center mx-auto mb-7"
            style={{
              background: s.accent ?? '#65F5C9',
              boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}66`,
            }}
          >
            <svg width="28" height="22" viewBox="0 0 28 22" fill="none">
              <path
                d="M2 11L10 19L26 3"
                stroke="#000"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1
            className="font-light tracking-tight leading-none m-0"
            style={{ fontSize: 'clamp(48px,6vw,96px)' }}
          >
            {upd ? (
              <Editable
                value={d.postPayHeadline}
                onChange={(v) => upd({ postPayHeadline: v })}
                placeholder="You're in."
              />
            ) : (
              d.postPayHeadline
            )}
          </h1>
          <p
            className="text-[17px] leading-relaxed mt-6 mx-auto max-w-[560px]"
            style={{ color: 'var(--block-text-muted)' }}
          >
            {upd ? (
              <Editable
                value={d.postPayStrap}
                onChange={(v) => upd({ postPayStrap: v })}
                placeholder="Post-pay strap..."
              />
            ) : (
              d.postPayStrap
            )}
          </p>
          <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            {(d.postPaySteps ?? []).map((step, i) => (
              <div
                key={i}
                className="p-6 rounded-2xl"
                style={{
                  background: 'var(--block-card-bg)',
                  border: '1px solid var(--block-border)',
                }}
              >
                <div
                  className="font-mono text-[11px] tracking-[0.14em]"
                  style={{ color: s.accent ?? '#65F5C9' }}
                >
                  {step.stamp}
                </div>
                <h5 className="text-[17px] font-semibold tracking-tight mt-3 mb-2">
                  {step.title}
                </h5>
                <p
                  className="text-[13px] leading-relaxed m-0"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative overflow-hidden rounded-3xl mx-[clamp(24px,6vw,96px)] my-20"
      style={{
        ...css(s),
        padding: 'clamp(36px,5vw,64px)',
        border: `1px solid ${s.accent ?? '#65F5C9'}40`,
      }}
    >
      <div
        className="absolute inset-[-2px] top-[-2px] h-[280px] pointer-events-none opacity-60"
        style={{
          background: `radial-gradient(ellipse at 50% 0%, ${s.accent ?? '#65F5C9'}26, transparent 70%)`,
        }}
      />
      <div className="relative grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-[clamp(40px,5vw,80px)]">
        {/* Summary */}
        <div>
          <Editable
            value={d.headline}
            onChange={upd ? (v) => upd({ headline: v }) : undefined}
            tag="h2"
            className="font-light tracking-tight leading-tight m-0"
            style={{ fontSize: 'clamp(32px,4vw,56px)' }}
            placeholder="Confirm the engagement."
          />
          <Editable
            value={d.lede}
            onChange={upd ? (v) => upd({ lede: v }) : undefined}
            tag="p"
            className="mt-4 leading-relaxed"
            style={{ fontSize: '15px', color: 'var(--block-text-muted)' }}
            placeholder="Lede copy..."
          />
          <div className="mt-8">
            {lineItems.map((item, i) => (
              <div
                key={i}
                className="flex justify-between py-[14px] text-[14.5px]"
                style={{ borderBottom: '1px solid var(--block-border)' }}
              >
                <span style={{ color: 'var(--block-text-muted)' }}>
                  {item.name}
                </span>
                <span className="font-medium">
                  {fmtCents(item.qty * item.unitCents, currency)}
                </span>
              </div>
            ))}
            {subtotalCents !== undefined && subtotalCents !== totalCents && (
              <div
                className="flex justify-between py-[14px] text-[14.5px]"
                style={{ borderBottom: '1px solid var(--block-border)' }}
              >
                <span style={{ color: 'var(--block-text-muted)' }}>
                  Subtotal
                </span>
                <span className="font-medium">
                  {fmtCents(subtotalCents, currency)}
                </span>
              </div>
            )}
            {taxCents !== undefined && taxCents > 0 && (
              <div
                className="flex justify-between py-[14px] text-[14.5px]"
                style={{ borderBottom: '1px solid var(--block-border)' }}
              >
                <span style={{ color: 'var(--block-text-muted)' }}>
                  {taxLabel} (
                  {Math.round((taxCents / (subtotalCents ?? totalCents)) * 100)}
                  %)
                </span>
                <span className="font-medium">
                  {fmtCents(taxCents, currency)}
                </span>
              </div>
            )}
            <div className="flex justify-between pt-[22px] text-[18px] font-semibold">
              <span>
                {paymentConfig?.paymentModel === 'subscription' &&
                paymentConfig.subCadence
                  ? `Recurring · ${paymentConfig.subCadence.charAt(0).toUpperCase() + paymentConfig.subCadence.slice(1)}`
                  : paymentConfig?.paymentModel === 'payment-plan' ||
                      paymentConfig?.paymentModel === 'payment_plan'
                    ? 'Total (payment plan)'
                    : 'Total'}
              </span>
              <span>{fmtCents(totalCents, currency)}</span>
            </div>
          </div>
          <p
            className="mt-6 text-[12px] leading-relaxed"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {upd ? (
              <Editable
                value={d.termsText}
                onChange={(v) => upd({ termsText: v })}
                placeholder="Terms text..."
              />
            ) : (
              d.termsText
            )}
          </p>

          {/* Engagement summary — ITEM-9f */}
          {paymentConfig &&
            (() => {
              const pm = paymentConfig.paymentModel;
              const rows: { label: string; value: string }[] = [];
              if (pm === 'subscription') {
                // Cadence / billing frequency — most important row
                const cadence = paymentConfig.subCadence || 'monthly';
                const cadenceLabel =
                  cadence.charAt(0).toUpperCase() + cadence.slice(1);
                rows.push({ label: 'Billing', value: cadenceLabel });
                // Recurring amount per period
                rows.push({
                  label: 'Recurring amount',
                  value: `${fmtCents(totalCents, currency)} / ${cadence}`,
                });
                // Term
                if (
                  paymentConfig.subTerm &&
                  paymentConfig.subTerm !== 'open-ended'
                ) {
                  const termMap: Record<string, string> = {
                    '3m': '3 months',
                    '6m': '6 months',
                    '12m': '12 months',
                    '18m': '18 months',
                    '24m': '24 months',
                    '36m': '36 months',
                  };
                  rows.push({
                    label: 'Term',
                    value:
                      termMap[paymentConfig.subTerm] ?? paymentConfig.subTerm,
                  });
                } else {
                  rows.push({ label: 'Term', value: 'Open-ended' });
                }
                rows.push({
                  label: 'Renewal',
                  value: paymentConfig.subAutoRenew
                    ? 'Auto-renews'
                    : 'Does not auto-renew',
                });
                if (
                  paymentConfig.subSetupFeeEnabled &&
                  paymentConfig.subSetupFeeCents &&
                  paymentConfig.subSetupFeeCents > 0
                ) {
                  rows.push({
                    label: paymentConfig.subSetupFeeLabel || 'Setup fee',
                    value:
                      fmtCents(paymentConfig.subSetupFeeCents, currency) +
                      ' (charged today)',
                  });
                }
                if (
                  paymentConfig.commercialIntent === 'hybrid' &&
                  paymentConfig.commitmentEndDate
                ) {
                  rows.push({
                    label: 'Commitment ends',
                    value: new Date(
                      paymentConfig.commitmentEndDate,
                    ).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    }),
                  });
                }
              } else if (
                pm === 'payment-plan' ||
                pm === 'payment_plan' ||
                pm === 'pay_plan'
              ) {
                const n = parseInt(paymentConfig.ppInstallments ?? '3') || 3;
                const interval = paymentConfig.ppInterval ?? 'monthly';
                rows.push({
                  label: 'Schedule',
                  value: `${n} ${interval} instalments`,
                });
                if (
                  paymentConfig.ppDepositPct &&
                  paymentConfig.ppDepositPct > 0
                ) {
                  const depositCents = Math.round(
                    (totalCents * paymentConfig.ppDepositPct) / 100,
                  );
                  rows.push({
                    label: paymentConfig.ppDepositLabel || 'Deposit',
                    value: `${fmtCents(depositCents, currency)} (charged today)`,
                  });
                }
                rows.push({
                  label: 'Final payment',
                  value: `After ${n} ${interval} instalments`,
                });
              } else if (pm === 'dual_option') {
                const disc = paymentConfig.dualDiscountPct ?? 0;
                if (disc > 0) {
                  const discountedCents = Math.round(
                    totalCents * (1 - disc / 100),
                  );
                  rows.push({
                    label: 'Upfront option',
                    value: `${fmtCents(discountedCents, currency)} (${disc}% off)`,
                  });
                }
                const n = parseInt(paymentConfig.ppInstallments ?? '3') || 3;
                const depPct = (paymentConfig.ppDepositPct as number) ?? 0;
                const depCents =
                  depPct > 0 ? Math.round((totalCents * depPct) / 100) : 0;
                const remainingCents = totalCents - depCents;
                const instCents = Math.round(remainingCents / n);
                const depLabel = paymentConfig.ppDepositLabel || 'deposit';
                const planDesc =
                  depPct > 0
                    ? `${depPct}% ${depLabel} (${fmtCents(depCents, currency)}) + ${n} × ${fmtCents(instCents, currency)}`
                    : `${n} instalments of ${fmtCents(Math.round(totalCents / n), currency)}`;
                rows.push({ label: 'Pay plan option', value: planDesc });
              }
              if (rows.length === 0) return null;
              return (
                <div
                  className="mt-6 rounded-xl p-4"
                  style={{
                    background: 'var(--block-card-bg)',
                    border: '1px solid var(--block-border)',
                  }}
                >
                  <div
                    className="text-[11px] tracking-[0.14em] uppercase font-medium mb-3"
                    style={{ color: 'var(--block-text-dim)' }}
                  >
                    Engagement details
                  </div>
                  {rows.map((row, i) => (
                    <div
                      key={i}
                      className="flex justify-between py-[8px] text-[13px]"
                      style={{
                        borderBottom:
                          i < rows.length - 1
                            ? '1px solid var(--block-border)'
                            : 'none',
                      }}
                    >
                      <span style={{ color: 'var(--block-text-muted)' }}>
                        {row.label}
                      </span>
                      <span className="font-medium">{row.value}</span>
                    </div>
                  ))}
                </div>
              );
            })()}
        </div>

        {/* Payment form — real form when payElement is injected, static preview otherwise */}
        <div
          className="rounded-2xl p-7"
          style={{
            background: 'var(--block-card-bg)',
            border: '1px solid var(--block-border)',
          }}
        >
          {payElement ? (
            // Real payment form injected from ProposalPublic
            <div>{payElement}</div>
          ) : paymentConfig?.paymentModel === 'dual_option' ? (
            // Dual-option static preview chooser
            (() => {
              const discPct = paymentConfig.dualDiscountPct ?? 0;
              const upfrontCents = Math.round(
                totalCents * (1 - (discPct as number) / 100),
              );
              const depPct = (paymentConfig.ppDepositPct as number) ?? 0;
              const installs = Math.max(
                2,
                parseInt(String(paymentConfig.ppInstallments ?? '3'), 10),
              );
              const depCents =
                depPct > 0
                  ? Math.round((totalCents * depPct) / 100)
                  : Math.round(totalCents / installs);
              const interval = String(paymentConfig.ppInterval ?? 'monthly');
              const fmt = (c: number) => fmtCents(c, currency);
              if (!dualChoice) {
                return (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                    }}
                  >
                    <div
                      className="text-[11px] tracking-[0.12em] uppercase font-medium mb-1"
                      style={{ color: 'var(--block-text-dim)' }}
                    >
                      Choose how you'd like to pay
                    </div>
                    {/* Upfront option */}
                    <button
                      onClick={() => setDualChoice('upfront')}
                      className="text-left w-full rounded-xl p-4 transition-all"
                      style={{
                        background: `${s.accent ?? '#65F5C9'}0D`,
                        border: `1px solid ${s.accent ?? '#65F5C9'}40`,
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-[15px]">
                          {String(
                            paymentConfig.dualDiscountLabel || 'Pay upfront',
                          )}
                        </span>
                        <span
                          className="font-bold text-[18px]"
                          style={{
                            color: s.accent ?? '#65F5C9',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {fmt(upfrontCents)}
                        </span>
                      </div>
                      {(discPct as number) > 0 && (
                        <div
                          className="text-[12px]"
                          style={{ color: 'var(--block-text-muted)' }}
                        >
                          Save {discPct}% — pay in full today
                        </div>
                      )}
                    </button>
                    {/* Payment plan option */}
                    <button
                      onClick={() => setDualChoice('plan')}
                      className="text-left w-full rounded-xl p-4 transition-all"
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-[15px]">
                          Payment plan
                        </span>
                        <span
                          className="font-bold text-[18px]"
                          style={{ fontVariantNumeric: 'tabular-nums' }}
                        >
                          {fmt(depCents)} today
                        </span>
                      </div>
                      <div
                        className="text-[12px]"
                        style={{ color: 'var(--block-text-muted)' }}
                      >
                        {depPct > 0 ? `${depPct}% deposit, then ` : ''}
                        {installs} payments of{' '}
                        {fmt(Math.round((totalCents - depCents) / installs))} ·{' '}
                        {interval}
                      </div>
                    </button>
                  </div>
                );
              }
              // After choice — show card form with selected amount
              const chosenCents =
                dualChoice === 'upfront' ? upfrontCents : depCents;
              return (
                <>
                  <button
                    onClick={() => setDualChoice(null)}
                    className="text-[12px] mb-4 flex items-center gap-1"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--block-text-muted)',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ← Change option
                  </button>
                  <div
                    className="text-[12px] mb-4"
                    style={{ color: 'var(--block-text-muted)' }}
                  >
                    {dualChoice === 'upfront'
                      ? `Paying ${fmt(chosenCents)} upfront`
                      : `Paying ${fmt(chosenCents)} deposit today`}
                  </div>
                  <div className="flex items-center gap-2 mb-5">
                    <div
                      className="text-[11px] tracking-[0.14em] uppercase font-medium"
                      style={{ color: 'var(--block-text-dim)' }}
                    >
                      Pay by card
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      {['visa', 'mc', 'amex'].map((brand) => (
                        <div
                          key={brand}
                          className="rounded px-[6px] py-[3px] text-[10px] font-semibold"
                          style={{
                            background: 'var(--block-border)',
                            color: 'var(--block-text-dim)',
                          }}
                        >
                          {brand.toUpperCase()}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {['Card number', 'Expiry date / CVC', 'Country'].map(
                      (label) => (
                        <div key={label}>
                          <div
                            className="text-[11px] tracking-[0.14em] uppercase mb-[6px]"
                            style={{ color: 'var(--block-text-dim)' }}
                          >
                            {label}
                          </div>
                          <div
                            className="rounded-lg px-4 py-[14px] text-[14px]"
                            style={{
                              background: '#000',
                              border: '1px solid var(--block-border)',
                              color: 'var(--block-text-dim)',
                            }}
                          >
                            {label === 'Card number'
                              ? '•••• •••• •••• ••••'
                              : label === 'Expiry date / CVC'
                                ? 'MM/YY  •  CVC'
                                : 'Australia'}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                  {onAccept ? (
                    <button
                      onClick={onAccept}
                      className="w-full mt-5 py-4 rounded-full text-[15px] font-medium transition-transform active:scale-[0.97]"
                      style={{
                        background: s.accent ?? '#65F5C9',
                        color: '#000',
                        boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}40`,
                      }}
                    >
                      {d.ctaLabel} {fmt(chosenCents)} →
                    </button>
                  ) : (
                    <div
                      className="w-full mt-5 py-4 rounded-full text-[15px] font-medium text-center"
                      style={{
                        background: s.accent ?? '#65F5C9',
                        color: '#000',
                        opacity: 0.6,
                      }}
                    >
                      {d.ctaLabel} {fmt(chosenCents)} →
                    </div>
                  )}
                  <div
                    className="flex items-center gap-2 mt-4 justify-center text-[11px]"
                    style={{ color: 'var(--block-text-dim)' }}
                  >
                    <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                      <rect
                        x="1"
                        y="6"
                        width="10"
                        height="7"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M3 6V4a3 3 0 0 1 6 0v2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    Secure, checkout with Stripe
                  </div>
                </>
              );
            })()
          ) : paymentConfig?.paymentModel === 'payment-plan' ||
            paymentConfig?.paymentModel === 'payment_plan' ||
            paymentConfig?.paymentModel === 'pay_plan' ? (
            // Payment plan static preview — show installment schedule
            (() => {
              const n = Math.max(
                2,
                parseInt(String(paymentConfig?.ppInstallments ?? '3'), 10),
              );
              const interval = String(paymentConfig?.ppInterval ?? 'monthly');
              const depPct = (paymentConfig?.ppDepositPct as number) ?? 0;
              const depLabel =
                (paymentConfig?.ppDepositLabel as string) || 'Deposit';
              const depCents =
                depPct > 0 ? Math.round((totalCents * depPct) / 100) : 0;
              const remainingCents = totalCents - depCents;
              const instCents = Math.round(remainingCents / n);
              const fmt = (c: number) => fmtCents(c, currency);
              const installments = Array.from({ length: n }, (_, i) => ({
                label:
                  depPct > 0 && i === 0
                    ? depLabel
                    : `Instalment ${depPct > 0 ? i : i + 1}`,
                amount: depPct > 0 && i === 0 ? depCents : instCents,
                timing:
                  depPct > 0 && i === 0
                    ? 'Today'
                    : `${interval.charAt(0).toUpperCase() + interval.slice(1)} ${i + (depPct > 0 ? 0 : 1)}`,
                isDeposit: depPct > 0 && i === 0,
              }));
              return (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <div
                    className="text-[11px] tracking-[0.14em] uppercase font-medium mb-1"
                    style={{ color: 'var(--block-text-dim)' }}
                  >
                    Payment schedule
                  </div>
                  {installments.map((ins, i) => (
                    <div
                      key={i}
                      className="flex justify-between items-center rounded-xl px-4 py-3 text-[13px]"
                      style={{
                        background: ins.isDeposit
                          ? `${s.accent ?? '#65F5C9'}15`
                          : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${ins.isDeposit ? `${s.accent ?? '#65F5C9'}40` : 'rgba(255,255,255,0.08)'}`,
                      }}
                    >
                      <div>
                        <div className="font-semibold">{ins.label}</div>
                        <div
                          className="text-[11px]"
                          style={{ color: 'var(--block-text-muted)' }}
                        >
                          {ins.timing}
                        </div>
                      </div>
                      <div
                        className="font-bold"
                        style={{
                          fontVariantNumeric: 'tabular-nums',
                          color: ins.isDeposit
                            ? (s.accent ?? '#65F5C9')
                            : 'inherit',
                        }}
                      >
                        {fmt(ins.amount)}
                      </div>
                    </div>
                  ))}
                  {onAccept ? (
                    <button
                      onClick={onAccept}
                      className="w-full mt-3 py-4 rounded-full text-[15px] font-medium transition-transform active:scale-[0.97]"
                      style={{
                        background: s.accent ?? '#65F5C9',
                        color: '#000',
                        boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}40`,
                      }}
                    >
                      {depPct > 0
                        ? `${d.ctaLabel} ${fmt(depCents)} deposit today →`
                        : `${d.ctaLabel} ${fmt(instCents)} × ${n} ${interval} →`}
                    </button>
                  ) : (
                    <div
                      className="w-full mt-3 py-4 rounded-full text-[15px] font-medium text-center"
                      style={{
                        background: s.accent ?? '#65F5C9',
                        color: '#000',
                        opacity: 0.6,
                      }}
                    >
                      {depPct > 0
                        ? `${d.ctaLabel} ${fmt(depCents)} deposit today →`
                        : `${d.ctaLabel} ${fmt(instCents)} × ${n} ${interval} →`}
                    </div>
                  )}
                  <div
                    className="flex items-center gap-2 mt-2 justify-center text-[11px]"
                    style={{ color: 'var(--block-text-dim)' }}
                  >
                    <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                      <rect
                        x="1"
                        y="6"
                        width="10"
                        height="7"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                      />
                      <path
                        d="M3 6V4a3 3 0 0 1 6 0v2"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                    Secure, checkout with Stripe
                  </div>
                </div>
              );
            })()
          ) : (
            // Static preview (builder / template preview)
            <>
              <div className="flex items-center gap-2 mb-5">
                <div
                  className="text-[11px] tracking-[0.14em] uppercase font-medium"
                  style={{ color: 'var(--block-text-dim)' }}
                >
                  Pay by card
                </div>
                <div className="flex items-center gap-1 ml-auto">
                  {['visa', 'mc', 'amex'].map((brand) => (
                    <div
                      key={brand}
                      className="rounded px-[6px] py-[3px] text-[10px] font-semibold"
                      style={{
                        background: 'var(--block-border)',
                        color: 'var(--block-text-dim)',
                      }}
                    >
                      {brand.toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                {['Card number', 'Expiry date / CVC', 'Country'].map(
                  (label) => (
                    <div key={label}>
                      <div
                        className="text-[11px] tracking-[0.14em] uppercase mb-[6px]"
                        style={{ color: 'var(--block-text-dim)' }}
                      >
                        {label}
                      </div>
                      <div
                        className="rounded-lg px-4 py-[14px] text-[14px]"
                        style={{
                          background: '#000',
                          border: '1px solid var(--block-border)',
                          color: 'var(--block-text-dim)',
                        }}
                      >
                        {label === 'Card number'
                          ? '•••• •••• •••• ••••'
                          : label === 'Expiry date / CVC'
                            ? 'MM/YY  •  CVC'
                            : 'Australia'}
                      </div>
                    </div>
                  ),
                )}
              </div>
              {(() => {
                const pm = paymentConfig?.paymentModel;
                const isSub = pm === 'subscription';
                const isPP =
                  pm === 'payment-plan' ||
                  pm === 'payment_plan' ||
                  pm === 'pay_plan';
                const cadence = paymentConfig?.subCadence || '';
                const cadenceSuffix = isSub && cadence ? ` / ${cadence}` : '';
                const setupCents =
                  isSub &&
                  paymentConfig?.subSetupFeeEnabled &&
                  paymentConfig.subSetupFeeCents
                    ? paymentConfig.subSetupFeeCents
                    : 0;
                // For payment plan: show deposit or first installment amount
                let btnLabel: string;
                if (isSub) {
                  // Subscription: totalCents IS the per-period recurring amount
                  btnLabel =
                    setupCents > 0
                      ? `${d.ctaLabel} ${fmtCents(setupCents, currency)} today + ${fmtCents(totalCents, currency)}${cadenceSuffix} →`
                      : `${d.ctaLabel} ${fmtCents(totalCents, currency)}${cadenceSuffix} →`;
                } else if (isPP) {
                  const depPct = (paymentConfig?.ppDepositPct as number) ?? 0;
                  const n = Math.max(
                    2,
                    parseInt(String(paymentConfig?.ppInstallments ?? '3'), 10),
                  );
                  const interval = String(
                    paymentConfig?.ppInterval ?? 'monthly',
                  );
                  if (depPct > 0) {
                    const depositCents = Math.round(
                      (totalCents * depPct) / 100,
                    );
                    btnLabel = `${d.ctaLabel} ${fmtCents(depositCents, currency)} deposit today →`;
                  } else {
                    const instCents = Math.round(totalCents / n);
                    btnLabel = `${d.ctaLabel} ${fmtCents(instCents, currency)} × ${n} ${interval} →`;
                  }
                } else {
                  btnLabel = `${d.ctaLabel} ${fmtCents(totalCents, currency)} →`;
                }
                return onAccept ? (
                  <button
                    onClick={onAccept}
                    className="w-full mt-5 py-4 rounded-full text-[15px] font-medium transition-transform active:scale-[0.97]"
                    style={{
                      background: s.accent ?? '#65F5C9',
                      color: '#000',
                      boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}40`,
                    }}
                  >
                    {btnLabel}
                  </button>
                ) : (
                  <div
                    className="w-full mt-5 py-4 rounded-full text-[15px] font-medium text-center"
                    style={{
                      background: s.accent ?? '#65F5C9',
                      color: '#000',
                      opacity: 0.6,
                    }}
                  >
                    {btnLabel}
                  </div>
                );
              })()}
              <div
                className="flex items-center gap-2 mt-4 justify-center text-[11px]"
                style={{ color: 'var(--block-text-dim)' }}
              >
                <svg width="12" height="14" viewBox="0 0 12 14" fill="none">
                  <rect
                    x="1"
                    y="6"
                    width="10"
                    height="7"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                  <path
                    d="M3 6V4a3 3 0 0 1 6 0v2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
                Secure, checkout with Stripe
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// VIDEO
// ============================================================
function getVideoEmbedUrl(url: string): string | null {
  if (!url) return null;
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
  );
  if (ytMatch)
    return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0&modestbranding=1`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch)
    return `https://player.vimeo.com/video/${vimeoMatch[1]}?color=65F5C9&title=0&byline=0&portrait=0`;
  // Loom
  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9]+)/);
  if (loomMatch) return `https://www.loom.com/embed/${loomMatch[1]}`;
  // Direct mp4 or other
  return null;
}

interface VideoRendererProps {
  block: Block;
  onDataChange?: (data: VideoData) => void;
}
export function VideoRenderer({ block, onDataChange }: VideoRendererProps) {
  const d = block.data as VideoData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<VideoData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const embedUrl = getVideoEmbedUrl(d.url);

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(60px,8vw,120px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {(d.eyebrow || d.headline || d.lede) && (
          <div className="mb-10 text-center">
            {d.eyebrow && (
              <div
                className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
                style={{ color: s.accent ?? '#65F5C9' }}
              >
                {upd ? (
                  <Editable
                    value={d.eyebrow}
                    onChange={(v) => upd({ eyebrow: v })}
                    placeholder="Eyebrow"
                  />
                ) : (
                  d.eyebrow
                )}
              </div>
            )}
            {d.headline && (
              <h2
                className="font-light tracking-tight leading-tight m-0 mb-4"
                style={{ fontSize: 'clamp(28px,3.5vw,52px)' }}
              >
                {upd ? (
                  <Editable
                    value={d.headline}
                    onChange={(v) => upd({ headline: v })}
                    placeholder="Headline"
                  />
                ) : (
                  d.headline
                )}
              </h2>
            )}
            {d.lede && (
              <p
                className="text-[16px] leading-relaxed m-0 max-w-2xl mx-auto"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {upd ? (
                  <Editable
                    value={d.lede}
                    onChange={(v) => upd({ lede: v })}
                    placeholder="Lede..."
                  />
                ) : (
                  d.lede
                )}
              </p>
            )}
          </div>
        )}
        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            aspectRatio: d.aspectRatio ?? '16/9',
            background: 'var(--block-card-bg)',
            border: '1px solid var(--block-border)',
          }}
        >
          {embedUrl ? (
            <iframe
              src={embedUrl}
              className="absolute inset-0 w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              frameBorder="0"
            />
          ) : d.url && d.url.match(/\.(mp4|webm|ogg)$/i) ? (
            <video
              src={d.url}
              controls
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-4"
              style={{ color: 'var(--block-text-dim)' }}
            >
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <circle
                  cx="28"
                  cy="28"
                  r="26"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M22 20l16 8-16 8V20z"
                  fill="currentColor"
                  opacity="0.6"
                />
              </svg>
              {upd ? (
                <div className="w-full max-w-sm px-6">
                  <input
                    type="text"
                    defaultValue={d.url}
                    onBlur={(e) => upd({ url: e.target.value })}
                    placeholder="Paste YouTube, Vimeo, or Loom URL..."
                    className="w-full bg-transparent border-b text-sm text-center outline-none py-2"
                    style={{
                      borderColor: 'var(--block-text-subtle)',
                      color: 'var(--block-text-muted)',
                    }}
                  />
                </div>
              ) : (
                <p className="text-sm m-0">Video URL not set</p>
              )}
            </div>
          )}
        </div>
        {d.caption && (
          <p
            className="text-center text-[12px] mt-4 m-0"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {upd ? (
              <Editable
                value={d.caption}
                onChange={(v) => upd({ caption: v })}
                placeholder="Caption..."
              />
            ) : (
              d.caption
            )}
          </p>
        )}
      </div>
    </section>
  );
}

// ============================================================
// TESTIMONIAL
// ============================================================
interface TestimonialRendererProps {
  block: Block;
  onDataChange?: (data: TestimonialData) => void;
}
export function TestimonialRenderer({
  block,
  onDataChange,
}: TestimonialRendererProps) {
  const d = block.data as TestimonialData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<TestimonialData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updItem = upd
    ? (i: number, patch: Partial<(typeof d.items)[0]>) => {
        const items = [...d.items];
        items[i] = { ...items[i], ...patch };
        upd({ items });
      }
    : undefined;
  const [activeIdx, setActiveIdx] = useState(0);

  const StarRating = ({ rating = 5 }: { rating?: number }) => (
    <div className="flex gap-1 mb-4">
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill={
            n <= rating ? (s.accent ?? '#65F5C9') : 'var(--block-text-subtle)'
          }
        >
          <path d="M7 1l1.5 4h4l-3.5 2.5 1.5 4L7 9l-3.5 2.5 1.5-4L1.5 5h4z" />
        </svg>
      ))}
    </div>
  );

  const renderCard = (item: (typeof d.items)[0], i: number) => (
    <div
      key={item.id}
      className="flex flex-col p-8 rounded-2xl h-full"
      style={{
        background: 'var(--block-card-bg)',
        border: '1px solid var(--block-border)',
      }}
    >
      <StarRating rating={item.rating} />
      <blockquote
        className="text-[16px] leading-relaxed flex-1 m-0 mb-6"
        style={{ color: 'var(--block-text-muted)' }}
      >
        "
        {updItem ? (
          <Editable
            value={item.quote}
            onChange={(v) => updItem(i, { quote: v })}
            placeholder="Client quote..."
          />
        ) : (
          item.quote
        )}
        "
      </blockquote>
      <div className="flex items-center gap-3 mt-auto">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
          style={{
            background: `${s.accent ?? '#65F5C9'}20`,
            color: s.accent ?? '#65F5C9',
          }}
        >
          {item.avatarInitials ?? item.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <div className="text-[14px] font-semibold">
            {updItem ? (
              <Editable
                value={item.name}
                onChange={(v) => updItem(i, { name: v })}
                placeholder="Name"
              />
            ) : (
              item.name
            )}
          </div>
          <div
            className="text-[12px]"
            style={{ color: 'var(--block-text-muted)' }}
          >
            {updItem ? (
              <Editable
                value={item.title}
                onChange={(v) => updItem(i, { title: v })}
                placeholder="Title"
              />
            ) : (
              item.title
            )}
            {' · '}
            {updItem ? (
              <Editable
                value={item.company}
                onChange={(v) => updItem(i, { company: v })}
                placeholder="Company"
              />
            ) : (
              item.company
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <div
            className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="What clients say"
              />
            ) : (
              d.eyebrow
            )}
          </div>
          {d.headline && (
            <h2
              className="font-light tracking-tight leading-tight m-0"
              style={{ fontSize: 'clamp(32px,4vw,64px)' }}
            >
              {upd ? (
                <Editable
                  value={d.headline}
                  onChange={(v) => upd({ headline: v })}
                  placeholder="Headline"
                />
              ) : (
                d.headline
              )}
            </h2>
          )}
        </div>

        {d.layout === 'carousel' ? (
          <div>
            <div className="max-w-2xl mx-auto">
              {renderCard(d.items[activeIdx], activeIdx)}
            </div>
            <div className="flex justify-center gap-2 mt-6">
              {(d.items ?? []).map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className="w-2 h-2 rounded-full transition-all"
                  style={{
                    background:
                      i === activeIdx
                        ? (s.accent ?? '#65F5C9')
                        : 'var(--block-text-subtle)',
                  }}
                />
              ))}
            </div>
          </div>
        ) : d.layout === 'single' ? (
          <div className="max-w-2xl mx-auto">{renderCard(d.items[0], 0)}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(d.items ?? []).map((item, i) => renderCard(item, i))}
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================
// CASE STUDY
// ============================================================
interface CaseStudyRendererProps {
  block: Block;
  onDataChange?: (data: CaseStudyData) => void;
}
export function CaseStudyRenderer({
  block,
  onDataChange,
}: CaseStudyRendererProps) {
  const d = block.data as CaseStudyData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<CaseStudyData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updStat = upd
    ? (i: number, patch: Partial<(typeof d.stats)[0]>) => {
        const stats = [...d.stats];
        stats[i] = { ...stats[i], ...patch };
        upd({ stats });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <div
              className="text-[11px] tracking-[0.18em] uppercase font-medium mb-6"
              style={{ color: s.accent ?? '#65F5C9' }}
            >
              {upd ? (
                <Editable
                  value={d.eyebrow}
                  onChange={(v) => upd({ eyebrow: v })}
                  placeholder="Case study"
                />
              ) : (
                d.eyebrow
              )}
            </div>
            {/* Logo / client name */}
            <div
              className="inline-flex items-center px-4 py-2 rounded-lg mb-8"
              style={{
                background: 'var(--block-border)',
                border: '1px solid var(--block-border)',
              }}
            >
              <span
                className="text-[13px] font-semibold tracking-[0.1em] uppercase"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {upd ? (
                  <Editable
                    value={d.logoText ?? d.clientName}
                    onChange={(v) => upd({ logoText: v })}
                    placeholder="CLIENT"
                  />
                ) : (
                  (d.logoText ?? d.clientName)
                )}
              </span>
            </div>
            <h2
              className="font-light tracking-tight leading-tight m-0 mb-6"
              style={{ fontSize: 'clamp(32px,4vw,56px)' }}
            >
              {upd ? (
                <Editable
                  value={d.headline}
                  onChange={(v) => upd({ headline: v })}
                  placeholder="Headline"
                />
              ) : (
                d.headline
              )}
            </h2>
            <p
              className="text-[16px] leading-relaxed m-0"
              style={{ color: 'var(--block-text-muted)' }}
            >
              {upd ? (
                <Editable
                  value={d.body}
                  onChange={(v) => upd({ body: v })}
                  placeholder="Case study body..."
                />
              ) : (
                d.body
              )}
            </p>
          </div>
          <div>
            {d.imageUrl && (
              <div
                className="rounded-2xl overflow-hidden mb-8"
                style={{ aspectRatio: '4/3' }}
              >
                <LazyImage
                  src={d.imageUrl}
                  alt={d.clientName}
                  wrapperClassName="w-full h-full"
                  className="object-cover"
                />
              </div>
            )}
            <div className="grid grid-cols-3 gap-4">
              {(d.stats ?? []).map((stat, i) => (
                <div
                  key={i}
                  className="p-6 rounded-2xl text-center"
                  style={{
                    background: 'var(--block-card-bg)',
                    border: '1px solid var(--block-border)',
                  }}
                >
                  <div
                    className="text-[32px] font-bold tracking-tight"
                    style={{ color: s.accent ?? '#65F5C9' }}
                  >
                    {updStat ? (
                      <Editable
                        value={stat.value}
                        onChange={(v) => updStat(i, { value: v })}
                        placeholder="340%"
                      />
                    ) : (
                      stat.value
                    )}
                  </div>
                  <div
                    className="text-[12px] mt-2 leading-snug"
                    style={{ color: 'var(--block-text-muted)' }}
                  >
                    {updStat ? (
                      <Editable
                        value={stat.label}
                        onChange={(v) => updStat(i, { label: v })}
                        placeholder="Label"
                      />
                    ) : (
                      stat.label
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// FAQ
// ============================================================
interface FaqRendererProps {
  block: Block;
  onDataChange?: (data: FaqData) => void;
}
export function FaqRenderer({ block, onDataChange }: FaqRendererProps) {
  const d = block.data as FaqData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<FaqData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updItem = upd
    ? (i: number, patch: Partial<(typeof d.items)[0]>) => {
        const items = [...d.items];
        items[i] = { ...items[i], ...patch };
        upd({ items });
      }
    : undefined;
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-14">
          <div
            className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="Questions"
              />
            ) : (
              d.eyebrow
            )}
          </div>
          <h2
            className="font-light tracking-tight leading-tight m-0"
            style={{ fontSize: 'clamp(32px,4vw,56px)' }}
          >
            {upd ? (
              <Editable
                value={d.headline}
                onChange={(v) => upd({ headline: v })}
                placeholder="Headline"
              />
            ) : (
              d.headline
            )}
          </h2>
        </div>
        <div className="space-y-2">
          {(d.items ?? []).map((item, i) => (
            <div
              key={item.id}
              className="rounded-xl overflow-hidden"
              style={{
                background: 'var(--block-card-bg)',
                border: '1px solid var(--block-border)',
              }}
            >
              <button
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="w-full flex items-center justify-between p-6 text-left transition-colors hover:bg-white/5"
              >
                <span className="text-[16px] font-medium pr-4">
                  {updItem ? (
                    <Editable
                      value={item.question}
                      onChange={(v) => updItem(i, { question: v })}
                      placeholder="Question?"
                    />
                  ) : (
                    item.question
                  )}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  className="flex-shrink-0 transition-transform"
                  style={{
                    transform:
                      openIdx === i ? 'rotate(180deg)' : 'rotate(0deg)',
                    color: s.accent ?? '#65F5C9',
                  }}
                >
                  <path
                    d="M3 6l5 5 5-5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              {openIdx === i && (
                <div
                  className="px-6 pb-6 text-[15px] leading-relaxed"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {updItem ? (
                    <Editable
                      value={item.answer}
                      onChange={(v) => updItem(i, { answer: v })}
                      tag="p"
                      className="m-0"
                      placeholder="Answer..."
                    />
                  ) : (
                    item.answer
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// COMPARISON TABLE
// ============================================================
interface ComparisonRendererProps {
  block: Block;
  onDataChange?: (data: ComparisonData) => void;
}
export function ComparisonRenderer({
  block,
  onDataChange,
}: ComparisonRendererProps) {
  const d = block.data as ComparisonData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<ComparisonData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updRow = upd
    ? (i: number, patch: Partial<(typeof d.rows)[0]>) => {
        const rows = [...d.rows];
        rows[i] = { ...rows[i], ...patch };
        upd({ rows });
      }
    : undefined;

  const CheckIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="7"
        fill={`${s.accent ?? '#65F5C9'}20`}
        stroke={s.accent ?? '#65F5C9'}
        strokeWidth="1"
      />
      <path
        d="M5 8l2 2 4-4"
        stroke={s.accent ?? '#65F5C9'}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
  const XIcon = () => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle
        cx="8"
        cy="8"
        r="7"
        fill="var(--block-card-bg)"
        stroke="var(--block-text-subtle)"
        strokeWidth="1"
      />
      <path
        d="M6 6l4 4M10 6l-4 4"
        stroke="var(--block-text-dim)"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-14">
          <div
            className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="Why choose us"
              />
            ) : (
              d.eyebrow
            )}
          </div>
          <h2
            className="font-light tracking-tight leading-tight m-0"
            style={{ fontSize: 'clamp(32px,4vw,56px)' }}
          >
            {upd ? (
              <Editable
                value={d.headline}
                onChange={(v) => upd({ headline: v })}
                placeholder="Headline"
              />
            ) : (
              d.headline
            )}
          </h2>
        </div>
        <div
          className="rounded-2xl"
          style={{
            border: '1px solid var(--block-border)',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch' as any,
          }}
        >
          <div style={{ minWidth: '480px' }}>
            {/* Header */}
            <div
              className="grid grid-cols-[1fr_1fr_1fr] text-[12px] tracking-[0.14em] uppercase"
              style={{ background: 'var(--block-border)' }}
            >
              <div
                className="p-5 font-medium"
                style={{ color: 'var(--block-text-muted)' }}
              >
                Feature
              </div>
              <div
                className="p-5 font-medium text-center"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {upd ? (
                  <Editable
                    value={d.withoutLabel}
                    onChange={(v) => upd({ withoutLabel: v })}
                    placeholder="Without us"
                  />
                ) : (
                  d.withoutLabel
                )}
              </div>
              <div
                className="p-5 font-medium text-center"
                style={{ color: s.accent ?? '#65F5C9' }}
              >
                {upd ? (
                  <Editable
                    value={d.withLabel}
                    onChange={(v) => upd({ withLabel: v })}
                    placeholder="With us"
                  />
                ) : (
                  d.withLabel
                )}
              </div>
            </div>
            {/* Rows */}
            {(d.rows ?? []).map((row, i) => (
              <div
                key={row.id}
                className="grid grid-cols-[1fr_1fr_1fr]"
                style={{
                  borderTop: '1px solid var(--block-border)',
                  background:
                    i % 2 === 0 ? 'transparent' : 'var(--block-card-bg)',
                }}
              >
                <div className="p-5 text-[14px] font-medium">
                  {updRow ? (
                    <Editable
                      value={row.feature}
                      onChange={(v) => updRow(i, { feature: v })}
                      placeholder="Feature"
                    />
                  ) : (
                    row.feature
                  )}
                </div>
                <div
                  className="p-5 text-[13px] text-center flex items-center justify-center gap-2"
                  style={{ color: 'var(--block-text-dim)' }}
                >
                  {row.without === '✓' ? (
                    <CheckIcon />
                  ) : row.without === '✗' || row.without === '' ? (
                    <XIcon />
                  ) : null}
                  {row.without !== '✓' &&
                    row.without !== '✗' &&
                    row.without !== '' &&
                    (updRow ? (
                      <Editable
                        value={row.without}
                        onChange={(v) => updRow(i, { without: v })}
                        placeholder="Without"
                      />
                    ) : (
                      row.without
                    ))}
                </div>
                <div
                  className="p-5 text-[13px] text-center flex items-center justify-center gap-2"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {row.with === '✓' ? (
                    <CheckIcon />
                  ) : row.with === '✗' || row.with === '' ? (
                    <XIcon />
                  ) : null}
                  {row.with !== '✓' &&
                    row.with !== '✗' &&
                    row.with !== '' &&
                    (updRow ? (
                      <Editable
                        value={row.with}
                        onChange={(v) => updRow(i, { with: v })}
                        placeholder="With"
                      />
                    ) : (
                      row.with
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// ============================================================
// GUARANTEE
// ============================================================
interface GuaranteeRendererProps {
  block: Block;
  onDataChange?: (data: GuaranteeData) => void;
}
export function GuaranteeRenderer({
  block,
  onDataChange,
}: GuaranteeRendererProps) {
  const d = block.data as GuaranteeData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<GuaranteeData>) => onDataChange({ ...d, ...patch })
    : undefined;

  const ShieldIcon = () => (
    <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
      <path
        d="M20 4L6 10v10c0 9 6.3 17.4 14 20 7.7-2.6 14-11 14-20V10L20 4z"
        fill={`${s.accent ?? '#65F5C9'}20`}
        stroke={s.accent ?? '#65F5C9'}
        strokeWidth="1.5"
      />
      <path
        d="M14 20l4 4 8-8"
        stroke={s.accent ?? '#65F5C9'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-3xl mx-auto text-center">
        {/* Badge */}
        <div
          className="inline-flex items-center gap-3 px-6 py-3 rounded-full mb-10"
          style={{
            background: `${s.accent ?? '#65F5C9'}10`,
            border: `1px solid ${s.accent ?? '#65F5C9'}30`,
          }}
        >
          <ShieldIcon />
          <span
            className="text-[13px] tracking-[0.14em] uppercase font-semibold"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.badgeText}
                onChange={(v) => upd({ badgeText: v })}
                placeholder="GUARANTEED"
              />
            ) : (
              d.badgeText
            )}
          </span>
        </div>
        <h2
          className="font-light tracking-tight leading-tight m-0 mb-6"
          style={{ fontSize: 'clamp(32px,4vw,60px)' }}
        >
          {upd ? (
            <Editable
              value={d.headline}
              onChange={(v) => upd({ headline: v })}
              placeholder="Headline"
            />
          ) : (
            d.headline
          )}
        </h2>
        <p
          className="text-[18px] leading-relaxed m-0 max-w-2xl mx-auto"
          style={{ color: 'var(--block-text-muted)' }}
        >
          {upd ? (
            <Editable
              value={d.body}
              onChange={(v) => upd({ body: v })}
              tag="p"
              className="m-0"
              placeholder="Guarantee body..."
            />
          ) : (
            d.body
          )}
        </p>
        <div
          className="mt-6 text-[12px] tracking-[0.1em] uppercase"
          style={{ color: 'var(--block-text-dim)' }}
        >
          {upd ? (
            <Editable
              value={d.eyebrow}
              onChange={(v) => upd({ eyebrow: v })}
              placeholder="Our promise"
            />
          ) : (
            d.eyebrow
          )}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// COUNTDOWN
// ============================================================
interface CountdownRendererProps {
  block: Block;
  onDataChange?: (data: CountdownData) => void;
  proposalExpiresAt?: string;
}
export function CountdownRenderer({
  block,
  onDataChange,
  proposalExpiresAt,
}: CountdownRendererProps) {
  const d = block.data as CountdownData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<CountdownData>) => onDataChange({ ...d, ...patch })
    : undefined;

  const targetDate = d.useProposalExpiry ? proposalExpiresAt : d.expiresAt;
  const [timeLeft, setTimeLeft] = useState({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
    expired: false,
  });

  useEffect(() => {
    if (!targetDate) return;
    const calc = () => {
      const diff = new Date(targetDate).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft({
          days: 0,
          hours: 0,
          minutes: 0,
          seconds: 0,
          expired: true,
        });
        return;
      }
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ days, hours, minutes, seconds, expired: false });
    };
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [targetDate]);

  const TimeUnit = ({ value, label }: { value: number; label: string }) => (
    <div className="flex flex-col items-center">
      <div
        className="font-bold tabular-nums leading-none"
        style={{
          fontSize: 'clamp(36px,10vw,64px)',
          color: s.accent ?? '#65F5C9',
          textShadow: `0 0 40px ${s.accent ?? '#65F5C9'}4D`,
        }}
      >
        {String(value).padStart(2, '0')}
      </div>
      <div
        className="text-[11px] tracking-[0.18em] uppercase mt-2"
        style={{ color: 'var(--block-text-dim)' }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-3xl mx-auto text-center">
        <div
          className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
          style={{ color: 'var(--block-text-muted)' }}
        >
          {upd ? (
            <Editable
              value={d.eyebrow}
              onChange={(v) => upd({ eyebrow: v })}
              placeholder="Offer expires"
            />
          ) : (
            d.eyebrow
          )}
        </div>
        <h2
          className="font-light tracking-tight leading-tight m-0 mb-4"
          style={{ fontSize: 'clamp(28px,3.5vw,52px)' }}
        >
          {upd ? (
            <Editable
              value={d.headline}
              onChange={(v) => upd({ headline: v })}
              placeholder="Headline"
            />
          ) : (
            d.headline
          )}
        </h2>
        <p
          className="text-[16px] leading-relaxed mb-12"
          style={{ color: 'var(--block-text-muted)' }}
        >
          {upd ? (
            <Editable
              value={d.lede}
              onChange={(v) => upd({ lede: v })}
              placeholder="Lede..."
            />
          ) : (
            d.lede
          )}
        </p>

        {timeLeft.expired ? (
          <div
            className="text-[20px] font-medium"
            style={{ color: 'var(--block-text-muted)' }}
          >
            This offer has expired.
          </div>
        ) : targetDate ? (
          <div className="flex items-start justify-center gap-8 md:gap-16">
            <TimeUnit value={timeLeft.days} label="Days" />
            <div
              className="font-light leading-none"
              style={{
                fontSize: 'clamp(36px,10vw,64px)',
                color: 'var(--block-text-subtle)',
              }}
            >
              :
            </div>
            <TimeUnit value={timeLeft.hours} label="Hours" />
            <div
              className="font-light leading-none"
              style={{
                fontSize: 'clamp(36px,10vw,64px)',
                color: 'var(--block-text-subtle)',
              }}
            >
              :
            </div>
            <TimeUnit value={timeLeft.minutes} label="Minutes" />
            <div
              className="font-light leading-none"
              style={{
                fontSize: 'clamp(36px,10vw,64px)',
                color: 'var(--block-text-subtle)',
              }}
            >
              :
            </div>
            <TimeUnit value={timeLeft.seconds} label="Seconds" />
          </div>
        ) : (
          <div
            className="text-[16px]"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {upd
              ? 'Set an expiry date in the block settings'
              : 'No expiry date set'}
          </div>
        )}

        {d.ctaLabel && (
          <div className="mt-12">
            <button
              className="px-8 py-4 rounded-full text-[15px] font-medium transition-transform active:scale-[0.97]"
              style={{
                background: s.accent ?? '#65F5C9',
                color: '#000',
                boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}40`,
              }}
            >
              {upd ? (
                <Editable
                  value={d.ctaLabel}
                  onChange={(v) => upd({ ctaLabel: v })}
                  placeholder="Accept now →"
                />
              ) : (
                d.ctaLabel
              )}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================
// STAT BAR
// ============================================================
interface StatBarRendererProps {
  block: Block;
  onDataChange?: (data: StatBarData) => void;
}
export function StatBarRenderer({ block, onDataChange }: StatBarRendererProps) {
  const d = block.data as StatBarData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<StatBarData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updStat = upd
    ? (i: number, patch: Partial<(typeof d.stats)[0]>) => {
        const stats = [...d.stats];
        stats[i] = { ...stats[i], ...patch };
        upd({ stats });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(60px,8vw,120px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {d.eyebrow && (
          <div
            className="text-center text-[11px] tracking-[0.18em] uppercase font-medium mb-10"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="By the numbers"
              />
            ) : (
              d.eyebrow
            )}
          </div>
        )}
        <div
          className="grid grid-cols-2 md:grid-cols-4 gap-0"
          style={{ borderLeft: '1px solid var(--block-border)' }}
        >
          {(d.stats ?? []).map((stat, i) => (
            <div
              key={stat.id}
              className="px-4 py-5 md:px-8 md:py-6 text-center"
              style={{ borderRight: '1px solid var(--block-border)' }}
            >
              <div
                className="font-bold tracking-tight leading-none"
                style={{
                  fontSize: 'clamp(40px,5vw,72px)',
                  color: s.accent ?? '#65F5C9',
                }}
              >
                {stat.prefix && (
                  <span className="text-[0.5em] align-top mt-[0.3em] inline-block">
                    {stat.prefix}
                  </span>
                )}
                {updStat ? (
                  <Editable
                    value={stat.value}
                    onChange={(v) => updStat(i, { value: v })}
                    placeholder="99"
                  />
                ) : (
                  stat.value
                )}
                {stat.suffix && (
                  <span className="text-[0.5em]">{stat.suffix}</span>
                )}
              </div>
              <div
                className="text-[13px] mt-3 leading-snug"
                style={{ color: 'var(--block-text-muted)' }}
              >
                {updStat ? (
                  <Editable
                    value={stat.label}
                    onChange={(v) => updStat(i, { label: v })}
                    placeholder="Label"
                  />
                ) : (
                  stat.label
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// LOGO STRIP
// ============================================================
interface LogoStripRendererProps {
  block: Block;
  onDataChange?: (data: LogoStripData) => void;
}
export function LogoStripRenderer({
  block,
  onDataChange,
}: LogoStripRendererProps) {
  const d = block.data as LogoStripData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<LogoStripData>) => onDataChange({ ...d, ...patch })
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(48px,6vw,80px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {d.eyebrow && (
          <div
            className="text-center text-[11px] tracking-[0.18em] uppercase font-medium mb-8"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="Trusted by"
              />
            ) : (
              d.eyebrow
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-center gap-8 md:gap-12">
          {(d.logos ?? []).map((logo) => (
            <div key={logo.id} className="flex items-center justify-center">
              {logo.logoUrl ? (
                <LazyImage
                  src={logo.logoUrl}
                  alt={logo.name}
                  wrapperClassName="h-8 w-auto flex-shrink-0"
                  className="object-contain"
                  style={{ filter: 'brightness(0) invert(1)', opacity: 0.4 }}
                />
              ) : (
                <span
                  className="text-[14px] font-semibold tracking-[0.12em] uppercase"
                  style={{ color: 'var(--block-text-dim)' }}
                >
                  {logo.logoText ?? logo.name}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// PROCESS STEPS
// ============================================================
interface ProcessStepsRendererProps {
  block: Block;
  onDataChange?: (data: ProcessStepsData) => void;
}
export function ProcessStepsRenderer({
  block,
  onDataChange,
}: ProcessStepsRendererProps) {
  const d = block.data as ProcessStepsData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<ProcessStepsData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updStep = upd
    ? (i: number, patch: Partial<(typeof d.steps)[0]>) => {
        const steps = [...d.steps];
        steps[i] = { ...steps[i], ...patch };
        upd({ steps });
      }
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-14">
          <div
            className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="How it works"
              />
            ) : (
              d.eyebrow
            )}
          </div>
          <h2
            className="font-light tracking-tight leading-tight m-0"
            style={{ fontSize: 'clamp(32px,4vw,56px)' }}
          >
            {upd ? (
              <Editable
                value={d.headline}
                onChange={(v) => upd({ headline: v })}
                placeholder="Headline"
              />
            ) : (
              d.headline
            )}
          </h2>
        </div>

        <div
          className={`grid gap-8 ${d.layout === 'grid' ? 'grid-cols-2 md:grid-cols-4' : d.layout === 'vertical' ? 'grid-cols-1 max-w-2xl mx-auto' : 'grid-cols-1 md:grid-cols-4'}`}
        >
          {(d.steps ?? []).map((step, i) => (
            <div
              key={step.id}
              className={`relative flex ${d.layout === 'vertical' ? 'flex-row gap-6' : 'flex-col'}`}
            >
              {/* Connector line for horizontal */}
              {d.layout === 'horizontal' && i < d.steps.length - 1 && (
                <div
                  className="hidden md:block absolute top-6 left-[calc(50%+28px)] right-[-calc(50%-28px)] h-[1px]"
                  style={{
                    background: `linear-gradient(90deg, ${s.accent ?? '#65F5C9'}40, var(--block-border))`,
                  }}
                />
              )}
              <div
                className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-[15px] font-bold"
                style={{
                  background: `${s.accent ?? '#65F5C9'}15`,
                  border: `1px solid ${s.accent ?? '#65F5C9'}40`,
                  color: s.accent ?? '#65F5C9',
                }}
              >
                {updStep ? (
                  <Editable
                    value={step.number}
                    onChange={(v) => updStep(i, { number: v })}
                    placeholder="01"
                  />
                ) : (
                  step.number
                )}
              </div>
              <div className={d.layout === 'horizontal' ? 'mt-5' : ''}>
                <h4 className="text-[18px] font-semibold tracking-tight mb-2">
                  {updStep ? (
                    <Editable
                      value={step.title}
                      onChange={(v) => updStep(i, { title: v })}
                      placeholder="Step title"
                    />
                  ) : (
                    step.title
                  )}
                </h4>
                <p
                  className="text-[14px] leading-relaxed m-0"
                  style={{ color: 'var(--block-text-muted)' }}
                >
                  {updStep ? (
                    <Editable
                      value={step.body}
                      onChange={(v) => updStep(i, { body: v })}
                      placeholder="Step description..."
                    />
                  ) : (
                    step.body
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// SPACER
// ============================================================
export function SpacerRenderer({ block }: { block: Block }) {
  const d = block.data as SpacerData;
  return (
    <div style={{ height: d.height ?? 80, background: 'var(--block-bg)' }} />
  );
}

// ============================================================
// EMBED
// ============================================================
interface EmbedRendererProps {
  block: Block;
  onDataChange?: (data: EmbedData) => void;
}
export function EmbedRenderer({ block, onDataChange }: EmbedRendererProps) {
  const d = block.data as EmbedData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<EmbedData>) => onDataChange({ ...d, ...patch })
    : undefined;

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(48px,6vw,80px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-5xl mx-auto">
        {d.url ? (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              height: d.height ?? 600,
              border: '1px solid var(--block-border)',
            }}
          >
            <iframe
              src={d.url}
              width="100%"
              height="100%"
              frameBorder="0"
              allow="camera; microphone; autoplay; encrypted-media"
              title={d.caption ?? 'Embedded content'}
            />
          </div>
        ) : (
          <div
            className="flex flex-col items-center justify-center rounded-2xl"
            style={{
              height: d.height ?? 400,
              background: 'var(--block-card-bg)',
              border: '2px dashed var(--block-border)',
            }}
          >
            <svg
              width="48"
              height="48"
              viewBox="0 0 48 48"
              fill="none"
              className="mb-4"
              style={{ color: 'var(--block-text-subtle)' }}
            >
              <rect
                x="4"
                y="12"
                width="40"
                height="28"
                rx="4"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M18 4h12M24 12v4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <path
                d="M18 26l4-4 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {upd ? (
              <div className="w-full max-w-sm px-6">
                <input
                  type="text"
                  defaultValue={d.url}
                  onBlur={(e) => upd({ url: e.target.value })}
                  placeholder="Paste Calendly, Typeform, or any iframe URL..."
                  className="w-full bg-transparent border-b text-sm text-center outline-none py-2"
                  style={{
                    borderColor: 'var(--block-text-subtle)',
                    color: 'var(--block-text-muted)',
                  }}
                />
              </div>
            ) : (
              <p
                className="text-sm m-0"
                style={{ color: 'var(--block-text-dim)' }}
              >
                No embed URL set
              </p>
            )}
          </div>
        )}
        {d.caption && (
          <p
            className="text-center text-[12px] mt-3 m-0"
            style={{ color: 'var(--block-text-dim)' }}
          >
            {d.caption}
          </p>
        )}
      </div>
    </section>
  );
}

// ============================================================
// GALLERY
// ============================================================
interface GalleryRendererProps {
  block: Block;
  onDataChange?: (data: GalleryData) => void;
}
export function GalleryRenderer({ block }: GalleryRendererProps) {
  const d = block.data as GalleryData;
  const s = block.styles;
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const colClass =
    d.columns === 2
      ? 'grid-cols-2'
      : d.columns === 4
        ? 'grid-cols-2 md:grid-cols-4'
        : 'grid-cols-2 md:grid-cols-3';

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(48px,6vw,80px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-7xl mx-auto">
        {(d.eyebrow || d.headline) && (
          <div className="text-center mb-10">
            {d.eyebrow && (
              <div
                className="text-[11px] tracking-[0.18em] uppercase font-medium mb-3"
                style={{ color: s.accent ?? '#65F5C9' }}
              >
                {d.eyebrow}
              </div>
            )}
            {d.headline && (
              <h2
                className="font-light tracking-tight m-0"
                style={{ fontSize: 'clamp(28px,3.5vw,48px)' }}
              >
                {d.headline}
              </h2>
            )}
          </div>
        )}
        {d.images.length === 0 ? (
          <div
            className="flex items-center justify-center rounded-2xl py-20"
            style={{
              background: 'var(--block-card-bg)',
              border: '2px dashed var(--block-border)',
            }}
          >
            <div
              className="text-center"
              style={{ color: 'var(--block-text-dim)' }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 40 40"
                fill="none"
                className="mx-auto mb-3"
              >
                <rect
                  x="3"
                  y="7"
                  width="34"
                  height="26"
                  rx="3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle
                  cx="13"
                  cy="17"
                  r="3"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <path
                  d="M3 30l8-8 6 6 5-5 15 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <p className="text-sm m-0">Add images via block settings</p>
            </div>
          </div>
        ) : (
          <div className={`grid ${colClass} gap-3`}>
            {(d.images ?? []).map((img, i) => (
              <div
                key={img.id}
                className="relative overflow-hidden rounded-xl cursor-pointer group"
                style={{ aspectRatio: '4/3' }}
                onClick={() => d.lightbox && setLightboxIdx(i)}
              >
                <LazyImage
                  src={img.url}
                  alt={img.alt ?? ''}
                  wrapperClassName="w-full h-full"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {d.lightbox && (
                  <div
                    className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'rgba(0,0,0,0.4)' }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"
                        stroke="white"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && d.images[lightboxIdx] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.92)' }}
          onClick={() => setLightboxIdx(null)}
        >
          <button
            className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'var(--block-card-bg-hover)' }}
            onClick={() => setLightboxIdx(null)}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 2l12 12M14 2L2 14"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <LazyImage
            src={d.images[lightboxIdx].url}
            alt={d.images[lightboxIdx].alt ?? ''}
            wrapperClassName="max-w-full max-h-[90vh] rounded-xl flex-shrink-0"
            className="max-w-full max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />
          {lightboxIdx > 0 && (
            <button
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'var(--block-card-bg-hover)' }}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIdx(lightboxIdx - 1);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M10 3L5 8l5 5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
          {lightboxIdx < d.images.length - 1 && (
            <button
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: 'var(--block-card-bg-hover)' }}
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIdx(lightboxIdx + 1);
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M6 3l5 5-5 5"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ============================================================
// PACKAGE SELECTOR
// ============================================================
interface PackageSelectorRendererProps {
  block: Block;
  onDataChange?: (data: PackageSelectorData) => void;
  onTierSelect?: (tierId: string) => void;
}
export function PackageSelectorRenderer({
  block,
  onDataChange,
  onTierSelect,
}: PackageSelectorRendererProps) {
  const rawData = block.data as any;
  // Defensive: support legacy 'packages' field name and guard against undefined
  const d: PackageSelectorData = {
    ...rawData,
    tiers: rawData?.tiers ?? rawData?.packages ?? [],
  };
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<PackageSelectorData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const updTier = upd
    ? (i: number, patch: Partial<(typeof d.tiers)[0]>) => {
        const tiers = [...(d.tiers ?? [])];
        tiers[i] = { ...tiers[i], ...patch };
        upd({ tiers });
      }
    : undefined;
  const [selectedId, setSelectedId] = useState(
    d.selectedTierId ?? (d.tiers ?? []).find((t) => t.highlighted)?.id,
  );
  // Product list for linking (only fetched in edit mode)
  const trpc = useTRPC();
  const brandId = useBrandId();
  const { data: productList } = useQuery({
    ...trpc.payments.pricing.listProducts.queryOptions({ brandId: brandId! }),
    enabled: !!upd && !!brandId,
  });

  const handleSelect = (id: string) => {
    setSelectedId(id);
    upd?.({ selectedTierId: id });
    onTierSelect?.(id);
  };

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(80px,10vw,160px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-14">
          <div
            className="text-[11px] tracking-[0.18em] uppercase font-medium mb-4"
            style={{ color: s.accent ?? '#65F5C9' }}
          >
            {upd ? (
              <Editable
                value={d.eyebrow}
                onChange={(v) => upd({ eyebrow: v })}
                placeholder="Choose your plan"
              />
            ) : (
              d.eyebrow
            )}
          </div>
          <h2
            className="font-light tracking-tight leading-tight m-0 mb-4"
            style={{ fontSize: 'clamp(32px,4vw,56px)' }}
          >
            {upd ? (
              <Editable
                value={d.headline}
                onChange={(v) => upd({ headline: v })}
                placeholder="Headline"
              />
            ) : (
              d.headline
            )}
          </h2>
          {d.lede && (
            <p
              className="text-[16px] leading-relaxed m-0 max-w-xl mx-auto"
              style={{ color: 'var(--block-text-muted)' }}
            >
              {upd ? (
                <Editable
                  value={d.lede}
                  onChange={(v) => upd({ lede: v })}
                  placeholder="Lede..."
                />
              ) : (
                d.lede
              )}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {(d.tiers ?? []).map((tier, i) => {
            const isSelected = selectedId === tier.id;
            const isHighlighted = tier.highlighted;
            return (
              <div
                key={tier.id}
                className="relative flex flex-col rounded-2xl p-8 cursor-pointer transition-all"
                style={{
                  background: isHighlighted
                    ? `linear-gradient(180deg, ${s.accent ?? '#65F5C9'}10, ${s.accent ?? '#65F5C9'}05)`
                    : 'var(--block-card-bg)',
                  border: isSelected
                    ? `2px solid ${s.accent ?? '#65F5C9'}`
                    : isHighlighted
                      ? `1px solid ${s.accent ?? '#65F5C9'}40`
                      : '1px solid var(--block-border)',
                  boxShadow: isSelected
                    ? `0 0 40px ${s.accent ?? '#65F5C9'}20`
                    : 'none',
                  transform: isHighlighted ? 'scale(1.02)' : 'scale(1)',
                }}
                onClick={() => handleSelect(tier.id)}
              >
                {isHighlighted && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full text-[11px] font-semibold tracking-[0.1em] uppercase"
                    style={{ background: s.accent ?? '#65F5C9', color: '#000' }}
                  >
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-[20px] font-semibold tracking-tight mb-1">
                    {updTier ? (
                      <Editable
                        value={tier.name}
                        onChange={(v) => updTier(i, { name: v })}
                        placeholder="Plan name"
                      />
                    ) : (
                      tier.name
                    )}
                  </h3>
                  <p
                    className="text-[13px] m-0"
                    style={{ color: 'var(--block-text-muted)' }}
                  >
                    {updTier ? (
                      <Editable
                        value={tier.tagline}
                        onChange={(v) => updTier(i, { tagline: v })}
                        placeholder="Tagline"
                      />
                    ) : (
                      tier.tagline
                    )}
                  </p>
                </div>
                <div className="mb-6">
                  <span
                    className="text-[40px] font-bold tracking-tight"
                    style={{
                      color: isHighlighted ? (s.accent ?? '#65F5C9') : '#fff',
                    }}
                  >
                    {fmtCents(tier.priceCents, tier.currency)}
                  </span>
                  {tier.period && (
                    <span
                      className="text-[14px] ml-1"
                      style={{ color: 'var(--block-text-dim)' }}
                    >
                      {tier.period}
                    </span>
                  )}
                  {/* Product link selector — edit mode only */}
                  {updTier && productList && productList.length > 0 && (
                    <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={(tier as any).linkedProductId ?? ''}
                        onChange={(e) => {
                          const pid = e.target.value;
                          const prod = productList.find((p) => p.id === pid);
                          if (prod) {
                            updTier(i, {
                              linkedProductId: pid,
                              priceCents: prod.basePriceCents,
                              currency: prod.currency,
                              period:
                                prod.unit === 'month'
                                  ? '/mo'
                                  : prod.unit === 'year'
                                    ? '/yr'
                                    : prod.unit === 'project'
                                      ? ''
                                      : `/${prod.unit}`,
                            } as any);
                          } else {
                            updTier(i, { linkedProductId: undefined } as any);
                          }
                        }}
                        className="w-full text-[11px] rounded-lg px-2 py-1.5 outline-none"
                        style={{
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          color: 'rgba(255,255,255,0.6)',
                        }}
                      >
                        <option value="">Link to product…</option>
                        {productList
                          .filter((p) => p.status === 'active')
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} —{' '}
                              {new Intl.NumberFormat('en-AU', {
                                style: 'currency',
                                currency: p.currency ?? 'AUD',
                                minimumFractionDigits: 0,
                              }).format(p.basePriceCents / 100)}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
                <ul className="space-y-3 flex-1 mb-8">
                  {tier.features.map((feature, fi) => (
                    <li
                      key={fi}
                      className="flex items-start gap-3 text-[14px]"
                      style={{ color: 'var(--block-text-muted)' }}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="flex-shrink-0 mt-0.5"
                      >
                        <circle
                          cx="8"
                          cy="8"
                          r="7"
                          fill={`${s.accent ?? '#65F5C9'}20`}
                        />
                        <path
                          d="M5 8l2 2 4-4"
                          stroke={s.accent ?? '#65F5C9'}
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
                <button
                  className="w-full py-3 rounded-full text-[14px] font-medium transition-all"
                  style={{
                    background: isSelected
                      ? (s.accent ?? '#65F5C9')
                      : isHighlighted
                        ? `${s.accent ?? '#65F5C9'}20`
                        : 'var(--block-border)',
                    color: isSelected
                      ? '#000'
                      : isHighlighted
                        ? (s.accent ?? '#65F5C9')
                        : 'var(--block-text-muted)',
                    border: isSelected
                      ? 'none'
                      : `1px solid ${isHighlighted ? (s.accent ?? '#65F5C9') : 'var(--block-border)'}40`,
                  }}
                >
                  {isSelected
                    ? '✓ Selected'
                    : (tier.ctaLabel ?? `Choose ${tier.name}`)}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ============================================================
// SIGNATURE
// ============================================================
interface SignatureRendererProps {
  block: Block;
  onDataChange?: (data: SignatureData) => void;
  onSign?: (data: {
    signatureData?: string;
    typedName?: string;
    signatureType: 'draw' | 'type';
  }) => void;
  readOnly?: boolean;
}
export function SignatureRenderer({
  block,
  onDataChange,
  onSign,
  readOnly,
}: SignatureRendererProps) {
  const d = block.data as SignatureData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<SignatureData>) => onDataChange({ ...d, ...patch })
    : undefined;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(!!d.signatureData);
  const [typedName, setTypedName] = useState(d.typedName ?? '');
  const [mode, setMode] = useState<'draw' | 'type'>(d.signatureType ?? 'draw');
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const getPos = (
    e: React.MouseEvent | React.TouchEvent,
    canvas: HTMLCanvasElement,
  ) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ('touches' in e) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (readOnly || mode !== 'draw') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsDrawing(true);
    lastPos.current = getPos(e, canvas);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing || !canvasRef.current || mode !== 'draw') return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current!.x, lastPos.current!.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = s.accent ?? '#65F5C9';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasSignature(true);
  };

  const endDraw = () => {
    setIsDrawing(false);
    lastPos.current = null;
    if (canvasRef.current && hasSignature) {
      const data = canvasRef.current.toDataURL();
      upd?.({ signatureData: data, signatureType: 'draw' });
    }
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    upd?.({ signatureData: undefined });
  };

  const handleSign = () => {
    if (mode === 'draw' && canvasRef.current) {
      onSign?.({
        signatureData: canvasRef.current.toDataURL(),
        signatureType: 'draw',
      });
    } else if (mode === 'type' && typedName) {
      onSign?.({ typedName, signatureType: 'type' });
    }
  };

  const isSigned = d.signedAt && (d.signatureData || d.typedName);

  return (
    <section
      className="relative"
      style={{
        ...css(s),
        padding: 'clamp(60px,8vw,120px) clamp(24px,6vw,96px)',
      }}
    >
      <div className="max-w-2xl mx-auto">
        <h2
          className="font-light tracking-tight leading-tight m-0 mb-4"
          style={{ fontSize: 'clamp(28px,3.5vw,48px)' }}
        >
          {upd ? (
            <Editable
              value={d.headline}
              onChange={(v) => upd({ headline: v })}
              placeholder="Sign to confirm."
            />
          ) : (
            d.headline
          )}
        </h2>
        <p
          className="text-[16px] leading-relaxed mb-10"
          style={{ color: 'var(--block-text-muted)' }}
        >
          {upd ? (
            <Editable
              value={d.lede}
              onChange={(v) => upd({ lede: v })}
              tag="p"
              className="m-0"
              placeholder="Lede..."
            />
          ) : (
            d.lede
          )}
        </p>

        {isSigned ? (
          <div
            className="rounded-2xl p-8 text-center"
            style={{
              background: `${s.accent ?? '#65F5C9'}10`,
              border: `1px solid ${s.accent ?? '#65F5C9'}30`,
            }}
          >
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ background: s.accent ?? '#65F5C9' }}
            >
              <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                <path
                  d="M2 8L7 13L18 2"
                  stroke="#000"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <p className="text-[16px] font-medium m-0 mb-1">
              Signed by {d.signerName ?? d.typedName}
            </p>
            {d.signedAt && (
              <p
                className="text-[13px] m-0"
                style={{ color: 'var(--block-text-dim)' }}
              >
                {new Date(d.signedAt).toLocaleString()}
              </p>
            )}
            {d.signatureData && (
              <img
                src={d.signatureData}
                alt="Signature"
                className="mt-4 mx-auto max-h-16"
                style={{
                  filter: `drop-shadow(0 0 8px ${s.accent ?? '#65F5C9'}60)`,
                }}
              />
            )}
          </div>
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'var(--block-card-bg)',
              border: '1px solid var(--block-border)',
            }}
          >
            {/* Mode toggle */}
            <div
              className="flex border-b"
              style={{ borderColor: 'var(--block-border)' }}
            >
              {(['draw', 'type'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => !readOnly && setMode(m)}
                  className="flex-1 py-3 text-[13px] font-medium transition-colors"
                  style={{
                    background:
                      mode === m ? `${s.accent ?? '#65F5C9'}10` : 'transparent',
                    color:
                      mode === m
                        ? (s.accent ?? '#65F5C9')
                        : 'var(--block-text-dim)',
                    borderBottom:
                      mode === m
                        ? `2px solid ${s.accent ?? '#65F5C9'}`
                        : '2px solid transparent',
                  }}
                >
                  {m === 'draw' ? 'Draw signature' : 'Type name'}
                </button>
              ))}
            </div>

            <div className="p-6">
              {mode === 'draw' ? (
                <div>
                  <canvas
                    ref={canvasRef}
                    width={600}
                    height={200}
                    className="w-full rounded-xl touch-none"
                    style={{
                      background: 'var(--block-card-bg)',
                      border: '1px dashed var(--block-border)',
                      cursor: readOnly ? 'default' : 'crosshair',
                    }}
                    onMouseDown={startDraw}
                    onMouseMove={draw}
                    onMouseUp={endDraw}
                    onMouseLeave={endDraw}
                    onTouchStart={startDraw}
                    onTouchMove={draw}
                    onTouchEnd={endDraw}
                  />
                  {!readOnly && (
                    <div className="flex justify-between items-center mt-3">
                      <p
                        className="text-[12px] m-0"
                        style={{ color: 'var(--block-text-dim)' }}
                      >
                        Sign in the box above
                      </p>
                      {hasSignature && (
                        <button
                          onClick={clearCanvas}
                          className="text-[12px] transition-opacity hover:opacity-70"
                          style={{ color: 'var(--block-text-dim)' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <input
                    type="text"
                    value={typedName}
                    onChange={(e) => {
                      setTypedName(e.target.value);
                      upd?.({
                        typedName: e.target.value,
                        signatureType: 'type',
                      });
                    }}
                    placeholder="Type your full legal name..."
                    disabled={readOnly}
                    className="w-full bg-transparent outline-none text-[24px] py-4 text-center"
                    style={{
                      fontFamily: "'Dancing Script', cursive, serif",
                      color: s.accent ?? '#65F5C9',
                      borderBottom: `1px solid var(--block-border)`,
                    }}
                  />
                  <p
                    className="text-[12px] text-center mt-3 m-0"
                    style={{ color: 'var(--block-text-dim)' }}
                  >
                    Type your full legal name to sign
                  </p>
                </div>
              )}

              {!readOnly && onSign && (
                <button
                  onClick={handleSign}
                  disabled={mode === 'draw' ? !hasSignature : !typedName}
                  className="w-full mt-6 py-4 rounded-full text-[15px] font-medium transition-all disabled:opacity-40"
                  style={{
                    background: s.accent ?? '#65F5C9',
                    color: '#000',
                    boxShadow: `0 8px 32px ${s.accent ?? '#65F5C9'}40`,
                  }}
                >
                  Confirm signature →
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ============================================================
// CUSTOM HTML
// ============================================================
interface CustomHtmlRendererProps {
  block: Block;
  onDataChange?: (data: CustomHtmlData) => void;
}
export function CustomHtmlRenderer({
  block,
  onDataChange,
}: CustomHtmlRendererProps) {
  const d = block.data as CustomHtmlData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<CustomHtmlData>) => onDataChange({ ...d, ...patch })
    : undefined;

  if (upd) {
    // Edit mode: show textarea
    return (
      <section
        className="relative"
        style={{
          ...css(s),
          padding: 'clamp(48px,6vw,80px) clamp(24px,6vw,96px)',
        }}
      >
        <div className="max-w-5xl mx-auto">
          <div
            className="text-[11px] tracking-[0.14em] uppercase mb-3"
            style={{ color: 'var(--block-text-dim)' }}
          >
            Custom HTML
          </div>
          <textarea
            defaultValue={d.html}
            onBlur={(e) => upd({ html: e.target.value })}
            rows={12}
            className="w-full rounded-xl p-4 text-[13px] font-mono outline-none resize-y"
            style={{
              background: 'var(--block-card-bg)',
              border: '1px solid var(--block-border)',
              color: 'var(--block-text-muted)',
            }}
            placeholder="<!-- Add your custom HTML here -->"
          />
        </div>
      </section>
    );
  }

  // View mode: render HTML
  return (
    <section className="relative" style={{ ...css(s) }}>
      <div dangerouslySetInnerHTML={{ __html: d.html }} />
    </section>
  );
}

// ============================================================
// Block dispatcher
// ============================================================
export interface BlockRendererProps {
  block: Block;
  onDataChange?: (data: BlockData) => void;
  // Pricing-specific
  onAddLineItem?: () => void;
  interactiveMode?: boolean;
  onLineItemToggle?: (id: string, selected: boolean) => void;
  onQuantityChange?: (id: string, qty: number) => void;
  // Accept-specific
  totalCents?: number;
  currency?: string;
  lineItems?: PricingTableData['lineItems'];
  subtotalCents?: number;
  taxCents?: number;
  taxLabel?: string;
  onAccept?: () => void;
  accepted?: boolean;
  // Countdown-specific
  proposalExpiresAt?: string;
  // Package selector-specific
  onTierSelect?: (tierId: string) => void;
  // Signature-specific
  onSign?: (data: {
    signatureData?: string;
    typedName?: string;
    signatureType: 'draw' | 'type';
  }) => void;
  readOnly?: boolean;
  // Table of contents
  allBlocks?: Block[];
  // Payment config — wired into AcceptPayRenderer for engagement summary (ITEM-9f)
  paymentConfig?: Record<string, unknown>;
  // Real payment form (Stripe / DualOptionSection / PaymentPlanSection) — injected only for accept_pay block
  payElement?: React.ReactNode;
}

export function BlockRenderer({
  block,
  onDataChange,
  ...rest
}: BlockRendererProps) {
  switch (block.type) {
    case 'hero':
      return (
        <HeroRenderer
          block={block}
          onDataChange={onDataChange as ((d: HeroData) => void) | undefined}
        />
      );
    case 'value_panels':
      return (
        <ValuePanelsRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: ValuePanelsData) => void) | undefined
          }
        />
      );
    case 'text_block':
      return (
        <TextBlockRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: TextBlockData) => void) | undefined
          }
        />
      );
    case 'pricing_table':
      return (
        <PricingTableRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: PricingTableData) => void) | undefined
          }
          onAddLineItem={rest.onAddLineItem}
          interactiveMode={rest.interactiveMode}
          onLineItemToggle={rest.onLineItemToggle}
          onQuantityChange={rest.onQuantityChange}
        />
      );
    case 'team_cards':
      return (
        <TeamCardsRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: TeamCardsData) => void) | undefined
          }
        />
      );
    case 'roadmap':
      return (
        <RoadmapRenderer
          block={block}
          onDataChange={onDataChange as ((d: RoadmapData) => void) | undefined}
        />
      );
    case 'image_banner':
      return (
        <ImageBannerRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: ImageBannerData) => void) | undefined
          }
        />
      );
    case 'divider':
      return <DividerRenderer block={block} />;
    case 'accept_pay':
      return (
        <AcceptPayRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: AcceptPayData) => void) | undefined
          }
          {...rest}
        />
      );
    case 'video':
      return (
        <VideoRenderer
          block={block}
          onDataChange={onDataChange as ((d: VideoData) => void) | undefined}
        />
      );
    case 'testimonial':
      return (
        <TestimonialRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: TestimonialData) => void) | undefined
          }
        />
      );
    case 'case_study':
      return (
        <CaseStudyRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: CaseStudyData) => void) | undefined
          }
        />
      );
    case 'faq':
      return (
        <FaqRenderer
          block={block}
          onDataChange={onDataChange as ((d: FaqData) => void) | undefined}
        />
      );
    case 'comparison':
      return (
        <ComparisonRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: ComparisonData) => void) | undefined
          }
        />
      );
    case 'guarantee':
      return (
        <GuaranteeRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: GuaranteeData) => void) | undefined
          }
        />
      );
    case 'countdown':
      return (
        <CountdownRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: CountdownData) => void) | undefined
          }
          proposalExpiresAt={rest.proposalExpiresAt}
        />
      );
    case 'stat_bar':
      return (
        <StatBarRenderer
          block={block}
          onDataChange={onDataChange as ((d: StatBarData) => void) | undefined}
        />
      );
    case 'logo_strip':
      return (
        <LogoStripRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: LogoStripData) => void) | undefined
          }
        />
      );
    case 'process_steps':
      return (
        <ProcessStepsRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: ProcessStepsData) => void) | undefined
          }
        />
      );
    case 'spacer':
      return <SpacerRenderer block={block} />;
    case 'embed':
      return (
        <EmbedRenderer
          block={block}
          onDataChange={onDataChange as ((d: EmbedData) => void) | undefined}
        />
      );
    case 'gallery':
      return (
        <GalleryRenderer
          block={block}
          onDataChange={onDataChange as ((d: GalleryData) => void) | undefined}
        />
      );
    case 'package_selector':
      return (
        <PackageSelectorRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: PackageSelectorData) => void) | undefined
          }
          onTierSelect={rest.onTierSelect}
        />
      );
    case 'signature':
      return (
        <SignatureRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: SignatureData) => void) | undefined
          }
          onSign={rest.onSign}
          readOnly={rest.readOnly}
        />
      );
    case 'custom_html':
      return (
        <CustomHtmlRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: CustomHtmlData) => void) | undefined
          }
        />
      );
    case 'recommendations':
      return (
        <RecommendationsRenderer
          block={block}
          onDataChange={
            onDataChange as ((d: RecommendationsData) => void) | undefined
          }
        />
      );
    case 'table_of_contents':
      return (
        <TableOfContentsRenderer
          block={block}
          onDataChange={
            onDataChange as
              | ((d: import('@/lib/blocks').TableOfContentsData) => void)
              | undefined
          }
          allBlocks={rest.allBlocks}
        />
      );
    default:
      return null;
  }
}

// ============================================================
// RECOMMENDATIONS
// ============================================================
interface RecommendationsRendererProps {
  block: Block;
  onDataChange?: (data: RecommendationsData) => void;
}
export function RecommendationsRenderer({
  block,
  onDataChange,
}: RecommendationsRendererProps) {
  const d = block.data as RecommendationsData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<RecommendationsData>) => onDataChange({ ...d, ...patch })
    : undefined;

  return (
    <section
      style={{
        ...css(s),
        padding: `${s.paddingTop ?? 64}px clamp(24px,6vw,96px) ${s.paddingBottom ?? 64}px`,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {d.eyebrow && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: s.accent ?? '#65F5C9',
              }}
            />
            <Editable
              value={d.eyebrow}
              onChange={upd ? (v) => upd({ eyebrow: v }) : undefined}
              className="text-[11px] tracking-[0.18em] uppercase font-medium"
              style={{ color: s.accent ?? '#65F5C9' }}
              placeholder="Eyebrow"
            />
          </div>
        )}
        <Editable
          value={d.headline}
          onChange={upd ? (v) => upd({ headline: v }) : undefined}
          tag="h2"
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: s.text ?? '#fff',
            fontFamily: s.fontHeading
              ? `'${s.fontHeading}', sans-serif`
              : 'inherit',
            margin: '0 0 12px',
          }}
          placeholder="Headline"
        />
        {d.lede && (
          <Editable
            value={d.lede}
            onChange={upd ? (v) => upd({ lede: v }) : undefined}
            tag="p"
            style={{
              fontSize: 16,
              color: `${s.text ?? '#fff'}99`,
              margin: '0 0 32px',
              lineHeight: 1.6,
            }}
            placeholder="Supporting copy..."
          />
        )}
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {(d.items ?? []).map((item, i) => (
            <li
              key={i}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: s.accent ?? '#65F5C9',
                  flexShrink: 0,
                  marginTop: 8,
                }}
              />
              {upd ? (
                <div
                  style={{
                    flex: 1,
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                  }}
                >
                  <input
                    value={item}
                    onChange={(e) => {
                      const newItems = [...d.items];
                      newItems[i] = e.target.value;
                      upd({ items: newItems });
                    }}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      fontSize: 16,
                      color: s.text ?? '#fff',
                      fontFamily: s.fontBody
                        ? `'${s.fontBody}', sans-serif`
                        : 'inherit',
                      lineHeight: 1.6,
                    }}
                    placeholder="Add an observation\u2026"
                  />
                  <button
                    onClick={() =>
                      upd({ items: (d.items ?? []).filter((_, j) => j !== i) })
                    }
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: `${s.text ?? '#fff'}40`,
                      fontSize: 16,
                      padding: '0 4px',
                    }}
                  >
                    \u00d7
                  </button>
                </div>
              ) : (
                <span
                  style={{
                    fontSize: 16,
                    color: s.text ?? '#fff',
                    lineHeight: 1.6,
                  }}
                >
                  {item}
                </span>
              )}
            </li>
          ))}
        </ul>
        {upd && (
          <button
            onClick={() => upd({ items: [...d.items, ''] })}
            style={{
              marginTop: 16,
              background: 'none',
              border: `1px dashed ${s.accent ?? '#65F5C9'}40`,
              borderRadius: 8,
              padding: '8px 16px',
              color: s.accent ?? '#65F5C9',
              fontSize: 13,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            + Add point
          </button>
        )}
      </div>
    </section>
  );
}

// ============================================================
// TABLE OF CONTENTS
// ============================================================
interface TableOfContentsRendererProps {
  block: Block;
  onDataChange?: (data: import('@/lib/blocks').TableOfContentsData) => void;
  allBlocks?: Block[];
}
export function TableOfContentsRenderer({
  block,
  onDataChange,
  allBlocks,
}: TableOfContentsRendererProps) {
  const d = block.data as import('@/lib/blocks').TableOfContentsData;
  const s = block.styles;
  const upd = onDataChange
    ? (patch: Partial<import('@/lib/blocks').TableOfContentsData>) =>
        onDataChange({ ...d, ...patch })
    : undefined;

  // Auto-derive items from sibling blocks if no manual items set
  const derivedItems = React.useMemo(() => {
    if (!allBlocks) return d.items;
    const headingTypes = [
      'hero',
      'text_block',
      'pricing_table',
      'team_cards',
      'roadmap',
      'testimonial',
      'case_study',
      'faq',
      'guarantee',
      'process_steps',
      'recommendations',
    ];
    const labelMap: Record<string, string> = {
      hero: 'Introduction',
      text_block: 'Overview',
      pricing_table: 'Pricing',
      team_cards: 'Our Team',
      roadmap: 'Timeline',
      testimonial: 'Testimonials',
      case_study: 'Case Study',
      faq: 'FAQ',
      guarantee: 'Guarantee',
      process_steps: 'Our Process',
      recommendations: 'Recommendations',
    };
    return allBlocks
      .filter((b) => b.id !== block.id && headingTypes.includes(b.type))
      .map((b) => {
        const data = b.data as unknown as Record<string, unknown>;
        const label =
          typeof data.headline === 'string' && data.headline.trim()
            ? data.headline.trim()
            : (labelMap[b.type] ?? b.type);
        return { label, anchor: `block-${b.id}` };
      });
  }, [allBlocks, d.items, block.id]);

  const items = d.items.length > 0 ? d.items : derivedItems;

  return (
    <section
      style={{
        ...css(s),
        padding: `${s.paddingTop ?? 48}px clamp(24px,6vw,96px) ${s.paddingBottom ?? 48}px`,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {/* Title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 32,
          }}
        >
          <div
            style={{
              width: 3,
              height: 28,
              borderRadius: 2,
              background: s.accent ?? '#65F5C9',
            }}
          />
          {upd ? (
            <Editable
              value={d.title}
              onChange={(v) => upd({ title: v })}
              tag="h3"
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: s.text ?? '#fff',
                fontFamily: s.fontHeading
                  ? `'${s.fontHeading}', sans-serif`
                  : 'inherit',
                margin: 0,
              }}
              placeholder="In this proposal"
            />
          ) : (
            <h3
              style={{
                fontSize: 22,
                fontWeight: 600,
                color: s.text ?? '#fff',
                fontFamily: s.fontHeading
                  ? `'${s.fontHeading}', sans-serif`
                  : 'inherit',
                margin: 0,
              }}
            >
              {d.title}
            </h3>
          )}
        </div>
        {/* Items */}
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
          }}
        >
          {items.map((item, i) => (
            <li key={i}>
              <a
                href={`#${item.anchor}`}
                onClick={(e) => {
                  e.preventDefault();
                  const el = document.getElementById(item.anchor);
                  if (el)
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '14px 0',
                  borderBottom: `1px solid ${s.accent ?? '#65F5C9'}18`,
                  textDecoration: 'none',
                  color: 'inherit',
                  cursor: 'pointer',
                  transition: 'opacity 150ms',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    color: s.accent ?? '#65F5C9',
                    minWidth: 24,
                    fontFamily: 'monospace',
                  }}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span
                  style={{
                    flex: 1,
                    fontSize: 16,
                    fontWeight: 400,
                    color: s.text ?? '#fff',
                    fontFamily: s.fontBody
                      ? `'${s.fontBody}', sans-serif`
                      : 'inherit',
                  }}
                >
                  {item.label}
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  style={{ color: `${s.accent ?? '#65F5C9'}60`, flexShrink: 0 }}
                >
                  <path
                    d="M3 7h8M7 3l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
            </li>
          ))}
        </ol>
        {items.length === 0 && (
          <div
            style={{
              padding: '32px 0',
              textAlign: 'center',
              color: `${s.text ?? '#fff'}40`,
              fontSize: 14,
            }}
          >
            {upd
              ? "Add blocks to your proposal — they'll appear here automatically."
              : 'No sections yet.'}
          </div>
        )}
        {upd && d.items.length > 0 && (
          <button
            onClick={() => upd({ items: [] })}
            style={{
              marginTop: 16,
              background: 'none',
              border: `1px dashed ${s.accent ?? '#65F5C9'}40`,
              borderRadius: 8,
              padding: '8px 16px',
              color: `${s.text ?? '#fff'}60`,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            Reset to auto-generated
          </button>
        )}
      </div>
    </section>
  );
}
