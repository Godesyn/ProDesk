/**
 * The inspector's settings model — one flat, named view over the parts of a spec
 * the editor's right-hand panel controls (geometry, typography, mark colour).
 *
 * WHY A MODEL AND NOT JUST `spec.adjust`: three separate requirements all need the
 * same thing, a *named field with a before and an after*.
 *   • Undo. Inspector edits refine ONE mark in place, so there is no new
 *     generation row to step back to. Journalling `{field, from, to}` is what
 *     makes stepping back possible at all — and what finally gives the version
 *     history something to show for a slider drag.
 *   • The copilot. "Tighten the gap and use the serif" has to become a patch the
 *     server can apply and then *report*: the API answers with exactly what each
 *     field was and what it became, so the client can offer a real undo of the
 *     agent's work rather than a vague "changed some things".
 *   • Honest labels. One place decides that scale renders as "120%" and stroke
 *     weight as "as drawn", so the journal, the history strip, and the copilot's
 *     reply all say the same words.
 *
 * Everything here is pure — including the deterministic language parser at the
 * bottom. The model-backed interpreter lives next door in `inspector-command.ts`
 * so that importing the settings model does not drag in the AI provider registry
 * (which reads and validates env the moment it loads).
 */
import { randomBytes } from 'node:crypto';
import {
  DEFAULT_ADJUST,
  WORDMARK_WEIGHTS,
  primaryHexOf,
  resolveAdjust,
  weightLabel,
} from './layout.js';
import {
  TYPEFACES,
  TYPEFACE_KEYS,
  getTypeface,
  snapTypeface,
  type TypefaceKey,
} from './typefaces.js';
import type { LogoEdit, LogoSpec } from './types.js';

/** The full set of controls the inspector exposes, flattened out of the spec. */
export interface InspectorSettings {
  /** Mark size relative to the wordmark. 1 = as drawn. */
  scale: number;
  /** Global stroke weight in mark units, or null for "as drawn". */
  strokeWidth: number | null;
  /** Multiplier on the space between the mark and the wordmark. */
  gap: number;
  /** Keep-clear zone, in cap heights. */
  clearspace: number;
  /** Named mark elements hidden from the render AND the export. */
  hidden: string[];
  /** Which shipped typeface the wordmark is set in. */
  typeface: TypefaceKey;
  /** The weight the wordmark is cut at, or null for the face's own. */
  wordmarkWeight: number | null;
  /** The mark's primary colour. */
  color: string;
}

export type InspectorField = keyof InspectorSettings;

/** A single before/after, as journalled and as returned to the client. */
export interface InspectorChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
}

interface FieldSpec {
  label: string;
  /** Render a value for a human — the journal label and the copilot's reply. */
  format: (v: unknown) => string;
}

const FIELDS: Record<InspectorField, FieldSpec> = {
  scale: { label: 'Mark scale', format: (v) => `${Math.round(Number(v) * 100)}%` },
  strokeWidth: {
    label: 'Stroke weight',
    format: (v) => (v === null || v === undefined ? 'as drawn' : `${Number(v)}px`),
  },
  gap: { label: 'Mark ↔ wordmark gap', format: (v) => `${Math.round(Number(v) * 100)}%` },
  clearspace: { label: 'Clearspace', format: (v) => `${Number(v).toFixed(2).replace(/\.?0+$/, '')}×` },
  hidden: {
    label: 'Hidden elements',
    format: (v) => (Array.isArray(v) && v.length ? v.join(', ') : 'none'),
  },
  typeface: {
    label: 'Wordmark typeface',
    format: (v) => getTypeface(v as TypefaceKey).label,
  },
  wordmarkWeight: {
    label: 'Wordmark weight',
    format: (v) =>
      v === null || v === undefined ? 'as designed' : `${weightLabel(Number(v))} (${Number(v)})`,
  },
  color: { label: 'Mark colour', format: (v) => String(v).toUpperCase() },
};

export const INSPECTOR_FIELDS = FIELDS;

/** Clamp bounds, shared by the router's validation and the copilot's patches. */
export const LIMITS = {
  scale: [0.2, 2] as const,
  strokeWidth: [0.5, 24] as const,
  gap: [0, 2.5] as const,
  clearspace: [0.25, 3] as const,
  // The widest any shipped axis runs. The real per-face range is narrower and is
  // clamped again when the face is instanced (outline.ts), so a weight the binary
  // cannot cut lands on its nearest neighbour rather than failing the instruction.
  wordmarkWeight: [100, 1000] as const,
};

function clamp(n: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, n));
}

const HEX_RE = /^#[0-9a-f]{6}$/i;

/**
 * Phrases that ask for a different MARK rather than a different setting. Only
 * unambiguous ones: a redraw discards the artwork, so this must never fire on a
 * sentence that a slider could have answered.
 */
const REDRAW_INTENT =
  /\b(redraw|re-draw|start over|from scratch|instead of|try it as|turn it into|something else|different (mark|logo|icon|symbol|shape|idea|direction|concept)|another (idea|direction|concept|version))\b/;

/**
 * Weight names the deterministic parser recognises, longest first so "extra bold"
 * is not swallowed by "bold". A two-word name matches hyphenated too ("semi-bold").
 */
const WEIGHTS_BY_NAME = WORDMARK_WEIGHTS.map((weight) => ({
  weight,
  name: weightLabel(weight).toLowerCase(),
}))
  .sort((a, b) => b.name.length - a.name.length)
  .map(({ weight, name }) => ({ weight, re: new RegExp(`\\b${name.replace(/ /g, '[-\\s]?')}\\b`) }));

/* ── reading / writing the spec ──────────────────────────────────────────── */

/** Flatten a spec into the inspector's settings. */
export function readInspector(spec: LogoSpec): InspectorSettings {
  const adjust = resolveAdjust(spec.adjust);
  return {
    scale: adjust.scale,
    strokeWidth: adjust.strokeWidth,
    gap: adjust.gap,
    clearspace: adjust.clearspace,
    hidden: adjust.hidden,
    typeface: snapTypeface(spec.fonts?.heading),
    wordmarkWeight: adjust.wordmarkWeight,
    color: primaryHexOf(spec.palette),
  };
}

/**
 * Apply a partial settings patch back onto a spec. Unknown or out-of-range values
 * are clamped rather than rejected: the copilot is a language model, and a patch
 * that asks for 400% scale should land at the maximum the editor itself allows,
 * not fail the whole instruction.
 */
export function applyInspector(spec: LogoSpec, patch: Partial<InspectorSettings>): LogoSpec {
  const current = readInspector(spec);
  const next: InspectorSettings = { ...current };

  if (patch.scale !== undefined && Number.isFinite(Number(patch.scale)))
    next.scale = clamp(Number(patch.scale), LIMITS.scale);
  if (patch.strokeWidth !== undefined)
    next.strokeWidth =
      patch.strokeWidth === null || !Number.isFinite(Number(patch.strokeWidth))
        ? null
        : clamp(Number(patch.strokeWidth), LIMITS.strokeWidth);
  if (patch.gap !== undefined && Number.isFinite(Number(patch.gap)))
    next.gap = clamp(Number(patch.gap), LIMITS.gap);
  if (patch.clearspace !== undefined && Number.isFinite(Number(patch.clearspace)))
    next.clearspace = clamp(Number(patch.clearspace), LIMITS.clearspace);
  if (patch.hidden !== undefined && Array.isArray(patch.hidden))
    next.hidden = patch.hidden.filter((h): h is string => typeof h === 'string');
  if (patch.typeface !== undefined && patch.typeface in TYPEFACES) next.typeface = patch.typeface;
  if (patch.wordmarkWeight !== undefined)
    next.wordmarkWeight =
      patch.wordmarkWeight === null || !Number.isFinite(Number(patch.wordmarkWeight))
        ? null
        : clamp(Number(patch.wordmarkWeight), LIMITS.wordmarkWeight);
  if (patch.color !== undefined && HEX_RE.test(String(patch.color))) next.color = String(patch.color);

  const palette = [...(spec.palette ?? [])];
  if (next.color !== current.color) {
    const i = palette.findIndex((c) => c.role?.toLowerCase() === 'primary');
    if (i >= 0) palette[i] = { ...palette[i], hex: next.color };
    else if (palette.length) palette[0] = { ...palette[0], hex: next.color };
    else palette.push({ role: 'Primary', name: 'Primary', hex: next.color });
  }

  return {
    ...spec,
    palette,
    fonts: { ...spec.fonts, heading: getTypeface(next.typeface).cssFamily },
    adjust: {
      ...DEFAULT_ADJUST,
      scale: next.scale,
      strokeWidth: next.strokeWidth,
      gap: next.gap,
      clearspace: next.clearspace,
      hidden: next.hidden,
      wordmarkWeight: next.wordmarkWeight,
    },
  };
}

/* ── the before/after journal ────────────────────────────────────────────── */

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;

/** Every field that actually moved between two settings snapshots. */
export function diffInspector(
  before: InspectorSettings,
  after: InspectorSettings,
): InspectorChange[] {
  const out: InspectorChange[] = [];
  for (const key of Object.keys(FIELDS) as InspectorField[]) {
    if (sameValue(before[key], after[key])) continue;
    out.push({ field: key, label: FIELDS[key].label, from: before[key], to: after[key] });
  }
  return out;
}

/** "Mark scale 100% → 120%", or "3 changes" when several moved at once. */
export function describeChanges(changes: InspectorChange[]): string {
  if (!changes.length) return 'No change';
  const one = (c: InspectorChange) => {
    const spec = FIELDS[c.field as InspectorField];
    const fmt = spec ? spec.format : String;
    return `${c.label} ${fmt(c.from)} → ${fmt(c.to)}`;
  };
  if (changes.length === 1) return one(changes[0]);
  if (changes.length === 2) return `${one(changes[0])}; ${one(changes[1])}`;
  return `${one(changes[0])} and ${changes.length - 1} more`;
}

/** Human-readable before/after alongside the raw values, for the API + the UI. */
export interface FormattedChange extends InspectorChange {
  fromText: string;
  toText: string;
}

/**
 * Render each change's before/after. Returned by every mutation that touches the
 * inspector so the client — and the copilot's reply — can say "100% → 120%"
 * without re-implementing the formatting rules.
 */
export function formatChanges(changes: InspectorChange[]): FormattedChange[] {
  return changes.map((c) => {
    const fmt = FIELDS[c.field as InspectorField]?.format ?? String;
    return { ...c, fromText: fmt(c.from), toText: fmt(c.to) };
  });
}

/** Mint a journal entry for a set of changes. */
export function newEdit(
  changes: InspectorChange[],
  source: LogoEdit['source'],
  at: Date = new Date(),
): LogoEdit {
  return {
    id: randomBytes(8).toString('hex'),
    at: at.toISOString(),
    source,
    label: describeChanges(changes),
    changes,
  };
}

/** How long consecutive nudges of one control stay a single undo step. */
const COALESCE_MS = 30_000;

/**
 * Append an edit to the journal.
 *
 * Two behaviours worth knowing:
 *
 * • Anything currently undone is DROPPED first. Once you undo two steps and then
 *   make a fresh change, the branch you undid is gone — keeping it would let redo
 *   resurrect a value the user has since overwritten.
 *
 * • Repeated nudges of the SAME control inside `COALESCE_MS` merge into one
 *   entry. A slider is dragged in gestures, and each settle is its own save, so
 *   without this the history fills with "Mark scale 104% → 108%" noise and undo
 *   crawls back one hair at a time instead of undoing "the scale change".
 *   Merging keeps the original `from`, so one undo returns to where the user
 *   started. A merge that lands back on its own starting value is dropped
 *   outright — that is not an edit, it is a round trip.
 */
export function pushEdit(edits: LogoEdit[], edit: LogoEdit, coalesceMs = COALESCE_MS): LogoEdit[] {
  const kept = edits.filter((e) => !e.undone);
  const prev = kept[kept.length - 1];
  const single = edit.changes.length === 1 ? edit.changes[0] : null;
  const prevSingle = prev?.changes.length === 1 ? prev.changes[0] : null;

  const mergeable =
    prev &&
    single &&
    prevSingle &&
    prev.source === edit.source &&
    prevSingle.field === single.field &&
    Date.parse(edit.at) - Date.parse(prev.at) <= coalesceMs;

  if (!mergeable) return [...kept, edit];

  if (sameValue(prevSingle.from, single.to)) return kept.slice(0, -1);
  const merged: InspectorChange = { ...single, from: prevSingle.from };
  return [
    ...kept.slice(0, -1),
    { ...prev, at: edit.at, changes: [merged], label: describeChanges([merged]) },
  ];
}

/** The most recent still-applied edit — what undo steps back through. */
export function lastApplied(edits: LogoEdit[]): LogoEdit | null {
  for (let i = edits.length - 1; i >= 0; i--) if (!edits[i].undone) return edits[i];
  return null;
}

/** The oldest undone edit — what redo puts back. */
export function firstUndone(edits: LogoEdit[]): LogoEdit | null {
  return edits.find((e) => e.undone) ?? null;
}

/** Roll a spec back across one journalled edit (its `from` values). */
export function revertEdit(spec: LogoSpec, edit: LogoEdit): LogoSpec {
  return applyInspector(spec, patchFrom(edit, 'from'));
}

/** Re-apply a journalled edit (its `to` values). */
export function reapplyEdit(spec: LogoSpec, edit: LogoEdit): LogoSpec {
  return applyInspector(spec, patchFrom(edit, 'to'));
}

function patchFrom(edit: LogoEdit, side: 'from' | 'to'): Partial<InspectorSettings> {
  const patch: Record<string, unknown> = {};
  for (const c of edit.changes ?? []) {
    if (c.field in FIELDS) patch[c.field] = c[side];
  }
  return patch as Partial<InspectorSettings>;
}

/** Flip an edit's undone flag without disturbing the rest of the journal. */
export function markEdit(edits: LogoEdit[], id: string, undone: boolean): LogoEdit[] {
  return edits.map((e) => (e.id === id ? { ...e, undone } : e));
}

/* ── plain language → a patch ────────────────────────────────────────────── */

export interface InterpretResult {
  /** True when the instruction was an inspector change we can apply. */
  handled: boolean;
  patch: Partial<InspectorSettings>;
  /** A sentence for the copilot to say back. Empty when unhandled. */
  reply: string;
  /** True when the deterministic parser answered instead of the model. */
  fallback: boolean;
}

export const NOTHING_INTERPRETED: InterpretResult = {
  handled: false,
  patch: {},
  reply: '',
  fallback: false,
};

/** Drop anything a model invented, and keep hidden ids to real elements. */
export function sanitizeSettingsPatch(
  raw: Record<string, unknown>,
  elements: string[],
): Partial<InspectorSettings> {
  const out: Partial<InspectorSettings> = {};
  if (typeof raw.scale === 'number') out.scale = clamp(raw.scale, LIMITS.scale);
  if (raw.strokeWidth === null) out.strokeWidth = null;
  else if (typeof raw.strokeWidth === 'number')
    out.strokeWidth = clamp(raw.strokeWidth, LIMITS.strokeWidth);
  if (typeof raw.gap === 'number') out.gap = clamp(raw.gap, LIMITS.gap);
  if (typeof raw.clearspace === 'number') out.clearspace = clamp(raw.clearspace, LIMITS.clearspace);
  if (Array.isArray(raw.hidden)) {
    const allowed = new Set(elements.filter((e) => e.toLowerCase() !== 'mark'));
    out.hidden = raw.hidden.filter((h): h is string => typeof h === 'string' && allowed.has(h));
  }
  if (typeof raw.typeface === 'string' && raw.typeface in TYPEFACES)
    out.typeface = raw.typeface as TypefaceKey;
  if (raw.wordmarkWeight === null) out.wordmarkWeight = null;
  else if (typeof raw.wordmarkWeight === 'number')
    out.wordmarkWeight = clamp(raw.wordmarkWeight, LIMITS.wordmarkWeight);
  if (typeof raw.color === 'string' && HEX_RE.test(raw.color)) out.color = raw.color;
  return out;
}

/**
 * The deterministic parser: the studio's controls must still answer plain
 * language when AI is switched off (or the call fails), so the common verbs are
 * handled here rather than leaving the copilot mute.
 */
export function parseInstruction(
  instruction: string,
  current: InspectorSettings,
  elements: string[],
): InterpretResult {
  const s = instruction.toLowerCase();
  const patch: Partial<InspectorSettings> = {};
  const said: string[] = [];

  // The matching below is deliberately greedy — "thicker", "tighter" and "more"
  // each claim a control on their own — so a sentence that plainly asks for
  // DIFFERENT ARTWORK has to be kept out of its reach. Without this, "redraw it
  // with a thicker, hand-drawn feel" quietly becomes a stroke-weight nudge and
  // the mark the user asked to replace is still on screen. Bare "instead" is
  // deliberately absent: "use the serif instead" is a setting.
  if (REDRAW_INTENT.test(s)) return NOTHING_INTERPRETED;

  /** "a bit" ≈ 10%, "much"/"a lot" ≈ 30%, otherwise 15%. */
  const amount = /\b(a bit|slightly|a little|touch)\b/.test(s)
    ? 0.1
    : /\b(much|a lot|way|far|significantly)\b/.test(s)
      ? 0.3
      : 0.15;

  const up = /\b(bigger|larger|increase|grow|more|raise|up)\b/.test(s);
  const down = /\b(smaller|reduce|decrease|shrink|less|lower|down|tighter|closer|tighten)\b/.test(s);

  if (/\b(scale|mark size|symbol size|icon size)\b/.test(s) || /\bmark\b.*\b(bigger|smaller)\b/.test(s)) {
    if (up) patch.scale = clamp(current.scale * (1 + amount), LIMITS.scale);
    else if (down) patch.scale = clamp(current.scale * (1 - amount), LIMITS.scale);
  }

  if (/\b(gap|spacing|space between|apart|kerning between)\b/.test(s) || /\b(tighter|closer|tighten)\b/.test(s)) {
    const step = amount * 2; // the gap is a multiplier, so move it in bigger steps
    if (down) patch.gap = clamp(current.gap - step, LIMITS.gap);
    else if (up) patch.gap = clamp(current.gap + step, LIMITS.gap);
  }

  /*
    "Bolder" means two entirely different things depending on what it is aimed at:
    a heavier STROKE on the symbol, or a heavier CUT of the type. The sentence
    naming the type is what separates them — "make it bolder" is still the mark
    (the symbol is what the studio is mostly about), but "bolder wordmark" is not.
  */
  const aboutType = /\b(wordmark|word mark|type|typeface|text|lettering|letters|name)\b/.test(s);
  const heavier = /\b(bolder|heavier|thicker|bold)\b/.test(s);
  const lighter = /\b(thinner|lighter|light)\b/.test(s);

  // A weight named outright wins over the direction words — "set it in semibold"
  // is an absolute, not a nudge. Longest name first, so "extra bold" is not
  // swallowed by "bold".
  const namedWeight = WEIGHTS_BY_NAME.find(({ re }) => re.test(s))?.weight;
  if (aboutType && namedWeight) patch.wordmarkWeight = namedWeight;
  else if (aboutType && (heavier || lighter || /\bweight\b/.test(s))) {
    const base = current.wordmarkWeight ?? getTypeface(current.typeface).wordmarkWeight;
    const step = /\b(much|a lot|way|far|significantly)\b/.test(s) ? 200 : 100;
    if (heavier || up) patch.wordmarkWeight = clamp(base + step, LIMITS.wordmarkWeight);
    else if (lighter || down) patch.wordmarkWeight = clamp(base - step, LIMITS.wordmarkWeight);
  }

  if (!aboutType && /\b(bolder|heavier|thicker|weight|stroke|thinner|lighter)\b/.test(s)) {
    const base = current.strokeWidth ?? 6;
    if (/\b(bolder|heavier|thicker)\b/.test(s) || up)
      patch.strokeWidth = clamp(base + Math.max(1, base * amount), LIMITS.strokeWidth);
    else if (/\b(thinner|lighter)\b/.test(s) || down)
      patch.strokeWidth = clamp(base - Math.max(1, base * amount), LIMITS.strokeWidth);
  }

  if (/\b(clearspace|clear space|breathing|padding|margin)\b/.test(s)) {
    if (up) patch.clearspace = clamp(current.clearspace + 0.25, LIMITS.clearspace);
    else if (down) patch.clearspace = clamp(current.clearspace - 0.25, LIMITS.clearspace);
  }

  // A face named outright wins over the genre words — "set it in Fraunces" is a
  // more specific instruction than "make it a serif", and `snapTypeface` already
  // knows every shipped family by name. Longest label first, so "Inter Tight"
  // isn't swallowed by "Inter".
  const named = TYPEFACE_KEYS.slice()
    .sort((a, b) => TYPEFACES[b].label.length - TYPEFACES[a].label.length)
    .find((k) => s.includes(TYPEFACES[k].label.toLowerCase()));
  if (named) patch.typeface = named;
  else if (/\bserif\b/.test(s) && !/\bsans[-\s]?serif\b/.test(s)) patch.typeface = 'instrument-serif';
  else if (/\b(mono|monospace|technical type)\b/.test(s)) patch.typeface = 'jetbrains-mono';
  else if (/\b(sans|sans[-\s]?serif|geometric type)\b/.test(s)) patch.typeface = 'inter-tight';

  const hex = instruction.match(/#[0-9a-f]{6}\b/i);
  if (hex) patch.color = hex[0];

  // "hide the dot" / "show the dot", against the mark's real element ids.
  const hideable = elements.filter((e) => e.toLowerCase() !== 'mark');
  for (const id of hideable) {
    const named = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s);
    if (!named) continue;
    if (/\bhide|remove|drop|without\b/.test(s) && !current.hidden.includes(id)) {
      patch.hidden = [...(patch.hidden ?? current.hidden), id];
    } else if (/\bshow|restore|bring back|add back\b/.test(s) && current.hidden.includes(id)) {
      patch.hidden = (patch.hidden ?? current.hidden).filter((h) => h !== id);
    }
  }

  for (const key of Object.keys(patch) as InspectorField[]) {
    said.push(`${FIELDS[key].label.toLowerCase()} to ${FIELDS[key].format(patch[key])}`);
  }
  if (!said.length) return NOTHING_INTERPRETED;
  return {
    handled: true,
    patch,
    reply: `Set ${said.join(' and ')}.`,
    fallback: true,
  };
}
