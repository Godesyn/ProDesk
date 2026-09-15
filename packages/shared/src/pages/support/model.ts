/**
 * Support ticket model — the pure, UI-agnostic pieces shared by every frontend's
 * native Support screen: types, display labels, option lists, time formatting,
 * and the attachment-upload helper. No React or design-system dependencies, so a
 * frontend can import these into a page built in its OWN component kit and reskin
 * the presentation freely. See `use-support.ts` for the matching data hooks.
 */
import { uploadFile } from '../../lib/storage';
import { StorageBucket } from '../../lib/storage-buckets';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type SupportAttachment = { url: string; name: string; size: number };

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TicketCategory =
  | 'general'
  | 'billing'
  | 'technical'
  | 'feature_request'
  | 'account'
  | 'other';

export interface TicketComment {
  id: string;
  authorRole: 'customer' | 'support';
  body: string;
  attachments: SupportAttachment[] | null;
  isInternal: boolean;
  createdAt: string | Date;
}

/* ── Display labels + option lists ─────────────────────────────────────── */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};
export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  general: 'General',
  billing: 'Billing',
  technical: 'Technical',
  feature_request: 'Feature request',
  account: 'Account',
  other: 'Other',
};

export const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as TicketStatus[];
export const PRIORITY_OPTIONS = Object.keys(PRIORITY_LABEL) as TicketPriority[];
export const CATEGORY_OPTIONS = Object.keys(CATEGORY_LABEL) as TicketCategory[];

/* ── Helpers ───────────────────────────────────────────────────────────── */

export function formatTicketTime(value: string | Date): string {
  const d = new Date(value);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Upload one attachment for a ticket and return the `{ url, name, size }` shape
 * the `support.create` / `support.reply` procedures expect. `pathId` is the
 * ticket id, or `'drafts'` before the ticket exists (new-ticket composer).
 */
export async function uploadTicketAttachment(
  pathId: string,
  file: File,
): Promise<SupportAttachment> {
  const url = await uploadFile(StorageBucket.Uploads, `tickets/${pathId}`, file);
  return { url, name: file.name, size: file.size };
}
