/**
 * SIGKITT — Core Types & Template Definitions.
 *
 * The pure types + template/typography catalogues now live in the shared package
 * (`@shared/signatures`) so the dashboard Brand Kit and this app render from one
 * source. They are re-exported here so existing `./signatureTypes` imports keep
 * working. The localStorage-backed workspace / brand-template helpers below are
 * client-only (they touch browser storage and the undo/redo hook).
 */
export * from '@shared/signatures';

import type { SignatureData } from '@shared/signatures';
import type { HistoryEnvelope } from '@/hooks/useUndoRedoState';

// ─── Saved Signatures (Workspaces) ────────────────────────────────────────────
// Each saved signature is a "workspace" with its own undo/redo stack.

export interface SavedSignature {
  id: string;
  name: string;
  savedAt: string;
  data: SignatureData;
  /** Full undo/redo stack for this workspace. Missing on legacy entries. */
  envelope?: HistoryEnvelope<SignatureData>;
}

/**
 * Saved signatures are BRAND-LEVEL: each brand keeps its own set of workspaces
 * and its own "which one is open", so switching brands in the context selector
 * switches the whole studio rather than carrying the last brand's work across.
 *
 * The keys are therefore suffixed with the brand id. `setSavedSignatureScope` is
 * called once from the app shell whenever the active brand changes; the very
 * first call also migrates whatever lives under the old un-scoped keys into that
 * brand, so nobody loses the work they had open before departments shipped.
 */
const SAVED_KEY_BASE = 'sig_studio_saved';
const ACTIVE_WORKSPACE_KEY_BASE = 'sig_studio_active_workspace';
const MIGRATED_KEY = 'sig_studio_scope_migrated';

let scopeBrandId: string | null = null;

const scoped = (base: string, brandId = scopeBrandId) =>
  brandId ? `${base}::${brandId}` : base;

/**
 * Point the saved-signature store at a brand. Safe to call on every render —
 * it no-ops unless the brand actually changed.
 */
export function setSavedSignatureScope(brandId: string | null): void {
  if (scopeBrandId === brandId) return;
  scopeBrandId = brandId;
  if (!brandId) return;
  try {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    // One-time adoption of the pre-departments, un-scoped store.
    const legacySaved = localStorage.getItem(SAVED_KEY_BASE);
    if (legacySaved && !localStorage.getItem(scoped(SAVED_KEY_BASE))) {
      safeSetItem(scoped(SAVED_KEY_BASE), legacySaved);
    }
    const legacyActive = localStorage.getItem(ACTIVE_WORKSPACE_KEY_BASE);
    if (legacyActive && !localStorage.getItem(scoped(ACTIVE_WORKSPACE_KEY_BASE))) {
      safeSetItem(scoped(ACTIVE_WORKSPACE_KEY_BASE), legacyActive);
    }
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    // Storage unavailable (private mode) — the studio still works in memory.
  }
}

/** Read another brand's saved signatures — used by the "Copy from" picker. */
export function loadSavedSignaturesForBrand(brandId: string): SavedSignature[] {
  try {
    return JSON.parse(localStorage.getItem(scoped(SAVED_KEY_BASE, brandId)) || '[]');
  } catch {
    return [];
  }
}

/**
 * localStorage.setItem that never throws. Base64 images (photo/logo/banner) make
 * these payloads large, and a QuotaExceededError here is uncaught and blanks the
 * whole app. Returns false on failure so callers can fall back to a smaller write.
 */
function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function loadSavedSignatures(): SavedSignature[] {
  try {
    return JSON.parse(localStorage.getItem(scoped(SAVED_KEY_BASE)) || '[]');
  } catch {
    return [];
  }
}

/** Save a new workspace entry with its undo/redo envelope. */
export function saveSignature(
  name: string,
  data: SignatureData,
  envelope?: HistoryEnvelope<SignatureData>,
): SavedSignature {
  const saved = loadSavedSignatures();
  const entry: SavedSignature = {
    id: `sig_${Date.now()}`,
    name,
    savedAt: new Date().toISOString(),
    data,
    envelope,
  };
  saved.unshift(entry);
  safeSetItem(scoped(SAVED_KEY_BASE), JSON.stringify(saved.slice(0, 20))); // max 20
  return entry;
}

export function deleteSavedSignature(id: string): void {
  const saved = loadSavedSignatures().filter(s => s.id !== id);
  localStorage.setItem(scoped(SAVED_KEY_BASE), JSON.stringify(saved));
}

export function renameSavedSignature(id: string, name: string): void {
  const saved = loadSavedSignatures().map(s => {
    if (s.id === id) {
      return { ...s, name };
    }
    return s;
  });
  localStorage.setItem(scoped(SAVED_KEY_BASE), JSON.stringify(saved));
}

/** Update just the flat data snapshot of a workspace (for display/preview). */
export function updateSavedSignature(id: string, data: SignatureData): void {
  const saved = loadSavedSignatures().map(s => {
    if (s.id === id) {
      return {
        ...s,
        savedAt: new Date().toISOString(),
        data,
      };
    }
    return s;
  });
  safeSetItem(scoped(SAVED_KEY_BASE), JSON.stringify(saved));
}

/** Update the full envelope (undo/redo stack + current data) of a workspace. */
export function updateSavedSignatureEnvelope(
  id: string,
  envelope: HistoryEnvelope<SignatureData>,
): void {
  const currentData = envelope.history[envelope.currentIndex];
  const saved = loadSavedSignatures().map(s => {
    if (s.id === id) {
      return {
        ...s,
        savedAt: new Date().toISOString(),
        data: currentData,
        envelope,
      };
    }
    return s;
  });
  if (safeSetItem(scoped(SAVED_KEY_BASE), JSON.stringify(saved))) return;
  // Quota exceeded — the full undo envelope (up to 50 states, each carrying every
  // base64 image) is what blows the budget. Persist the current data without the
  // heavy history so the workspace still saves; drop the envelope rather than crash.
  const slim = saved.map(s => (s.id === id ? { ...s, envelope: undefined } : s));
  safeSetItem(scoped(SAVED_KEY_BASE), JSON.stringify(slim));
}

// ─── Active Workspace ID (localStorage) ──────────────────────────────────────

export function getActiveWorkspaceId(): string | null {
  return localStorage.getItem(scoped(ACTIVE_WORKSPACE_KEY_BASE));
}

export function setActiveWorkspaceId(id: string | null): void {
  if (id) {
    localStorage.setItem(scoped(ACTIVE_WORKSPACE_KEY_BASE), id);
  } else {
    localStorage.removeItem(scoped(ACTIVE_WORKSPACE_KEY_BASE));
  }
}

// ─── Brand Templates ──────────────────────────────────────────────────────────
export interface BrandTemplate {
  id: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoUrl: string;
  logoWidth: number;
  disclaimer: string;
}

const BRANDS_KEY = 'sig_studio_brands';

export const PRESET_BRANDS: BrandTemplate[] = [
  {
    id: 'brand_tech',
    name: 'Tech Blue',
    primaryColor: '#2563EB',
    secondaryColor: '#7C3AED',
    fontFamily: 'Arial, Helvetica, sans-serif',
    logoUrl: '',
    logoWidth: 120,
    disclaimer: '',
  },
  {
    id: 'brand_green',
    name: 'Eco Green',
    primaryColor: '#059669',
    secondaryColor: '#D97706',
    fontFamily: 'Verdana, Geneva, sans-serif',
    logoUrl: '',
    logoWidth: 120,
    disclaimer: '',
  },
  {
    id: 'brand_slate',
    name: 'Corporate Slate',
    primaryColor: '#334155',
    secondaryColor: '#0EA5E9',
    fontFamily: "'Trebuchet MS', sans-serif",
    logoUrl: '',
    logoWidth: 120,
    disclaimer: '',
  },
  {
    id: 'brand_warm',
    name: 'Warm Amber',
    primaryColor: '#B45309',
    secondaryColor: '#4A7C59',
    fontFamily: 'Georgia, serif',
    logoUrl: '',
    logoWidth: 120,
    disclaimer: '',
  },
];

export function loadBrandTemplates(): BrandTemplate[] {
  try {
    const custom = JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]');
    return [...PRESET_BRANDS, ...custom];
  } catch {
    return PRESET_BRANDS;
  }
}

export function saveBrandTemplate(brand: Omit<BrandTemplate, 'id'>): BrandTemplate {
  const existing = JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]');
  const entry: BrandTemplate = { ...brand, id: `brand_${Date.now()}` };
  existing.unshift(entry);
  safeSetItem(BRANDS_KEY, JSON.stringify(existing.slice(0, 10)));
  return entry;
}

export function deleteBrandTemplate(id: string): void {
  const existing = JSON.parse(localStorage.getItem(BRANDS_KEY) || '[]');
  safeSetItem(BRANDS_KEY, JSON.stringify(existing.filter((b: BrandTemplate) => b.id !== id)));
}
