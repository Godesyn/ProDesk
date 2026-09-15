import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Plus, MoreHorizontal, UserMinus, Globe, Linkedin, FileText } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { cn, initialsOf } from '../lib/utils';
import { ContractorProfileView, type ContractorDetail } from '../components/profile-views';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { useConfirm } from '../components/ui/confirm-dialog';
import { Field } from './agency/form-bits';

const LIMIT = 10;
const STATUS: Record<string, BadgeProps['variant']> = { active: 'success', pendingApplication: 'warn', pendingInvite: 'accent', rejected: 'danger', revoked: 'muted' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', pendingApplication: 'Application', pendingInvite: 'Invited', rejected: 'Rejected', revoked: 'Removed' };

type TabKey = 'active' | 'pending';

export function AgencyContractorsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { agencyId, activeAgency } = useActiveContext();
  const [tab, setTab] = useState<TabKey>('active');
  const [offset, setOffset] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [detail, setDetail] = useState<ContractorDetail | null>(null);

  const status = tab === 'active' ? 'active' : undefined; // pending tab shows the two pending states
  const key = trpc.connections.agencyContractors.queryKey();
  const list = useQuery({
    ...trpc.connections.agencyContractors.queryOptions({ agencyId: agencyId!, limit: LIMIT, offset, status }),
    enabled: !!agencyId,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const respond = useMutation({ ...trpc.connections.respondToApplication.mutationOptions(), onSuccess: () => { toast.success('Updated'); invalidate(); }, onError: (e) => toastError(e) });
  const remove = useMutation({ ...trpc.connections.removeContractor.mutationOptions(), onSuccess: () => { toast.success('Contractor removed'); invalidate(); }, onError: (e) => toastError(e) });

  const all = list.data?.items ?? [];
  const rows = tab === 'pending' ? all.filter((c) => c.status === 'pendingApplication' || c.status === 'pendingInvite') : all;

  return (
    <div>
      <PageHeader
        title="Contractors"
        description="Freelancers connected to your agency."
        action={
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild><Button variant="accent" disabled={!agencyId}><Plus className="h-4 w-4" /> Invite</Button></DialogTrigger>
            {agencyId && inviteOpen && <InviteContractorDialog agencyId={agencyId} onDone={() => { setInviteOpen(false); invalidate(); }} />}
          </Dialog>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-[color:var(--color-border-default)]">
        {(['active', 'pending'] as TabKey[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTab(t); setOffset(0); }}
            className={cn('px-4 py-2 text-sm font-medium capitalize transition-colors', tab === t ? 'border-b-2 border-accent text-ink-100' : 'text-ink-40 hover:text-ink-60')}
          >
            {t}
          </button>
        ))}
      </div>

      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Briefcase} title={tab === 'active' ? 'No active contractors' : 'No pending requests'} description="Applications and invites appear here." />
        ) : (
          <>
            {/* Mobile: stacked cards (the per-row action buttons overflow a table at 390px). */}
            <ul className="divide-y divide-[color:var(--color-border-hairline)] md:hidden">
              {rows.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-9 w-9 shrink-0">{c.contractor?.profileUrl && <AvatarImage src={c.contractor.profileUrl} />}<AvatarFallback>{initialsOf(c.contractor?.name ?? c.contractor?.email ?? c.pendingEmail ?? '?')}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      {c.contractor ? (
                        <button type="button" onClick={() => setDetail(c.contractor as ContractorDetail)} className="block max-w-full truncate text-left font-medium text-ink-100 hover:text-accent hover:underline">
                          {c.contractor.name ?? c.contractor.email ?? '—'}
                        </button>
                      ) : (
                        <div className="truncate font-medium text-ink-100">{c.pendingEmail ?? '—'}</div>
                      )}
                      <div className="truncate text-xs text-ink-40">{c.contractor?.email ?? (c.pendingEmail ? 'Invited by email — no account yet' : '')}</div>
                      {(c.contractor?.skills ?? []).length > 0 && <div className="mt-0.5 truncate text-xs text-ink-60">{(c.contractor?.skills ?? []).slice(0, 2).join(', ')}</div>}
                      {c.status === 'pendingApplication' && c.note && <div className="mt-0.5 line-clamp-2 text-xs italic text-ink-60">“{c.note}”</div>}
                    </div>
                    <Badge variant={STATUS[c.status] ?? 'muted'} className="shrink-0">{STATUS_LABEL[c.status] ?? c.status}</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RowActions c={c} onView={setDetail} respond={respond} remove={remove} confirm={confirm} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
            <Table>
              <TableHeader><TableRow><TableHead>Contractor</TableHead><TableHead>Skills</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">{c.contractor?.profileUrl && <AvatarImage src={c.contractor.profileUrl} />}<AvatarFallback>{initialsOf(c.contractor?.name ?? c.contractor?.email ?? c.pendingEmail ?? '?')}</AvatarFallback></Avatar>
                        <div className="min-w-0">
                          {c.contractor ? (
                            <button type="button" onClick={() => setDetail(c.contractor as ContractorDetail)} className="truncate text-left font-medium text-ink-100 hover:text-accent hover:underline">
                              {c.contractor.name ?? c.contractor.email ?? '—'}
                            </button>
                          ) : (
                            <div className="font-medium text-ink-100">{c.pendingEmail ?? '—'}</div>
                          )}
                          <div className="text-xs text-ink-40">{c.contractor?.email ?? (c.pendingEmail ? 'Invited by email — no account yet' : '')}</div>
                          {c.status === 'pendingApplication' && c.note && <div className="mt-0.5 max-w-[28ch] truncate text-xs italic text-ink-60">“{c.note}”</div>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-60">{(c.contractor?.skills ?? []).slice(0, 2).join(', ') || '—'}</TableCell>
                    <TableCell><Badge variant={STATUS[c.status] ?? 'muted'}>{STATUS_LABEL[c.status] ?? c.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <RowActions c={c} onView={setDetail} respond={respond} remove={remove} confirm={confirm} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="px-4 pb-3"><Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} /></div>
          </>
        )}
      </Card>

      {/* Explore Contractors — default-agency-only talent discovery (ports the
          platformVerified-gated section in staff_contractor_list.dart). */}
      {agencyId && activeAgency?.platformVerified && <ExploreContractors agencyId={agencyId} onViewProfile={setDetail} />}

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        {detail && <ContractorDetailsDialog c={detail} />}
      </Dialog>
    </div>
  );
}

type ContractorRow = { id: string; status: string; pendingEmail?: string | null; note?: string | null; contractor?: { name?: string | null; email?: string | null } | null };

/**
 * Shared per-row action set (View profile + status-specific buttons), used by
 * both the desktop table and the mobile card list so their behaviour stays in
 * sync. Identical logic to the original inline table cell.
 */
function RowActions({ c, onView, respond, remove, confirm }: {
  c: any;
  onView: (c: ContractorDetail) => void;
  respond: { mutate: (v: { connectionId: string; accept: boolean }) => void };
  remove: { mutate: (v: { connectionId: string }) => void; isPending: boolean };
  confirm: (opts: any) => Promise<boolean>;
}) {
  const r = c as ContractorRow;
  return (
    <>
      {/* A View profile button for every contractor with an account, regardless
          of status. Email-only invites with no account yet have no profile. */}
      {c.contractor && <Button size="sm" variant="ghost" onClick={() => onView(c.contractor as ContractorDetail)}>View profile</Button>}
      {r.status === 'pendingApplication' ? (
        <>
          <Button size="sm" variant="accent" onClick={() => respond.mutate({ connectionId: r.id, accept: true })}>Approve</Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              if (!(await confirm({
                title: 'Reject application?',
                description: <>Reject the application from <span className="font-medium text-ink-100">{r.contractor?.name ?? r.contractor?.email ?? 'this contractor'}</span>? They'll need to re-apply to join.</>,
                confirmLabel: 'Reject',
                destructive: true,
              }))) return;
              respond.mutate({ connectionId: r.id, accept: false });
            }}
          >Reject</Button>
        </>
      ) : r.status === 'active' ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              destructive
              onClick={async () => {
                if (!(await confirm({
                  title: 'Remove contractor?',
                  description: <>Remove <span className="font-medium text-ink-100">{r.contractor?.name ?? r.contractor?.email ?? 'this contractor'}</span> from your agency? They'll lose access to your projects and chats.</>,
                  confirmLabel: 'Remove',
                  destructive: true,
                }))) return;
                remove.mutate({ connectionId: r.id });
              }}
            ><UserMinus className="h-4 w-4" /> Remove from agency</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : r.status === 'pendingInvite' ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={remove.isPending}
          onClick={async () => {
            if (!(await confirm({
              title: 'Cancel invite?',
              description: <>Cancel the invitation to <span className="font-medium text-ink-100">{r.contractor?.name ?? r.contractor?.email ?? r.pendingEmail ?? 'this contractor'}</span>?</>,
              confirmLabel: 'Cancel invite',
              cancelLabel: 'Keep invite',
              destructive: true,
            }))) return;
            remove.mutate({ connectionId: r.id });
          }}
        >Cancel invite</Button>
      ) : null}
    </>
  );
}

/** Standalone dialog wrapping the shared contractor profile view. */
function ContractorDetailsDialog({ c }: { c: ContractorDetail }) {
  return (
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader className="sr-only"><DialogTitle>{c.name ?? 'Contractor profile'}</DialogTitle></DialogHeader>
      <ContractorProfileView c={c} />
    </DialogContent>
  );
}

const EXPLORE_LIMIT = 6;

/**
 * Browse every contractor registered on the platform and invite them — a
 * capability exclusive to platform default agencies. Newest-first, paginated;
 * each card reflects this agency's current connection status. Ports
 * ExploreContractorsNotifier + the explore grid in staff_contractor_list.dart.
 */
function ExploreContractors({ agencyId, onViewProfile }: { agencyId: string; onViewProfile: (c: ContractorDetail) => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0);
  const exploreKey = trpc.connections.exploreContractors.queryKey();
  const list = useQuery(trpc.connections.exploreContractors.queryOptions({ agencyId, limit: EXPLORE_LIMIT, offset }));
  const refresh = () => {
    qc.invalidateQueries({ queryKey: exploreKey });
    qc.invalidateQueries({ queryKey: trpc.connections.agencyContractors.queryKey() });
  };
  const invite = useMutation({
    ...trpc.connections.inviteContractor.mutationOptions(),
    onSuccess: () => { toast.success('Invitation sent'); refresh(); },
    onError: (e) => toastError(e),
  });
  // A contractor can apply to a default agency directly; the agency accepts here.
  const respond = useMutation({
    ...trpc.connections.respondToApplication.mutationOptions(),
    onSuccess: () => { toast.success('Application accepted'); refresh(); },
    onError: (e) => toastError(e),
  });
  const items = list.data?.items ?? [];

  return (
    <section className="mt-6 md:mt-10">
      <h2 className="mb-4 text-h4 font-bold text-ink-100 md:mb-0">Explore Contractors</h2>
      <p className="mb-5 mt-1 hidden text-sm text-ink-60 md:block">Discover freelance talent and browse their professional portfolios.</p>
      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full" />)}</div>
      ) : items.length === 0 ? (
        <EmptyState icon={Briefcase} title="No contractors yet" description="No contractors registered on the platform yet." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => {
              const status = c.connection?.status;
              return (
                <Card key={c.id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-11 w-11">{c.profileUrl && <AvatarImage src={c.profileUrl} />}<AvatarFallback>{initialsOf(c.name ?? c.email ?? '?')}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink-100">{c.name ?? '—'}</div>
                      <div className="truncate text-xs text-ink-40">{c.tagline ?? 'Freelancer'}</div>
                    </div>
                    {c.hourlyRate != null && <Badge variant="muted">${Math.round(Number(c.hourlyRate))}/hr</Badge>}
                  </div>
                  {c.bio && <p className="line-clamp-2 text-sm text-ink-60">{c.bio}</p>}
                  {(c.skills ?? []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">{c.skills!.slice(0, 4).map((s) => <Badge key={s} variant="muted">{s}</Badge>)}</div>
                  )}
                  {(c.websiteUrl || c.linkedinUrl || c.resumeUrl) && (
                    <div className="flex items-center gap-3 text-ink-40">
                      {c.websiteUrl && <a href={c.websiteUrl} target="_blank" rel="noreferrer" className="hover:text-accent" aria-label="Website"><Globe className="h-4 w-4" /></a>}
                      {c.linkedinUrl && <a href={c.linkedinUrl} target="_blank" rel="noreferrer" className="hover:text-accent" aria-label="LinkedIn"><Linkedin className="h-4 w-4" /></a>}
                      {c.resumeUrl && <a href={c.resumeUrl} target="_blank" rel="noreferrer" className="hover:text-accent" aria-label="Resume"><FileText className="h-4 w-4" /></a>}
                    </div>
                  )}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Button size="sm" variant="ghost" onClick={() => onViewProfile(c as ContractorDetail)}>View profile</Button>
                    {status === 'active' ? (
                      <Badge variant="success">Connected</Badge>
                    ) : status === 'pendingInvite' ? (
                      <Badge variant="accent">Invited</Badge>
                    ) : status === 'pendingApplication' ? (
                      // The contractor applied to us → accept their application here.
                      <Button size="sm" variant="accent" disabled={respond.isPending} onClick={() => respond.mutate({ connectionId: c.connection!.id, accept: true })}>Accept application</Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={invite.isPending} onClick={() => invite.mutate({ agencyId, contractorId: c.id })}>
                        <Plus className="h-4 w-4" /> Invite
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-4"><Pagination total={list.data!.total} limit={EXPLORE_LIMIT} offset={offset} onChange={setOffset} /></div>
        </>
      )}
    </section>
  );
}

/** Invite a contractor by email (works for non-users too). Ports invite_contractor_dialog. */
function InviteContractorDialog({ agencyId, onDone }: { agencyId: string; onDone: () => void }) {
  const trpc = useTRPC();
  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  const invite = useMutation({
    ...trpc.connections.inviteContractor.mutationOptions(),
    onSuccess: (res) => {
      toast.success(res && 'pendingEmail' in res && res.pendingEmail ? 'Invitation emailed' : 'Contractor invited');
      onDone();
    },
    onError: (e) => toastError(e),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Invite a contractor</DialogTitle>
        <DialogDescription>Send an invite by email. People without an account get a sign-up link.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <Field label="Email" htmlFor="inv-email">
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contractor@example.com" />
        </Field>
        <Field label="Note (optional)" htmlFor="inv-note">
          <textarea id="inv-note" className="min-h-[60px] rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] bg-card px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="A short message to the contractor." />
        </Field>
      </div>
      <DialogFooter>
        <Button variant="accent" disabled={!email || invite.isPending} onClick={() => invite.mutate({ agencyId, email, note: note || undefined })}>
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
