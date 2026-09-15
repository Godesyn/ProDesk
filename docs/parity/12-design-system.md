# Design System

The Prodesk design language: a monochrome ink scale plus a single brand accent
(Forest green by default), driven entirely by CSS custom properties. The whole
palette derives from three accent channels, so the entire app re-themes at
runtime when a tenant picks a different brand color.

Source files:

- Tokens & type scale: `client/src/index.css`
- Runtime accent bridge: `client/src/lib/theme-accent.ts`
- Shared primitives: `client/src/components/ui/`
- App shell & composed layout: `client/src/components/layout/`
- Document shell / loader / font links: `client/index.html`

Design ratio: **60% Paper · 30% Ink · 10% Accent.**

---

## A. Design tokens

All tokens are declared in the `@theme` block of `client/src/index.css`
(Tailwind v4 — `@import 'tailwindcss'`). There is no separate `tailwind.config`
file; the theme lives in CSS.

### A.1 Colors

The accent and all near-white surfaces are computed from three channels —
`--accent-h`, `--accent-s`, `--accent-l` (`index.css:25-27`) — so writing those
three variables on `:root` re-tints the accent, the focus ring, the success
color, **and** the paper/card/inset surfaces together. `theme-accent.ts`
(`applyAccentVars`, `index.css` mirror) is the bridge that converts a tenant's
accent hex into those channels.

| Token                  | Value                                              | CSS variable             |
| ---------------------- | -------------------------------------------------- | ------------------------ |
| ink / ink-100          | `#0e0e0c`                                          | `--color-ink` / `--color-ink-100` |
| ink-80                 | `#2c2c28`                                          | `--color-ink-80`         |
| ink-60                 | `#5a5a52`                                          | `--color-ink-60`         |
| ink-40                 | `#8e8e84`                                          | `--color-ink-40`         |
| ink-20                 | `#c9c7bd`                                          | `--color-ink-20`         |
| ink-10                 | `#e4e2d8`                                          | `--color-ink-10`         |
| accent (Forest)        | `hsl(142.5 55% 40%)` ≈ `#2e9e58`                   | `--color-accent`         |
| accent-hover           | accent at `l − 6%`                                 | `--color-accent-hover`   |
| accent-ring            | accent at `0.55` alpha                             | `--color-accent-ring`    |
| success                | tracks the accent (`hsl(--accent-h --accent-s --accent-l)`) | `--color-success` |
| danger                 | `#d24a2a`                                          | `--color-danger`         |
| warn                   | `#c98a2b`                                          | `--color-warn`           |
| paper                  | `hsl(--accent-h 22% 94%)` — page background        | `--color-paper`          |
| card                   | `hsl(--accent-h 14% 97.5%)` — card/input surface   | `--color-card`           |
| inset                  | `hsl(--accent-h 26% 90%)` — hover/inset fill       | `--color-inset`          |
| active-muted           | `#e7e2d2` — active sidebar tile / selected row tint | `--color-active-muted`  |
| border-hairline        | `rgba(14,14,12,0.08)`                              | `--color-border-hairline` |
| border-default         | `rgba(14,14,12,0.16)`                              | `--color-border-default` |

`paper`, `card`, and `inset` are accent-hue-tinted near-whites (`index.css:29-32`),
not fixed greys — they shift with the brand accent. The default `:root`
channels yield the Forest-tinted surfaces above.

**Runtime accent theming.** `theme-accent.ts` decomposes a hex accent into HSL
channels (`hexToAccentHsl`) and writes `--accent-h/s/l` onto the document root
(`applyAccentVars`). The resolved tenant accent is cached in `localStorage`
(key `pd:accent:<subdomain>`, `__app__` for the app domain) and re-applied on
the next cold load. The static loader in `index.html` reads the same cached hex
synchronously in `<head>` and tints its background/dots before React mounts, so
the splash already shows the tenant color.

**On-accent text.** Accent and danger fills use white text
(`button.tsx:12,15`); the ink-tinted surfaces use the ink scale.

### A.2 Typography

Three families, loaded via Google Fonts. `index.html` preconnects to
`fonts.googleapis.com` / `fonts.gstatic.com` and links the stylesheet
(`index.html:9-15`); `index.css` also `@import`s the same families
(`index.css:1`).

- Sans: **Inter Tight** — `--font-sans` (`'Inter Tight', ui-sans-serif, system-ui, sans-serif`)
- Serif: **Instrument Serif** (italic) — `--font-serif`
- Mono: **JetBrains Mono** — `--font-mono`

Type scale (utility classes in `index.css` under `@layer utilities`):

| Class                | Family | Size                          | Weight | Line height | Tracking      |
| -------------------- | ------ | ----------------------------- | ------ | ----------- | ------------- |
| `.text-display`      | sans   | 120px (7.5rem)                | 800    | 0.833       | −0.05em       |
| `.text-h1`           | sans   | clamp(40px → 84px), 8vw       | 800    | 1.047       | −0.04em       |
| `.text-h2`           | sans   | clamp(32px → 56px), 5vw       | 700    | 1.143       | −0.03em       |
| `.text-h3`           | sans   | clamp(24px → 36px), 3.5vw     | 600    | 1.222       | −0.01em       |
| `.text-body-large`   | sans   | 18px                          | 400    | 1.444       | —             |
| `.text-body`         | sans   | 15px                          | 400    | 1.5         | —             |
| `.text-eyebrow`      | mono   | 12px, `text-transform: uppercase` | 500 | —        | +0.10em       |
| `.text-ui-xs`        | sans   | 12px                          | 500    | 1.4         | —             |
| `.text-ui-sm`        | sans   | 13px                          | 500    | 1.4         | —             |
| `.text-ui-md`        | sans   | 15px                          | 500    | 1.4         | —             |
| `.text-ui-lg`        | sans   | 17px                          | 600    | 1.4         | —             |
| `.text-panel-title`  | sans   | 18px                          | 700    | 1.3         | −0.01em       |
| `.text-kpi`          | sans   | 32px                          | 800    | 1.0         | −0.03em       |
| `.text-section-title`| sans   | 28px                          | 700    | 1.2         | −0.03em       |
| `.text-serif-italic` | serif  | italic                        | 400    | —           | −0.01em       |

`.text-eyebrow` uppercases via CSS. `.text-section-title` (28px) sits between
`.text-h3` and `.text-h2` for section headers.

### A.3 Radii

| Token  | Value  | CSS variable    |
| ------ | ------ | --------------- |
| sm     | 6px    | `--radius-sm`   |
| md     | 14px   | `--radius-md`   |
| lg     | 28px   | `--radius-lg`   |
| pill   | 999px  | `--radius-pill` |

Buttons and inputs use `sm` (lg button uses `md`); cards and dialogs use `md`.
Badges use a squared **4px** radius (`badge.tsx:7`) — tighter than `sm`, by
design. Count pills and nav badges use `pill`.

### A.4 Elevation (shadows)

A tight, low-spread, double-layer system (`index.css:67-75`) — never blurry
haloes:

- `--shadow-1` (cards): `0 1px 0 rgba(14,14,12,0.06), 0 1px 2px rgba(14,14,12,0.04)`
- `--shadow-2` (menus / hover lift): `0 1px 0 …, 0 6px 18px -8px rgba(14,14,12,0.16)`
- `--shadow-3` (modals / drawer): `0 1px 0 …, 0 24px 48px -16px rgba(14,14,12,0.22)`
- `--shadow-focus`: `0 0 0 3px` accent at `0.55` alpha — the focus ring

`Card` uses `shadow-1` (`card.tsx:9`); `AppItemCard` lifts `shadow-1 → shadow-2`
on hover (`app-item-card.tsx:126`); the mobile drawer uses `shadow-3`
(`sidebar.tsx:271`).

### A.5 Spacing, breakpoints, and motion

- **Spacing:** Tailwind's 4px scale. Card padding is `p-6` (24px,
  `card.tsx:17,29,33`).
- **Container:** the app fills the viewport — main content is full-width with
  responsive padding (`main-layout.tsx:175`: `px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-[500px]`),
  no centered max-width. The large bottom padding clears the floating chat
  launcher.
- **Breakpoints:** Tailwind defaults (`sm` 640 / `md` 768 / `lg` 1024…). The
  sidebar rail shows at `md:flex` (768px); below that a mobile drawer takes over.
  `AppItemCard` uses a 600px breakpoint internally for its desktop/mobile media
  layout (`app-item-card.tsx:22`).
- **Motion** (`index.css:77-96`):
  - `--ease-click`: `cubic-bezier(0.2, 0.8, 0.2, 1)` — brand click curve
  - `--duration-quick` 120ms · `--duration-standard` 240ms · `--duration-statement` 480ms
  - `--animate-reveal`: rise 8px + fade in over the statement duration (`@keyframes reveal`)
  - `.press` utility: scales to `0.985` on `:active` (applied by `Button`, `button.tsx:7`)
  - `@keyframes pd-shimmer` (1.4s sliding gradient, via `.pd-shimmer`) for media
    placeholders, and `@keyframes pd-indeterminate` (via `.pd-progress-bar`) for
    a top progress bar.

---

## B. Shared components

Primitives live in `client/src/components/ui/`; composed shell/layout pieces in
`client/src/components/layout/`.

### Core primitives (`components/ui/`)

| Component            | File                  | Notes                                                                                                                       |
| -------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Button               | `button.tsx`          | Variants `default` (ink fill), `accent` (Forest fill + white), `outline`, `ghost`, `danger`, `link`; sizes `default/sm/lg/icon`. Carries `.press` scale + accent focus ring. |
| Badge                | `badge.tsx`           | 4px radius, JetBrains mono, UPPERCASE, `0.06em` tracking. Tones: `default` (ink), `muted`, `accent`, `success`, `warn`, `danger`, `outline` — tinted fill (~12%) + matching border. |
| Card                 | `card.tsx`            | `radius-md`, hairline border, `bg-card`, `shadow-1`. Subparts: Header/Title/Description/Content/Footer.                      |
| AppItemCard          | `app-item-card.tsx`   | Media-tile for marketplace/catalog/spots. Aspect clamped to [3/4 .. 4/3]; `grid`/`square`/`rail` layouts; hover lift + shadow-1→2; shimmer placeholder; desktop gradient overlay vs mobile solid bar; video play affordance. |
| Avatar               | `avatar.tsx`          | Circular, `bg-ink-100` fill with `text-paper` initials fallback; cover-fit image.                                          |
| Input                | `input.tsx`           | `h-10`, `radius-sm`, `border-default`, `bg-card`, accent focus ring, `placeholder:text-ink-40`.                            |
| Label                | `label.tsx`           | Form label primitive.                                                                                                       |
| PhoneInput           | `phone-input.tsx`     | Country-code phone field.                                                                                                   |
| Skeleton             | `skeleton.tsx`        | `animate-pulse`, `radius-sm`, `bg-inset`.                                                                                   |
| Dialog               | `dialog.tsx`          | Radix modal surface.                                                                                                        |
| ConfirmDialog        | `confirm-dialog.tsx`  | Confirmation modal.                                                                                                          |
| DropdownMenu         | `dropdown-menu.tsx`   | Radix action menu (supports `destructive` items).                                                                           |
| Popover / Tooltip    | `popover.tsx` / `tooltip.tsx` | Radix popover and tooltip (tooltip used for collapsed-rail labels).                                                 |
| Table                | `table.tsx`           | Styled data table.                                                                                                          |
| Pagination           | `pagination.tsx`      | Offset pagination controls.                                                                                                 |
| SortableList         | `sortable-list.tsx`   | Drag-reorder list.                                                                                                          |
| CardRail             | `card-rail.tsx`       | Horizontal scrolling rail for `AppItemCard`s.                                                                               |
| AvatarSelect         | `avatar-select.tsx`   | Avatar picker.                                                                                                              |
| RefreshButton        | `refresh-button.tsx`  | Refresh affordance.                                                                                                         |
| ReadinessTooltip     | `readiness-tooltip.tsx` | Readiness/blocker hint.                                                                                                    |

### Layout & shell (`components/layout/`)

| Component               | File                          | Notes                                                                                       |
| ----------------------- | ----------------------------- | ------------------------------------------------------------------------------------------- |
| MainLayout              | `main-layout.tsx`             | App shell: sidebar + header + full-viewport `<main>` + floating chat panel.                 |
| Sidebar                 | `sidebar.tsx`                 | 210px rail (64px collapsed, animated width); volt left-bar active indicator; context selector slot; nav badges; mobile drawer (`shadow-3`); legal footer / environment chip. |
| PageHeader              | `page-header.tsx`             | Title (18px on mobile → `.text-h3` on desktop) + optional description + action slot.        |
| EmptyState              | `empty-state.tsx`             | Dashed-border centered state with optional icon, title, description, action.                |
| FloatingMessagePanel    | `floating-message-panel.tsx`  | Bottom-right chat launcher with live unread badge; docked panel on desktop, routes to `/chat` on mobile. |
| ContextSelector         | `context-selector/`           | Org/workspace switcher at the top of the rail (with overlay actions and option items).      |
| PendingVerificationRail | `pending-verification-rail.tsx` | Replaces the nav list while an org awaits verification.                                    |
| OnboardingHeader / OnboardingLayout | `onboarding-header.tsx` / `onboarding-layout.tsx` | Onboarding shell.                                                  |
| ChatToasts              | `chat-toasts.tsx`             | Transient chat notifications.                                                               |

---

## C. App shell

### C.1 Sidebar (`sidebar.tsx`)

- **Width:** 210px expanded, 64px collapsed, animated via `transition-[width]`
  over `--duration-standard` (`sidebar.tsx:254-257`). Collapse state persists per
  user in `uiPreferences.sidebarCollapsed` (seeded from `localStorage`,
  `main-layout.tsx:39-61`).
- **Surface:** `bg-paper`, right hairline border, sticky full-height
  (`sticky top-0 h-screen`) so the rail scrolls independently while the collapse
  toggle and footer stay anchored.
- **Top of rail:** `ContextSelector` (org/workspace switcher); falls back to a
  `Prodesk` wordmark when none is supplied.
- **Active tile:** `bg-active-muted` + `text-ink-100`, with an accent left-bar
  indicator (`sidebar.tsx:107-113`). Collapsed tiles surface a pending badge as
  an accent dot.
- **Nav items:** built by `buildNavItems(nav)` from `./nav-items` with
  permission gating, dividers, and section headers; count badges (e.g. proposals
  attention) render as accent pills (`sidebar.tsx:123-127`).
- **Mobile:** a drawer (overlay + `w-[260px]` panel, `shadow-3`) opened from the
  header menu button (`sidebar.tsx:264-287`, trigger at `main-layout.tsx:124-132`).
- **Footer:** Privacy / Terms links to `prodesk.com/legal` in production; a
  pulsing environment chip (Staging / Development) in non-production builds.

### C.2 Header (`main-layout.tsx:122-171`)

- `h-16`, bottom hairline, `bg-card/80 backdrop-blur`.
- Left: mobile menu button (`md:hidden`), org name (truncated), workspace
  `Badge`.
- Right: `TasksBell` (task-inbox count as an accent pill capped at 99+,
  `main-layout.tsx:188-207`) and an avatar dropdown (Profile / Sign out).

### C.3 Layout scaffold

`flex min-h-screen bg-paper` → Sidebar + a min-width-0 column (header + `<main>`).
Content is full-width with responsive padding and no centered max-width
(`main-layout.tsx:175`). The `FloatingMessagePanel` is mounted once at the shell
level and overlays the bottom-right of every screen.

---

## D. Document shell (`index.html`)

- Preconnects + links the three Google Font families; favicon at `/favicon.png`.
- A synchronous `<head>` script reads the cached tenant accent
  (`pd:accent:<subdomain>`), derives its hue, and sets `--ld-accent` /
  `--ld-accent-rgb` / `--ld-h` so the static loader paints in the tenant color
  before React mounts.
- The inline loader screen (`#root`) is a full-viewport editorial splash —
  background grid, mono eyebrows, an 800-weight `Prodesk` title with an
  Instrument-Serif italic "Everything", a pulsing status dot, and an accent
  progress bar — all hue-tinted from `--ld-h`.
