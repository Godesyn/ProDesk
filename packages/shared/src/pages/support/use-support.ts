/**
 * Headless data hooks for the customer Support feature, shared by every
 * frontend's NATIVE Support screen. They wrap the `trpc.support.*` procedures
 * with TanStack Query and own only cache correctness (what to invalidate) — the
 * presentation, toasts, and error UI belong to each frontend's own page so it can
 * match that app's look. Every frontend already provides the shared tRPC context
 * (`@shared/lib/trpc`), so these work everywhere.
 *
 * Tickets are creator-scoped on the server: a user only ever sees their own.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTRPC, useTRPCClient } from '../../lib/trpc';
import { collectSupportDiagnostics } from './diagnostics';
import type {
  SupportAttachment,
  TicketCategory,
  TicketPriority,
} from './model';

/**
 * `support.create` input as callers supply it — diagnostics are added for them.
 * Mirrors the server input (routers/support.ts) minus the auto-injected
 * `diagnostics`; kept as a hand-written shape so the shared package needn't
 * depend on `@trpc/server` types (frontends don't resolve it).
 */
type CreateTicketInput = {
  subject: string;
  category?: TicketCategory;
  priority?: TicketPriority;
  body: string;
  contactEmail?: string;
  attachments?: SupportAttachment[];
};

/** The caller's tickets, newest activity first. */
export function useSupportTickets() {
  const trpc = useTRPC();
  return useQuery(trpc.support.list.queryOptions({ limit: 50, offset: 0 }));
}

/** A single ticket with its comment thread. */
export function useSupportTicket(id: string) {
  const trpc = useTRPC();
  return useQuery(trpc.support.get.queryOptions({ id }));
}

/**
 * Create a ticket. Refreshes the list on success; caller handles toast/nav.
 * Browser diagnostics (origin URL, device info, console tail) are captured here
 * and sent with every ticket, so no frontend has to wire them up itself.
 */
export function useCreateSupportTicket() {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const qc = useQueryClient();
  return useMutation({
    mutationKey: trpc.support.create.mutationKey(),
    mutationFn: (input: CreateTicketInput) =>
      client.support.create.mutate({ ...input, diagnostics: collectSupportDiagnostics() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.support.list.queryKey() });
    },
  });
}

/** Reply to a ticket. Refreshes the thread AND the list (updatedAt/status move). */
export function useSupportReply(ticketId: string) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  return useMutation({
    ...trpc.support.reply.mutationOptions(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: trpc.support.get.queryKey({ id: ticketId }) });
      qc.invalidateQueries({ queryKey: trpc.support.list.queryKey() });
    },
  });
}
