import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCog, Plus, MoreHorizontal, Trash2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { initialsOf } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../components/ui/dropdown-menu';
import { useConfirm } from '../components/ui/confirm-dialog';
import { PERMISSION_GROUPS, groupedPermissionsForOrg, permissionLabel, togglePermission } from './agency/constants';

/**
 * The full set of permission keys valid for an org type — taken straight from the
 * shared PERMISSION_GROUPS catalog (which is, by construction, a subset of the
 * server enum they ship alongside). Driving the picker from this constant rather
 * than the `staff.permissionOptions` query means the editor always shows every
 * permission, even before that query resolves / against a not-yet-restarted dev
 * backend — the empty-list case that made the dialog look nearly blank.
 */
const orgCatalog = (orgType: 'agency' | 'brand'): string[] =>
  PERMISSION_GROUPS[orgType].flatMap((g) => g.keys);

const LIMIT = 10;
const STATUS_VARIANT = { active: 'success', pending: 'warn', removed: 'muted' } as const;

export function StaffPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { agencyId, brandId, workspace } = useActiveContext();
  const orgType = workspace === 'brand' ? 'brand' : 'agency';
  const orgId = orgType === 'brand' ? brandId : agencyId;
  const [offset, setOffset] = useState(0);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; permissions: string[] } | null>(null);

  const listKey = trpc.staff.list.queryKey();
  const list = useQuery({
    ...trpc.staff.list.queryOptions({ orgType, orgId: orgId!, limit: LIMIT, offset }),
    enabled: !!orgId,
  });
  const remove = useMutation({
    ...trpc.staff.remove.mutationOptions(),
    onSuccess: () => { toast.success('Staff member removed'); qc.invalidateQueries({ queryKey: listKey }); },
    onError: (e) => toastError(e),
  });
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Team members and their permissions."
        action={
          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button variant="accent" disabled={!orgId}><Plus className="h-4 w-4" /> Invite</Button>
            </DialogTrigger>
            <InviteDialog orgType={orgType} orgId={orgId} onDone={() => { setInviteOpen(false); qc.invalidateQueries({ queryKey: listKey }); }} />
          </Dialog>
        }
      />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={UserCog} title="No staff yet" description="Invite teammates and assign permissions." />
        ) : (
          <>
            {/* Mobile: stacked cards (the permissions column crushes a table at 390px). */}
            <ul className="divide-y divide-[color:var(--color-border-hairline)] md:hidden">
              {rows.map((m) => (
                <li key={m.id} className="flex items-start gap-3 p-4">
                  <Avatar className="h-9 w-9 shrink-0">
                    {m.profileUrl && <AvatarImage src={m.profileUrl} />}
                    <AvatarFallback>{initialsOf([m.firstName, m.lastName].filter(Boolean).join(' ') || m.email)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium text-ink-100">{m.email}</span>
                      <Badge variant={STATUS_VARIANT[m.status]} className="shrink-0">{m.status}</Badge>
                    </div>
                    {m.permissions.length ? (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {m.permissions.slice(0, 4).map((p) => (
                          <Badge key={p} variant="muted">{permissionLabel(p)}</Badge>
                        ))}
                        {m.permissions.length > 4 && <Badge variant="muted">+{m.permissions.length - 4}</Badge>}
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-ink-40">No permissions</div>
                    )}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setEditing({ id: m.id, permissions: [...m.permissions] })}>
                        <Pencil className="h-4 w-4" /> Edit permissions
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        destructive
                        onClick={async () => {
                          if (!(await confirm({
                            title: 'Remove staff member?',
                            description: <>Remove <span className="font-medium text-ink-100">{m.email}</span> from your {orgType}? They'll lose all access and their permissions.</>,
                            confirmLabel: 'Remove',
                            destructive: true,
                          }))) return;
                          remove.mutate({ id: m.id });
                        }}
                      >
                        <Trash2 className="h-4 w-4" /> Remove
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Permissions</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {m.profileUrl && <AvatarImage src={m.profileUrl} />}
                          <AvatarFallback>{initialsOf([m.firstName, m.lastName].filter(Boolean).join(' ') || m.email)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink-100">{m.email}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {m.permissions.length ? (
                        <div className="flex max-w-md flex-wrap gap-1">
                          {m.permissions.slice(0, 4).map((p) => (
                            <Badge key={p} variant="muted">{permissionLabel(p)}</Badge>
                          ))}
                          {m.permissions.length > 4 && <Badge variant="muted">+{m.permissions.length - 4}</Badge>}
                        </div>
                      ) : (
                        <span className="text-sm text-ink-40">None</span>
                      )}
                    </TableCell>
                    <TableCell><Badge variant={STATUS_VARIANT[m.status]}>{m.status}</Badge></TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing({ id: m.id, permissions: [...m.permissions] })}>
                            <Pencil className="h-4 w-4" /> Edit permissions
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            destructive
                            onClick={async () => {
                              if (!(await confirm({
                                title: 'Remove staff member?',
                                description: <>Remove <span className="font-medium text-ink-100">{m.email}</span> from your {orgType}? They'll lose all access and their permissions.</>,
                                confirmLabel: 'Remove',
                                destructive: true,
                              }))) return;
                              remove.mutate({ id: m.id });
                            }}
                          >
                            <Trash2 className="h-4 w-4" /> Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
            <div className="px-4 pb-3">
              <Pagination total={list.data!.total} limit={LIMIT} offset={offset} onChange={setOffset} />
            </div>
          </>
        )}
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && <EditPermissionsDialog orgType={orgType} member={editing} onDone={() => { setEditing(null); qc.invalidateQueries({ queryKey: listKey }); qc.invalidateQueries({ queryKey: trpc.auth.me.queryKey() }); }} />}
      </Dialog>
    </div>
  );
}

/**
 * Grouped, labeled permission picker (ports getGroupedPermissions + displayName).
 * Shows ONLY the permissions valid for the org type (brand staff see brand
 * permissions, agency staff see agency permissions) — no cross-org fallback.
 */
function PermissionPicker({ orgType, options, selected, onToggle, onSetKeys }: { orgType: 'agency' | 'brand'; options: readonly string[]; selected: Set<string>; onToggle: (p: string) => void; onSetKeys: (keys: string[], on: boolean) => void }) {
  const grouped = groupedPermissionsForOrg(orgType, options);
  const chip = (on: boolean) =>
    `rounded-[var(--radius-pill)] border px-3 py-1 text-xs transition-colors ${
      on ? 'border-transparent bg-accent/12 text-accent' : 'border-[color:var(--color-border-default)] text-ink-60 hover:bg-inset'
    }`;

  return (
    <div className="flex flex-col gap-4">
      {grouped.map((g) => {
        // "All" chip: reflects whether every key in the group is selected, and
        // toggles them together (selecting it enables View Projects + every
        // workflow permission; clearing it disables them all).
        const allOn = g.all ? g.keys.length > 0 && g.keys.every((k) => selected.has(k)) : false;
        return (
          <div key={g.title} className="flex flex-col gap-2">
            <Label className="text-[0.6875rem] uppercase tracking-[0.06em] text-ink-40">{g.title}</Label>
            <div className="flex flex-wrap gap-2">
              {g.all && (
                <button type="button" onClick={() => onSetKeys(g.keys, !allOn)} className={`${chip(allOn)} font-medium`}>
                  All
                </button>
              )}
              {g.keys.map((p) => (
                <button key={p} type="button" onClick={() => onToggle(p)} className={chip(selected.has(p))}>
                  {permissionLabel(p)}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EditPermissionsDialog({ orgType, member, onDone }: { orgType: 'agency' | 'brand'; member: { id: string; permissions: string[] }; onDone: () => void }) {
  const trpc = useTRPC();
  const [selected, setSelected] = useState<Set<string>>(new Set(member.permissions));
  const save = useMutation({
    ...trpc.staff.updatePermissions.mutationOptions(),
    onSuccess: () => { toast.success('Permissions updated'); onDone(); },
    onError: (e) => toastError(e),
  });
  function toggle(p: string) {
    setSelected((prev) => togglePermission(prev, p));
  }
  function setKeys(keys: string[], on: boolean) {
    setSelected((prev) => { const next = new Set(prev); keys.forEach((k) => (on ? next.add(k) : next.delete(k))); return next; });
  }
  // Every permission valid for this org type (also what "Select all" / save persist).
  const orgKeys = orgCatalog(orgType);
  const allSelected = orgKeys.length > 0 && orgKeys.every((k) => selected.has(k));
  return (
    <DialogContent className="max-w-xl">
      <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
        <DialogTitle>Edit permissions</DialogTitle>
        <Button variant="outline" size="sm" disabled={orgKeys.length === 0} onClick={() => setKeys(orgKeys, !allSelected)}>
          {allSelected ? 'Deselect all' : 'Select all'}
        </Button>
      </DialogHeader>
      <PermissionPicker orgType={orgType} options={orgKeys} selected={selected} onToggle={toggle} onSetKeys={setKeys} />
      <DialogFooter>
        <Button variant="accent" disabled={save.isPending} onClick={() => save.mutate({ id: member.id, permissions: orgKeys.filter((p) => selected.has(p)) as any })}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function InviteDialog({ orgType, orgId, onDone }: { orgType: 'agency' | 'brand'; orgId: string | null; onDone: () => void }) {
  const trpc = useTRPC();
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const invite = useMutation({
    ...trpc.staff.invite.mutationOptions(),
    onSuccess: () => { toast.success('Invitation sent'); onDone(); },
    onError: (e) => toastError(e),
  });

  function toggle(p: string) {
    setSelected((prev) => togglePermission(prev, p));
  }
  function setKeys(keys: string[], on: boolean) {
    setSelected((prev) => { const next = new Set(prev); keys.forEach((k) => (on ? next.add(k) : next.delete(k))); return next; });
  }

  // Every permission valid for this org type (brand vs agency context).
  const orgKeys = orgCatalog(orgType);

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader>
        <DialogTitle>Invite staff member</DialogTitle>
        <DialogDescription>They'll receive an invite to join your {orgType}.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inv-email">Email</Label>
          <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@example.com" />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Permissions</Label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="text-xs text-accent hover:underline disabled:opacity-40"
                disabled={!orgKeys.length || orgKeys.every((p) => selected.has(p))}
                onClick={() => setSelected(new Set(orgKeys))}
              >
                Select all
              </button>
              <span className="text-ink-40">·</span>
              <button
                type="button"
                className="text-xs text-ink-60 hover:underline disabled:opacity-40"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                Clear
              </button>
            </div>
          </div>
          <PermissionPicker orgType={orgType} options={orgKeys} selected={selected} onToggle={toggle} onSetKeys={setKeys} />
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="accent"
          disabled={!email || !orgId || invite.isPending}
          onClick={() => invite.mutate({ orgType, orgId: orgId!, email, permissions: orgKeys.filter((p) => selected.has(p)) as any })}
        >
          {invite.isPending ? 'Sending…' : 'Send invite'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
