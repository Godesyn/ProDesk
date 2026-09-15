import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Files, Receipt, Info, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { supabase } from '../lib/supabase';
import { useTRPC } from '../lib/trpc';
import { formatDate, initialsOf } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { useConfirm } from '../components/ui/confirm-dialog';
import { SearchBar, PillToggle, StatCard } from './super-admin/components';
import { Tooltip } from '../components/ui/tooltip';

export { GlobalSettingsPage } from './super-admin/settings';
export { AiSpendByBrandPage } from './super-admin/ai-spend';
export { DisciplinesPage } from './super-admin/disciplines';
export { ResourcesManagementPage } from './super-admin/resources';
export { AdminPayoutsPage } from './super-admin/payouts';
export { AdminInvoicesPage } from './super-admin/invoices';

const LIMIT = 15;

/**
 * Derive a toggle's display state from its (shared) mutation. While the
 * mutation for THIS agency is in flight we show the value the admin just chose
 * and lock the toggle — otherwise the switch snaps back to its old position
 * until the invalidate-driven refetch lands, making it look like it did nothing.
 */
function pendingToggle<K extends string>(
  mutation: {
    isPending: boolean;
    variables?: { agencyId: string } & Record<K, boolean>;
  },
  agencyId: string,
  current: boolean,
  key: K,
): { checked: boolean; disabled: boolean } {
  const inFlight =
    mutation.isPending && mutation.variables?.agencyId === agencyId;
  return {
    checked: inFlight && mutation.variables ? mutation.variables[key] : current,
    disabled: inFlight,
  };
}

function useSearchPager() {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  return {
    search,
    offset,
    setOffset,
    onSearch: (v: string) => {
      setSearch(v);
      setOffset(0);
    },
  };
}

export function AdminUsersPage() {
  const trpc = useTRPC();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { search, offset, setOffset, onSearch } = useSearchPager();
  const usersKey = trpc.superAdmin.users.queryKey();
  const list = useQuery(
    trpc.superAdmin.users.queryOptions({
      limit: LIMIT,
      offset,
      search: search || undefined,
    }),
  );
  const rows = list.data?.items ?? [];
  const userIds = rows.map((u) => u.id);
  const agencyMap = useQuery({
    ...trpc.superAdmin.userAgencies.queryOptions({ userIds }),
    enabled: userIds.length > 0,
  });

  const loginAs = useMutation({
    ...trpc.superAdmin.loginAsUser.mutationOptions(),
    onSuccess: async ({ tokenHash }) => {
      // Establish a session as the target user by redeeming the one-time token.
      const { error } = await supabase.auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      });
      if (error) {
        toastError(error);
        return;
      }
      toast.success('Logged in as user');
      window.location.href = '/';
    },
    onError: (e) => toastError(e),
  });

  // Grant/revoke beta access — a beta user gets every feature subscription for
  // free (entitlement bypass; no Stripe). Track the in-flight userId so the
  // toggle shows the chosen state until the refetch lands.
  const setBeta = useMutation({
    ...trpc.superAdmin.setBetaUser.mutationOptions(),
    onSuccess: (_data, vars) => {
      toast.success(vars.isBetaUser ? 'Beta access granted' : 'Beta access revoked');
      qc.invalidateQueries({ queryKey: usersKey });
    },
    onError: (e) => toastError(e),
  });

  return (
    <div>
      <PageHeader title="Users" description="All platform users." />
      <SearchBar onChange={onSearch} />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Agencies</TableHead>
                  <TableHead>Beta</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((u) => {
                  const name =
                    [u.firstName, u.lastName].filter(Boolean).join(' ') ||
                    'Unknown User';
                  const owned = agencyMap.data?.[u.id] ?? [];
                  // Show the chosen state (and lock the toggle) while this user's
                  // own mutation is in flight, else it snaps back until refetch.
                  const betaPending =
                    setBeta.isPending && setBeta.variables?.userId === u.id;
                  const betaOn = betaPending
                    ? !!setBeta.variables?.isBetaUser
                    : u.isBetaUser;
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {u.profileUrl && <AvatarImage src={u.profileUrl} />}
                            <AvatarFallback>{initialsOf(name)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-ink-100">
                            {name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-ink-60">{u.email}</TableCell>
                      <TableCell>
                        {owned.length === 0 ? (
                          <span className="text-ink-40">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {owned.slice(0, 5).map((a) => (
                              <Badge key={a.id} variant="outline">
                                {a.businessName}
                              </Badge>
                            ))}
                            {owned.length > 5 && (
                              <Badge variant="muted">
                                +{owned.length - 5} more
                              </Badge>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Tooltip label="Beta users get every feature subscription for free — including features added later — without being billed.">
                          <span>
                            <PillToggle
                              label={betaOn ? 'Beta' : 'Off'}
                              activeClass="text-accent"
                              checked={betaOn}
                              disabled={betaPending}
                              onChange={(next) =>
                                setBeta.mutate({ userId: u.id, isBetaUser: next })
                              }
                            />
                          </span>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={loginAs.isPending}
                          onClick={async () => {
                            if (
                              !(await confirm({
                                title: 'Log in as this user?',
                                description: `You will be signed out of your admin account and impersonate ${name}. To return, you'll need to log back in as yourself.`,
                                confirmLabel: 'Log in as user',
                                destructive: true,
                              }))
                            )
                              return;
                            loginAs.mutate({ userId: u.id });
                          }}
                        >
                          <LogIn className="h-4 w-4" /> Login
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="px-4 pb-3">
              <Pagination
                total={list.data?.total ?? 0}
                limit={LIMIT}
                offset={offset}
                onChange={setOffset}
              />
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export function AdminAgenciesPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { search, offset, setOffset, onSearch } = useSearchPager();
  const key = trpc.superAdmin.agencies.queryKey();
  const list = useQuery(
    trpc.superAdmin.agencies.queryOptions({
      limit: LIMIT,
      offset,
      search: search || undefined,
    }),
  );
  const stats = useQuery(trpc.superAdmin.agencyStats.queryOptions());
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: trpc.superAdmin.agencyStats.queryKey() });
  };
  const onMut = {
    onSuccess: () => {
      toast.success('Updated');
      invalidate();
    },
    onError: (e: { message: string }) => toastError(e),
  };

  const setVerified = useMutation({
    ...trpc.superAdmin.setAgencyVerified.mutationOptions(),
    ...onMut,
  });
  const setSales = useMutation({
    ...trpc.superAdmin.setAgencySalesAgency.mutationOptions(),
    ...onMut,
  });
  const setDefault = useMutation({
    ...trpc.superAdmin.setAgencyDefault.mutationOptions(),
    ...onMut,
  });
  const del = useMutation({
    ...trpc.superAdmin.deleteAgency.mutationOptions(),
    onSuccess: () => {
      toast.success('Agency deleted');
      invalidate();
      setConfirmDelete(null);
    },
    onError: (e) => toastError(e),
  });

  // Exclude soft-deleted agencies (username tombstone), matching Flutter.
  const rows = (list.data?.items ?? []).filter((a) => a.username !== 'deleted');

  return (
    <div>
      <PageHeader title="Agencies" description="Review and manage agencies." />
      {stats.data && (
        <div className="mb-6 flex flex-wrap gap-4">
          <StatCard label="Total Agencies" value={stats.data.total} />
          <StatCard
            label="Verified"
            value={stats.data.verified}
            tone="success"
          />
          <StatCard label="Pending" value={stats.data.pending} tone="warn" />
        </div>
      )}
      <SearchBar onChange={onSearch} />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agency</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="w-44 min-w-[11rem]">Phone</TableHead>
                  <TableHead>Actions</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          {a.logoUrl && <AvatarImage src={a.logoUrl} />}
                          <AvatarFallback>
                            {initialsOf(a.businessName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className="font-medium text-ink-100">
                          {a.businessName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-60">
                      {a.businessEmail ?? 'N/A'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-ink-60">
                      {a.phone ?? 'N/A'}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <Tooltip label="Cannot see any tabs until verified.">
                          <span>
                            <PillToggle
                              label="Verified"
                              activeClass="text-success"
                              {...pendingToggle(
                                setVerified,
                                a.id,
                                a.emailVerified,
                                'emailVerified',
                              )}
                              onChange={(v) =>
                                setVerified.mutate({
                                  agencyId: a.id,
                                  emailVerified: v,
                                })
                              }
                            />
                          </span>
                        </Tooltip>
                        <Tooltip label="Shows products from other agencies.">
                          <span>
                            <PillToggle
                              label="Sales Agency"
                              {...pendingToggle(
                                setSales,
                                a.id,
                                a.isSalesAgency,
                                'isSalesAgency',
                              )}
                              onChange={(v) =>
                                setSales.mutate({
                                  agencyId: a.id,
                                  isSalesAgency: v,
                                })
                              }
                            />
                          </span>
                        </Tooltip>
                        <Tooltip label="If turned off, can only view connected and default brands.">
                          <span>
                            <PillToggle
                              label="Default"
                              {...pendingToggle(
                                setDefault,
                                a.id,
                                a.platformVerified,
                                'platformVerified',
                              )}
                              onChange={(v) =>
                                setDefault.mutate({
                                  agencyId: a.id,
                                  platformVerified: v,
                                })
                              }
                            />
                          </span>
                        </Tooltip>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {!a.emailVerified && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setConfirmDelete({ id: a.id, name: a.businessName })
                          }
                          title="Delete Agency"
                        >
                          Delete
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3">
              <Pagination
                total={list.data?.total ?? 0}
                limit={LIMIT}
                offset={offset}
                onChange={setOffset}
              />
            </div>
          </>
        )}
      </Card>

      <Dialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agency</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-60">
            Are you sure you want to delete {confirmDelete?.name}? This action
            will mark them as deleted and unverified.
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={del.isPending}
              onClick={() =>
                confirmDelete && del.mutate({ agencyId: confirmDelete.id })
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function AdminBrandsPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const { search, offset, setOffset, onSearch } = useSearchPager();
  const list = useQuery(
    trpc.superAdmin.brands.queryOptions({
      limit: LIMIT,
      offset,
      search: search || undefined,
    }),
  );
  const rows = list.data?.items ?? [];
  const [filesBrand, setFilesBrand] = useState<{
    id: string;
    name: string;
  } | null>(null);
  return (
    <div>
      <PageHeader title="Brands" description="All brands on the platform." />
      <SearchBar onChange={onSearch} />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Brand</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                          <AvatarFallback>
                            {initialsOf(b.businessName)}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-ink-100">
                            {b.businessName}
                          </p>
                          <p className="text-xs text-ink-40">
                            {formatDate(b.createdAt)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-60">
                      {b.industry ?? '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setFilesBrand({ id: b.id, name: b.businessName })
                          }
                        >
                          <Files className="h-4 w-4" /> Files
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(`/super-admin/brands/${b.id}/billing`)
                          }
                        >
                          <Receipt className="h-4 w-4" /> Billing
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            navigate(`/super-admin/brands/${b.id}/info-hub`)
                          }
                        >
                          <Info className="h-4 w-4" /> Info Hub
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="px-4 pb-3">
              <Pagination
                total={list.data?.total ?? 0}
                limit={LIMIT}
                offset={offset}
                onChange={setOffset}
              />
            </div>
          </>
        )}
      </Card>
      {filesBrand && (
        <BrandFilesDialog
          brandId={filesBrand.id}
          brandName={filesBrand.name}
          onClose={() => setFilesBrand(null)}
        />
      )}
    </div>
  );
}

/** Super-admin read-only view of a brand's document-locker files. */
function BrandFilesDialog({
  brandId,
  brandName,
  onClose,
}: {
  brandId: string;
  brandName: string;
  onClose: () => void;
}) {
  const trpc = useTRPC();
  const q = useQuery(trpc.superAdmin.brandFiles.queryOptions({ brandId }));
  const files = q.data ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{brandName} · Files</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : files.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-60">
            No files for this brand.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {files.map((f) => (
              <a
                key={f.id}
                href={f.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] border border-[color:var(--color-border-default)] px-3 py-2 text-sm hover:bg-inset"
              >
                <span className="truncate text-ink-100">{f.name}</span>
                <span className="shrink-0 text-xs text-ink-40">
                  {f.category ?? f.type ?? ''}
                </span>
              </a>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
