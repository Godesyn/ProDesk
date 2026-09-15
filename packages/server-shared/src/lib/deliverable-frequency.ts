/**
 * DeliverableFrequency — 1:1 port of Flutter
 * `lib/src/shared/models/deliverable_frequency.dart`.
 *
 * Dependency-free; imported as a VALUE by both server and client. The legacy
 * web enum (oneTime/weekly/fortnightly/monthly/quarterly) is migrated to these
 * values by migration 0007.
 */
export const DELIVERABLE_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;

export type DeliverableFrequency = (typeof DELIVERABLE_FREQUENCIES)[number];

/** Display names — verbatim from Flutter `DeliverableFrequency.displayName`. */
export const DELIVERABLE_FREQUENCY_DISPLAY_NAME: Record<DeliverableFrequency, string> = {
  daily: 'Days',
  weekly: 'Weeks',
  monthly: 'Months',
  yearly: 'Years',
};

/** Days in one unit of the frequency — used to advance a project's next cycle. */
export function frequencyDays(f: DeliverableFrequency): number {
  switch (f) {
    case 'daily':
      return 1;
    case 'weekly':
      return 7;
    case 'monthly':
      return 30;
    case 'yearly':
      return 365;
  }
}
