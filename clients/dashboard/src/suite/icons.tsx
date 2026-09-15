/* Prodesk Suite — icon set (ported from icons.jsx).
   House style: 24-grid, 2px stroke, round caps/joins, no fills, currentColor. */

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { appTile, type SuiteApp } from './data';

const ICON_PATHS: Record<string, ReactNode> = {
  brand: (
    <g>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <circle cx="9" cy="9.5" r="2.2" />
      <path d="M4.5 19l5-5 3.5 3 3-2.5 3.5 3" />
    </g>
  ),
  product: (
    <g>
      <path d="M12 3l8 4.2v9.6L12 21l-8-4.2V7.2L12 3z" />
      <path d="M4 7.4l8 4.1 8-4.1" />
      <path d="M12 11.5V21" />
    </g>
  ),
  password: (
    <g>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
      <circle cx="12" cy="15" r="1.3" />
    </g>
  ),
  signature: (
    <g>
      <path d="M4 16.5c2.5 0 3-7 4.6-7 1.2 0 .8 5.5 2.2 5.5 1.6 0 2-6.5 3.6-6.5 1.3 0 1.1 4.5 2.3 4.5 1 0 1.3-1.5 1.3-1.5" />
      <path d="M4 20h16" />
    </g>
  ),
  qr: (
    <g>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <path d="M14 14h2.5v2.5M20 14v.01M14 20h6M20 17.5V20" />
    </g>
  ),
  ooh: (
    <g>
      <rect x="3.5" y="4.5" width="17" height="10.5" rx="1.5" />
      <path d="M7 8.5h6.5M7 11h4" />
      <path d="M12 15v4.5M8.5 19.5h7" />
    </g>
  ),
  reviews: (
    <g>
      <path d="M12 4l2.35 4.76 5.25.77-3.8 3.7.9 5.23L12 16.9l-4.7 2.46.9-5.23-3.8-3.7 5.25-.77L12 4z" />
    </g>
  ),
  raated: (
    <g>
      <circle
        cx="12"
        cy="12"
        r="8.5"
        strokeDasharray="46 8"
        transform="rotate(-90 12 12)"
      />
      <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
    </g>
  ),
  proposals: (
    <g>
      <path d="M6.5 3.5h7L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5z" />
      <path d="M13 3.5V8h4.5" />
      <path d="M11.5 11.2c-1.6-.5-2.6.9-1.4 1.7.7.5 2 .4 2 1.4 0 .9-1.3 1.3-2.6.7M11 10.3v.9M11 15.5v.9" />
    </g>
  ),
  calendar: (
    <g>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 9.5h16M8 3.5v4M16 3.5v4" />
      <path d="M8 13h2v2H8z" fill="currentColor" stroke="none" />
    </g>
  ),
  crm: (
    <g>
      <circle cx="8.5" cy="9" r="2.6" />
      <path d="M3.5 19c.8-2.7 2.7-4 5-4s4.2 1.3 5 4" />
      <path d="M15.5 6.5a2.4 2.4 0 0 1 0 4.8M17 19c-.2-1.6-.8-2.9-1.8-3.8 2 .1 3.5 1.4 4.3 3.8" />
    </g>
  ),
  social: (
    <g>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="17" cy="6.5" r="2.4" />
      <circle cx="17" cy="17.5" r="2.4" />
      <path d="M8.1 10.9l6.8-3.3M8.1 13.1l6.8 3.3" />
    </g>
  ),
  advice: (
    <g>
      <path d="M9 17.5h6M9.7 20h4.6" />
      <path d="M12 3.5a6 6 0 0 1 3.8 10.6c-.5.4-.8 1-.8 1.6H9c0-.6-.3-1.2-.8-1.6A6 6 0 0 1 12 3.5z" />
    </g>
  ),
  image: (
    <g>
      <rect x="4" y="4.5" width="16" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="M5 17l4-3.5 3 2.3 3-3L19 16" />
    </g>
  ),
  printer: (
    <g>
      <path d="M7 8.5V4.5h10v4" />
      <rect x="4" y="8.5" width="16" height="8" rx="1.5" />
      <rect x="7" y="14" width="10" height="5.5" rx="1" />
      <path d="M16.5 11.5h.01" />
    </g>
  ),
  dam: (
    <g>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 14.5l4.5-4 3.5 3 3-2.5 6 5" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="M3.5 9.5h3M3.5 14.5h17" />
    </g>
  ),
  marketplace: (
    <g>
      <path d="M4 9.5l1.2-4A1.5 1.5 0 0 1 6.65 4.5h10.7a1.5 1.5 0 0 1 1.45 1L20 9.5" />
      <path d="M4 9.5h16v0a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-5 0v0z" />
      <path d="M5.5 11.6V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-7.4" />
      <path d="M10 20v-4.5h4V20" />
    </g>
  ),
  document: (
    <g>
      <path d="M6.5 3.5h7L18 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5A1.5 1.5 0 0 1 6.5 3.5z" />
      <path d="M13 3.5V8h4.5" />
      <path d="M8.5 12.5h7M8.5 15.5h7M8.5 18h4" />
    </g>
  ),
  email: (
    <g>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
    </g>
  ),
  tasks: (
    <g>
      <path d="M4 6.4l1.4 1.4L8 5.2" />
      <path d="M4 12.4l1.4 1.4L8 11.2" />
      <path d="M4.2 18h.01" />
      <path d="M11 6.5h9M11 12.5h9M11 18h6" />
    </g>
  ),
  talent: (
    <g>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M3.8 19c.7-2.8 2.9-4.3 5.7-4.3 1 0 1.9.2 2.7.55" />
      <circle cx="16.5" cy="15.5" r="4" />
      <path d="M16.5 13.6V15.5l1.3 1.3" />
    </g>
  ),
  sparkle: (
    <g>
      <path d="M11 3.5l1.7 4.8 4.8 1.7-4.8 1.7L11 16.5l-1.7-4.8L4.5 10l4.8-1.7L11 3.5z" />
      <path d="M18 14.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
    </g>
  ),
  strategy: (
    <g>
      <path d="M5 20V6.5a1.5 1.5 0 0 1 1.5-1.5H10l1.5 1.6H18a1 1 0 0 1 1 1V9" />
      <path d="M12 12.5l2.2 4.5 1.4-2 2.2-.4-3-2.6-2.8.5z" />
      <circle cx="12" cy="12.5" r="6.5" />
    </g>
  ),
  fractional: (
    <g>
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M4 19c.7-2.9 2.9-4.6 5.5-4.6 1 0 1.9.25 2.7.7" />
      <circle cx="16.5" cy="15.5" r="4" />
      <path d="M16.5 13.6V15.5l1.4.9" />
    </g>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  arrowur: <path d="M7 17L17 7M9 7h8v8" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  collapse: <path d="M14 8l-4 4 4 4M19 5v14" />,
  pin: <path d="M9 4h6l-1 6 3 3H7l3-3-1-6zM12 16v4" />,
  help: (
    <g>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.4a2.4 2.4 0 0 1 4.6.9c0 1.6-2.2 1.9-2.2 3.4M12 16.6v.01" />
    </g>
  ),
  lifebuoy: (
    <g>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
    </g>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  search: (
    <g>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </g>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  lock: (
    <g>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </g>
  ),
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  more: (
    <g>
      <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </g>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  external: (
    <g>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </g>
  ),
  building: (
    <g>
      <path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h7A1.5 1.5 0 0 1 15 5.5V20" />
      <path d="M15 9h3.5A1.5 1.5 0 0 1 20 10.5V20" />
      <path d="M3.5 20h17M8 8h3M8 12h3M8 16h3" />
    </g>
  ),
  user: (
    <g>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5" />
    </g>
  ),
  team: (
    <g>
      <circle cx="9" cy="9" r="2.6" />
      <path d="M3.5 19c.8-2.7 2.7-4 5.5-4s4.7 1.3 5.5 4" />
      <circle cx="17" cy="7.5" r="2" />
      <path d="M16 13.4c2 .1 3.6 1.4 4.4 3.6" />
    </g>
  ),
  billing: (
    <g>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M7 14.5h3" />
    </g>
  ),
  settings: (
    <g>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.5M12 18.5V21M21 12h-2.5M5.5 12H3M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8M18.4 18.4l-1.8-1.8M7.4 7.4L5.6 5.6" />
    </g>
  ),
  logout: (
    <g>
      <path d="M14 7V5.5A1.5 1.5 0 0 0 12.5 4h-6A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20h6a1.5 1.5 0 0 0 1.5-1.5V17" />
      <path d="M10 12h10M17 9l3 3-3 3" />
    </g>
  ),
  warning: (
    <g>
      <path d="M12 4l9 15.5H3L12 4z" />
      <path d="M12 10v4.5M12 17.2v.01" />
    </g>
  ),
  grid: (
    <g>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </g>
  ),
  link: (
    <g>
      <path d="M10 14a4 4 0 0 0 5.7 0l2.5-2.5a4 4 0 0 0-5.7-5.7L11 7.3" />
      <path d="M14 10a4 4 0 0 0-5.7 0L5.8 12.5a4 4 0 0 0 5.7 5.7L13 16.7" />
    </g>
  ),
  shield: (
    <g>
      <path d="M12 3.5l7 2.5v5c0 4.2-2.9 7.7-7 9-4.1-1.3-7-4.8-7-9V6l7-2.5z" />
      <path d="M9 12l2 2 4-4" />
    </g>
  ),
  bell: (
    <g>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </g>
  ),
};

export interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  className?: string;
  style?: CSSProperties;
}

export function Icon({
  name,
  size = 20,
  stroke = 2,
  className = '',
  style = {},
}: IconProps) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

/* WordmarkTile — a coloured "app icon" square with the app/brand name in it.
   If the app supplies a real logo image we render it, falling back to the
   coloured wordmark tile if the image fails to load. */
export function WordmarkTile({
  app,
  size = 76,
  radius = 18,
}: {
  app?: Partial<SuiteApp> | null;
  size?: number;
  radius?: number;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  if (app && app.logo && !imgFailed) {
    return (
      <img
        src={app.logo}
        alt={app.name || ''}
        loading="eager"
        onError={() => setImgFailed(true)}
        style={{
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'cover',
          flexShrink: 0,
          display: 'block',
        }}
      />
    );
  }
  const t = appTile(app);
  const len = (t.wm || '').length;
  const ratio =
    len <= 4
      ? 0.25
      : len <= 6
        ? 0.188
        : len <= 8
          ? 0.146
          : len <= 10
            ? 0.121
            : len <= 12
              ? 0.103
              : 0.09;
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: t.bg,
        color: t.fg,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 9%',
        boxSizing: 'border-box',
      }}
    >
      <span
        style={{
          fontWeight: 800,
          fontSize: Math.round(size * ratio),
          letterSpacing: '0.01em',
          lineHeight: 1,
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          fontFamily: 'var(--font)',
        }}
      >
        {t.wm}
      </span>
    </span>
  );
}
