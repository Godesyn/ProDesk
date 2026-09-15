/**
 * Shared atomic components for the ProposalBuilder.
 * Icon set, tag pills, toggle switches, segmented controls.
 */
import React from "react";

// ---- Icon registry ----
const PATHS: Record<string, React.ReactNode> = {
  plus:     <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>,
  trash:    <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"><path d="M3 4h10M5 4V3h6v1M6 4l1 9h2l1-9"/></g>,
  send:     <path d="M14 2L1 8l5 2 2 5 6-13z" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinejoin="round"/>,
  eye:      <g stroke="currentColor" strokeWidth="1.5" fill="none"><path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z"/><circle cx="8" cy="8" r="2"/></g>,
  check:    <path d="M2 8l4 4 8-9" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
  x:        <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>,
  link:     <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"><path d="M6 10H4a4 4 0 010-8h2M10 6h2a4 4 0 010 8h-2M6 8h4"/></g>,
  up:       <path d="M8 12V4M4 8l4-4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
  down:     <path d="M8 4v8M4 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>,
  copy:     <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"><rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/></g>,
  tag:      <path d="M2 2h5l7 7-5 5-7-7V2zm3 2.5a.5.5 0 110 1 .5.5 0 010-1z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round"/>,
  grip:     <g fill="currentColor"><circle cx="5" cy="5" r="1.2"/><circle cx="5" cy="8" r="1.2"/><circle cx="5" cy="11" r="1.2"/><circle cx="9" cy="5" r="1.2"/><circle cx="9" cy="8" r="1.2"/><circle cx="9" cy="11" r="1.2"/></g>,
  section:  <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"><path d="M2 8h12M5 5l-3 3 3 3M11 5l3 3-3 3"/></g>,
  search:   <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></g>,
  chevdown: <path d="M3 6l5 5 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  chevup:   <path d="M3 10l5-5 5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>,
  desktop:  <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"><rect x="1" y="2" width="14" height="10" rx="1.5"/><path d="M5 14h6M8 12v2"/></g>,
  mobile:   <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"><rect x="4" y="1" width="8" height="14" rx="2"/><circle cx="8" cy="12" r="0.5" fill="currentColor"/></g>,
  star:     <path d="M8 1l2 5h5l-4 3 1.5 5L8 11l-4.5 3L5 9 1 6h5z" strokeLinejoin="round" stroke="currentColor" strokeWidth="1.5" fill="none"/>,
  lock:     <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"><rect x="1" y="5" width="14" height="6" rx="1.5"/><path d="M5 5V4a3 3 0 016 0v1"/></g>,
  "brand-assets": <g stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></g>,
  save:     <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M13 13H3a1 1 0 01-1-1V3l3-1h7l2 2v8a1 1 0 01-1 1z"/><path d="M10 3v4H5V3M5 13v-5h6v5"/></g>,
};

export function Icon({ name, size = 14 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      {PATHS[name] ?? null}
    </svg>
  );
}

// ---- Tag pill (category chip) ----
export function TagPill({
  code, name, tint,
}: { code: string; name: string; tint?: string }) {
  return (
    <span
      className="tag-pill tinted"
      style={tint ? { background: tint, borderColor: "transparent" } : undefined}
      title={name}
    >
      {code}
    </span>
  );
}

// ---- Toggle switch ----
export function Toggle({
  on, onChange,
}: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`tgl${on ? " on" : ""}`}
      onClick={() => onChange(!on)}
      aria-pressed={on}
    />
  );
}

// ---- Segmented control ----
export function SegControl<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg-control">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          className={`seg-btn${value === o.value ? " on" : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Button icon ----
export function BtnIcon({
  onClick, title, children, className = "",
}: {
  onClick?: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" className={`btn-icon ${className}`} onClick={onClick} title={title}>
      {children}
    </button>
  );
}

// ---- Format currency ----
export function fmtCurrency(cents: number, currency = "AUD") {
  return new Intl.NumberFormat("en-AU", {
    style: "currency", currency,
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(cents / 100);
}
