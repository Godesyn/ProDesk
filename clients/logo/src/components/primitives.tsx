import type { ReactNode } from 'react';

/** Mono uppercase eyebrow — the studio's structural label. */
export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <p className={`spec ${className}`}>{children}</p>;
}

/** Page header used across content screens: index number, eyebrow, title, lede. */
export function PageHeader({
  index,
  eyebrow,
  title,
  lede,
  action,
}: {
  index?: string;
  eyebrow: string;
  title: ReactNode;
  lede?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="rise flex flex-wrap items-end justify-between gap-6 border-b border-[var(--hair-2)] pb-7">
      <div className="max-w-2xl">
        <div className="mb-3 flex items-center gap-3">
          {index && (
            <span className="spec text-[var(--pigment)]" style={{ fontSize: 12 }}>
              {index}
            </span>
          )}
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
        <h1 className="text-h1 text-[var(--ink)]">{title}</h1>
        {lede && <p className="mt-3 text-body-lg text-[var(--ink-2)]">{lede}</p>}
      </div>
      {action}
    </header>
  );
}

/** Small stat / KPI cell. */
export function Stat({
  value,
  label,
  accent = false,
}: {
  value: ReactNode;
  label: string;
  accent?: boolean;
}) {
  return (
    <div>
      <div
        className="text-kpi tnum"
        style={{ color: accent ? 'var(--pigment)' : 'var(--ink)' }}
      >
        {value}
      </div>
      <div className="spec mt-1">{label}</div>
    </div>
  );
}

/** A quiet card surface. */
export function Panel({
  children,
  className = '',
  pad = true,
}: {
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <div
      className={`rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--card)] ${
        pad ? 'p-6' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** The one true action — pigment appears here (a moment of commitment). */
export function PigmentButton({
  children,
  onClick,
  className = '',
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      className={`press inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-semibold text-white transition-[filter] hover:brightness-105 ${className}`}
      style={{ background: 'var(--pigment)' }}
    >
      {children}
    </button>
  );
}

/** Ghost / ink outline button — the everyday, colourless action. */
export function InkButton({
  children,
  onClick,
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press inline-flex h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-transparent px-5 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--stage-2)] ${className}`}
    >
      {children}
    </button>
  );
}

/** Small pill tag. */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-3 py-1 text-xs font-medium text-[var(--ink-2)]">
      {children}
    </span>
  );
}
