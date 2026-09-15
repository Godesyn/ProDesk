import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Building2, Plus, Search, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { useChatNav } from './chat/chat-nav-context';
import { formatDate, initialsOf } from '../lib/utils';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar';
import { Badge } from '../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';

const LIMIT = 10;

export function ClientsPage() {
  const trpc = useTRPC();
  const [, navigate] = useLocation();
  const { navigateToChat } = useChatNav();
  const { agencyId, activeAgency } = useActiveContext();
  const isDefaultAgency = !!activeAgency?.platformVerified;
  const [offset, setOffset] = useState(0);
  const [connectOpen, setConnectOpen] = useState(false);

  const list = useQuery({
    ...trpc.connections.agencyClients.queryOptions({ agencyId: agencyId!, limit: LIMIT, offset }),
    enabled: !!agencyId,
  });
  const rows = list.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Clients"
        description="Brands connected to your agency."
        action={
          <Dialog open={connectOpen} onOpenChange={setConnectOpen}>
            <DialogTrigger asChild><Button variant="accent" disabled={!agencyId}><Plus className="h-4 w-4" /> Connect a brand</Button></DialogTrigger>
            {agencyId && connectOpen && <ConnectBrandDialog agencyId={agencyId} isDefault={isDefaultAgency} onDone={() => setConnectOpen(false)} />}
          </Dialog>
        }
      />
      <Card className="p-0">
        {list.isLoading ? (
          <div className="space-y-2 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} title="No clients yet" description="Connected brands will appear here." />
        ) : (
          <>
            {/* Mobile: stacked cards (the desktop table has too many columns for 390px). */}
            <ul className="divide-y divide-[color:var(--color-border-hairline)] md:hidden">
              {rows.map((b) => (
                <li
                  key={b.connectionId}
                  className="flex cursor-pointer items-center gap-3 p-4"
                  onClick={() => navigate(`/clients/${b.id}`)}
                >
                  <Avatar className="h-9 w-9 shrink-0">
                    {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                    <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink-100">{b.businessName}</div>
                    <div className="truncate text-xs text-ink-40">
                      {b.industry ? `${b.industry} · ` : ''}{formatDate(b.connectedAt)}
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    title="Chat"
                    className="shrink-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (agencyId) void navigateToChat({ brandId: b.id, agencyId, target: 'brandThread', selfAgencyId: agencyId });
                    }}
                  >
                    <MessageSquare className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Brand</TableHead>
                    <TableHead>Industry</TableHead>
                    <TableHead>Connected</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((b) => (
                    <TableRow key={b.connectionId} className="cursor-pointer" onClick={() => navigate(`/clients/${b.id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                            <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-ink-100">{b.businessName}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-ink-60">{b.industry ?? '—'}</TableCell>
                      <TableCell className="text-ink-60">{formatDate(b.connectedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          title="Chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (agencyId) void navigateToChat({ brandId: b.id, agencyId, target: 'brandThread', selfAgencyId: agencyId });
                          }}
                        >
                          <MessageSquare className="h-4 w-4" />
                        </Button>
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
    </div>
  );
}

const isEmailLike = (s: string) => s.includes('@') && s.includes('.');

/**
 * Agency-initiated brand connection — ports search_brands_dialog.dart, including
 * its default/non-default split:
 *  • DEFAULT agencies search the whole brand directory by name or email and send
 *    a connection request.
 *  • NON-DEFAULT agencies can only resolve a brand by its EXACT email; if none
 *    exists they send an email invitation (referral link) instead.
 */
function ConnectBrandDialog({ agencyId, isDefault, onDone }: { agencyId: string; isDefault: boolean; onDone: () => void }) {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const query = search.trim();
  // Default agencies query on ≥2 chars; non-default only once a full email is typed.
  const enabled = isDefault ? query.length >= 1 : isEmailLike(query);
  const results = useQuery({ ...trpc.connections.searchBrands.queryOptions({ agencyId, search: query, limit: 12 }), enabled });
  const rows = enabled ? results.data ?? [] : [];

  const request = useMutation({
    ...trpc.connections.requestBrandConnection.mutationOptions(),
    onSuccess: () => { toast.success('Connection request sent'); qc.invalidateQueries(); onDone(); },
    onError: (e) => toastError(e),
  });
  const invite = useMutation({
    ...trpc.connections.sendBrandReferralInvite.mutationOptions(),
    onSuccess: () => { toast.success('Invitation email sent'); onDone(); },
    onError: (e) => toastError(e),
  });

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Add New Brand</DialogTitle>
        <DialogDescription>
          {isDefault
            ? 'Search for brands by name or email to send an agency connection request.'
            : 'Enter the exact email address of the brand to invite them.'}
        </DialogDescription>
      </DialogHeader>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-40" />
        <Input
          className="pl-9"
          placeholder={isDefault ? 'Brand name or email…' : 'Enter brand email address…'}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="max-h-72 overflow-y-auto">
        {enabled && results.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length > 0 ? (
          <ul className="divide-y divide-[color:var(--color-border-default)]">
            {rows.map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <Avatar className="h-8 w-8">
                  {b.logoUrl && <AvatarImage src={b.logoUrl} />}
                  <AvatarFallback>{initialsOf(b.businessName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-ink-100">{b.businessName}</div>
                  <div className="truncate text-xs text-ink-40">{b.email ?? b.industry ?? 'No email'}</div>
                </div>
                {b.alreadyConnected ? (
                  <Badge variant="success">Connected</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={request.isPending} onClick={() => request.mutate({ agencyId, brandId: b.id })}>Send Request</Button>
                )}
              </li>
            ))}
          </ul>
        ) : query.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-40">
            {isDefault ? 'Start typing to search brands.' : 'Enter a brand email address to invite them.'}
          </p>
        ) : (
          // No matching brand. Non-default agencies fall back to an email invite.
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-ink-40">
              {!isDefault && !isEmailLike(query) ? 'Please enter a valid email address of the brand.' : 'No brands found.'}
            </p>
            {!isDefault && isEmailLike(query) && (
              <Button variant="accent" disabled={invite.isPending} onClick={() => invite.mutate({ agencyId, email: query })}>
                Send Invitation Email
              </Button>
            )}
          </div>
        )}
      </div>
    </DialogContent>
  );
}
