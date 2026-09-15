import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useTRPC } from '../lib/trpc';
import { toastError } from '../lib/errors';
import { useCurrentUser } from './auth-context';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { permissionLabel } from '../pages/agency/constants';

/**
 * In-app pending-invitation prompt shown on every frontend's workspace.
 *
 * When an existing user has been invited as staff, we don't wait for them to
 * click the email link — the moment they land on a workspace we pop the pending
 * invitation so they can accept or decline in place. Each frontend passes the
 * permissions that are meaningful to it (`relevantPermissions`) and/or the org
 * type it serves (`relevantOrgType`); an invitation is only surfaced here when it
 * actually grants access this frontend can use, so a reviews-only invite never
 * nags a links user, and vice-versa.
 *
 * "Ignore" is intentionally soft: it only dismisses for the current visit (kept
 * in component state, which resets on reload / next sign-in), so the prompt
 * reappears next time the user lands on the workspace — exactly the requested
 * behaviour. Accept/Decline are terminal and clear the invitation server-side.
 *
 * Mount ONCE inside the authenticated workspace render (it renders nothing until
 * there's a relevant pending invite, so it's safe to leave mounted).
 */
export function PendingInvitePrompt({
  relevantPermissions,
  relevantOrgType,
}: {
  /** Permissions this frontend can use; omit to treat every invite as relevant. */
  relevantPermissions?: readonly string[];
  /** Restrict to invitations for this org type (e.g. brand-only frontends). */
  relevantOrgType?: 'agency' | 'brand';
}) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { isAuthenticated, data: user } = useCurrentUser();
  // Dismissed-this-visit set. In-memory on purpose — resets on reload / next
  // login so an ignored invite pops again next time they land here.
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());

  const invites = useQuery({
    ...trpc.staff.myPendingInvitations.queryOptions(),
    enabled: !!isAuthenticated && !!user?.isEmailVerified && !!user?.role,
  });

  const relevantSet = useMemo(
    () => (relevantPermissions ? new Set<string>(relevantPermissions) : null),
    [relevantPermissions],
  );

  const invite = useMemo(() => {
    const items = invites.data ?? [];
    return items.find((i) => {
      if (dismissed.has(i.id)) return false;
      if (relevantOrgType && i.orgType !== relevantOrgType) return false;
      // No permission filter → any invite is relevant. Otherwise the invite must
      // grant at least one permission this frontend actually uses.
      if (relevantSet && !i.permissions.some((p) => relevantSet.has(p))) return false;
      return true;
    });
  }, [invites.data, dismissed, relevantOrgType, relevantSet]);

  const refetch = () => {
    qc.invalidateQueries({ queryKey: trpc.staff.myPendingInvitations.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() });
    qc.invalidateQueries({ queryKey: trpc.auth.contextOptions.queryKey() });
  };

  const accept = useMutation({
    ...trpc.staff.accept.mutationOptions(),
    onSuccess: () => {
      toast.success('Invitation accepted');
      refetch();
    },
    onError: (e) => toastError(e),
  });
  const reject = useMutation({
    ...trpc.staff.reject.mutationOptions(),
    onSuccess: () => {
      toast.success('Invitation declined');
      refetch();
    },
    onError: (e) => toastError(e),
  });

  if (!invite) return null;
  const busy = accept.isPending || reject.isPending;

  return (
    <Dialog
      open
      // Backdrop click / Esc = ignore (soft dismiss); pops again next visit.
      onOpenChange={(open) => {
        if (!open && !busy) setDismissed((prev) => new Set(prev).add(invite.id));
      }}
    >
      <DialogContent className="max-w-md" hideClose>
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent/10">
            <UserPlus className="h-5 w-5 text-accent" />
          </div>
          <DialogTitle className="text-center">You've been invited</DialogTitle>
          <DialogDescription className="text-center">
            <span className="font-medium text-ink-100">{invite.invitedByName}</span> invited you to
            join <span className="font-medium text-ink-100">{invite.orgName}</span> as{' '}
            {invite.orgType === 'agency' ? 'agency' : 'brand'} staff.
          </DialogDescription>
        </DialogHeader>

        {invite.permissions.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-[0.06em] text-ink-40">
              Permissions
            </p>
            <div className="flex flex-wrap gap-1">
              {invite.permissions.map((p) => (
                <Badge key={p} variant="muted">
                  {permissionLabel(p)}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setDismissed((prev) => new Set(prev).add(invite.id))}
          >
            Ignore
          </Button>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" disabled={busy} onClick={() => reject.mutate({ id: invite.id })}>
              {reject.isPending ? 'Declining…' : 'Decline'}
            </Button>
            <Button variant="accent" disabled={busy} onClick={() => accept.mutate({ id: invite.id })}>
              {accept.isPending ? 'Accepting…' : 'Accept'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
