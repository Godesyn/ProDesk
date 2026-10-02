/* Adeyy app — shared presentational components.
 * Ported from the Manus export's components.jsx + QR helper adapted to the
 * qr-code-styling lib already used by @shared/pages/brand/links. */
import {
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type ReactNode,
} from 'react';
import QRCodeStyling from 'qr-code-styling';
import { qrUrl, daysUntilDeletion } from './lib';

/* ── Icons ─────────────────────────────────────────────────────────────── */

const ICONS: Record<string, ReactNode> = {
  link: <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 1 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 1 0 6 6l1-1" />,
  qr: (
    <g>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M21 14v7h-7M17 21h.01M21 17h.01" />
    </g>
  ),
  folder: <path d="M3 7a1 1 0 0 1 1-1h5l2 2.5h8a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />,
  chart: <path d="M4 19V11M10 19V5M16 19v-6M21 19H3" />,
  card: (
    <g>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </g>
  ),
  settings: (
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </g>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <g>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4-4" />
    </g>
  ),
  copy: (
    <g>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </g>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  download: <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />,
  edit: <path d="M4 20l4-1L20 7a2 2 0 0 0-3-3L5 16l-1 4zM14 6l3 3" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />,
  upload: <path d="M12 15V3M7 8l5-5 5 5M4 21h16" />,
  external: <path d="M7 17L17 7M9 7h8v8" />,
  calendar: (
    <g>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </g>
  ),
  suite: (
    <g>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="14" width="6" height="6" rx="1" />
    </g>
  ),
  chevronRight: <path d="M9 6l6 6-6 6" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  history: <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  help: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 3.8M12 17h.01" />
    </g>
  ),
};

export function Icon({ name, size = 17 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name] ?? null}
    </svg>
  );
}

/* ── Status / toggle / chips ───────────────────────────────────────────── */

export function StatusPill({
  on,
  disabledAt,
  createdAt,
}: {
  on: boolean;
  disabledAt?: string | Date | null;
  createdAt?: string | Date | null;
}) {
  if (on) {
    return (
      <span className="status on">
        <span className="sdot" />
        Active
      </span>
    );
  }
  const days = daysUntilDeletion(disabledAt, createdAt);
  const isUrgent = days < 5;
  const tooltip = `The link deletes in ${days} day${days === 1 ? '' : 's'}`;

  return (
    <span
      className={`status off${isUrgent ? ' urgent' : ''}`}
      style={isUrgent ? { color: '#dc2626', borderColor: '#fca5a5', background: 'rgba(254, 242, 242, 0.8)' } : undefined}
      title={tooltip}
    >
      <span className="sdot" style={isUrgent ? { borderColor: '#dc2626', background: '#dc2626' } : undefined} />
      {`Disabled (${days}d)`}
    </span>
  );
}

export function Toggle({
  on,
  onChange,
  disabled,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={'atoggle' + (on ? ' on' : '')}
      disabled={disabled}
      aria-pressed={on}
      onClick={() => !disabled && onChange(!on)}
    />
  );
}

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'sel' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Swatches({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ name: string; hex: string }>;
  onChange: (hex: string) => void;
}) {
  return (
    <div className="swatches">
      {options.map((o) => (
        <button
          key={o.hex}
          type="button"
          title={o.name}
          className={'swatch' + (value === o.hex ? ' sel' : '')}
          style={{ background: o.hex }}
          onClick={() => onChange(o.hex)}
        />
      ))}
    </div>
  );
}

/* ── Modal / empty / skeleton ──────────────────────────────────────────── */

export function Modal({
  title,
  children,
  onClose,
  width,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  return (
    <div
      className="amodal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="amodal"
        style={width ? { maxWidth: width } : undefined}
      >
        <div className="row-between" style={{ marginBottom: 4 }}>
          <h3>{title}</h3>
          <button
            className="abtn abtn-quiet abtn-sm"
            onClick={onClose}
            aria-label="Close"
          >
            <Icon name="close" size={15} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  cta,
  onCta,
}: {
  title: string;
  body: string;
  cta?: string;
  onCta?: () => void;
}) {
  return (
    <div className="aempty">
      <div className="serif">{title}</div>
      <p>{body}</p>
      {cta ? (
        <button className="abtn abtn-primary" onClick={onCta}>
          <Icon name="plus" size={15} />
          {cta}
        </button>
      ) : null}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 0' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14 }}>
          <div className="skel" style={{ height: 16, width: 130 }} />
          <div className="skel" style={{ height: 16, flex: 2 }} />
          <div className="skel" style={{ height: 16, flex: 1 }} />
          <div className="skel" style={{ height: 16, width: 70 }} />
        </div>
      ))}
    </div>
  );
}

/* ── QR rendering (qr-code-styling) ────────────────────────────────────── */

export type QrConfig = {
  logoUrl?: string;
  foregroundColor?: string;
  backgroundColor?: string;
  dotStyle?: 'square' | 'rounded' | 'dots' | 'classy';
  cornerStyle?: 'square' | 'rounded' | 'dots' | 'dot' | 'extra-rounded';
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const isHex = (v?: string) => !!v && HEX_RE.test(v);

export function buildQrOptions(slug: string, config: QrConfig | undefined, size: number) {
  const fg = isHex(config?.foregroundColor) ? config!.foregroundColor! : '#0e0e0c';
  const bg = isHex(config?.backgroundColor) ? config!.backgroundColor! : '#fbfaf4';
  return {
    width: size,
    height: size,
    type: 'svg' as const,
    data: qrUrl(slug),
    margin: Math.max(2, Math.round(size * 0.04)),
    qrOptions: { errorCorrectionLevel: 'H' as const },
    dotsOptions: { color: fg, type: (config?.dotStyle || 'square') as never },
    cornersSquareOptions: { color: fg, type: (config?.cornerStyle || 'square') as never },
    backgroundOptions: { color: bg },
  };
}

/** Paints a QR via qr-code-styling once on mount, then update()s on changes. */
export function QRView({
  options,
  instanceRef,
  className,
  style,
}: {
  options: ReturnType<typeof buildQrOptions>;
  instanceRef?: React.MutableRefObject<QRCodeStyling | null>;
  className?: string;
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const obj = new QRCodeStyling(options);
    obj.append(containerRef.current);
    if (instanceRef) instanceRef.current = obj;
    return () => {
      if (instanceRef) instanceRef.current = null;
    };
    // Created once on mount; live edits handled by the update effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    instanceRef?.current?.update(options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(options)]);

  return <div ref={containerRef} className={className} style={style} />;
}

/** Small inline QR that owns its own instance (for previews/lists). */
export function QrPreview({
  slug,
  config,
  size = 220,
  style,
}: {
  slug: string;
  config?: QrConfig;
  size?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<QRCodeStyling | null>(null);
  const options = useMemo(
    () => buildQrOptions(slug, config, size),
    [slug, config, size],
  );
  return <QRView options={options} instanceRef={ref} style={style} />;
}
