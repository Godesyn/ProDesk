/**
 * Data layer for the floating feedback panel.
 *
 * Feedback is stored as a support ticket with `source = 'feedback'` (see
 * supportTicketSource in the schema), but nothing about that is visible here or in
 * the UI: the vocabulary is "your feedback" and "our reply", never "ticket",
 * "status" or "priority". Keeping the translation in this one file means a frontend
 * building its own feedback surface can reuse the hooks without re-deriving it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '../lib/trpc';
import { collectSupportDiagnostics } from '../pages/support/diagnostics';

/** How many entries the panel's history shows before "Load more". */
export const FEEDBACK_PAGE_SIZE = 20;

/** One past submission as the panel renders it. */
export type FeedbackEntry = {
  id: string;
  body: string;
  createdAt: Date | string;
  answered: boolean;
  actioned: boolean;
  replies: { body: string; createdAt: Date | string }[];
};

/** The caller's own feedback, newest first. */
export function useMyFeedback(options?: { enabled?: boolean }) {
  const trpc = useTRPC();
  return useQuery({
    ...trpc.support.feedbackList.queryOptions({ limit: FEEDBACK_PAGE_SIZE, offset: 0 }),
    // The panel is mounted app-wide but only fetches once opened — a global
    // component must not add a request to every page load.
    enabled: options?.enabled ?? true,
  });
}

/**
 * Submit feedback. Diagnostics (page URL, viewport, console tail) ride along
 * automatically, exactly as they do for a support ticket: knowing WHICH screen
 * someone was on when they said "this is missing" is most of the value.
 */
export function useSubmitFeedback() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return useMutation({
    ...trpc.support.submitFeedback.mutationOptions(),
    onSuccess: () => {
      // Refresh the history so the new entry appears immediately beneath the form.
      void qc.invalidateQueries({ queryKey: trpc.support.feedbackList.queryKey() });
    },
  });
}

/** `submitFeedback` input with diagnostics attached. */
export function feedbackPayload(body: string) {
  return { body, diagnostics: collectSupportDiagnostics() };
}

/**
 * The single user-facing state word for an entry. Deliberately not the ticket
 * status: someone giving feedback is told whether it was read and acted on, not
 * where it sits in a support queue.
 */
export function feedbackState(entry: FeedbackEntry): {
  label: string;
  tone: 'accent' | 'muted';
} {
  if (entry.actioned) return { label: 'Actioned', tone: 'accent' };
  if (entry.answered) return { label: 'Replied', tone: 'accent' };
  return { label: 'Received', tone: 'muted' };
}

/** Compact relative time ("2h ago", "3d ago") for the history list. */
export function feedbackTime(at: Date | string): string {
  const then = typeof at === 'string' ? new Date(at) : at;
  const diff = Date.now() - then.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
