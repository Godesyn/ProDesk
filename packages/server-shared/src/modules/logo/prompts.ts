/**
 * System + user prompts for the Claude SVG generation adapter. The system prompt
 * encodes identity-design doctrine so the model produces marks that could pass a
 * designer's smell test, not clip-art. The user prompt renders the brief.
 */
import { INSPECTOR_FIELDS } from './inspector.js';
import type { LogoBrief } from './types.js';

/**
 * The controls the studio's inspector owns, read straight off the field registry
 * so the two prompts cannot drift: whatever the inspector can set is exactly
 * what the iteration engine must refuse to draw.
 */
const INSPECTOR_CONTROLS = Object.values(INSPECTOR_FIELDS)
  .map((f) => f.label.toLowerCase())
  .join(', ');

const AXIS = [
  ['Classic', 'Modern'],
  ['Serious', 'Playful'],
  ['Minimal', 'Expressive'],
  ['Geometric', 'Organic'],
] as const;

/** Turn the four 0–4 dials into plain-language descriptors. */
export function personalityWords(brief: LogoBrief): string[] {
  const p = brief.personality;
  const vals = [p.classicModern, p.seriousPlayful, p.minimalExpressive, p.geometricOrganic];
  return vals.map((v, i) => {
    const [left, right] = AXIS[i];
    if (v <= 1) return left.toLowerCase();
    if (v >= 3) return right.toLowerCase();
    return `balanced ${left.toLowerCase()}/${right.toLowerCase()}`;
  });
}

/** A one-line human summary of the brief (also stored as the generation prompt). */
export function briefSentence(brief: LogoBrief): string {
  const kind = brief.markType === 'surprise' ? 'a distinctive' : `a ${brief.markType}`;
  const words = personalityWords(brief).join(', ');
  const evoke = brief.keywords.length ? `, evoking ${brief.keywords.join(', ')}` : '';
  const mono = brief.monochromeFirst ? ' — designed in monochrome first' : '';
  return `${kind} mark for ${brief.businessName} (${words})${evoke}${mono}`;
}

export const CONCEPT_SYSTEM = `You are the generative engine inside a professional identity-design studio. You produce ORIGINAL vector logo marks as clean, hand-crafted SVG — never recombined stock icons, never generic.

DESIGN DOCTRINE (obey strictly):
- Great marks are born in black & white. Get the FORM right first; a mark must read with no colour.
- One focal idea per mark. Simple, memorable, reducible to a 16px favicon and scalable to a billboard.
- Balanced negative space and optical weight. Avoid busy detail, gradients, photographic effect, or fine text inside the mark.
- Draw with deliberate geometry: consistent stroke weight, aligned nodes, coherent radii/angles.

STRICT SVG OUTPUT CONTRACT (every mark):
- A SINGLE square root: <svg viewBox="0 0 100 100"> ... </svg>. No width/height attributes.
- Put ALL artwork inside one group: <g id="mark"> ... </g>.
- The mark's primary ink MUST use fill="currentColor" and/or stroke="currentColor" — NOT a hard-coded colour. This lets the studio recolour, reverse, and commit colour with one change. You MAY use at most ONE secondary palette HEX for a genuine accent, sparingly.
- Use only: path, circle, rect, polygon, polyline, ellipse, line, g. NO text, image, script, style, filter, gradient, use, or external references.
- Prefer stroke-based construction (stroke-width 5–8 on the 100 grid) where it suits the form, so the mark can animate as if drawn — but solid fills are welcome for counters and geometric masses.
- The mark is the SYMBOL only; the wordmark (the business name as type) is added by the studio separately. For a pure wordmark brief, still provide a small distinctive lettermark/monogram in the mark group.
- Give each separable part its own <g id="..."> with a plain-language id (stem, leaf, counter, dot), so the studio can offer it as something to hide.
- ANNOTATE THE DRAWING. Put an XML comment above each element or group naming what it represents — <!-- ridge: the ascending stroke --> — so the next person or model to open this mark can read it. Keep each to a short phrase; no markup inside a comment. The studio strips them from every exported file, so they cost the brand nothing.

THE STROKE WEIGHT IS ONE LIVE SLIDER for the whole mark, and the user moves it after you finish:
- Use ONE stroke-width across the mark. A part carrying its own heavier or lighter width holds that difference only until the slider moves, then snaps to everything else.
- Never put a stroke-width inside a style="..." — declare it as an attribute, or the studio's control cannot replace it.
- A dot, period, or terminal that belongs to the line work must be a zero-length round-capped stroke — <path d="M50 80 h0" stroke="currentColor" stroke-linecap="round" fill="none"/> — so its diameter IS the stroke weight and it thickens with the rest. A filled <circle> does not follow the slider: it stays put while the lines around it grow, which reads as a mistake. Use a filled shape only for a mass meant to hold still, like a counter or a solid block.

Return ONLY valid JSON, no prose, matching exactly:
{"concepts":[{"name":"<1–2 word concept name>","kind":"monogram|geometric|combination|wordmark","note":"<≤8-word description>","geometry":"<one sentence on construction>","rationale":"<one sentence: why it fits the brief>","svg":"<the mark SVG per the contract>","palette":[{"role":"Primary","name":"<colour name>","hex":"#RRGGBB"},{"role":"Accent","name":"...","hex":"#RRGGBB"},{"role":"Ink","name":"Graphite","hex":"#0E0E0C"},{"role":"Background","name":"Paper","hex":"#FFFFFF"},{"role":"Rule","name":"...","hex":"#RRGGBB"}],"fonts":{"heading":"<CSS font-family>","body":"<CSS font-family>"}}]}

Every concept must be visually DISTINCT from the others (different construction idea, not a recolour). Palettes should be tasteful and accessible; if the brief says monochrome-first, still propose a considered colour the mark could commit to later.`;

/** A committed direction's locked style, biasing later rounds toward it. */
export interface StyleLockHint {
  descriptors: string[];
  palette?: { role: string; name: string; hex: string }[];
}

export function conceptUserPrompt(
  brief: LogoBrief,
  count: number,
  avoid: string[] = [],
  styleLock?: StyleLockHint | null,
): string {
  const locked = styleLock?.descriptors?.filter(Boolean) ?? [];
  const lines = [
    `Business name: ${brief.businessName}`,
    brief.tagline ? `Tagline: ${brief.tagline}` : '',
    brief.industry ? `Industry: ${brief.industry}` : '',
    `Personality: ${personalityWords(brief).join(', ')}`,
    brief.keywords.length ? `Should evoke: ${brief.keywords.join(', ')}` : '',
    `Preferred mark type: ${brief.markType}`,
    brief.colorLeaning ? `Colour leaning: ${brief.colorLeaning}` : '',
    brief.initials ? `Monogram initials: ${brief.initials}` : '',
    brief.monochromeFirst ? 'Design in black & white first (form over colour).' : '',
    brief.notes ? `Extra notes: ${brief.notes}` : '',
    avoid.length ? `Do NOT repeat these already-shown directions: ${avoid.join('; ')}.` : '',
    // A direction has been committed: stay in that visual family so "generate
    // more" explores WITHIN the chosen look instead of starting over.
    locked.length
      ? `The brand has already committed to this visual direction: ${locked.join('; ')}. ` +
        'Stay in the same family — same construction logic and optical weight — while still ' +
        'making each concept a genuinely different idea.'
      : '',
    styleLock?.palette?.length
      ? `Keep to the committed palette: ${styleLock.palette.map((c) => `${c.role} ${c.hex}`).join(', ')}.`
      : '',
    '',
    `Produce ${count} distinct concepts as JSON per the contract.`,
  ];
  return lines.filter(Boolean).join('\n');
}

export const ITERATE_SYSTEM = `You are the iteration engine inside a professional identity-design studio. You are given ONE existing logo mark (SVG) and a plain-language instruction. You DRAW: you return a refined version of that same mark, evolving it rather than starting over, keeping the identity recognisable.

YOU DRAW, YOU DO NOT CONFIGURE. The studio wraps your mark in a live inspector that applies these on top of your artwork — instantly, non-destructively, and undoably: ${INSPECTOR_CONTROLS}. None of them are yours. Baking one into the SVG is wrong twice over: it replaces the mark the user chose with a near-identical copy they cannot undo, and the inspector then applies its own value on top of the one you drew, so the change lands twice.

The wordmark is not yours either — the studio sets the business name in type beside your mark. Anything about the type, the lettering, the face, its weight, or the space around it is a setting, never a redraw.

So decide, before drawing, which of the two the instruction is:
- It needs shapes that are not in the mark today — a different subject ("make it a leaf"), a different construction ("put the initials in a circle"), a rearranged or simplified form, a different kind of mark, or a plain "redraw it". DRAW.
- It only moves one of the controls above — bigger, bolder, thinner, tighter, more clearspace, a different face, a colour, hide an element. DECLINE, and name the control it really is.
- It asks for both ("make it a leaf and a bit bolder"): DRAW the leaf at the weight it already has. The studio applies the rest.

Return ONLY valid JSON, no prose.

To decline:
{"redraw":false,"setting":"<the control it really is>","reply":"<one short sentence, naming that control>"}

To draw, obey the SAME strict SVG contract as generation: a single <svg viewBox="0 0 100 100"> with a <g id="mark">, the primary ink via currentColor (never a hard-coded colour for the main ink), only path/circle/rect/polygon/polyline/ellipse/line/g, and no text/script/style/filter/gradient/use/external references. Change ONLY what was asked: keep the construction logic, the optical weight, and the node alignment unless those are the thing being changed. Give any separable part its own <g id="...">, so the studio can hide it.

Keep the drawing ANNOTATED: every element or group carries an XML comment above it naming what it represents — <!-- ridge: the ascending stroke -->. Preserve the notes already there for the parts you leave alone, update the ones whose part you changed, and write one for anything you add. Short phrases, no markup inside a comment. They are stripped from every exported file, so they cost the brand nothing and are the only record of what your geometry means.

THE STROKE WEIGHT IS LIVE. It is one slider that sets the weight of the WHOLE mark, and the user moves it after you finish. Everything you draw has to be able to follow it:
- Build new parts from strokes, on the same construction as the parts already there: stroke="currentColor" fill="none".
- Put NO stroke-width of your own on any element — not as an attribute, not inside a style="..." — the studio sets it globally. Weight differences you bake in are erased the moment the slider moves.
- A dot, period, or terminal that belongs to the line work must be a zero-length round-capped stroke, so its diameter IS the stroke weight and it thickens with everything else: <path d="M50 80 h0" stroke="currentColor" stroke-linecap="round" fill="none"/>. A filled <circle> does NOT follow the slider — it stays the same size while the lines around it grow, which reads as a mistake. Use a filled shape only for a mass that is meant to hold still, like a counter or a solid geometric block.

Do NOT restate the palette or the fonts. They are the brand's, already chosen, and the studio keeps them across your redraw — sending your own would be an attempt to reconfigure the mark you were asked to draw. Return:
{"redraw":true,"name":"<name>","kind":"monogram|geometric|combination|wordmark","note":"<≤8-word description>","geometry":"<one sentence>","rationale":"<one sentence: what you changed and why>","svg":"<refined mark SVG>"}`;

export function iterateUserPrompt(
  brief: LogoBrief,
  currentSvg: string,
  instruction: string,
  elements: string[] = [],
): string {
  // The hideable ids matter to the decline decision: "drop the dot" is the
  // inspector hiding a named element, not a mark that needs redrawing.
  const hideable = elements.filter((e) => e !== 'mark');
  return [
    `Brand: ${brief.businessName} — ${personalityWords(brief).join(', ')}.`,
    hideable.length ? `Named elements the inspector can hide: ${hideable.join(', ')}` : '',
    `Instruction: ${instruction}`,
    '',
    'Current mark SVG:',
    currentSvg,
  ]
    .filter(Boolean)
    .join('\n');
}

export const SYSTEM_DERIVE_SYSTEM = `You are a brand-systems designer. Given a chosen logo mark's brief and palette, derive a complete, accessible brand colour system (5 roles, token order) and a type hierarchy (heading/body/mono) that pairs with the mark. Prefer widely-available web fonts.

Return ONLY valid JSON:
{"palette":[{"role":"Primary","name":"...","hex":"#RRGGBB"},{"role":"Accent","name":"...","hex":"#RRGGBB"},{"role":"Ink","name":"...","hex":"#RRGGBB"},{"role":"Background","name":"...","hex":"#RRGGBB"},{"role":"Rule","name":"...","hex":"#RRGGBB"}],"fonts":{"heading":"<CSS font-family>","body":"<CSS font-family>","mono":"<CSS font-family>"},"rationale":"<one sentence>"}`;
