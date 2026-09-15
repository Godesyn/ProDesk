import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation } from 'wouter';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Frame,
  History,
  Layers,
  Loader2,
  Maximize2,
  Redo2,
  RotateCcw,
  Send,
  Shapes,
  SlidersHorizontal,
  Sparkles,
  Type,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { ColorPicker } from '@shared/components/ui/color-picker';
import { useTRPC } from '@shared/lib/trpc';
import type { RouterOutputs } from '@server/trpc/router';
import {
  ALL_SLOTS,
  COMPONENT_SLOTS,
  DEFAULT_ADJUST,
  LOCKUP_SLOTS,
  SLOT_LABELS,
  effectiveWeight,
  layoutLockup,
  lockupFrame,
  toneColor,
  weightLabel,
  type LockupLayout,
  type LockupSlot,
  type MarkAdjust,
  type PaletteEntry,
} from '@server/modules/logo/layout';
import type { InspectorSettings } from '@server/modules/logo/inspector';
import { Eyebrow } from '../components/primitives';
import { SvgMark } from '../components/SvgMark';
import { useStudio } from '../app/studio-context';

/**
 * The editor.
 *
 * Two decisions shape this file:
 *
 * 1. THE CANVAS COMPOSES LOCALLY. `layoutLockup` is the very same function the
 *    server runs (modules/logo/layout.ts is dependency-free for exactly this
 *    reason), so every inspector control repaints on the next frame and still
 *    shows byte-for-byte what the export will produce. The server is still the
 *    source of truth — edits are persisted on a debounce — but the picture never
 *    waits for the round trip.
 *
 * 2. COLOUR IS A LOCKUP, NOT A SWITCH. There is no colourway strip: `Coloured`
 *    and `Coloured reversed` are their own lockups beside `Primary`, `Stacked`,
 *    `Monochrome` and `Reversed`, and each carries its own colour contract. The
 *    mark and the wordmark on their own are components, not lockups, so they sit
 *    in their own group.
 */

type EditorPayload = RouterOutputs['logo']['studio']['get'];
type TypefaceKey = InspectorSettings['typeface'];

/** What each lockup is FOR — the colour contract, said plainly. */
const SLOT_NOTES: Record<LockupSlot, string> = {
  primary: 'Ink · horizontal',
  stacked: 'Ink · stacked',
  mono: 'Single ink',
  reversed: 'White on ink',
  color: 'Brand colour',
  colorReversed: 'Out of the colour',
  mark: 'Symbol · 1:1',
  wordmark: 'Type only',
};

const COPILOT_SUGGESTIONS = [
  'Tighten the gap a little',
  'Make the mark bolder',
  'Set the wordmark in Fraunces',
  'Try it as a monogram',
];

/**
 * How the typeface picker is grouped. Derived from the server's `category`, so a
 * face added to the registry lands in the right group without a change here.
 */
const TYPE_GROUPS: { category: string; label: string }[] = [
  { category: 'sans', label: 'Sans' },
  { category: 'serif', label: 'Serif' },
  { category: 'mono', label: 'Mono' },
];

/** Used only until the first payload lands, so the panel never renders empty. */
const FALLBACK_SETTINGS: InspectorSettings = {
  ...DEFAULT_ADJUST,
  typeface: 'inter-tight',
  color: '#2E9E58',
};

/**
 * The inspector's three scopes.
 *
 * The controls were one long column, and the reason it was hard to work in is
 * that it interleaved three unrelated questions. Every control belongs to exactly
 * one of these, and the split is what lets each pane fit on screen whole and lets
 * "reset" mean one precise thing rather than "throw away everything".
 *
 * `fields` is the scope's own share of the adjustment — what its Reset puts back,
 * and what decides whether that Reset has anything to do. Typeface and colour are
 * deliberately absent: they are CHOICES about the identity, not adjustments to the
 * artwork, and there is no "as-drawn" value to return them to.
 */
type Scope = 'lockup' | 'mark' | 'wordmark';

const SCOPE_ORDER: Scope[] = ['lockup', 'mark', 'wordmark'];

const SCOPES: Record<
  Scope,
  {
    label: string;
    icon: typeof Frame;
    note: string;
    resetTitle: string;
    fields: (keyof MarkAdjust)[];
  }
> = {
  lockup: {
    label: 'Lockup',
    icon: Frame,
    note: 'Colour, and how the parts sit together.',
    resetTitle: 'Reset the gap and clearspace to as-designed',
    fields: ['gap', 'clearspace'],
  },
  mark: {
    label: 'Mark',
    icon: Shapes,
    note: 'The symbol itself.',
    resetTitle: 'Reset the mark scale, stroke weight, and hidden elements',
    fields: ['scale', 'strokeWidth', 'hidden'],
  },
  wordmark: {
    label: 'Wordmark',
    icon: Type,
    note: 'How the name is set.',
    resetTitle: "Reset the weight to the typeface's own",
    fields: ['wordmarkWeight'],
  },
};

/** Compare two setting values, `hidden`'s array included. */
function sameSetting(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => v === b[i])
    : a === b;
}

/** Strip a mutation result back to the shape `studio.get` caches. */
function payloadOf(res: EditorPayload): EditorPayload {
  return {
    concept: res.concept,
    lockups: res.lockups,
    wordmark: res.wordmark,
    settings: res.settings,
    outlines: res.outlines,
    typefaces: res.typefaces,
    edits: res.edits,
  };
}

export function Studio() {
  const [, navigate] = useLocation();
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { selectedId, setSelectedId, overview } = useStudio();

  const genId = selectedId ?? overview.data?.chosen?.id ?? null;

  const [slot, setSlot] = useState<LockupSlot>('primary');
  const [zoom, setZoom] = useState(100);
  const [prompt, setPrompt] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** Which of the inspector's three scopes is showing. */
  const [scope, setScope] = useState<Scope>('lockup');
  /** Mobile: which panel is showing as a bottom sheet. */
  const [sheet, setSheet] = useState<null | 'lockups' | 'inspector' | 'history'>(null);

  /*
    `keepPreviousData` is what lets the canvas stay painted while a different
    mark loads — a redraw switches `genId` to a brand-new row, and without it the
    stage would blank out and re-fit on every copilot turn. The old artwork holds
    until the new one is in hand, then swaps in one frame.
  */
  const studioQuery = useQuery(
    trpc.logo.studio.get.queryOptions(
      { generationId: genId! },
      { enabled: !!genId, placeholderData: keepPreviousData },
    ),
  );
  const historyQuery = useQuery(
    trpc.logo.studio.history.queryOptions(
      { generationId: genId! },
      { enabled: !!genId, placeholderData: keepPreviousData },
    ),
  );
  const update = useMutation(trpc.logo.studio.update.mutationOptions());
  const command = useMutation(trpc.logo.studio.command.mutationOptions());
  const undoEdit = useMutation(trpc.logo.studio.undo.mutationOptions());
  const redoEdit = useMutation(trpc.logo.studio.redo.mutationOptions());

  const data = studioQuery.data;
  const concept = data?.concept;
  const edits = useMemo(() => data?.edits ?? [], [data?.edits]);

  /* ── settings: local while dragging, debounced to the server ───────────── */
  const [draft, setDraft] = useState<InspectorSettings | null>(null);
  const settings = draft ?? data?.settings ?? FALLBACK_SETTINGS;
  const timer = useRef<number | null>(null);
  /** Mirrors `draft` so an in-flight save can tell whether it is still current. */
  const draftRef = useRef<InspectorSettings | null>(null);
  const putDraft = useCallback((next: InspectorSettings | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  // Adopt the server's values whenever we switch marks.
  useEffect(() => {
    draftRef.current = null;
    setDraft(null);
  }, [genId]);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  /**
   * Fold a fresh payload straight into the cache. Every mutation returns the
   * whole editor state, so writing it here — rather than invalidating and
   * refetching — means the draft can be cleared without the canvas flashing back
   * through the pre-edit values on its way to the new ones.
   *
   * `sent` guards the other half of that: a save that lands AFTER the user has
   * already moved the slider on must not clear the newer draft, or the canvas
   * snaps back to the value being saved and only catches up on the next commit.
   */
  const applyPayload = useCallback(
    (res: EditorPayload, sent?: InspectorSettings) => {
      if (!genId) return;
      qc.setQueryData(trpc.logo.studio.get.queryKey({ generationId: genId }), payloadOf(res));
      if (!sent || draftRef.current === sent) putDraft(null);
      void qc.invalidateQueries({
        queryKey: trpc.logo.studio.history.queryKey({ generationId: genId }),
      });
      void qc.invalidateQueries({ queryKey: trpc.logo.overview.queryKey() });
    },
    [genId, qc, trpc, putDraft],
  );

  const commit = useCallback(
    (next: InspectorSettings) => {
      if (!genId) return;
      update.mutate(
        { generationId: genId, settings: next },
        {
          onSuccess: (res) => applyPayload(res, next),
          onError: (e) => {
            putDraft(null);
            toast.error(e.message);
          },
        },
      );
    },
    [genId, update, applyPayload, putDraft],
  );

  /**
   * True while the canvas is holding the PREVIOUS mark's payload because a new
   * one is still loading. The picture is honest, but the settings under it
   * belong to the old mark — so the inspector is read-only for that one round
   * trip rather than writing them onto the mark that is arriving.
   */
  const stale = studioQuery.isPlaceholderData;

  /** Edit a setting: reflect instantly, persist once the user settles. */
  const setSettings = useCallback(
    (patch: Partial<InspectorSettings>, immediate = false) => {
      if (stale) return;
      const next = { ...settings, ...patch };
      putDraft(next);
      if (timer.current) window.clearTimeout(timer.current);
      if (immediate) commit(next);
      else timer.current = window.setTimeout(() => commit(next), 400);
    },
    [settings, commit, putDraft, stale],
  );

  /* ── composition: the same maths the server and the exports run ────────── */
  const adjust = useMemo<MarkAdjust>(
    () => ({
      scale: settings.scale,
      strokeWidth: settings.strokeWidth,
      gap: settings.gap,
      clearspace: settings.clearspace,
      hidden: settings.hidden,
      wordmarkWeight: settings.wordmarkWeight,
    }),
    [settings],
  );

  /* ── the wordmark's face and cut ───────────────────────────────────────── */
  const typefaces = useMemo(() => data?.typefaces ?? [], [data?.typefaces]);
  const face = useMemo(
    () => typefaces.find((t) => t.key === settings.typeface) ?? null,
    [typefaces, settings.typeface],
  );
  /**
   * The cut actually in force. `effectiveWeight` is the SAME rule the server keys
   * its outline matrix by, so the lookup below is a hit rather than a miss that
   * falls back to a different weight for one round trip.
   */
  const weight = face ? effectiveWeight(face.weights, face.defaultWeight, settings.wordmarkWeight) : null;

  /** The palette with the live colour folded in, so the picker previews too. */
  const palette = useMemo<PaletteEntry[]>(() => {
    const base = concept?.spec.palette ?? [];
    if (!base.length) return [{ role: 'Primary', name: 'Primary', hex: settings.color }];
    const i = base.findIndex((c) => c.role?.toLowerCase() === 'primary');
    const target = i >= 0 ? i : 0;
    return base.map((c, j) => (j === target ? { ...c, hex: settings.color } : c));
  }, [concept?.spec.palette, settings.color]);

  const composed = useMemo(() => {
    const mark = concept?.svg;
    if (!mark) return null;
    /*
      The server ships a MATRIX of measured wordmarks — every shipped face at the
      cut it would be used in, plus every weight of the current one (see
      `wordmarkOutlines` in routers/logo.ts) — so typeface AND weight both repaint
      locally. `weight` is derived by the same `effectiveWeight` the server keyed
      the matrix with, so the first lookup hits; the default-weight fallback is a
      belt-and-braces for a payload measured before this rule existed.
    */
    const outlines = data?.outlines ?? {};
    const outline =
      (weight === null ? null : outlines[`${settings.typeface}:${weight}`]) ??
      (face ? outlines[`${settings.typeface}:${face.defaultWeight}`] : null) ??
      null;
    const out = {} as Record<LockupSlot, LockupLayout>;
    for (const s of ALL_SLOTS) out[s] = layoutLockup({ mark, outline, slot: s, adjust, palette });
    return out;
  }, [concept?.svg, data?.outlines, settings.typeface, weight, face, adjust, palette]);

  const active = composed?.[slot] ?? null;
  const frame = active ? lockupFrame(active, adjust) : null;

  /* ── the stage: fit the frame, then scale it by the zoom ───────────────── */
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const stageObserver = useRef<ResizeObserver | null>(null);

  /**
   * A CALLBACK ref, deliberately — not a `useRef` plus a mount effect.
   *
   * The editor renders an empty state while it works out which mark to open, so
   * the stage element is genuinely absent on the first render of a cold load: a
   * hard refresh, or a return after React Query has aged the overview out of its
   * cache, both start with no selection and no `chosen` yet. A mount-time effect
   * therefore looked at the ref, found null, and — with an empty dependency
   * array — never looked again. The stage mounted a moment later with nothing
   * observing it, its measurement stayed 0×0, and since `unitPx` is 0 until the
   * stage has a size, the canvas rendered NOTHING until the page happened to
   * reload in a luckier order. The same trap sprang on any later remount of the
   * stage, e.g. switching brands, which blanks the selection on the way through.
   *
   * A callback ref runs when the node itself attaches or detaches, so there is
   * no ordering left to get wrong.
   */
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    stageObserver.current?.disconnect();
    stageObserver.current = null;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      // Last resort. `contentRect` below is the CONTENT box, so the padding has
      // to come off here too or the fit would be a stage-padding too generous.
      const pad = window.getComputedStyle(el);
      const x = parseFloat(pad.paddingLeft) + parseFloat(pad.paddingRight);
      const y = parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom);
      setStage({ w: Math.max(0, el.clientWidth - x), h: Math.max(0, el.clientHeight - y) });
      return;
    }
    // No eager measurement on this path: ResizeObserver delivers an initial
    // observation as soon as it is given an element, so one arrives regardless.
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setStage({ w: r.width, h: r.height });
    });
    ro.observe(el);
    stageObserver.current = ro;
  }, []);

  useEffect(() => () => stageObserver.current?.disconnect(), []);

  /**
   * Pixels per lockup unit. The frame is the artwork PLUS its clearspace, and it
   * carries the lockup's real aspect ratio — square for a mark, wide for a
   * horizontal lockup, tall for a stacked one. Fitting that (rather than forcing
   * everything into a square) is what stops the guide cutting across the artwork,
   * and because the lockup's own box grows with the mark's scale, a scaled-up
   * mark can no longer spill past its boundary. Multiplying by the zoom makes the
   * boundary track the zoom too.
   */
  const unitPx =
    frame && stage.w > 0 && stage.h > 0
      ? Math.min(stage.w / frame.width, stage.h / frame.height)
      : 0;
  const px = unitPx * (zoom / 100);
  const boxW = frame ? frame.width * px : 0;
  const boxH = frame ? frame.height * px : 0;
  /** Clearspace as a share of each axis — the artwork's inset inside the frame. */
  const padX = frame && frame.width ? (frame.pad / frame.width) * 100 : 0;
  const padY = frame && frame.height ? (frame.pad / frame.height) * 100 : 0;
  const artW = frame ? Math.round((frame.width - frame.pad * 2) * px) : 0;
  const artH = frame ? Math.round((frame.height - frame.pad * 2) * px) : 0;

  /* ── history: version lineage + this mark's own inspector journal ──────── */
  const lineage = useMemo(() => historyQuery.data?.lineage ?? [], [historyQuery.data?.lineage]);
  const children = historyQuery.data?.children ?? [];
  const parent = lineage.length > 1 ? lineage[lineage.length - 2] : null;
  const version = lineage.length;

  /**
   * The path a backward version move leaves behind, so redo can retrace it.
   *
   * The version half of undo/redo walks the lineage TREE — undo to the parent,
   * redo to a child — and a tree walk has no memory of where you actually came
   * from. Step back three versions and redo could only guess forward: it took
   * `children[0]`, the NEWEST child, which on a branched history is a different
   * mark than the one you left. Jump straight to a version from the list and it
   * was worse — nothing recorded the jump at all, so on a leaf there were no
   * children to walk and redo simply went dead.
   *
   * Snapshotting the ancestry you are leaving fixes both: it is the exact route
   * back to where you stood, branch choices included.
   */
  const [forwardPath, setForwardPath] = useState<string[]>([]);

  /**
   * Move to another version, remembering the route back.
   *
   * A move to somewhere on our OWN ancestry (stepping back, or jumping to an
   * earlier version in the list) leaves a path worth retracing. A jump sideways
   * to another branch does not — there is no forward from there that leads here —
   * so the trail is dropped and the plain child walk takes over.
   */
  const goToVersion = useCallback(
    (id: string) => {
      if (!id || id === genId) return;
      const trail = lineage.map((v) => v.id);
      setForwardPath(trail.includes(id) ? trail : []);
      setSelectedId(id);
    },
    [genId, lineage, setSelectedId],
  );

  /** The next version along a remembered trail, when we are standing on it. */
  const forwardVersion = useMemo(() => {
    if (!genId) return null;
    const i = forwardPath.indexOf(genId);
    return i >= 0 && i + 1 < forwardPath.length ? forwardPath[i + 1] : null;
  }, [forwardPath, genId]);

  const undoableEdit = useMemo(() => {
    for (let i = edits.length - 1; i >= 0; i--) if (!edits[i].undone) return edits[i];
    return null;
  }, [edits]);
  const redoableEdit = useMemo(() => edits.find((e) => e.undone) ?? null, [edits]);

  /**
   * One undo button, two kinds of history. Inspector changes are steps within the
   * current mark, so they unwind first; only once the journal is exhausted does
   * undo mean "go back to the version this one was refined from".
   */
  const canUndo = Boolean(undoableEdit || parent);
  const canRedo = Boolean(redoableEdit || forwardVersion || children.length);

  const runUndo = useCallback(() => {
    if (!genId) return;
    if (undoableEdit) {
      undoEdit.mutate(
        { generationId: genId },
        {
          onSuccess: (res) => {
            applyPayload(res);
            if (res.undone) toast.message(`Undone — ${res.undone.label}`);
          },
          onError: (e) => toast.error(e.message),
        },
      );
    } else if (parent) goToVersion(parent.id);
  }, [genId, undoableEdit, undoEdit, applyPayload, parent, goToVersion]);

  const runRedo = useCallback(() => {
    if (!genId) return;
    if (redoableEdit) {
      redoEdit.mutate(
        { generationId: genId },
        {
          onSuccess: (res) => {
            applyPayload(res);
            if (res.redone) toast.message(`Redone — ${res.redone.label}`);
          },
          onError: (e) => toast.error(e.message),
        },
      );
      return;
    }
    // The remembered route wins over the child walk: it is where the user
    // actually was, rather than whichever branch happens to be newest.
    const next = forwardVersion ?? children[0]?.id ?? null;
    if (next) setSelectedId(next);
  }, [genId, redoableEdit, redoEdit, applyPayload, forwardVersion, children, setSelectedId]);

  /**
   * The copilot. One input drives both halves of the studio: the server decides
   * whether the instruction adjusts the inspector or redraws the mark, and an
   * inspector change comes back with every field's before AND after — which is
   * what lets the confirmation offer a real undo rather than a vague apology.
   */
  const runCommand = (instruction: string) => {
    if (!genId || !instruction.trim() || command.isPending) return;
    command.mutate(
      { generationId: genId, instruction: instruction.trim() },
      {
        onSuccess: (res) => {
          setPrompt('');
          if (res.kind === 'iterate') {
            // A fresh version is a new branch tip — whatever route we were
            // retracing is no longer the way forward from here.
            setForwardPath([]);
            setSelectedId(res.concept.id);
            if (res.fallback) toast.message('Refined with the built-in engine (AI is off here).');
            if (concept) {
              void qc.invalidateQueries({
                queryKey: trpc.logo.concepts.list.queryKey({ projectId: concept.projectId }),
              });
            }
            return;
          }
          if (res.kind === 'noop') {
            toast.message(res.reply);
            return;
          }
          applyPayload(res);
          toast.success(res.reply, {
            description: res.changes.map((c) => `${c.label}: ${c.fromText} → ${c.toText}`).join(' · '),
            action: { label: 'Undo', onClick: () => runUndo() },
          });
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  if (!genId) {
    return (
      <div className="grid place-items-center px-6 py-24 text-center lg:h-[calc(100vh-3.5rem)] lg:py-0">
        <div>
          <p className="text-lg font-semibold text-[var(--ink)]">Nothing to edit yet.</p>
          <p className="mt-1 text-sm text-[var(--ink-2)]">Pick a concept to refine.</p>
          <button
            onClick={() => navigate('/concepts')}
            className="mt-5 rounded-[var(--radius-pill)] px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: 'var(--pigment)' }}
          >
            See concepts
          </button>
        </div>
      </div>
    );
  }

  /*
    The veil is for the FIRST load only — when there is genuinely nothing to
    look at yet. It deliberately does not cover the copilot: most instructions
    now come back as a settings change that repaints in place, and greying out
    the artwork you are asking about (then handing it back apparently unchanged)
    reads as breakage. The dock says it is working instead.
  */
  /*
    A composed lockup with no stage measurement yet is the one frame between the
    element attaching and its first ResizeObserver callback. Showing the spinner
    through it beats showing an empty stage: an empty stage is exactly what the
    unobserved-canvas bug looked like, and "nothing is here" should never be the
    quiet answer when there IS artwork in hand.
  */
  const busy = studioQuery.isLoading || (!!active && boxW <= 0);

  /* ── panels (shared between the desktop columns and the mobile sheets) ─── */
  const slotTile = (s: LockupSlot) => {
    // Each lockup declares its own ground, so the swatch behind the thumbnail is
    // read from the same contract that paints the artwork — never guessed.
    const ground = toneColor(s, palette).ground;
    return (
      <button
        key={s}
        onClick={() => {
          setSlot(s);
          setSheet(null);
        }}
        className="group rounded-[var(--radius-md)] border p-2 text-left transition"
        style={{
          borderColor: slot === s ? 'var(--pigment)' : 'var(--hair-2)',
          background: slot === s ? 'var(--pigment-soft)' : 'var(--stage)',
        }}
      >
        <div
          className="mb-1.5 grid h-10 place-items-center overflow-hidden rounded bg-[var(--card)]"
          style={ground ? { background: ground } : undefined}
        >
          {composed?.[s] ? (
            <SvgMark svg={composed[s].svg} className="h-8 w-full px-1" />
          ) : (
            <div className="h-4 w-4 rounded bg-[var(--hair-2)]" />
          )}
        </div>
        <p className="truncate text-[11px] font-semibold text-[var(--ink)]">{SLOT_LABELS[s]}</p>
        <p className="spec truncate" style={{ fontSize: 9 }}>
          {SLOT_NOTES[s]}
        </p>
      </button>
    );
  };

  const lockupsPanel = (
    <>
      <div className="border-b border-[var(--hair)] p-5">
        <Eyebrow>Lockups</Eyebrow>
        <p className="spec mt-1" style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}>
          Each one is a finished presentation, colour included.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">{LOCKUP_SLOTS.map(slotTile)}</div>
      </div>
      <div className="p-5">
        <Eyebrow>Components</Eyebrow>
        <p className="spec mt-1" style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}>
          The identity’s parts, used on their own.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">{COMPONENT_SLOTS.map(slotTile)}</div>
      </div>
    </>
  );

  /** Whether a scope still sits exactly as the mark was drawn. */
  const scopeAsDrawn = (s: Scope) =>
    SCOPES[s].fields.every((f) => sameSetting(settings[f], DEFAULT_ADJUST[f]));

  /** Put one scope's fields back to as-drawn, leaving the other two alone. */
  const resetScope = (s: Scope) => {
    const patch: Partial<InspectorSettings> = {};
    for (const f of SCOPES[s].fields) Object.assign(patch, { [f]: DEFAULT_ADJUST[f] });
    setSettings(patch, true);
  };

  const inspectorPanel = (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        THREE SCOPES, NOT ONE LIST. The controls answer three different questions —
        how the lockup sits, how the symbol is drawn, how the name is set — and
        stacking all of them made a column you had to scroll to find anything in.
        Split this way each pane fits on screen whole, and "reset" can finally mean
        something precise instead of throwing away every adjustment at once.
      */}
      <div className="border-b border-[var(--hair)] p-3">
        <div
          role="tablist"
          aria-label="Inspector sections"
          className="grid grid-cols-3 gap-1 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--stage)] p-1"
        >
          {SCOPE_ORDER.map((key) => {
            const { label, icon: Icon } = SCOPES[key];
            const on = scope === key;
            return (
              <button
                key={key}
                role="tab"
                aria-selected={on}
                onClick={() => setScope(key)}
                className="press flex items-center justify-center gap-1.5 rounded-[var(--radius-pill)] py-1.5 text-[11px] font-semibold transition"
                style={{
                  background: on ? 'var(--card)' : 'transparent',
                  color: on ? 'var(--ink)' : 'var(--ink-3)',
                  boxShadow: on ? '0 1px 2px rgba(14,14,12,0.08)' : undefined,
                }}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* The tab already names the scope, so this row only says what it is FOR. */}
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-3.5">
        <p
          className="spec min-w-0"
          style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}
        >
          {SCOPES[scope].note}
        </p>
        <button
          onClick={() => resetScope(scope)}
          disabled={scopeAsDrawn(scope)}
          title={SCOPES[scope].resetTitle}
          className="press inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink-2)] transition enabled:hover:border-[var(--pigment)] enabled:hover:text-[var(--pigment)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" /> Reset
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-6">
        {scope === 'lockup' && (
          <>
            <section>
              <p className="mb-2 text-xs font-semibold text-[var(--ink)]">Colour</p>
              <p
                className="spec mb-3"
                style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}
              >
                Drives the Coloured lockups. The mark still works in ink first.
              </p>
              {/* The swatch IS the control — pressing the colour opens the picker. */}
              <button
                onClick={() => setPaletteOpen((v) => !v)}
                aria-expanded={paletteOpen}
                aria-label="Primary mark colour"
                className="press flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border border-[var(--hair-2)] bg-[var(--stage)] p-2 transition hover:border-[var(--pigment)]"
              >
                <span
                  className="swatch h-9 w-9 shrink-0 rounded-[var(--radius-md)]"
                  style={{ background: settings.color }}
                />
                <span className="spec flex-1 text-left">{settings.color.toUpperCase()}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-[var(--ink-3)] transition-transform ${
                    paletteOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {paletteOpen && (
                <div className="mt-3">
                  <ColorPicker
                    value={settings.color}
                    onChange={(hex) => setSettings({ color: hex })}
                    ariaLabel="Primary mark colour"
                  />
                </div>
              )}
            </section>

            <SliderRow
              label="Wordmark gap"
              value={Math.round(settings.gap * 100)}
              unit="%"
              min={0}
              max={200}
              step={5}
              onChange={(v) => setSettings({ gap: v / 100 })}
              hint="Space between the mark and the wordmark · 100% = as designed"
            />
            <SliderRow
              label="Clearspace"
              value={Number(settings.clearspace.toFixed(2))}
              unit="×"
              min={0.25}
              max={3}
              step={0.05}
              onChange={(v) => setSettings({ clearspace: v })}
              hint="The dashed keep-clear zone — enforced in the guidelines + PDF"
            />
          </>
        )}

        {scope === 'mark' && (
          <>
            <SliderRow
              label="Mark scale"
              value={Math.round(settings.scale * 100)}
              unit="%"
              min={40}
              max={160}
              onChange={(v) => setSettings({ scale: v / 100 })}
              hint="The mark's size relative to the wordmark"
            />
            <SliderRow
              label="Stroke weight"
              value={settings.strokeWidth ?? 0}
              unit={settings.strokeWidth === null ? '' : 'px'}
              min={0}
              max={16}
              step={0.5}
              onChange={(v) => setSettings({ strokeWidth: v === 0 ? null : v })}
              hint="0 = as drawn"
            />

            {/*
              Elements can be hidden by the copilot ("drop the dot"), and until now
              nothing in the panel admitted it had happened — let alone offered a
              way back. They belong here: hiding a part is an edit to the symbol.
            */}
            {settings.hidden.length > 0 && (
              <section>
                <p className="mb-2 text-xs font-semibold text-[var(--ink)]">Hidden elements</p>
                <div className="flex flex-wrap gap-1.5">
                  {settings.hidden.map((id) => (
                    <button
                      key={id}
                      onClick={() =>
                        setSettings({ hidden: settings.hidden.filter((h) => h !== id) }, true)
                      }
                      title={`Show ${id}`}
                      className="press inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--stage)] px-2.5 py-1 text-[11px] font-medium text-[var(--ink-2)] transition hover:border-[var(--pigment)] hover:text-[var(--pigment)]"
                    >
                      {id}
                      <X className="h-3 w-3" />
                    </button>
                  ))}
                </div>
                <p
                  className="spec mt-1.5"
                  style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}
                >
                  Dropped from the render and the export. Press one to bring it back.
                </p>
              </section>
            )}
          </>
        )}

        {scope === 'wordmark' && (
          <>
            <section>
              <p className="mb-2 text-xs font-semibold text-[var(--ink)]">Typeface</p>
              {/*
                Grouped by genre rather than listed flat. Choosing a wordmark face is a
                two-step decision — sans or serif first, then which one — and a bare
                grid of eleven specimens makes you re-read the whole set to find the
                serifs. Groups render only when the server actually ships that genre.
              */}
              <div className="space-y-2.5">
                {TYPE_GROUPS.map(({ category, label }) => {
                  const faces = typefaces.filter((t) => t.category === category);
                  if (!faces.length) return null;
                  return (
                    <div key={category}>
                      <span className="spec mb-1.5 block" style={{ fontSize: 8 }}>
                        {label}
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {faces.map((t) => (
                          <button
                            key={t.key}
                            /*
                              Committed immediately, not on the usual debounce: a new
                              face needs its own weight ladder measured, and that only
                              arrives with the mutation's payload.
                            */
                            onClick={() => setSettings({ typeface: t.key as TypefaceKey }, true)}
                            aria-pressed={settings.typeface === t.key}
                            title={t.label}
                            className="press rounded-[var(--radius-md)] border px-2 py-2 text-center transition"
                            style={{
                              borderColor:
                                settings.typeface === t.key ? 'var(--pigment)' : 'var(--hair-2)',
                              background:
                                settings.typeface === t.key
                                  ? 'var(--pigment-soft)'
                                  : 'var(--stage)',
                            }}
                          >
                            <span
                              className="block truncate text-sm leading-tight text-[var(--ink)]"
                              style={{ fontFamily: t.cssFamily }}
                            >
                              Ag
                            </span>
                            <span className="spec mt-1 block truncate" style={{ fontSize: 8 }}>
                              {t.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--ink)]">Weight</span>
                <span className="spec tnum truncate">
                  {weight === null
                    ? '—'
                    : `${weightLabel(weight)} · ${
                        settings.wordmarkWeight === null ? 'as designed' : weight
                      }`}
                </span>
              </div>
              {/*
                Only the cuts this binary can actually make. The ladders genuinely
                differ — Space Grotesk stops at 700, Instrument Serif ships Regular
                and nothing else — and offering a weight the font cannot instance
                would silently hand back a different one on export.
              */}
              {face && face.weights.length > 1 ? (
                <div className="flex gap-1">
                  {face.weights.map((w) => (
                    <button
                      key={w}
                      onClick={() => setSettings({ wordmarkWeight: w }, true)}
                      aria-pressed={weight === w}
                      title={weightLabel(w)}
                      className="press tnum min-w-0 flex-1 rounded-[var(--radius-md)] border py-1.5 text-[10px] font-semibold transition"
                      style={{
                        borderColor: weight === w ? 'var(--pigment)' : 'var(--hair-2)',
                        background: weight === w ? 'var(--pigment-soft)' : 'var(--stage)',
                        color: weight === w ? 'var(--pigment)' : 'var(--ink-2)',
                      }}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="spec" style={{ fontSize: 10, textTransform: 'none', letterSpacing: 0 }}>
                  {face
                    ? `${face.label} ships one cut — ${weightLabel(face.defaultWeight)}.`
                    : 'Loading the face…'}
                </p>
              )}
              <p
                className="spec mt-1.5"
                style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}
              >
                Set as outlines on export — the download matches this exactly.
              </p>
            </section>
          </>
        )}
      </div>

      {/* Panel footer — true of every scope, so it never scrolls out of reach. */}
      <div className="space-y-3 border-t border-[var(--hair)] p-5">
        {update.isPending && (
          <p className="spec flex items-center gap-2" style={{ fontSize: 9 }}>
            <Loader2 className="h-3 w-3 animate-spin" /> Saving…
          </p>
        )}
        <button
          onClick={() => navigate('/brand')}
          className="flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--hair-2)] py-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--stage-2)]"
        >
          Build the brand system <ArrowUpRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  const historyPanel = (
    <div className="p-5">
      <Eyebrow>Version history</Eyebrow>
      <p className="spec mt-1" style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}>
        Every refinement is kept — step back any time.
      </p>
      <ul className="mt-3 space-y-1.5">
        {lineage.map((v, i) => (
          <li key={v.id}>
            <button
              onClick={() => {
                goToVersion(v.id);
                setSheet(null);
              }}
              data-active={v.id === genId}
              className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border px-2.5 py-2 text-left transition data-[active=true]:bg-[var(--pigment-soft)]"
              style={{ borderColor: v.id === genId ? 'var(--pigment)' : 'var(--hair-2)' }}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-[var(--stage)]">
                <SvgMark svg={v.svg} className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--ink)]">{v.name}</span>
                <span className="spec block truncate" style={{ fontSize: 9 }}>
                  v{i + 1} · {v.note || 'original'}
                </span>
              </span>
              {v.id === genId && (
                <Check className="h-4 w-4 shrink-0" style={{ color: 'var(--pigment)' }} />
              )}
            </button>
          </li>
        ))}
        {!lineage.length && <li className="py-3 text-sm text-[var(--ink-3)]">No history yet.</li>}
      </ul>

      {/*
        Inspector changes refine THIS mark rather than minting a new version, so
        they belong here as steps inside it — otherwise a morning of adjustments
        leaves the history looking untouched.
      */}
      {edits.length > 0 && (
        <div className="mt-5 border-t border-[var(--hair)] pt-4">
          <Eyebrow>Changes to this version</Eyebrow>
          <ul className="mt-2.5 space-y-1.5">
            {[...edits].reverse().map((e) => (
              <li
                key={e.id}
                className="rounded-[var(--radius-md)] border border-[var(--hair-2)] px-2.5 py-1.5"
                style={{ opacity: e.undone ? 0.45 : 1 }}
              >
                <p
                  className="truncate text-[12px] font-medium text-[var(--ink)]"
                  style={{ textDecoration: e.undone ? 'line-through' : undefined }}
                  title={e.label}
                >
                  {e.label}
                </p>
                <p className="spec truncate" style={{ fontSize: 9 }}>
                  {e.source === 'agent' ? 'Studio' : 'You'} · {shortTime(e.at)}
                  {e.undone ? ' · undone' : ''}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="flex flex-col lg:grid lg:h-[calc(100vh-3.5rem)] lg:grid-cols-[260px_minmax(0,1fr)_320px] lg:overflow-hidden">
        {/* LEFT — lockups & components (desktop only; a sheet on mobile) */}
        <div className="hidden flex-col overflow-y-auto border-r border-[var(--hair)] bg-[var(--card)] lg:flex">
          {lockupsPanel}
          <div className="border-t border-[var(--hair)]">{historyPanel}</div>
        </div>

        {/* CENTRE — the canvas */}
        <div className="relative flex min-w-0 flex-col bg-[var(--stage)]">
          <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="spec min-w-0 truncate text-[var(--ink-3)]">
              {SLOT_LABELS[slot]} · {concept?.name ?? ''}
            </span>
            <div className="flex shrink-0 items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--card)] p-1">
              <button
                onClick={runUndo}
                disabled={!canUndo || undoEdit.isPending}
                className="press grid h-7 w-7 place-items-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--stage-2)] disabled:opacity-30"
                aria-label="Undo"
                title={undoableEdit ? `Undo — ${undoableEdit.label}` : 'Previous version'}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                onClick={runRedo}
                disabled={!canRedo || redoEdit.isPending}
                className="press grid h-7 w-7 place-items-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--stage-2)] disabled:opacity-30"
                aria-label="Redo"
                title={redoableEdit ? `Redo — ${redoableEdit.label}` : 'Newer version'}
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <span className="mx-1 h-4 w-px bg-[var(--hair-2)]" />
              <button
                onClick={() => setZoom((z) => Math.max(25, z - 25))}
                className="press grid h-7 w-7 place-items-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
                aria-label="Zoom out"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="spec tnum hidden px-1 sm:inline" style={{ fontSize: 10 }}>
                {zoom}%
              </span>
              <button
                onClick={() => setZoom((z) => Math.min(400, z + 25))}
                className="press grid h-7 w-7 place-items-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
                aria-label="Zoom in"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                onClick={() => setZoom(100)}
                className="press grid h-7 w-7 place-items-center rounded-full text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
                aria-label="Fit to view"
                title="Fit to view"
              >
                <Maximize2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/*
            The scroll container is measured, not the content: at zoom > 100% the
            frame overflows and you pan to it. Measuring the content instead would
            feed its own growth back into the fit and never settle.
          */}
          <div
            ref={stageRef}
            className="stage-grid relative min-h-[40vh] flex-1 overflow-auto p-6 sm:p-8"
          >
            <div className="grid min-h-full min-w-full place-items-center">
              {boxW > 0 && active && (
                <div className="relative shrink-0" style={{ width: boxW, height: boxH }}>
                  {/* The keep-clear boundary: the lockup's own box plus its clearspace. */}
                  <div
                    className="pointer-events-none absolute inset-0 rounded-[2px] border border-dashed border-[var(--hair-2)]"
                    aria-hidden
                  />
                  <div
                    className="absolute"
                    style={{
                      left: `${padX}%`,
                      right: `${padX}%`,
                      top: `${padY}%`,
                      bottom: `${padY}%`,
                    }}
                  >
                    <SvgMark svg={active.svg} className="h-full w-full" title={concept?.name} />
                  </div>
                </div>
              )}
            </div>

            {busy && (
              <div
                className="absolute inset-0 grid place-items-center"
                style={{ background: 'color-mix(in srgb, var(--stage) 72%, transparent)' }}
              >
                <Loader2 className="h-8 w-8 animate-spin text-[var(--ink-3)]" />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:px-6">
            <span className="spec tnum text-[var(--ink-3)]">
              {artW > 0 ? `${artW} × ${artH} px` : '—'}
            </span>
            <span className="spec text-[var(--ink-3)]">
              Clearspace {settings.clearspace.toFixed(2).replace(/\.?0+$/, '')}× cap height
            </span>
          </div>

          {/* copilot dock — one input for both the inspector and the artwork */}
          <div className="border-t border-[var(--hair)] bg-[var(--card)] px-4 py-4 sm:px-6">
            <div className="mb-2.5 flex flex-wrap gap-2">
              {COPILOT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => runCommand(s)}
                  disabled={command.isPending}
                  className="press rounded-[var(--radius-pill)] border border-[var(--hair-2)] px-3 py-1.5 text-xs font-medium text-[var(--ink-2)] transition hover:border-[var(--pigment)] hover:text-[var(--pigment)] disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runCommand(prompt);
              }}
              className="flex items-center gap-2 rounded-[var(--radius-pill)] border border-[var(--hair-2)] bg-[var(--stage)] py-1.5 pl-3 pr-1.5 focus-within:border-[var(--pigment)] sm:pl-4"
            >
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--pigment)]" />
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Adjust a setting, or ask for a different mark…"
                className="h-9 min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-3)]"
                aria-label="Describe a change"
              />
              <button
                type="submit"
                disabled={command.isPending || !prompt.trim()}
                className="press grid h-9 w-9 shrink-0 place-items-center rounded-full text-white disabled:opacity-50"
                style={{ background: 'var(--pigment)' }}
                aria-label="Send"
              >
                {command.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </form>
            {command.isPending && (
              <p className="spec mt-2 flex items-center gap-2" style={{ fontSize: 9 }}>
                <Loader2 className="h-3 w-3 animate-spin" /> Working on it — the mark stays live.
              </p>
            )}
          </div>

          {/* Room for the mobile panel bar so the dock is never covered. */}
          <div className="h-16 lg:hidden" aria-hidden />
        </div>

        {/*
          RIGHT — inspector (desktop only; a sheet on mobile).

          The column itself does NOT scroll: the panel owns its own scrolling so
          the scope tabs stay at the top and "Build the brand system" stays at the
          bottom, both reachable without hunting for them.
        */}
        <div className="hidden min-h-0 flex-col overflow-hidden border-l border-[var(--hair)] bg-[var(--card)] lg:flex">
          {inspectorPanel}
        </div>
      </div>

      {/* MOBILE — panel bar + bottom sheets */}
      <div
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch border-t border-[var(--hair-2)] bg-[var(--card)] lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <SheetTab icon={Layers} label="Lockups" onClick={() => setSheet('lockups')} />
        <SheetTab icon={SlidersHorizontal} label="Inspector" onClick={() => setSheet('inspector')} />
        <SheetTab
          icon={History}
          label={version ? `v${version}` : 'History'}
          onClick={() => setSheet('history')}
        />
      </div>

      <BottomSheet
        open={sheet !== null}
        title={
          sheet === 'lockups'
            ? 'Lockups & components'
            : sheet === 'inspector'
              ? 'Inspector'
              : 'Version history'
        }
        scroll={sheet !== 'inspector'}
        onClose={() => setSheet(null)}
      >
        {sheet === 'lockups' && lockupsPanel}
        {sheet === 'inspector' && inspectorPanel}
        {sheet === 'history' && historyPanel}
      </BottomSheet>
    </>
  );
}

const shortTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

function SheetTab({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Layers;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="press flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[var(--ink-2)] transition hover:bg-[var(--stage-2)]"
    >
      <Icon className="h-[18px] w-[18px]" />
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}

/** A mobile bottom sheet — the editor's panels without stealing the canvas. */
function BottomSheet({
  open,
  title,
  onClose,
  /**
   * False when the panel scrolls its own body. The inspector does, so that its
   * scope tabs and its footer action stay put while the controls move under them.
   */
  scroll = true,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  scroll?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label={title}>
      <button
        className="absolute inset-0 cursor-default bg-[rgba(14,14,12,0.45)]"
        onClick={onClose}
        aria-label="Close panel"
        tabIndex={-1}
      />
      <div className="pop absolute inset-x-0 bottom-0 flex max-h-[80vh] flex-col rounded-t-[var(--radius-lg)] border-t border-[var(--hair-2)] bg-[var(--card)]">
        <div className="flex items-center justify-between border-b border-[var(--hair)] px-5 py-3">
          <span className="text-sm font-semibold text-[var(--ink)]">{title}</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-full text-[var(--ink-3)] transition hover:bg-[var(--stage-2)] hover:text-[var(--ink)]"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className={`flex min-h-0 flex-1 flex-col ${scroll ? 'overflow-y-auto' : 'overflow-hidden'}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  unit,
  min,
  max,
  step = 1,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold text-[var(--ink)]">{label}</span>
        <span className="spec tnum">{value === 0 && !unit ? 'as drawn' : `${value}${unit}`}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="logo-range w-full"
        aria-label={label}
      />
      {hint && (
        <p className="spec mt-1" style={{ fontSize: 9, textTransform: 'none', letterSpacing: 0 }}>
          {hint}
        </p>
      )}
    </section>
  );
}
