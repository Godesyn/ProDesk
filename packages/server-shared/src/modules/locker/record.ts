import { files } from '../../db/schema.js';
import type { DB } from '../../db/index.js';

/**
 * Document Locker population layer.
 *
 * The locker (`files` table + the brand `documents.tsx` 3-tab UI) is fed
 * automatically from other features: chat attachments, brand logos, completed
 * deliverables, Info Hub file answers, proposal documents, brand-side project
 * brief docs, brand questionnaire answers, and every satellite-app asset upload
 * (Signatures assets, Payments/proposal brand assets, Verdiict review-page
 * logos, Support ticket attachments).
 *
 * The one invariant: a source event ONLY EVER inserts a row. It never updates
 * or deletes a locker row (the sole exception is the Info Hub public toggle,
 * which flips an existing row's visibility flags — see spot.toggleVisibility).
 * Deleting a locker row never touches the source; changing/replacing/deleting a
 * source never removes its locker rows (replaced files stay as history).
 *
 * Idempotency: every derived row carries a (sourceType, sourceId) stamp with a
 * partial unique index. Re-running a hook (a retry, a re-completion, a one-time
 * backfill) is a no-op via ON CONFLICT DO NOTHING. A row the brand deleted
 * locally stays deleted — the unique key blocks resurrection.
 */
export type LockerSourceType =
  | 'chat'
  | 'logo'
  | 'deliverable'
  | 'infohub'
  | 'proposalDoc'
  | 'briefDoc'
  | 'questionnaire'
  /** SIGKITT asset upload (`signatures.upload.file`) — logos, headshots, banners. */
  | 'signatureAsset'
  /** EziQuotes brand-kit asset (`payments.accounts.recordAssetUpload`). */
  | 'paymentsAsset'
  /** Verdiict review-page logo (`reviews.locations.update` with a new logoUrl). */
  | 'reviewsLogo'
  /** Support ticket / reply attachment (`support.create`, `support.reply`). */
  | 'support';

export interface LockerFileInput {
  brandId: string;
  url: string;
  name: string;
  /** Set → lands in Agency Documents (filterable by this agency). Null → brand-owned. */
  agencyId?: string | null;
  /** All agencies this file belongs to (e.g. every agency in a group chat). The
   *  file shows under each of them. Defaults to [agencyId] when omitted. */
  agencyIds?: (string | null | undefined)[] | null;
  projectId?: string | null;
  projectTitle?: string | null;
  agencyWhoUploaded?: string | null;
  uploadedBy?: string | null;
  size?: number | null;
  /** 'image' | 'document' | 'video' | … (free-form, mirrors files.type). */
  type?: string | null;
  /** Provenance label: 'logo' | 'chat' | 'infohub' | 'deliverable' | 'proposal' | 'brief' | 'questionnaire'. */
  category?: string | null;
  /** 'brand' | 'agency' — informational; tab placement is driven by agencyId/isPrivate/isPublic. */
  source?: string | null;
  /** Human-readable provenance shown on hover (why this doc is in the locker). */
  note?: string | null;
  /** Private Documents tab. */
  isPrivate?: boolean;
  /** Public Brand Assets tab (an agency doc with isPublic shows in BOTH tabs). */
  isPublic?: boolean;
  sourceType: LockerSourceType;
  sourceId: string;
}

/**
 * Insert one auto-sourced file into a brand's document locker, deduped on
 * (sourceType, sourceId). Best-effort and idempotent — safe to call from any
 * hook without a guard. Returns true if a row was inserted.
 */
export async function recordLockerFile(db: DB, input: LockerFileInput): Promise<boolean> {
  if (!input.brandId || !input.url) return false;
  // Normalise the agency set: prefer the explicit list, else the single agencyId.
  // agencyId is the primary (first); agencyIds is the full membership.
  const ids = [...new Set((input.agencyIds ?? [input.agencyId]).filter((a): a is string => !!a))];
  const primaryAgencyId = input.agencyId ?? ids[0] ?? null;
  const inserted = await db
    .insert(files)
    .values({
      brandId: input.brandId,
      url: input.url,
      name: input.name || 'Document',
      agencyId: primaryAgencyId,
      agencyIds: ids.length ? ids : null,
      projectId: input.projectId ?? null,
      projectTitle: input.projectTitle ?? null,
      agencyWhoUploaded: input.agencyWhoUploaded ?? null,
      uploadedBy: input.uploadedBy ?? null,
      size: input.size ?? null,
      type: input.type ?? null,
      category: input.category ?? null,
      source: input.source ?? (primaryAgencyId ? 'agency' : 'brand'),
      note: input.note ?? null,
      isPrivate: input.isPrivate ?? false,
      isPublic: input.isPublic ?? false,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
    })
    .onConflictDoNothing()
    .returning({ id: files.id });
  return inserted.length > 0;
}

/**
 * Derive a human file name from a storage URL: the last path segment with the
 * query string stripped and percent-escapes decoded. Falls back when the URL
 * carries no usable name (e.g. an opaque object id).
 */
export function fileNameFromUrl(url: string, fallback = 'Document'): string {
  const last = url.split('/').pop()?.split('?')[0] || '';
  if (!last) return fallback;
  try {
    return decodeURIComponent(last) || fallback;
  } catch {
    return last; // malformed %-sequence — use the raw segment rather than throw
  }
}

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'avi', 'mkv']);

/**
 * Server-side mirror of the client's `kindOf` — classify a file into the
 * free-form `files.type` bucket the locker grid renders from. Accepts a name or
 * a URL; falls back to 'document' when there is no usable extension.
 */
export function fileTypeFromName(name: string | null | undefined): string {
  const last = (name ?? '').split('/').pop()?.split('?')[0] ?? '';
  const i = last.lastIndexOf('.');
  const ext = i >= 0 ? last.slice(i + 1).toLowerCase() : '';
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  return 'document';
}

/**
 * Record a **brand-owned** asset uploaded from a satellite app (Signatures,
 * Payments, Verdiict, …). These land in Public Brand Assets alongside the brand
 * logo: no owning agency, `isPublic` so they stay visible to connected agencies
 * that the brand works with. Append-only — replacing an asset keeps the old one
 * as history, exactly like the logo hook.
 */
export async function recordBrandAsset(
  db: DB,
  input: Omit<LockerFileInput, 'agencyId' | 'agencyIds' | 'isPrivate' | 'isPublic' | 'source' | 'type'> &
    Pick<Partial<LockerFileInput>, 'type'>,
): Promise<boolean> {
  return recordLockerFile(db, {
    ...input,
    type: input.type ?? fileTypeFromName(input.name || input.url),
    source: 'brand',
    isPublic: true,
    isPrivate: false,
  });
}

/** Insert several at once; each is independently deduped. Best-effort. */
export async function recordLockerFiles(db: DB, inputs: LockerFileInput[]): Promise<void> {
  for (const i of inputs) {
    try {
      await recordLockerFile(db, i);
    } catch (err) {
      console.error('[locker] recordLockerFile failed', i.sourceType, i.sourceId, (err as Error).message);
    }
  }
}

/* ── Info Hub helpers ──────────────────────────────────────────────────────
 * Info Hub file answers live as URL(s) in spot_components.answers, keyed by
 * question id. Only file-bearing question types carry locker-worthy files.
 */
export const INFOHUB_FILE_QUESTION_TYPES = new Set(['file_upload', 'carousel', 'cover_photo', 'audio_upload']);

/** Flatten an answer value (string URL or array of URLs) to a clean URL list. */
export function answerUrls(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return [];
}

/* ── Chat helpers ──────────────────────────────────────────────────────────
 * A chat attachment lands in the locker only when the thread involves a brand:
 *  - brand↔agency thread → Agency Documents (agencyId = thread.agencyIds[0])
 *  - brand-only thread    → Private Documents
 * Threads with no brand (agency-only, contractor, inter-agency, platform admin)
 * are skipped.
 *
 * DO NOT add the consumer messenger's 'direct' / 'group' types to either set.
 * Those threads carry `brandId = null` by construction, so the caller's
 * `thread.brandId && …` guard already skips them — but the reason is not that
 * they're unsupported, it's that they have no brand to file into. A photo two
 * people send each other is not a brand document, and mirroring it into an
 * agency's Document Locker would put private correspondence in front of a client.
 */
export const BRAND_AGENCY_THREAD_TYPES = new Set(['all', 'brandAgencyStaff', 'brandAgencyPersonal']);
export const BRAND_ONLY_THREAD_TYPES = new Set(['brandStaff', 'brandPersonal']);

/** Human phrasing of a chat thread kind for the locker provenance note. */
export function chatThreadKindLabel(threadType: string): string {
  switch (threadType) {
    case 'all':
      return 'group chat';
    case 'brandAgencyStaff':
      return 'staff chat';
    case 'brandStaff':
      return 'staff group chat';
    case 'brandAgencyPersonal':
    case 'brandPersonal':
      return 'personal chat';
    default:
      return 'chat';
  }
}
