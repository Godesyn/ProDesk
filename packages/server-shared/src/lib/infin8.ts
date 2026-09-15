/**
 * Shape of one Infin8 stage in the taxonomy (an ordered stage + its substages).
 *
 * The taxonomy itself is dynamic and admin-editable: it lives in
 * `globalSettings.infin8Stages` (the single source of truth) and is seeded once
 * by `scripts/initialize.ts`. There is deliberately NO canonical constant here —
 * runtime code must read the taxonomy from the DB, not a hardcoded fallback, so
 * the two can never drift. The seed data lives only in the init script.
 */
export interface Infin8Stage {
  stage: string;
  substages: string[];
}
