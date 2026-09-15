/* Editable, validated fields for AI confirm cards.
 *
 * Each confirm card declares a list of FieldSpecs describing its editable
 * fields; this renders type-appropriate inputs (text/email/url/number/year/
 * date/select/textarea) bound to a values map, validates them synchronously,
 * and reports errors so the card can block Confirm while anything is invalid.
 *
 * Client-side validation here mirrors the cheap FORMAT/RANGE rules only. The
 * server's Zod schema on the actual mutation stays the source of truth, and
 * relational/async rules (uniqueness, "endsAt after startsAt", subscription
 * gates) are surfaced from the mutation's {error} — not re-implemented here. */
import { useMemo } from 'react';

export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'url'
  | 'tel'
  | 'number'
  | 'year'
  | 'date'
  | 'select';

export interface FieldSpec {
  /** Payload key this field reads/writes. */
  key: string;
  label: string;
  type?: FieldType; // default 'text'
  required?: boolean;
  /** number/year: inclusive bounds. year also defaults max to the current year. */
  min?: number;
  max?: number;
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** Multi-line hint for 'textarea' sizing. */
  rows?: number;
  /** Small helper text under the field. */
  hint?: string;
  /** For 'date': allow dates in the future (e.g. a campaign start). Default caps at today. */
  future?: boolean;
}

/** Today's date as YYYY-MM-DD (local), for the date input's max. */
function todayISODate(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate one field's current value; returns an error message or null. */
export function validateField(spec: FieldSpec, raw: unknown): string | null {
  const type = spec.type ?? 'text';
  const value = raw == null ? '' : String(raw).trim();

  if (!value) {
    return spec.required ? `${spec.label} is required.` : null;
  }

  switch (type) {
    case 'email':
      return EMAIL_RE.test(value) ? null : `${spec.label} must be a valid email address.`;
    case 'url': {
      try {
        // Accept bare domains by assuming https when no scheme is present.
        new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        return null;
      } catch {
        return `${spec.label} must be a valid URL.`;
      }
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return `${spec.label} must be a number.`;
      if (spec.min != null && n < spec.min) return `${spec.label} must be at least ${spec.min}.`;
      if (spec.max != null && n > spec.max) return `${spec.label} must be at most ${spec.max}.`;
      return null;
    }
    case 'year': {
      const n = Number(value);
      const maxYear = spec.max ?? new Date().getFullYear();
      const minYear = spec.min ?? 1800;
      if (!Number.isInteger(n)) return `${spec.label} must be a year (e.g. 2018).`;
      if (n < minYear) return `${spec.label} must be ${minYear} or later.`;
      if (n > maxYear) return `${spec.label} can't be later than ${maxYear}.`;
      return null;
    }
    case 'date': {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return `${spec.label} must be a valid date.`;
      // Dates must be today or earlier, unless the field explicitly allows the future.
      if (!spec.future && value > todayISODate()) return `${spec.label} can't be in the future.`;
      return null;
    }
    case 'select':
      return (spec.options ?? []).some((o) => o.value === value)
        ? null
        : `Choose a valid ${spec.label.toLowerCase()}.`;
    default:
      return null;
  }
}

/** Validate every field; returns { key -> errorMessage } for the invalid ones. */
export function validateFields(specs: FieldSpec[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const spec of specs) {
    const err = validateField(spec, values[spec.key]);
    if (err) errors[spec.key] = err;
  }
  return errors;
}

const inputCls =
  'w-full rounded-[var(--radius-sm)] border bg-card px-2.5 py-1.5 text-sm text-ink-100 outline-none disabled:opacity-70';

function borderCls(hasError: boolean): string {
  return hasError
    ? 'border-[color:var(--color-danger,#dc2626)] focus:border-[color:var(--color-danger,#dc2626)]'
    : 'border-[color:var(--color-border-default)] focus:border-[color:var(--color-accent)]';
}

export function EditableCardFields({
  specs,
  values,
  onChange,
  errors,
  /** Optional slot renderer for a specific field key (e.g. address → Places input). */
  renderField,
  /** Render read-only (e.g. after the card is confirmed). */
  disabled,
}: {
  specs: FieldSpec[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  errors: Record<string, string>;
  renderField?: (spec: FieldSpec) => React.ReactNode | null;
  disabled?: boolean;
}) {
  const today = useMemo(todayISODate, []);
  return (
    <div className="space-y-2">
      {specs.map((spec) => {
        const type = spec.type ?? 'text';
        const err = errors[spec.key];
        const raw = values[spec.key];
        const val = raw == null ? '' : String(raw);
        const custom = renderField?.(spec);
        return (
          <div key={spec.key}>
            <label className="mb-0.5 block text-[11px] font-medium text-ink-40">
              {spec.label}
              {spec.required && <span className="text-[color:var(--color-danger,#dc2626)]"> *</span>}
            </label>
            {custom ?? (
              <>
                {type === 'textarea' ? (
                  <textarea
                    value={val}
                    rows={spec.rows ?? 3}
                    placeholder={spec.placeholder}
                    disabled={disabled}
                    className={`${inputCls} ${borderCls(!!err && !disabled)} resize-y`}
                    onChange={(e) => onChange(spec.key, e.target.value)}
                  />
                ) : type === 'select' ? (
                  <select
                    value={val}
                    disabled={disabled}
                    className={`${inputCls} ${borderCls(!!err && !disabled)}`}
                    onChange={(e) => onChange(spec.key, e.target.value)}
                  >
                    <option value="" disabled>
                      {spec.placeholder ?? 'Select…'}
                    </option>
                    {(spec.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={
                      type === 'number' || type === 'year'
                        ? 'number'
                        : type === 'date'
                          ? 'date'
                          : type === 'email'
                            ? 'email'
                            : type === 'tel'
                              ? 'tel'
                              : type === 'url'
                                ? 'url'
                                : 'text'
                    }
                    value={type === 'date' ? val.slice(0, 10) : val}
                    placeholder={spec.placeholder}
                    disabled={disabled}
                    max={
                      type === 'date'
                        ? spec.future
                          ? undefined
                          : today
                        : type === 'year'
                          ? spec.max ?? new Date().getFullYear()
                          : spec.max
                    }
                    min={type === 'year' ? spec.min ?? 1800 : spec.min}
                    className={`${inputCls} ${borderCls(!!err)}`}
                    onChange={(e) => onChange(spec.key, e.target.value)}
                  />
                )}
              </>
            )}
            {err && !disabled ? (
              <div className="mt-0.5 text-[11px] text-[color:var(--color-danger,#dc2626)]">{err}</div>
            ) : spec.hint ? (
              <div className="mt-0.5 text-[11px] text-ink-40">{spec.hint}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
