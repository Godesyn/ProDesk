/**
 * Server-rendered HTML for the public review embed iframe. Ported from the Manus
 * export's embedRoutes.ts render path. Self-contained (inline CSS/JS) so it can be
 * served directly by the backend Express app and framed on any origin.
 */
import { env } from '../../lib/env.js';
import type { ReviewEmbedTheme } from './embed.js';

export type EmbedReview = {
  id: string | number;
  stars: number;
  text: string;
  reviewer: string;
  createdAt: number;
  locationName?: string;
};

/** A captured submission as stored in review_submissions. */
export type SubmissionForEmbed = {
  id: string | number;
  stars: number;
  generatedReview: string | null;
  createdAt: Date | number;
  locationName?: string;
};

/**
 * Public submissions with non-empty AI text, newest first — the candidate pool for
 * an embed. Includes all star ratings; the `onlyFiveStar` theme flag (applied in
 * renderEmbedHtml) is what narrows the wall to 5★, so turning that flag OFF surfaces
 * the 3–4★ reviews too. (Only the text filter stays here — a review with no written
 * text has nothing to display.)
 */
export function pickPublicReviews(rows: SubmissionForEmbed[]): EmbedReview[] {
  return rows
    .filter((r) => (r.generatedReview ?? '').trim().length > 0)
    .map((r) => ({
      id: r.id,
      stars: r.stars,
      text: (r.generatedReview ?? '').trim(),
      reviewer: 'Verified customer',
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt),
      locationName: r.locationName,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_STACKS: Record<string, string> = {
  geist: "'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  'dm-sans': "'DM Sans', system-ui, sans-serif",
};
const RADIUS_PX: Record<string, number> = { sharp: 4, soft: 12, round: 22 };
const DENSITY_GAP: Record<string, number> = { compact: 8, cozy: 14, comfortable: 22 };

/** Google Fonts family query per font key (empty = system, no webfont needed).
 *  Without this the custom fonts silently fall back to the system stack, so e.g.
 *  Inter and DM Sans render identically. */
const FONT_GOOGLE: Record<string, string> = {
  geist: 'Geist:wght@400;500;600;700',
  inter: 'Inter:wght@400;500;600;700',
  playfair: 'Playfair+Display:wght@400;500;600;700',
  'dm-sans': 'DM+Sans:wght@400;500;600;700',
  system: '',
};

/** <link> tags that load the selected webfont from Google Fonts (or '' for system). */
function fontLinkTags(font: string): string {
  const family = FONT_GOOGLE[font] ?? FONT_GOOGLE.geist;
  if (!family) return '';
  return (
    '<link rel="preconnect" href="https://fonts.googleapis.com" />' +
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />' +
    `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family}&display=swap" />`
  );
}

/**
 * A single review card. Exported so the paginated `/reviews.json` endpoint renders
 * additional pages with byte-identical markup to the initial server render.
 */
export function renderReviewCard(r: EmbedReview, theme: ReviewEmbedTheme): string {
  return `
    <article class="pm-card">
      ${theme.showStarCount === false ? '' : `<div class="pm-stars" aria-label="${r.stars} out of 5">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</div>`}
      <p class="pm-text">${escapeHtml(r.text)}</p>
      <footer class="pm-meta">
        <span class="pm-name">${escapeHtml(r.reviewer)}</span>
        ${r.locationName ? `<span class="pm-loc">· ${escapeHtml(r.locationName)}</span>` : ''}
      </footer>
    </article>`;
}

export function renderEmbedHtml(opts: {
  title: string;
  reviews: EmbedReview[];
  theme: ReviewEmbedTheme;
  brandedUnlocked: boolean;
  configUrl: string;
  /** Location logo, shown in a header when the (branded) `showLogo` theme flag is on. */
  logoUrl?: string | null;
  /** Location win tags — shown as chips when the `showWinTags` flag is on. */
  winTags?: string[] | null;
  /**
   * Endpoint that serves further pages of pre-rendered cards (`{ cards, nextCursor }`).
   * When set, the wall/carousel layouts render only the first page and lazy-load the
   * rest (carousel on scroll, wall via a "Load more" button) instead of dumping every
   * review into the initial payload. Omit for the in-app preview (renders eagerly).
   */
  reviewsUrl?: string;
  /** Keyset cursor for the NEXT page, or null/absent when the first page is the whole pool. */
  nextCursor?: string | null;
}): string {
  const { title, reviews, theme, configUrl, logoUrl, winTags, reviewsUrl, nextCursor } = opts;
  const dark = theme.dark === true;
  // Default accent tracks the mode: black on light, white on dark. The builder's
  // color field uses the SAME fallback so the preview matches the initial value.
  const accent = theme.accentColor ?? (dark ? '#ffffff' : '#000000');
  const fontFamily = FONT_STACKS[theme.fontFamily ?? 'geist'] ?? FONT_STACKS.geist;
  const radius = RADIUS_PX[theme.radius ?? 'soft'] ?? 12;
  const gap = DENSITY_GAP[theme.density ?? 'cozy'] ?? 14;
  const bg = dark ? '#0d0d0d' : '#f7f6f1';
  const fg = dark ? '#f5f3eb' : '#1a1a1a';
  // Card surface is driven by the CHOSEN theme (theme.dark), never the viewer's OS
  // — otherwise dark-mode cards vanish on the dark background for light-OS viewers.
  const cardBg = dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)';
  const cardBorder = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.08)';
  const chipBg = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';

  const variant = theme.variant ?? 'wall';
  const filtered = theme.onlyFiveStar ? reviews.filter((r) => r.stars >= 5) : reviews;

  const card = (r: EmbedReview): string => renderReviewCard(r, theme);

  // Pagination data attributes for the lazy-loading layouts (empty when not paginating).
  const pageAttrs = reviewsUrl
    ? ` data-pm-reviews-url="${escapeHtml(reviewsUrl)}" data-pm-cursor="${escapeHtml(nextCursor ?? '')}"`
    : '';

  // Body markup per layout variant. Each is a distinct presentation of the same
  // cards, so the Layout selector visibly changes the embed.
  const marqueeCount = Math.min(16, filtered.length);
  // Slow, constant-speed ticker: seconds scale with the number of cards so more
  // reviews don't scroll faster. Deliberately unhurried.
  const marqueeDur = Math.max(80, marqueeCount * 12);
  let body: string;
  if (filtered.length === 0) {
    body = `<div class="pm-empty">No verified reviews yet.</div>`;
  } else if (variant === 'hero') {
    // One large featured review at a time, auto-rotating through the pool so all
    // of them get a turn (a single static card read as "only one review").
    const slides = filtered.slice(0, 8);
    body = `<div class="pm-hero" data-pm-hero>${slides
      .map((r, i) => `<div class="pm-hero-slide${i === 0 ? ' active' : ''}">${card(r)}</div>`)
      .join('')}</div>`;
  } else if (variant === 'carousel') {
    // Lazy-loads further pages as you scroll (see pageAttrs); loops once exhausted.
    body = `<div class="pm-carousel" data-pm-carousel${pageAttrs}>${filtered.slice(0, 24).map(card).join('')}</div>`;
  } else if (variant === 'marquee') {
    // Duplicate the set so the CSS translateX(-50%) loops seamlessly.
    const row = filtered.slice(0, 16).map(card).join('');
    body = `<div class="pm-marquee"><div class="pm-marquee-track">${row}${row}</div></div>`;
  } else {
    // wall (default) — a "Load more" button appends further pages (no internal scroll
    // to lazy-load against, since the iframe auto-grows to its content height).
    const more =
      reviewsUrl && nextCursor
        ? `<button type="button" class="pm-more" data-pm-more>Load more</button>`
        : '';
    body = `<div class="pm-grid" data-pm-grid${pageAttrs}>${filtered.slice(0, 24).map(card).join('')}</div>${more}`;
  }

  const tags = (theme.showWinTags !== false && winTags ? winTags : []).filter(Boolean);
  const tagsRow = tags.length
    ? `<div class="pm-tags">${tags
        .slice(0, 12)
        .map((t) => `<span class="pm-tag">${escapeHtml(t)}</span>`)
        .join('')}</div>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<title>${escapeHtml(title)} · Reviews</title>
${fontLinkTags(theme.fontFamily ?? 'geist')}
<style>
  :root {
    --pm-bg: ${bg};
    --pm-fg: ${fg};
    --pm-accent: ${accent};
    --pm-radius: ${radius}px;
    --pm-gap: ${gap}px;
    --pm-font: ${fontFamily};
    --pm-card-bg: ${cardBg};
    --pm-card-border: ${cardBorder};
    --pm-chip-bg: ${chipBg};
    --pm-marquee-dur: ${marqueeDur}s;
  }
  * { box-sizing: border-box; }
  html, body { margin:0; padding:0; }
  body {
    font-family: var(--pm-font);
    color: var(--pm-fg);
    background: var(--pm-bg);
    -webkit-font-smoothing: antialiased;
  }
  .pm-wrap { padding: 16px; }
  .pm-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .pm-logo { height: 28px; width: auto; max-width: 140px; object-fit: contain; border-radius: 6px; }
  .pm-title { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
  .pm-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .pm-tag {
    font-size: 11.5px; font-weight: 600; padding: 3px 10px; border-radius: 999px;
    background: var(--pm-chip-bg); color: var(--pm-accent);
  }
  .pm-card {
    background: var(--pm-card-bg);
    border: 1px solid var(--pm-card-border);
    border-radius: var(--pm-radius);
    padding: 14px;
  }
  .pm-stars { color: var(--pm-accent); font-size: 14px; letter-spacing: 1px; }
  .pm-text { font-size: 14px; line-height: 1.5; margin: 6px 0 10px; }
  .pm-meta { font-size: 12px; opacity: 0.75; display: flex; gap: 6px; flex-wrap: wrap; }
  .pm-empty { text-align: center; padding: 28px 16px; opacity: 0.7; font-size: 14px; }
  /* wall */
  .pm-grid {
    display: grid;
    gap: var(--pm-gap);
    /* min(260px, 100%) keeps a single card from exceeding the container on
       phones — a bare minmax(260px, 1fr) overflows when the viewport is
       narrower than 260px + padding. */
    grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
  }
  /* carousel — swipeable, snapping row */
  .pm-carousel {
    display: flex; gap: var(--pm-gap); overflow-x: auto; padding-bottom: 8px;
    scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch;
  }
  .pm-carousel { cursor: grab; }
  .pm-carousel.pm-dragging { cursor: grabbing; scroll-snap-type: none; }
  .pm-carousel.pm-dragging .pm-card { pointer-events: none; }
  .pm-carousel .pm-card { flex: 0 0 min(300px, 82vw); scroll-snap-align: start; }
  /* marquee — continuous auto-scroll ticker, pauses on hover. Duration scales with
     the card count (see --pm-marquee-dur) so it stays slow regardless of volume. */
  .pm-marquee { overflow: hidden; }
  .pm-marquee-track {
    display: flex; gap: var(--pm-gap); width: max-content;
    animation: pm-scroll var(--pm-marquee-dur, 90s) linear infinite;
  }
  .pm-marquee:hover .pm-marquee-track { animation-play-state: paused; }
  .pm-marquee .pm-card { flex: 0 0 min(300px, 82vw); }
  @keyframes pm-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) {
    .pm-marquee-track { animation: none; }
  }
  /* hero — one large featured review at a time, auto-rotating */
  .pm-hero { display: grid; }
  .pm-hero-slide { display: none; grid-area: 1 / 1; justify-content: center; animation: pm-fade 0.5s ease; }
  .pm-hero-slide.active { display: flex; }
  @keyframes pm-fade { from { opacity: 0; } to { opacity: 1; } }
  .pm-hero .pm-card { max-width: 640px; width: 100%; text-align: center; padding: 28px 26px; }
  .pm-hero .pm-stars { display: flex; justify-content: center; font-size: 18px; }
  .pm-hero .pm-text { font-size: 20px; line-height: 1.55; }
  .pm-hero .pm-meta { justify-content: center; }
  /* wall "Load more" — the grid can't lazy-load on scroll (iframe auto-grows), so
     it pages via this button instead. Removed once the pool is exhausted. */
  .pm-more {
    display: block; margin: 16px auto 0; padding: 8px 18px; cursor: pointer;
    font: inherit; font-size: 13px; font-weight: 600; color: var(--pm-fg);
    background: var(--pm-card-bg); border: 1px solid var(--pm-card-border);
    border-radius: 999px;
  }
  .pm-more:hover { border-color: var(--pm-accent); }
  .pm-more:disabled { opacity: 0.6; cursor: default; }
  .pm-foot {
    margin-top: 12px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.55;
    text-align: right;
  }
  .pm-foot a { color: inherit; text-decoration: none; border-bottom: 1px dotted currentColor; }
</style>
</head>
<body>
  <div class="pm-wrap pm-v-${escapeHtml(variant)}" data-pm-config="${escapeHtml(configUrl)}">
    ${theme.showLogo && logoUrl ? `<div class="pm-head"><img class="pm-logo" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(title)}" /><span class="pm-title">${escapeHtml(title)}</span></div>` : ''}
    ${tagsRow}
    ${body}
    <div class="pm-foot">Captured via <a href="https://${escapeHtml(env.VITE_REVIEWS_PRODESK_ORIGIN)}" target="_blank" rel="noopener">Prodesk Reviews</a></div>
  </div>
  <script>
    (function(){
      try {
        var send = function(){
          var h = document.documentElement.scrollHeight;
          parent.postMessage({ type: 'pm:resize', height: h }, '*');
        };
        new ResizeObserver(send).observe(document.body);
        window.addEventListener('load', send);
      } catch (e) { /* no-op */ }

      // Carousel: lazy-loads pages of reviews on horizontal scroll (cursor-based, so
      // the initial payload stays small), then loops seamlessly once the pool is dry.
      // Also supports click-and-drag (trackpad/touch already work via overflow-x).
      try {
        var car = document.querySelector('[data-pm-carousel]');
        if (car) {
          var reviewsUrl = car.getAttribute('data-pm-reviews-url') || '';
          var cursor = car.getAttribute('data-pm-cursor') || '';
          // Exhausted = nothing more to fetch. Without a URL or cursor we already hold
          // the whole pool, so we can enable the loop immediately.
          var exhausted = !reviewsUrl || !cursor;
          var loading = false;

          // Infinite loop: once the pool is fully loaded, clone the set so scrolling
          // wraps seamlessly in both directions instead of dead-ending at the last card.
          // We keep three copies and snap scrollLeft back by one "period" (the width of
          // one copy incl. gap) whenever it crosses an edge — the copy there is
          // identical, so the jump is invisible. Enabled ONLY after exhaustion so we
          // don't clone a partial set that's still growing.
          var loopReady = false, period = 0;
          var setupLoop = function(){
            if (loopReady || !exhausted || !car.children.length) return;
            if (car.scrollWidth <= car.clientWidth + 4) return; // fits — no loop needed
            var setWidth = car.scrollWidth; // width of one copy (before cloning)
            var cs = getComputedStyle(car);
            var gap = parseFloat(cs.columnGap || cs.gap || '0') || 0;
            period = setWidth + gap; // distance between equivalent points in adjacent copies
            var startPos = car.scrollLeft; // preserve where the user already is
            var originals = Array.prototype.slice.call(car.children);
            for (var c = 0; c < 2; c++) {
              for (var i = 0; i < originals.length; i++) car.appendChild(originals[i].cloneNode(true));
            }
            // If untouched, start in the middle copy so both directions have room; if the
            // loop was enabled mid-scroll (pool just exhausted), stay put — no jump.
            car.scrollLeft = startPos > 4 ? startPos : period;
            loopReady = true;
          };

          var loadMore = function(){
            if (loading || exhausted || !reviewsUrl) return;
            loading = true;
            fetch(reviewsUrl + '?cursor=' + encodeURIComponent(cursor) + '&limit=8')
              .then(function(r){ return r.ok ? r.json() : null; })
              .then(function(data){
                loading = false;
                if (!data) { exhausted = true; setupLoop(); return; }
                if (data.cards && data.cards.length) {
                  car.insertAdjacentHTML('beforeend', data.cards.join(''));
                }
                cursor = data.nextCursor || '';
                if (!cursor) { exhausted = true; setupLoop(); }
                else fillViewport(); // keep pulling until the row overflows
              })
              .catch(function(){ loading = false; exhausted = true; setupLoop(); });
          };
          // While still paging, top up until the cards actually overflow the viewport
          // (otherwise a short first page would never trigger a scroll to load more).
          var fillViewport = function(){
            if (exhausted || loopReady) return;
            if (car.scrollWidth <= car.clientWidth + 4) loadMore();
          };

          window.addEventListener('load', function(){ exhausted ? setupLoop() : fillViewport(); });
          exhausted ? setupLoop() : fillViewport();

          var down = false, startX = 0, startLeft = 0, moved = false;
          car.addEventListener('pointerdown', function(e){
            down = true; moved = false; startX = e.clientX; startLeft = car.scrollLeft;
            car.classList.add('pm-dragging');
          });
          window.addEventListener('pointermove', function(e){
            if (!down) return;
            var dx = e.clientX - startX;
            if (Math.abs(dx) > 3) moved = true;
            var target = startLeft - dx;
            // Pre-wrap the target (and the drag origin) so we never hit the scroll
            // clamp at 0 / max mid-drag — keeps the loop continuous while dragging.
            if (loopReady) {
              while (target <= 0) { target += period; startLeft += period; }
              while (target >= period * 2) { target -= period; startLeft -= period; }
            }
            car.scrollLeft = target;
          });
          var end = function(){ down = false; car.classList.remove('pm-dragging'); };
          window.addEventListener('pointerup', end);
          window.addEventListener('pointercancel', end);

          car.addEventListener('scroll', function(){
            if (loopReady) {
              // Looping phase: wrap at the edges (drag pre-wraps its own target above).
              if (down) return;
              if (car.scrollLeft <= 0) car.scrollLeft += period;
              else if (car.scrollLeft >= period * 2) car.scrollLeft -= period;
            } else if (!exhausted) {
              // Paging phase: prefetch when within ~1.5 viewports of the end.
              if (car.scrollLeft + car.clientWidth * 1.5 >= car.scrollWidth) loadMore();
            }
          }, { passive: true });
        }
      } catch (e) { /* no-op */ }

      // Wall: page in more reviews via a "Load more" button (a grid has no internal
      // scroll to lazy-load against — the iframe auto-grows to its content height).
      try {
        var grid = document.querySelector('[data-pm-grid][data-pm-reviews-url]');
        var moreBtn = document.querySelector('[data-pm-more]');
        if (grid && moreBtn) {
          var gUrl = grid.getAttribute('data-pm-reviews-url') || '';
          var gCursor = grid.getAttribute('data-pm-cursor') || '';
          var gLoading = false;
          moreBtn.addEventListener('click', function(){
            if (gLoading || !gCursor || !gUrl) return;
            gLoading = true; moreBtn.disabled = true; moreBtn.textContent = 'Loading…';
            fetch(gUrl + '?cursor=' + encodeURIComponent(gCursor) + '&limit=12')
              .then(function(r){ return r.ok ? r.json() : null; })
              .then(function(data){
                gLoading = false;
                if (!data) { moreBtn.remove(); return; }
                if (data.cards && data.cards.length) {
                  grid.insertAdjacentHTML('beforeend', data.cards.join(''));
                }
                gCursor = data.nextCursor || '';
                if (!gCursor) moreBtn.remove();
                else { moreBtn.disabled = false; moreBtn.textContent = 'Load more'; }
              })
              .catch(function(){ gLoading = false; moreBtn.remove(); });
          });
        }
      } catch (e) { /* no-op */ }

      // Hero: auto-rotate through the featured reviews.
      try {
        var hero = document.querySelector('[data-pm-hero]');
        if (hero) {
          var slides = hero.querySelectorAll('.pm-hero-slide');
          if (slides.length > 1) {
            var idx = 0;
            setInterval(function(){
              slides[idx].classList.remove('active');
              idx = (idx + 1) % slides.length;
              slides[idx].classList.add('active');
              var h = document.documentElement.scrollHeight;
              parent.postMessage({ type: 'pm:resize', height: h }, '*');
            }, 5000);
          }
        }
      } catch (e) { /* no-op */ }
    })();
  </script>
</body>
</html>`;
}

export function renderLockedHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>Locked</title>
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f7f6f1;color:#1a1a1a;text-align:center;padding:24px}p{max-width:420px;font-size:14px;line-height:1.5}small{display:block;margin-top:8px;opacity:.6}</style></head>
<body><div><p>${escapeHtml(message)}<small>Powered by Prodesk Reviews</small></p></div></body></html>`;
}
