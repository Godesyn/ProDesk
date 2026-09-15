/* Prodesk Foundations — shared components (ported from foundations/shared.jsx).
   Monochrome chrome; ink + dot statuses; the accent only for count pips and the
   single primary CTA. */

import type { ReactNode, CSSProperties } from 'react';
import { Icon } from './icons';
import { Button, Scrim } from './ui';

export interface Reference {
  where: string;
  app: string;
}

/* ---- tool page header ---- */
export function FndHeader({
  app,
  brand,
  count,
  countLabel,
  primaryLabel,
  onPrimary,
  ghostLabel,
  onGhost,
  pill,
  children,
}: {
  app: { icon: string; name: string; tag: string };
  brand: { name: string };
  count?: number;
  countLabel?: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  ghostLabel?: string;
  onGhost?: () => void;
  pill?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pd-toolhead" style={{ marginBottom: 20 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <span
          className="pd-toolhead-icon"
          style={{
            display: 'inline-flex',
            width: 44,
            height: 44,
            borderRadius: 12,
            background: 'var(--ink)',
            color: 'var(--paper)',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name={app.icon} size={23} stroke={1.9} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <h1 className="pd-toolhead-title">{app.name}</h1>
            <span className="pd-kind-pill">{pill || 'Source of truth'}</span>
            {count != null && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: 'var(--volt)',
                    flexShrink: 0,
                    boxShadow: '0 0 0 3px var(--volt-glow)',
                  }}
                />
                <span
                  className="tnum"
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {count} {countLabel}
                </span>
              </span>
            )}
          </div>
          <div className="eyebrow pd-toolhead-sub">
            {brand.name} · {app.tag}
          </div>
        </div>
        <div
          className="pd-toolhead-actions"
          style={{ display: 'flex', gap: 8, flexShrink: 0 }}
        >
          {ghostLabel && (
            <Button variant="secondary" size="sm" onClick={onGhost}>
              {ghostLabel}
            </Button>
          )}
          {primaryLabel && (
            <Button
              variant="primary"
              size="sm"
              leftIcon="plus"
              onClick={onPrimary}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/* ---- status: ink plus a dot ---- */
export function FndStatus({
  label,
  dim = false,
}: {
  label: string;
  dim?: boolean;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        fontSize: 13,
        color: dim ? 'var(--ink-3)' : 'var(--ink-2)',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          flexShrink: 0,
          background: dim ? 'var(--ink-3)' : 'var(--ink)',
          opacity: dim ? 0.5 : 1,
        }}
      />
      {label}
    </span>
  );
}

/* ---- references panel ---- */
export function UsedInList({
  rows,
  compact = false,
}: {
  rows: Reference[];
  compact?: boolean;
}) {
  if (!rows || rows.length === 0) {
    return (
      <div>
        <div className="eyebrow" style={{ marginBottom: 8 }}>
          Used in
        </div>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
          Not used anywhere yet. Safe to delete.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>
        Used in
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <div key={i} className="pd-fnd-ref">
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.where}
            </span>
            <Icon
              name="arrowur"
              size={13}
              style={{ color: 'var(--ink-3)', flexShrink: 0 }}
            />
          </div>
        ))}
      </div>
      {!compact && (
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 12,
            color: 'var(--ink-3)',
            textWrap: 'pretty',
          }}
        >
          Edits here update every one of these on next read. Nothing keeps a
          copy.
        </p>
      )}
    </div>
  );
}

export function ReferenceLockDialog({
  name,
  refCount,
  onArchive,
  onClose,
}: {
  name: string;
  refCount: number;
  onArchive: () => void;
  onClose: () => void;
}) {
  return (
    <Scrim onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          background: 'var(--white)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          padding: 24,
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 700 }}>
          {name} is in use
        </h2>
        <p
          style={{
            margin: '0 0 8px',
            color: 'var(--ink-2)',
            fontSize: 14,
            textWrap: 'pretty',
          }}
        >
          It is referenced in {refCount} {refCount === 1 ? 'place' : 'places'}.
          Deleting it would break those surfaces, so delete is blocked.
        </p>
        <p
          style={{
            margin: '0 0 20px',
            color: 'var(--ink-2)',
            fontSize: 14,
            textWrap: 'pretty',
          }}
        >
          Archive instead. Archived records leave the pickers but existing
          references keep resolving.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onArchive}>
            Archive
          </Button>
        </div>
      </div>
    </Scrim>
  );
}

export function FndDrawer({
  title,
  eyebrow,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Scrim onClick={onClose} align="right">
      <div
        role="dialog"
        aria-label={title}
        style={{
          width: 'min(460px, 94vw)',
          height: '100%',
          background: 'var(--white)',
          boxShadow: 'var(--shadow-drawer)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'pd-slide-right var(--dur) var(--ease)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 20px',
            borderBottom: '1px solid var(--rule)',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div className="eyebrow" style={{ fontSize: 10 }}>
                {eyebrow}
              </div>
            )}
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pd-icon-btn"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 20 }}>
          {children}
        </div>
        {footer && (
          <div
            style={{
              borderTop: '1px solid var(--rule)',
              padding: '12px 20px',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </Scrim>
  );
}

export function FndField({
  label,
  value,
  sub,
}: {
  label: string;
  value?: string;
  sub?: string;
}) {
  return (
    <div style={{ padding: '9px 0', borderBottom: '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 3 }}>
        {label}
      </div>
      <div
        style={{ fontSize: 14, color: 'var(--ink)', overflowWrap: 'anywhere' }}
      >
        {value || <span style={{ color: 'var(--ink-3)' }}>Not set</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function FndSection({
  title,
  action,
  onAction,
  children,
  style = {},
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section style={{ marginBottom: 22, ...style }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <div className="eyebrow">{title}</div>
        {action && (
          <button
            type="button"
            className="pd-textlink"
            style={{ fontSize: 12 }}
            onClick={onAction}
          >
            {action}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

export function FndToolbar({
  search,
  setSearch,
  placeholder,
  children,
}: {
  search: string;
  setSearch: (v: string) => void;
  placeholder: string;
  children?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        marginBottom: 12,
        minWidth: 0,
      }}
    >
      <div className="pd-find" style={{ width: 240, flexShrink: 0 }}>
        <Icon
          name="search"
          size={15}
          style={{ color: 'var(--ink-3)', flexShrink: 0 }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{
            border: 'none',
            outline: 'none',
            background: 'transparent',
            flex: 1,
            fontFamily: 'var(--font)',
            fontSize: 13.5,
            color: 'var(--ink)',
            minWidth: 0,
          }}
        />
      </div>
      {children && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            overflowX: 'auto',
            minWidth: 0,
            flex: 1,
            scrollbarWidth: 'none',
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function FndFilter({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--white)',
        border: '1px solid var(--rule-2)',
        borderRadius: 'var(--r-2)',
        padding: 3,
      }}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          style={{
            border: 'none',
            borderRadius: 4,
            padding: '5px 11px',
            fontSize: 12.5,
            cursor: 'pointer',
            fontFamily: 'var(--font)',
            fontWeight: value === o ? 600 : 500,
            background: value === o ? 'var(--ink)' : 'transparent',
            color: value === o ? 'var(--paper)' : 'var(--ink-2)',
          }}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function FndEmpty({
  line,
  cta,
  onCta,
}: {
  line: string;
  cta?: string;
  onCta?: () => void;
}) {
  return (
    <div style={{ padding: '56px 24px', textAlign: 'center' }}>
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--ink-2)' }}>
        {line}
      </p>
      {cta && (
        <Button variant="primary" size="sm" onClick={onCta}>
          {cta}
        </Button>
      )}
    </div>
  );
}

const fndInputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'var(--font)',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--white)',
  border: '1px solid var(--rule-2)',
  borderRadius: 'var(--r-2)',
  padding: '9px 11px',
  outline: 'none',
};

export function FndInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  sub,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  sub?: string | null;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        {label}
      </span>
      <input
        type={type}
        value={value == null ? '' : value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={fndInputStyle}
      />
      {sub && (
        <span
          style={{
            display: 'block',
            fontSize: 11.5,
            color: 'var(--ink-3)',
            marginTop: 4,
          }}
        >
          {sub}
        </span>
      )}
    </label>
  );
}

export function FndTextarea({
  label,
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        {label}
      </span>
      <textarea
        value={value == null ? '' : value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...fndInputStyle, resize: 'vertical', lineHeight: 1.5 }}
      />
    </label>
  );
}

export function FndSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label style={{ display: 'block', marginBottom: 12 }}>
      <span
        className="eyebrow"
        style={{ display: 'block', fontSize: 10, marginBottom: 5 }}
      >
        {label}
      </span>
      <select
        value={value == null ? '' : value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...fndInputStyle, appearance: 'auto', cursor: 'pointer' }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FndSwitch({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 40,
        height: 23,
        borderRadius: 999,
        border: '1px solid',
        cursor: 'pointer',
        flexShrink: 0,
        borderColor: checked ? 'var(--ink)' : 'var(--rule-2)',
        background: checked ? 'var(--ink)' : 'var(--paper-2)',
        position: 'relative',
        transition: 'background var(--dur) var(--ease)',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 19 : 2,
          width: 17,
          height: 17,
          borderRadius: '50%',
          background: checked ? 'var(--volt)' : 'var(--white)',
          border: '1px solid var(--rule-2)',
          transition: 'left var(--dur) var(--ease)',
        }}
      />
    </button>
  );
}

export function FndModal({
  title,
  eyebrow,
  onClose,
  children,
  footer,
  width = 480,
}: {
  title: string;
  eyebrow?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <Scrim onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: `min(${width}px, calc(100vw - 32px))`,
          maxHeight: 'min(86vh, 720px)',
          background: 'var(--white)',
          borderRadius: 'var(--r-3)',
          boxShadow: 'var(--shadow-drawer)',
          display: 'flex',
          flexDirection: 'column',
          animation: 'pd-rise var(--dur) var(--ease)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '16px 22px 12px',
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            {eyebrow && (
              <div className="eyebrow" style={{ fontSize: 10 }}>
                {eyebrow}
              </div>
            )}
            <h2
              style={{
                margin: 0,
                fontSize: 19,
                fontWeight: 700,
                letterSpacing: '-0.01em',
              }}
            >
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="pd-icon-btn"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '8px 22px 4px',
          }}
        >
          {children}
        </div>
        <div
          style={{
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
            padding: '14px 22px 18px',
            flexShrink: 0,
          }}
        >
          {footer}
        </div>
      </div>
    </Scrim>
  );
}

export function FndDeleteDialog({
  name,
  onDelete,
  onClose,
}: {
  name: string;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Scrim onClick={onClose}>
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
        <h2 style={{ margin: '0 0 8px', fontSize: 19, fontWeight: 700 }}>
          Delete {name}?
        </h2>
        <p
          style={{
            margin: '0 0 20px',
            color: 'var(--ink-2)',
            fontSize: 14,
            textWrap: 'pretty',
          }}
        >
          It isn&rsquo;t referenced anywhere, so this is safe. This can&rsquo;t
          be undone.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onDelete}>
            Delete
          </Button>
        </div>
      </div>
    </Scrim>
  );
}
