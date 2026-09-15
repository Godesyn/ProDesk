/**
 * Shared types for the Logo Studio module. The persisted shapes (LogoBrief,
 * LogoSpec, LogoColor, LogoProject, LogoGeneration) live on the schema so the DB
 * and the module agree; this file re-exports them and adds the runtime-only
 * view/provider types.
 */
import type {
  LogoBrief,
  LogoColor,
  LogoEdit,
  LogoSpec,
  LogoProject,
  LogoGeneration,
} from '../../db/schema.js';

export type { LogoBrief, LogoColor, LogoEdit, LogoSpec, LogoProject, LogoGeneration };

/** The mark families the engine can produce. `surprise` lets the model choose. */
export type MarkKind =
  | 'monogram'
  | 'geometric'
  | 'combination'
  | 'wordmark'
  | 'surprise';

/**
 * The lockups + components every mark is presented in. Defined in layout.ts (the
 * pure composer the browser also runs) and re-exported here so the module's other
 * consumers keep one import site for its types.
 */
export type { LockupSlot } from './layout.js';

/**
 * A concept as the client consumes it — the DB row flattened with its parsed
 * spec always present (never null) so pages don't null-check every field.
 */
export interface ConceptView {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  kind: string;
  note: string;
  svg: string;
  spec: LogoSpec;
  uniqueness: number | null;
  thumbUrl: string | null;
  saved: boolean;
  provider: string;
  createdAt: string;
  /** Journalled inspector changes on this mark — drives history and undo/redo. */
  edits: LogoEdit[];
}

/**
 * What a provider adapter returns for one concept: the editable SVG for the MARK
 * (square, `currentColor`-based) plus the structured spec. Lockups and rasters
 * are derived downstream from these two, so an adapter only has to nail the mark.
 */
export interface GeneratedConcept {
  name: string;
  kind: MarkKind;
  note: string;
  /** The mark SVG — square viewBox, primary ink via `currentColor`. */
  svg: string;
  spec: LogoSpec;
}

/**
 * The iteration engine's refusal: the instruction was not about the artwork at
 * all, it was one of the controls the inspector already owns (size, weight,
 * spacing, typeface, colour, hiding an element). Drawing it would replace the
 * user's mark with a near-identical copy AND land the change twice, since the
 * inspector applies its own value on top. So the engine says so instead, and
 * the caller routes the instruction back to the settings path.
 */
export interface IterateDeclined {
  declined: true;
  /** Which control it really was — a sentence the studio can say back. */
  reason: string;
}

/** Either a refined mark or a refusal. Narrow with `'declined' in result`. */
export type IterateOutcome = GeneratedConcept | IterateDeclined;

/**
 * The pluggable generation-provider boundary. `claude` implements it today; a
 * vector-gen API (e.g. Recraft V4) can be dropped in later with zero call-site
 * changes. Every method is brief-driven and returns editable SVG + spec.
 */
export interface LogoProvider {
  readonly name: string;
  /** Brief → N distinct concepts. */
  generateConcepts(args: {
    brief: LogoBrief;
    count: number;
    /** Concepts already shown, so a "generate six more" call stays distinct. */
    avoid?: string[];
    /**
     * The project's committed style, once a direction has been chosen. Keeps later
     * rounds inside the same visual family (see prompts.StyleLockHint).
     */
    styleLock?: { descriptors: string[]; palette?: LogoColor[] } | null;
  }): Promise<GeneratedConcept[]>;
  /**
   * An existing mark + a plain-language instruction → a refined mark, or a
   * refusal when the instruction was an inspector setting rather than artwork.
   */
  iterate(args: {
    brief: LogoBrief;
    current: GeneratedConcept;
    instruction: string;
  }): Promise<IterateOutcome>;
}
