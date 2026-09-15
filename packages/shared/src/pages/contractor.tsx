import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Building2, Search, MoreHorizontal, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { initialsOf } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { useConfirm } from '../components/ui/confirm-dialog';

const LIMIT = 10;
const STATUS: Record<string, BadgeProps['variant']> = { active: 'success', pendingInvite: 'warn', pendingApplication: 'accent', rejected: 'danger', revoked: 'muted' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', pendingInvite: 'Invite Received', pendingApplication: 'Pending Application', rejected: 'Rejected', revoked: 'Revoked' };

export function ContractorContractsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState<{ id: string; name: string } | null>(null);
  const key = trpc.contractor.myConnections.queryKey();
  const list = useQuery(trpc.contractor.myConnections.queryOptions({ limit: LIMIT, offset }));
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const respond = useMutation({
    ...trpc.connections.respondToContractorInvite.mutationOptions(),
    onSuccess: () => { toast.success('Updated'); invalidate(); },
    onError: (e) => toastError(e),
  });
  const leave = useMutation({
    ...trpc.contractor.leaveAgency.mutationOptions(),
    onSuccess: () => { toast.success('Left agency'); setLeaving(null); invalidate(); },
    onError: (e) => toastError(e),
  });
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader title="My Agencies" description="Manage your agency relationships." />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Briefcase} title="No agency connections yet" description="Apply to agencies to start working." />
        ) : (
          <>
            <Table>
              <TableHeader><TableRow><TableHead>Agency</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">{c.agency.logoUrl && <AvatarImage src={c.agency.logoUrl} />}<AvatarFallback>{initialsOf(c.agency.businessName)}</AvatarFallback></Avatar>
                        <div className="min-w-0">
                          <div className="font-medium text-ink-100">{c.agency.businessName}</div>
                          {c.note && <div className="truncate text-xs italic text-ink-60">“{c.note}”</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant={STATUS[c.status] ?? 'muted'}>{STATUS_LABEL[c.status] ?? c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {c.status === 'pendingInvite' ? (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="accent" onClick={() => respond.mutate({ connectionId: c.id, accept: true })}>Accept</Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={async () => {
                              if (!(await confirm({
                                title: 'Decline invitation?',
                                description: <>Decline the invitation from <span className="font-medium text-ink-100">{c.agency.businessName}</span>? They'd need to invite you again.</>,
                                confirmLabel: 'Decline',
                                destructive: true,
                              }))) return;
                              respond.mutate({ connectionId: c.id, accept: false });
                            }}
                          >Decline</Button>
                        </div>
                      ) : c.status === 'active' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem destructive onClick={() => setLeaving({ id: c.id, name: c.agency.businessName })}><LogOut className="h-4 w-4" /> Leave agency</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3"><Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} /></div>
          </>
        )}
      </Card>

      {/* Confirm before disconnecting — ports contractor_agencies_screen `_confirmLeave`. */}
      <Dialog open={!!leaving} onOpenChange={(o) => { if (!o) setLeaving(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {leaving?.name}?</DialogTitle>
            <DialogDescription>Are you sure you want to disconnect from this agency? You'll lose access to its projects and chats.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLeaving(null)}>Cancel</Button>
            <Button variant="danger" disabled={leave.isPending} onClick={() => leaving && leave.mutate({ connectionId: leaving.id })}>{leave.isPending ? 'Leaving…' : 'Leave'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Contractors can only discover the platform's DEFAULT agencies here (the server
// gates browseAgencies to platformVerified + emailVerified). To work with a non-default
// agency the contractor must be invited by that agency by email.
export function ContractorAgenciesPage() {
  const trpc = useTRPC();
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [applyTo, setApplyTo] = useState<{ id: string; name: string } | null>(null);
  const list = useQuery(trpc.contractor.browseAgencies.queryOptions({ limit: LIMIT, offset, search: search || undefined }));
  // Existing connection status per agency, so a card reflects Applied / Invited /
  // Hired instead of letting the contractor re-apply (ports the apply-dialog guard).
  const mine = useQuery(trpc.contractor.myConnections.queryOptions({ limit: 100, offset: 0 }));
  const statusByAgency = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of mine.data?.items ?? []) if (!m.has(c.agencyId)) m.set(c.agencyId, c.status); // first = most recent (createdAt desc)
    return m;
  }, [mine.data]);
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader title="Find agencies" description="Browse partner agencies and apply." />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
        <Input className="pl-9" placeholder="Search agencies…" value={search} onChange={(e) => { setSearch(e.target.value); setOffset(0); }} />
      </div>
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-36 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Building2} title="No agencies found" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((a) => {
              const status = statusByAgency.get(a.id);
              return (
                <Card key={a.id}>
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-center gap-3">
                      <Avatar>{a.logoUrl && <AvatarImage src={a.logoUrl} />}<AvatarFallback>{initialsOf(a.businessName)}</AvatarFallback></Avatar>
                      <div className="font-medium text-ink-100">{a.businessName}</div>
                    </div>
                    {a.shortDescription && <p className="line-clamp-2 text-sm text-ink-60">{a.shortDescription}</p>}
                    {status === 'active' ? (
                      <Badge variant="success" className="w-fit">Already Hired</Badge>
                    ) : status === 'pendingApplication' ? (
                      <Badge variant="accent" className="w-fit">Already Applied</Badge>
                    ) : status === 'pendingInvite' ? (
                      <Badge variant="warn" className="w-fit">Already Invited</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setApplyTo({ id: a.id, name: a.businessName })}>Apply</Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </>
      )}

      {applyTo && <ApplyToAgencyDialog agency={applyTo} onClose={() => setApplyTo(null)} />}
    </div>
  );
}

/** Apply to an agency with an optional note — ports apply_to_agency_dialog's note field. */
function ApplyToAgencyDialog({ agency, onClose }: { agency: { id: string; name: string }; onClose: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const apply = useMutation({
    ...trpc.contractor.applyToAgency.mutationOptions(),
    onSuccess: () => {
      toast.success('Application sent');
      qc.invalidateQueries({ queryKey: trpc.contractor.myConnections.queryKey() });
      onClose();
    },
    onError: (e) => toastError(e),
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Apply to {agency.name}</DialogTitle>
          <DialogDescription>Share why you want to join this agency. Your application goes to the agency for review.</DialogDescription>
        </DialogHeader>
        <textarea
          className="min-h-[96px] w-full rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm placeholder:text-ink-40"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Share why you want to join this agency…"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="accent" disabled={apply.isPending} onClick={() => apply.mutate({ agencyId: agency.id, note: note.trim() || undefined })}>
            {apply.isPending ? 'Sending…' : 'Send Application'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
