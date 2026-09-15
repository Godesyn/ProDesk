# Logo Studio — Design Spec

The Prodesk AI logo builder (`clients/logo`, port 5182). This documents the user
experience feature-by-feature. It is **live on real data** — every screen reads
`trpc.logo.*`, backed by the engine in `packages/server-shared/src/modules/logo/`.
The old `src/lib/mock.ts` is gone.

## Design thesis

> **Great marks are born in black & white. Colour is a decision.**

A real identity-design doctrine: get the _form_ right in monochrome so it has to
earn its keep, then introduce colour deliberately. This is the spine of the whole UI.

- **Achromatic chrome, rationed pigment.** The studio is ink-on-paper. The Forest
  accent (`--pigment`, the shared runtime accent — never overridden) appears only at
  moments of **creation and commitment**: the Generate button, a _selected_ concept,
  the instant a colourway is committed in the editor. Colour is an event, not wallpaper.
- **The canvas is the hero; the UI is the frame.** A dark ink rail + slim topbar
  frame a warm paper stage. Structure borrowed from the pro tools users aspire to
  (Figma/Illustrator), disarmed for non-designers.
- **Signature element — the specimen contact-sheet.** How foundries and identity
  designers present a mark: one form across sizes, lockups, colourways, and real-world
  context. Marks **draw themselves in** (`[data-draw]` SVG path animation) — the birth
  of the mark is the hero moment.

### Materials

- **Type:** Inter Tight (display + UI, 800 / tight tracking), Instrument Serif italic
  (the `.quill` — one human, editorial accent per screen), JetBrains Mono (the `.spec`
  label — every number: hex, px, ratios, %). Designers speak in coordinates; showing
  them makes the tool feel precise, not toy-like.
  Those three are the studio's own chrome. The faces a WORDMARK can be set in are a
  wider, separate set — the Brand Kit's families, eleven of them, listed in
  `modules/logo/typefaces.ts` — so a mark and the brand's signatures/proposals speak
  the same type. Both are loaded in `index.html`, the chrome ahead of the rest.
- **Surface:** warm Bone paper stage (`--stage #F3F1EA`), Graphite ink rail
  (`#0E0E0C`), hairline rules. A blueprint dot-grid (`.stage-grid`) is where marks are born.
- **Motion:** `rise` (statement entrances), `pop` (menus/commit bar), `logo-draw`
  (self-drawing marks). All respect `prefers-reduced-motion`.

---

## Shell — the frame (`app/LogoApp.tsx`)

**Layout.** Fixed 248px dark rail · fluid main (slim topbar + routed stage).

**Rail.** Wordmark + self-drawn mark → brand switcher (dark, `pop` menu) → a numbered
**pipeline** nav. Numbering (01–06) is earned: making a mark _is_ a sequence
(Create → Concepts → Editor → Brand system → Guidelines → Assets). The Studio hub sits
above it, unnumbered. Active item: faint off-white fill + a **Forest pip** bleeding off
the left edge. Support/Profile/Sign-out anchored at the foot.

**Topbar.** `brand / Logo Studio` breadcrumb in mono · ⌘K command chip · the one pigment
CTA, **New mark**. Frosted (`backdrop-blur`) so the stage scrolls under it.

---

## 00 · Studio home (`pages/Home.tsx`)

**Job:** on landing, believe a real identity lives here.

**Layout.** Split hero → pipeline strip → snapshot + recent brands.

**Hero.** Left: mono eyebrow, a `text-display` headline with the brand name set in the
Forest `.quill`, a lede, two actions (pigment _Open the editor_, ink _Start a new mark_),
and three stats (Concepts / **Uniqueness 92** in pigment / Assets). Right: a **specimen
stage** — the current mark on the blueprint grid inside a ruled frame with corner ticks,
mono spec labels pinned to each corner (`1:1 · MARK`, `CLEARSPACE 1.0×`, `#2E9E58`,
`SVG · VECTOR`). The mark **draws itself in** on load.

**Pipeline strip.** Six cards; done = Forest check, current = pigment-tinted border + fill,
future = quiet. Hover lifts and reveals an arrow. Direct entry to any stage.

**Snapshot + recent.** Palette swatches (inset-ring chips) + type roles with live
specimens; recent brands list, each with its own mini mark and a status tag.

---

## 01 · Create / Brief (`pages/Brief.tsx`)

**Job:** teach the studio the brand's character with the least friction.

**Layout.** Mode toggle (Guided brief / Conversation) → two columns: form (left),
sticky live-brief + Generate (right).

**Key interactions.**

- **Personality dials** — bipolar sliders (Classic↔Modern, Serious↔Playful,
  Minimal↔Expressive, Geometric↔Organic). Five pills per axis; the active pill grows and
  turns Forest. Tactile, fast, no numbers to reason about.
- **Keyword chips** — suggestions + selections merged; selected chips turn pigment-soft
  with an `×`. Toggle to add/remove.
- **Mark type** — segmented ink pills (Monogram / Geometric / Combination / Wordmark /
  Surprise me); the choice fills solid ink.
- **Colour principle** — a toggle, **"Design in black & white first," default ON**. The
  thesis, surfaced as a real setting with a plain-language rationale.

**The commitment.** Right rail restates the brief as a sentence that updates live
(`A geometric mark for Meridian, evoking guidance, ascent — monochrome first`), lists
Concepts / Format / Engine / Est. time, then the pigment **Generate concepts** button.
Beneath it, the trust line: _You only pay when you download — designing is free._

---

## 02 · Concepts (`pages/Concepts.tsx`) — the signature screen

**Job:** choose a direction; feel the output is original and yours.

**Layout.** Header (Variations / Regenerate) → responsive **contact sheet** of six
specimen cards + a dashed "generate six more" tile → a floating **commit bar**.

**Key elements.**

- Each **concept card** = a specimen window (mark on blueprint grid) with a mono index
  (01–06), a **Save/heart** toggle (fills Forest), and a footer: name, note, and a
  **uniqueness score** (tabular-mono number + a thin pigment meter). Directly answers the
  market's #1 complaint — _sameness_ — by scoring distinctiveness in the open.
- All marks draw in on mount, **staggered**, so the sheet resolves like a reveal.
- **Selection is the colour moment:** the chosen mark's stroke turns from ink to Forest,
  and a pigment ring wraps the card.
- **Commit bar** (`pop`, pinned bottom-centre): selected mark + `92% unique · geometric`
  - pigment **Refine in editor →**. Present only once something is chosen.

---

## 03 · Editor / Studio (`pages/Studio.tsx`) — the flagship

**Job:** make it truly editable (the "can't edit after generating" complaint, answered)
and let non-designers steer with words.

**Layout.** Full-height three panes: **Layers** (260) · **Canvas** (fluid) · **Inspector** (320).

**Left — lockups & elements.** Six lockup thumbnails (Primary / Stacked / Mark / Wordmark /
Mono / **Reversed** on ink); the active one is pigment-bordered. Below, the mark's **named
elements** (Symbol / Wordmark / Container) each with an eye toggle — because the output is
real, structured SVG, not a flat raster.

**Centre — the canvas.**

- Floating glass toolbar: undo/redo, zoom −/%/+, fit.
- The stage carries a live **clearspace guide** (dashed inset that responds to the
  Clearspace slider) and a rotated mono pixel label — the mark reads as a _spec_, not a picture.
- **Colourway strip** — Black / Forest / Reversed. This is the literal thesis interaction:
  the mark lives in ink until you _commit_ Forest, at which point a `● Colour committed`
  marker pops. On Reversed the whole stage flips to ink and the mark goes paper-white.
- **Copilot dock** — suggestion chips (_Make the mark bolder_, _Try it as a monogram_,
  _Tighten the wordmark_) above a prompt field with a Sparkles glyph and pigment send.
  Conversational iteration, first-class — no competitor's dedicated logo tool nails this.

**Right — inspector.** Live properties for the selected element: **Colour** (swatch + hex +
"A decision, not a default" note), and range sliders (Scale / Stroke weight / Clearspace)
with mono read-outs and pigment thumbs. A **Live specs** block (Format / Elements /
Contrast AA / Min size) keeps the professional register. Footer CTA: **Build the brand system →**.

---

## 04 · Brand system (`pages/BrandSystem.tsx`) — the moat

**Job:** turn one mark into a whole identity — and into Prodesk's advantage.

**Layout.** Header (pigment _Push to the suite_) → Logo suite (6 lockups) → Palette + Type
→ **the suite-inheritance panel**.

**Key elements.**

- **Logo suite** — the full contact sheet; the Reversed and Mono lockups render on their
  correct grounds, the Wordmark as set type.
- **Palette** — swatch rows with role, name, and mono hex. **Type** — each role shown at
  size with its family/spec; the Detail role renders in mono, as it would in use.
- **"Powers your suite"** — a dark ink panel, the only place colour and darkness combine,
  showing Signatures / Payments / Reviews / Links / Websites each inheriting the mark.
  Live ones carry a Forest check (`Applied`); the rest say `Apply →`. This is the story no
  standalone logo tool can tell: the logo seeds the entire Prodesk brand system.

---

## 05 · Guidelines (`pages/Guidelines.tsx`)

**Job:** make a solopreneur's mark feel like a $50k agency deliverable.

**Layout.** Clearspace + Minimum sizes (two panels) → Do / Don't columns.

**Key elements.** A **clearspace diagram** (mark inside a dashed 1.0× frame with mono ratio
ticks); a **minimum-size ladder** (the mark at 16/24/48/96px with labels — Favicon → Full);
and paired **Do / Don't** columns headed by a Forest check and a danger ✗. A living rulebook,
exportable as PDF or share link.

---

## 06 · Assets (`pages/Assets.tsx`)

**Job:** convert at the download moment — without the paywall resentment.

**Layout.** Export formats grid → Marketing kit → real-world mockups → pay-on-download bar.

**Key elements.**

- **Export formats** — SVG highlighted as the pigment-bordered primary (**vectors are
  included, never the surprise paywall** — a direct jab at the incumbents). PNG @1–4x, PDF,
  favicon, social kit, guidelines. Download glyph on hover.
- **Marketing kit** — assets generated _from the brand system_ and routed to the sibling
  apps (Email signature → Signatures, Invoice header → Payments…). Ready ones carry a Forest
  check; others say Generate →.
- **Mockups** — the mark in context (app icon, storefront, card, merch) across grounds.
- **Pay-on-download bar** — _Designing is free. You own it when you download._ Full rights +
  vectors, cancel anytime — transparent pricing as a competitive weapon.

---

---

## How it is built

**Engine** (`packages/server-shared/src/modules/logo/`)

- `providers/claude.ts` implements the pluggable `LogoProvider` adapter (brief → N
  editable SVG marks; a vector-gen API can be added as a sibling with no call-site
  change). `fallback.ts` is a deterministic engine so the studio always returns a
  full contact sheet with no AI key.
- `svg.ts` sanitises model-authored SVG to the persisted mark contract (square
  viewBox, `<g id="mark">`, `currentColor` ink) and composes the six lockups. The
  viewBox is **measured**, so a long brand name widens the lockup instead of being
  clipped.
- `outline.ts` + `typefaces.ts` set wordmarks as **vector outlines** from three
  shipped OFL faces (`assets/fonts/`). A live `<text>` node would render in a
  different typeface server-side — the webfont isn't installed there — so every
  export would silently mismatch the preview. Outlines make geometry the source of
  truth: SVG, PNG, and PDF are identical and font-independent.
- `raster.ts` / `export.ts` derive the download matrix (PNG @1–4×, favicon set,
  social kit, print PDF) from the vector source; `guidelines.ts` builds the
  rulebook PDF and is the single source of the rules shown on screen.
- `brand-writethrough.ts` seeds `brands.logoUrl/colors/typography`,
  `brand_kits.logoSlots`, and the document locker — the suite moat.
- `entitlement.ts` is the billing seam. Designing is always free; only export is
  gated, and it **fails open** until a `logo_builder` product exists.

**Editor geometry is real.** Scale / stroke weight / clearspace / element
visibility persist to `spec.adjust` and are applied by the one lockup builder, so
what the canvas shows is byte-for-byte what downloads. Undo/redo walks the
`parent_id` lineage rather than a local stack, so history survives a reload.

**Data.** `logo_projects` + `logo_generations` (migration 0075) hold the design
working state and iteration lineage; brand identity itself lives on
`brands`/`brand_kits`. 0074 adds the `logo` staff permission, 0076 the share token,
0078 the unique index that keeps versioned share slugs distinct.

**Public surface.** `/share/:brand/:version` serves a shared rulebook with no
session at all — `acme-coffee/v2`, readable enough to say out loud, minted once
per project and never revoked. The token is the only credential and the payload
carries nothing but the rulebook; `/g/:token` still answers the opaque links
minted before the slug scheme. Both shapes live in `modules/logo/share-link.ts`.

## Conventions

- Bespoke styling is scoped under `.logo-ui`; shared auth/onboarding/profile pages
  keep the stock theme and runtime white-label accent (never touch `--accent-h/s/l`).
- The shared `.text-display` token is a fixed 120px, which swallows a phone
  viewport — `.logo-ui` scopes a fluid ramp over it rather than editing the token.
- Grid tracks that hold text use `grid-cols-1` / `minmax(0, Nfr)`. An `fr` or
  implicit `auto` track takes its minimum from content, so one `truncate`
  (`white-space: nowrap`) descendant will otherwise widen the whole page.

## Verified

- `bun run typecheck` (all workspaces) and `bun run --filter logo build` pass.
  `bun run test` — 116 pass, including 28 logo-engine tests; the ~10 failing
  integration FILES are the pre-existing PGlite `pg_trgm` gap at migration 0044.
- Live pass against the local Supabase stack with a real Claude key: brief →
  6 concepts → commit → editor (persisted geometry, lineage) → push to suite
  (verified in `brands`) → guidelines share link → every export format (SVG, PNG,
  PDF, favicon, social, guidelines PDF all HTTP 200, artifacts in storage).
- Responsive at 390 / 820 / 1440: zero horizontal overflow on every screen, no
  tap target under 24px, no console errors. Mobile collapses the rail into a
  drawer and the editor's side panels into bottom sheets.

## Not done

- Pricing is undecided, so no `logo_builder` product exists and downloads are
  free. The subscribe flow is wired end-to-end (shared
  `featureSubscriptions.checkout`, card-on-file or Stripe Checkout) and engages
  the moment an admin creates the product.
