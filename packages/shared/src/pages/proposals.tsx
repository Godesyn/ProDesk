import { useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { toastError } from '../lib/errors';
import { useTRPC } from '../lib/trpc';
import { useActiveContext } from '../hooks/use-active-context';
import { formatCurrency, formatDate } from '../lib/utils';
import { priceSummary } from './marketplace/pricing';
import { statusLabel } from '../lib/proposal-status';
import { PageHeader } from '../components/layout/page-header';
import { EmptyState } from '../components/layout/empty-state';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge, type BadgeProps } from '../components/ui/badge';
import { Skeleton } from '../components/ui/skeleton';
import { Pagination } from '../components/ui/pagination';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';

const LIMIT = 100; // pull a full page to group client-side, like the Flutter list
const STATUS: Record<string, BadgeProps['variant']> = {
  draft: 'muted', sent: 'accent', viewed: 'accent', accepted: 'success',
  rejected: 'danger', expired: 'muted', changeRequested: 'warn', internal: 'muted',
};

type ProposalRow = {
  id: string; title: string | null; status: string; totalAmount: string; createdAt: string | Date;
  /** Aggregated from the proposal's line items by the server (see proposals.list). */
  upfrontTotal?: number; weeklyTotal?: number;
};

/** `$100 + $10 per week` from the line-item totals; falls back to the stored total. */
function proposalRowPrice(p: ProposalRow): string {
  return p.upfrontTotal || p.weeklyTotal ? priceSummary(p.upfrontTotal ?? 0, p.weeklyTotal ?? 0) : formatCurrency(p.totalAmount);
}

export function ProposalsPage() {
  const trpc = useTRPC();
  const qc = useQueryClient();
  const { workspace, agencyId, brandId } = useActiveContext();
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const isAgency = workspace === 'agency' || workspace === 'admin';

  const scope = workspace === 'brand' ? { brandId: brandId! } : { agencyId: agencyId! };
  const enabled = workspace === 'brand' ? !!brandId : !!agencyId;
  const listKey = trpc.proposals.list.queryKey();
  const list = useQuery({ ...trpc.proposals.list.queryOptions({ ...scope, limit: LIMIT, offset }), enabled });
  // Sales agencies can build inter-agency proposals spanning multiple agencies.
  const agencyInfo = useQuery({ ...trpc.agencies.byId.queryOptions({ id: agencyId! }), enabled: isAgency && !!agencyId });
  const isSalesAgency = !!(agencyInfo.data as { isSalesAgency?: boolean } | undefined)?.isSalesAgency;
  const rows = (list.data?.items ?? []) as ProposalRow[];

  const by = (s: string) => rows.filter((p) => p.status === s);
  const drafts = by('draft');
  const changeRequested = by('changeRequested');
  const sent = by('sent');
  const viewed = by('viewed');
  const accepted = by('accepted');
  const internal = by('internal');
  const other = rows.filter((p) => p.status === 'rejected' || p.status === 'expired');

  return (
    <div>
      <PageHeader
        title="Proposals"
        description="Quotes between agencies and clients."
        action={
          isAgency && (
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="accent" disabled={!agencyId}><Plus className="h-4 w-4" /> New proposal</Button>
              </DialogTrigger>
              <CreateProposalDialog agencyId={agencyId} isSalesAgency={isSalesAgency} onDone={() => { setOpen(false); qc.invalidateQueries({ queryKey: listKey }); }} />
            </Dialog>
          )
        }
      />

      {list.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={FileText}
            title={isAgency ? 'No proposals yet' : 'No proposals received'}
            description={isAgency ? 'Create your first proposal to get started.' : 'Proposals from agencies will appear here.'}
          />
        </Card>
      ) : (
        <div className="space-y-8">
          {changeRequested.length > 0 && <Section title="Changes Requested" rows={changeRequested} accent="warn" isAgency={isAgency} />}
          {isAgency && drafts.length > 0 && <Section title="Drafts" rows={drafts} isAgency={isAgency} />}
          {!isAgency && (sent.length > 0 || viewed.length > 0) && <Section title="Pending" rows={[...sent, ...viewed]} isAgency={isAgency} />}
          {isAgency && sent.length > 0 && <Section title="Sent" rows={sent} isAgency={isAgency} />}
          {isAgency && viewed.length > 0 && <Section title="Viewed" rows={viewed} isAgency={isAgency} />}
          {accepted.length > 0 && <Section title="Accepted & Paid" rows={accepted} accent="success" isAgency={isAgency} />}
          {isAgency && internal.length > 0 && <Section title="Internal (Non-billable)" rows={internal} isAgency={isAgency} />}
          {other.length > 0 && <Section title="Declined / Expired" rows={other} isAgency={isAgency} />}

          {list.data && list.data.total > LIMIT && (
            <Pagination total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, rows, accent, isAgency }: { title: string; rows: ProposalRow[]; accent?: BadgeProps['variant']; isAgency: boolean }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-ink-100">{title}</h2>
        <Badge variant={accent ?? 'muted'}>{rows.length}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((p) => (
          <Link key={p.id} href={`/proposal/${p.id}`}>
            <Card className="cursor-pointer p-4 transition-colors hover:bg-inset/50">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium text-ink-100">{p.title ?? 'Untitled'}</div>
                <Badge variant={STATUS[p.status]}>{statusLabel(p.status, isAgency)}</Badge>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <span className="text-xs text-ink-60">{formatDate(p.createdAt)}</span>
                <span className="tabular-nums text-base font-semibold text-ink-100">{proposalRowPrice(p)}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CreateProposalDialog({ agencyId, isSalesAgency, onDone }: { agencyId: string | null; isSalesAgency?: boolean; onDone: () => void }) {
  const trpc = useTRPC();
  const [title, setTitle] = useState('');
  // A proposal is a sales proposal iff the building agency is a
  // sales agency — there's no per-proposal toggle; it's purely the agency's status.
  const create = useMutation({
    ...trpc.proposals.create.mutationOptions(),
    onSuccess: (created) => {
      toast.success('Draft created');
      onDone();
      // Open the builder for the freshly-created draft.
      window.location.assign(`/proposal/${created.id}/edit`);
    },
    onError: (e) => toastError(e),
  });
  return (
    <DialogContent>
      <DialogHeader><DialogTitle>{isSalesAgency ? 'New sales proposal' : 'New proposal'}</DialogTitle></DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="p-title">Title</Label>
        <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Q3 Brand Refresh" />
      </div>
      {/* Sales agencies build proposals spanning services from many agencies — this
          is determined by the agency's status, not a per-proposal choice. */}
      {isSalesAgency && (
        <p className="text-xs text-ink-60">
          This is a sales proposal — you can mix services and packages from multiple agencies.
        </p>
      )}
      <DialogFooter>
        <Button variant="accent" disabled={!title || !agencyId || create.isPending} onClick={() => create.mutate({ agencyId: agencyId!, title })}>
          {create.isPending ? 'Creating…' : 'Create & build'}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
