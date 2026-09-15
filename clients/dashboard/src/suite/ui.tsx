/* Prodesk Suite — UI primitives shared across the shell (ported from ui.jsx). */

import { useState, useEffect } from 'react';
import type { CSSProperties, ReactNode, KeyboardEvent } from 'react';
import { Icon } from './icons';

/* ---- responsive hook ---- */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setMatch(m.matches);
    m.addEventListener('change', fn);
    window.addEventListener('resize', fn);
    fn();
    return () => {
      m.removeEventListener('change', fn);
      window.removeEventListener('resize', fn);
    };
  }, [query]);
  return match;
}
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 720px)');
}

/* ---- wordmark (text — no external asset) ---- */
export function Wordmark({
  onClick,
  onInk = false,
  height = 22,
}: {
  onClick?: () => void;
  onInk?: boolean;
  height?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Home"
      aria-label="Prodesk — home"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span
        style={{
          fontWeight: 800,
          fontSize: height * 0.9,
          letterSpacing: '-0.04em',
          lineHeight: 1,
          color: onInk ? '#FBFAF4' : 'var(--ink)',
        }}
      >
        Pro
        <span
          style={{
            color: 'var(--volt)',
            WebkitTextStroke: onInk ? '0' : '0.4px var(--ink)',
          }}
        >
          Desk
        </span>
      </span>
    </button>
  );
}

/* ---- button ---- */
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  onClick,
  type = 'button',
  full = false,
  disabled = false,
  leftIcon,
  style = {},
}: {
  children: ReactNode;
  variant?: Variant;
  size?: 'sm' | 'md';
  onClick?: () => void;
  type?: 'button' | 'submit';
  full?: boolean;
  disabled?: boolean;
  leftIcon?: string;
  style?: CSSProperties;
}) {
  const [hover, setHover] = useState(false);
  const base: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'var(--font)',
    fontWeight: 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    borderRadius: 'var(--r-2)',
    border: '1px solid transparent',
    whiteSpace: 'nowrap',
    transition:
      'background var(--dur) var(--ease), border-color var(--dur) var(--ease), opacity var(--dur)',
    width: full ? '100%' : 'auto',
    opacity: disabled ? 0.45 : 1,
    fontSize: size === 'sm' ? 13 : 14,
    padding: size === 'sm' ? '7px 12px' : '10px 16px',
  };
  const variants: Record<Variant, CSSProperties> = {
    primary: {
      background: 'var(--volt)',
      color: 'var(--ink)',
      borderColor: 'var(--ink)',
      fontWeight: 600,
    },
    secondary: {
      background: 'var(--white)',
      color: 'var(--ink)',
      borderColor: 'var(--rule-2)',
    },
    ghost: {
      background: 'transparent',
      color: 'var(--ink)',
      borderColor: 'transparent',
    },
    danger: {
      background: 'var(--white)',
      color: 'var(--color-danger)',
      borderColor: 'rgba(210,74,42,0.4)',
    },
  };
  const hoverStyle: CSSProperties =
    !disabled && hover
      ? variant === 'primary'
        ? { background: 'var(--volt-hover)' }
        : variant === 'ghost'
          ? { background: 'var(--paper-2)' }
          : variant === 'danger'
            ? { background: '#fbf1ee' }
            : { background: 'var(--paper-2)' }
      : {};
  return (
    <button
      type={type}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ ...base, ...variants[variant], ...hoverStyle, ...style }}
    >
      {leftIcon && <Icon name={leftIcon} size={16} />}
      {children}
    </button>
  );
}

/* ---- text field ---- */
export function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  autoFocus,
  leftIcon,
  onKeyDown,
  type = 'text',
  id,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  autoFocus?: boolean;
  leftIcon?: string;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  type?: string;
  id?: string;
}) {
  const [focus, setFocus] = useState(false);
  return (
    <label htmlFor={id} style={{ display: 'block' }}>
      {label && (
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 6,
            color: 'var(--ink)',
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--white)',
          border: `1px solid ${focus ? 'var(--ink)' : 'var(--rule)'}`,
          borderRadius: 'var(--r-2)',
          padding: '0 12px',
          height: 40,
          transition: 'border-color var(--dur) var(--ease)',
        }}
      >
        {leftIcon && (
          <Icon
            name={leftIcon}
            size={16}
            style={{ color: 'var(--ink-3)', flexShrink: 0 }}
          />
        )}
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            width: '100%',
            fontFamily: 'var(--font)',
            fontSize: 14,
            color: 'var(--ink)',
            height: '100%',
          }}
        />
      </div>
      {hint && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
          {hint}
        </div>
      )}
    </label>
  );
}

/* ---- brand mark (monogram square, monochrome) ---- */
export function BrandMark({
  mono,
  logo,
  size = 28,
  active = false,
}: {
  mono: string;
  logo?: string;
  size?: number;
  active?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (logo && !failed) {
    return (
      <img
        src={logo}
        alt=""
        loading="eager"
        onError={() => setFailed(true)}
        style={{
          width: size,
          height: size,
          flexShrink: 0,
          borderRadius: 'var(--r-2)',
          objectFit: 'cover',
          border: '1px solid var(--rule-2)',
          display: 'block',
        }}
      />
    );
  }
  return (
    <span
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 'var(--r-2)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid var(--rule-2)',
        background: active ? 'var(--ink)' : 'var(--white)',
        color: active ? 'var(--paper)' : 'var(--ink)',
        fontWeight: 700,
        fontSize: size <= 24 ? 10 : 11,
        letterSpacing: '0.02em',
      }}
    >
      {mono}
    </span>
  );
}

/* Circular profile avatar — renders the photo when set, falling back to initials
   on a dark fill (and on image load error). Used for the account/vendor chrome. */
export function Avatar({
  src,
  initials,
  size = 36,
  fontSize,
  ring,
}: {
  src?: string;
  initials: string;
  size?: number;
  fontSize?: number;
  ring?: string;
}) {
  const [failed, setFailed] = useState(false);
  const box: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    ...(ring ? { boxShadow: `0 0 0 2px ${ring}` } : {}),
  };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="eager"
        onError={() => setFailed(true)}
        style={{ ...box, objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <span
      style={{
        ...box,
        background: 'var(--ink)',
        color: 'var(--paper)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: fontSize ?? Math.round(size * 0.36),
      }}
    >
      {initials}
    </span>
  );
}

/* ---- empty state ---- */
export function EmptyState({
  text,
  ctaLabel,
  onCta,
}: {
  text: string;
  ctaLabel?: string;
  onCta?: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '64px 24px',
        gap: 16,
      }}
    >
      <p
        style={{
          margin: 0,
          color: 'var(--ink-2)',
          fontSize: 14,
          maxWidth: 360,
        }}
      >
        {text}
      </p>
      {ctaLabel && (
        <Button variant="primary" size="sm" onClick={onCta}>
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}

/* ---- modal / drawer scaffolding ---- */
export function Scrim({
  onClick,
  children,
  align = 'center',
}: {
  onClick?: () => void;
  children: ReactNode;
  align?: 'center' | 'right' | 'left';
}) {
  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClick && onClick();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClick]);
  return (
    <div
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClick && onClick();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(244,241,232,0.72)',
        display: 'flex',
        alignItems: align === 'center' ? 'center' : 'stretch',
        justifyContent:
          align === 'right'
            ? 'flex-end'
            : align === 'left'
              ? 'flex-start'
              : 'center',
      }}
    >
      {children}
    </div>
  );
}

/* ---- confirmation modal ---- */
export function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Scrim onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(420px, calc(100vw - 32px))',
          background: 'var(--white)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          padding: 24,
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700 }}>
          {title}
        </h2>
        <p style={{ margin: '0 0 20px', color: 'var(--ink-2)', fontSize: 14 }}>
          {body}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Scrim>
  );
}

/* ---- toast system ---- */
type Toast = { id: string; message: string; kind: string };
const toastListeners = new Set<(t: Toast) => void>();
export function pushToast(message: string, kind = 'info') {
  const t: Toast = { id: Math.random().toString(36).slice(2), message, kind };
  toastListeners.forEach((fn) => fn(t));
}
export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const fn = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(
        () => setToasts((prev) => prev.filter((x) => x.id !== t.id)),
        3600,
      );
    };
    toastListeners.add(fn);
    return () => {
      toastListeners.delete(fn);
    };
  }, []);
  const icon: Record<string, string> = {
    success: 'check',
    info: 'arrowRight',
    warning: 'warning',
    error: 'warning',
  };
  return (
    <div
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 24,
        zIndex: 400,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '10px 16px',
            borderRadius: 'var(--r-2)',
            boxShadow: 'var(--shadow-drawer)',
            fontSize: 13,
            maxWidth: 'min(460px, calc(100vw - 32px))',
            animation: 'pd-rise var(--dur) var(--ease)',
          }}
        >
          <Icon
            name={icon[t.kind] || 'arrowRight'}
            size={16}
            style={{
              color:
                t.kind === 'error'
                  ? '#ff8b80'
                  : t.kind === 'warning'
                    ? '#ffd479'
                    : 'var(--volt)',
              flexShrink: 0,
            }}
          />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ---- loading skeleton ---- */
export function Skeleton({
  w = '100%',
  h = 14,
  r = 4,
  style = {},
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className="pd-skel"
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}
