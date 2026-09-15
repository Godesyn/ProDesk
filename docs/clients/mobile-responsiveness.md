# Mobile Responsiveness Contract

Prodesk-web was built desktop-first. This doc defines the conventions for making
every screen usable on a phone **without regressing desktop**. Target test
viewport: **≤ 400px wide** (we test at 390px and spot-check 360px). The
responsive breakpoint is Tailwind's `md` (768px): base styles are mobile,
`md:` restores the desktop design.

## Golden rule: never regress desktop

Guard desktop with `md:` and express mobile overrides with the **mobile-first
base** or the `max-md:` variant. A desktop-only value must keep an `md:` prefix.
Examples:

- `p-4 md:p-6` — tight on mobile, original on desktop.
- `grid-cols-2 lg:grid-cols-3` — never 1-up on a phone for KPI tiles.
- `max-md:whitespace-nowrap` — mobile-only behaviour, desktop untouched.

## Rules

1. **Drop value-less chrome on mobile, but KEEP the page title.** Decorative
   eyebrows / subtitles / descriptions that don't carry actionable value are
   `hidden md:block`. The page **title stays visible** on mobile (compact 18px) so
   every screen is self-identifying and the header action has an anchor — a lone
   floating action button over empty space reads as broken. `PageHeader` does all
   of this: visible compact title, mobile-hidden `description`, and a single
   action sits beside the title while wide / multiple actions wrap to their own
   row below. Reuse it instead of hand-rolling `<h1>` + `<p>`.
2. **Less whitespace, smaller widgets.** Cut padding (`p-6`→`p-4 md:p-6`), gaps
   (`gap-4`→`gap-3 md:gap-4`), avatars/icons, and KPI numbers on mobile so more
   content fits. Section vertical rhythm `gap-8`→`gap-5 md:gap-8`.
3. **Everything scrolls.** No fixed-height region may trap content. The page
   scrolls; tall dialogs scroll internally (`max-h-[90vh] overflow-y-auto` — the
   base `Dialog` already does this). Avoid `h-[calc(100vh-...)]` on mobile unless
   the inner area itself scrolls.
4. **No horizontal overflow.** The document must never scroll sideways. Wide,
   intentionally-scrollable regions (kanban columns, wide data tables, card
   rails) live in their own `overflow-x-auto` container — the page body does not.
5. **Tables.** Use the shared `Table` (its wrapper scrolls horizontally and cells
   are `max-md:whitespace-nowrap`). For key list screens, prefer a stacked
   card/list layout on mobile (`md:hidden` cards + `hidden md:block` table) when
   the table has many columns.
6. **Multi-column → stack.** Desktop multi-pane / multi-column layouts collapse
   to a single column or a tabbed view on mobile. Use `useIsMobile()` only when
   the DOM structure must differ (e.g. two panes → tabs); otherwise use classes.
7. **Dialogs.** Use the shared `Dialog`. It is `w-[calc(100vw-2rem)]` with a
   gutter, `p-4 sm:p-6`, and scrolls internally. Don't set fixed pixel widths
   that exceed the viewport without a `max-w-[calc(100vw-2rem)]` guard.
8. **Tap targets.** Interactive controls ≥ 36px touch height on mobile.
9. **Long text.** Assume long names/titles. Use `truncate` / `line-clamp-*` and
   `min-w-0` on flex children so a long unbreakable string can shrink.

## Shared primitives already mobile-ready

- `Dialog` (`ui/dialog.tsx`) — viewport-capped, scrollable, gutter width.
- `PageHeader` (`layout/page-header.tsx`) — hides subtitle, tighter margin.
- `Table` (`ui/table.tsx`) — horizontal scroll + mobile nowrap.
- `MainLayout` — mobile sidebar drawer + reduced mobile padding.
- `useIsMobile()` (`hooks/use-is-mobile.ts`) — reactive `md` breakpoint check.

## Verification

Drive the running app with the Playwright harness at 390px, screenshot each
screen + opened dialog, and confirm `document.scrollWidth <= clientWidth`
(no horizontal overflow) plus a visual review. Then confirm the desktop
(≥1280px) screenshot is unchanged.
