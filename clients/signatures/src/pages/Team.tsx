/*
 * SIGKITT — Team for the brand selected in the side-panel context switcher (this
 * page has no brand picker of its own; see clients/signatures/src/app/context).
 * Brand staff are ONE team shared across every Prodesk frontend,
 * so this page lists ALL the brand's teammates — including people invited from
 * another tool (Links, Reviews, Payments, …) who don't yet have Signatures access
 * — and lets a manager grant/revoke this tool's access without leaving the app.
 * Signatures has a SINGLE role: access = "can manage signatures" (there is no
 * read-only viewer). Other brand permissions stay managed in Prodesk. Inviting a
 * brand-new teammate here seeds them with Signatures access. Listing/managing
 * requires `staffManagement` (owners always qualify), so the whole page is gated
 * on it. Mirrors clients/reviews' Team; see docs/permissions.md "Cross-frontend
 * team". Uses the SIGKITT shadcn UI kit + the local `trpc` client.
 */
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { UserPlus, Users } from 'lucide-react';
import { useSignaturesContext } from '../app/context';
import { trpc } from '../lib/trpc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
const EMAIL_RE = /.+@.+\..+/;

/** The teammate currently being acted on in a dialog (minimal, re-render safe). */
type ManagedMember = {
  id: string;
  email: string;
  permissions: readonly string[];
};

/** True when the staff member can manage signatures (the tool's single role). */
const hasSignatures = (perms: readonly string[]) =>
  perms.includes('signatures');
/** Strip the signatures permission, keeping everything else (revokes access). */
const withoutSignatures = (perms: readonly string[]) =>
  perms.filter((p) => p !== 'signatures');

export default function TeamPage() {
  // The brand comes from the side-panel context selector — this page used to own
  // a second brand picker of its own, which is exactly the duplication the
  // context selector removes. `canManage` is derived from the ACTIVE brand's own
  // membership, so switching brands re-gates the page.
  const { brandId: selectedBrandId, activeBrand } = useSignaturesContext();
  const utils = trpc.useUtils();

  const canManage =
    !!activeBrand &&
    (activeBrand.isOwner ||
      activeBrand.permissions.includes('staffManagement'));

  const [inviting, setInviting] = useState(false);
  const [email, setEmail] = useState('');
  // Two-step removal in ONE dialog: `managing` opens it; `confirmRemove` swaps
  // its contents from the "Remove access / Remove team member" choice to the
  // whole-suite confirmation. Keeping a single dialog mounted (rather than
  // closing one and opening another) avoids the Radix overlay/pointer-events
  // race that leaves the page unclickable.
  const [managing, setManaging] = useState<ManagedMember | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const closeManage = () => {
    setManaging(null);
    setConfirmRemove(false);
  };

  const list = trpc.staff.list.useQuery(
    { orgType: 'brand', orgId: selectedBrandId!, limit: 100, offset: 0 },
    { enabled: canManage && !!selectedBrandId },
  );

  const invalidate = () => utils.staff.list.invalidate();

  const invite = trpc.staff.invite.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Invite sent to ' + email.trim());
      setInviting(false);
      setEmail('');
    },
    onError: (e) => toast.error(e.message),
  });
  const updatePermissions = trpc.staff.updatePermissions.useMutation({
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.staff.remove.useMutation({
    onSuccess: () => {
      invalidate();
      toast.success('Removed.');
    },
    onError: (e) => toast.error(e.message),
  });

  // Show EVERY current teammate (not just those with signatures access). Removed
  // rows are soft-deleted (status→'removed') but keep their permissions array, so
  // exclude them explicitly.
  const members = useMemo(
    () => (list.data?.items ?? []).filter((m) => m.status !== 'removed'),
    [list.data],
  );

  const setPermissions = (id: string, permissions: string[]) =>
    updatePermissions.mutate({ id, permissions: permissions as never });

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0E0E0C]">
            Team
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Grant Signatures access to{' '}
            {activeBrand ? (
              <span className="font-medium text-[#0E0E0C]">
                {activeBrand.businessName}
              </span>
            ) : (
              'your brand'
            )}
            &rsquo;s teammates. They can build signatures for every department.
          </p>
        </div>
        {canManage && (
          <Button
            className="shrink-0 bg-primary text-[#0E0E0C] hover:bg-primary/85"
            onClick={() => setInviting(true)}
          >
            <UserPlus className="h-4 w-4" />
            Invite
          </Button>
        )}
      </div>

      {!canManage ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-semibold text-[#0E0E0C]">
            Team is managed by owners.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            You need the Team Management permission to invite or manage
            teammates.
          </p>
        </div>
      ) : list.isLoading ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center text-muted-foreground">
          Loading…
        </div>
      ) : members.length === 0 ? (
        <div className="rounded-xl border border-[#0E0E0C]/10 p-10 text-center">
          <Users className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 font-semibold text-[#0E0E0C]">No teammates yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite someone to share the signatures workspace.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#0E0E0C]/10 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Signatures access</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const can = hasSignatures(m.permissions);
                const name = [m.firstName, m.lastName]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">
                      {name || (
                        <span className="text-muted-foreground">Invited</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.email}
                    </TableCell>
                    <TableCell>
                      {can ? (
                        <Badge className="bg-primary text-[#0E0E0C] hover:bg-primary">
                          Can manage
                        </Badge>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={updatePermissions.isPending}
                          onClick={() =>
                            setPermissions(m.id, [
                              ...m.permissions,
                              'signatures',
                            ])
                          }
                        >
                          Grant access
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {m.status === 'active' ? 'Active' : 'Invite sent'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={
                          updatePermissions.isPending || remove.isPending
                        }
                        onClick={() => {
                          setManaging({
                            id: m.id,
                            email: m.email,
                            permissions: m.permissions,
                          });
                          // No per-app access to remove → jump straight to the
                          // whole-team removal confirmation.
                          setConfirmRemove(!can);
                        }}
                      >
                        Remove{can ? ' access' : ''}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={inviting} onOpenChange={setInviting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite to Signatures</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            They&rsquo;ll get an email to join this brand&rsquo;s signatures
            workspace and will be able to manage signature brands, members and
            campaigns.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sig-invite-email">Email</Label>
            <Input
              id="sig-invite-email"
              autoFocus
              placeholder="name@business.com.au"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setInviting(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary text-[#0E0E0C] hover:bg-primary/85"
              disabled={
                !EMAIL_RE.test(email) || invite.isPending || !selectedBrandId
              }
              onClick={() =>
                invite.mutate({
                  orgType: 'brand',
                  orgId: selectedBrandId!,
                  email: email.trim(),
                  permissions: ['signatures'] as never,
                })
              }
            >
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One dialog, two steps: the choice, then (for whole-team removal) an
          explicit whole-suite confirmation. Content swaps in place. */}
      <Dialog
        open={!!managing}
        onOpenChange={(o) => {
          if (!o) closeManage();
        }}
      >
        <DialogContent>
          {confirmRemove ? (
            <>
              <DialogHeader>
                <DialogTitle>Remove team member?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {managing?.email} will be removed from this brand — you&rsquo;ll
                be removing their access to all of the Prodesk suite, not just
                Signatures.
              </p>
              <DialogFooter>
                <Button variant="ghost" onClick={closeManage}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (managing) remove.mutate({ id: managing.id });
                    closeManage();
                  }}
                >
                  Remove team member
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Remove access</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                {managing?.email} — choose what to remove.
              </p>
              <div className="flex flex-col gap-3 py-1">
                <button
                  type="button"
                  disabled={updatePermissions.isPending}
                  className="rounded-lg border border-[#0E0E0C]/12 px-4 py-3 text-left transition-colors hover:bg-muted disabled:opacity-50"
                  onClick={() => {
                    if (managing)
                      setPermissions(
                        managing.id,
                        withoutSignatures(managing.permissions),
                      );
                    closeManage();
                  }}
                >
                  <div className="font-medium text-[#0E0E0C]">
                    Remove Signatures access
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Stays on the team — loses this app only
                  </div>
                </button>
                <button
                  type="button"
                  disabled={remove.isPending}
                  className="rounded-lg border border-destructive/25 px-4 py-3 text-left transition-colors hover:bg-destructive/5 disabled:opacity-50"
                  onClick={() => setConfirmRemove(true)}
                >
                  <div className="font-medium text-destructive">
                    Remove team member
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Removes them from the whole Prodesk suite
                  </div>
                </button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

