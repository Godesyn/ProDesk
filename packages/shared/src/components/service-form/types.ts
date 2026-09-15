/**
 * Shared data shapes for the service-form components. These mirror the Flutter
 * models (service_variant.dart, custom_field.dart, service_staff.dart,
 * service_project_config) and the server `upsertInput` jsonb collections.
 *
 * Used by the New/Edit Service dialog and (later) the Custom-Item and
 * New-Project dialogs.
 */

/** A configurable option that generates variants (ports `ServiceOption`). */
export interface ServiceOption {
  /** Stable id for the row; not persisted by Flutter but harmless. */
  id: string;
  name: string;
  choices: string[];
}

/** A generated variant combination (ports `ServiceVariant`). */
export interface ServiceVariant {
  id: string;
  options: Record<string, string>;
  oneOffUpfrontDifference: number;
  recurringUpfrontDifference: number;
  recurringWeeklyDifference: number;
}

/** An optional add-on (ports `ServiceAddon`). */
export interface ServiceAddon {
  id: string;
  name: string;
  oneOffUpfrontDifference: number;
  recurringUpfrontDifference: number;
  recurringWeeklyDifference: number;
}

/** Custom field option (ports `CustomFieldOption`). */
export interface CustomFieldOption {
  id: string;
  label: string;
}

/** A custom requirement field (ports `CustomField`). */
export interface CustomField {
  id: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options?: CustomFieldOption[];
  placeholder?: string;
}

/** Assigned sales staff for "Book Meeting" services (ports `ServiceStaff`). */
export interface ServiceStaff {
  userId: string;
  name?: string;
  profileUrl?: string | null;
  /** Availability config (ports `service_staff.dart`): ISO weekday numbers 1–7. */
  workingDays?: number[];
  /** "HH:mm" 24h start of the working window. */
  startTime?: string;
  /** "HH:mm" 24h end of the working window. */
  endTime?: string;
  timezone?: string;
}

/** Upfront/recurring project config (ports `ServiceProjectConfig`). */
export interface ServiceProjectConfig {
  taskName?: string;
  projectDurationDays?: number;
  estimatedContractorDurationInHours?: number;
  contractorDefaultBudget?: number;
  contractorDefaultBudgetInPercentage?: number;
  minimumTermBeforeCancellation?: number;
}

/** The 15 Flutter `CustomFieldType` values (verbatim). */
export const CUSTOM_FIELD_TYPES = [
  'text',
  'number',
  'date',
  'singleSelect',
  'multiSelect',
  'address',
  'url',
  'price',
  'email',
  'fileUpload',
  'carousel',
  'coverPhotoVideo',
  'colorPalette',
  'audioUpload',
  'phone',
] as const;

export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** Display names — verbatim from Flutter `CustomFieldTypeX.displayName`. */
export const CUSTOM_FIELD_TYPE_DISPLAY_NAME: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  singleSelect: 'Single Select',
  multiSelect: 'Multi Select',
  address: 'Address',
  url: 'URL',
  price: 'Price',
  email: 'Email',
  fileUpload: 'File Upload',
  carousel: 'Carousel (Multiple Files)',
  coverPhotoVideo: 'Cover Photo/Video',
  colorPalette: 'Color Palette',
  audioUpload: 'Audio Upload',
  phone: 'Phone Number',
};

export const rid = () => Math.random().toString(36).slice(2, 10);

/**
 * Cartesian product of all option choices into variants, preserving the pricing
 * of any matching existing variant (ports `generateServiceVariants`).
 */
export function generateServiceVariants(options: ServiceOption[], existing: ServiceVariant[]): ServiceVariant[] {
  if (options.length === 0) return [];

  function permute(index: number): Record<string, string>[] {
    if (index === options.length - 1) {
      return options[index].choices.map((c) => ({ [options[index].name]: c }));
    }
    const next = permute(index + 1);
    const result: Record<string, string>[] = [];
    for (const choice of options[index].choices) {
      for (const np of next) result.push({ [options[index].name]: choice, ...np });
    }
    return result;
  }

  const combos = permute(0);
  return combos.map((combo) => {
    const match = existing.find((v) => {
      const keys = Object.keys(combo);
      if (Object.keys(v.options).length !== keys.length) return false;
      return keys.every((k) => v.options[k] === combo[k]);
    });
    return (
      match ?? {
        id: rid(),
        options: combo,
        oneOffUpfrontDifference: 0,
        recurringUpfrontDifference: 0,
        recurringWeeklyDifference: 0,
      }
    );
  });
}
