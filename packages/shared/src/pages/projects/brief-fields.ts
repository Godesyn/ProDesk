import type { SpotQuestion } from '../brand/spot-view';

/**
 * Shared helpers for rendering a service's custom-field "brief" questions with
 * the Info Hub field renderer (`SpotComponentView`/`SpotInput`/`SpotAnswer`).
 *
 * The questions are configured during service creation using the service-form
 * `CustomFieldType` enum (camelCase). The Info Hub renderer keys off the SPOT
 * question type (snake_case), so the brief flows (post-checkout stepper +
 * client-brief project stage) map between the two through here, giving brands
 * the correct input — selects, dates, file/audio/image uploads, colour
 * palettes, addresses, … — instead of a plain text box for every question.
 */

/** service-form `CustomFieldType` (camelCase) → SPOT question type (snake_case). */
export const SERVICE_FIELD_TYPE_TO_SPOT: Record<string, string> = {
  text: 'text',
  number: 'number',
  date: 'date',
  singleSelect: 'single_select',
  multiSelect: 'multi_select',
  address: 'address',
  url: 'url',
  price: 'price',
  email: 'email',
  fileUpload: 'file_upload',
  carousel: 'carousel',
  coverPhotoVideo: 'cover_photo',
  colorPalette: 'color_palette',
  audioUpload: 'audio_upload',
  phone: 'phone',
};

/**
 * Convert a service custom-field definition into the SpotQuestion the Info Hub
 * renderer consumes. Already-snake_case (or unknown) types fall through and
 * render as plain text, matching SpotInput's default branch.
 */
export function toSpotQuestion(def: any, index: number): SpotQuestion {
  const rawType = String(def?.type ?? 'text');
  return {
    id: String(def?.id ?? index),
    text: def?.label ?? def?.title ?? def?.text ?? `Question ${index + 1}`,
    type: SERVICE_FIELD_TYPE_TO_SPOT[rawType] ?? rawType,
    // Service custom-field options are { id, label }; SPOT uses bare strings.
    options: (def?.options ?? []).map((o: any) => (typeof o === 'string' ? o : o?.label ?? o?.value ?? '')),
    isRequired: Boolean(def?.required ?? def?.isRequired),
  };
}

/** The custom-field definition for a stored entry (raw def or `{ question }` envelope). */
export function briefFieldDef(entry: any): any {
  return entry?.question ?? entry;
}

/**
 * Read a stored answer's value, tolerating the current `{ value }` envelope, the
 * legacy `{ textValue }` envelope written by older brief submissions, and a bare
 * value. Returns `undefined` for entries that have no answer yet.
 */
export function readBriefAnswer(entry: any): unknown {
  const a = entry?.answer;
  if (a && typeof a === 'object' && !Array.isArray(a)) {
    if ('value' in a) return (a as { value: unknown }).value;
    if ('textValue' in a) return (a as { textValue: unknown }).textValue;
  }
  return a;
}
