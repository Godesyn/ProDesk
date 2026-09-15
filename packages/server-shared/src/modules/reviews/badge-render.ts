/**
 * Server-rendered HTML for the public "Verdiict Verified" directory badge
 * iframe. Originally ported from the Manus export's badgeRoutes.ts render path
 * (the hosted wordmark image is replaced with an inline text wordmark).
 *
 * Self-contained (inline CSS, no network requests) so it can be framed on any
 * origin, and driven entirely by a `ReviewBadgeTheme` — four layouts, a
 * light/dark/auto palette, three sizes, an accent colour and per-row toggles.
 * Every length is `calc(… * var(--s))` off a single size scale, so a variant is
 * described once and all three sizes fall out of it.
 *
 * The document sizes itself to its content and posts `pm:resize` to the parent
 * (same contract as the location embed in embed-render.ts), so the install
 * snippet's iframe tracks the badge instead of clipping it at a fixed height.
 */
import {
  BADGE_SCALE,
  DEFAULT_BADGE_THEME,
  type ReviewBadgeTheme,
} from './badge-theme.js';

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STAR_PATH = 'M12 2l2.9 6.6 7.1.7-5.5 4.8 1.7 6.9L12 17.3l-6.2 3.7 1.7-6.9L2 9.3l7.1-.7z';

function renderStars(rating: number, max = 5): string {
  const filled = Math.round(rating);
  return Array.from({ length: max })
    .map(
      (_, i) =>
        `<svg class="star${i < filled ? '' : ' off'}" viewBox="0 0 24 24" aria-hidden="true"><path d="${STAR_PATH}"/></svg>`,
    )
    .join('');
}

const CHECK_SVG =
  '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.5L6.5 12L13 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const LIGHT_VARS = `
  --bg: #ffffff;
  --fg: #1a1612;
  --muted: #7c6f5e;
  --sub: #9c8f7e;
  --line: #e8e0d0;
  --hair: #f0ebe2;
  --star-off: #d9d2c6;
  --best-bg: #f0fdf4;
  --best-line: #86efac;
  --best-fg: #166534;
  --shadow: 0 2px 12px rgba(11,15,10,0.08);
  --shadow-hv: 0 4px 18px rgba(11,15,10,0.14);`;

const DARK_VARS = `
  --bg: #17150f;
  --fg: #f6f2e9;
  --muted: #a79b89;
  --sub: #8d8272;
  --line: #322d25;
  --hair: #262119;
  --star-off: #3d3730;
  --best-bg: #0d2417;
  --best-line: #1f5133;
  --best-fg: #6ee7a5;
  --shadow: 0 2px 14px rgba(0,0,0,0.45);
  --shadow-hv: 0 4px 20px rgba(0,0,0,0.6);`;

/** Palette block for the chosen mode; `auto` follows the host page. */
function paletteCss(mode: ReviewBadgeTheme['mode']): string {
  if (mode === 'dark') return `:root {${DARK_VARS}\n  }`;
  if (mode === 'light') return `:root {${LIGHT_VARS}\n  }`;
  return `:root {${LIGHT_VARS}\n  }
  @media (prefers-color-scheme: dark) { :root {${DARK_VARS}\n  } }`;
}

export function renderBadgeHtml(opts: {
  name: string;
  avgRating: number;
  reviewCount: number;
  profileUrl: string;
  isBestInIndustry: boolean;
  industry: string;
  /** Brand logo; leads the badge when present and `theme.showLogo` is on. */
  logoUrl?: string | null;
  theme?: ReviewBadgeTheme;
}): string {
  const { name, avgRating, reviewCount, profileUrl, isBestInIndustry, industry } = opts;
  const theme = opts.theme ?? DEFAULT_BADGE_THEME;
  const scale = BADGE_SCALE[theme.size];
  // Bleed room so the card shadow isn't sheared off by the iframe edge. `inline`
  // has no shadow, so it stays flush and reads as part of the host's text flow.
  const bleed = theme.variant === 'inline' ? 2 : 10;

  const ratingDisplay = avgRating > 0 ? avgRating.toFixed(1) : '—';
  const reviewLabel = reviewCount === 1 ? '1 review' : `${reviewCount} reviews`;
  const showBest = theme.showBest && isBestInIndustry;
  const bestLabel = `Best in ${industry}`;

  const stars = theme.showStars ? `<span class="stars">${renderStars(avgRating)}</span>` : '';
  const count = theme.showCount ? `<span class="count">${escapeHtml(reviewLabel)}</span>` : '';
  // Built from the parts that are actually visible, so the accessible name never
  // announces a row the badge is configured to hide.
  const ariaLabel = [
    name,
    avgRating > 0 ? `${ratingDisplay} out of 5` : null,
    theme.showCount ? reviewLabel : null,
    showBest ? bestLabel : null,
    'verified on Verdiict',
  ]
    .filter(Boolean)
    .join(' — ');

  // The badge leads with the brand's own logo. Only http(s) is allowed through,
  // and a logo that fails to load swaps itself back to the Verdiict checkmark so
  // the badge never renders with an empty hole where the mark should be.
  const logoUrl =
    typeof opts.logoUrl === 'string' && /^https?:\/\//i.test(opts.logoUrl.trim())
      ? opts.logoUrl.trim()
      : null;
  const mark =
    theme.showLogo && logoUrl
      ? `<span class="mark logo">
      <img src="${escapeHtml(logoUrl)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('failed');this.remove()" />
      <span class="tick">${CHECK_SVG}</span>
    </span>`
      : `<span class="mark check">${CHECK_SVG}</span>`;

  const bestPill = showBest
    ? `<span class="best">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1l2 4.5 5 .5-3.5 3.5 1 5L8 12l-4.5 2.5 1-5L1 6l5-.5z"/></svg>
      ${escapeHtml(bestLabel)}
    </span>`
    : '';

  let body: string;
  switch (theme.variant) {
    case 'compact':
      body = `${mark}
    <span class="col">
      <span class="rating">
        <span class="num">${escapeHtml(ratingDisplay)}</span>
        ${stars}
      </span>
      <span class="sub">
        ${count}
        ${count ? '<span class="dot">·</span>' : ''}
        <span class="wordmark">Verdiict Verified</span>
      </span>
      ${bestPill}
    </span>`;
      break;

    case 'inline':
      body = `${mark}
    <span class="num">${escapeHtml(ratingDisplay)}</span>
    ${stars}
    ${count}
    <span class="dot">·</span>
    <span class="wordmark">Verdiict Verified</span>
    ${showBest ? `<span class="dot">·</span><span class="best-text">${escapeHtml(bestLabel)}</span>` : ''}`;
      break;

    case 'seal':
      body = `<span class="seal">
      ${mark}
      <span class="num">${escapeHtml(ratingDisplay)}</span>
      ${stars}
      <span class="wordmark">Verdiict Verified</span>
      ${count}
    </span>
    ${bestPill}`;
      break;

    case 'card':
    default:
      body = `<span class="head">
      ${mark}
      <span class="name">${escapeHtml(name)}</span>
    </span>
    ${
      theme.showStars || theme.showCount
        ? `<span class="rating">
      <span class="num">${escapeHtml(ratingDisplay)}</span>
      ${stars}
      ${count}
    </span>`
        : ''
    }
    ${bestPill}
    <span class="foot">
      <span class="foot-text">Verified on</span>
      <span class="wordmark">Verdiict</span>
    </span>`;
      break;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(name)} · Verdiict Verified</title>
<style>
  ${paletteCss(theme.mode)}
  :root {
    --s: ${scale};
    --accent: ${theme.accentColor};
    --star: #f59e0b;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: transparent; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    display: flex;
    align-items: flex-start;
    justify-content: ${theme.align === 'center' ? 'center' : 'flex-start'};
    padding: calc(${bleed}px * var(--s));
    -webkit-font-smoothing: antialiased;
  }
  .badge {
    text-decoration: none;
    color: var(--fg);
    cursor: pointer;
    max-width: 100%;
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }
  .badge:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

  /* Shared atoms */
  /* .mark is the leading tile: the brand's logo, or the Verdiict checkmark when
     there's no logo on file, logos are switched off, or the image 404s. */
  .mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: calc(22px * var(--s));
    height: calc(22px * var(--s));
    border-radius: calc(5px * var(--s));
    flex-shrink: 0;
    overflow: hidden;
  }
  .mark svg { width: calc(12px * var(--s)); height: calc(12px * var(--s)); }
  .mark.check { background: var(--accent); color: #ffffff; }
  /* Logos are usually transparent PNGs drawn in a dark ink, so they need a light
     plate to stay legible — including when the badge itself is in dark mode. */
  .mark.logo {
    background: #ffffff;
    border: 1px solid var(--line);
    padding: calc(2px * var(--s));
  }
  .mark.logo img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .mark.logo .tick { display: none; }
  .mark.logo.failed {
    background: var(--accent);
    border-color: transparent;
    color: #ffffff;
  }
  .mark.logo.failed .tick { display: inline-flex; }
  .dot { color: var(--star-off); font-size: calc(11px * var(--s)); }
  .stars { display: inline-flex; align-items: center; gap: calc(1px * var(--s)); }
  .star {
    width: calc(14px * var(--s));
    height: calc(14px * var(--s));
    fill: var(--star);
    display: block;
  }
  .star.off { fill: var(--star-off); }
  .num {
    font-size: calc(18px * var(--s));
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .count { font-size: calc(11px * var(--s)); color: var(--muted); }
  .wordmark {
    font-size: calc(10px * var(--s));
    font-weight: 700;
    color: var(--fg);
    letter-spacing: -0.01em;
    opacity: 0.72;
  }
  .best {
    display: inline-flex;
    align-items: center;
    gap: calc(4px * var(--s));
    background: var(--best-bg);
    border: 1px solid var(--best-line);
    border-radius: 999px;
    padding: calc(2px * var(--s)) calc(8px * var(--s));
    font-size: calc(10px * var(--s));
    font-weight: 600;
    color: var(--best-fg);
    letter-spacing: 0.02em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .best svg {
    width: calc(10px * var(--s));
    height: calc(10px * var(--s));
    fill: currentColor;
  }

  /* Variant: card — the full stacked badge. */
  .v-card {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    gap: calc(6px * var(--s));
    width: 100%;
    min-width: calc(190px * var(--s));
    max-width: calc(300px * var(--s));
    background: var(--bg);
    border: 1.5px solid var(--line);
    border-radius: calc(14px * var(--s));
    padding: calc(13px * var(--s)) calc(16px * var(--s));
    box-shadow: var(--shadow);
  }
  .v-card:hover { box-shadow: var(--shadow-hv); transform: translateY(-1px); }
  .v-card .head {
    display: flex;
    align-items: center;
    gap: calc(8px * var(--s));
    width: 100%;
    min-width: 0;
  }
  .v-card .name {
    font-size: calc(13px * var(--s));
    font-weight: 600;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    flex: 1;
    min-width: 0;
  }
  .v-card .rating {
    display: flex;
    align-items: center;
    gap: calc(6px * var(--s));
    flex-wrap: wrap;
  }
  .v-card .foot {
    display: flex;
    align-items: center;
    gap: calc(5px * var(--s));
    width: 100%;
    margin-top: calc(2px * var(--s));
    padding-top: calc(4px * var(--s));
    border-top: 1px solid var(--hair);
  }
  .v-card .foot-text { font-size: calc(10px * var(--s)); color: var(--sub); }

  /* Variant: compact — a small two-line block for headers and footers. The
     business name is dropped (the badge sits on their own site) so this stays
     narrow; everything wraps rather than spilling out of the iframe. */
  .v-compact {
    display: inline-flex;
    align-items: center;
    gap: calc(10px * var(--s));
    max-width: 100%;
    background: var(--bg);
    border: 1.5px solid var(--line);
    border-radius: calc(14px * var(--s));
    padding: calc(9px * var(--s)) calc(14px * var(--s));
    box-shadow: var(--shadow);
  }
  .v-compact:hover { box-shadow: var(--shadow-hv); transform: translateY(-1px); }
  .v-compact .mark { border-radius: 999px; }
  .v-compact .col {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: calc(3px * var(--s));
    min-width: 0;
  }
  .v-compact .rating {
    display: flex;
    align-items: center;
    gap: calc(5px * var(--s));
  }
  .v-compact .num { font-size: calc(15px * var(--s)); }
  .v-compact .sub {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: calc(4px * var(--s));
  }
  .v-compact .best { margin-top: calc(3px * var(--s)); }

  /* Variant: inline — bare text, no card chrome. Sits in a sentence or footer. */
  .v-inline {
    display: inline-flex;
    align-items: center;
    gap: calc(5px * var(--s));
    flex-wrap: wrap;
    padding: calc(2px * var(--s)) 0;
  }
  .v-inline .mark {
    width: calc(15px * var(--s));
    height: calc(15px * var(--s));
    border-radius: 999px;
  }
  .v-inline .mark svg { width: calc(9px * var(--s)); height: calc(9px * var(--s)); }
  .v-inline .num { font-size: calc(13px * var(--s)); }
  .v-inline .star { width: calc(12px * var(--s)); height: calc(12px * var(--s)); }
  .v-inline .best-text {
    font-size: calc(10px * var(--s));
    font-weight: 600;
    color: var(--best-fg);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .v-inline:hover .wordmark { text-decoration: underline; }

  /* Variant: seal — a round stamp for hero sections and sidebars. */
  .v-seal {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: calc(8px * var(--s));
  }
  .v-seal .seal {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(3px * var(--s));
    width: calc(148px * var(--s));
    height: calc(148px * var(--s));
    padding: calc(12px * var(--s));
    border-radius: 50%;
    text-align: center;
    background: var(--bg);
    border: calc(2px * var(--s)) solid var(--accent);
    box-shadow: var(--shadow);
    transition: box-shadow 0.15s ease, transform 0.15s ease;
  }
  .v-seal:hover .seal { box-shadow: var(--shadow-hv); transform: translateY(-1px); }
  .v-seal .mark {
    width: calc(26px * var(--s));
    height: calc(26px * var(--s));
    border-radius: 999px;
  }
  .v-seal .num { font-size: calc(28px * var(--s)); }
  .v-seal .wordmark {
    font-size: calc(9px * var(--s));
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.85;
  }
  .v-seal .count { font-size: calc(10px * var(--s)); }

  @media (prefers-reduced-motion: reduce) {
    .badge, .v-seal .seal { transition: none; }
    .badge:hover, .v-seal:hover .seal { transform: none; }
  }
</style>
</head>
<body>
<a class="badge v-${theme.variant}" href="${escapeHtml(profileUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(ariaLabel)}">
    ${body}
</a>
<script>
  (function(){
    // Report our real height to the host page so the snippet's iframe tracks the
    // badge (variant, wrapped name, host font size) instead of clipping it.
    try {
      var send = function(){
        parent.postMessage({
          type: 'pm:resize',
          height: Math.ceil(document.documentElement.scrollHeight),
        }, '*');
      };
      new ResizeObserver(send).observe(document.body);
      window.addEventListener('load', send);
      send();
    } catch (e) { /* no-op */ }
  })();
</script>
</body>
</html>`;
}
