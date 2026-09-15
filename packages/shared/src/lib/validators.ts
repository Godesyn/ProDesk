/**
 * Field validators — a 1:1 port of Flutter `lib/src/core/utils/app_validator.dart`
 * (`AppValidator`). Each function returns `null` when the value is valid, or an
 * error string identical to the Flutter message when it is not.
 *
 * These back the service-form dialogs (New Service, New Project, Custom Item) so
 * the web enforces exactly the same per-field rules as the Flutter app. Values
 * arrive as the raw string typed into the input (matching Flutter's
 * `TextFormField` validators which receive `String?`).
 */

const PRICE_RE = /^\d+(\.\d{1,2})?$/;

function fieldRequired(value: string | null | undefined, fieldName?: string): string | null {
  if (value == null || value.trim() === '') {
    return fieldName != null ? `${fieldName} is required` : 'This field is required';
  }
  return null;
}

/** Ensures the field is not empty (Flutter `AppValidator.required`). */
export function required(value: string | null | undefined, fieldName?: string): string | null {
  return fieldRequired(value, fieldName);
}

/** Integer ≥ 0 (Flutter `AppValidator.positiveInteger`). */
export function positiveInteger(value: string | null | undefined, fieldName?: string): string | null {
  const req = fieldRequired(value, fieldName);
  if (req) return req;
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Please enter a valid number';
  if (n < 0) return 'Please enter a positive number';
  return null;
}

/** Integer ≥ 1 (Flutter `AppValidator.greaterThanOneInteger`). */
export function greaterThanOneInteger(value: string | null | undefined, fieldName?: string): string | null {
  const req = fieldRequired(value, fieldName);
  if (req) return req;
  const n = Number(value);
  if (!Number.isInteger(n)) return 'Please enter a valid number';
  if (n < 1) return 'Please enter a number greater than 1';
  return null;
}

/** Number ≥ 0 with up to 2 decimals (Flutter `AppValidator.positivePrice`). */
export function positivePrice(value: string | null | undefined, fieldName?: string): string | null {
  const req = fieldRequired(value, fieldName);
  if (req) return req;
  const v = value!.trim();
  if (!PRICE_RE.test(v)) return 'Please enter a valid number (up to 2 decimal places)';
  if (Number(v) < 0) return 'Please enter a positive number';
  return null;
}

/** Number ≥ 1 with up to 2 decimals (Flutter `AppValidator.priceGreaterThanOne`). */
export function priceGreaterThanOne(value: string | null | undefined, fieldName?: string): string | null {
  const req = fieldRequired(value, fieldName);
  if (req) return req;
  const v = value!.trim();
  if (!PRICE_RE.test(v)) return 'Please enter a valid number (up to 2 decimal places)';
  if (Number(v) < 1) return 'Please enter a number greater than or equal to 1';
  return null;
}

/** Number 0–100 (Flutter `AppValidator.positivePercentage`). */
export function positivePercentage(value: string | null | undefined, fieldName?: string): string | null {
  const req = fieldRequired(value, fieldName);
  if (req) return req;
  const n = Number(value);
  if (Number.isNaN(n)) return 'Please enter a valid number';
  if (n < 0) return 'Please enter a positive number';
  if (n > 100) return 'Please enter a number less than 100';
  return null;
}

/** Returns the first non-null error among the validators (Flutter `AppValidator.combine`). */
export function combine(value: string | null | undefined, validators: Array<(v: string | null | undefined) => string | null>): string | null {
  for (const validator of validators) {
    const result = validator(value);
    if (result != null) return result;
  }
  return null;
}
