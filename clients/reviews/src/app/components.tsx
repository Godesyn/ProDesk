/* Verdiict app — shared presentational components built on the scoped `v`
 * design system (styles/verdiict.css). Icons come from lucide-react (already a
 * template dependency); these are the small repeated primitives. */
import { useEffect, useMemo, useRef } from 'react';
import { Star, X, Plus } from 'lucide-react';
import QRCodeStyling from 'qr-code-styling';
import type { CSSProperties, MutableRefObject, ReactNode } from 'react';

export function Stars({ value, size = 15 }: { value: number; size?: number }) {
  return (
    <span className="vstars" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= value ? 'fill-current' : ''}
          style={{ opacity: i <= value ? 1 : 0.22 }}
        />
      ))}
    </span>
  );
}

export function StatusPill({ on, labels }: { on: boolean; labels?: [string, string] }) {
  const [onL, offL] = labels ?? ['Active', 'Inactive'];
  return (
    <span className={'vstatus ' + (on ? 'on' : 'off')}>
      <span className="sdot" />
      {on ? onL : offL}
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
      className={'vtoggle' + (on ? ' on' : '')}
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
    <div className="vseg">
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

export function StatTile({ n, l }: { n: ReactNode; l: string }) {
  return (
    <div className="vstat">
      <div className="n">{n}</div>
      <div className="l">{l}</div>
    </div>
  );
}

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
      className="vmodal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="vmodal"
        style={width ? { maxWidth: width } : undefined}
      >
        <div className="vrow-between" style={{ marginBottom: 12 }}>
          <h3>{title}</h3>
          <button className="vbtn vbtn-quiet vbtn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
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
    <div className="vempty">
      <span className="serif">{title}</span>
      <p>{body}</p>
      {cta ? (
        <button className="vbtn vbtn-primary" onClick={onCta}>
          <Plus size={15} />
          {cta}
        </button>
      ) : null}
    </div>
  );
}

/** QR code painted via qr-code-styling (same library as clients/links). Pass an
 * instanceRef to call download() for the PNG export. High error correction so a
 * printed sticker still scans when partially damaged. */
export function QrCode({
  value,
  size = 220,
  instanceRef,
  style,
}: {
  value: string;
  size?: number;
  instanceRef?: MutableRefObject<QRCodeStyling | null>;
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const options = useMemo(
    () => ({
      width: size,
      height: size,
      type: 'svg' as const,
      data: value,
      margin: Math.max(2, Math.round(size * 0.04)),
      qrOptions: { errorCorrectionLevel: 'H' as const },
      dotsOptions: { color: '#14140f' },
      backgroundOptions: { color: '#ffffff' },
    }),
    [value, size],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    const obj = new QRCodeStyling(options);
    obj.append(containerRef.current);
    if (instanceRef) instanceRef.current = obj;
    return () => {
      if (instanceRef) instanceRef.current = null;
    };
  }, [options, instanceRef]);

  return <div ref={containerRef} style={{ display: 'inline-flex', ...style }} />;
}

export function SkeletonRows({ rows = 5, style }: { rows?: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, ...style }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: 'flex', gap: 14 }}>
          <div className="vskel" style={{ height: 18, width: 150 }} />
          <div className="vskel" style={{ height: 18, flex: 2 }} />
          <div className="vskel" style={{ height: 18, flex: 1 }} />
          <div className="vskel" style={{ height: 18, width: 70 }} />
        </div>
      ))}
    </div>
  );
}
