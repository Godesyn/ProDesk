/*
 * Shared color picker — the ONE color input every frontend should use (main app,
 * reviews, links, payments). A swatch button opens a popover with a react-colorful
 * spectrum, a hex field, and preset swatches. Deliberately DESIGN-SYSTEM-AGNOSTIC:
 * styled with inline styles + `currentColor`/system defaults so it looks right in
 * any client's theme without importing that client's CSS tokens. Never drop back
 * to a raw `<input type="color">` — those render the OS picker, which is
 * inconsistent across platforms and can't show brand presets. See AGENTS.md.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';

const DEFAULT_PRESETS = [
  '#000000',
  '#ffffff',
  '#1f2937',
  '#0f172a',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const isHex = (v: string): boolean => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

export interface ColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /** Preset swatches shown under the spectrum. Defaults to a neutral brand set. */
  presets?: string[];
  /** Accessible label for the trigger (also shown as the hex text when valid). */
  ariaLabel?: string;
  disabled?: boolean;
  /** Extra class on the trigger button, if a caller wants to size/space it. */
  className?: string;
}

/** A color field: swatch + hex text trigger that opens a popover picker. */
export function ColorPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  ariaLabel = 'Pick a color',
  disabled,
  className,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popId = useId();
  const valid = isHex(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid rgba(128,128,128,0.35)',
          background: 'transparent',
          color: 'inherit',
          font: 'inherit',
          fontSize: 13,
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 20,
            height: 20,
            flexShrink: 0,
            borderRadius: 5,
            border: '1px solid rgba(128,128,128,0.4)',
            background: valid ? value : 'transparent',
          }}
        />
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {valid ? value : 'Pick'}
        </span>
      </button>

      {open ? (
        <div
          id={popId}
          role="dialog"
          style={{
            position: 'absolute',
            zIndex: 50,
            top: 'calc(100% + 6px)',
            left: 0,
            width: 216,
            padding: 12,
            borderRadius: 12,
            background: 'var(--color-paper, #fff)',
            color: 'var(--color-ink-100, #111)',
            border: '1px solid rgba(128,128,128,0.3)',
            boxShadow: '0 12px 32px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <HexColorPicker
            color={valid ? value : '#000000'}
            onChange={onChange}
            style={{ width: '100%', height: 150 }}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              border: '1px solid rgba(128,128,128,0.35)',
              borderRadius: 8,
              padding: '0 8px',
            }}
          >
            <span style={{ opacity: 0.5, userSelect: 'none' }}>#</span>
            <input
              value={value.replace(/^#/, '')}
              onChange={(e) =>
                onChange('#' + e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))
              }
              maxLength={6}
              placeholder="000000"
              style={{
                width: '100%',
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                font: 'inherit',
                fontSize: 13,
                textTransform: 'uppercase',
                padding: '7px 4px',
              }}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                aria-label={p}
                onClick={() => onChange(p)}
                style={{
                  height: 22,
                  borderRadius: 5,
                  cursor: 'pointer',
                  background: p,
                  border:
                    value.toLowerCase() === p.toLowerCase()
                      ? '2px solid var(--color-accent, #3b82f6)'
                      : '1px solid rgba(128,128,128,0.35)',
                }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
