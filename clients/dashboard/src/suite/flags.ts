/* Prodesk Suite — feature gating.
   ─────────────────────────────────────────────────────────────────────────
   The suite ships ahead of its backend, so a single master flag (HIDE_WIP)
   hides everything that isn't wired to real data yet. Graduate a feature by
   adding its id to LIVE_APPS / flipping it in LIVE_FEATURES — no other change
   needed. Set HIDE_WIP = false to reveal everything at once (e.g. in staging).

   "Live" means: opens a real, data-backed screen (not the front-door placeholder)
   and its actions actually persist.
   ───────────────────────────────────────────────────────────────────────── */

export const HIDE_WIP = true;

/** App ids (see data.ts APPS) whose in-suite experience is fully implemented. */
export const LIVE_APPS: readonly string[] = [
  'strategy', // Growth strategy    → StrategyTool screen
  'brand-hub', // Brand kit         → BrandKitTool (brands.* + signatures.brands.*)
  'people', // Team & people       → staff.*
  'info-hub', // Company info       → brands.update (+ policies/locations/gst)
  'product-hub', // Services → services.* (via the brand's derived agency)
  'url-qr', // Links & QR          → standalone Links/Adeyy frontend (cross-app hand-off)
  'quotes', // Quick quotes      → standalone Payments/EziQuotes frontend (in-suite modal)
  'reviews', // Customer reviews   → standalone Reviews/Verdiict frontend (cross-app hand-off)
  'signatures', // Email signatures → standalone Signatures/SIGKITT frontend (cross-app hand-off)
  'logo', // Logo Studio         → standalone Logo frontend (in-suite modal)
  'documents', // Docs & files     → files.* (Tabs+Folders locker screen)

  // ── Coming soon (visible but badge-gated via comingSoon on data.ts) ──
  'password-hub', // Keymastr Password vault
  'proposals', // Proposals
  'downsizer', // Resize & convert
  'crm', // Sales CRM
  'talent', // Labour hire
  'advice', // Expert advice
  'whunda', // Digital marketing (Specialist)
  'sqeze', // Bookkeeping (Specialist)
  'servint', // HR & recruiting (Specialist)
];

/** Non-app shell features, gated independently of the app catalogue. */
export const LIVE_FEATURES = {
  brandSwitcher: true, // brands.mine + auth.switchContext
  addBrand: true, // brands.create
  businessHealth: true, // brands.dashboardStats KPIs
  commandPalette: true, // search across live apps/brands/actions
  accountSettings: true, // users.* + billing.*
  team: true, // staff.* (same screen as People)
  // --- not yet implemented ---
  pinning: true, // sidebar "Your apps" pinning (persisted to localStorage)
  strategistChat: true, // right-rail AI strategist → brand AI thread (same flow as Growth strategy)
  // --- not yet implemented ---
  personalApps: false, // roadmap (Aggyl, Inbox, Pay…)
} as const;

export type FeatureKey = keyof typeof LIVE_FEATURES;

/** Is this app's real screen available (or are we showing everything)? */
export function isAppLive(id: string): boolean {
  return !HIDE_WIP || LIVE_APPS.includes(id);
}

/** Is this shell feature available (or are we showing everything)? */
export function isFeatureLive(key: FeatureKey): boolean {
  return !HIDE_WIP || LIVE_FEATURES[key];
}
