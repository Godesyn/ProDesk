/**
 * Brand accent swatches — exact color codes ported from the Flutter
 * `kAccentSwatches` (theme_accent_service.dart). Forest is the default. The
 * agency branding picker offers these presets; selecting one stores its hex in
 * the agency's uiPreferences.accentColor.
 */
export interface AccentSwatch { name: string; hex: string }

export const ACCENT_SWATCHES: AccentSwatch[] = [
  { name: 'Forest', hex: '#2E9E58' }, // default
  { name: 'Sunbeam', hex: '#FFC83D' },
  { name: 'Coral', hex: '#FF6F61' },
  { name: 'Magenta', hex: '#E0418C' },
  { name: 'Violet', hex: '#7C5CFF' },
  { name: 'Indigo', hex: '#3B5BFE' },
  { name: 'Sky', hex: '#36B3F9' },
  { name: 'Teal', hex: '#14B8A6' },
  { name: 'Volt', hex: '#D9F542' },
  { name: 'Sand', hex: '#C8A977' },
  { name: 'Slate', hex: '#64748B' },
  { name: 'Rose', hex: '#F43F5E' },
];

export const DEFAULT_ACCENT_HEX = '#2E9E58';

/** Relative luminance → readable on-accent foreground (matches AppColors.onAccent). */
export function onAccent(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return lum > 0.5 ? '#0e0e0c' : '#ffffff';
}

/** 7-shade lightness ramp for the preview strip (mirrors Flutter _ShadePreview). */
export function shadeRamp(hex: string): string[] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = ((g - b) / d) % 6;
    else if (max === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }
  const lBase = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * lBase - 1));
  return [0.92, 0.82, 0.68, 0.5, 0.36, 0.24, 0.14].map((l) => hslToHex(hue, s, l));
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}
