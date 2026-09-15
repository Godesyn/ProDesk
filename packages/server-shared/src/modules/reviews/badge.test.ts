/**
 * Unit tests for the "Verdiict Verified" directory badge: the query-string
 * theme contract (sanitize ⇄ serialise) and the variant/palette branches of the
 * renderer. Pure functions — no DB.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BADGE_THEME,
  badgeBox,
  badgeThemeQuery,
  sanitizeBadgeTheme,
  type ReviewBadgeTheme,
} from './badge-theme.js';
import { renderBadgeHtml } from './badge-render.js';

const BASE = {
  name: 'Acme Detailing',
  avgRating: 4.8,
  reviewCount: 132,
  profileUrl: 'https://verdiict.com/directory/acme',
  isBestInIndustry: true,
  industry: 'Car Detailing',
};

describe('sanitizeBadgeTheme', () => {
  it('falls back to the default theme for junk input', () => {
    expect(sanitizeBadgeTheme(undefined)).toEqual(DEFAULT_BADGE_THEME);
    expect(sanitizeBadgeTheme('nope')).toEqual(DEFAULT_BADGE_THEME);
    expect(sanitizeBadgeTheme({ variant: 'dropdown', mode: 'neon', size: 'xl' })).toEqual(
      DEFAULT_BADGE_THEME,
    );
  });

  it('accepts the short query-string keys an iframe URL carries', () => {
    const theme = sanitizeBadgeTheme({
      v: 'seal',
      m: 'dark',
      s: 'lg',
      al: 'left',
      a: 'ff0044',
      st: '0',
      c: '0',
      b: '0',
    });
    expect(theme).toEqual({
      variant: 'seal',
      mode: 'dark',
      size: 'lg',
      align: 'left',
      accentColor: '#ff0044',
      showLogo: true,
      showStars: false,
      showCount: false,
      showBest: false,
    });
  });

  it('rejects a non-hex accent rather than injecting it into the CSS', () => {
    expect(sanitizeBadgeTheme({ a: 'red;}body{display:none' }).accentColor).toBe(
      DEFAULT_BADGE_THEME.accentColor,
    );
    expect(sanitizeBadgeTheme({ accentColor: '#GGGGGG' }).accentColor).toBe(
      DEFAULT_BADGE_THEME.accentColor,
    );
    expect(sanitizeBadgeTheme({ accentColor: '#1A2B3C' }).accentColor).toBe('#1a2b3c');
  });

  it('round-trips through badgeThemeQuery, omitting defaults', () => {
    expect(badgeThemeQuery(DEFAULT_BADGE_THEME)).toBe('');

    const theme: ReviewBadgeTheme = {
      variant: 'compact',
      mode: 'auto',
      size: 'sm',
      align: 'left',
      accentColor: '#123456',
      showLogo: true,
      showStars: true,
      showCount: false,
      showBest: true,
    };
    const query = badgeThemeQuery(theme);
    expect(query).toBe('v=compact&m=auto&s=sm&al=left&a=123456&c=0');

    const parsed = Object.fromEntries(new URLSearchParams(query));
    expect(sanitizeBadgeTheme(parsed)).toEqual(theme);
  });
});

describe('badgeBox', () => {
  it('scales with the size and leaves room for the best-in-industry pill', () => {
    const md = badgeBox({ ...DEFAULT_BADGE_THEME, showBest: false });
    const lg = badgeBox({ ...DEFAULT_BADGE_THEME, size: 'lg', showBest: false });
    expect(lg.width).toBeGreaterThan(md.width);
    expect(lg.height).toBeGreaterThan(md.height);
    expect(badgeBox(DEFAULT_BADGE_THEME).height).toBeGreaterThan(md.height);
  });
});

describe('renderBadgeHtml', () => {
  it('defaults to the light card and reports its height to the host page', () => {
    const html = renderBadgeHtml(BASE);
    expect(html).toContain('class="badge v-card"');
    expect(html).toContain('Acme Detailing');
    expect(html).toContain('4.8');
    expect(html).toContain('132 reviews');
    expect(html).toContain("pm:resize");
    // Light-only: no prefers-color-scheme override.
    expect(html).not.toContain('prefers-color-scheme: dark');
  });

  it('renders each variant with its own root class', () => {
    for (const variant of ['card', 'compact', 'inline', 'seal'] as const) {
      const html = renderBadgeHtml({
        ...BASE,
        theme: { ...DEFAULT_BADGE_THEME, variant },
      });
      expect(html).toContain(`class="badge v-${variant}"`);
    }
  });

  it('emits a prefers-color-scheme block only in auto mode', () => {
    const auto = renderBadgeHtml({ ...BASE, theme: { ...DEFAULT_BADGE_THEME, mode: 'auto' } });
    const dark = renderBadgeHtml({ ...BASE, theme: { ...DEFAULT_BADGE_THEME, mode: 'dark' } });
    expect(auto).toContain('prefers-color-scheme: dark');
    expect(dark).not.toContain('prefers-color-scheme: dark');
    expect(dark).toContain('--bg: #17150f');
  });

  it('honours the row toggles', () => {
    const html = renderBadgeHtml({
      ...BASE,
      theme: {
        ...DEFAULT_BADGE_THEME,
        showStars: false,
        showCount: false,
        showBest: false,
      },
    });
    expect(html).not.toContain('class="stars"');
    expect(html).not.toContain('132 reviews');
    expect(html).not.toContain('Best in Car Detailing');
  });

  it('hides the best-in-industry pill when the brand does not rank', () => {
    const html = renderBadgeHtml({ ...BASE, isBestInIndustry: false });
    expect(html).not.toContain('Best in Car Detailing');
  });

  it('applies the size scale and accent colour', () => {
    const html = renderBadgeHtml({
      ...BASE,
      theme: { ...DEFAULT_BADGE_THEME, size: 'lg', accentColor: '#ff0044' },
    });
    expect(html).toContain('--s: 1.2');
    expect(html).toContain('--accent: #ff0044');
  });

  it('escapes the business name and profile URL', () => {
    const html = renderBadgeHtml({
      ...BASE,
      name: '<script>alert(1)</script>',
      profileUrl: 'https://x.test/"onload="alert(1)',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('"onload="');
  });

  it('shows an em dash instead of 0.0 before the first review', () => {
    const html = renderBadgeHtml({ ...BASE, avgRating: 0, reviewCount: 0 });
    expect(html).toContain('—');
    expect(html).toContain('0 reviews');
  });

  it('leads with the brand logo when one is on file', () => {
    const html = renderBadgeHtml({ ...BASE, logoUrl: 'https://cdn.test/acme.png' });
    expect(html).toContain('class="mark logo"');
    expect(html).toContain('src="https://cdn.test/acme.png"');
    // The checkmark stays in the markup as the onerror fallback.
    expect(html).toContain('class="tick"');
  });

  it('falls back to the checkmark without a logo or with showLogo off', () => {
    const noLogo = renderBadgeHtml(BASE);
    expect(noLogo).toContain('class="mark check"');
    expect(noLogo).not.toContain('class="mark logo"');

    const toggledOff = renderBadgeHtml({
      ...BASE,
      logoUrl: 'https://cdn.test/acme.png',
      theme: { ...DEFAULT_BADGE_THEME, showLogo: false },
    });
    expect(toggledOff).toContain('class="mark check"');
    expect(toggledOff).not.toContain('cdn.test/acme.png');
  });

  it('rejects non-http(s) logo URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//cdn.test/x.png']) {
      const html = renderBadgeHtml({ ...BASE, logoUrl: bad });
      expect(html).toContain('class="mark check"');
      expect(html).not.toContain('class="mark logo"');
    }
  });
});
